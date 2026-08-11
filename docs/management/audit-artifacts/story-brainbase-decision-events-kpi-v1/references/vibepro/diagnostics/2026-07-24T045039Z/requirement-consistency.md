# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 24 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 6 |
| Spec Refs | 1 |
| Architecture Refs | 5 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: **ac:2 auth-reuse**: 既存の companion アクセスガード（server-to-server認証: internal / service-token / bearer(owner)）をそのまま再利用し、新規の認可ロジックを追加しない。 (story:docs/stories/story-brainbase-decision-events-kpi-v1.md)
- REQ-INV-002: **ac:4 idempotency**: event_id を全月ledger共通の冪等キーとし、occurred_at が初回と異なる月を示す再送でも、重複POSTは200で最初の既存recordを返して無視する（上書き・別月への二重保存をしない）。 (story:docs/stories/story-brainbase-decision-events-kpi-v1.md)
- REQ-INV-003: **ac:7 weekly-kpi**: scripts/send-decision-kpi-to-slack.js が直近7日の委任率 = (draft_accepted+draft_edited)/(draft_accepted+draft_edited+self_handled)、差戻し率 = draft_edited/(draft_accepted+draft_edited)、エスカレーション件数、境界拡張数（rule_created件数）を集計してSlackへ投稿す (story:docs/stories/story-brainbase-decision-events-kpi-v1.md)
- REQ-INV-004: **scenario:event-duplicate**: 認証済みPOST → 全月ledger内の既存event_idと一致 → 永続化せず最初の既存recordを返す → 200 duplicate=true。 (story:docs/stories/story-brainbase-decision-events-kpi-v1.md)
- REQ-INV-005: mac-companion側のイベント送信実装（同じ契約で別途実装中）。 (story:docs/stories/story-brainbase-decision-events-kpi-v1.md)
- REQ-SRC-001: 冪等性境界: event_id は月別partitionをまたいで一意とする。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-002: 同一 event_id の再送は、再送時の occurred_at が別月でも全month fileから最初の既存recordを探してそのまま返し、上書きも別月への二重保存もしない（insertEvent の重複判定）。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-003: 認証境界: 既存 createCompanionAccessGuard（server-to-server認証: internal / service-token / bearer(owner) のみ）をそのまま再利用し、新規の認可ロジックは追加しない。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-004: 集計境界: scripts/send-decision-kpi-to-slack.js は同一ホスト上のcompanion APIをHTTP経由で読むだけで、月次JSONファイルを直接読まない（サーバープロセス経由の一貫性を保つ）。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-005: Alternatives considered: 判断イベントをworkflow-repository.jsの既存ledger（workflow-ledger.json）に混在させる案は、判断委任KPIという独立した関心事を既存workflow監査ログと結合させ、スキーマ肥大化と無関係な参照を招くため却下し、専用サービス・専用ファイルに分離した。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-006: Control: metadata はcompanion controller層で解釈せず、そのまま保存するだけの不透明領域として扱う。 (architecture:docs/architecture/decision-events-kpi-architecture.md)
- REQ-SRC-007: **INV-1 (exact key only)**: INTERNAL_API_SECRETと完全一致する単一のx-internal-api-keyを持つ変更リクエストだけがCSRF middlewareを通過する。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-008: **INV-2 (auth remains authoritative)**: CSRF通過後もrequireAuthが同じkeyを検証し、authSource=internalを設定する。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-009: **INV-3 (fail closed)**: server secret未設定、header欠落、値不一致、複数値headerはinternal requestとして扱わない。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-010: FM-002: key欠落、不一致、複数値headerはCSRF 403でfail closedにする。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-011: Meeting Packの実行経路とRun/Run Receipt/Human Approval/AuditはMeeting AutomationとAutomation Run Coreへ分離して維持する。 (architecture:docs/architecture/ADR-017-agent-first-product-surface.md)
- REQ-SRC-012: Mac Companionは汎用管理画面にならず、人間の注意を扱う面へ集中する。 (architecture:docs/architecture/ADR-017-agent-first-product-surface.md)
- REQ-SRC-013: Web UIを完成条件に含む既存Storyは、Core能力と提供面を分離して改訂する。 (architecture:docs/architecture/ADR-017-agent-first-product-surface.md)
- REQ-SRC-014: WorkflowのProject帰属、run台帳、human step、auditというドメイン判断は維持する。 (architecture:docs/architecture/ADR-017-agent-first-product-surface.md)
- REQ-SRC-015: **Web UIを品質改善して継続する**: MCPと重複する二重実装コストを解消しないため却下する。 (architecture:docs/architecture/ADR-017-agent-first-product-surface.md)
- REQ-SRC-016: **Mac Companionへ全管理機能を再実装する**: UI重複を別クライアントへ移すだけになるため却下する。 (architecture:docs/architecture/ADR-017-agent-first-product-surface.md)
- REQ-SRC-017: 同じsecret検証がCSRF層と認証層に存在するが、middleware順序上のfail-closedを維持するため意図的に許容する。 (architecture:docs/architecture/ADR-eve-internal-api-csrf-exemption.md)
- REQ-SRC-018: workflow path全体の無条件CSRF除外: 認証前の信頼境界を広げるため不採用。 (architecture:docs/architecture/ADR-eve-internal-api-csrf-exemption.md)
- REQ-SRC-019: human actor、service actor、project scopeの認証・認可を保つ。 (architecture:docs/architecture/brainbase-surface-responsibility-matrix.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- architecture: docs/architecture/decision-events-kpi-architecture.md: 判断委任KPI フェーズ1 サーバー側 Architecture
- spec: docs/specs/story-eve-internal-api-csrf-exemption.md: -
- architecture: docs/architecture/ADR-017-agent-first-product-surface.md: ADR-017: Agent-first product surface and Web UI retirement
- architecture: docs/architecture/ADR-eve-internal-api-csrf-exemption.md: ADR: internal API keyをCSRF層でも検証する
- architecture: docs/architecture/brainbase-surface-responsibility-matrix.md: Brainbase Surface Responsibility Matrix
- architecture: docs/architecture/brainbase-web-surface-retirement-inventory.md: Brainbase Web Surface Retirement Inventory

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
