---
name: brainbase-capability-map
description: Brainbaseで何ができるか、どのUI/API/コード/データが関係するか、どう検証・復旧するかを確認するときに使うSkill。プロジェクト一覧、セッション作成、auth grant、31013 launchd runtime、xterm/terminal transport、表示されないプロジェクト、 stale auth などの能力・障害切り分けの入口。
---

# brainbase-capability-map

Use this Skill before answering or changing behavior related to Brainbase capabilities.

## Source Of Truth

The capability map source of truth is:

- `docs/brainbase-capabilities/README.md`
- `docs/brainbase-capabilities/capabilities/*.yml`
- `docs/brainbase-capabilities/runbooks/*.md`
- `docs/brainbase-capabilities/troubleshooting/*.md`

Do not duplicate capability records in this Skill. This Skill is only the agent entrypoint.

## When To Use

- The user asks what Brainbase can do.
- A project is missing from a dropdown or selector.
- A session cannot be created for a project.
- Auth grant, JWT/localStorage access, or project visibility is involved.
- Port `31013`, launchd, runtime source, or restart behavior is involved.
- Terminal/xterm transport, Enter feedback, IME, or rendering behavior is involved.
- A fix needs a repeatable runbook or troubleshooting entry.

## Capability Catalog (inline index — keep in sync with `capabilities/*.yml`)

Pick the matching capability_id then **Read the yml** before reasoning. Reading this table alone is not enough — the yml has `surfaces` / `verification` / `common_failures` / `runbooks` that this index does not.

| capability_id | yml | When this matches |
|---|---|---|
| `auth.grants` | `auth.grants.yml` | login / project access / JWT scope / localStorage stale auth |
| `code.reading` | `code.reading.yml` | reading code before changing — symbol/pattern search vs broad load |
| `development.workflow` | `development.workflow.yml` | Git workflow, commit/PR shape |
| `git.protected-push` | `git.protected-push.yml` | direct push / force push to develop or main |
| `graph.ssot` | `graph.ssot.yml` | canonical person/org/customer/decision/story lookup before writing facts |
| `judgment.resolve` | `judgment.resolve.yml` | Host opens one canonical-context judgment episode before model generation and records 0..N actual Brainbase calls with `PostToolUse`; `Stop` alone verifies the final assistant answer's audit prefix and finalizes the receipt |
| `knowledge.resolve` | `knowledge.resolve.yml` | choose Graph / owning repo / team Drive / personal KG / workspace before searching |
| `onboarding.connected-world` | `onboarding.connected-world.yml` | connector-first onboarding / MCP・Drive・Gmail・local folder / first-value answer |
| `personal-kg` | `personal-kg.yml` | owner-visible cognitive memory (思想/実績/判断基準) for `/oyasumi`, SNS generation, morning brief; in-progress |
| `project.catalog` | `project.catalog.yml` | configured project list exposed through the config API |
| `project.selector` | `project.selector.yml` | retired browser selector; read the retirement boundary, do not restore the old UI |
| `requirements.coverage` | `requirements.coverage.yml` | acceptance criteria still satisfied before claiming done |
| `requirements.nocodb` | `requirements.nocodb.yml` | FRD-* / REQ-* / BUG-* lookup before scope/impl change |
| `runtime.launchd` | `runtime.launchd.yml` | port 31013 / launchd / restart / canonical runtime source |
| `secrets.infisical` | `secrets.infisical.yml` | secret/env/Infisical org split, CI/CD/runtime/local dev injection |
| `session.create` | `session.create.yml` | retired Brainbase session creation; Codex app/CLI owns development tasks |
| `session.hibernation` | `session.hibernation.yml` | retired session hibernation; old data is read-only evidence |
| `terminal.transport` | `terminal.transport.yml` | retired Brainbase terminal transport; use the owning application |
| `codex.app-server` | `codex.app-server.yml` | retired Brainbase adapter; read the current ownership boundary |
| `verification.testing` | `verification.testing.yml` | which tests must run for the change |
| `vibepro.impact-review` | `vibepro.impact-review.yml` | VibePro Graphify impact review for graph-sensitive changes |
| `vibepro.skills-usage` | `vibepro.skills-usage.yml` | how Brainbase agents should use VibePro Skills |

## Workflow

1. Match the user request to a `capability_id` in the table above.
2. **REQUIRED**: `Read docs/brainbase-capabilities/capabilities/<capability_id>.yml`. The yml is the source of truth — this SKILL.md index is only for routing.
3. Follow linked runbooks (`runbooks/*.md`) or troubleshooting pages (`troubleshooting/*.md`).
4. Verify using the commands in the yml's `verification` section.
5. When claiming the capability is working, cite the file/API/process/log from the yml that you used for verification.

**Anti-pattern**: `cat`/`sed`-ing only this SKILL.md and answering from its description is "reading ceremony" — the catalog rows are 1-liners and miss verification commands, common failures, and runbooks. Always Read the matching yml.

## Operating Rule

PageIndex and VibePro may be derived aids, but they are not the source of truth. Keep capability records repo-native under `docs/brainbase-capabilities/`.
