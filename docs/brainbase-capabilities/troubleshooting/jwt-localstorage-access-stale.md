# Troubleshooting: JWT Or localStorage Access Is Stale

## Symptom

`auth_grants.project_codes` was updated, but the UI still behaves as if the old project list is active.

## Cause

Brainbase copies `auth_grants.project_codes` into issued JWT/access payloads. The browser may keep an old value in:

```text
localStorage["brainbase.auth.access"]
localStorage["brainbase.auth.token"]
```

## Fix

Use one of:

1. Logout and login again.
2. Refresh the session through `/api/auth/refresh`.
3. Clear stale auth localStorage keys and login again.

## Verification

After refresh, confirm the browser-side `access.projectCodes` contains the newly added projects.
