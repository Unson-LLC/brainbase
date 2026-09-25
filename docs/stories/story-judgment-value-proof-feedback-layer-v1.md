---
story_id: story-judgment-value-proof-feedback-layer-v1
title: 判断への評価に、何を直すかを残せる
status: active
created_at: 2026-09-25
implementation_started: true
owner_repository: brainbase
depends_on: ["story-personal-value-proof-review-v1", "story-personal-value-proof-review-web-v1"]
external_dependencies: []
---

# 判断への評価に、何を直すかを残せる

## 利用者成果

所有者として、Brainbaseの判断を訂正するとき、それが「任せる範囲」「判断方法」「目的」「現状認識」「大切にすること」のどれを直すものかを残したい。訂正の種類ごとに、次の判断へどう反映するかを決める材料にしたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 評価の追記記録（`brainbase-judgment-value-proof-feedback-v1`）、見返しのHTTP、見返し画面の評価フォーム

## 受入条件

- [ ] AC-01: 評価の追記記録に`target_layer`を加える。「次回は聞く」は常に任せる範囲（`delegation`）として記録し、「訂正」は何を直すかを必須にし、「採用」「取り消し」は層を持たない。
- [ ] AC-02: 層の欄が無い既存の評価記録は、変更前と同じく読める。
- [ ] AC-03: 評価記録を、判断ごとの最新の評価で数え、評価の種類と層ごとの件数を返す。層の記録が無い訂正は「記録なし」として数える。
- [ ] AC-04: 評価フォームは「訂正」を選んだときだけ何を直すかの選択を出し、選ばないと保存しない。判断カードと評価の履歴に層を表示する。

## 対象外

評価から改訂候補を作ること。会話（MCP）から評価を記録すること。

## 検証と完了

記録・読み取り・集計は一時ディレクトリの実ファイルで、フォームは簡易DOMと実ブラウザで確認する。
