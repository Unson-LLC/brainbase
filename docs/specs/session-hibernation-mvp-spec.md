---
spec_id: SPEC-session-hibernation-mvp
title: Session Hibernation MVP
status: draft
date: 2026-05-23
story_id: story-session-hibernation-mvp
related_adrs:
  - docs/architecture/session-hibernation-mvp-architecture.md
  - docs/architecture/ADR-012-session-hibernation-runtime-lifecycle.md
implementation_files:
  - server/services/session-runtime
  - server/controllers/session/runtime-handlers.js
  - server/controllers/state-controller.js
  - server/routes/sessions.js
  - public/modules/domain/session/session-service.js
  - public/modules/app/session-management-mixin.js
  - public/modules/session-list-renderer.js
  - public/modules/ui/views/session-view.js
test_files:
  - tests/server/session-runtime-inventory.test.js
  - tests/unit/session-list-renderer.test.js
  - tests/unit/session-service-hibernation.test.js
  - tests/e2e/story-session-hibernation-mvp-phase1.spec.ts
---

# SPEC: Session Hibernation MVP

## Purpose

Reduce Brainbase memory pressure by allowing idle hidden Codex sessions to release runtime processes while preserving session identity, restore metadata, and user-visible history.

## Entities

### SessionRuntimeState

Allowed values:

- `hot`
- `running`
- `idle`
- `hibernated`
- `broken`

### RuntimeProcessCategory

Allowed values:

- `codex`
- `codex_app_server`
- `pty_shim`
- `tmux`
- `ttyd`
- `mcp`
- `unknown_child`

### HibernationMetadata

Required fields when persisted `runtimeState = hibernated`:

- `hibernatedAt`
- `hibernateReason`
- `runtimeInventorySummary`
- `restoreStrategy`
- `restoreCommand`

Optional fields:

- `codexConversationId`
- `codexThreadId`
- `lastRuntimeSnapshot` (required when terminal snapshot capture is available; otherwise persist `null`)
- `lastTurnId`
- `appServerThreadStatus`
- `resumeFailureReason`

## Invariants

- **INV-1**: A session with active turn, pending startup, pending input, or active owner input must not be hibernated.
- **INV-2**: Manual hibernation must stop only processes attributed to the target session.
- **INV-3**: Phase 2 manual hibernation applies only to Codex sessions with restore metadata. Other engines remain ineligible until their restore contract is specified.
- **INV-4**: Ambiguous or shared processes must be reported and left alive.
- **INV-5**: Hibernation must not remove the session record, worktree, conversation id, or project mapping.
- **INV-6**: A hibernated session must remain visible in the session list.
- **INV-7**: Resume must not create a duplicate worktree or duplicate Brainbase session.
- **INV-8**: Resume failure must move the session to `broken` and preserve recovery metadata.
- **INV-9**: Auto hibernation must be disabled by default until manual hibernate/resume is proven.
- **INV-10**: Auto hibernation must never apply to `running`, `pinned`, pending startup, or actively viewed sessions.
- **INV-11**: App Server-backed history display must not require loading the thread runtime.
- **INV-12**: Server runtime handlers are the source of truth for hibernation/resume state; clients must not re-persist lifecycle state with a second generic state patch after a lifecycle API succeeds.
- **INV-13**: Lifecycle API error enrichment must preserve the existing `HttpClient` authentication behavior; configured auth tokens continue to populate `Authorization` when the caller did not supply one.

## Contracts

### Contract-1: Runtime Inventory

```http
GET /api/sessions/runtime/inventory
```

Returns:

```json
{
  "sessions": [
    {
      "sessionId": "session-...",
      "runtimePresence": "hot",
      "rssKb": 123,
      "processCount": 1,
      "processesByCategory": {
        "codex": 1,
        "codex_app_server": 0,
        "pty_shim": 0,
        "tmux": 0,
        "ttyd": 0,
        "mcp": 0,
        "unknown_child": 0
      },
      "processes": [
        {
          "pid": 123,
          "ppid": 1,
          "category": "codex",
          "rssKb": 123,
          "attribution": "command",
          "command": "codex resume ..."
        }
      ]
    }
  ],
  "unattributed": []
}
```

Rules:

- The endpoint is read-only.
- Unknown process categories must be included as `unknown_child`.
- Unmatched or ambiguous processes must be visible in top-level `unattributed`.
- The endpoint must not infer eligibility by RSS alone.
- Phase 1.5 eligibility is API/diagnostics-only; the user-facing hibernate action and blocker remediation UX begin in Phase 2.

### Contract-2: Hibernation Eligibility

```http
GET /api/sessions/:id/hibernate/eligibility
```

Returns:

```json
{
  "eligible": true,
  "reasons": [],
  "blockers": []
}
```

Blocking reasons:

- `active_turn`
- `pending_startup`
- `pending_input`
- `active_owner`
- `pinned`
- `unsupported_engine`
- `inactive_session_state`
- `weak_process_ownership`
- `missing_restore_metadata`
- `unknown_process_ownership`

### Contract-3: Manual Hibernate

```http
POST /api/sessions/:id/hibernate
```

Rules:

- Must run eligibility check first.
- Must capture final snapshot when terminal snapshot is available.
- Must stop session-owned runtime processes.
- Must update session `intendedState` and persisted `runtimeState` to `hibernated`.
- Must return process stop summary.

### Contract-4: Manual Resume

```http
POST /api/sessions/:id/resume-runtime
```

Rules:

- Must only apply to `hibernated` or `broken` sessions.
- Must use existing terminal/Codex resume path in Phase 2.
- Must reject sessions whose engine or metadata do not satisfy the Phase 2 Codex restore contract.
- Must not create a new worktree.
- Must set session `intendedState` to `active` and persisted `runtimeState` to `hot` when ready.
- Must set session `intendedState` and persisted `runtimeState` to `broken` if restore fails.

### Contract-5: Lifecycle HTTP Errors

Rules:

- Hibernation and resume errors may expose structured response fields such as `blockers`, `intendedState`, `runtimeState`, and `resumeFailureReason` to the client.
- Structured error propagation must not bypass or change the existing auth-token branch in `HttpClient`; if no `Authorization` header is provided and an auth token exists, the client still injects it.

### Contract-6: Auto Hibernate

Auto hibernation is Phase 3 only.

Inputs:

- last visible time
- runtime status
- pin status
- active owner status
- active turn status
- pending startup status
- hot session budget

Rules:

- Must be globally disableable.
- Must log decisions with reason codes.
- Must prefer least-recently-visible idle sessions.

### Contract-7: App Server Loaded/NotLoaded

Phase 4 only.

Rules:

- Use App Server `thread/read` to display stored thread metadata without resuming.
- Use App Server `thread/resume` for explicit resume.
- Use App Server `thread/loaded/list` to reconcile loaded threads.
- Use App Server `thread/unsubscribe` when UI no longer needs live events.
- Preserve terminal compatibility path until App Server rendering is stable.

## Phase Acceptance Criteria

### Phase 1

- [ ] Inventory endpoint returns per-session RSS and process categories.
- [ ] UI or diagnostics surface shows session memory posture.
- [ ] No lifecycle mutation happens in inventory-only mode.

### Phase 1.5

- [ ] Inventory attributes child processes through a uniquely matched session parent.
- [ ] `GET /api/sessions/:id/hibernate/eligibility` returns read-only blocker reasons.
- [ ] Unknown or ambiguous process ownership blocks hibernation eligibility.
- [ ] Eligibility does not stop processes or mutate session state.
- [ ] Eligibility is not represented as a completed user-facing control before Phase 2.

### Phase 2

- [ ] Eligible idle session can be manually hibernated.
- [ ] Ineligible session returns explicit blocker reasons.
- [ ] Hibernated session can be resumed.
- [ ] Resume failure is visible and recoverable.

### Phase 3

- [ ] Auto hibernation can be enabled behind a feature flag.
- [ ] Hot session budget is enforced only for eligible idle sessions.
- [ ] User can pin sessions to prevent auto hibernate.

### Phase 4

- [ ] Brainbase can read App Server thread history without loading runtime.
- [ ] Brainbase can resume App Server thread runtime intentionally.
- [ ] Brainbase session status reflects App Server loaded/notLoaded status.

## Verification

```bash
npm test -- tests/server/session-runtime-inventory.test.js
npm test -- tests/unit/session-list-renderer.test.js
npm run typecheck
BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-session-hibernation-mvp-phase1.spec.ts --project=chromium
curl -s http://127.0.0.1:31013/api/version | jq '.runtime'
```

Expected:

- Hibernation never stops ineligible sessions.
- Hibernation releases session-owned runtime processes.
- Resume does not duplicate worktrees.
- UI reports hibernated/broken states clearly.
- Existing terminal transport tests continue to pass.

## Performance Evidence

Use VibePro performance metrics before and after each phase:

- `session_runtime_rss_total`: total RSS for session-owned runtime processes.
- `hibernate_released_rss`: RSS released by hibernating one session.
- `resume_runtime_ready_ms`: time from resume action to terminal input ready.
- `hot_session_count`: number of sessions with live runtime processes.

Performance improvement must not be claimed from server logs alone. Record user-perceived resume readiness separately from backend process cleanup.
