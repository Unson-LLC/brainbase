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
- Run `brainbase onboard:demo --scenario "<real request>"` before source diagnosis or MCP install, and use the first useful answer as the onboarding completion signal.
- Treat `brainbase onboard:install --target <agent> --dry-run` as configuration preview only. It is not onboarding completion.
- Do not modify `package-lock.json`, `tsconfig.json`, or dependency metadata just to onboard a user unless build or install actually fails and the fix is scoped.
