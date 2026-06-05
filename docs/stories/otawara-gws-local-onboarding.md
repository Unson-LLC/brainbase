# Otawara Google Workspace Local Onboarding Plan

## Background

As a first personal Brainbase MCP adopter using Google Workspace, a 24/365 SSH-accessible Mac mini, Google Calendar, Google Drive, local files, and scattered tasks in Calendar and notes, I want Brainbase to generate a local onboarding plan from those answers so Codex or Claude Code can move from interview to setup without treating the Mac mini as a hosted backend or writing unreviewed canonical memory.

## Acceptance Criteria

- README includes a Google Workspace local onboarding example for an always-on Mac mini, Workspace mail/calendar/drive, a secondary Gmail account, local files, and scattered Calendar/notes tasks.
- `brainbase onboard:plan` accepts `--profile google-workspace-local`, `--host`, `--email`, `--secondary-email`, `--calendar`, `--drive`, `--drive-folder`, `--local-folder`, `--tasks`, and `--inactive-task-tool`.
- The plan separates a local SSH runtime host from hosted backend/server operations and states that hosted sync remains out of scope.
- Google Workspace mail, secondary Gmail, Google Calendar, and Google Drive are mapped to metadata-first read-only GoG collection steps.
- Google Drive and local file collection require explicit allowlists and must not recommend scanning all Drive or the full home directory.
- Scattered tasks in Google Calendar and local notes are treated as candidate extraction inputs, while abandoned Notion is marked inactive and not used as a required connector.
- The plan includes next commands for `onboard:diagnose-sources`, `onboard:candidates`, `onboard:install`, and `doctor`.
- JSON and markdown output are deterministic and do not write canonical SSOT files.

