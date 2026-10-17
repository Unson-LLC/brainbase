# Google Workspace Local Onboarding Plan

## Background

As a personal Brainbase MCP adopter using Google Workspace, I want Brainbase to generate a local onboarding plan from interview answers—covering an always-on local SSH host (for example a Mac mini), Workspace mail/calendar/drive, an optional secondary Gmail account, allowlisted local files, and task fragments spread across Calendar and notes—so Codex or Claude Code can move from interview to setup without treating that host as a hosted backend or writing unreviewed canonical memory.

## Acceptance Criteria

- README includes a Google Workspace local onboarding example with `--profile google-workspace-local`, an example always-on host (for example `--host mac-mini`), Workspace mail/calendar/drive, an optional secondary Gmail account, allowlisted local files, and scattered Calendar/notes tasks.
- `brainbase onboard:plan` accepts `--profile google-workspace-local`, `--host`, `--email`, `--secondary-email`, `--calendar`, `--drive`, `--drive-folder`, `--local-folder`, `--tasks`, and `--inactive-task-tool`.
- The plan separates a local SSH runtime host from hosted backend/server operations and states that hosted sync remains out of scope.
- Google Workspace mail, optional secondary Gmail, Google Calendar, and Google Drive are mapped to metadata-first read-only GoG collection steps.
- Google Drive and local file collection require explicit allowlists and must not recommend scanning all Drive or the full home directory.
- Task fragments in Google Calendar and local notes are treated as candidate extraction inputs, while an inactive task tool (for example unused Notion via `--inactive-task-tool notion`) is marked inactive and not used as a required connector.
- The plan includes next commands for `onboard:diagnose-sources`, `onboard:candidates`, `onboard:install`, and `doctor`.
- JSON and markdown output are deterministic and do not write canonical SSOT files.
