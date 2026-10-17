# Story診断レポート

## Story

| 項目 | 内容 |
|------|------|
| Story ID | story-otawara-gws-customer-doc-separation |
| Story | 顧客固有の大田原オンボーディング文書を共通repoから分離する |
| Status | active |
| View | - |
| Period | - |

## 最新run

| 項目 | 内容 |
|------|------|
| Run ID | 2026-10-17T055023Z |
| Gate | block |
| Created At | 2026-10-17T05:50:24.333Z |
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

## Outcome Case Projection

| 項目 | 内容 |
|------|------|
| Status | not_evaluated |
| Reason | このStory診断レポートは成果ケースの署名、commit marker、ledgerを検証しない。 |
| Verify | `vibepro pr prepare <repo> --story-id story-otawara-gws-customer-doc-separation` |

## graphify集計

| 項目 | 内容 |
|------|------|
| graphify nodes | 15077 |
| graphify edges | 35194 |
| extracted edges | 33491 |
| inferred edges | 1703 |
| ambiguous edges | 0 |

## 構造プロファイル

| 項目 | 内容 |
|------|------|
| 種別 | unknown |
| System type | unknown |
| 描画方式 | - |
| API route | なし |
| DB | なし |
| 認証 | なし |
| 適用チェック | secrets, xss, dependency-graph, code-quality |

### View

| View | 判定 |
|------|------|
| Structure | - |
| Runtime | 0 entrypoints |
| Data | - |
| Security | 0 auth boundaries, 0 secret files |
| Deployment | - |
| Quality | vitest, .github/workflows/docs-cloudflare-pages.yml, .github/workflows/npm-publish.yml, .github/workflows/public-message-promotion.yml, .github/workflows/test.yml |

## API境界

- api-boundary は適用されていない

## 共通スキャン

| 項目 | 内容 |
|------|------|
| index.html | なし |
| scanned files | 1622 |
| secret hits | 15件 (block: 0件, review: 1件, info: 14件) |
| XSS risk hits | 1件 (block: 0件, review: 0件, info: 1件) |
| external resources | 0 |
| non static files | 317 |
| refactoring campaigns | 3 |

## 検出事項

- VP-STATIC-002: 秘密情報の可能性がある値が含まれている（High）
- VP-ARCH-001: 責務が混在している大きなruntime file候補がある（Medium）
- VP-NET-001: UI/API client callに対応するAPI routeが存在しない（Critical）

## 診断レビュー

- Status: needs_review
- 未レビュー: 3件
- suggested implementation_gap: 3件
- suggested detector_gap: 0件

| Finding | Status | Suggested |
|---------|--------|-----------|
| VP-STATIC-002 | unreviewed | implementation_gap |
| VP-ARCH-001 | unreviewed | implementation_gap |
| VP-NET-001 | unreviewed | implementation_gap |

## 次アクション候補

| ID | 対応する検出事項 | 候補 | 対象 | Impact | Community | 読むファイル | 方針 |
|----|------------------|------|------|--------|-----------|------------|------|
| VP-ACTION-ARCH-001 | VP-ARCH-001 | responsibility split campaignをStory化する | 1件 | 0.003 (107 edges) | 61(file: 1, node: 40, edge: 107) | src/foundation-authenticated-tools.ts<br>src/philosophy-revision-reader.ts<br>src/foundation-public-provider.ts | proposal_only / mutates_repository=false |

### 実装手順

#### VP-ACTION-ARCH-001: responsibility split campaignをStory化する

- 優先度: medium
- 理由: VP-CAMPAIGN-REF-001 は 1件の機会を束ねるStory候補。最初に VP-OPP-ARCH-003 を確認する。
- 読むファイル: src/foundation-authenticated-tools.ts（リファクタリングcampaign VP-CAMPAIGN-REF-001 の対象ファイル）, src/philosophy-revision-reader.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/foundation-public-provider.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, tests/foundation-authenticated-tools.test.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, package.json（Graphifyで対象ファイルと直接つながる周辺ファイル）, tests/foundation-adoption-tool.test.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, docs/manual/reference/version-history.md（Graphifyで対象ファイルと直接つながる周辺ファイル）, docs/specs/foundation-graph-adoption-v1.md（Graphifyで対象ファイルと直接つながる周辺ファイル）

修正前ブリーフィング:
- リファクタリング機会: VP-OPP-ARCH-003 / responsibility_split
- Campaign: VP-CAMPAIGN-REF-001 / rank=1
- 推奨抽象化: runtime責務を境界ごとに分離する
- 対象ファイル: src/foundation-authenticated-tools.ts
- 推奨方針: split-runtime-boundaries - 責務混在候補は重複削減より先に、認可、DB、検証、外部I/Oの境界を固定する価値が高い。
- 方針: 方針A: runtime責務をroute/action/service/helperへ分離する / 方針B: 外部I/Oや通知など副作用境界から切り出す

1. 現在の挙動を棚卸しする: 対象ファイルごとにquery条件、返却shape、fallback、例外処理、呼び出し元期待値を確認する。Graphifyの関連ファイルがある場合は先に呼び出し方向と共有hubを確認する。
2. 共通境界を決める: 同じ用途なら共通service/helper/repositoryへ集約する。複数communityに跨る場合は、共通化前にflow単位の責務差分をStory内で分ける。
3. 呼び出し元を置き換える: 既存の返却shapeを保ったまま、対象箇所を共通境界へ接続する。
4. 診断を再実行する: 型検査・関連テスト・VibePro診断で対象機会が減ったこと、Graphify上の影響範囲外を不用意に変更していないことを確認する。

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。

## 生成タスク

| ID | 対応する検出事項 | 優先度 | 対象 | グループ | 方針 |
|----|------------------|--------|------|----------|------|
| VP-TASK-NET-001 | VP-NET-001 | critical | 1件 | - | manual-review |
| VP-TASK-STATIC-002-REVIEW | VP-STATIC-002 | high | 1件 | - | manual-review |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | - | split-runtime-boundaries |

## Artifacts

- summary: .vibepro/diagnostics/2026-10-17T055023Z/summary.md
- risk_register: .vibepro/diagnostics/2026-10-17T055023Z/risk-register.md
- evidence: .vibepro/diagnostics/2026-10-17T055023Z/evidence.json
- static_site_check: .vibepro/diagnostics/2026-10-17T055023Z/static-site-check-result.md
- component_style_check: .vibepro/diagnostics/2026-10-17T055023Z/component-style-check-result.md
- flow_design_check: .vibepro/diagnostics/2026-10-17T055023Z/flow-design-check-result.md
- gesture_interaction_check: .vibepro/diagnostics/2026-10-17T055023Z/gesture-interaction-check-result.md
- terminal_link_check: .vibepro/diagnostics/2026-10-17T055023Z/terminal-link-check-result.md
- architecture_profile: .vibepro/diagnostics/2026-10-17T055023Z/architecture-profile.md
- finding_review: .vibepro/diagnostics/2026-10-17T055023Z/finding-review.md
- refactoring_delta: .vibepro/diagnostics/2026-10-17T055023Z/refactoring-delta.md
- requirement_consistency: .vibepro/diagnostics/2026-10-17T055023Z/requirement-consistency.md
- spec_drift: .vibepro/diagnostics/2026-10-17T055023Z/spec-drift.md
- story_tasks_json: .vibepro/stories/story-otawara-gws-customer-doc-separation/tasks/tasks.json
- story_tasks_markdown: .vibepro/stories/story-otawara-gws-customer-doc-separation/tasks/tasks.md

## 次に見るファイル

- .vibepro/diagnostics/2026-10-17T055023Z/summary.md
- .vibepro/diagnostics/2026-10-17T055023Z/risk-register.md
- .vibepro/diagnostics/2026-10-17T055023Z/evidence.json
