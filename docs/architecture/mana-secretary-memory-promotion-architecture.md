# mana Secretary Memory Promotion Architecture

## Center Pin

Brainbase上でもSlack上でも、manaが同じ会社文脈を見ている。ただし、読める記憶は `person`, `role`, `project`, `workspace`, `channel`, `sensitivity` で厳密に分離する。

## Architecture

```text
Brainbase Activity
Mana Slack Conversations
Mana Workflow / Message History
Manual Capture
Meeting Minutes
GitHub / NocoDB Events
  ↓
Raw Ledger
  ↓
Dreaming
  ↓
Memory Candidate
  ↓
Promotion Gate
  ↓
Brainbase Graph SSOT
  ↓
Context Retrieval
  ↓
Brainbase terminal / Slack mana / GM view / project view
```

## Responsibilities

`Raw Ledger` is a normalized read model over source evidence. It is not memory, and it does not require moving all raw data into a new database. Source systems keep their canonical raw records; Brainbase/mana expose stable evidence references and a common event envelope.

`Dreaming` converts raw activity into candidate business memory: decisions, requests, open loops, preferences, risks, relationships, and lessons.

`Promotion Gate` decides whether the candidate can be promoted, who owns the decision, and whether approval is required.

`Brainbase Graph SSOT` stores promoted organizational memory, relationships, decisions, and operating facts.

`Graphify` is an advisory engine for relationship extraction, conflict detection, merge candidates, and promotion impact review. It is not the source of truth.

`mana` is the cross-surface secretary interface. Slack mana and Brainbase terminal mana may share persona, but retrieval scope is always enforced by identity, role, workspace, channel, project, and sensitivity.

## Brainbase Implementation Scope

Brainbase is not only the coordination repo. It owns the memory safety boundary.

Brainbase implements:

- `Brainbase Activity Adapter`: converts session, terminal, task, and activity events into the Raw Ledger read model.
- `Memory Candidate Store`: stores Dreaming outputs before they become Graph facts.
- `Promotion Gate Service`: classifies candidate scope, owner, sensitivity, role minimum, approval requirement, and audit transition.
- `Promotion Review UI/API`: lets the assigned owner approve, reject, expire, or request redaction.
- `Graph Promotion Writer`: writes only approved candidates into Brainbase Graph SSOT.
- `Scoped Memory Retrieval`: injects memory into Brainbase terminal only after person, role, project, session, workspace, channel, and sensitivity checks.

Brainbase must treat unapproved candidates as draft state, not Graph truth. Graph retrieval must never read directly from raw activity or pending candidates unless the caller explicitly asks for review mode and has owner permission.

## Mana Implementation Scope

mana implements source capture and assistant-surface behavior.

mana implements:

- Slack event capture into Raw Ledger-compatible envelopes.
- Workflow and message-history adapters that expose stable `evidence_ref` values.
- Identity mapping from Slack user/workspace/channel to Brainbase `person`, `workspace`, `project`, and role context.
- Dreaming job execution for mana sources, preferably via GitHub Actions scheduled or on-demand workflow.
- Slack notifications for pending Promotion Gate review items.
- Scoped memory retrieval calls that include workspace, channel, user, project, and sensitivity context.

mana must not bypass Brainbase Promotion Gate. Slack approval UX can exist later, but the durable approval decision and Graph write remain Brainbase-owned.

## Raw Ledger Read Model

Raw Ledger is the center contract for evidence, not a new SSOT database.

```json
{
  "raw_event_id": "raw_brainbase_...",
  "source_system": "brainbase|mana_slack|mana_workflow|meeting|github|nocodb|manual",
  "source_event_id": "session:...|slack:...|workflow:...",
  "occurred_at": "2026-05-08T10:00:00.000Z",
  "captured_at": "2026-05-08T10:00:03.000Z",
  "actor_external_id": "U...",
  "actor_person_id": "per_xxx",
  "workspace": "unson",
  "channel_id": "C...",
  "project_code": "brainbase",
  "permission_snapshot": {
    "roles": ["gm"],
    "channel_membership": true,
    "project_membership": true,
    "clearance": ["internal", "restricted"]
  },
  "evidence_ref": {
    "kind": "source_pointer",
    "uri": "mana:dynamodb:...",
    "hash": "sha256:..."
  },
  "retention_policy": "source_retained|envelope_only|redacted"
}
```

If a source cannot safely retain full raw content, the ledger keeps only the evidence envelope, hash, and redacted summary. The promoted memory must remain explainable from `evidence_ref`, but raw transcript text is not copied into Graph SSOT by default.

Contract fixtures live under `tests/fixtures/memory-promotion/` and are shared by Brainbase and mana implementation tasks:

- `raw-ledger.fixture.json`
- `memory-candidate.fixture.json`
- `access-contexts.fixture.json`

The fixtures are intentionally source-neutral. Brainbase and mana adapters must transform their own source records into this shape before Dreaming or Promotion Gate logic runs.

## Memory Record Contract

```json
{
  "owner_person_id": "per_keigo_sato",
  "actor_person_id": "per_xxx",
  "source_system": "brainbase|mana_slack|mana_workflow|meeting|github|nocodb|manual",
  "source_event_ids": ["raw_brainbase_...", "raw_mana_..."],
  "workspace": "unson",
  "channel_id": "C...",
  "thread_ts": "1710000000.000000",
  "project_code": "brainbase",
  "subject_type": "person|role|project|org|customer|decision|raci_assignment|philosophy|glossary_term",
  "subject_id": "prj_xxx",
  "visibility": "private|role|project|org",
  "role_min": "member|gm|ceo",
  "sensitivity": "internal|restricted|hr|finance|contract",
  "promotion_status": "raw|candidate|promoted|rejected|expired",
  "requires_approval": true,
  "recommended_owner_person_id": "per_xxx",
  "permission_snapshot": {
    "roles": ["gm"],
    "channel_membership": true,
    "project_membership": true,
    "clearance": ["internal", "restricted"]
  },
  "evidence_ids": ["activity:...", "mana-message:..."],
  "expires_at": null,
  "redaction_status": "none|redacted|needs_redaction",
  "confidence": 0.86
}
```

## Dreaming Execution Boundary

Lambda-backed mana Slack handling captures events and may answer in real time, but it does not promote memory.

Dreaming runs as an asynchronous job, primarily from mana GitHub Actions or an equivalent scheduled worker. It reads Raw Ledger records, writes candidate drafts, and stops. It must not write directly to Brainbase Graph SSOT.

Brainbase terminal sessions may request an on-demand Dreaming pass for the current session, but the output is still a candidate draft and goes through Promotion Gate.

## Promotion Ownership

```text
person memory
→ the person

role memory
→ the accountable owner of that role

project memory
→ project owner / PM / RACI accountable

org memory
→ GM / CEO

customer or push_case memory
→ case owner / sales owner / GM

policy / philosophy / operating rule
→ CEO or designated owner
```

Low-risk private preferences may be auto-promoted to the owner person's private scope. Anything visible to others, or involving customer, HR, finance, contract, policy, philosophy, or organization-level decisions requires approval.

## Promotion Gate Workflow

```text
candidate
  ↓
gate_classified
  ↓
auto_promoted | pending_approval | rejected | expired
  ↓
approved
  ↓
promoted_to_graph
```

Every transition records:

- `actor_person_id`
- `decision_owner_person_id`
- `decision_reason`
- `decided_at`
- `previous_status`
- `next_status`
- `evidence_ids`

Approval UI can live in Brainbase first. Slack mana may notify the owner and deep-link to the approval item, but Slack approval must include the same audit event and must not bypass the gate.

## Graph Subject Type Mapping

Do not add new Graph entity types for memory until an existing type fails a concrete requirement.

| Candidate concept | Graph target |
|---|---|
| Personal preference | person-scoped memory attached to `person` |
| Project fact / open loop | `project` or `decision` |
| Organization operating fact | `decision`, `raci_assignment`, or `org` |
| Customer / sales context | `customer` plus owner/project relation |
| Push case | existing CRM/push-case projection if available; otherwise `customer` + `decision` |
| Policy / operating rule | `decision` |
| Philosophy | `philosophy` |
| Term definition | `glossary_term` |

If a candidate cannot map to an existing Graph type, it stays `pending_approval` or `rejected` until the Graph model is explicitly extended.

## Retrieval Deny-By-Default Matrix

| Caller context | Expected memory |
|---|---|
| Sato as personal Brainbase user | private personal memory + allowed project/org memory |
| Sato as Unson GM | GM/org memory + allowed project memory, excluding unrelated private memory |
| Project member | project-visible memory for member projects only |
| Slack channel member | channel/project memory only when channel membership and role match |
| Slack channel outsider | no channel memory |
| Former member / role expired | no memory requiring the expired role |
| Brainbase terminal session without project | private memory and globally allowed org memory only |

## Cross-Repo VibePro Handling

The story is owned by one coordination repo: `brainbase`.

`brainbase` owns:

- Story and architecture documents
- Brainbase Graph SSOT changes
- Brainbase terminal/session retrieval changes
- Brainbase Activity Adapter
- Memory Candidate Store
- Promotion Gate contract
- Promotion Gate API/service and owner review UI
- Graph Promotion Writer
- Cross-repo run summary

`mana` owns:

- Slack/Lambda/GitHub Actions input capture
- mana message history integration
- workspace/channel/project scoping behavior
- mana agent prompt/tool changes

VibePro should not try to make one repo pretend to be a monorepo. For a two-repo change, use one shared `story_key` and repo-local evidence:

```text
story_key: brainbase/mana-secretary-memory-promotion/20260508

brainbase run:
  repo: Unson-LLC/brainbase
  evidence: story, architecture, Graph/terminal implementation, tests, Graphify impact

mana run:
  repo: Unson-LLC/mana
  evidence: Slack/workflow/message-history implementation, tests, Graphify impact

cross-repo integration:
  evidence: contract fixtures, API calls, example memory candidate, retrieval behavior
```

Graphify runs stay repo-local because the code graph and changed files are repo-local. Cross-repo confidence comes from shared contracts and integration evidence, not from forcing a single Graphify artifact across both repos.

## Guardrails

- Do not promote raw transcript or activity directly into Graph SSOT.
- Do not let Slack mana see private Brainbase terminal memory unless the identity and scope allow it.
- Do not let Brainbase terminal mana see channel or workspace memory outside the user's role/project access.
- Do not treat Graphify artifacts as memory source of truth.
- Do not create a new GraphDB before the existing Brainbase Graph fails a concrete requirement.
- Do not use organization scope as the default memory scope.

## First Slice

1. Define Raw Ledger read model across Brainbase activity and mana message history without creating a new physical ledger DB.
2. Define identity mapping fixtures for Brainbase person, Slack user, workspace, channel, role, and project.
3. Define memory candidate schema and fixtures, including permission snapshots and evidence references.
4. Implement Dreaming candidate generation as a non-writing async draft step.
5. Implement Promotion Gate decision output with owner/scope/sensitivity/status/audit.
6. Promote one low-risk private preference automatically to personal scope.
7. Promote one project-visible memory through explicit approval.
8. Inject scoped memory into Brainbase terminal context and mana Slack context.
9. Verify deny-by-default retrieval for GM, project member, channel outsider, and expired-role cases.
