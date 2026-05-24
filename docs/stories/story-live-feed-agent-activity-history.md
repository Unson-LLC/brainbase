---
story_id: story-live-feed-agent-activity-history
title: Live Feed エージェント活動履歴
source_requirement:
  type: user_reported_gap
  description: 現在の Live Feed はセッションリストと役割が重なっている。Live Feed は、各セッションでユーザーが何を依頼し、エージェントがどの順番で動いていたかを、LLM/SLM の常時要約コストなしで思い出せる面にする。
architecture_docs:
  - path: docs/architecture/live-feed-agent-activity-history-architecture.md
    status: proposed
    reason: 常時 LLM/SLM 要約ではなく、ユーザー入力と構造化イベントから低コストに活動履歴を構成するアーキテクチャを定義する。
related_stories:
  - story-live-feed-activity-timeline
status: draft
created_at: 2026-05-24
updated_at: 2026-05-24
---

# Live Feed エージェント活動履歴

## 背景

Brainbase では複数のエージェントを並行して動かす。セッションリストはすでに「どのセッションが今アクティブか」を、並び順や状態インジケータである程度答えられる。

一方、現在の Live Feed はセッションごとの現在状態を 1 行で出すため、セッションリストの別表示に近い。これでは、より重要な問いに答えられない。

> このセッションって今何やってたんだっけ。自分は前に何を頼んだんだっけ。

欲しいのは、各セッションを開かなくても、自分が送った依頼とエージェントの活動の流れを素早く思い出せること。ただし、全セッションを常時 LLM/SLM で要約するとコスト、遅延、運用負荷が無駄に増える。

## ユーザーストーリー

複数のエージェントを並行運用する Brainbase ユーザーとして、Live Feed で各セッションの過去のユーザー入力とエージェント活動イベントを時系列で確認したい。そうすることで、常時モデル要約に依存せず、セッションを再開した瞬間に作業文脈を思い出せる。

## プロダクト方針

Live Feed はセッション状態リストではなく、活動履歴の面にする。

答えるべき問いは 2 つ。

- セッション単位: このエージェントに自分は何を頼み、どの流れで進んでいたか。
- 全体単位: 複数エージェントが、どの順番で入力・作業・待機・完了していたか。

最初の実装は deterministic に寄せる。

- ユーザーの raw prompt、startup prompt、構造化 activity report を一次情報にする。
- 既存の `taskBrief`、`currentStep`、`latestEvidence`、`assistantSnippet`、状態、timestamp、session metadata を使う。
- 表示用テキストは、切り詰め、先頭行抽出、見出し抽出、構造化フィールドの選択で作る。
- 通常の polling、rendering、row update では LLM/SLM を呼ばない。

## スコープ

- Live Feed に、セッション 1 行の状態表示ではなく、時系列の活動履歴を表示するモードまたはセクションを追加する。
- startup prompt と、その後に観測できるユーザー送信 prompt を、セッションごとの履歴として表示する。
- working、waiting、done、blocked/stale、task switch、current step、latest evidence などの構造化イベントを表示する。
- 「このセッションは何をやっていたか」を思い出せる session-focused view を提供する。
- 複数セッションの活動を時間順に混ぜる all-sessions view を提供する。
- 既存の安定した status timeline は compact status lane または fallback として残してよいが、Live Feed の主価値にはしない。
- 要約カードは deterministic を先に使い、model-generated summary は明示操作、cache、budget gate の下に置く。

## 受け入れ条件

- [ ] Live Feed を開くと、履歴が存在するアクティブセッションについて、1 セッション 1 行ではなく複数イベントの活動履歴が見える。
- [ ] session-focused filter で、そのセッションに対する過去のユーザー入力が時系列で見える。
- [ ] all-sessions view で、ユーザー入力イベントとエージェント活動イベントが timestamp 順に混ざって見える。
- [ ] 活動行は user prompt、agent work、waiting-for-input、done、blocked/stale、system event を区別できる。
- [ ] 行の本文は、raw prompt 抜粋、構造化 `taskBrief`、`currentStep`、`latestEvidence`、既存 assistant snippet のいずれかの source-backed text を使う。
- [ ] 通常の Live Feed 表示、polling、filtering、row update では LLM/SLM call が不要である。
- [ ] 任意の model-generated summary は、明示的なユーザー操作、budget 許可つき cache miss、または低頻度 background job のみで生成される。
- [ ] 同一 prompt/activity event の重複は stable event id または content hash で dedupe される。
- [ ] UI 上で、その行が raw evidence、deterministic display text、model-generated summary のどれか区別できる。
- [ ] E2E で、ユーザーが terminal を開かずに「このセッションが何をやっていたか」を prompt/activity history から判断できる。

## スコープ外

- full conversation transcript の表示。
- すべてのセッションに対する常時 LLM/SLM 要約。
- セッションリストの status ordering の置き換え。
- terminal transport、xterm、ttyd、PTY、snapshot の変更。
- Live Feed を session state の source of truth にすること。
- Live Feed 行から長期記憶や knowledge graph を抽出すること。

## コストガードレール

- default path は 0 model calls。
- deterministic extraction を優先する: prompt 抜粋、先頭行、Markdown 見出し、file path、command 名、既存 structured field。
- model summary の cache key は session id、event ids、prompt hash、source timestamp から作る。
- model summary は stale/refresh state を持ち、Live Feed 表示を block しない。
- cached model summary がなくても、raw prompt と structured events だけで役に立つ状態にする。
- background summarization を後で入れる場合は、rate limit、session ごとの cooldown、観測可能な cost counter を必須にする。

## 既存の入力材料

- `server/controllers/session/activity-handlers.js` は `POST /api/sessions/report_activity` で `taskBrief`、`assistantSnippet`、`currentStep`、`latestEvidence`、`eventType`、`turnId`、activity metadata を受け取れる。
- `server/services/session-core/activity-raw-ledger-adapter.js` は、`source_event_id`、`occurred_at`、actor、workspace、project、evidence hash を持つ envelope-only raw ledger record をすでに扱っている。
- `public/modules/app/session-creation-mixin.js` は startup prompt を保持し、terminal に送る前の queue を扱っている。
- `public/modules/domain/live-feed/live-feed-service.js` は現在、activity をセッションごとの現在状態 1 行に縮約している。

## 検証

```bash
vibepro story diagnose . --id story-live-feed-agent-activity-history --run-graphify
vibepro pr prepare . --story-id story-live-feed-agent-activity-history --base origin/develop
```

将来の実装検証では以下を追加する。

```bash
npm run test:run -- tests/unit/live-feed-service.test.js tests/ui/views/live-feed-view.test.js
BRAINBASE_E2E_PORT=31991 npm run test:e2e -- tests/e2e/story-live-feed-agent-activity-history.spec.ts
```
