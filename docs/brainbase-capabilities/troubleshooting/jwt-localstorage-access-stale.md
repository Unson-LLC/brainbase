# Troubleshooting: Stale Token in Device Authorization

## Symptom

The `/device` approval flow reports missing authentication information or rejects approval after returning from organization OAuth. A recently changed grant may also be absent from a client token issued before the change.

## Cause

`auth_grants.project_codes` is reflected in issued access tokens. The retained device-authorization page reads `localStorage["brainbase.auth.token"]` after its OAuth callback and sends it to `/api/auth/device/approve`. A browser can therefore retain a token issued before an Auth Grant change.

## Fix

1. If an Auth Grant changed, obtain a fresh token through the supported login/refresh flow for the client using it.
2. For `/device`, restart the approval flow and complete organization OAuth again so the callback stores a fresh token. Do not paste the token into logs or chat.
3. If the fresh token is still rejected, stop retrying and inspect the Auth Grant and server response; do not fall back to the retired project selector.

## Verification

Use `GET /api/auth/verify` with the newly issued token, then retry device approval. When the endpoint returns access claims, confirm `access.projectCodes` reflects the expected grant. An HTTP success alone does not prove that a different API/MCP project scope is authorized.
