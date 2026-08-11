# Knowledge source resolution refactoring architecture

## Decision

`knowledge.resolve` is a stateless routing boundary. Canonical locations are derived only from server-owned route definitions. Public callers cannot provide or override a canonical location. A future receipt store may be consulted only after it has a server-owned integrity boundary; it is not part of this change.

The MCP adapter owns JWT extraction, project-scope authorization, API transport, and conversion to MCP error envelopes. Those mechanics are implemented once in a reusable authenticated API helper. The knowledge tool owns only its input schema and endpoint-specific invocation.

MCP extension tool dispatch uses an ordered handler registry. The order remains control-plane, onboarding, knowledge resolution, task, mesh, followed by the legacy fallback.

## Invariants

- Unknown or unavailable evidence is returned as unconfirmed and never converted to absence.
- Canonical location is never accepted from an untrusted request.
- Project access is checked before the API request.
- Existing public tool names and success response shapes remain compatible.
- Refactoring does not add storage, network side effects, or UI behavior.

## Verification

- Service unit tests cover every route, invalid combinations, and ignored/rejected receipt-shaped input.
- API tests cover authentication registration and 400 error conversion.
- MCP tests cover authentication, scope, upstream errors, and dispatcher fallback/order.
- Full MCP tests and TypeScript typecheck guard compatibility.
