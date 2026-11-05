# Entity index and Graph API source

`@unson/brainbase-mcp` exposes optional Graph-backed retrieval libraries. Importing
these modules does not fetch data, read credentials, or start a server. Local-first
Brainbase entry points do not require them. Hosts explicitly provide the API URL,
token provider, and a trusted authority scope.

```ts
import { EntityIndexCache } from '@unson/brainbase-mcp/entity-index-cache';
import { GraphAPISource } from '@unson/brainbase-mcp/graph-api-source';
import { resolveEntities } from '@unson/brainbase-mcp/entity-indexer';

const cache = new EntityIndexCache({
  graphSourceFactory: () => new GraphAPISource(apiUrl, requestTokenProvider, projectCodes),
});
await cache.run(verifiedAuthorityScope, async () => {
  const index = await cache.refresh();
  return resolveEntities(index, { query: 'Example', types: ['project'] });
});
```

A scope key must include every dimension that changes visibility (principal,
tenant, organization, project permissions, and token authority). Never accept an
unverified scope key from a tool caller. Execute the entire refresh and lookup
inside the host's verified request/token context. The default scope supports a
single-owner host only. This library does not authenticate or authorize requests.

`refresh()` coalesces concurrent builds, reuses a snapshot for 60 seconds by
default, and publishes a complete index atomically. `invalidate()` expires every
scope and advances its generation; a build invalidated in flight must rebuild
before publication. Call it after writes or authority changes. Build failure
rejects the refresh, leaves freshness unset, and allows a later retry. Hosts must
await refresh rather than using the previous snapshot after failure.

The default capacity is 64 scopes. Eviction selects the least recently accessed
idle, non-default scope. Unlike the source server's soft bound, capacity exhaustion
with no eligible scope throws instead of retaining an unbounded number of sources.
The clock, TTL, capacity, and source factory are injectable. `getState()` exposes
mutable state for host integration; hosts must not change it during refresh.

## Migration provenance

Ported from `brainbase-unson` at
`55b5c730332aafc4937988e7670c30a01f1a012f` for RQ-113 / UNS-438.

| Source under `mcp/brainbase/src` | Package module / subpath |
| --- | --- |
| `indexer/index.ts` | `entity-indexer` |
| `indexer/types.ts` | `entity-types` |
| `indexer/ontology.ts` | `entity-ontology` |
| `sources/entity-source.ts` | `entity-source` |
| `sources/graphapi-source.ts` | `graph-api-source` |
| `retrieval/evidence.ts` | `graph-evidence` |
| Token provider/request option types | `graph-token-provider` |
| `server.ts` scoped index state, refresh, invalidation | `entity-index-cache` |

The token manager, host server, and authentication implementation are not included.
Pure Graph API conversion, lifecycle, ontology, and resolver tests are ported;
server rendering, MCP transport, and dispatch tests remain with their host.
Cache readiness/concurrency behavior is tested directly against the new library.

This change prepares package exports only. Publication requires approval. The
consumer's import replacement and version pin belong in a separate PR after npm
publication; no consumer configuration or runtime is changed here.
