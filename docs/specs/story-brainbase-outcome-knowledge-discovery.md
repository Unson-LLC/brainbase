# Spec: knowledge discovery backend

- Story: `story-brainbase-outcome-knowledge-discovery`
- Outcome: an authenticated project member can discover project knowledge and organization knowledge that is actually visible to that principal, and can distinguish a canonical source pointer from fetched source content.
- API: `GET /api/knowledge/items` and `GET /api/knowledge/items/:id`

## Request contract

- `project_code` is required and must be present in `req.access.projectCodes`.
- `q`, `scope=project|organization|all`, `status=active|inactive|all`, and `limit` are optional filters.
- The API never accepts tenant, actor, role, clearance, or accessible-project overrides from query/body input.

## Response contract

- List response: `{ state: "results"|"empty", project_code, records, searched_scope, absence_confirmed: false }`.
- Each record exposes `id`, `type`, `title`, `summary`, `scope`, `owner`, `applicability`, `source`, `lifecycle`, `version`, and `updated_at`.
- `source` separates `pointer` from `content_state`; a URL or repository path is never reported as fetched content.
- Detail response additionally returns only Graph edges whose endpoints remain visible to the same principal.
- Empty results are not proof of global absence. Errors are never converted to an empty result.

## Invariants

- Canonical Graph IDs are returned once; project and organization associations do not create duplicate knowledge rows.
- Organization scope is read from the canonical entity applicability scope inside the requested project. The catalog does not infer inheritance from a hard-coded project name; cross-project inheritance requires a separate canonical relation or configuration.
- Normal discovery excludes draft, superseded, expired, and retired decisions by default. A caller may request inactive records, but they are never marked applicable.
- Graph authorization remains the source of truth. The catalog layer does not count, name, or hint at inaccessible entities.
- Unknown owner, source-fetch state, applicability, or version remains `null`/`unknown`; it is not normalized to success, zero, or empty.

## Verification

- Normal: project and visible inherited organization records are returned with provenance and source state.
- Boundary: same canonical ID is deduplicated; inactive decisions are excluded by default.
- Failure: inaccessible project is rejected before Graph access; Graph failure is returned as failure, not `state=empty`.
