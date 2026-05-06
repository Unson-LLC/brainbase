# Brainbase Capability Map

Brainbase Capability Map is the repo-native source of truth for what Brainbase can do, where each capability is implemented, how it is verified, and how it commonly fails.

This is not a long-form user manual. It is an operating catalog for humans and agents.

## Source Of Truth

- Primary source: `docs/brainbase-capabilities/`
- Agent entrypoint: a small Skill may route agents to this directory, but the Skill must not duplicate the catalog.
- Search indexes such as PageIndex are optional derived artifacts, not sources of truth.
- VibePro is optional validation/advisory evidence. It should not generate or own capability records.

## Capability Files

Each file under `capabilities/` should use the same fields:

```yaml
id: project.selector
name: Session project selector
purpose: What user or agent goal this capability serves
surfaces:
  ui: []
  api: []
  code: []
  data: []
depends_on: []
visibility_rules: []
verification:
  commands: []
  expected: []
common_failures: []
runbooks: []
troubleshooting: []
```

## Initial Capability Index

| Capability | Why it exists |
|---|---|
| `runtime.launchd` | Canonical port `31013` is managed by launchd and syncs selected paths from `origin/develop` before startup. |
| `project.catalog` | Defines the complete configured project list from `/api/config`. |
| `project.selector` | Defines which projects appear in the session creation dropdown. |
| `auth.grants` | Defines user project access through `auth_grants.project_codes` and JWT/localStorage access payloads. |
| `session.create` | Defines how sessions are created, including project selection, engine, worktree handling, and verification. |
| `terminal.transport` | Defines xterm transport behavior, Enter feedback, and terminal rendering constraints. |

## Operating Rules

1. Update a capability when code changes its UI/API/data/visibility behavior.
2. Add or update a runbook when a repeated operational fix is discovered.
3. Add a troubleshooting page when a failure can look like a different subsystem.
4. Prefer exact file/API references over prose.
5. When claiming a capability is working, include the file, API, process, or log that proves it.

## VibePro Use

Do not use VibePro to author the catalog. Use it after meaningful capability changes when it can provide evidence that docs, implementation, and tests still line up.

Good VibePro use:

- advisory checks for documentation traceability
- evidence capture after capability-related implementation changes
- finding gaps between runbooks and actual runtime behavior

Bad VibePro use:

- treating VibePro output as the source of truth
- generating capability records without verifying code/API/runtime
- making all capability-map edits depend on a heavy scoring workflow
