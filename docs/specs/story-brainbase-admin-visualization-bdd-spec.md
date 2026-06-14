# story-brainbase-admin-visualization-bdd Spec

## Invariants

- INV-1: Every admin row, card, graph item, candidate item, context item, and health item exposes a `source_class`.
- INV-2: Graph SSOT records are never mixed into candidate-store collections.
- INV-3: candidate-store records are never presented as promoted Graph truth unless `promotion_status` and `promoted_graph_entity_id` show that relationship explicitly.
- INV-4: AI Context Preview describes the context that will be passed to AI, not the full set of saved records.
- INV-5: Derived indexes such as LightRAG are displayed as `derived_index`, never as SSOT.
- INV-6: `/api/admin/*` is read-only and does not create, update, promote, or delete Graph/candidate data.
- INV-7: `/api/admin/*` requires authenticated access via existing Brainbase auth middleware.
- INV-8: Health/config responses never include secret values, tokens, connection strings, private keys, or raw credential JSON.
- INV-9: Missing Graph/candidate/derived-index dependencies produce partial `unavailable` health, not a dashboard-wide 500.
- INV-10: Japanese is the default/fallback UI language for user-facing labels.

## Contracts

- Contract-1: `GET /api/admin/overview` returns `sources`, `graph`, `candidates`, `derived_indexes`, and `runtime_config`.
- Contract-2: `GET /api/admin/graph/entities` returns `{ source_class: "graph_ssot", records: [...] }`.
- Contract-3: `GET /api/admin/candidates` returns `{ source_class: "candidate_store", records: [...] }`.
- Contract-4: `POST /api/admin/context-preview` returns `{ source_class: "ai_context", preview, warnings }`.
- Contract-5: `GET /api/admin/health` returns source health without secret values.
- Contract-6: The UI uses Japanese labels for Overview, Graph SSOT, candidate-store, AI Context, data flow, and settings/health.

## Scenarios

- S-7: As an unauthenticated requester, I cannot call `/api/admin/*`.
- S-8: As a Japanese user, the admin page is understandable without switching language.

## Anti-patterns

- AP-1: Displaying candidate-store rows under a Graph SSOT heading.
- AP-2: Calling LightRAG a Brainbase replacement in the admin UI.
- AP-3: Showing `.env`, JWT, OAuth, HMAC, DB URL, or credential values in health responses.
- AP-4: Adding mutation buttons before the read-only visualization boundary is verified.
- AP-5: Generating generic VibePro tasks without a story-specific Spec.
- AP-6: Reporting the dashboard as healthy when a source returned `unavailable`.
