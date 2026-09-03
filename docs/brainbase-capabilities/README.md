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
name: Workspace Setup project selector
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
| `runtime.lightsail` | Production SSOT on `bb.unson.jp` runs from `/home/ubuntu/brainbase` under systemd (`brainbase-ssot.service`); deploy is manual ff-merge + restart. |
| `project.catalog` | Defines the configured project catalog, authenticated grant scope, MCP status envelope, and audit evidence. |
| `project.selector` | Defines which projects appear in the Workspace Setup selector. |
| `auth.grants` | Defines user project access through `auth_grants.project_codes` and JWT/localStorage access payloads. |
| `session.create` | Historical record of retired Brainbase session/worktree creation. Codex owns this lifecycle. |
| `terminal.transport` | Historical record of retired Brainbase xterm/tmux/ttyd transport. |
| `session.hibernation` | Historical record of retired Brainbase process lifecycle management. |
| `workflow.mission-control` | Historical record of the retired generic Workflow product. Only domain-specific Control and Automation Run compatibility paths remain. |
| `automation.run-core` | Defines project-scoped run, step, output, human approval, and audit semantics without a generic Workflow product. |
| `run-receipt.inbox` | Defines cross-runtime receipt ingest, uncertainty-preserving projection, history, and Agent Inbox boundaries. |
| `meeting.automation` | Defines the live meeting-source ingest, external-runtime handoff/write-back, approval, and evidence path retained during Workflow retirement. |
| `codex.app-server` | Historical record of the retired Brainbase Codex-like UI adapter. |
| `graph.ssot` | Defines when Brainbase Graph is the canonical source for names, projects, terminology, and decisions. |
| `judgment.resolve` | Codex Host opens one canonical-context-bound judgment episode before model generation; the internal-LLM-free Resolver deterministically selects the initial route, and `PostToolUse` records all completed tool calls as execution evidence. Runtime 2.3 finalizes at `Stop`; runtime 2.4 may finalize a previously rejected continuation when its completed-state `PostToolUse` arrives, because Codex Desktop does not always issue another `Stop`. Both paths produce one non-authorizing receipt. Claude Code remains a future Host-adapter candidate. |
| `knowledge.resolve` | Resolves the canonical knowledge source before search and preserves unsearched scope and uncertainty in a routing receipt. |
| `onboarding.connected-world` | Defines the host-agent workflow that starts from callable MCP, Drive, Gmail, or explicit local folders, preserves unavailable states, and routes reviewed candidates through Promotion Gate. |
| `requirements.nocodb` | Defines how `FRD-*`, `REQ-*`, and `BUG-*` references are resolved before scope or implementation changes. |
| `code.reading` | Defines how agents should inspect code without loading broad files unnecessarily. |
| `development.workflow` | Defines Brainbase's Git workflow, including focused staging, dirty-state checks, commits, and PR review. |
| `git.protected-push` | Defines the PreToolUse guard (Claude Code + Codex) that blocks direct push, refspec push, force push, and force branch-update against `develop` / `main` / `master`. |
| `verification.testing` | Defines how test-related prompts and changed files map to required test execution. |
| `requirements.coverage` | Defines how completed TODOs are checked against acceptance requirements before stopping. |
| `vibepro.impact-review` | Defines when and how VibePro Graphify impact review is required for graph-sensitive changes. |
| `vibepro.skills-usage` | Defines how Brainbase agents use VibePro Skills for workflow, story-driven refactoring, and human-review cockpit work. |

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
