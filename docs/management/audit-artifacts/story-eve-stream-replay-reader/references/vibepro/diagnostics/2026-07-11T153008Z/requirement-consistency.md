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

- REQ-INV-001: AC-001: parked済みセッション（境界イベントがreplay末尾にある）のstream読取が、接続closeを待たずにreplay全イベントを返す。 (story:docs/stories/story-eve-stream-replay-reader.md)
- REQ-INV-002: AC-002: mid-turnセッション（境界イベントなし）はidleMs経過で受信済み完全行を返す。 (story:docs/stories/story-eve-stream-replay-reader.md)
- REQ-INV-003: AC-003: 放棄したlive tailの末尾不完全行は破棄され、接続closeしたstreamでは末尾改行なし行も保持される。 (story:docs/stories/story-eve-stream-replay-reader.md)
- REQ-INV-004: AC-004: 境界イベント検出後にtailが追加チャンクを流しても、境界時点までのイベントで打ち切られる。 (story:docs/stories/story-eve-stream-replay-reader.md)
- REQ-INV-005: INV-reader-002: 境界イベント打ち切りとidle打ち切りでは完全行のみを返す（途中で切れた行を壊れたイベントとして返さない）。 (story:docs/stories/story-eve-stream-replay-reader.md)
- REQ-INV-006: INV-reader-004: 全体タイムアウト（EVE_API_TIMEOUT_MS）と呼び出し側signalの中断semanticsは維持する。 (story:docs/stories/story-eve-stream-replay-reader.md)
- REQ-INV-007: S-002: Mid-turn and abandoned-tail reads return only complete lines; closed streams keep the final unterminated line. (story:docs/stories/story-eve-stream-replay-reader.md)

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
