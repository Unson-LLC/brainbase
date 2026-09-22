# Public Streamable HTTP MCP Transport Spec

## Invariants

- INV-1: The transport is framework-neutral Node HTTP code and does not
  contain organization, tenant, deployment, or secret-provider policy.
- INV-2: Existing stdio behavior and the 18 existing tool definitions are
  unchanged.
- INV-3: Each initialized HTTP session owns one MCP `Server` and one
  `StreamableHTTPServerTransport`; both are closed when the session is
  deleted, aborted, or the handler shuts down.
- INV-4: Input body size is bounded before JSON parsing and malformed JSON is
  reported as JSON-RPC parse error `-32700`.

## Contracts

- C-1: `@unson/brainbase-mcp/streamable-http` exports
  `createStreamableHttpHandler` and `createStreamableHttpServer`.
- C-2: `createServer` is required dependency injection; `authenticate`,
  `requestScope`, and `health` are optional dependency injection points.
- C-3: MCP requests use `POST /mcp`; `GET /mcp` is rejected with `405` and
  `DELETE /mcp` closes a valid session.
- C-4: The default body limit is 1 MiB and is configurable with
  `bodyLimitBytes`.
- C-5: Health uses `GET /health`, is independent of MCP authentication, and
  returns the injected result or `{ "status": "ok" }`.

## Scenarios

- S-1: `initialize` returns a JSON-RPC result and `Mcp-Session-Id`; the same
  session can call `tools/list` and `tools/call`.
- S-2: An authenticator returning `null` receives `401` and no MCP server is
  created.
- S-3: `GET /mcp` receives `405` with `Allow: POST, DELETE`.
- S-4: Invalid JSON receives `400` with JSON-RPC error code `-32700`.
- S-5: A body above the configured limit receives `413`.
- S-6: Deleting a session and closing the handler invoke cleanup for the
  transport and injected server.

## Anti-patterns

- AP-1: Do not add Unson URLs, tenant lookup, service/shared token handling,
  Infisical access, company authority, or private Graph auth.
- AP-2: Do not duplicate or rename the existing stdio tools.
- AP-3: Do not leave stateful transports or MCP servers alive after DELETE,
  request abort, or handler shutdown.
