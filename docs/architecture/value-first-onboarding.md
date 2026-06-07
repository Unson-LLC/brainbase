# Value-first Onboarding Architecture

## Decision

Brainbase onboarding should prove value from canonical local SSOT before source collector setup. The CLI remains UI-free, but the agent protocol now guides Codex, Claude Code, or CodeCode through a conversational first-value path:

1. Ask what context the user does not want to explain repeatedly.
2. Draft a minimal memory hypothesis.
3. Get explicit approval.
4. Seed canonical self, work, and relationship facts.
5. Run `onboard:demo` against canonical SSOT.
6. Only then diagnose external sources and candidate extraction.

## Rationale

Source diagnosis is operational setup. It does not demonstrate that Brainbase understands the user's work. The local MCP kit should reach a small but concrete artifact first, because the user can then decide whether source import is worth the setup cost.

## Boundary

Brainbase CLI owns:

- `onboard:agent`: value-first agent protocol.
- `onboard:seed`: explicit canonical writes from approved facts.
- `onboard:demo`: deterministic demo artifact from canonical SSOT.
- `doctor`: seeded status plus value demo readiness.
- Existing connector recommendation, diagnosis, and candidate staging commands.

Codex / Claude Code / CodeCode owns:

- Asking the human-facing questions.
- Turning the user's approval into explicit `onboard:seed` arguments.
- Running the demo and showing whether the output is useful.
- Moving to source diagnosis only when the first demo exposes missing context or the user opts in.

External connectors own:

- Provider authentication.
- Read-only source collection.
- Export mechanics.

## Data Flow

```text
human value target
  -> agent memory hypothesis
  -> approved onboard:seed
  -> canonical SSOT
  -> onboard:demo
  -> optional source diagnosis
```

## Safety

- No OAuth, hosted backend, or Infisical dependency is introduced.
- The first value demo reads only canonical local files.
- Raw sources stay under `sources/`.
- Candidate facts stay under `candidates/` until approved.
- Source diagnosis must remain available, but it is not the primary onboarding completion condition.
