---
adr_id: ADR-codex-appserver-indicator-stability
title: Codex App Server activity indicator bridge
source_story:
  story_id: story-codex-appserver-indicator-stability
  story_path: docs/stories/story-codex-appserver-indicator-stability.md
status: proposed
created_at: 2026-05-25
updated_at: 2026-05-25
---

# ADR-codex-appserver-indicator-stability: Codex App Server activity indicator bridge

## ステータス

Proposed

## コンテキスト

Brainbase currently derives activity indicators from `hookStatus`. Browser code already treats `sessionUi.byId[sessionId].hookStatus` as the single source for row indicators and ordering. The backend `activityService.reportActivity()` updates that status, persists it, and broadcasts it to clients through the activity WebSocket.

Codex App Server provides structured notifications with thread and turn concepts. These notifications should enter the existing `activityService.reportActivity()` path instead of creating a second indicator state model.

## 判定

### 既存アーキテクチャで対応可能か

- [x] はい -> Add a backend bridge service that translates Codex App Server notifications into existing session activity reports.
- [ ] いいえ -> Not needed for this story.

## 判断

### レイヤー / 境界

- `server/services/codex-app-server-activity-bridge.js` owns notification-to-activity translation only.
- `server/services/codex-app-server-adapter.js` remains the JSON-RPC transport boundary.
- `server/services/session-core/activity-service-methods.js` remains the `hookStatus` state owner.
- `public/modules/session-indicators.js` remains the browser delivery consumer.
- Terminal transport remains unchanged and can continue reporting activity for terminal-backed sessions.

### データ層

- No new persistent data model is introduced.
- The bridge requires a Brainbase `sessionId` from notification params or constructor context.
- App Server `turn.id` becomes the `turnId` in `hookStatus.activeTurnIds`.
- Activity state is persisted through the existing `hookStatus` field on sessions.

### 制約

- Do not infer session identity from terminal text.
- Do not mutate Graph SSOT or create a Codex event ledger in this story.
- Missing session identity must be ignored and surfaced as an ignored result in tests.
- The bridge must be detachable so tests and future runtime owners can clean up listeners.

## 代替案

- Parse terminal output more carefully: rejected because it keeps the indicator dependent on rendered text.
- Add a browser-only App Server event store: rejected because activity state already has a backend SSOT and WebSocket delivery path.
- Replace all Codex runtime startup with App Server now: rejected because this story is indicator stability, not runtime migration.

## 影響

- Future App Server-backed Codex sessions can produce stable indicators by wiring adapter notifications to the bridge.
- Existing terminal-backed sessions are not disrupted.
- Tests can validate activity transitions without launching a real Codex process.

---

**ガードレール**: The bridge feeds the existing activity state path; it does not create a competing UI state model.
