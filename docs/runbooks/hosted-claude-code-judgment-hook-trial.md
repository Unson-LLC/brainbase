# Hosted Claude Code judgment hook trial

This trial requires a published package version exporting `remote-judgment-hook-http` and a non-production hosted MCP environment that wires `handleRemoteJudgmentHookRequest` to its HTTP listener and canonical judgment dispatcher. Publishing and production deployment are outside this trial. This package supplies the HTTP acceptance boundary; it does not install a Claude Code hook script.

The host must verify authentication before invoking the handler. Use `remoteJudgmentHookHostFlags(authKind, isOwnerLocalBridge)` with server-verified inputs: a person JWT sets `personHostedClaudeCodeAllowed`; shared-bearer authentication sets `localClaudeCodeAllowed` only on the owner's verified loopback bridge. Company-authority authentication sets neither flag. Never derive these flags or the trusted principal from request headers or body identity claims. The host must enforce the body limit while reading the request, too.

On the person-JWT path, wire `isAuthorized: () => true` and `bearerToken: ''` only inside the branch reached after successful Host JWT verification; unverified requests must never reach this pass-through.

For the hosted path, the verified principal must have a non-empty trimmed `tenantId` and include the selected project code in `projectCodes`. Pass the verified principal, token, and authentication kind through the handler request. A shared bearer token is not accepted for a remote `claude-code` declaration, even when the hosted flag is set.

Import `createJudgmentJournalTurnPublisher` from `@unson/brainbase-mcp/judgment-journal-turn-publisher` and pass its result as the handler's optional `journalTurnPublisher`.
Configure it with `{ apiBaseUrl, journalRoot, fetch?, onError? }`, using the same journal root as the canonical dispatcher.
After an accepted hosted person-JWT Claude Code Stop, it reads the finished journal and posts to `/api/organization/judgment-journal/turns` with `trustedToken`.
Publication includes `turn_input` prompt text and tool events, along with the episode, receipt, final record, and optional value proof.
The publisher requires a nonblank trusted principal and checks `owner_person_id` and `tenant_id` against it when those episode fields are present; mismatches block publication with `judgment_journal_files_invalid`. Episodes without owner fields are published for compatibility with the current host writer.
For the current host shape, the receiving API’s receipt-owner check is the binding: `POST /api/organization/judgment-journal/turns` (`packages/server-parts/judgment-journal-db/store.js`, `recordTurn`/`withOwner`) accepts a turn only when a `judgment_receipts` row has the same `resolution_id` and `owner_person_id` equal to the JWT person. B posting A’s turn is rejected and nothing is stored under B. Hosts should add `owner_person_id` and `tenant_id` from verified identity to episodes in a follow-up.
Shared-bearer, owner-loopback, and remote hosts do not publish; missing configuration or publication failures preserve the hook response and report only a safe reason code.

## Person's trial settings

Configure your hook adapter with settings equivalent to:

```sh
BRAINBASE_JUDGMENT_ORIGIN=https://mcp-trial.example.net
BRAINBASE_MCP_ACCESS_TOKEN=<your-personal-MCP-access-token>
BRAINBASE_PROJECT_CODE=trial-project
```

These are illustrative adapter settings, not environment variables automatically read by this package. Use an HTTPS origin for the non-production hosted MCP and a project code allowed by your verified principal. Local loopback port 39002 is not required for this hosted path. Keep the access token out of committed configuration and logs.

## HTTP contract

Send `POST /host/judgment/hook` with these headers:

```http
Authorization: Bearer <your-personal-MCP-access-token>
Content-Type: application/json
x-brainbase-judgment-host: claude-code
x-brainbase-project-code: trial-project
```

The host maps these headers to `authorization`, `declaredHost`, and `projectCode`. The JSON object must include a supported `hook_event_name`, a non-empty `session_id`, and a non-empty `turn_id`. Supported Claude Code events are `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `Stop`. The adapter must supply a stable turn identity and pass through the event's tool or prompt fields as required by the dispatcher. Maximum body size is 1 MiB. Project codes match `[a-z0-9][a-z0-9._-]{0,63}`.

Example body:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "trial-session",
  "turn_id": "trial-turn",
  "prompt": "Review the current project decision."
}
```

A successful response has status 200, `schema_version: "1"`, `accepted: true`, echoed event/session/turn identity, and an `output` object. `UserPromptSubmit` requires a canonical `receipt_id` and a 64-character lowercase hexadecimal `route_resolution_sha256`; `Stop` includes them when supplied. The adapter must apply `output` according to Claude Code's hook protocol; HTTP acceptance alone does not mean a tool succeeded or permission was granted.

Check an allowed project first, then verify that a missing or invalid project returns 400, an out-of-scope project returns 403, and a shared-bearer or company-authority Claude Code declaration returns 400 with `judgment_hook_host_unsupported`. Missing authentication returns 401. Missing hosted principal or blank tenant returns 403. Dispatcher failures fail closed with 503, or 403 for canonical scope denials; the adapter must surface these failures rather than silently treating them as success.
