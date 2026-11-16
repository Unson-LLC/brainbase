---
spec_id: spec-ux-20261004-02-judgment-kind-label
story_id: story-judgment-value-proof-delegation-map-v1
status: proposed
---

# UX-20261004-02 判断の種類の表示一致

## 入力と不変条件

- `delegation_map.rows` の `judgment_kind` 行は `key` で所属を決める。UIはjournalへ書き戻さない。
- 同じkeyに旧・新labelが混在する場合、一覧の行labelをその行の詳細でも表示する。別keyにはその行自身のlabelを使う。
- 分類行の `counts.continued + counts.returned` および行の判断数は、対象行の `items` と整合し、全分類行の件数合計は分類済み判断数と一致する。未分類のreason_code行は種類名を推定しない。

## 検証と判断

- 固定fixtureに同keyの旧・新label 2件と別key 1件を入れ、3件すべてで一覧行labelと詳細labelの一致、行件数 2+1=3、分類済み件数3を確認する。対象UIテストとbuildを実測する。
- 技術選択: journalの旧labelを更新する案は正本の履歴変更となり対象外。詳細だけを元proof labelのままにする案は一覧との不一致を残す。既存の所属行を再利用する表示修正を採用する。
- 未確認: 実journalの値・影響件数、実ブラウザ画面、remote/PR/CI、反映、Inspector同じP2×S1判定、本人の業務成果。ローカルテストはそれらの代用ではない。
