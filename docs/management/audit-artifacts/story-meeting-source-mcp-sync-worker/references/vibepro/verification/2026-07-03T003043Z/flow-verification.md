# Flow Verification

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-03T003043Z |
| Story ID | story-meeting-source-mcp-sync-worker |
| Status | needs_evidence |
| Base URL | http://localhost:39137 |
| HTTP Auth | disabled |
| Reason | No runtime probes were configured for Flow Verification. |

## Summary

- pass: 0
- fail: 0
- skipped: 0
- needs_setup: 0
- runtime_contract_failures: 0

## Probes

- なし

## Setup

- `Add `flow_design.runtime_probes[]` to `.vibepro/config.json` with at least one non-mutating probe for the changed workflow.`
- `vibepro verify flow . --base-url <url> --id story-meeting-source-mcp-sync-worker`

## Runtime Contract Failures

- なし

## Warnings

- managed_worktree_locality: no managed worktree execution state is recorded for this checkout; run vibepro execute start before managed worktree protected commands
