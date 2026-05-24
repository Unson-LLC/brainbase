# Session Hibernation Mutating Smoke

Use this only with a disposable idle Codex session whose runtime ownership is verified by `/api/sessions/runtime/inventory`.

1. Start Brainbase on a non-production test port.
2. Create or select a disposable Codex session.
3. Confirm eligibility:

```bash
curl -s "http://127.0.0.1:31014/api/sessions/<session-id>/hibernate/eligibility"
```

Proceed only when `eligible` is `true`, `ownedProcessCount` is greater than `0`, and all owned process ids are attributed to the target session.

4. Hibernate the session:

```bash
curl -s -X POST "http://127.0.0.1:31014/api/sessions/<session-id>/hibernate" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual-smoke"}'
```

Expected result: `intendedState=hibernated`, `runtimeState=hibernated`, `hibernatedAt` present, restore metadata present, and the owned runtime processes are no longer running.

5. Resume the runtime:

```bash
curl -s -X POST "http://127.0.0.1:31014/api/sessions/<session-id>/resume-runtime" \
  -H 'Content-Type: application/json' \
  -d '{"viewerId":"smoke","viewerLabel":"Smoke"}'
```

Expected result: `intendedState=active`, `runtimeState=hot`, `resumedAt` present, and the terminal runtime is reachable without creating a duplicate worktree.

If no disposable owned Codex runtime is available, record the mutating smoke as not run and keep the read-only API smoke plus unit/E2E evidence separate.
