# VibePro 診断サマリー

| 項目 | 内容 |
|------|------|
| Run ID | 2026-08-02T163157Z |
| Story | 本番GraphとOntology 1.0.0の互換性を確立する |
| Story ID | story-brainbase-ontology-production-compatibility |
| 診断フェーズ | pre_implementation |
| VibePro Runtime | vibepro@0.2.0-beta.2 commit=37418424323e dirty=true |
| 種別 | web_app |
| 描画方式 | react |
| 適用チェック | secrets, xss, dependency-graph, component-style, code-quality, database-access |
| graphify nodes | 6439 |
| graphify edges | 13766 |
| 共通スキャン対象 | 3473件 |
| 秘密情報候補 | 38件 (block: 0件, review: 0件, info: 38件) |
| XSSリスク候補 | 187件 (block: 0件, review: 100件, info: 87件) |
| UI旧トークン候補 | 13件 (block: 0件, review: 13件, info: 0件) |
| UI操作信頼性候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| UIコンポーネント種別 | badge, button, card, filter, input, list_item, modal, sidebar, tab |
| Gesture Interaction Gate | pass |
| Gesture Interaction候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| Terminal Link契約 | ok |
| Terminal Link候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| Flow Design Gate | needs_review |
| Flow Design UI走査 | 135件 |
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
| API client call | 10件 |
| API route欠落 | 0件 |
| Requirement Gate | pass |
| 要件不変条件 | 21件 |
| シナリオ確認候補 | 0件 |
| 要件矛盾候補 | 0件 |
| Performance Metrics | 0件 |
| Performance Comparable | 0件 |
| Performance Unknown | 0件 |
| 検出事項 | 4件 |

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
- API client calls: 10
- Missing routes: 0
- Dynamic calls: 10
- Server function replacements: 0
| Kind | API | File | Line |
| --- | --- | --- | --- |
| dynamic_path | /api/v2/tables/${issueTable.id}/records | server/controllers/nocodb-controller.js | 344 |
| dynamic_path | /api/v2/meta/bases/${baseId}/tables | server/controllers/nocodb-controller.js | 522 |
| dynamic_path | /api/v2/meta/tables/${tableId} | server/controllers/nocodb-controller.js | 536 |
| dynamic_path | /api/v2/tables/${taskTable.id}/records | server/controllers/nocodb-controller.js | 552 |
| dynamic_path | /api/v2/tables/${tableId}/records | server/controllers/nocodb-controller.js | 635 |

## ゲート状態

- production-readiness: needs_review - 文脈品質または適用チェックに確認が必要な項目がある

## Requirement Consistency

- Status: pass
- Invariants: 21
- Scenario Gaps: 0
- Contradictions: 0

## Flow Design

- Status: needs_review
- UI Files: 135
- Silent Noops: 0
- Selection Side Effects: 0
- Question Dead Ends: 0
- Dead UI States: 0
- Value Alignment: 0

## Performance Evidence

# VibePro Performance Evidence

Story: story-brainbase-ontology-production-compatibility
Metrics: 0
Runs: 0
Comparable: 0
Not comparable: 0

- No performanceMetrics are defined for this story.


## 主な検出事項

- VP-STATIC-003: XSS につながり得る DOM 操作がある（High）
- VP-UI-001: 旧デザインコンポーネントのトークン候補が残っている（Medium）
- VP-FLOW-006: クリック可能に見えるUIに操作契約がない候補がある（High）
- VP-NET-003: 静的にroute実体を確定できないAPI client callがある（Medium）

## 文脈品質ノート

- VP-GRAPH-002: 推論された依存関係がある（info）

## 診断レビュー

- Status: needs_review
- 未レビュー: 4件
- suggested implementation_gap: 4件
- suggested detector_gap: 0件
- 正本: finding-review.md と evidence.json の finding_review

## リファクタリング差分

- 比較対象の両runにリファクタリング機会なし

## 次アクション候補

- なし
