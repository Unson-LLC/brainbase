# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 7 |
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

- REQ-INV-001: AC-003: source_text_hash が突合値と一致しないtool-callは書き戻されず、セッション終端時はdispatch runが blocked になる。 (story:docs/stories/story-eve-meeting-note-pull-reconciler.md)
- REQ-INV-002: AC-004: 生成途中（stream終端が境界イベントでない）のセッションはpendingのまま残り、次回実行で書き戻される。 (story:docs/stories/story-eve-meeting-note-pull-reconciler.md)
- REQ-INV-003: INV-reconciler-001: 書き戻しは既存のnote-generation契約（recordMeetingNoteGeneration、source_text_hash 完全一致・meeting_note_draft output必須）のみを通す。 (story:docs/stories/story-eve-meeting-note-pull-reconciler.md)
- REQ-INV-004: INV-reconciler-002: streamから抽出した議事録は、dispatch時に永続化した run.metadata.meeting_note_generation.source_text_hash / run_id と一致した場合のみ採用する。 (story:docs/stories/story-eve-meeting-note-pull-reconciler.md)
- REQ-INV-005: hash不一致のtool-callは書き戻さない。 (story:docs/stories/story-eve-meeting-note-pull-reconciler.md)
- REQ-INV-006: INV-reconciler-004: セッションが議事録なしで境界（parked / completed / failed）に達したdispatch runは blocked + action_required: operator_review_eve_session にし、無限ポーリングしない。 (story:docs/stories/story-eve-meeting-note-pull-reconciler.md)
- REQ-INV-007: 既存のdispatch経路・ingest経路の挙動は変えない。 (story:docs/stories/story-eve-meeting-note-pull-reconciler.md)

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
