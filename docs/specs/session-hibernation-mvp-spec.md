---
spec_id: SPEC-session-hibernation-mvp
title: Session Hibernation MVP
status: draft
date: 2026-05-23
story_id: story-session-hibernation-mvp
related_adrs:
  - ADR-session-hibernation-mvp
implementation_files:
  - server/services/session-runtime
  - server/controllers/session/runtime-handlers.js
  - server/controllers/state-controller.js
  - public/modules/app/session-management-mixin.js
test_files:
  - tests/server/session-runtime-inventory.test.js
  - tests/unit/session-list-renderer.test.js
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

Required fields when `runtimeStatus = hibernated`:

- `hibernatedAt`
- `hibernateReason`
- `lastRuntimeSnapshot`
- `runtimeInventorySummary`
- `restoreStrategy`
- `restoreCommand`

Optional fields:

- `codexConversationId`
- `codexThreadId`
- `lastTurnId`
- `appServerThreadStatus`
- `resumeFailureReason`

## Invariants

- **INV-1**: A session with active turn, pending startup, pending input, or active owner input must not be hibernated.
- **INV-2**: Manual hibernation must stop only processes attributed to the target session.
- **INV-3**: Ambiguous or shared processes must be reported and left alive.
- **INV-4**: Hibernation must not remove the session record, worktree, conversation id, or project mapping.
- **INV-5**: A hibernated session must remain visible in the session list.
- **INV-6**: Resume must not create a duplicate worktree or duplicate Brainbase session.
- **INV-7**: Resume failure must move the session to `broken` and preserve recovery metadata.
- **INV-8**: Auto hibernation must be disabled by default until manual hibernate/resume is proven.
- **INV-9**: Auto hibernation must never apply to `running`, `pinned`, pending startup, or actively viewed sessions.
- **INV-10**: App Server-backed history display must not require loading the thread runtime.

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
      "runtimeStatus": "hot",
      "rssBytes": 123,
      "processes": [
        {
          "pid": 123,
          "ppid": 1,
          "category": "codex",
          "rssBytes": 123,
          "command": "codex resume ..."
        }
      ],
      "unattributed": []
    }
  ]
}
```

Rules:

- The endpoint is read-only.
- Unknown process categories must be included as `unknown_child`.
- The endpoint must not infer eligibility by RSS alone.

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
- Must update session runtime status to `hibernated`.
- Must return process stop summary.

### Contract-4: Manual Resume

```http
POST /api/sessions/:id/resume-runtime
```

Rules:

- Must only apply to `hibernated` or `broken` sessions.
- Must use existing terminal/Codex resume path in Phase 2.
- Must not create a new worktree.
- Must set status to `hot` or `running` when ready.
- Must set status to `broken` if restore fails.

### Contract-5: Auto Hibernate

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

### Contract-6: App Server Loaded/NotLoaded

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
