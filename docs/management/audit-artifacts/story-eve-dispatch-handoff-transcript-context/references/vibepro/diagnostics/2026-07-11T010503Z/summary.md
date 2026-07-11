# VibePro 診断サマリー

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-11T010503Z |
| Story | Eve dispatch handoffにtranscript本文と書き戻し契約を含める |
| Story ID | story-eve-dispatch-handoff-transcript-context |
| 診断フェーズ | pre_implementation |
| VibePro Runtime | vibepro@0.1.0-beta.0 commit=670f7b40a64a dirty=true |
| 種別 | web_app |
| 描画方式 | react |
| 適用チェック | secrets, xss, dependency-graph, component-style, code-quality, database-access |
| graphify nodes | 6553 |
| graphify edges | 13661 |
| 共通スキャン対象 | 2678件 |
| 秘密情報候補 | 30件 (block: 0件, review: 0件, info: 30件) |
| XSSリスク候補 | 267件 (block: 0件, review: 150件, info: 117件) |
| UI旧トークン候補 | 77件 (block: 0件, review: 77件, info: 0件) |
| UI操作信頼性候補 | 120件 (block: 0件, review: 120件, info: 0件) |
| UIコンポーネント種別 | badge, button, card, filter, input, list_item, modal, sidebar, tab |
| Gesture Interaction Gate | needs_review |
| Gesture Interaction候補 | 131件 (block: 0件, review: 131件, info: 0件) |
| Terminal Link契約 | ok |
| Terminal Link候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| Flow Design Gate | needs_review |
| Flow Design UI走査 | 150件 |
| Flow Design検出候補 | 0件 |
| 重いdev script候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| runtime probe plan | available (1 commands) |
| DB未ページング候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| 認可前bulk DB候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| 重複query形状候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| 責務混在候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| リファクタリング機会 | 0件 |
| リファクタリングcampaign | 0件 |
| API route | 0件 |
| Network Contract | needs_review |
| API client call | 6件 |
| API route欠落 | 0件 |
| Requirement Gate | pass |
| 要件不変条件 | 5件 |
| シナリオ確認候補 | 0件 |
| 要件矛盾候補 | 0件 |
| Performance Metrics | 0件 |
| Performance Comparable | 0件 |
| Performance Unknown | 0件 |
| 検出事項 | 6件 |

## アーキテクチャView

| View | 判定 |
|------|------|
| Structure | web_app, react |
| Runtime | 0 entrypoints |
| Data | postgres |
| Security | 0 auth boundaries, 3 secret files |
| Deployment | - |
| Quality | vitest, playwright, .github/workflows/daily-snapshot.yml, .github/workflows/daily-story-alerts.yml, .github/workflows/security-check.yml, .github/workflows/vibepro-graph-ssot.yml, .github/workflows/vibepro-graphify-impact.yml, .github/workflows/vibepro-score-run.yml, .github/workflows/weekly-story-progress.yml |

## API境界

- api-boundary は適用されていない

## Network Contract

- Status: needs_review
- Routes: 0
- API client calls: 6
- Missing routes: 0
- Dynamic calls: 6
- Server function replacements: 0
| Kind | API | File | Line |
| --- | --- | --- | --- |
| dynamic_path | /api/v2/tables/${issueTable.id}/records | server/controllers/nocodb-controller.js | 321 |
| dynamic_path | /api/v2/meta/bases/${baseId}/tables | server/controllers/nocodb-controller.js | 479 |
| dynamic_path | /api/v2/meta/tables/${tableId} | server/controllers/nocodb-controller.js | 491 |
| dynamic_path | /api/v2/tables/${taskTable.id}/records | server/controllers/nocodb-controller.js | 507 |
| dynamic_path | /api/v2/tables/${tableId}/records | server/controllers/nocodb-controller.js | 592 |

## ゲート状態

- production-readiness: needs_review - 文脈品質または適用チェックに確認が必要な項目がある

## Requirement Consistency

- Status: pass
- Invariants: 5
- Scenario Gaps: 0
- Contradictions: 0

## Flow Design

- Status: needs_review
- UI Files: 150
- Silent Noops: 0
- Selection Side Effects: 0
- Question Dead Ends: 0
- Dead UI States: 0
- Value Alignment: 0

## Performance Evidence

# VibePro Performance Evidence

Story: story-eve-dispatch-handoff-transcript-context
Metrics: 0
Runs: 0
Comparable: 0
Not comparable: 0

- No performanceMetrics are defined for this story.


## 主な検出事項

- VP-STATIC-003: XSS につながり得る DOM 操作がある（High）
- VP-UI-001: 旧デザインコンポーネントのトークン候補が残っている（Medium）
- VP-UI-002: クリック可能要素のhit targetが不安定になるCSS候補がある（Medium）
- VP-GESTURE-001: map/carousel/touch操作の契約不足候補がある（Medium）
- VP-FLOW-006: クリック可能に見えるUIに操作契約がない候補がある（High）
- VP-NET-003: 静的にroute実体を確定できないAPI client callがある（Medium）

## 文脈品質ノート

- VP-GRAPH-002: 推論された依存関係がある（info）

## 診断レビュー

- Status: needs_review
- 未レビュー: 6件
- suggested implementation_gap: 6件
- suggested detector_gap: 0件
- 正本: finding-review.md と evidence.json の finding_review

## リファクタリング差分

- 前回の同一Story診断runがないため、差分は未算出

## 次アクション候補

- なし
