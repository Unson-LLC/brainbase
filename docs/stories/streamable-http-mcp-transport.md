# Public Streamable HTTP MCP Transport

## Story

As a public Brainbase MCP consumer, I want to expose the unchanged Brainbase
tool contract over Streamable HTTP so that a client can complete the MCP
initialize, list, and call lifecycle without importing an organization or
deployment implementation.

## Scope

- The transport is a public package subpath: `@unson/brainbase-mcp/streamable-http`.
- Authentication, server creation, request scope, and health are dependency
  injection points.
- The transport owns request body limits, JSON-RPC parse/lifecycle handling,
  stateful session cleanup, and generic HTTP status responses.
- The existing stdio entrypoint and the existing 18 tool names and input
  schemas remain unchanged.
- Organization URLs, tenant mapping, service/shared tokens, Infisical,
  company authority, and private Graph authentication are out of scope.

## Acceptance Criteria

1. A caller can create a Node HTTP server with the public subpath and inject
   `authenticate`, `createServer`, `requestScope`, and `health`.
2. A stateful client can complete `initialize`, `tools/list`, and
   `tools/call` with JSON responses and a returned MCP session id.
3. Requests over the configured body limit return `413`; malformed JSON
   returns JSON-RPC parse error `-32700`.
4. Unauthorized requests return `401`, and `GET /mcp` returns `405`.
5. `DELETE /mcp` and handler shutdown release the transport session and the
   injected MCP server.
6. Stdio startup and the exact existing 18-tool contract continue to pass.

## Verification

- `npm run build`
- `npm test -- tests/streamable-http.test.ts tests/mcp-contract.test.ts`
- `git diff --check`
- Graphify impact context before and after implementation
