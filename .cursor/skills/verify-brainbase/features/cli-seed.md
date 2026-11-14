# Seed and list local memories

A user registers owner context through the CLI and sees the saved value through a new CLI process.

## Sub-features

- `cli-init`: initialize an empty local directory.
- `cli-seed`: store synthetic identity, value, project, decision principle, and relationship.
- `cli-list`: list stored local memories as JSON and confirm disk persistence.

## How to get to it (user POV)

Run `brainbase onboard:init`, `brainbase onboard:seed`, and `brainbase memory:list` in a terminal. In a source checkout these are `node dist/cli.js <command>`.

## Driving it with verify.mjs

Preconditions: build exists; evidence directory is new; the helper owns the data directory. Run the helper using Launch in ../SKILL.md.

- Initialize: `node dist/cli.js onboard:init --dir <owned-directory>`. Require exit 0, then doctor exit 0 and a connected local backend.
- Register: `node dist/cli.js onboard:seed --dir <owned-directory> --name "Verification Owner" --value "Keep verification local" --project "Local verification project" --decision-principle "Read evidence before deciding" --relationship "Verification Reviewer|reviewer|Checks local evidence"`. Require exit 0.
- List: `node dist/cli.js memory:list --dir <owned-directory> --format json`. Require exit 0 and the saved `Keep verification local` value.
- Persist: read `personal-kg.jsonl` and require the same value. Capture hashes of every canonical file in `persisted-files.json`. Readback is through a separate process, not the writer's in-memory value.

## Gotchas

These are synthetic records, not approved facts about a real owner. Do not seed the user's default directory. A doctor on empty data is not onboarding completion. No actual agent value or source integration is proven. Missing build or data is a failure, not a skip.
