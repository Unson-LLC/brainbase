# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 24 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 12 |
| Spec Refs | 5 |
| Architecture Refs | 7 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: 課題: Ontology 1.0.0の実装が存在しても、本番Graph、公開権限、署名、deploy済みruntimeが同じreleaseへ結合されなければ、安全に有効とは判断できない。 (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-INV-002: 望む変化: 監査、修復、authority、署名、rollback、merge、deployを同一release digestとcommit lineageで追跡できる。 (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-INV-003: 受け入れ基準: current releaseのdigestと署名receiptが本番runtimeで検証できる。 (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-INV-004: 監査で残った61件を、削除せず、確認済み正本に基づいて修復する。 (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-INV-005: 同一scopeにResponsible、Accountable、ApplierのRACIが存在し、認証actorはapplier personと一致する。 (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-INV-006: compatibility: 既存readとlegacy response契約を維持し、canonical writeだけをactive Ontologyへfail closedで結合する (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-INV-007: completion evidence: merged SHA、service health、API digest一致、署名receipt、完全Graph audit 0件、restart後ログ (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-INV-008: Graph修復とgovernance factは保持する (story:docs/management/stories/active/story-brainbase-ontology-production-activation.md)
- REQ-SRC-001: readback: health、version指定/current指定API、両digest一致、署名receiptを確認する。 (spec:docs/specs/brainbase-ontology-production-activation.md)
- REQ-SRC-002: observability: systemd状態、起動後journal、Registry/署名/DB接続エラー不存在を確認する。 (spec:docs/specs/brainbase-ontology-production-activation.md)
- REQ-SRC-003: Graph修復とauthority factは保持する。 (spec:docs/specs/brainbase-ontology-production-activation.md)
- REQ-SRC-004: **INV-2**: ProviderRegistry は service code で provider を解決（重複登録は最後勝ち、warning）。 (spec:docs/specs/settings-plugin-contract-v2-spec.md)
- REQ-SRC-005: **INV-4**: OAuth state は actor / scope / org / project / return URL / nonce を含み、署名 + one-time（Codex 警告 #4）。 (spec:docs/specs/settings-plugin-contract-v2-spec.md)
- REQ-SRC-006: **S-2**: 重複 register → 後勝ち + warning ログ (spec:docs/specs/settings-plugin-contract-v2-spec.md)
- REQ-SRC-007: INV-2: OAuth state は SPEC-settings-plugin-contract-v2 の signOAuthState を経由（actor + return URL + nonce 署名）。 (spec:docs/specs/sns-account-management-spec.md)
- REQ-SRC-008: INV-7: SNS Growth Cockpit は X アカウント未接続・connected・health ok/ng・posting default・metrics default を同じ運用面に表示する。 (spec:docs/specs/sns-account-management-spec.md)
- REQ-SRC-009: S-6: Health Check を押すと provider health/rate limit が同じ画面に戻る (spec:docs/specs/sns-account-management-spec.md)
- REQ-SRC-010: **INV-1 (exact key only)**: INTERNAL_API_SECRETと完全一致する単一のx-internal-api-keyを持つ変更リクエストだけがCSRF middlewareを通過する。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-011: **INV-2 (auth remains authoritative)**: CSRF通過後もrequireAuthが同じkeyを検証し、authSource=internalを設定する。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-012: **INV-3 (fail closed)**: server secret未設定、header欠落、値不一致、複数値headerはinternal requestとして扱わない。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-013: FM-002: key欠落、不一致、複数値headerはCSRF 403でfail closedにする。 (spec:docs/specs/story-eve-internal-api-csrf-exemption.md)
- REQ-SRC-014: S-001: 認可済み MCP がある時、利用者は server/resource/project scope を選び、source ready から10分以内に candidate world と first-value answer review へ到達する。 (spec:docs/specs/ten-minute-world-onboarding-spec.md)
- REQ-SRC-015: S-005: connector を使わない利用者が単一文章ファイルを選んだ時、同じ evidence/review/promotion 契約で candidate world を作る。 (spec:docs/specs/ten-minute-world-onboarding-spec.md)
- REQ-SRC-016: provider 別 valid/invalid scope、failure state、秘密値、重複 source ID を unit fixture で検証する。 (spec:docs/specs/ten-minute-world-onboarding-spec.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/brainbase-ontology-production-activation.md: Brainbase Ontology Production Activation Spec
- architecture: docs/architecture/story-brainbase-ontology-production-activation.md: Ontology 1.0.0 Production Activation Architecture
- spec: docs/specs/settings-plugin-contract-v2-spec.md: SPEC: Settings Provider Plugin Contract v2
- spec: docs/specs/sns-account-management-spec.md: SPEC: X Provider Adapter
- spec: docs/specs/story-eve-internal-api-csrf-exemption.md: -
- spec: docs/specs/ten-minute-world-onboarding-spec.md: 10分オンボーディング Spec
- architecture: docs/architecture/ADR-017-agent-first-product-surface.md: ADR-017: Agent-first product surface and Web UI retirement
- architecture: docs/architecture/ADR-eve-internal-api-csrf-exemption.md: ADR: internal API keyをCSRF層でも検証する
- architecture: docs/architecture/brainbase-surface-responsibility-matrix.md: Brainbase Surface Responsibility Matrix
- architecture: docs/architecture/brainbase-web-surface-retirement-inventory.md: Brainbase Web Surface Retirement Inventory
- architecture: docs/architecture/story-canonical-task-postgres-ssot.md: Architecture: Canonical Task PostgreSQL SSOT
- architecture: docs/architecture/story-companion-canonical-task-provider.md: Companion Canonical Task Provider Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
