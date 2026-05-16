# Story: SNS approval schedules posting

## Story ID

str.brainbase.sns-approval-schedules-posting

## Background

SNS Growth Cockpit has a posting ledger and a scheduled publisher. The publisher only scans `scheduled` posts. In operation, imported posts already have `date`, `time`, and `scheduled_at`, so the human action "承認する" means "this post may go out at its planned slot". Leaving those posts in `approved` makes the scheduler scan zero posts and creates the false impression that posting is broken.

## User Story

As the SNS operator, I want approving a post with an existing planned slot to move it into the scheduled queue, so that the automated publisher can post it at the planned time without requiring an extra hidden scheduling step.

## Acceptance Criteria

- AC-1: When a review-needed post has `scheduled_at`, approving it from the cockpit sends `status: scheduled` to the ledger API.
- AC-2: When the API receives `status: approved` for a post with an existing schedule, it stores `scheduled` to keep API callers and UI behavior aligned.
- AC-3: The scheduled publisher still publishes only due `scheduled` posts; it must not publish arbitrary `approved` posts.
- AC-4: The UI feedback after approval tells the operator that the post is now scheduled.

## Non-Goals

- Do not publish immediately from the approve action.
- Do not bulk-convert historical approved posts.
- Do not change X API credentials or posting adapter behavior.
