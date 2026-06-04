---
story_id: story-personal-kg-extraction-backlog
title: Personal KG conversation extraction backlog
date: 2026-06-04
---

# Personal KG conversation extraction backlog

## Context

Local/server SSOT migration currently reports hundreds of `needs_extraction` rows for Codex and Claude Code raw conversation logs. That count is a raw-log inventory count, not a Personal KG candidate count. Treating it as the next write target is misleading because conversation logs are secondary material and must be transformed into owner-visible `memory_candidates` before any Graph promotion.

## Goal

Provide a deterministic CLI backlog view that groups raw conversation inputs by JST date, reuses the existing conversation Personal KG extractor, and compares the expected candidate source refs with server-side `memory_candidates`.

## Acceptance Criteria

- The backlog reports raw log file count separately from date count, message count, adopted candidate count, existing candidate count, missing candidate count, and `needs_review` candidate count.
- The backlog does not expose raw conversation text in stdout or JSON.
- Existing `needs_extraction` inventory/upsert behavior remains unchanged; raw logs are still skipped by additive upsert.
- Server comparison is read-only and uses `memory_candidates` source refs, not Graph promotion state.
- Existing local SSOT inventory classifiers for Graph/Wiki material, including `common/meta/customers`, remain unchanged; this story only exports the conversation-log collector for backlog use.
- Verification uses targeted unit tests and a CLI dry-run; UI/E2E is not required because this is an MCP/SSOT data CLI story.

## Architecture Decision

No new datastore or Graph entity is introduced. The center is a backlog planner CLI over existing sources:

- Raw material: local Codex/Claude Code logs.
- Extraction contract: `scripts/oyasumi-conversation-personal-kg.js`.
- SSOT target: `INFO_SSOT_DATABASE_URL.memory_candidates`.
- Graph promotion: explicitly out of scope.
