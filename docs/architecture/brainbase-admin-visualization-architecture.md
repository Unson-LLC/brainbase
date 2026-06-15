# Brainbase管理画面可視化 Architecture

Story ID: `story-brainbase-admin-visualization-bdd`

## Principle

Brainbase管理画面は正本を作らない。各データソースから読み取った状態を投影し、表示単位ごとに `source_class` を付与して、利用者が「これはGraph正本か、候補か、個人KGのread modelか、AI入力文脈か」を判別できるようにする。

## Source Classes

| source_class | Meaning |
|---|---|
| `graph_ssot` | Graph entity/edgeの正本 |
| `candidate_store` | 昇格前のmemory candidate |
| `personal_kg` | owner-visible memory_candidates の個人KG read model |
| `ai_context` | AI context resolverが返す実投入文脈 |
| `runtime_config` | env/config/runtime readiness |

## Read API

- `GET /api/admin/overview`
- `GET /api/admin/graph/entities?project=&type=&q=&limit=`
- `GET /api/admin/candidates?status=&type=&redaction=&limit=`
- `GET /api/admin/personal-kg?owner=&layer=&status=&type=&redaction=&limit=`
- `POST /api/admin/context-preview`
- `GET /api/admin/data-flow?project=&entity=&candidate=`
- `GET /api/admin/health`

## Authorization

All `/api/admin/*` routes are mounted behind `requireAuth(authService)`. Route handlers use `req.access` as the access context for Graph queries.

Personal KG owner identity is normalized on the server. `BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID` is the canonical saved-memory owner, and `BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS` maps authenticated person IDs that represent the same owner to that canonical owner. Owner-read is limited to the canonical owner, configured aliases, and internal service probes. That owner-read path may inspect owner-visible Personal KG rows without applying generic candidate-store `role_min`/`sensitivity` hiding, because Personal KG core can intentionally contain the owner's restricted judgment context. Non-owner filters return an out-of-scope warning and no records.

## Data Boundaries

- Graph SSOT reads use `InfoSSOTService.listGraphEntities` / `getContext`.
- candidate-store reads use `PgCandidateRepository.list` when present.
- Personal KG reads reuse the same server-side `candidateRepository` and never expose DB URLs to the browser. DB-backed repositories use `summarizePersonalKg` for aggregate counts and `listPersonalKg` for a bounded latest-record page.
- `/api/admin/*` responses set no-store/no-cache headers, and the browser admin module sends no-store/no-cache requests so saved-state counts are not hidden by stale cache.
- The admin screen does not show unimplemented external RAG or derived-index product names unless a real Brainbase integration is introduced by a separate story.
- Missing DB/services return partial health instead of failing the whole dashboard.
- DB health reports configured keys separately from an actual server-side `SELECT 1` connectivity check.
- No admin endpoint returns raw env values, secret values, bearer tokens, HMAC secrets, connection strings, or raw credential JSON.

## Locale

The first implementation is Japanese-first. Server responses carry stable codes and `source_class`; UI maps them to Japanese labels. Japanese is the default and fallback locale.
