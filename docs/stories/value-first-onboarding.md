# Value-first onboarding

## Story

As a person adopting Brainbase from Codex, Claude Code, or CodeCode, I want onboarding to reach a useful answer from my own context before asking me to configure source collectors, so that the first session proves why Brainbase is worth installing.

## User Value

The first useful Brainbase moment is not `doctor` reporting no missing seed fields. It is:

1. The agent asks what I do not want to explain repeatedly.
2. The agent captures the smallest approved self, work, and relationship facts.
3. Brainbase runs a demo request against canonical local SSOT.
4. The demo answer shows that the agent can use the saved context without re-asking who someone is or why the work matters.
5. Source diagnosis and connector setup happen only after the user has seen that value.

## Requirement Sources

- specification: docs/specs/value-first-onboarding-spec.md
- architecture: docs/architecture/value-first-onboarding.md

## Scope

In scope:

- Make `onboard:agent` value-first instead of source-first.
- Add `onboard:demo` to render a deterministic first-value artifact from canonical SSOT.
- Report value demo readiness from onboarding status.
- Update README so the primary onboarding path is `agent -> seed minimum facts -> demo -> install -> optional sources`.
- Keep source diagnosis, recommendations, and candidates as optional post-demo tooling.

Out of scope:

- Hosted backend setup.
- UI onboarding.
- OAuth flows.
- Automatic raw source import.
- LLM generation. The demo must be deterministic and local.

## Acceptance Criteria

- `brainbase onboard:agent` starts by asking for the repeated context the user wants Brainbase to remember.
- `brainbase onboard:agent --format json` returns value-first sections for value target, hypothesis, approval, minimum seed, first value demo, and optional sources.
- `brainbase onboard:demo --format json` reports `ready: false` with missing canonical areas when self, work, or relationships are absent.
- After seeding self, work, and a relationship, `brainbase onboard:demo --scenario "<real request>" --format json` reports `ready: true` and produces an answer that uses the saved relationship context.
- `doctor` exposes a `valueDemo` readiness block so onboarding completion is not reduced to connector setup.
- README presents the first value demo before source diagnosis or candidate files.

## Safety Rules

- Do not ask for OAuth tokens, passwords, API keys, or refresh tokens in chat.
- Do not treat raw source diagnosis as onboarding completion.
- Do not show candidate JSON as the user's first experience.
- Do not promote raw source material into canonical SSOT without explicit approval.
