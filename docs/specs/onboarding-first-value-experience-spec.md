# Onboarding First Value Experience Spec

## Invariants

- INV-1: Onboarding completion requires a user-visible useful output, not only `ready: true` or `first_value_demo_ready`.
- INV-2: The first user-facing value experience must use plain language and must not require the user to understand Graph, Personal KG, relationship records, or SSOT.
- INV-3: The demo remains deterministic and local; it must not call an LLM, hosted backend, provider connector, or raw source collector.
- INV-4: Source setup, candidate review, MCP install, and `doctor` are follow-up checks after the first value experience.

## Contracts

- C-1: `brainbase onboard:demo --format json` returns `tryPrompt`, `sampleResult`, and `valueExplanation` in addition to readiness fields.
- C-2: `brainbase onboard:start --format json` returns `firstValueExperience.tryPrompt`, `firstValueExperience.expectedValue`, and `firstValueExperience.sampleResult`.
- C-3: Markdown `onboard:demo` output shows "Try this now", "Sample result", and "What changed" before setup follow-up.
- C-4: Agent instructions explicitly state that `ready: true` is not enough unless the agent shows the useful output.

## Scenarios

- S-1: `onboard:start --format json` on a new local directory includes a concrete first value prompt and sample result before optional source setup.
- S-2: After minimum seed, `onboard:demo --format json` returns `ready: true`, a natural `tryPrompt`, a `sampleResult` grounded in the saved project/person context, and a plain-language `valueExplanation`.
- S-3: Markdown `onboard:demo` on ready data presents the prompt and sample result without requiring internal Brainbase terminology.
- S-4: Agent instructions mention that the agent must produce the first useful output from saved context.

## Anti-patterns

- AP-1: Reporting `ready: true` as completion without showing a useful answer.
- AP-2: Explaining Graph, Personal KG, relationship records, or SSOT before the user sees the first value output.
- AP-3: Sending the user to connector setup, source diagnosis, candidate JSON, MCP install, or `doctor` before the demo output.
- AP-4: Calling an LLM or external source collector for the deterministic first value sample.

## Verification

- Unit and CLI tests must include S/C/INV IDs in test names or assertion messages.
- `npm run build` and `npm test` must pass.
- `vibepro pr prepare` must not report implicit spec fallback or missing acceptance criteria for this story.
