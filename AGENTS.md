# Brainbase MCP Agent Instructions

<!-- brainbase:public-message:start -->
This repository contains the OSS Brainbase judgment substrate and its local-first personal onboarding entry point. It is not limited to memory retrieval.

Brainbase's public promise is:

> **自分の判断力を、ひとり分で終わらせない。**
>
> Brainbaseは、あなたの目的、優先順位、判断基準、過去の決定を、複数のAIが使えるローカルの判断OSにします。CodexやClaude Codeは、同じ判断軸から深く考え、調査・設計・執筆・開発を進められます。

The product boundary is explicit: 人間は、目的、判断基準、任せてよい範囲を決める。 AIは、それらを参照して探索・反証し、許可された範囲の仕事を進める。
<!-- brainbase:public-message:end -->

- Keep the repository UI-free. Do not add browser UI, session dashboards, xterm, launchd runtime, workflow mission control, or Unson internal operations.
- The current OSS runtime is local-first and single-owner. Its canonical personal data lives under `~/.brainbase/personal-os/`.
- Do not require hosted services, Infisical, bb.unson.jp, Lightsail, or Unson internal data for OSS behavior.
- MCP tools must prefer canonical local SSOT files over raw `sources/` material.
- Fail loudly when canonical files are malformed or when authority, approval, provenance, or current validity cannot be verified.
- Keep the Judgment DAG semantic model shared across personal, project, and organization scopes. Do not create a separate company brain model.
- Do not imply that planned replay, persistent artifact storage, human/agent governance, scope promotion, or enterprise controls already exist. Keep Released / Develop / Planned boundaries explicit.
- Public product copy inside `brainbase:public-message` markers is generated from `docs/publication/public-message.json`. Do not hand-edit one projection. Use `npm run docs:sync` or the approved promotion flow.
- A Brainbase Graph candidate may update public copy only when it includes an exact entity id, snapshot hash, exported time, and explicit human approval. Promotion must create a PR; it must not deploy or merge directly.

## Agent-assisted onboarding behavior

When a user asks to onboard Brainbase from Codex, Claude Code, or CodeCode, treat it as a guided first-run job, not as a request for setup instructions.

- Start from `npm install` only when dependencies are missing, then `npm run build`, then `npm run onboard:start -- --target <agent>`.
- Do not stop after printing commands. Ask for the one context the user does not want to explain repeatedly: a work premise, key relationship, decision principle, or active project.
- Seed only facts the user approves with `brainbase onboard:seed`.
- After seed, preview and approve `brainbase onboard:install --target <agent> --dry-run`, merge only the Brainbase MCP entry, and restart the selected agent.
- In a fresh real agent session, run the user's real request with Brainbase `resolve_entity`, `get_context`, and `search`. Lead with three short sections: what Brainbase remembered, how it connected the request, and what the user can do next. Keep confirmed facts and unknowns distinct, then ask the user whether it was useful.
- Do not use a table for the first-value answer. Use short bullets that can be understood without knowing Brainbase internals.
- Put canonical IDs, relation paths, receipt digests, raw tool traces, and source file names under an optional details section, collapsed when the host supports it, or show them only when the user asks.
- Do not narrate internal skill loading, lookup retries, or tool orchestration unless a failure changes the result or the next action.
- Do not stop at `ready: true`. Show the first useful output from the real agent and state what the user did not have to explain again.
- `brainbase onboard:demo` is an optional local CLI preview. Never use its output, `ready: true`, `cli_sample_ready`, command latency, or a synthetic persona judgment as the onboarding completion signal.
- Complete the first-value gate only when the human user personally recognizes value in the actual agent result. Record automated install-to-answer execution only as a candidate end-to-end journey.
- Commands existing in the product are not enough. A completion report must still list unfinished operationalization: public skills placement, `ohayo` / `oyasumi` / `retro` routines, real MCP config merge, source allowlist / import / candidate review, and MCP `resolve_entity` / `get_context` / `search` verification.
- Keep operationalization safe by default: generated skills, generated routines, and `onboard:install --dry-run` are previews until the user approves file writes, scheduler registration, and live configuration changes.
- Treat `brainbase onboard:install --target <agent> --dry-run` as configuration preview only. It is not onboarding completion, but real MCP installation is required before actual-agent value verification.
- Do not modify `package-lock.json`, `tsconfig.json`, or dependency metadata just to onboard a user unless build or install actually fails and the fix is scoped.
