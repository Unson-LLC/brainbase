# Guided First-Run Onboarding Architecture

## Decision

Add `onboard:start` as a composition layer over existing onboarding primitives. The command produces a Japanese first-run plan and copyable next commands that reach a first value demo before optional source setup; it does not introduce a new runtime, provider connector, schema, hosted backend, or UI.

## Boundaries

- `src/cli.ts` owns argument parsing, Personal OS initialization, local command availability checks, and dispatch.
- `src/guided-onboarding.ts` owns the guided output model, Japanese rendering, first value demo command, source readiness summaries, and next-command assembly.
- `src/onboarding.ts` remains the source for connector recommendations and source diagnosis.
- `src/projects.ts` remains the source for project registration planning and canonical write shape.
- Canonical SSOT writes remain limited to explicit promotion commands such as `onboard:seed`, `onboard:projects --write`, and `onboard:apply --write`.

## Data Flow

1. The agent runs `brainbase onboard:start`.
2. The CLI initializes the Personal OS directory if it does not exist.
3. The CLI builds the minimum seed and first value demo command before source setup commands.
4. The CLI may diagnose local source readiness without importing provider data, but this is post-demo guidance.
5. The guided renderer emits Japanese interview prompts, source readiness, approval gates, and next commands.
6. The user or agent runs the suggested commands after review.

## Non-Goals

- No UI.
- No direct Gmail, Calendar, Drive, Notion, or task provider authentication inside Brainbase.
- No server operations handoff.
- No hosted sync.
- No unreviewed canonical memory promotion.
