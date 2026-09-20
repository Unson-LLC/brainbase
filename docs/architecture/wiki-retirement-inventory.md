# Wiki retirement implementation inventory

Status: Wiki write paths are retired in the current source tree. This inventory
separates removed writers, protected read-only inventory tools, and remaining
legacy references that need a separate migration decision.

Decision: `ADR-018-retire-wiki-storage`

## Current consumers and writers

| Surface | Current role | Current disposition | Remaining gate or uncertainty |
|---|---|---|---|
| `server/routes/wiki.js` | `/api/wiki` compatibility boundary | all endpoints return `410 WIKI_RETIRED_READ_ONLY`; no service, auth, or database access | keep the explicit boundary while old clients may still call it |
| `cli/sync.js` | old local/server sync command surface | every exported operation fails closed without network or file I/O | remove only after callers are confirmed migrated |
| `scripts/migrate-graphdb-to-wiki.js` | protected Graph-to-Wiki data inventory | `--dry-run` is the only allowed mode; other invocations exit before DB access or writes | retain until protected-data retention/archive evidence is complete |
| `scripts/populate-wiki-pages.js` | protected local-Markdown inventory for `wiki_pages` | `--dry-run` is the only allowed mode; other invocations exit before DB access or writes | retain until protected-data retention/archive evidence is complete |
| `scripts/link-story-ids-to-nocodb.js` | legacy Wiki-to-NocoDB Story linker | not changed by this cleanup; still contains a write path | separate NocoDB/Story-source migration and proof of non-use are required |
| `scripts/merge-codex-to-wiki.js` | old Codex-to-Wiki file writer | removed in `story-wiki-script-retirement-final` | no implementation remains in this repository; external copies are unknown |
| `scripts/reorganize-wiki.sh` | old Wiki-tree move/delete helper | removed in `story-wiki-script-retirement-final` | no implementation remains in this repository; external copies are unknown |
| `scripts/create-story-records-from-wiki.js` | old Wiki-to-NocoDB Story writer | removed in `story-wiki-script-retirement-final` | no implementation remains in this repository; external copies are unknown |
| `server/routes/brainbase/portal-routes.js` | Story list projection | `wikiStoryCount` is `null`; no Wiki page fetch | keep projection contract until its owner/source is explicitly migrated |
| `mcp/brainbase/src/server.ts` | learning-memory candidate lookup | rejects retired `search_wiki`/`get_wiki_page` names; remaining `wikiApiBaseUrl` belongs to candidate retrieval | confirm candidate retrieval no longer depends on Wiki before removing compatibility code |
| `scripts/local-data-server-ssot-upsert.js` | additive local inventory ingestion | `wiki_pages` is not a supported write target | keep inventory routes pointed to their owning SSOT |

The repository also contains historical documents and migration help text that
mention removed paths. Those are not executable callers; they are retained as
history unless a separate documentation cleanup owns them.

## Protected data rule

The local Wiki tree, `wiki_pages`, SQLite, and JSON artifacts are protected
migration inputs, not competing SSOTs. This cleanup does not delete, rewrite,
or migrate any stored data. A page is not deleted until its checksum,
source/generator, owner, audience, references, freshness, authority, and
destination are recorded. Unknown origin is represented as `unknown_protected`,
never inferred as obsolete.

## Verification completed by the script-retirement change

- The three obsolete manual writers are absent from the source tree.
- `server/`, `cli/`, and `package.json` contain no executable reference to the
  removed entrypoints.
- The two retained inventory tools fail closed without `--dry-run` before
  opening a database connection or writing files.
- No server/bootstrap, authentication, NocoDB implementation, or stored Wiki
  data was changed by this cleanup.

## Remaining scope

The NocoDB writer `scripts/link-story-ids-to-nocodb.js` is a separate legacy
path and remains unresolved. Its removal requires an independent Story-source
and NocoDB migration decision; it is deliberately outside this change.

The page ledger must still be generated from the server manifest plus the
protected local tree and reconcile both counts and SHA-256 hashes. Each row
must use one of: `graph`, `owning_repo`, `team_drive`, `workspace_home`,
`archive_with_retention`, or `unknown_protected`. Database removal is last.
