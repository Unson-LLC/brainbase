# Meeting Source Integration Catalog Contract

## Scope

Brainbase owns the integration catalog for meeting-source providers used by Meeting Pack sync. The first supported providers are `tactiq` and `plaud`.

This contract is intentionally additive. Existing meeting-source settings, credential registration, connection tests, and resync behavior must continue to work without the catalog endpoint.

## API

### `GET /api/settings/meeting-sources/integration-catalog`

Returns the Brainbase-approved catalog entries for meeting-source providers.

Requirements:

- Must not perform network access.
- Must not return MCP credential refs, bearer tokens, OAuth secrets, refresh tokens, or user credentials.
- Must include catalog metadata needed by clients to explain the source of truth:
  - `provider`
  - `label`
  - `catalog_source`
  - `catalog_status`
  - `effective`
  - `surfaces`
  - `auth`
  - `notes`
- Must keep Brainbase overrides effective when an external catalog has no ready connector.

### `GET /api/settings/meeting-sources/integration-catalog/:provider`

Returns one provider entry.

Requirements:

- Supported providers return HTTP 200.
- Unsupported providers return HTTP 404.
- Response must follow the same no-secret rule as the list endpoint.

### `POST /api/settings/meeting-sources/integration-catalog/:provider/refresh`

Refreshes external catalog detection for one provider.

Requirements:

- Must be protected by the existing settings write guard.
- Must only call the external detector for the requested provider.
- Must preserve Brainbase override metadata as the effective source when the external detector does not expose a ready connector.
- Must not persist or return credential refs or secrets.
- Unsupported providers return HTTP 404.

## integrations.sh Boundary

`integrations.sh` is treated as a connector catalog and detection source, not as the runtime credential store.

Brainbase remains responsible for:

- MCP credential registration.
- Provider enablement.
- Connection tests.
- Sync preview and resync execution.
- Persistence of source events and meeting-source settings.

Mac Companion and other clients consume catalog metadata only. They must not become the authority for provider credentials or catalog override rules.

## Compatibility

The endpoint is safe to add before clients adopt it. Clients that do not call this catalog continue to use the existing settings API. Clients that do call it must degrade to the existing provider controls if the catalog endpoint is unavailable.
