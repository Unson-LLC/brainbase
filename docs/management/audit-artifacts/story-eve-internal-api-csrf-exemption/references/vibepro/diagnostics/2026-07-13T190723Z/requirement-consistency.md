# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 12 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 3 |
| Spec Refs | 1 |
| Architecture Refs | 2 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: AC-001 / ac:1: 設定済みsecretと完全一致するinternal API keyだけがCSRFを通過し、後段のrequireAuthでinternal serviceとして認証される (story:docs/stories/story-eve-internal-api-csrf-exemption.md)
- REQ-INV-002: Given: INTERNAL_API_SECRET が設定され、同じ値の x-internal-api-key を持つ本番POSTである (story:docs/stories/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-001: **INV-1 (exact key only)**: INTERNAL_API_SECRETと完全一致する単一のx-internal-api-keyを持つ変更リクエストだけがCSRF middlewareを通過する。 (spec:docs/specs/eve-internal-api-csrf-exemption.md)
- REQ-SRC-002: **INV-2 (auth remains authoritative)**: CSRF通過後もrequireAuthが同じkeyを検証し、authSource=internalを設定する。 (spec:docs/specs/eve-internal-api-csrf-exemption.md)
- REQ-SRC-003: **INV-3 (fail closed)**: server secret未設定、header欠落、値不一致、複数値headerはinternal requestとして扱わない。 (spec:docs/specs/eve-internal-api-csrf-exemption.md)
- REQ-SRC-004: 同じsecret検証がCSRF層と認証層に存在するが、middleware順序上のfail-closedを維持するため意図的に許容する。 (architecture:docs/architecture/ADR-eve-internal-api-csrf-exemption.md)
- REQ-SRC-005: workflow path全体の無条件CSRF除外: 認証前の信頼境界を広げるため不採用。 (architecture:docs/architecture/ADR-eve-internal-api-csrf-exemption.md)
- REQ-SRC-006: 冪等性境界: 同一 event_id の再送は既存recordをそのまま返し、上書きしない（insertEvent の重複判定）。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-007: 認証境界: 既存 createCompanionAccessGuard（server-to-server認証: internal / service-token / bearer(owner) のみ）をそのまま再利用し、新規の認可ロジックは追加しない。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-008: 集計境界: scripts/send-decision-kpi-to-slack.js は同一ホスト上のcompanion APIをHTTP経由で読むだけで、月次JSONファイルを直接読まない（サーバープロセス経由の一貫性を保つ）。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-009: Alternatives considered: 判断イベントをworkflow-repository.jsの既存ledger（workflow-ledger.json）に混在させる案は、判断委任KPIという独立した関心事を既存workflow監査ログと結合させ、スキーマ肥大化と無関係な参照を招くため却下し、専用サービス・専用ファイルに分離した。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-010: Control: metadata はcompanion controller層で解釈せず、そのまま保存するだけの不透明領域として扱う。 (architecture:docs/architecture/decision-events-kpi-architecture.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/eve-internal-api-csrf-exemption.md: -
- architecture: docs/architecture/ADR-eve-internal-api-csrf-exemption.md: ADR: internal API keyをCSRF層でも検証する
- architecture: docs/architecture/decision-events-kpi-architecture.md: 判断委任KPI フェーズ1 サーバー側 Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
