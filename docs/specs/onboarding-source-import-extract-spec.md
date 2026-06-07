# Onboarding Source Import and Candidate Extraction Spec

## Invariants

- INV-1: `onboard:import` and `onboard:extract` must not write `graph.json`, `relationships.json`, `personal-kg.jsonl`, or `decisions.jsonl`.
- INV-2: `onboard:import` is metadata-first; normalized records must never contain full mail bodies, full event descriptions, or file contents.
- INV-3: `onboard:extract` is deterministic; identical `sources/` input yields byte-identical candidate payloads, and candidate ids are content-derived, not time- or random-derived.
- INV-4: `onboard:apply` writes canonical SSOT only when `--write` is present; without it the command is a dry-run that changes no canonical file.
- INV-5: `onboard:apply` promotes only candidates whose ids are explicitly selected via `--select` or `--all`; an unselected candidate is never promoted.
- INV-6: Provider authentication and live provider calls are out of scope; `onboard:import` only consumes already-collected JSON from a file or stdin.
- INV-7: Extraction never promotes; its output is candidate material under `candidates/` until apply runs.

## Scenarios

- S-1: Given a gog Gmail JSON array, `onboard:import --source gmail` writes `sources/gmail/threads.jsonl` with from/to/subject/date/labels/snippet and no body field.
- S-2: Given a gog Calendar JSON array, `onboard:import --source calendar` writes `sources/calendar/events.jsonl` with summary/start/end/attendees and drops private descriptions unless `--include-descriptions` is set.
- S-3: Given imported Gmail and Calendar sources, `onboard:extract` proposes person candidates ranked by interaction frequency and org candidates derived from non-consumer email domains.
- S-4: Given a recurring calendar title or repeated drive folder, `onboard:extract` proposes a project candidate.
- S-5: Given `onboard:apply --from <file> --select <person-id> --write`, only that person becomes a canonical graph entity and relationship, and other candidates stay unpromoted.
- S-6: Given `--format json`, import, extract, and apply emit deterministic machine-readable summaries.

## Anti-Patterns

- AP-1: Calling Gmail, Calendar, Drive, or any provider API from Brainbase during import.
- AP-2: Persisting mail bodies, full event descriptions, or file contents into `sources/`.
- AP-3: Using `Date.now()` or randomness to derive candidate identity, making extraction non-deterministic.
- AP-4: Promoting extracted candidates into canonical SSOT without explicit selection or without `--write`.

## Verification

- Unit tests cover gmail/calendar/drive/local normalization, body stripping, deterministic extraction, and apply selection/dry-run.
- CLI tests cover import, extract, and apply for both markdown and json output.
- Acceptance E2E checks every story acceptance criterion against CLI output and a fixture-driven import -> extract -> apply -> doctor loop.
- A real-data E2E run imports live Google Workspace Gmail and Calendar metadata, extracts, applies selected candidates, and confirms `get_context`/`search` return them; recorded as VibePro verification evidence.
