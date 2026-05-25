---
story_id: story-oyasumi-sns-feedback-metrics-gate
title: Oyasumi SNS feedback metrics gate
status: active
owner: sato_keigo
reason: Existing SNS Ledger, metrics poller, and /oyasumi CLI workflow only; no new runtime boundary, DB schema, API route, auth model, or data ownership model.
---

# Oyasumi SNS feedback metrics gate

## Problem

`/oyasumi` treats SNS feedback learning as complete when `sns:feedback-learning --date`
finds no `learning_ready` posts. That hides the real state when Ledger has `posted`
posts for the target day but X metrics polling has not run, or polling failed.

## Goal

For a target day, `/oyasumi` must first attempt metrics polling for posted SNS Ledger
records, promote records with collected metrics to `learning_ready`, and only then run
feedback learning. If polling cannot collect metrics for posted records, the routine must
surface that as uncollected feedback, not as zero learning.

## Acceptance Criteria

- The metrics poller can be scoped to a specific Ledger date.
- The metrics poller can promote successfully polled `posted` records to
  `learning_ready`.
- Dry runs never mutate Ledger status or metrics snapshots.
- `/oyasumi` documents the poll-then-handoff order and requires reporting scanned,
  polled, failed, and learning-ready counts separately.
