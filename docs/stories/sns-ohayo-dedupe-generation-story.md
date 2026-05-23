---
story_id: str.brainbase.sns-ohayo-dedupe-generation
title: SNS ohayo 重複回避生成
status: active
date: 2026-05-23
related_specs:
  - SPEC-sns-ohayo-dedupe-generation
---

# Story: SNS ohayo 重複回避生成

## User Story

As さとけい using `/ohayo` for daily SNS operations,
I want ohayo to create reviewable posts from Personal KG, current signals, and posting history without repeating prior bodies,
so that the SNS cockpit receives fresh drafts instead of silently losing a day to duplicate-body skips.

## Context

The SNS Posting Ledger correctly blocks duplicate bodies at import time, but `/ohayo` can still generate the same baseline and quote-commentary bodies repeatedly. The root cause is that the generation context exposes stats and broad policy but not the actual recent bodies/source URLs that the generator must avoid, while `generate-sns-ohayo-brief.js` uses fixed body templates for baseline, peer quote, and news commentary.

## Business Context

The value of Brainbase SNS operations is that posts come from the owner's Personal KG, prior posting performance, and today's signals. If the system repeats old copy, it loses trust and makes the UI appear stale even when the UI is working.

## Acceptance Criteria

- [ ] AC-1: Generation Context includes recent posted/review/scheduled bodies and used source URLs from the lookback ledger.
- [ ] AC-2: `/ohayo` review pack does not emit a body that is identical or near-identical to a recent ledger body.
- [ ] AC-3: Baseline posts vary by weekly plan topic, Personal KG anchors/proof points, and recent posting history instead of using only two fixed templates.
- [ ] AC-4: Peer/news quote comments vary by source topic and avoid reusing previously used source URLs.
- [ ] AC-5: If every candidate is blocked by dedupe, the review pack records a quality hold with a concrete reason instead of relying on Ledger import skip.
- [ ] AC-6: Tests cover repeated prior bodies and used source URLs, and fail if fixed templates reintroduce duplicate output.

## Non-goals

- Do not publish to X.
- Do not add a nondeterministic LLM call to unit tests.
- Do not weaken the Ledger duplicate-body guard.
- Do not change the SNS cockpit UI in this story.

## Architecture Decision

ADR不要。既存のSNS generation contextと`/ohayo` review-pack生成パイプライン内で、recent historyと決定的なpre-import dedupeを追加する変更に限定する。DB schema、公開API、SNS cockpit UI、Ledger duplicate guardの境界は変えない。
