---
adr_id: ADR-codex-app-server-adapter
title: Codex App Server adapter boundary
source_story:
  story_id: story-codex-app-server-adapter
  story_path: docs/stories/story-codex-app-server-adapter.md
status: proposed
created_at: 2026-05-22
updated_at: 2026-05-22
---

# ADR-codex-app-server-adapter: Codex App Server adapter boundary

## ステータス

Proposed

## コンテキスト

Brainbase currently operates Codex through terminal-oriented runtime services. This is necessary for the existing UI, but terminal text is a lossy integration boundary. Codex App Server offers a structured protocol with threads, turns, items, approvals, command execution, and notifications.

The first slice needs a narrow adapter that can be tested without starting a real Codex process. It should establish the runtime boundary and leave UI/session replacement decisions for later stories.

## 判定

### 既存アーキテクチャで対応可能か

- [x] はい -> Add a backend service module under `server/services/` and keep existing session and terminal services untouched.
- [ ] いいえ -> Not needed for this first slice.

## 判断

### レイヤー / 境界

- `server/services/codex-app-server-adapter.js` owns the child process, stdio JSONL transport, JSON-RPC request ids, pending request lifecycle, and notification emission.
- Existing terminal transport remains the terminal runtime path.
- Session creation integration is deferred until the adapter contract is stable.
- UI rendering of App Server events is deferred until Brainbase has a state model for Codex-native sessions.

### データ層

- The adapter does not create a new SSOT.
- In this slice, App Server events are in-memory runtime events.
- Future persistence should map Codex `threadId`, `turnId`, items, approvals, file changes, and command runs into Brainbase session state or a dedicated event ledger.
- Graph SSOT remains the source of truth for canonical projects, people, decisions, and operating philosophy.

### 制約

- Use stdio transport first because OpenAI documents it as the default App Server transport.
- Do not use the experimental WebSocket listener for the first slice.
- Do not pass raw secrets or auth tokens on the command line.
- Do not couple this adapter to xterm rendering or tmux snapshots.

## 代替案

- Continue scraping terminal output: rejected because it keeps Brainbase dependent on rendered text and PTY behavior for structured state.
- Use Codex SDK instead: rejected for this story because OpenAI positions App Server for rich product integrations and SDK for automation/CI jobs.
- Start with WebSocket transport: rejected because OpenAI labels it experimental/unsupported and warns about auth for non-loopback exposure.

## 影響

- Adds a new backend integration boundary without changing the current terminal path.
- Gives future stories a tested seam for Codex-native session creation, approvals, diffs, and event-ledger integration.
- Requires a new Capability Map entry so agents can locate the adapter, tests, and failure modes.

---

**ガードレール**: This ADR defines boundaries only. It does not approve replacing existing terminal transport in this story.
