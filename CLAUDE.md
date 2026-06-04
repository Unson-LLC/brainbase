# Brainbase MCP Agent Instructions

This repository is the external Brainbase Personal Onboarding Kit.

- Keep the repository UI-free. Do not add browser UI, session dashboards, xterm, launchd runtime, workflow mission control, or Unson internal operations.
- The v1 source of truth is local personal data under `~/.brainbase/personal-os/`.
- Do not require hosted services, Infisical, bb.unson.jp, Lightsail, or Unson internal data for v1 behavior.
- MCP tools must prefer canonical local SSOT files over raw `sources/` material.
- Fail loudly when canonical files are malformed.
- Keep changes scoped to the local MCP server, onboarding CLI, schemas, README, and tests.
