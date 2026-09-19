# Troubleshooting: Retired Project Selector

## Symptom

An old Brainbase browser project dropdown or Create Session picker is missing.

## Resolution

This is expected. The browser project selector is retired under `project.selector`; do not restore the old picker, `project-mapping.js`, or stale browser instructions. Codex app/CLI owns task and worktree creation.

## If a project is missing from an authenticated catalog

Use [Project Catalog Access and Readback](../runbooks/missing-project-in-session-selector.md) and check the API/MCP status, organization scope, and effective grant. `/api/config` local topology is not proof of organization membership or an authenticated catalog result. Do not use old selector flags, inferred aliases, or browser `localStorage` as a fallback.
