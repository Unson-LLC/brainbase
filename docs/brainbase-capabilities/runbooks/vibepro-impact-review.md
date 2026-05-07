# VibePro Impact Review

Use this runbook when the user mentions VibePro, Graphify, impact review, active indicators, realtime session state, hooks, terminal transport, state-machine behavior, or PR gates.

1. Read `docs/brainbase-capabilities/capabilities/vibepro.impact-review.yml`.
2. Run `vibepro status . --json` and note the active story.
3. Select an existing story or create a focused story for the issue stream.
4. Run `vibepro graph . --run-graphify`.
5. Inspect changed files against graph-sensitive paths and impacted runtime/UI paths.
6. Decide targeted verification from the impacted path.
7. Run the targeted tests or runtime checks.
8. Put a `Graphify Impact Review` section in the PR body with the command and evidence.

Minimum PR evidence:

```md
## Graphify Impact Review
- command: `vibepro graph . --run-graphify`
- artifact: `.vibepro/graphify/graph.json`
- impacted paths: `<file>: nodes=<n> links=<n>`
```

Do not treat generic VibePro diagnosis as a substitute for Graphify when the change crosses runtime state, WebSocket, UI state, sorting, hooks, or terminal input.
