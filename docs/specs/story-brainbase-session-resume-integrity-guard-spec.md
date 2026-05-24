# Spec: Brainbase session resume integrity guard

## Invariants

- INV-1: Brainbase session `codexThreadId` must identify a user/main Codex
  thread, not a subagent thread, when the parent thread is available.
- INV-2: Codex subagent JSONL files remain visible as related history, but they
  cannot replace the parent thread as the resume source of truth.
- INV-3: Persisted `ttydProcess` metadata is valid only when an observed ttyd
  process for the same `/console/<sessionId>` exists.
- INV-4: A ttyd process observed on the persisted port for a different session
  is a port ownership conflict, not a usable runtime.

## Contracts

- CON-1: `ConversationLinker` reads Codex session metadata from `session_meta`
  and records `thread_source`, `agent_role`, and parent thread id when present.
- CON-1a: `ConversationLinker` accepts both observed Codex JSONL metadata
  shapes: `type: "session_meta"` with `payload`, and top-level
  `session_meta`.
- CON-2: If the latest Codex candidate is `thread_source: subagent` and its
  parent JSONL is indexed, `lastConversation` and `codexThreadId` are resolved
  to the parent conversation.
- CON-3: Codex conversation summaries include JSONL line count as
  `messageCount`.
- CON-4: `TerminalRuntimeReconciler` compares persisted ttyd pid/port against
  observed ttyd processes. A port owned by another `/console/<sessionId>` yields
  `ttyd_port_conflict`.
- CON-5: `ttyd_port_conflict` is critical and takes precedence over snapshot
  only status because the UI would otherwise route to the wrong terminal.
- CON-6: Client reconnect paths must not reuse `proxyPath` values from runtime
  status that carries `stale_ttyd_process` or `ttyd_port_conflict`; they must
  re-query runtime state and route unsafe status through terminal recovery.

## Scenarios

- S-1: A VibePro session's newest JSONL is a 4-line subagent. The parent user
  thread has the real history. Linker persists the parent resume id.
- S-2: A Brainbase session's stored port points at another session's ttyd after
  a server restart. Health shows degraded with `ttyd_port_conflict`.
- S-3: A session has a persisted ttyd marker but no observed ttyd at all.
  Existing `stale_ttyd_process` behavior remains unchanged.
- S-4: A Codex JSONL uses top-level `session_meta`. Linker extracts the same
  cwd, resume id, and parent metadata as the `type/payload` shape.

## Anti-patterns

- AP-1: Choosing "latest mtime wins" when that latest file is a spawned
  subagent transcript.
- AP-2: Trusting persisted ttyd pid/port without validating `/console/<id>`.
- AP-3: Treating archived or stale runtime state as input-ready merely because
  a ttyd process is listening on the same port.
- AP-4: Fixing only the explicit session switch path while leaving automatic
  reconnect to reuse stale or wrong-session ttyd URLs.

## Verification

- V-1: `npm test -- tests/server/services/conversation-linker.test.js`
- V-2: `npm test -- tests/unit/terminal-runtime-reconciler.test.js`
- V-3: `npm run typecheck`
- V-4: `vibepro pr prepare . --base origin/develop --story-id story-brainbase-session-resume-integrity-guard`
