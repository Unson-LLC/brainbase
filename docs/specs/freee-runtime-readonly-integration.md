# freee Remote MCP runtime integration — read-only first slice

## Status

**Draft / not production-ready.** This document records the reviewed architecture after cross-repository review of the initial mana-runtime and Brainbase prototypes.

The first prototype attempted to carry the official Remote MCP request through the generic credential-forwarding wire contract. That design is rejected for production because the generic contract does not preserve dynamic MCP session/protocol headers and its response encoding is operation-static. The reviewed direction is to **terminate the official freee Remote MCP inside Brainbase** and expose a smaller, tenant-aware, read-only internal MCP surface to mana-runtime.

## Goal

Allow mana-runtime to read the minimum freee accounting data needed for back-office reconciliation without exposing freee credentials to the sandbox and without enabling business-data mutations.

Primary initial use cases:

- inspect bank/account transaction data already imported into freee
- inspect issued invoices / receivables needed for reconciliation
- compare deposits with outstanding invoices
- report likely matches, unmatched deposits, and unpaid invoices

Actual mutation/reconciliation in freee is explicitly out of scope for the first slice.

## Architecture decision: Brainbase terminates the upstream MCP

### Rejected prototype

The initial prototype used:

`mana sandbox -> freee-mcp.internal -> tenant credential fetch -> generic trusted provider forwarder -> https://mcp.freee.co.jp/mcp`

The generic provider wire contract carries structured path/query/body fields but not arbitrary request/response headers. MCP Streamable HTTP may require `Mcp-Session-Id`, `MCP-Protocol-Version`, and `Accept` to survive initialization and subsequent calls. The generic forwarder also chooses response encoding statically per operation, while MCP responses may be JSON or SSE.

Do not productionize that direct path. The companion mana-runtime PR has removed the superseded direct `freee.mcp.post` mapper and its test coverage.

### Accepted direction

Use:

`mana sandbox -> freee-mcp.internal -> Brainbase private runtime service -> Brainbase freee MCP terminator -> official freee Remote MCP`

Brainbase owns:

- Remote MCP OAuth authorization state
- MCP access/refresh credential material
- upstream MCP protocol/session lifecycle
- upstream JSON/SSE normalization
- company binding
- provider/account selection
- refresh/re-auth handling
- rate limiting and audit

mana-runtime sees a **stateless, normalized internal MCP surface** and never receives the upstream Remote MCP session id or OAuth credential.

The mana-facing internal endpoint **MUST be stateless**. It MUST NOT issue or require `Mcp-Session-Id`. Brainbase may maintain one or more upstream official freee MCP sessions internally, but those sessions are implementation details owned entirely by Brainbase and are not keyed by a session id supplied by the sandbox.

If the Brainbase internal endpoint accidentally returns `Mcp-Session-Id`, mana-runtime MUST fail visibly rather than silently strip the header and continue. Likewise, a sandbox request carrying `Mcp-Session-Id` is invalid for this boundary and MUST be rejected locally. This prevents a future terminator implementation from accidentally depending on client-visible session state that the internal contract does not support.

The internal surface MUST fail closed when Brainbase termination is unavailable. mana-runtime must not fall back to direct internet access to `mcp.freee.co.jp`.

## Runtime capability boundary

Model exposure and network reachability are separate gates.

The initial signed runtime capability id is:

`freee:runtime_read`

A placement may only reach `freee-mcp.internal` when the resolved signed tenant context contains `freee:runtime_read` in `authorization.capability_ids`. Merely registering `freee` in the runtime MCP config, or adding the internal host to the sandbox's static host interception table, is insufficient authorization.

The companion mana-runtime PR also keeps an explicit code-level `enableFreee` gate around MCP registration. Production enablement therefore requires both:

1. the runtime/configuration gate that exposes the MCP to the model; and
2. the signed `freee:runtime_read` capability that authorizes each resolved tenant context to reach the internal endpoint.

Brainbase must not mint `freee:runtime_read` until tenant isolation, account selection, OAuth scope, company binding, terminator behavior, revocation, rate limiting, timeout, and contract tests described below are ready.

## Authentication model

freee Remote MCP introduces two OAuth layers:

1. Brainbase acts as an OAuth client of freee Remote MCP and stores the MCP access/refresh credential.
2. The official freee Remote MCP owns the downstream freee API access/refresh credential and refreshes it internally.

Brainbase MUST NOT store the user's freee password. Raw MCP access/refresh material belongs in the existing tenant credential store. PostgreSQL stores only an opaque credential reference.

The connect UX may originate from Slack/Mana, but the user authenticates in the browser on freee's authorization screen.

## OAuth data scope is the primary data boundary

"Read-only" at the MCP tool layer only constrains verbs. It does **not** constrain which categories of data a GET can read.

Before the OAuth control plane is implemented, the exact requested freee scopes MUST be enumerated and reviewed. The first production slice should request only the accounting/invoice read scopes required for the reconciliation use cases above. It must not request HR/payroll, attendance, personnel, sales, IT-management, or write scopes unless separately approved.

Exact scope identifiers are a blocking implementation item and must be taken from the current freee authorization metadata/application configuration; do not guess them in code.

## Company/account binding

The model MUST NOT choose or mutate the active freee company at runtime.

`freee_set_current_company` is not exposed in the first slice.

The authorized freee company is fixed server-side on the selected `integration_accounts` record using a reviewed external account/company identifier. Brainbase verifies every upstream freee API request is consistent with that configured company.

If a credential can access multiple companies, each runtime-readable company should be modeled as an explicit configured integration target rather than sharing mutable "current company" state between concurrent users/sessions.

## Existing Brainbase primitives reused

- `integration_accounts` / `integration_account_defaults` for provider account selection
- tenant credential store for encrypted `credential_material` and `credential_refresh_material`
- short-lived one-use credential lease semantics where appropriate at the internal boundary
- OAuth refresh compare-and-swap for safe credential rotation
- Slack installation OAuth control plane as the implementation pattern for browser callback -> credential store -> opaque reference registration

The generic trusted provider forwarder is **not** the upstream MCP transport for the final design. Brainbase's freee terminator owns upstream MCP protocol handling directly.

## Account selection contract

The initial runtime purpose is `runtime_read` and requires account capability `read`.

Selection specificity is:

1. project default
2. organization default
3. personal default

Within the same specificity, selection is deterministic and based on the **distinct integration account**, not merely the number of matching subjects:

- enumerate all defaults for authorized subjects at that specificity
- order deterministically using byte/C-style string order, not locale-dependent collation
- deduplicate by `account_id`
- one distinct account -> select it
- more than one distinct account -> `INTEGRATION_ACCOUNT_AMBIGUOUS`

PostgreSQL reads use `priority ASC, account_id COLLATE "C" ASC`; the InMemory repository uses matching locale-independent string ordering. This avoids ICU/database-collation drift in the legacy-duplicate case.

Therefore the same authorized organization-level freee account may legitimately be the runtime default for multiple projects without becoming ambiguous.

The default subject answers "which account is preferred in this context". It does not redefine the selected account's own scope. The selected account itself must independently satisfy the signed authorization context:

- `scope_type = personal` -> `owner_person_id` equals the actor
- `scope_type = org` -> `org_id` is in the authorized organization ids
- `scope_type = project` -> `project_id` is in the authorized project ids

Resolver output MUST keep these meanings separate:

- `default_subject_type` / `default_subject_id`: the contextual default that selected the account
- `account_scope_type` / `account_scope_id`: the selected account credential's actual validated authority scope

Do not collapse these back into generic `subject_type` / `subject_id` fields. In particular, an organization-scoped freee account selected by a project default must still be audited as organization-scoped credential authority.

The selected account must also:

- have `service = freee`
- have `status = connected`
- include capability `read`
- reference `provider = brainbase-credential-store`
- contain a canonical single-segment `credref://bbcs/<opaque-id>` reference, never token material
- contain/fix the intended freee company identifier

The resolver deliberately does **not** return a `provider` field derived from `integration_accounts.service`. That would be an unverified provider assertion. Provider identity must come from authoritative credential metadata at the broker/store boundary.

The canonical credential store currently emits opaque `credref://bbcs/<digest>` references. Service identity therefore MUST NOT be inferred from path text; the credential broker/store metadata must verify provider identity independently and fail closed when provider metadata is absent.

## Tenant isolation blocker

`integration_accounts` currently has no `tenant_id` column and its repository lookups are not tenant-scoped. The freee runtime path MUST NOT be wired to production until the authority for tenant isolation is explicit and tested.

Before production, choose and implement one of:

- add `tenant_id` to integration accounts/defaults and enforce tenant-scoped queries/RLS, or
- place the account repository behind an existing canonical tenant-scoped relation that proves org/project/person identifiers belong to the active tenant.

"The upstream context should be correct" is not sufficient for credential selection.

## Default storage and migration safety

Legacy schema permits multiple rows for `(subject_type, subject_id, service, purpose)` because `account_id` is part of the primary key.

The repository therefore must not silently rely on one row. Both InMemory and PostgreSQL implementations enumerate defaults with deterministic `priority ASC` plus matching C/byte-style account-id ordering, and the runtime resolver explicitly evaluates every matching row.

A database uniqueness constraint may be desirable later, but it is **not added by this PR**. Production must first run this preflight:

```sql
SELECT subject_type, subject_id, service, purpose, count(*)
FROM integration_account_defaults
GROUP BY 1,2,3,4
HAVING count(*) > 1;
```

If the result is non-empty, any deduplication policy must be reviewed and applied in a dedicated migration before creating a unique index. This is intentionally separated because the current M5A migration applies several schema files in one transaction; an unverified unique index could roll back unrelated changes.

Runtime safety does not depend on that future index: multiple defaults resolving to distinct account ids fail closed as ambiguous, while duplicates that resolve to the same account are safely deduplicated.

## freee OAuth control plane

Add a browser OAuth flow modeled after the Slack installation control plane:

1. Slack/Mana asks Brainbase for a connect URL.
2. Browser follows Remote MCP OAuth authorization.
3. Callback exchanges the code using PKCE.
4. MCP access + refresh material is stored in the tenant credential store.
5. An `integration_accounts` record is created or reauthorized with the opaque credential reference and fixed company identifier.
6. A `runtime_read` default is assigned at the intended tenant-scoped org/project/personal context.
7. Slack receives a safe success/failure result; no token appears in logs, redirects, DB rows, or chat.

## MCP access-token refresh

When the Remote MCP access token expires:

1. use the stored MCP refresh token at the Remote MCP token endpoint
2. store rotated access/refresh material as a new credential version/reference
3. compare-and-swap the active integration credential reference
4. revoke or retire old material after a successful swap
5. return `reauth_required` when refresh is rejected

This is distinct from downstream freee API token refresh, which is owned by the official Remote MCP service.

## Revocation semantics

An integration account changing to `revoked`, `disabled`, or `reauth_required` must block new runtime operations immediately.

Any credential lease used at the Brainbase internal boundary remains one-use and <=60 seconds. Production design must ensure a revoked/rotated credential cannot be newly materialized after account status changes; long-lived upstream freee sessions must be invalidated or discarded when the integration credential revision changes.

## Read-only internal MCP boundary

The initial mana-visible tool allowlist is intentionally small:

- `freee_api_get`
- `freee_api_list_paths` only if path discovery itself is approved for the scoped services
- `freee_auth_status`
- `freee_get_current_company`
- `freee_list_companies` only if required for diagnostics and safe under the fixed-company model
- `freee_current_user`
- `freee_server_info`

Not exposed:

- `freee_set_current_company`
- `freee_clear_auth`
- `freee_api_post`
- `freee_api_put`
- `freee_api_patch`
- `freee_api_delete`
- any future MCP method/tool not explicitly allowlisted

Malformed JSON and unknown MCP request methods fail locally rather than being delegated upstream. Well-formed JSON-RPC response messages required to answer server-initiated MCP requests may pass the internal transport. `notifications/cancelled` is also treated as lifecycle traffic.

This tool allowlist is defense-in-depth; Brainbase authorization and OAuth data scopes remain the authoritative boundaries.

## Transport normalization

The Brainbase terminator must complete and test a real Remote MCP handshake (`initialize` and at least one subsequent call) against the official service before production enablement.

It owns upstream:

- `Mcp-Session-Id`
- `MCP-Protocol-Version`
- `Accept: application/json, text/event-stream`
- JSON vs SSE response handling
- bounded response buffering/streaming
- safe response-header allowlisting

The mana-facing internal MCP response is normalized and **stateless by contract**. Upstream `Mcp-Session-Id`, cookies, content-encoding, and arbitrary headers do not cross into the sandbox. An internal response that contains `Mcp-Session-Id` is a contract violation and must fail visibly, not be silently normalized into an apparently successful response.

## Timeout budget

The final internal Brainbase freee transport must have an explicit measured timeout budget. Do not invent a value before the terminator exists and can be measured, and do not advertise an outer timeout that an inner hop silently overrides.

The mana companion PR currently keeps freee activation fail-closed behind an explicit code gate and removes the superseded direct generic-forwarder route. That gate MUST remain closed until the final terminator transport has a measured/configured timeout and contract tests.

## Rate limits

freee API quota is shared by the selected integration account. The implementation must define per-account runtime limits and use `rate_limit_profile_id` or an equivalent Brainbase-owned policy before broad autonomous reads are enabled.

## Required tests before production

At minimum:

1. real/contract Remote MCP `initialize` -> session -> subsequent read handshake entirely inside Brainbase upstream handling
2. mana-facing internal endpoint remains stateless; any `Mcp-Session-Id` crossing that boundary is rejected visibly
3. signed tenant context without `freee:runtime_read` cannot reach `freee-mcp.internal`
4. unknown MCP request methods and write tools fail closed
5. well-formed JSON-RPC response messages required by the MCP lifecycle can traverse the internal endpoint
6. `freee_set_current_company` is absent/rejected
7. caller-supplied auth/cookies/upstream session ids never reach Brainbase/upstream incorrectly
8. Slack credential + freee target is rejected
9. credential provider metadata missing/null fails closed
10. cross-tenant integration account selection is impossible
11. same-specificity defaults to different accounts fail as ambiguous; the same account selected by multiple subjects deduplicates deterministically
12. default subject metadata and actual account credential scope remain distinct in resolver/audit output
13. InMemory and PostgreSQL legacy-default ordering agree under C/byte-style collation
14. revoked/reauth account blocks new calls
15. response JSON/SSE normalization is bounded and deterministic
16. selected company cannot be changed by the model
17. OAuth scopes contain only the reviewed read scopes
18. final internal transport has a measured/configured timeout

## Cross-repository dependency

Companion mana-runtime branch: `feature/freee-mcp-readonly` / PR #1110.

That PR removes the superseded direct `freee.mcp.post` generic-forwarder mapping, requires the mana-facing endpoint to stay stateless, normalizes response headers, rejects session-state leakage, gates direct internal-host reachability on the signed `freee:runtime_read` capability, and requires explicit code-level freee enablement. Both gates must remain closed until the Brainbase terminator and remaining production blockers are complete.


## Phase 5a safety boundary (before OAuth or live freee traffic)

The first implementation after the disabled foundation MUST remain offline from
the official freee Remote MCP. Its purpose is to make the eventual live boundary
fail closed before any real accounting data is read.

### Explicit tenant binding

Runtime freee credential resolution MUST require an
`integration_account_tenants` binding for the selected integration account.
An integration account may belong to exactly one tenant. Organization/project
scope remains a separate authorization dimension and MUST NOT substitute for
tenant ownership.

A missing or mismatched tenant binding fails with
`INTEGRATION_TENANT_MISMATCH`. Existing integration accounts are not
implicitly assigned to a tenant by migration.

Creating a tenant binding is an audited operation. Repository binding writes a
`TENANT_BOUND` account audit event in the same transaction as the PostgreSQL
binding write. Tenant ownership is applied before default-account ambiguity
resolution so another tenant's defaults cannot block resolution for the current
tenant.

### Initial read allowlist

The initial runtime surface permits only `freee_api_get` with
`service=accounting` for these paths:

- `/api/1/invoices`
- `/api/1/invoices/{id}`
- `/api/1/deals`
- `/api/1/deals/{id}`
- `/api/1/partners`
- `/api/1/partners/{id}`

No HR/payroll, invoice-service, PM, sales-management, IT-management, file,
write, or arbitrary path access is included in this phase.

The model-supplied path MUST NOT contain `?` or `#`. For a freee
integration account, `integration_accounts.external_account_id` is the
authoritative server-side freee Accounting `company_id`. Runtime credential
resolution validates that value as a positive integer and places it on the
frozen resolved credential object.

The read policy MUST accept that resolved credential object rather than a
standalone caller-supplied company id. It injects the resolved `company_id`;
a conflicting model-supplied `company_id` MUST be rejected rather than
overwritten silently.

Tool-call and argument objects are deny-by-default. Unknown top-level fields are
rejected. Query parameters are path-specific and deny-by-default: collection
paths initially allow only `company_id` and `limit`; detail paths allow only
`company_id`. No `offset` or arbitrary future query key is accepted in this
phase.

### Bounded reads

The initial boundary uses a default page limit of 50 and rejects limits above
100. A production terminator MUST have an injected rate limiter; absence of the
limiter is a 503 fail-closed condition. The policy target is at most 30 freee
read calls per tenant/account per minute.

A single upstream response is capped at 1 MiB before it can be normalized into
the mana-facing MCP response. Exceeding the limit is a visible 502, including
when `Content-Length` is absent or understates the streamed body.

The only public execution entrypoint for a freee read is
`executeFreeeRead(...)`. It authorizes one tool call, consumes rate-limit
budget for that call, invokes the supplied upstream adapter, and applies the
response-size ceiling. A JSON-RPC batch MUST invoke this boundary once per
`tools/call` item; rate limiting is never per HTTP batch.

Brainbase is the authoritative deny-by-default freee gate. The broader
mana-runtime read-only tool list is not authority. Until explicitly added to
this Brainbase boundary, management tools such as `freee_list_companies`,
`freee_current_user`, `freee_auth_status`, and
`freee_get_current_company` MUST be rejected even if mana advertises them.
Before activation, mana-runtime's visible tool allowlist should be narrowed to
match this Brainbase policy.

### Activation state

This phase does not:

- call `https://mcp.freee.co.jp/mcp`,
- start OAuth,
- store a freee/MCP token,
- mint `freee:runtime_read`, or
- enable the mana-runtime freee MCP registration.

Live Remote MCP OAuth/session handling, an OAuth/connect flow that records the
selected freee Accounting company id into
`integration_accounts.external_account_id`, distributed rate-limit storage,
audit/retention review, narrowing mana-runtime's visible freee tool allowlist,
and a real initialize -> read handshake remain blockers before activation.
