# Value-first Onboarding Spec

## Invariants

- INV-1: Onboarding completion requires a first value demo from canonical SSOT, not only `doctor` returning `missing: []`.
- INV-2: `onboard:agent` must ask for the repeated context or value target before asking about mail, calendar, drive, or task tools.
- INV-3: Source diagnosis and candidate JSON are optional post-demo tools.
- INV-4: The value demo must read only canonical local SSOT: `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`.
- INV-5: No onboarding command may ask users to paste OAuth tokens, passwords, API keys, or refresh tokens into chat.
- INV-6: The demo must be deterministic and local; it must not call an LLM or hosted backend.

## Contracts

- C-1: `brainbase onboard:agent [--format markdown|json]`.
- C-2: JSON agent protocol returns `goal`, `interviewSections[]`, `safetyRules[]`, `nextCommands[]`, and `completionCheck[]`.
- C-3: Agent protocol section IDs are `value_target`, `hypothesis`, `approval`, `minimum_seed`, `first_value_demo`, and `optional_sources`.
- C-4: `brainbase onboard:demo [--dir path] [--scenario value] [--format markdown|json]`.
- C-5: JSON demo returns `goal`, `ready`, `missing[]`, `scenario`, `contextUsed`, `answer`, `nextStep`, and `completionSignal`.
- C-6: `doctor` returns `valueDemo.ready`, `valueDemo.missing[]`, `valueDemo.command`, and `valueDemo.completionSignal`.

## Scenarios

- S-1: `onboard:agent --format json` exposes the value-first section order and lists `onboard:demo` before source diagnosis.
- S-2: `onboard:demo --format json` on an empty Personal OS returns `ready: false`, `completionSignal: "needs_seed"`, and missing `self`, `work`, and `relationships`.
- S-3: After `onboard:seed --name`, `--project`, `--value`, and `--relationship`, `onboard:demo --scenario "<real request>" --format json` returns `ready: true`, `completionSignal: "first_value_demo_ready"`, and an answer grounded in the saved relationship.
- S-4: `doctor` reports the same value demo readiness as the canonical self, work, and relationship seed status.
- S-5: README shows the value demo path before source diagnosis.

## Anti-patterns

- AP-1: Starting onboarding by asking which source tools the user uses.
- AP-2: Treating connector readiness as proof that onboarding is complete.
- AP-3: Showing raw candidate JSON as the user's first review surface.
- AP-4: Claiming source-derived facts are canonical before explicit approval.
- AP-5: Using raw `sources/` files for the first value demo.

## Verification

- Unit and CLI tests must cover S-1 through S-4 with clause IDs in test names or assertion messages.
- E2E acceptance tests must include story acceptance criteria in assertion messages for VibePro coverage scanning.
- `npm run build`, `npm test`, and `npm pack --dry-run` must pass before PR creation.
- `vibepro pr prepare` must not report implicit spec fallback or missing acceptance criteria for this story.
