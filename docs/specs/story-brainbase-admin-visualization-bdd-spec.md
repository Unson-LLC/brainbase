# story-brainbase-admin-visualization-bdd Spec

## Invariants

- INV-1: Every admin row, card, graph item, candidate item, context item, and health item exposes a `source_class`.
- INV-2: Graph SSOT records are never mixed into candidate-store collections.
- INV-3: candidate-store records are never presented as promoted Graph truth unless `promotion_status` and `promoted_graph_entity_id` show that relationship explicitly.
- INV-4: AI Context Preview describes the context that will be passed to AI, not the full set of saved records.
- INV-5: Personal KG is displayed as a read model over owner-visible candidate-store records, never as a separate replacement for Graph SSOT.
- INV-6: `/api/admin/*` is read-only and does not create, update, promote, or delete Graph/candidate data.
- INV-7: `/api/admin/*` requires authenticated access via existing Brainbase auth middleware.
- INV-8: Health/config responses never include secret values, tokens, connection strings, private keys, or raw credential JSON.
- INV-9: Missing Graph/candidate/Personal KG dependencies produce partial `unavailable` health, not a dashboard-wide 500.
- INV-10: Japanese is the default/fallback UI language for user-facing labels.
- INV-11: Unimplemented external RAG or derived-index product names are not shown in the admin UI unless a real configured integration exists in Brainbase.
- INV-12: Personal KG owner filters must not silently fall back to the logged-in owner when the requested owner is outside the caller access scope.
- INV-13: The browser never receives a DB connection string; Personal KG and DB health are read through Brainbase server endpoints.
- INV-14: Personal KG owner-read can bypass generic `role_min`/`sensitivity` hiding only for the canonical owner or configured owner aliases; outside-owner requests remain denied with warnings.
- INV-15: Admin HTML, admin assets, `/api/admin/*` responses, and browser requests avoid cached admin state so hard reload and reload controls reflect the current server-pattern SSOT state and current authentication recovery UI.
- INV-16: The admin shell is the primary operating surface and can start Brainbase login without linking users back to the normal screen.
- INV-17: Admin Slack login recovery preserves the current-origin admin URL in OAuth state for same-window callbacks on localhost and allowed production origins, returns the auth payload through a URL fragment on the admin origin, and invalid state, unsupported Slack mode callback, or unresolved Slack identity fail closed without falling back to the normal screen.
- INV-18: Slack callback HTML escapes redirect attributes and state redirect takes precedence over query redirect so an attacker cannot override `/admin.html` or inject HTML attributes.
- INV-19: Admin auth initialization preserves existing Brainbase auth branches: bearer token verification, same-origin cookie session verification, refresh-token retry after 401, and Slack callback fragment consumption.

## Contracts

- Contract-1: `GET /api/admin/overview` returns `sources`, `graph`, `candidates`, `personal_kg`, and `runtime_config`.
- Contract-2: `GET /api/admin/graph/entities` returns `{ source_class: "graph_ssot", records: [...] }`.
- Contract-3: `GET /api/admin/candidates` returns `{ source_class: "candidate_store", records: [...] }`.
- Contract-4: `POST /api/admin/context-preview` returns `{ source_class: "ai_context", preview, warnings }`.
- Contract-5: `GET /api/admin/health` returns source health and DB connection status from a server-side connectivity check, without secret values.
- Contract-6: The UI uses Japanese labels for Overview, Graph SSOT, candidate-store, AI Context, data flow, and settings/health.
- Contract-7: `GET /api/admin/personal-kg` returns `{ source_class: "personal_kg", owner_person_id, summary, records, warnings }`; DB-backed repositories aggregate Personal KG summary server-side and return only a bounded record page.
- Contract-8: `GET /api/admin/personal-kg?owner=<other>` returns an out-of-scope result with `requested_owner_person_id`, no records, and a warning when the caller cannot inspect that owner.
- Contract-9: Health source summaries use `available`, `partial`, or `unavailable` to represent source-specific readiness without claiming whole-dashboard health.
- Contract-10: Admin HTML and assets are served with `Cache-Control: no-store` semantics or explicit asset versioning; Admin API responses include `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Pragma: no-cache`, and `Expires: 0`; UI fetches use `cache: "no-store"` and `Cache-Control: no-cache`.
- Contract-11: 401 admin fetch errors render Japanese auth guidance plus a management-page login action, without exposing raw backend auth text or a normal-screen link.
- Contract-12: `GET /api/auth/slack/start?redirect=<current-origin>/admin.html` stores the redirect in OAuth state, and `GET /api/auth/slack/callback` uses the state redirect for HTML fallback before any query redirect; absolute redirects are preserved only for localhost or configured allowed origins such as `https://bb.unson.jp`, while untrusted origins fall back safely. Non-oauth callback without Slack access token and unresolved Slack identity return 401.
- Contract-13: Signed OAuth state accepts legacy no-redirect shapes but rejects missing timestamp, nonce, or signature parts with `{ ok: false }`.
- Contract-14: Same-window Slack callback fallback appends `#brainbase_auth=<payload>` only to the resolved admin redirect, and AuthManager consumes and removes that fragment before reloading `/api/admin/*`.
- Contract-15: The admin page initializes through `AuthManager`; `setUnauthorizedHandler` and AdminPage admin-fetch retry remain wired to refresh sessions for API 401 retry, same-origin refresh requests include CSRF headers for production middleware, and a valid same-origin cookie session can authenticate the admin page without a normal-screen detour.

## Scenarios

- S-1: As an admin viewer, I open Overview and see Graph SSOT, candidate-store, Personal KG, AI context, and runtime health as separate source classes.
- S-2: As an admin viewer, I open Graph SSOT and candidate-store tabs and can distinguish promoted truth from candidate records.
- S-3: As an admin viewer, I open Personal KG and see owner-visible memory candidate summary plus a bounded latest-record page.
- S-3a: As the configured Personal KG owner or owner alias, I can inspect my canonical Personal KG owner-read records even when generic role/sensitivity filters would hide internal implementation rows from non-owner candidate-store reads.
- S-4: As an admin viewer, I request a Personal KG owner outside my access scope and the UI transitions to a denied/out-of-scope state instead of silently falling back or showing empty success.
- S-5: As an admin viewer, I open Settings/health and see DB key presence plus actual server-side DB connection status, with values redacted.
- S-6: As an admin viewer, I run AI Context Preview and see included context separately from denied memory and unavailable warnings.
- S-7: As an unauthenticated requester, I cannot call `/api/admin/*`.
- S-8: As a Japanese user, the admin page is understandable without switching language.
- S-9: As an admin viewer on the current server-pattern SSOT environment, I can confirm that the DB is connected while key values remain hidden.
- S-10: As an admin viewer, I see `さらに表示` when Personal KG results are truncated and the next request remains bounded.
- S-11: As an admin viewer, the admin visualization state machine transitions from default owner-visible Personal KG records to an out-of-scope owner state, and from normal health display to `partial` runtime health, without exposing DB values.
- S-12: As an unauthenticated admin viewer, I can start Slack login from the admin page and then reload the admin data, without visiting the normal screen.
- S-12a: As an unauthenticated admin viewer whose browser cannot keep a Slack popup, the Slack callback redirects the same window back to the original admin origin with an auth fragment on both localhost and allowed production origins, and the admin page consumes it before reloading admin data.
- S-12b: As an unauthenticated admin viewer with an invalid or malformed signed OAuth state, the callback fails closed with 400 and does not redirect to the normal screen.
- S-12c: As an unauthenticated admin viewer whose Slack callback is non-oauth without an access token, or whose Slack user/workspace identity cannot be resolved, the callback fails closed with 401 and the admin UI remains the recovery surface.
- S-12d: As an unauthenticated admin viewer, query `redirect` on the callback cannot override the redirect already stored in OAuth state, and hostile redirect text is escaped in callback HTML.
- S-12d-prod: As an unauthenticated admin viewer on `https://bb.unson.jp/admin.html`, same-window Slack callback fallback preserves that allowed production admin URL, while an untrusted absolute redirect is not reflected.
- S-12e: As an unauthenticated admin viewer who hard reloads the admin page after an auth recovery fix, the browser receives the current admin HTML and cache-busted admin assets instead of a stale module that lacks the login action.
- S-12f: As an admin viewer with an existing same-origin Brainbase cookie session, the admin page verifies that cookie session during initialization and loads the management surface without sending me to the normal screen.
- S-12g: As an admin viewer with an expired local bearer token but a refresh token, the admin fetch 401 retry path can refresh the session through AuthManager with the required CSRF token and retry with the new bearer token instead of making the admin page a dead end.
- S-12h: As an admin viewer, the admin authentication workflow has an explicit state transition matrix: anonymous load -> 401 recovery UI -> Slack OAuth start -> same-window callback fragment -> authenticated admin data reload, with cookie-session resume and refresh-token retry as alternate recovery states.

## Anti-patterns

- AP-1: Displaying candidate-store rows under a Graph SSOT heading.
- AP-2: Calling an unimplemented external RAG or derived index a Brainbase replacement in the admin UI.
- AP-3: Showing `.env`, JWT, OAuth, HMAC, DB URL, or credential values in health responses.
- AP-4: Adding mutation buttons before the read-only visualization boundary is verified.
- AP-5: Generating generic VibePro tasks without a story-specific Spec.
- AP-6: Reporting the dashboard as healthy when a source returned `unavailable`.
- AP-7: Reading Personal KG directly from the browser with a DB connection string instead of through the Brainbase server API.
- AP-8: Treating DB env-key presence as a successful DB connection without a server-side ping.
- AP-9: Applying Personal KG owner-read to non-owner callers or configured aliases that do not resolve to the canonical owner.
- AP-10: Reporting Personal KG as empty because the browser reused stale admin API data.
- AP-11: Telling users to open the normal screen in order to recover admin authentication.
- AP-12: Dropping the `/admin.html` redirect during Slack OAuth state/callback handling, including allowed production admin URLs, and returning the user to the root or normal screen.
- AP-13: Trusting a callback query redirect over the signed state redirect or writing unescaped redirect text into callback HTML attributes.
- AP-14: Serving `/admin.html` or unversioned admin assets from browser storage cache after auth recovery behavior changes.
- AP-15: Removing AuthManager cookie-session or refresh-retry branches while adding admin-specific Slack recovery, causing existing Brainbase sessions to fail only in the admin page.
