---
story_id: story-personal-value-proof-review-v1
title: 判断価値記録を一覧し、本人の評価を追記して読み戻せる
status: active
created_at: 2026-09-24
implementation_started: true
owner_repository: brainbase
depends_on: ["story-m3-judgment-value-proof-surface"]
external_dependencies: []
---

# 判断価値記録を一覧し、本人の評価を追記して読み戻せる

## 利用者成果

単独所有者として、Brainbaseが自分に聞かずに進めた判断、自分に戻した判断、止まった判断を一覧で確かめ、一件ずつ「採用」「訂正」「次回は聞く」「取り消し」を付けたい。付けた評価は、判断価値記録そのものを書き換えずに残り、読み戻して確認できる。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: OSS単独で動くデータ層（読み取り・分類・評価の追記）。ローカルWebのホストと画面は後続Storyで扱う

外部サービス、組織、メンバー、承認を必須にしない。

## 既存実装との差分

- `src/judgment-value-proof.ts`は判断価値記録の形式・検証・描画を持つが、保存済みの記録を一覧する経路、評価を保存する経路は無い。
- 配置判定の`web_surface`は`'none'`固定で、Webで確認する面を表せない。

## 受入条件

- [ ] AC-01: 設定した判断journal（既定は`~/.brainbase/personal-os/judgment-journal`）から`*.value-proof.json`を読み、既存の検証関数で検証する。形式が合わない記録は件数と理由を返し、隠さない。journalが無い・読めない場合は「利用不可」を返し、0件として扱わない。
- [ ] AC-02: 各記録を、人の判断待ち（`state=waiting_human`）→ 停止（`state=blocked`）→ 聞かずに続行（`resolution=continued_without_human`）→ その他、の順に一つの区分へ分類する。配置判定が`web_surface: 'none'`の記録は「その他」に入れる。最終記録日時と、記録が止まっている可能性を返す。
- [ ] AC-03: 評価は`~/.brainbase/personal-os/judgment-value-proof-feedback.jsonl`へ追記し、判断journalは変更しない。同じ評価の再送信は一件として扱う。「訂正」「取り消し」は理由の1文を必須とする。追記後は読み戻して、記録を確認してから返す。壊れた評価記録は黙って読み飛ばさず、失敗させる。
- [ ] AC-04: 一覧の記録には最新の評価を反映し、評価は本人の評価を指す`human_feedback`の証拠参照を持つ。評価の履歴は別に返す。
- [ ] AC-05: 配置判定の`web_surface`は、週次ダイジェストに含まれる記録で`'review'`、それ以外で`'none'`とする。

## 対象外

ローカルWebのホスト、HTTP、画面。評価から判断基準の改訂候補を作る接続。Graphからの対象名の解決。

## 検証と完了

純粋な分類・評価の反映はfixture、読み取りと追記は一時ディレクトリの実ファイルで確認する。判断journalのファイルが変更されないこと、利用不可を0件にしないことを反例として含める。
