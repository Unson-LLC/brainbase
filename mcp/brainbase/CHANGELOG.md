# Changelog

All notable changes to brainbase MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Canonical Task mutation tools** (2026-07-29)
  - Added `create_task` / `update_task` / `transition_task` tools as thin clients over the companion task API (`/api/companion/tasks`)
  - Auth via dedicated `bbsvc_` service token (`BRAINBASE_TASK_API_TOKEN`, Infisical-managed); missing token reports `unavailable`
  - Delete is intentionally not exposed; reserved idempotency-key prefixes (`api:` / `workflow:`) rejected client-side

- **Decision Entity Support** (2026-02-07)
  - Added `decision` entity type to brainbase MCP
  - FilesystemSource now scans `common/meta/decisions/` directory
  - GraphAPISource supports Decision entities from Graph SSOT API
  - `list_entities`, `get_entity`, `search` tools now support decision type
  - Sample decision entities: dec_001 (Graph API integration), dec_002 (Token format)

### Changed
- Updated README.md to include decision entity type documentation
- Graph Entity → EntityIndex conversion table now includes decision mapping

### Technical Details
- **Implementation**: Phase 1-9 completed (2026-02-07)
  - Phase 1-7: Core implementation (GraphAPISource, FilesystemSource, HybridSource, TokenManager)
  - Phase 8: Unit tests (12/12 passing) for GraphAPISource and TokenManager
  - Phase 9: E2E testing (filesystem mode verified, 10 decision entities retrieved)
- **Commit References**:
  - Test implementation: 4855686
  - Token format fix: 4d83bfc
  - Sample decisions: 40d466f

## [0.1.0] - 2026-01-XX

### Added
- Initial brainbase MCP implementation
- Filesystem source for local `_codex/` directory
- Graph API source with JWT authentication
- Hybrid source (API-first with filesystem fallback)
- TokenManager with automatic refresh
- Entity types: project, person, org, raci, app, customer
- MCP tools: get_context, list_entities, get_entity, search

---

Generated with [Claude Code](https://claude.com/claude-code)
