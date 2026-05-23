# SNS mobile review terminal guard architecture

## Decision

Terminal visibility is defined by the terminal surface, not by `console-area` alone.

`console-area` can host non-terminal workspace overlays such as Portal and SNS Growth. Therefore terminal focus/reveal code must require `#terminal-stage` to be visible before treating the console as an interactive terminal target.

## Boundaries

- SNS Growth remains embedded in the Brainbase workspace.
- `showConsole` and terminal recovery flows keep working when the terminal stage is visible.
- Mobile snapshot-to-live behavior remains available for actual terminal taps.
- SNS overlay interactions are not terminal interactions.
- Existing session switch token, current-session, and stale-session guard branches stay as-is; this change only narrows the terminal surface visibility predicate.

## Evidence

- Unit: `tests/unit/terminal-display-mixin.test.js`
- E2E: `tests/e2e/sns-growth-cockpit.spec.js`
