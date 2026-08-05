# VibePro リスク台帳

| 項目 | 内容 |
|------|------|
| Run ID | 2026-08-04T110100Z |
| 検出リスク | 1件 |

| ID | カテゴリ | リスク概要 | 深刻度 | 推奨対応 |
|----|----------|------------|--------|----------|
| VP-ARCH-001 | 責務分離 | 責務が混在している大きなruntime file候補がある | Medium | route/action/serviceの境界を見直し、DB取得、認可、入力検証、通知・外部I/O、レスポンス整形を分離するStoryに落とす。 |

## API境界の保護状態

- api-boundary は適用されていない

## 診断レビュー分類

| Finding | Status | Suggested | Action | Rationale |
|---------|--------|-----------|--------|-----------|
| VP-ARCH-001 | unreviewed | implementation_gap | VP-ACTION-ARCH-001 | VP-ARCH-001 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |

## 次アクション候補

| ID | 対応する検出事項 | 候補 | 対象 | Impact | Community | 読むファイル | 方針 |
|----|------------------|------|------|--------|-----------|------------|------|
| VP-ACTION-ARCH-001 | VP-ARCH-001 | responsibility split campaignをStory化する | 2件 | 0.27 (340 edges) | 0(file: 2, node: 45, edge: 254), 4(file: 1, node: 30, edge: 87), 10(file: 1, node: 2, edge: 14) | src/cli.ts<br>src/ssot.ts<br>src/onboarding.ts | proposal_only / mutates_repository=false |

### 実装手順

#### VP-ACTION-ARCH-001: responsibility split campaignをStory化する

- 優先度: low
- 理由: VP-CAMPAIGN-REF-001 は 2件の機会を束ねるStory候補。最初に VP-OPP-ARCH-001 を確認する。
- 読むファイル: src/cli.ts（リファクタリングcampaign VP-CAMPAIGN-REF-001 の対象ファイル）, src/ssot.ts（リファクタリングcampaign VP-CAMPAIGN-REF-001 の対象ファイル）, src/onboarding.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/import-extract.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/guided-onboarding.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/ontology.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/tools.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/paths.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/projects.ts（Graphifyで対象ファイルと直接つながる周辺ファイル）

修正前ブリーフィング:
- リファクタリング機会: VP-OPP-ARCH-001 / responsibility_split
- Campaign: VP-CAMPAIGN-REF-001 / rank=1
- 推奨抽象化: runtime責務を境界ごとに分離する
- 対象ファイル: src/cli.ts, src/ssot.ts
- 推奨方針: split-by-graph-community - Graphify上で複数communityに跨るため、先にflow単位の責務差分を分け、共通化は安定した境界に限定する。
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
