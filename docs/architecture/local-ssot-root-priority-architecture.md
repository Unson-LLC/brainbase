---
title: Local SSOT duplicate root priority architecture
story_id: story-local-ssot-root-priority
status: draft
date: 2026-06-04
---

# Local SSOT Duplicate Root Priority Architecture

## Decision

The local-data-to-server inventory keeps one comparable item for each `target_table|target_type|source_path` key, using collection order as root priority. The default order keeps `_codex` before workspace content. Lower-priority duplicates are not compared against server rows and are not eligible for upsert operations.

## Rationale

This preserves the existing non-destructive migration architecture while avoiding false server conflicts caused by older local duplicate files. Suppression is not silent: lower-priority duplicates remain in inventory and upsert output as `needs_review` with duplicate metadata, so operators can clean local split-brain state separately.

## Boundaries

- No server deletion.
- No local file deletion or rewrite.
- No Graph write from lower-priority duplicates.
- Hidden dotfiles under document roots are excluded from document inventory.
- Raw conversation logs stay in `needs_extraction` and remain outside Graph promotion.

## Verification

- `npm run test:run -- tests/unit/local-data-server-ssot-inventory.test.js tests/unit/local-data-server-ssot-upsert.test.js`
- `BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-local-ssot-root-priority-cli.spec.ts --reporter=line`
- `node scripts/local-data-server-ssot-upsert.js --json` with `INFO_SSOT_DATABASE_URL`
