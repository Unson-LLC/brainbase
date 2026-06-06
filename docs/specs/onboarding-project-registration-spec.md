# Onboarding Project Registration Spec

## Invariants

- INV-1: `onboard:projects` works from user-provided interview answers and must not require mail, calendar, drive, task, or local-note connectors.
- INV-2: Dry-run is the default. Canonical files change only when `--write` is provided.
- INV-3: Source references are metadata-only allowlists and must not trigger reading provider content.
- INV-4: Project registration writes only canonical SSOT files: `graph.json`, `relationships.json`, `personal-kg.jsonl`, and `decisions.jsonl`.
- INV-5: Identical dry-run inputs yield deterministic JSON and markdown output.
- INV-6: Stakeholders and decision principles are not promoted unless `--write` is provided.
- INV-7: Registered project context must be visible through MCP context/search surfaces after canonical write.

## Scenarios

- S-1: `onboard:projects --name <name> --goal <goal>` returns a reviewable project registration plan without external sources.
- S-2: `--stakeholder "person|role|context"` records stakeholder relationship previews and writes relationship records only with `--write`.
- S-3: `--source "drive|proposal folder|gdrive-folder-id"` records source allowlist metadata without reading that source.
- S-4: `--task-source <value>` and `--decision-principle <value>` are attached to the project metadata and canonical decision records on write.
- S-5: `--format json` returns deterministic machine-readable project registration details.
- S-6: After `--write`, `get_context` includes the project context and `search` can find the project by goal/status/source metadata.

## Anti-Patterns

- AP-1: Reading or importing provider data from `onboard:projects`.
- AP-2: Treating source-derived hints as canonical facts without user approval.
- AP-3: Registering a project with only a name when goal/status/role/source boundaries are available from the interview.
- AP-4: Hiding stakeholders in project free text instead of relationship records.

## Verification

- Unit tests cover parsing, deterministic dry-run output, metadata-only source references, and write planning.
- CLI tests cover dry-run/no-write and `--write` canonical persistence.
- Acceptance E2E checks every story acceptance criterion, including `get_context`, `list_entities`, and `search` visibility after write.
