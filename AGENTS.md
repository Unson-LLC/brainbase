# Brainbase MCP Agent Instructions

This repository is the external Brainbase Personal Onboarding Kit.

- Keep the repository UI-free. Do not add browser UI, session dashboards, xterm, launchd runtime, workflow mission control, or Unson internal operations.
- The v1 source of truth is local personal data under `~/.brainbase/personal-os/`.
- Do not require hosted services, Infisical, bb.unson.jp, Lightsail, or Unson internal data for v1 behavior.
- MCP tools must prefer canonical local SSOT files over raw `sources/` material.
- Fail loudly when canonical files are malformed.
- Keep changes scoped to the local MCP server, onboarding CLI, schemas, README, and tests.

## Agent-assisted onboarding behavior

When a user asks to onboard Brainbase from Codex, Claude Code, or CodeCode, treat it as a guided first-run job, not as a request for setup instructions.

- Start from `npm install` only when dependencies are missing, then `npm run build`, then `npm run onboard:start -- --target <agent>`.
- Do not stop after printing commands. Ask for the one context the user does not want to explain repeatedly: a work premise, key relationship, decision principle, or active project.
- Seed only facts the user approves with `brainbase onboard:seed`.
- After seed, preview and approve `brainbase onboard:install --target <agent> --dry-run`, merge only the Brainbase MCP entry, and restart the selected agent.
- In a fresh real agent session, run the user's real request with Brainbase `get_context` and `search`. Show the actual answer, used context, and unknowns, then ask the user whether it was useful.
- Do not stop at `ready: true`. Show the first useful output from the real agent and state what the user did not have to explain again.
- `brainbase onboard:demo` is an optional local CLI preview. Never use its output, `ready: true`, `cli_sample_ready`, command latency, or a synthetic persona judgment as the onboarding completion signal.
- Complete the first-value gate only when the human user personally recognizes value in the actual agent result. Record automated install-to-answer execution only as a candidate end-to-end journey.
- Commands existing in the product are not enough. A completion report must still list unfinished operationalization: public skills placement, `ohayo` / `oyasumi` / `retro` routines, real MCP config merge, source allowlist / import / candidate review, and MCP `get_context` / `search` verification.
- Keep operationalization safe by default: generated skills, generated routines, and `onboard:install --dry-run` are previews until the user approves file writes, scheduler registration, and live config changes.
- Treat `brainbase onboard:install --target <agent> --dry-run` as configuration preview only. It is not onboarding completion, but real MCP installation is required before actual-agent value verification.
- Do not modify `package-lock.json`, `tsconfig.json`, or dependency metadata just to onboard a user unless build or install actually fails and the fix is scoped.
