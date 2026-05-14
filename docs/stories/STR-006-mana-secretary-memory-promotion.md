---
story_id: STR-006
title: manaをBrainbase横断秘書として動かすMemory Promotion Pipeline
source_requirement:
  requirement_title: "Brainbase terminalでもSlack上のmanaと同じ会社文脈を引き継ぐ秘書体験"
architecture_docs:
  - path: docs/architecture/mana-secretary-memory-promotion-architecture.md
    status: created
spec_docs:
  - path: docs/specs/mana-secretary-memory-promotion-spec.md
    status: created
related_tasks:
  - task_source: NocoDB タスク管理
    task_ids: []
status: draft
created_at: 2026-05-08
updated_at: 2026-05-08
---

# STR-006: manaをBrainbase横断秘書として動かすMemory Promotion Pipeline

## 背景

Brainbase の terminal/session activity と、mana が Slack / workflow / message history で扱う活動は、どちらも会社の実行文脈である。現状はそれぞれの場所で文脈が閉じやすく、Brainbase で作業する時に Slack 上の mana 文脈が自然に引き継がれない。

一方で、すべての会話や activity を組織Graphへ直接入れると、個人の未確定思考、GM権限の文脈、project文脈、channel文脈が混ざり、セキュリティと正本性が崩れる。

## 現状

- Brainbase は session activity を受け取り、working/done/status をUIへ反映できる。
- mana は Slack event / Lambda / GitHub Actions / DynamoDB message history を持つ。
- mana は Brainbase Graph を読む `GraphContextClient` を持つ。
- mana の working memory は user/resource 単位の設計があるが、現在の workspace agent では無効化されている。
- Brainbase Graph は固有名詞、関係、判断、進行状態のSSOTである。

## 変更内容

### 誰が

- 佐藤個人として Brainbase terminal を使うユーザー
- 雲孫GMとして Brainbase / mana を使うユーザー
- project owner / PM / GM / CEO として記憶昇格を承認する owner

### 何を

- Brainbase activity と mana activity を、共通contractの Raw Ledger read model として扱う。
- Dreaming が activity を memory candidate に変換する。
- Promotion Gate が owner / scope / sensitivity / role_min を判定し、必要な承認を要求する。
- 承認済みの業務記憶だけを Brainbase Graph SSOT へ昇格する。
- Brainbase terminal と Slack mana は、同じ Graph SSOT と scope別 memory context から回答する。

### なぜ

- Brainbase でも Slack でも、mana が同じ会社文脈を見ている体験を作るため。
- ただし、個人秘書、GM秘書、project秘書の記憶を混ぜず、越権しないため。
- raw transcript を成果物にせず、判断、依頼、次アクション、関係、学習として正本化するため。

## 成功指標

- [ ] deny-by-default retrieval test が、佐藤個人、雲孫GM、project member、Slack channel外ユーザー、role失効ユーザーの5文脈で通る。
- [ ] 承認済みcandidateだけがGraph SSOTへ昇格し、pending / rejected / expired candidate はGraph entityとして返らない。
- [ ] Brainbase terminal と Slack mana で同じ質問をしても、person / role / project / workspace / channel / sensitivity に応じたmemory差分が再現できる。
- [ ] Raw Ledger evidence から promoted memory まで `evidence_ref` と `source_event_ids` を追跡できる。

## First Slice (Phase 1: Brainbase + mana)

- Brainbase: Raw Ledger adapter、Memory Candidate Store、Promotion Gate、approved-only Graph writer、terminal scoped retrieval のcontract testを通す。
- mana: Slack / workflow history をRaw Ledger-compatible envelopeへ変換し、Brainbase Promotion Gateへcandidate draftを送れるところまでを対象にする。
- cross-repo: 同じfixtureでBrainbase/mana双方のcontract testを通し、両repoのVibePro/Graphify runを同じ `story_key` に紐づける。
- 2026-W19では「全Slack履歴の投入」や「全種類のGraph昇格」ではなく、private preference 1件と project-visible memory 1件の昇格を完了境界にする。

## Silo dissolution scope (Phase 2 以降の前提)

ADR-010 で `candidate-store` を canonical Memory Promotion Kernel と確定した以上、 **mana 以外のソースも別 promotion 系を持ってはならない**。 現存する silo 系 (= repo 内 JSON / 別 DB に学習履歴を閉じている系) は順次 kernel adapter へ移行する。

| Silo 系 | 状態 | 備考 |
|---|---|---|
| `Unson-LLC/salestailor` の `ops-department-auto-refactoring` (3-hourly + daily-medium) | ✅ **retired 2026-05-14** | salestailor PR #1764 (cron stop) + PR #1766 (silo 全削除)。 関連 sub-story `story-salestailor-ops-refactor-kernel-adapter` は **superseded** 扱い。 「使っていない silo は adapter 化せず削除」 の判断 |
| (今後の候補) **AI セッションログ (codex + claude)** | TBD | `~/.codex/sessions/*.jsonl` + `~/.claude/projects/*.jsonl` = 毎日生成される最も濃密な活動文脈。 真の forcing function 候補。 別 story 起票予定 |
| (今後の候補) mana legacy `learning_episodes` / `m9-weekly-milestone` | TBD | 既に毎日動いている silo。 STR-006 First Slice の延長で吸収予定 |
| (今後の候補) zeims / techknight / SNS feedback ledger | TBD | 発見次第 sub-story 起票 |

silo dissolution の前提として、 brainbase 側に **cross-repo write API** が必要。 これは [story-candidate-store-cross-repo-write](./story-candidate-store-cross-repo-write.md) で **2026-05-14 に確立済** (PR #726、 `POST /api/candidate-store/raw-ledger`)。

## サブストーリーと依存関係

```
STR-006 (umbrella)
├─ Phase 1 First Slice (本 story 内): brainbase Raw Ledger + Promotion Gate + mana cross-repo emit
├─ story-candidate-store-cross-repo-write  ✅ closed 2026-05-14 (PR #726)
└─ (新規候補) AI セッションログ adapter / mana legacy / 他 silo 統合
   ↑ ops-refactor adapter story は superseded (対象不在)
```

各 sub-story は同じ `story_key`/`source_story` で結ぶ。 全 silo の kernel 統合が完了したら 「組織学習が単一経路に統一された」 という STR-006 の真の完了境界に到達する。

## 受け入れ基準

- [ ] Brainbase activity と mana message/workflow history は、物理的に1つのDBへ集約しなくても、共通の Raw Ledger read model として読める。
- [ ] Brainbase は session / terminal / activity を Raw Ledger read model へ変換する adapter を持つ。
- [ ] Brainbase は memory candidate の保存、承認待ち一覧、approve/reject/expire、audit log を扱う Promotion Gate API または service を持つ。
- [ ] Brainbase は承認済みcandidateだけを Graph SSOT へ反映し、未承認candidateをGraph entityとして扱わない。
- [ ] Brainbase terminal は assistant context 注入前に、person / role / project / session / sensitivity による memory access policy を評価する。
- [ ] Brainbase UI は owner が自分に割り当てられた memory candidate を確認し、昇格・却下できる導線を持つ。
- [ ] Raw Ledger record は `source_system`, `source_event_id`, `occurred_at`, `captured_at`, `actor_external_id`, `actor_person_id`, `workspace`, `channel_id`, `project_code`, `permission_snapshot`, `evidence_ref`, `retention_policy` を持つ。
- [ ] memory candidate は `owner_person_id`, `actor_person_id`, `source_system`, `source_event_ids`, `workspace`, `channel_id`, `project_code`, `subject_type`, `subject_id`, `visibility`, `role_min`, `sensitivity`, `permission_snapshot`, `evidence_ids`, `expires_at`, `redaction_status` を持つ。
- [ ] private / low-risk preference は本人scopeへ自動昇格できる。
- [ ] project / org / customer / push_case / policy / philosophy へ昇格する候補は、owner承認なしにGraph SSOTへ入らない。
- [ ] Promotion Gate は `candidate -> pending_approval -> approved|rejected|expired -> promoted` の状態と、承認者・理由・時刻をaudit logとして残す。
- [ ] Dreaming は raw evidence を直接Graphへ書かず、非同期jobでcandidate draftだけを生成する。
- [ ] Brainbase terminal の assistant context は、ログインユーザー、role、project、sessionから読み出し可能memoryを決定する。
- [ ] Slack mana の assistant context は、workspace、channel、user、projectから読み出し可能memoryを決定する。
- [ ] 同じ質問でも、佐藤個人、雲孫GM、project member で参照memoryが分離される。
- [ ] Slack channel外ユーザー、権限失効後のユーザー、project外ユーザーには deny-by-default でmemoryが返らない。
- [ ] Graphへ昇格する `subject_type` は、既存Brainbase Graph typeへ写像できない限り新規typeを増やさない。
- [ ] Graphifyは正本ではなく、candidate同士の関連抽出、矛盾検出、昇格impact reviewの補助として使われる。
- [ ] cross-repo変更時は、Brainbaseをcoordination storyの正本repo、manaをimplementation participant repoとして扱い、両repoのVibePro/Graphify証跡が1つのstory_keyに紐づく。

## スコープ外

- 新規専用GraphDBの導入
- Graphify artifact の正本化
- mana人格・口調の全面再設計
- 全Slack履歴の無差別なGraph投入
- HR/finance/contract memory の自動昇格

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・現状・変更内容・受け入れ基準のみ。
