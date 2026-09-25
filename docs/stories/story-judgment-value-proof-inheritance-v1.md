---
story_id: story-judgment-value-proof-inheritance-v1
title: 判断価値記録に、引き継いだ経験・根拠の層・判断の種類を残せる
status: active
created_at: 2026-09-25
implementation_started: true
owner_repository: brainbase
depends_on: ["story-m3-judgment-value-proof-surface", "story-personal-value-proof-review-web-v1"]
external_dependencies: []
---

# 判断価値記録に、引き継いだ経験・根拠の層・判断の種類を残せる

## 利用者成果

所有者として、Brainbaseが聞かずに進めた判断について、「前のどの経験を、どの条件で今回も使い、何を今回だけ確かめたか」と、「大切にすること・目的・現状認識・判断方法のどれに基づいたか」を、判断のときの記録から確かめたい。後から作った説明ではなく、判断時に残した記録で見たい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 判断価値記録の形式（`brainbase-judgment-value-proof-v1`）、検証、判断レシートの描画、見返し画面の判断カード

記録を作る側（判断hookとMCP tool）への受け渡しは、記録を作るrepoの後続Storyで扱う。

## 既存実装との差分

- `decision.prior_learning_reused`は真偽か「未確認」だけで、何を引き継いだかを持てない。
- `decision.basis[]`は対象IDと適用内容だけで、その根拠が目的なのか現状認識なのかを持てない。
- 委任の範囲を束ねる判断の種類が無い。

## 受入条件

- [ ] AC-01: `decision.inheritance`（引き継ぎ元の判断・判断方法とその版、今回も同じと見た条件、今回だけ確認した条件）、`decision.basis[].layer`と`version`、`decision.judgment_kind`を任意の欄として追加する。欄の無い既存の記録は、変更前と同じく検証を通る。
- [ ] AC-02: 引き継ぎ元があるのに`prior_learning_reused`が`false`の記録、未知の層、形式が不正な判断の種類を、検証で拒否する。
- [ ] AC-03: 判断レシートは、層のある根拠を「[目的] …」のように表示し、引き継ぎがある場合だけ「引き継ぎ: …。今回も同じ: …。今回だけ確認: …」を表示する。欄が無い場合の表示は変えない。
- [ ] AC-04: 見返し画面の判断カードに「引き継ぎ」の行を加え、記録が無い場合は「引き継ぎの記録なし」と表示する。根拠には層を付け、判断の種類があれば表示する。
- [ ] AC-05: 公開契約`contracts/judgment-value-proof/schema.json`に、同じ任意の欄を追加する。

## 対象外

判断hookやMCP toolがこれらの欄を埋めること。判断の種類ごとの委任の地図。評価に「何を直すか」を加えること。

## 検証と完了

欄の有無の両方で検証・描画・画面表示を確認する。既存の実際の記録が、変更後も検証を通ることを確認する。
