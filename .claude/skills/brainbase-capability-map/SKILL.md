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

## Workflow

1. Open `docs/brainbase-capabilities/README.md`.
2. Pick the smallest relevant capability file under `capabilities/`.
3. Follow linked runbooks or troubleshooting pages.
4. Verify using the commands listed in the capability file.
5. When claiming the capability is working, cite the file/API/process/log used for verification.

## Operating Rule

PageIndex and VibePro may be derived aids, but they are not the source of truth. Keep capability records repo-native under `docs/brainbase-capabilities/`.
