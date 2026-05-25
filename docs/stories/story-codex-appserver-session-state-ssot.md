---
story_id: story-codex-appserver-session-state-ssot
title: Codex App Server session state SSOT
source_requirement:
  nocodb_table: none
  requirement_id: none
  requirement_title: User-requested VibePro story
architecture_docs:
  - path: docs/architecture/codex-appserver-session-state-ssot-architecture.md
    status: created
related_tasks:
  - task_source: VibePro
    task_ids: []
status: draft
created_at: 2026-05-25
updated_at: 2026-05-25
---

# story-codex-appserver-session-state-ssot: Codex App Server session state SSOT

## 背景

Brainbase now has a tested Codex App Server adapter and a narrow App Server activity bridge. The bridge can translate structured `turn/started` and `turn/completed` notifications into the existing `hookStatus` indicator path, but Brainbase still does not define where Codex App Server thread and turn identity belongs in session state.

Without that contract, later App Server wiring can accidentally mix terminal-derived Codex resume ids, App Server thread ids, browser-only state, and persistent session metadata. The next phase needs a Brainbase session-state source of truth before App Server becomes a real Codex execution path.

## 現状

- `server/services/codex-app-server-adapter.js` owns the JSON-RPC stdio adapter boundary.
- `server/services/codex-app-server-activity-bridge.js` maps App Server notifications into `activityService.reportActivity()`.
- `docs/brainbase-capabilities/capabilities/codex.app-server.yml` explicitly says Codex threads and turns must not be persisted until a separate session-state story defines the SSOT.
- Existing Codex and Claude Code sessions still use the shared terminal/xterm runtime path.
- Claude Code has its own resume identity and terminal behavior. This story must not change Claude Code startup, resume, xterm, or terminal transport contracts.

## 変更内容

### 誰が

- Brainbase backend session/runtime services
- Codex App Server-backed session execution
- Users who expect Codex session restore and activity state to survive runtime restarts

### 何を

- Define the session-state contract for Codex App Server thread, turn, and lifecycle identity.
- Persist only Codex App Server metadata that is required to resume or reconcile a Brainbase Codex session.
- Keep App Server event items in memory unless this story explicitly defines a durable event ledger.
- Wire App Server metadata only for sessions whose `engine` is `codex`.
- Preserve Claude Code session creation, resume ids, terminal/xterm transport, and hook/activity behavior.
- Add verification that Codex-only wiring cannot mutate Claude Code session state.

### なぜ

- Codex App Server provides structured thread and turn identifiers that are more reliable than terminal text.
- Brainbase needs one durable location for App Server identity before it can make Codex App Server the primary Codex runtime path.
- The engine boundary must stay explicit so Codex App Server migration does not regress Claude Code workflows.

## 受け入れ基準

- [ ] A Codex session can store an App Server thread id in session state using a named field with a documented owner.
- [ ] A Codex session can associate the active App Server turn id with existing activity state without inventing a browser-only SSOT.
- [ ] Runtime restore for `engine: codex` can choose App Server resume metadata without changing Claude Code restore behavior.
- [ ] Claude Code sessions cannot receive Codex App Server thread, turn, or resume metadata through this path.
- [ ] Missing or stale App Server metadata produces an explicit fallback or recovery state instead of silently starting an unrelated thread.
- [ ] App Server event item persistence is either explicitly out of scope or defined as a separate ledger with ownership and retention rules.
- [ ] Existing xterm/tmux terminal transport files remain unchanged unless a separate terminal story approves that work.
- [ ] Capability Map documents the new session-state boundary and the Codex-only visibility rule.
- [ ] Unit or contract tests cover Codex session metadata persistence, Codex restore selection, Claude Code non-mutation, and stale metadata handling.

## スコープ外

- Replacing Claude Code execution or resume behavior.
- Changing shared terminal/xterm transport behavior.
- Persisting every App Server event item without a ledger contract.
- Writing App Server events directly into Graph SSOT.
- Exposing remote WebSocket App Server transport.
- Changing OpenAI model selection, auth policy, or approval UX.

---

**ガードレール**: This story changes the Codex App Server session-state path only. Any shared runtime code touched by implementation must prove that `engine: claude` behavior is unchanged.
