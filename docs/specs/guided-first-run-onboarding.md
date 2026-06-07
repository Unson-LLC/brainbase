# Guided First-Run Onboarding Spec

Story ID: `story-guided-first-run-onboarding`

## Purpose

Brainbase Personal Onboarding Kit should let a first-time user start from Codex, Claude Code, or CodeCode with a Japanese guided flow instead of assembling several low-level commands manually.

## Scope

- Add a CLI command `brainbase onboard:start`.
- Keep the repository UI-free and local-first.
- Do not add hosted backend, Infisical, Unson API, Lightsail, or server-operations behavior.
- Do not connect directly to provider APIs from Brainbase. External data remains staged through existing source diagnosis, GoG-style collection guidance, `sources/`, and `candidates/`.

## Acceptance Criteria

- `onboard:start` initializes the local Personal OS directory when needed.
- `onboard:start` does not write canonical self, project, relationship, personal KG, or decision facts by itself.
- The command emits a Japanese interview flow for value target, self/work context, project, approval, first value demo, and optional post-demo sources.
- The command accepts known answers for target agent, self name, project, goal, status, role, email, calendar, drive, drive folder allowlists, local folders, and tasks.
- The command reports source readiness in Japanese while preserving concrete setup commands.
- The command includes copyable next commands for:
  - `onboard:seed`
  - `onboard:demo`
  - `onboard:projects` dry-run
  - `onboard:projects --write` after approval
  - `onboard:diagnose-sources` after the first value demo
  - `onboard:candidates --write`
  - `onboard:install --target <agent> --dry-run`
  - `doctor`
- `onboard:start` lists `onboard:demo` before source diagnosis or candidate review.
- `onboard:start` completion checks include first value demo readiness, not only `doctor.missing`.
- Project registration remains approval-gated. Dry-run comes before `--write`.
- OAuth tokens, passwords, API keys, and refresh tokens are never requested through chat.
- Drive and local file collection remain allowlist-first.

## Verification

- Unit tests cover JSON and Markdown output from `onboard:start`.
- Existing onboarding tests continue to pass.
- `npm run build` succeeds.
- `npm test` succeeds.
- `npm pack --dry-run` excludes UI, internal data, secrets, and VibePro working artifacts.
