# Agent-assisted Source Onboarding Architecture

## Decision

Brainbase MCP onboarding delegates the interview experience to Codex, Claude Code, or CodeCode. Brainbase itself provides deterministic CLI protocols, first value demo rendering, connector recommendations, source staging layout, and canonicalization boundaries.

## Rationale

The external package is intentionally UI-free. A separate onboarding UI would add a new product surface before the MCP value is proven. The target user already uses an AI coding agent, so the agent should ask the human-facing questions while Brainbase keeps the machine-checkable rules. Source setup should happen after the first value demo, because connector readiness does not prove that Brainbase understands the user's work.

## Boundary

Brainbase CLI owns:

- `onboard:agent`: a reusable value-first interview protocol for coding agents.
- `onboard:demo`: a deterministic first value artifact from canonical SSOT.
- `onboard:recommend`: deterministic source connector recommendations.
- `onboard:init`: local source and candidate staging directories.
- Canonicalization rules: raw external sources are secondary material.

Codex / Claude Code / CodeCode owns:

- Asking what context the user does not want to explain repeatedly.
- Getting approval for the smallest canonical facts.
- Running the first value demo.
- Asking which mail, calendar, drive/docs, and task tools they use only after the demo or when the user opts into source setup.
- Helping the user choose the next setup command.
- Explaining how to paste or merge MCP config snippets.

External connectors own:

- Local read-only source collection.
- Provider-specific auth.
- Export mechanics.

## Safety

- No OAuth, hosted backend, or Infisical dependency is introduced by this story.
- The package does not request secrets in chat.
- Raw mail, calendar, drive, and task material stays under `sources/`.
- Candidate facts must be reviewed before promotion into `graph.json`, `relationships.json`, `personal-kg.jsonl`, or `decisions.jsonl`.
- Google Drive / Docs collection must be folder allowlist based.

## Follow-up

Future stories may implement actual importers and review/apply commands. Those stories must preserve the same source-to-candidate-to-canonical boundary.
