# VibePro Was Skipped Before Fixing

Symptom: an agent patches a graph-sensitive behavior, then later discovers VibePro Graphify should have been used first.

Likely causes:

- The task matched a known capability, but the agent relied on memory instead of `brainbase-capability-map`.
- VibePro diagnose was run without Graphify impact review.
- The PR gate existed, but the agent did not use it until after implementation.
- The failure looked local to one file, but the runtime path crossed hooks, server state, WebSocket, client state, and sorting.

Recovery:

1. Stop expanding the patch.
2. Open `docs/brainbase-capabilities/capabilities/vibepro.impact-review.yml`.
3. Run `vibepro graph . --run-graphify`.
4. List graph-sensitive changed files and impacted adjacent paths.
5. Add or update contract tests for the state transition or runtime path.
6. Update the PR body with `Graphify Impact Review` evidence.
7. Run `node scripts/vibepro-graphify-impact-gate.mjs` locally before pushing.

Prevention:

- Use the `vibepro-workflow` skill as the agent entrypoint.
- Keep this capability map as the source of truth.
- Make gate failure messages point to this troubleshooting page.
