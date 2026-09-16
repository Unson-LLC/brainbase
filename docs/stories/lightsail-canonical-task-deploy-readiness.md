# Story: Lightsail deploy leaves Canonical Task usable

As the Brainbase production operator, I want deployment completion to require a
live Canonical Task mutation-readiness check so that a healthy process cannot be
reported as deployed while task registration remains disabled.

## Acceptance criteria

- The post-restart check is non-destructive and never creates a task.
- An already-ready runtime passes without changing readiness state.
- A closed runtime is re-enabled only with before-enable evidence verified by
  the existing readiness command.
- The runtime is probed again after re-enable.
- Missing evidence, failed evidence verification, failed re-enable, or failed
  readback exits non-zero and therefore fails the deployment.
