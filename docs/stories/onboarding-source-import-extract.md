# Onboarding Source Import and Candidate Extraction

## Background

The Google Workspace local onboarding plan and source diagnosis already tell a coding agent which collectors to run and where metadata-first output should land under `sources/`. But the value loop stops there: candidate facts can only be typed in by hand with `onboard:candidates`, and nothing reads the collected `sources/*.jsonl` to propose people, organizations, projects, relationships, or task candidates. As Masayuki Otawara's first personal Brainbase adopter, I want Brainbase to import collected provider metadata into `sources/`, extract reviewable candidates from it deterministically, and promote only approved candidates into canonical SSOT, so the "connect to get value" promise is actually demonstrable end to end on real Gmail and Google Calendar metadata.

## Acceptance Criteria

- `brainbase onboard:import --source gmail|calendar|drive|local --from <file|->` normalizes provider JSON (from gog output or an export file) into metadata-first records under the matching `sources/<provider>/*.jsonl` path.
- Import is metadata-first: it keeps participants, subjects/summaries, dates, labels, folders, and snippets, and never copies full mail bodies, full event descriptions, or file contents into `sources/`.
- `brainbase onboard:extract` reads existing `sources/*.jsonl` and writes a reviewable candidate set under `candidates/` containing person, org, project, relationship, and next-action candidates with provenance counts.
- Extraction is deterministic: the same `sources/` input always yields the same candidate set, and it uses code heuristics (frequency, domains, recurring titles) rather than model judgment.
- `brainbase onboard:apply --from <candidate-file>` promotes selected candidates into `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`, and is dry-run by default; canonical files change only with `--write`.
- `onboard:apply` supports `--select <id>` allowlists and `--all`, and refuses to promote anything that is not explicitly selected.
- `doctor` reflects imported raw sources and applied canonical entities after the loop runs.
- Real-data E2E: running import -> extract -> apply on real Google Workspace Gmail and Calendar metadata produces canonical entities that `get_context` and `search` can return through MCP.
- JSON and markdown output are deterministic and import/extract never write canonical SSOT files.
