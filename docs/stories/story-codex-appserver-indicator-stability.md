---
story_id: story-codex-appserver-indicator-stability
title: Codex App Server activity indicator stability
source_requirement:
  nocodb_table: none
  requirement_id: none
  requirement_title: User-requested VibePro implementation
architecture_docs:
  - path: docs/architecture/codex-appserver-indicator-stability-architecture.md
    status: created
related_tasks:
  - task_source: VibePro
    task_ids: []
status: draft
created_at: 2026-05-25
updated_at: 2026-05-25
---

# story-codex-appserver-indicator-stability: Codex App Server activity indicator stability

## 背景

Brainbase already has a tested `CodexAppServerAdapter` that can receive structured Codex JSON-RPC notifications such as `turn/started` and `turn/completed`. The session list activity indicator, however, is still driven by terminal-oriented hook status updates. That path can be noisy because PTY snapshots, terminal hooks, and fallback turn ids are indirect signals.

## 現状

- `server/services/codex-app-server-adapter.js` can emit structured App Server notifications.
- `server/services/session-core/activity-service-methods.js` is the backend source that converts activity events into `hookStatus`.
- `public/modules/session-indicators.js` receives `/api/sessions/status` and activity WebSocket updates, then updates `sessionUi.byId[sessionId].hookStatus`.
- The existing Codex App Server adapter is backend-only and is not yet connected to the activity indicator state path.

## 変更内容

### 誰が

- Brainbase backend session activity services
- Future Codex App Server-backed session runtimes
- Users watching Codex session activity indicators in the session list

### 何を

- Add a narrow bridge from Codex App Server notifications to Brainbase session activity state.
- Map `turn/started` into a deterministic working indicator with a Codex App Server turn id.
- Map `turn/completed` / task completion notifications into deterministic done-unread indicator state.
- Preserve existing terminal/xterm transport and polling/WebSocket indicator delivery.
- Add focused tests proving App Server notification order updates `hookStatus` without terminal snapshot parsing.

### なぜ

- Codex App Server notifications are structured and turn-id based.
- The indicator can become stable for Codex App Server-backed sessions without scraping terminal text.
- Brainbase can keep terminal transport as fallback while creating a better signal path for Codex-native execution.

## 受け入れ基準

- [ ] A backend bridge can attach to `CodexAppServerAdapter` notification events.
- [ ] `turn/started` marks the target session working with `activeTurnIds` containing the App Server turn id.
- [ ] `turn/completed` clears the matching App Server turn id and marks the session done-unread.
- [ ] Notifications missing a Brainbase session id are ignored without mutating activity state.
- [ ] The bridge emits the same activity WebSocket/polling-compatible `hookStatus` shape as existing activity reports.
- [ ] Existing terminal transport files and xterm client behavior remain unchanged.
- [ ] Capability Map documents that App Server notifications may feed activity indicators when wired.
- [ ] Unit tests cover started/completed/ignored notification paths and current-step labels.

## スコープ外

- Replacing xterm/tmux terminal transport.
- Starting all existing Codex sessions through App Server.
- Persisting Codex App Server threads or item ledgers as a new SSOT.
- Rendering full App Server event timelines in the browser.
- OpenAI API/model behavior changes.

---

**ガードレール**: This story stabilizes the indicator signal path for Codex App Server-backed sessions only. Terminal-backed sessions keep their existing indicator path.
