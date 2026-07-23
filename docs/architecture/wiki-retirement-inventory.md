# Wiki retirement implementation inventory

Status: migration in progress

Decision: `ADR-018-retire-wiki-storage`

## Current consumers and writers

| Surface | Current role | Phase 1 disposition | Removal gate |
|---|---|---|---|
| `server/routes/wiki.js` | page REST API and sync API | mutations return 410; reads/export remain | all readers migrated |
| `server/services/wiki-service.js` | `wiki_pages` read/write implementation | retained behind read-only routes for export | zero direct callers and retention complete |
| `cli/sync.js` | local/server bidirectional mirror | pull/status remain; sync is pull-only; push refused | export reconciled and distributed |
| `server/services/learning-service.js` | auto-apply Wiki promotion candidates | candidate retained as manual with destination-classification error | replacement promotion taxonomy shipped |
| `cli/learning.js` | manually apply Wiki candidate | refused without marking applied | replacement promotion taxonomy shipped |
| `scripts/migrate-graphdb-to-wiki.js` | Graph facts to Markdown/DB mirror | non-dry-run refused | Graph consumers no longer require mirror |
| `scripts/populate-wiki-pages.js` | local Markdown to `wiki_pages` upsert | non-dry-run refused | retention complete |
| `scripts/local-data-server-ssot-upsert.js` | additive local inventory ingestion | `wiki_pages` removed from supported write targets | inventory routes documents to owning SSOT |
| `mcp/brainbase/src/server.ts` | Wiki search and page read | temporarily retained read-only | equivalent Graph/Git/Drive retrieval verified |
| `server/routes/brainbase/portal-routes.js` | enrich Story rows from Wiki details | temporarily retained | Story owner/source contract migrated |
| `scripts/create-story-records-from-wiki.js` | import Story content from Wiki | frozen legacy consumer | Story source migrated and counts reconciled |
| `public/modules/domain/wiki/*` and main shell | legacy human Wiki surface | no writer can cross server boundary | main-shell retirement gate under ADR-017 |

## Protected data rule

The local Wiki tree and `wiki_pages` are protected migration inputs, not competing SSOTs. A page is not deleted until its checksum, source/generator, owner, audience, references, freshness, authority and destination are recorded. Unknown origin is represented as `unknown_protected`, never inferred as obsolete.

## Next migration evidence

The page ledger must be generated from the server manifest plus the protected local tree and reconcile both counts and SHA-256 hashes. Each row must use one of: `graph`, `owning_repo`, `team_drive`, `workspace_home`, `archive_with_retention`, or `unknown_protected`. Consumer removal follows the table above; database removal is last.
