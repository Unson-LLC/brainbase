# Antigravity judgment host support (`'antigravity'`) — unreleased (breaking)

Unreleased; publish needs separate approval. The latest release tag is `v0.50.27`,
which restricts `RemoteJudgmentHookHost`, `JudgmentExecutionHostType`, and
`JudgmentRuntimeRuntimeContext['host']` to `'remote' | 'claude-code'` /
`'codex' | 'claude-code'`. The release that first ships this change must call it
out as a breaking TypeScript change and choose its version accordingly.

## Changed public surface

| Kind | Name | Note |
|---|---|---|
| type | `RemoteJudgmentHookHost` from `@unson/brainbase-mcp/remote-judgment-hook-http` | Widened from `'remote' \| 'claude-code'` to `'remote' \| 'claude-code' \| 'antigravity'`. `handleRemoteJudgmentHookRequest` now accepts `x-brainbase-judgment-host: antigravity` under the same owner-local-bridge or person-authenticated JWT boundaries as `claude-code`, including `PreToolUse` and hosted Stop journal publishing. |
| type | `JudgmentExecutionHostType` from `@unson/brainbase-mcp/judgment-execution-outcome` | Widened from `'codex' \| 'claude-code'` to `'codex' \| 'claude-code' \| 'antigravity'`. `normalizeJudgmentExecutionOutcome` and `EXECUTION_OUTCOME_HOSTS` accept `'antigravity'`. |
| type | `JudgmentRuntimeRuntimeContext['host']` and `['entrypoint']` from `@unson/brainbase-mcp/judgment-runtime-resolution` | Widened `host` from `'codex' \| 'claude-code'` to `'codex' \| 'claude-code' \| 'antigravity'` and `entrypoint` to include `'antigravity'`. |
| function | `selectJudgmentProjectBinding` from `@unson/brainbase-mcp/judgment-project-binding` | Honors explicit `configuredProjectCode` ahead of `relayProjectCode` for `hostRuntime === 'antigravity'` (matching `'claude-code'`). |
| function | `toKnowledgeEventFromJudgmentEpisode` from `@unson/brainbase-mcp/judgment-event-adapter` | Emits `source.type: 'agent_judgment'` for `outcome.host.type === 'antigravity'` (matching `'claude-code'`). |

### Why this is a breaking TypeScript change

TypeScript consumers that perform exhaustive checks on `RemoteJudgmentHookHost`,
`JudgmentExecutionHostType`, or `JudgmentRuntimeRuntimeContext['host']`, or that
assign those properties to narrower literal unions, will fail to compile under
`--strict` until `'antigravity'` is handled:

```ts
import type { RemoteJudgmentHookHost } from '@unson/brainbase-mcp/remote-judgment-hook-http';
declare const host: RemoteJudgmentHookHost;
const narrow: 'remote' | 'claude-code' = host; // TS2322
```

### Additive public surface

- New subpath export `@unson/brainbase-mcp/antigravity-judgment-hook` providing the
  Antigravity CLI judgment hook adapter (`handleAntigravityJudgmentHook`,
  `registerAntigravityJudgmentHooks`, `normalizeAntigravityToolName`,
  `resolveAntigravityHookEndpoint`, `normalizeAntigravityHookBaseUrl`, config and
  transcript extraction helpers).
- New CLI commands:
  - `brainbase judgment:antigravity-hook [--config path] [--registration id]`
  - `brainbase judgment:install --target antigravity --origin <baseUrl> [--server <url>] [--project <code>] [--allow-non-git] [--cwd-prefix <path>] [--repositories <host/owner/name,...>] [--settings <hooks.json>] [--config <path>] [--dry-run] [--remove]`
- Additive exports on `@unson/brainbase-mcp/claude-code-judgment-hook`
  (`RepositoryScope`, `resolveRepositoryScope`, `bearerTransportSafe`,
  `digestSummary`, `singleQuotedWords`) and `@unson/brainbase-mcp/judgment-execution-outcome`
  (`EXECUTION_OUTCOME_HOSTS`).

## Runtime compatibility

- Existing `'remote'`, `'codex'`, and `'claude-code'` callers and CLI flags
  (`judgment:install --target claude-code`, `judgment:claude-code-hook`) keep
  identical runtime behavior.
- Unknown `x-brainbase-judgment-host` values continue to be rejected with HTTP 400
  `judgment_hook_host_unsupported`.

## Consumers

- In-repository consumers and test suites compile and pass with `'antigravity'`.
- Downstream hosted MCP servers (`brainbase-unson`) must propagate
  `options.host === 'antigravity'` to `BRAINBASE_JUDGMENT_HOST_RUNTIME='antigravity'`
  when upgrading to the published release containing this change.

## Migration

1. Update exhaustive `switch` statements or literal union annotations on
   `RemoteJudgmentHookHost`, `JudgmentExecutionHostType`, and
   `JudgmentRuntimeRuntimeContext['host']` to include `'antigravity'`.
2. In downstream Host wrappers that branch on `options.host === 'claude-code'`,
   handle `'antigravity'` explicitly instead of falling back to `'codex'`.

No npm publication, version bump or deployment is included.
