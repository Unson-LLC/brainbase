# Brainbase Source Contract for Presentation Decks

Use this contract when a presentation concerns an organization, project, person, decision, or asset managed by Brainbase.

## Purpose

Brainbase is the evidence and source-selection layer for deck production. It prevents a visually complete deck from being built on the wrong legal name, brand, decision, document, number, or stakeholder assumption.

The resolver selects where to look. The retrieved entity, document, or asset is the evidence. Do not cite a routing receipt as if it were the source itself.

## Routing Matrix

| Information need | Canonical route | Required evidence |
|---|---|---|
| Official organization, person, project, term, relationship, decision, progress | Graph | Entity ID plus retrieved fields |
| Reviewed team rule, reusable instruction, structured project knowledge | Owning repository | Absolute path, revision or commit when available |
| Logo, photo, PDF, large original, reviewed shared artifact | Team Drive | File ID or URL, title, modified time when available |
| Personal preference, taste, interpretation, cognitive memory | Personal KG | Explicit user authorization plus item reference |
| Current file state, generated output, runtime condition | Workspace | Absolute path plus current verification time |
| Migration compatibility view | Wiki | Reference only; never canonical |

Split mixed requests into multiple source intents. For example, a company profile may need Graph for the legal name, Drive for the logo, the owning repository for brand rules, and the workspace for the current output file.

## Required Retrieval Sequence

1. Set the project code and audience.
2. Resolve one or more source routes by content type.
3. Follow each route and retrieve the actual source.
4. Resolve and retrieve relevant Graph entities for exact proper nouns and decisions.
5. Record evidence in the source ledger.
6. Mark conflicts, unknowns, and material gaps.
7. Only then approve the deck brief and outline.

## Source Ledger Schema

Create one row per material fact, quotation, number, image, logo, or rule.

| Field | Meaning |
|---|---|
| `item_id` | Stable local identifier such as `SRC-001` |
| `deck_use` | Slide or design decision that consumes the source |
| `claim_or_asset` | Exact fact, number, quotation, image, logo, or rule |
| `evidence_class` | `confirmed_fact`, `stakeholder_statement`, `inference`, or `unknown` |
| `canonical_route` | `graph`, `owning_repo`, `team_drive`, `personal_kg`, or `workspace` |
| `source_pointer` | Entity ID, file ID, URL, or absolute path |
| `retrieved_at` | Retrieval timestamp with timezone |
| `verified_value` | Exact value or asset identity used in the deck |
| `verification_status` | `verified`, `conflict`, `unresolved`, or `stale` |
| `notes` | Boundary, conflict, authorization, or refresh condition |

Never write `0` for unknown. Keep `unknown` or `unresolved` explicit. Record inferences separately from confirmed facts.

## Stop Conditions

Stop before rendering when any of these are true:

- the official organization name or project identity is unresolved;
- the logo or brand asset is only a visual look-alike and its provenance is unverified;
- an important number has no actual retrieved source;
- a decision or approval status is inferred from conversation alone;
- Personal KG would be required but the user has not explicitly authorized its use;
- two canonical candidates conflict and the conflict changes the story or design;
- a resolver or retrieval failure is being treated as proof that information does not exist.

Unresolved non-material details may remain as clearly labeled placeholders if the user can still judge the design safely.

## Pre-delivery Refresh

Before public sharing, external sending, or final Drive placement:

- refresh time-sensitive facts, decisions, prices, schedules, and status values;
- confirm that each Drive file ID still points to the intended asset;
- confirm that the legal name, logo, and brand rules still match the retrieved canonical sources;
- preserve owner-visible audit lines exactly as emitted by Brainbase tools;
- update the source ledger with the refresh time and result.
