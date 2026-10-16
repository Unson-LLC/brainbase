---
story_id: story-philosophy-catalog-unscoped-visible
title: 判断で使う哲学を、適用範囲が未記録でも目的と現状で確認できる
status: active
created_at: 2026-10-16
implementation_started: true
owner_repository: brainbase
depends_on: ["story-philosophy-catalog-legacy"]
external_dependencies: []
---

# 判断で使う哲学を、適用範囲が未記録でも目的と現状で確認できる

## 利用者成果

目的と現状の画面を開いたとき、判断で参照されている哲学が、適用範囲を記録していないものも含めて見える。適用範囲が未記録のものは、適用範囲が検証された哲学と区別して示される。哲学があるのに「登録された哲学がありません」とは表示しない。

## 背景

2026-10-16、組織版の目的と現状で brainbase を選ぶと「この対象範囲には登録された哲学がありません。」と出た。同じ日の判断の一覧（`brainbase_judgment_frame_catalog`）は、brainbase の哲学46件を使っていた。

- 判断の一覧は `/api/info/graph/entities?type=philosophy` を読み、適用範囲の有無を問わず active な哲学を使う。
- 画面の `GET /api/foundation/catalog` は、#690 以降 `judgmentApplicability` を持つ哲学だけを返す。brainbase の46件はすべて適用範囲が未記録のため、応答は空だった。
- 画面は、その除外を「登録なし」と表示していた（台帳 P9 の違反）。

## 受入条件

- [x] カタログ応答に `philosophies_without_applicability` を加え、選択プロジェクトの active で適用範囲が未記録の哲学を返す。判断の一覧と同じく、置き換え済み（superseded・retired・rejected）と本文の無いものは含めない。
- [x] 既存の `philosophies`（適用範囲が検証された版）の境界と厳格な検証は変えない。適用範囲を推測・補完しない。
- [x] 共通UIは、適用範囲が未記録の哲学を「適用範囲: 未記録」として区別して表示する。
- [x] 新しい項目を返さない古いホストでは、「登録された哲学がありません」と言わず、未記録の哲学の有無が確認できていないことを示す。
- [x] 形式の不正な項目は黙って落とさず、取得失敗として示す。

## 対象外

- Graph の哲学へ適用範囲を書き足すこと（共有データの変更で、別途承認が要る）。
- unson のカタログが履歴行の欠落で `corrupt_catalog` になる件。

## 検証

- PGlite の実DB互換テストで、適用範囲の無い active の行だけが返り、retired・superseded・別プロジェクトの行は返らないことを確認する。
- HTTP アダプタのテストで、応答に必要な項目だけが入り、所有者などの他の項目が出ないことを確認する。
- UI テストで、未記録の哲学の表示、古いホストでの文言、形式不正の拒否、組織全体の表示での合流を確認する。
- 本番の哲学データ（2026-10-16 取得）で新しい読み取りを動かし、brainbase の結果が判断の一覧の46件と一致することを確認する。
