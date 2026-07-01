# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 2 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 2 |
| Spec Refs | 1 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |

## Invariants

- REQ-INV-001: AC-005: Graph SSOTが利用できない場合は verification_status=candidate_from_review_package を維持し、active_exceptions に graph_ssot_unavailable を残す。 (story:docs/stories/story-meeting-pack-graph-ssot-playbook.md)
- REQ-INV-002: AC-008: Task/Decision/Graph/外部送信のHuman Gateは維持する。 (story:docs/stories/story-meeting-pack-graph-ssot-playbook.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Requirement Sources

- spec: docs/specs/story-meeting-pack-graph-ssot-playbook-spec.md: Meeting Pack Graph SSOT Playbook Spec
- architecture: docs/architecture/meeting-pack-graph-ssot-playbook-architecture.md: Meeting Pack Graph SSOT Playbook Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
