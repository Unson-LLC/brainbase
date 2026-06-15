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

## Scenarios

- S-1: As an admin viewer, I open Overview and see Graph SSOT, candidate-store, Personal KG, AI context, and runtime health as separate source classes.
- S-2: As an admin viewer, I open Graph SSOT and candidate-store tabs and can distinguish promoted truth from candidate records.
- S-3: As an admin viewer, I open Personal KG and see owner-visible memory candidate summary plus a bounded latest-record page.
- S-4: As an admin viewer, I request a Personal KG owner outside my access scope and the UI transitions to a denied/out-of-scope state instead of silently falling back or showing empty success.
- S-5: As an admin viewer, I open Settings/health and see DB key presence plus actual server-side DB connection status, with values redacted.
- S-6: As an admin viewer, I run AI Context Preview and see included context separately from denied memory and unavailable warnings.
- S-7: As an unauthenticated requester, I cannot call `/api/admin/*`.
- S-8: As a Japanese user, the admin page is understandable without switching language.
- S-9: As an admin viewer on the current server-pattern SSOT environment, I can confirm that the DB is connected while key values remain hidden.
- S-10: As an admin viewer, I see `さらに表示` when Personal KG results are truncated and the next request remains bounded.
- S-11: As an admin viewer, the admin visualization state machine transitions from default owner-visible Personal KG records to an out-of-scope owner state, and from normal health display to `partial` runtime health, without exposing DB values.

## Anti-patterns

- AP-1: Displaying candidate-store rows under a Graph SSOT heading.
- AP-2: Calling an unimplemented external RAG or derived index a Brainbase replacement in the admin UI.
- AP-3: Showing `.env`, JWT, OAuth, HMAC, DB URL, or credential values in health responses.
- AP-4: Adding mutation buttons before the read-only visualization boundary is verified.
- AP-5: Generating generic VibePro tasks without a story-specific Spec.
- AP-6: Reporting the dashboard as healthy when a source returned `unavailable`.
- AP-7: Reading Personal KG directly from the browser with a DB connection string instead of through the Brainbase server API.
- AP-8: Treating DB env-key presence as a successful DB connection without a server-side ping.
