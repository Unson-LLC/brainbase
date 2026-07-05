---
vibepro_story_id: story-meeting-source-integration-catalog
reason: Existing meeting-source settings route and service boundaries are reused; the change is an additive catalog API with no new persistence, credential-storage model, or runtime auth ownership.
---

# Story: Meeting Source Integration Catalog

## Goal

Brainbase meeting-source sync must treat integrations.sh as the public integration-surface catalog while keeping Brainbase-specific overrides for providers that are operationally required before upstream detection is complete.

## User Need

The operator wants Tactiq and Plaud.ai connected through MCP for meeting-note ingestion. integrations.sh is the desired OSS catalog layer, but current upstream detection may not yet expose those MCP surfaces. Brainbase therefore needs an effective catalog that shows:

- what integrations.sh knows,
- what Brainbase overrides,
- which provider is effective for online/offline/call transcripts,
- where auth and credential refs are managed.

## Scope

- Add a Brainbase meeting-source integration catalog service.
- Expose the catalog through settings API routes.
- Keep provider credential secrets out of the API response.
- Allow explicit upstream refresh without making normal settings rendering depend on live network.

## Out of Scope

- Replacing Brainbase runtime auth with integrations.sh.
- Persisting raw integrations.sh responses as secrets.
- Adding new providers beyond Tactiq and Plaud.ai.
