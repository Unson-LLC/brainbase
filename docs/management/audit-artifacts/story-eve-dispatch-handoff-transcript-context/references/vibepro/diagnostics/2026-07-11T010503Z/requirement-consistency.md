# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 0 |
| Spec Refs | 0 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: AC-002: handoff.context.meeting_note_generation に run_id / package_id / source_text_hash / transcript本文（note_source.body と source_transcripts）/ 書き戻し契約（method・path・必須フィールド・hash一致要件）が含まれる。 (story:docs/stories/story-eve-dispatch-handoff-transcript-context.md)
- REQ-INV-002: 他のloop intentのdispatch挙動（handoff構造・冪等性・タイムアウト回復）は変えない。 (story:docs/stories/story-eve-dispatch-handoff-transcript-context.md)
- REQ-INV-003: INV-handoff-002: 対象runの解決は run_id（または package_id から導出した stable run id）で行い、runの org_id / project_id がloop intentと一致しない場合はdispatchを拒否する（別プロジェクトのtranscriptをhandoffに載せない）。 (story:docs/stories/story-eve-dispatch-handoff-transcript-context.md)
- REQ-INV-004: INV-handoff-006: 書き戻し契約の記述はサーバー実装（recordMeetingNoteGeneration）の検証仕様（必須フィールド・source_text_hash 一致・run_id/package_id いずれか必須）と一致させる。 (story:docs/stories/story-eve-dispatch-handoff-transcript-context.md)
- REQ-INV-005: S-003: Dispatches without a meeting_note_generation reference keep the existing handoff shape and semantics. (story:docs/stories/story-eve-dispatch-handoff-transcript-context.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- なし

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
