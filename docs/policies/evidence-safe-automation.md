# Evidence-safe automation policy

Status: canonical Brainbase operating policy  
Owner: Brainbase maintainers  
Audience: agents, commands, report generators, and reviewers  
Last reviewed: 2026-07-22

## Purpose

Brainbase automation must preserve the difference between observed fact,
derived result, and unavailable evidence. A fluent report is not successful if
it invents an item, hides a failed source, changes the meaning of a quote, or
states an unchecked number as fact.

This policy consolidates durable rules recovered from retired LearningService
Wiki projections. Those projections are migration evidence, not independent
sources of truth.

## Required evidence states

Every material input is one of:

- `verified`: obtained from the authoritative source and checked for the
  relevant time range or entity;
- `derived`: calculated deterministically from identified verified inputs;
- `unverified`: present in an input or summary but inconsistent with, or not
  traceable to, the detailed source;
- `unavailable`: collection failed, authorization is missing, or the source
  could not be reached.

`unverified` and `unavailable` must never be rendered as zero, none, complete,
resolved, or absent.

## Output invariants

1. Do not invent missing list entries, rankings, tasks, owners, dates,
   deadlines, next actions, delivery guarantees, or achievements to satisfy a
   requested shape such as “Top 3”. Short input produces short output.
2. Recalculate counts, dates, weekdays, and thresholds from the detailed input.
   Do not trust a summary annotation when it conflicts with the underlying
   records.
3. Preserve unresolved conflicts visibly. If a summary says “due today” but no
   matching task exists, report the discrepancy; do not manufacture the task.
4. Do not silently normalize names, project labels, provisional speakers, or
   compound roles into confirmed identities. Resolve them through Graph or the
   owning source, or retain the ambiguity.
5. Treat transcript filenames, machine timestamps, and generated labels as
   hints. Verify the actual meeting time, speaker, surrounding context, and
   subject before making a claim.
6. A direct quotation must stay close to the source wording. Paraphrases and
   interpretations must not use quotation marks or be attributed as verbatim
   customer statements.
7. Derived documents do not prove what a meeting participant said. Contract
   values, decisions, and commitments require the transcript, signed document,
   Graph decision, or another owning source.
8. Progress and shipment claims must come from the owning execution system.
   Zero shipped work must not be decorated as delivered value; missing status
   must not be emitted as `undefined`.
9. Automation-created records remain drafts or candidates until the owning
   workflow confirms them. A successful write does not prove review,
   publication, delivery, or downstream application.
10. Presentation transformations such as Slack mrkdwn or grouping related tasks
    may improve readability but must not change facts, counts, priority,
    ownership, or evidence state.

## Source precedence

Use the narrowest authoritative source for the claim:

1. Graph for structured organization facts, identities, relations, decisions,
   and RACI;
2. the owning repository or Drive document for durable content;
3. the execution system for operational state, such as merged pull requests or
   task records;
4. transcript or signed document for exact statements and contractual facts;
5. summaries, generated reports, filenames, and model output only as discovery
   aids.

When sources disagree, expose the conflict and identify which source was used.
Do not average or silently choose the more convenient value.

## Enforcement

- Deterministic checks should enforce counts, date arithmetic, enum/state
  handling, required evidence fields, and output-schema constraints.
- Tests must include unavailable sources, contradictory summaries, fewer items
  than the requested ranking, ambiguous identities, and zero-result cases.
- Model instructions alone are insufficient for invariants that code can
  validate.
- Review evidence must name the inspected source, time range, and any source
  that remained unverified or unavailable.

## Retirement relationship

The retired per-incident Wiki pages remain protected until the workspace
retirement ledger records this policy as their reviewed destination and all
inbound consumers have moved. This document does not authorize deleting Wiki
exports, promotion records, or backup-branch Skills.
