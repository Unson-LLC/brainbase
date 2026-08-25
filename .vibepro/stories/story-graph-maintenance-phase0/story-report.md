# Story診断レポート

## Story

| 項目 | 内容 |
|------|------|
| Story ID | story-graph-maintenance-phase0 |
| Story | Graph SSOTデータ整備 Phase 0 MCP |
| Status | active |
| View | - |
| Period | - |

## 最新run

| 項目 | 内容 |
|------|------|
| Run ID | 2026-08-20T161128Z |
| Gate | needs_review |
| Created At | 2026-08-20T16:11:43.020Z |
| Story run数 | 1 |

## Journey Context

| 項目 | 内容 |
|------|------|
| Required | no |
| Status | not_required |
| Artifact kind | - |
| Curated | no |
| Curation status | not_required |
| Handoff | no |
| Journey ID | default-product-journey |
| Detection | - |
| Source docs | - |
| Reason | No UI/Journey signals were found in the Story metadata or tracked Story docs. |

### Journey Next Actions

- なし

## graphify集計

| 項目 | 内容 |
|------|------|
| graphify nodes | 7263 |
| graphify edges | 15613 |
| extracted edges | 11221 |
| inferred edges | 4392 |
| ambiguous edges | 0 |

## 構造プロファイル

| 項目 | 内容 |
|------|------|
| 種別 | web_app |
| System type | web_application |
| 描画方式 | react |
| API route | なし |
| DB | postgres |
| 認証 | なし |
| 適用チェック | secrets, xss, dependency-graph, component-style, code-quality, database-access |

### View

| View | 判定 |
|------|------|
| Structure | web_app, react |
| Runtime | 0 entrypoints |
| Data | postgres |
| Security | 0 auth boundaries, 6 secret files |
| Deployment | - |
| Quality | vitest, playwright, .github/workflows/daily-snapshot.yml, .github/workflows/daily-story-alerts.yml, .github/workflows/graph-writer-contract.yml, .github/workflows/security-check.yml, .github/workflows/vibepro-graph-ssot.yml, .github/workflows/vibepro-graphify-impact.yml, .github/workflows/vibepro-score-run.yml, .github/workflows/weekly-story-progress.yml |

## API境界

- api-boundary は適用されていない

## 共通スキャン

| 項目 | 内容 |
|------|------|
| index.html | なし |
| scanned files | 4019 |
| secret hits | 149件 (block: 0件, review: 0件, info: 149件) |
| XSS risk hits | 714件 (block: 0件, review: 100件, info: 614件) |
| external resources | 5 |
| non static files | 354 |
| refactoring campaigns | 0 |

## 検出事項

- VP-STATIC-003: XSS につながり得る DOM 操作がある（High）
- VP-UI-001: 旧デザインコンポーネントのトークン候補が残っている（Medium）
- VP-FLOW-006: クリック可能に見えるUIに操作契約がない候補がある（High）
- VP-NET-003: 静的にroute実体を確定できないAPI client callがある（Medium）

## 診断レビュー

- Status: needs_review
- 未レビュー: 4件
- suggested implementation_gap: 4件
- suggested detector_gap: 0件

| Finding | Status | Suggested |
|---------|--------|-----------|
| VP-STATIC-003 | unreviewed | implementation_gap |
| VP-UI-001 | unreviewed | implementation_gap |
| VP-FLOW-006 | unreviewed | implementation_gap |
| VP-NET-003 | unreviewed | implementation_gap |

## 次アクション候補

- なし

## 生成タスク

| ID | 対応する検出事項 | 優先度 | 対象 | グループ | 方針 |
|----|------------------|--------|------|----------|------|
| VP-TASK-FLOW-006 | VP-FLOW-006 | high | 20件 | - | manual-review |
| VP-TASK-STATIC-003 | VP-STATIC-003 | high | 34件 | - | manual-review |

## Artifacts

- summary: .vibepro/diagnostics/2026-08-20T161128Z/summary.md
- risk_register: .vibepro/diagnostics/2026-08-20T161128Z/risk-register.md
- evidence: .vibepro/diagnostics/2026-08-20T161128Z/evidence.json
- static_site_check: .vibepro/diagnostics/2026-08-20T161128Z/static-site-check-result.md
- component_style_check: .vibepro/diagnostics/2026-08-20T161128Z/component-style-check-result.md
- flow_design_check: .vibepro/diagnostics/2026-08-20T161128Z/flow-design-check-result.md
- gesture_interaction_check: .vibepro/diagnostics/2026-08-20T161128Z/gesture-interaction-check-result.md
- terminal_link_check: .vibepro/diagnostics/2026-08-20T161128Z/terminal-link-check-result.md
- architecture_profile: .vibepro/diagnostics/2026-08-20T161128Z/architecture-profile.md
- finding_review: .vibepro/diagnostics/2026-08-20T161128Z/finding-review.md
- refactoring_delta: .vibepro/diagnostics/2026-08-20T161128Z/refactoring-delta.md
- requirement_consistency: .vibepro/diagnostics/2026-08-20T161128Z/requirement-consistency.md
- spec_drift: .vibepro/diagnostics/2026-08-20T161128Z/spec-drift.md
- story_tasks_json: .vibepro/stories/story-graph-maintenance-phase0/tasks/tasks.json
- story_tasks_markdown: .vibepro/stories/story-graph-maintenance-phase0/tasks/tasks.md

## 次に見るファイル

- .vibepro/diagnostics/2026-08-20T161128Z/summary.md
- .vibepro/diagnostics/2026-08-20T161128Z/risk-register.md
- .vibepro/diagnostics/2026-08-20T161128Z/evidence.json
