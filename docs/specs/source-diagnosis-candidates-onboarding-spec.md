# Source Diagnosis and Candidate Onboarding Spec

## Invariants

- INV-1: Raw provider material must stay under `sources/` until reviewed.
- INV-2: Interview-derived facts must first be represented as candidates under `candidates/`.
- INV-3: `onboard:candidates` must not write `graph.json`, `personal-kg.jsonl`, `relationships.json`, or `decisions.jsonl`.
- INV-4: Missing connector tooling must fail visible in diagnosis as `needs_setup`.
- INV-5: No onboarding command may ask users to paste OAuth tokens, passwords, API keys, or refresh tokens into chat.
- INV-6: Google Drive diagnosis must require explicit folder allowlists before collection.

## Contracts

- C-1: `brainbase onboard:diagnose-sources [--dir path] [--email value] [--calendar value] [--drive value] [--drive-folder id] [--tasks value] [--format markdown|json] [--assume-gog] [--gog-command command]`.
- C-2: JSON diagnosis returns `diagnostics[]` with `area`, `input`, `status`, `collector`, `sourcePath`, `writeTarget`, `requiredUserInput`, `setupCommands`, and `safetyNotes`.
- C-3: `status` is one of `ready`, `needs_setup`, `needs_input`, or `not_configured`.
- C-4: `brainbase onboard:candidates [--dir path] [--name value] [--value value] [--project value] [--relationship "person|role|context"] [--decision-principle value] [--format markdown|json] [--write]`.
- C-5: JSON candidate output returns `candidates[]`, `canonicalWrites: false`, `candidatePath`, `safetyRules`, and `nextCommands`.

## Scenarios

- S-1: Gmail, Google Calendar, and Google Drive with `--assume-gog` and `--drive-folder` returns metadata-first GoG commands and `ready` Google diagnostics.
- S-2: The same Google inputs without GoG availability returns `needs_setup`.
- S-3: Google Drive without `--drive-folder` returns `needs_input` even when GoG is available.
- S-4: Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV/manual, and `none` task answers return deterministic task diagnostics.
- S-5: `onboard:candidates --write` creates a candidate JSON file and leaves canonical SSOT counts unchanged.
- S-6: `doctor` reports canonical seed status, not candidate status.

## Anti-patterns

- AP-1: Treating raw `sources/` files as normal MCP context before review.
- AP-2: Treating candidate files as canonical seed completion.
- AP-3: Asking the user to paste OAuth or API secrets into chat.
- AP-4: Scanning an entire Drive without folder allowlists.

## Verification

- Unit and CLI tests must cover S-1 through S-6.
- E2E acceptance tests must include all story acceptance criteria in assertion messages for VibePro coverage scanning.
- `npm pack --dry-run` must not include docs, tests, `.vibepro`, UI, internal data, or source material.
