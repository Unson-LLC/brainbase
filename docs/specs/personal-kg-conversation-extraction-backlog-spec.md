# Personal KG Conversation Extraction Backlog Spec

Story: `story-personal-kg-extraction-backlog`
Date: 2026-06-04

## Purpose

Turn undifferentiated raw conversation `needs_extraction` inventory into a date-scoped Personal KG extraction backlog that can be reviewed before write execution.

## Contracts

### Traceability

- `INV-001` (ac:1): The backlog reports raw log file count separately from date count, input message count, adopted candidate count, existing candidate count, missing candidate count, and `needs_review` candidate count.
- `INV-002` (ac:2): The backlog output must not include raw conversation message text or candidate body text in JSON or default text stdout.
- `INV-003` (ac:3): Local SSOT additive upsert must continue skipping raw conversation log items with status `needs_extraction`.
- `INV-004` (ac:4): Server comparison must be read-only and compare deterministic `memory_candidates` source refs rather than Graph promotion state.
- `INV-005` (ac:5): Existing local SSOT inventory classification branches for Graph and Wiki material must remain unchanged, including `common/meta/customers` mapping to `target_type=customer`.
- `S-001` (ac:6): Given local Codex and Claude Code logs across a JST date range, the CLI should group eligible user messages by date and return candidate rule statuses without requiring a UI route.

### CLI

Command:

```bash
npm run oyasumi:conversation-personal-kg:backlog -- --from YYYY-MM-DD --to YYYY-MM-DD --json
```

Optional server comparison:

```bash
INFO_SSOT_DATABASE_URL="$INFO_SSOT_DATABASE_URL" npm run oyasumi:conversation-personal-kg:backlog -- --compare-server --json
```

### Output

The CLI returns:

- `raw_log_file_count`
- `raw_log_source_kinds.codex_history`
- `raw_log_source_kinds.claude_code_project_log`
- `summary.dates_considered`
- `summary.input_messages`
- `summary.adopted_candidates`
- `summary.existing_candidates`
- `summary.missing_candidates`
- `summary.needs_review_candidates`
- `dates[].status`
- `dates[].candidate_rules[]`

The CLI must not return raw user message text or candidate body text.

### Status

- `no_input`: no eligible user messages for that JST date.
- `no_candidate`: eligible messages exist but no deterministic rule adopted a candidate.
- `needs_write`: at least one expected candidate source ref is missing server-side.
- `completed`: all expected candidate source refs already exist server-side or no server comparison is needed and no missing refs are detected.

## Data Rules

- Raw conversation logs remain secondary material.
- `memory_candidates` remains the Personal KG core SSOT.
- The planner compares deterministic `codex-claude-conversation:<date>#<layer>:<rule>` refs.
- Server comparison is read-only.
- No Graph mutation, no wiki mutation, and no NocoDB mutation are allowed in this story.
- Existing local SSOT inventory classification branches for Graph/Wiki material remain unchanged. In particular, `common/meta/customers` continues to classify as `target_type=customer`; the only inventory change is exporting the existing conversation-log collector.

## Verification

- Unit test `INV-001` / `INV-002` / `INV-004`: backlog groups messages by JST date, compares expected source refs, and omits raw conversation text.
- Existing unit tests `INV-003` / `INV-005`: local SSOT inventory/upsert still preserve `needs_extraction` skip behavior and existing classifier behavior.
- CLI dry-run `S-001`: run backlog command on local logs and record the JSON artifact.
- E2E contract test: `tests/e2e/story-personal-kg-extraction-backlog-cli.spec.ts` contains executable anchors for `ac:1` through `ac:6` and `INV-001` through `S-001`.
