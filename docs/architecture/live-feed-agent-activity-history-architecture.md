---
architecture_id: live-feed-agent-activity-history-architecture
title: Live Feed エージェント活動履歴アーキテクチャ
story_ref: story-live-feed-agent-activity-history
status: proposed
created_at: 2026-05-24
updated_at: 2026-05-24
---

# Live Feed エージェント活動履歴アーキテクチャ

## 目的

Live Feed は、ユーザーがセッション文脈を思い出し、複数エージェントの活動順序を理解するための面にする。セッションリストの active-session ranking を別表示するだけでは足りない。

難しい点は、作業要約を便利にしながら、モデル利用コストを暴走させないこと。

- まず deterministic data から「何が起きたか」を表示する。
- LLM/SLM summary は core data path ではなく、任意の cached enhancement として扱う。
- 表示される行はすべて source evidence に紐づける。

## 現在の構造

```text
session status / hook status
  -> /api/sessions/status
  -> sessionUi.byId
  -> LiveFeedService
  -> セッションごとの現在状態 1 行
  -> LiveFeedView
```

これは状態監視には有効だが、セッションの履歴を 1 行に潰してしまう。

## 目標構造

```text
user prompt sources
structured activity reports
session metadata / summaries
optional cached model summaries
  -> ActivityHistoryRepository
  -> ActivityHistoryProjector
  -> LiveFeedService history mode
  -> LiveFeedView: single chronological activity timeline + all/session scope filter
```

## データソース

### primary deterministic sources

- `public/modules/app/session-creation-mixin.js` の startup prompt draft / sent prompt flow。
- Brainbase が terminal input 送信前に観測できる user-submitted prompt。
- `POST /api/sessions/report_activity` の structured activity report。
- 既存 `liveActivity` fields:
  - `eventType`
  - `turnId`
  - `activityKind`
  - `taskBrief`
  - `currentStep`
  - `latestEvidence`
  - `assistantSnippet`
  - `reportedAt`
- session state metadata:
  - session id/name
  - project/repo/branch
  - intended state
  - timestamps

### optional model-derived source

- cached summary record は後で追加してよいが、初期表示には必須にしない。
- source event ids と content hashes で key を作る。
- provenance を持つ: model name、generated_at、input hash、cost class、stale state。

## core type

```ts
type ActivityHistoryEvent = {
  id: string;
  sessionId: string;
  occurredAt: number;
  actor: 'user' | 'agent' | 'system';
  kind:
    | 'user_prompt'
    | 'startup_prompt'
    | 'agent_working'
    | 'agent_waiting'
    | 'agent_done'
    | 'agent_blocked'
    | 'task_switch'
    | 'evidence'
    | 'system';
  text: string;
  textSource: 'raw_prompt' | 'structured_field' | 'deterministic_excerpt' | 'model_summary';
  evidenceRef: {
    source: 'session_state' | 'activity_report' | 'terminal_input' | 'cached_summary';
    uri?: string;
    hash?: string;
  };
  dedupeKey: string;
};
```

## コンポーネント

### ActivityHistoryRepository

責務:

- recent session activity events を読む。
- prompt events と structured activity events を merge する。
- stable id または content hash で dedupe する。
- session id 別、全セッション横断の bounded history window を返す。

非責務:

- LLM を呼ばない。
- session truth を所有しない。
- full terminal transcript を default では parse しない。

### ActivityHistoryProjector

責務:

- raw prompt/activity input を表示可能な `ActivityHistoryEvent` に変換する。
- deterministic excerpt を作る:
  - 最初の non-empty prompt line
  - Markdown heading
  - command-oriented prompt の最初の command-like line
  - file path または task id
  - fallback truncated text
- structured status と activity metadata から event kind を分類する。
- provenance と text source を付ける。

非責務:

- 入力にない project facts を推測しない。
- multi-turn context を model で要約しない。

### Optional SummaryCache

責務:

- model summary は明示操作または budget gate の下でのみ保存する。
- event id list、content hashes、source timestamps で cache する。
- stale status と cost metadata を公開する。

trigger policy:

- 明示的なユーザー操作: 「要約する」。
- strict quota つきの低頻度 background job。
- visible raw history が不十分で、budget が許可している cache miss。

禁止:

- polling ごとの summary。
- render ごとの summary。
- status change ごとの全セッション自動 summary。

### LiveFeedService

責務:

- 既存 consumer 向けの compact status rows は維持する。
- history mode として `ActivityHistoryEvent[]` を返す。
- `occurredAt` と deterministic tie-breaker で安定順序にする。
- event id が安定している場合、source text の変化は既存行の更新として扱う。
- heartbeat や `liveActivity.updatedAt` だけの更新を、新しい activity event や group reorder として扱わない。

### LiveFeedView

責務:

- 1 つの mental model に寄せて表示する:
  - all-sessions chronological activity timeline
  - session-focused chronological activity timeline
- default は all-sessions chronological timeline にし、session-focused history は同じ timeline の scope filter として到達可能にする。
- row provenance を短い label で表示する:
  - user prompt
  - agent activity
  - structured evidence
  - generated summary
- generated summary を raw evidence のように見せない。

## コスト戦略

基本ルールは「structured event history first, model summary second」。

default rendering:

```text
0 model calls
bounded local/API reads
deterministic excerpt + structured metadata
```

optional summary:

```text
explicit action または budget-gated background job のみ
source hash で cache
Live Feed を block しない
```

推奨 tier:

1. deterministic excerpt: 常に利用可能、model cost なし。
2. structured rollup: prompt count、latest prompt、latest step、waiting reason、model cost なし。
3. cached model summary: 任意、stale-aware、provenance visible。

## storage strategy

初期実装では既存 state と軽量 append-only record を優先する。

- prompt events は full terminal transcript ではなく小さい envelope として捕捉する。
- activity report は `activity-raw-ledger-adapter.js` で raw-ledger-shaped envelope をすでに作れる。
- UI history の retention は bounded にする。例: session ごと最新 N events、global 最新 M events。
- full prompt text の表示は既存 Brainbase 権限に従う。新しい auth bypass を作らない。

## ordering contract

- `all` mode は `occurredAt desc`、次に stable event id で並べる。
- default view は `getHistoryEntries({ mode: "all" })` を使い、cross-session event order を見せる。
- session-focused view は `getHistoryEntries({ mode: "session", sessionId })` を使い、同じ時系列を対象セッションに絞る。
- `all` mode と `session` mode はどちらも同じ timestamp ordering contract に従う。
- history event が追加されても、既存 status rows はそれだけで reorder しない。
- prompt event と agent event は別 row にする。deterministic turn id がある場合だけ関連付ける。

## privacy and trust contract

- raw prompt は user-authored evidence。
- structured activity fields は agent/runtime-reported evidence。
- model summary は derived interpretation。
- UI はこの 3 種類を区別する。
- generated summary は raw prompt/activity evidence を上書きしない。

## non-goals

- full transcript browser。
- knowledge graph extraction。
- always-on summarization。
- terminal transport changes。
- session list sorting の置き換え。
- Live Feed を state source of truth にすること。

## migration plan

1. Activity history contract の Story/Architecture/Spec を作る。
2. deterministic `ActivityHistoryEvent` projection tests を追加する。
3. terminal behavior を変えずに startup/user prompt envelope を捕捉する。
4. bounded history window API を追加する。
5. all-sessions と session-focused history の Live Feed UI mode を追加する。
6. raw history が有用になってから、任意の cached summary action を追加する。

## verification plan

- deterministic excerpt/classification/dedupe の unit tests。
- bounded history と session filtering の API tests。
- E2E test:
  - ユーザーが複数 session を作成または開く。
  - terminal を開かなくても prompt/activity history が見える。
  - session-focused view で「このセッションが何をやっていたか」が分かる。
  - 通常 render 中に model summary endpoint が呼ばれない。

## evidence

- `server/controllers/session/activity-handlers.js`
- `server/services/session-core/activity-raw-ledger-adapter.js`
- `public/modules/app/session-creation-mixin.js`
- `public/modules/domain/live-feed/live-feed-service.js`
- `public/modules/ui/views/live-feed-view.js`
