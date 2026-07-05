# Spec: Meeting Source Integration Catalog

## Invariants

- INV1: Normal settings reads must not depend on integrations.sh network availability.
- INV2: Tactiq and Plaud.ai remain effective Brainbase meeting-source providers even when integrations.sh detection has no MCP surface.
- INV3: The catalog must make the authority split explicit: integrations.sh detects public surfaces; Brainbase decides effective providers, auth handling, sync role, and credential lifecycle.
- INV4: API responses must not expose actual credential refs or local secrets.

## Contracts

- C1: `GET /api/settings/meeting-sources/integration-catalog` returns a versioned catalog with `upstream.name = integrations.sh` and provider entries for `tactiq` and `plaud`.
- C2: Provider entries include `domain`, `role`, `catalog_source`, `catalog_status`, `surfaces`, `auth`, `effective`, and `upstream`.
- C3: `POST /api/settings/meeting-sources/integration-catalog/:provider/refresh` may call integrations.sh detect for the provider domain and returns the upstream detect summary under `upstream_detect`.
- C4: Unsupported providers return a 404-style route error instead of silently expanding the provider set.

## Scenarios

- S1: Given integrations.sh cannot be reached, when the settings UI lists the catalog, then Tactiq and Plaud.ai are still displayed from Brainbase override without a network call.
- S2: Given integrations.sh reports `mcp: []`, when a provider refresh is requested, then Brainbase still marks the provider `effective: true` and shows the upstream gap separately.
- S3: Given Mac Companion needs to explain setup, when it reads the catalog, then it can show that auth is managed by Brainbase runtime and this Mac does not save MCP credentials.

## Anti-patterns

- A1: Do not make integrations.sh the runtime auth broker.
- A2: Do not block Tactiq/Plaud setup just because upstream detection has not published MCP metadata yet.
- A3: Do not ask Mac Companion users to type credential refs into local settings.
- A4: Do not query integrations.sh during every settings render.

## Verification

- V1: `BDD_INTEGRATION_CATALOG_INV1_INV2` proves catalog listing is network-independent and returns Brainbase overrides.
- V2: `BDD_INTEGRATION_CATALOG_INV3` proves explicit refresh calls integrations.sh detect but preserves effective Brainbase override.
