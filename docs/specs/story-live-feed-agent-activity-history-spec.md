---
spec_id: story-live-feed-agent-activity-history-spec
title: Live Feed エージェント活動履歴 Spec
story_ref: story-live-feed-agent-activity-history
source_story: docs/stories/story-live-feed-agent-activity-history.md
source_architecture: docs/architecture/live-feed-agent-activity-history-architecture.md
status: active
created_at: 2026-05-24
updated_at: 2026-05-24
---

# Live Feed エージェント活動履歴 Spec

## Scope

- `server/services/session-core/activity-service-methods.js`
- `server/controllers/session/worktree-handlers.js`
- `public/modules/domain/live-feed/live-feed-service.js`
- `public/modules/ui/views/live-feed-view.js`
- `tests/server/session-manager.test.js`
- `tests/unit/live-feed-service.test.js`
- `tests/ui/views/live-feed-view.test.js`

## Invariants

- INV-1: Live Feed activity history は通常表示、polling、row update の経路で LLM/SLM を呼ばない。
- INV-2: ユーザー入力履歴は session state 上の bounded envelope として保存し、full terminal transcript を保存しない。
- INV-3: startup prompt と送信確定後の prompt は `activityHistory` の `user_prompt` 系 event として区別できる。
- INV-4: agent activity は `liveActivity`、`taskBrief`、`currentStep`、`latestEvidence`、`assistantSnippet` など既存 structured field から deterministic に投影する。
- INV-5: history event は `id` または `dedupeKey` で重複排除される。
- INV-6: history entries は status entries と別の projection として取得でき、既存の `getEntries()` status timeline contract を壊さない。
- INV-7: UI は raw prompt、deterministic text、structured activity、model summary の source class を区別して表示できる。
- INV-8: model summary は初期実装では生成しない。将来追加する場合も explicit action、cache、budget gate が必要。
- INV-9: worktree session 作成では `!persistedSession` のときだけ初期 `activityHistory` envelope を新規保存し、既存 persisted session の path/worktree 更新や resume flow を壊さない。
- INV-10: state update path は `activityHistory` を許可フィールドに追加するだけで、`sessionIndex === -1 && typeof this.stateStore.reloadFromDisk === 'function'` の reload retry と、retry 後も `sessionIndex === -1` のときの既存 not-found 応答を維持する。
- INV-11: Live Feed のデフォルト UI は all-sessions chronological history projection を使い、セッション別グルーピングを別モードとして表示しない。
- INV-12: session-focused history は同じ chronological view を session scope filter で絞り込む形で到達可能でなければならない。

## Contracts

- C-1: `session.activityHistory` は最大 N 件の小さな event envelope を持つ。
- C-2: user prompt event は `actor: "user"`、`kind: "startup_prompt" | "user_prompt"`、`textSource: "raw_prompt"` を持つ。
- C-3: LiveFeedService は `getHistoryEntries({ mode, sessionId })` を提供する。
- C-4: `mode: "all"` は全セッションを `occurredAt desc`、同値は `id` で安定順に返す。
- C-5: `mode: "session"` は指定 session の履歴を `mode: "all"` と同じ timestamp ordering contract で返す。
- C-6: history entry は `sessionId`、`label`、`timestamp`、`actor`、`kind`、`text`、`textSource`、`evidenceSource`、`provenanceLabel` を持つ。
- C-7: LiveFeedView の default 表示は `getHistoryEntries({ mode: "all" })` を使う。
- C-8: synthetic live activity event の dedupe key は heartbeat timestamp を含めず、semantic kind と source text を基準にする。
- C-9: LiveFeedView は display mode toggle を持たず、全体/セッションの切替は session scope filter で行う。

## Scenarios

- S-1: 初期コマンドつきで worktree session を作成すると、startup prompt が `activityHistory` に保存される。
- S-2: terminal input を確定すると、確定 prompt が `activityHistory` に追加される。
- S-3: LiveFeedService の history projection は startup prompt、user prompt、agent activity を混ぜて返す。
- S-4: 同じ prompt/activity event は重複表示されない。
- S-5: LiveFeedView は activity history を主表示として描画し、prompt source と activity source を区別する。
- S-6: LiveFeedView は session-focused filter で特定 session の履歴を表示できる。
- S-7: persisted session が存在しない `!persistedSession` 分岐で startup prompt を保存するが、既存 persisted session には重複 startup prompt を追加しない。
- S-8: `PATCH /api/state/sessions/:id` は `activityHistory` を部分更新できるが、missing session は reload retry 後も見つからない場合に既存どおり 404 になる。
- S-9: Live Feed を開くと、複数セッションの prompt/activity events が timestamp 順に混ざった一覧として見える。
- S-10: ユーザーが session scope chip を選ぶと、同じ時系列表示が選択セッションの prompt/activity events だけに絞られる。

## Anti-Patterns

- AP-1: Live Feed 表示のたびに LLM/SLM summary を生成する。
- AP-2: raw terminal transcript 全体を Live Feed history として保存または parse する。
- AP-3: Live Feed history を session state の source of truth にする。
- AP-4: 既存 status timeline の stable ordering を history 実装のために壊す。
- AP-5: model summary を raw evidence と同じ見た目で表示する。
- AP-6: default Live Feed をセッション別グループや `updatedAt desc` のセッション状態リストとして描画する。
- AP-7: 全体時系列とセッション絞り込みを別の表示モードとして分断する。

## Verification

- Unit: `npm run test:run -- tests/unit/live-feed-service.test.js`
- View: `npm run test:run -- tests/ui/views/live-feed-view.test.js`
- Server: `npm run test:run -- tests/server/session-manager.test.js`
- Typecheck: `npm run typecheck`
- VibePro: `vibepro story diagnose . --id story-live-feed-agent-activity-history --run-graphify`
