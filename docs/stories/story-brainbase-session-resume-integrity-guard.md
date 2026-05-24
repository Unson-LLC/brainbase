---
story_id: story-brainbase-session-resume-integrity-guard
title: Brainbase session resume integrity guard
source_requirement:
  type: incident_review
  description: Brainbase sessions resumed to subagent logs, stale ttyd ports, archived records, or MCP startup waits after long-running Codex sessions hung.
architecture_docs:
  - path: docs/architecture/terminal-runtime-architecture.md
    status: referenced
    reason: Resume integrity depends on conversation binding, tmux, ttyd, and runtime health classification.
related_tasks:
  - task_source: VibePro
    task_ids: [story-brainbase-session-resume-integrity-guard]
status: active
created_at: 2026-05-24
updated_at: 2026-05-24
---

# Brainbase session resume integrity guard

## Background

Several Brainbase sessions could not be recovered by normal resume even though
their Codex logs still existed. The failures had the same shape:

- `codexThreadId` pointed at a Codex subagent JSONL instead of the user/main
  thread.
- persisted `ttydProcess.port` pointed at a ttyd owned by another session.
- archived session records still had live or stale runtime metadata.
- resume appeared to start but the visible terminal stayed on the wrong history
  or degraded into MCP startup waits.

Brainbase should treat a session as a recoverable work object. Recovery must
bind to the main conversation, validate the terminal transport owner, and expose
stale runtime state as an explicit issue.

## Scope

- Resolve Codex subagent logs to their parent user/main thread before persisting
  `codexThreadId`.
- Preserve rotated/worktree history behavior while preventing subagent logs from
  becoming the session resume source of truth.
- Support both Codex metadata shapes used in local JSONL history:
  `{"type":"session_meta","payload":...}` and `{"session_meta":...}`.
- Detect persisted ttyd pid/port records that no longer belong to the session.
- Keep stale runtime recovery visible to health/reconcile surfaces.
- Prevent both explicit session switching and automatic terminal reconnect from
  reusing stale or wrong-session ttyd proxy URLs.
- Add targeted unit coverage for the incident classes seen on 2026-05-24.

## Acceptance Criteria

- [ ] A latest Codex subagent log updates session summary to the parent main
      thread when the parent JSONL exists.
- [ ] Codex `messageCount` reflects JSONL line count so tiny subagent logs are
      visibly weaker than real main logs.
- [ ] A persisted ttyd port attached to another `/console/<sessionId>` is
      classified as a critical runtime issue for the persisted owner.
- [ ] Duplicate ttyd cleanup still only kills extra ttyd processes for the
      session that actually owns those processes.
- [ ] Existing stale ttyd and pane flood recovery behavior remains intact.
- [ ] Automatic terminal reconnect revalidates unsafe runtime state before
      loading an existing ttyd proxy URL.

## Verification

```bash
vibepro story diagnose . --id story-brainbase-session-resume-integrity-guard --run-graphify
npm test -- tests/server/services/conversation-linker.test.js tests/unit/terminal-runtime-reconciler.test.js
npm run typecheck
vibepro pr prepare . --base origin/develop --story-id story-brainbase-session-resume-integrity-guard
```
