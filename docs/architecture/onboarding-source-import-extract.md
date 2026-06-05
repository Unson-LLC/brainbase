# Onboarding Source Import and Candidate Extraction Architecture

## Decision

Brainbase owns three local, deterministic CLI surfaces that complete the onboarding value loop without authenticating to any provider itself:

- `onboard:import`: normalize external collector output (gog JSON or exports) into metadata-first records under `sources/<provider>/`.
- `onboard:extract`: derive reviewable candidates under `candidates/` from whatever already exists in `sources/`.
- `onboard:apply`: promote explicitly selected candidates into canonical SSOT.

The conversational interview, authentication, and provider calls stay with the coding agent and external collectors (gog, exports). Brainbase only normalizes, derives, and promotes local data.

## Boundaries

- Brainbase v1 still never authenticates to Gmail, Calendar, Drive, Notion, or task systems. `onboard:import` consumes already-collected JSON; it does not call providers.
- Import is metadata-first. Mail bodies, full event descriptions, and file contents are dropped at the normalization boundary, not merely ignored downstream.
- Extraction is pure and deterministic. No randomness, no clock-dependent candidate identity, no model calls.
- Apply is the only command in this loop that writes canonical SSOT, only with `--write`, and only for explicitly selected candidate ids.

## Data Flow

1. The coding agent runs the diagnosed gog collectors and captures provider JSON.
2. `onboard:import --source <provider> --from <file>` normalizes that JSON into `sources/<provider>/*.jsonl` metadata records.
3. `onboard:extract` scans `sources/` and writes `candidates/extracted-*.json` with person/org/project/relationship/next-action candidates plus provenance counts.
4. The user reviews the candidate file.
5. `onboard:apply --from <file> --select <id> --write` promotes approved candidates into `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`.
6. `doctor`, `get_context`, and `search` then reflect the imported sources and applied canonical entities.

## Modules

- `src/import-extract.ts`: pure normalize, extract, and apply-planning functions.
- `src/cli.ts`: thin command wiring for `onboard:import`, `onboard:extract`, `onboard:apply`.
- `src/ssot.ts`: existing canonical writers reused by apply.

## Safety

- No command asks for secrets in chat.
- Import refuses to persist body text; only metadata fields are written.
- Apply is dry-run by default and never promotes unselected candidates.
- Canonical MCP context remains `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`.
