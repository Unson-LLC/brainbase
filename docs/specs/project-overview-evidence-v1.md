# 概要投影の表示契約

Story: `story-project-overview-evidence-v1`

`detail.overview` は任意のホスト投影。未接続なら既存概要を維持する。投影が存在する場合は以下の順で表示し、既存contextの区分一覧はその後に残す。

1. このプロジェクトについて
2. 次に確認すること
3. プロジェクト名に直接紐づく資料
4. 関連資料

## 入力

`overview.about`: definition, owner, finalApprover, goal は string|null。source は string|null、asOf は取得日時。

`overview.checks`: id/title/summary/recordId を持つ行。正本に存在する確認事項、または不足項目の確認導線に限定する。優先度や業務上の指示をUIで生成しない。

`overview.directMaterials`, `overview.relatedMaterials`: {state, items, total?, note?}。state は ok/partial/unknown/failed/unavailable/loading。items は {id,title,relation,source,bodyState,contentAsOf,updatedAt}。bodyState は retrieved/unretrieved/unavailable/failed/unknown。未知値は未確認として表示する。total が非負整数でなければ総数未確認。okかつtotal=0かつitems空の場合のみ確認済み0件。

## 不変条件

- 投影は認可したサーバーが作る。UIは関係や所属を推測しない。
- 内容時点と更新日時は別列。任意の更新日時を内容時点に代用しない。
- 件数は表示中の件数と総数を分ける。partial/failed/unknown は空成功にならない。
- 資料はIDを既存openGraphEntityへ渡す。本文取得状態は本文の有無の断定に使わない。
- DOM textContentで安全に表示する。関係先のURLを推測・生成しない。

## 検証

投影ありの表示順、直接/関連の分離、欠損/部分/失敗と0件の区別、日時の区別、正本ID導線、投影なしの互換、狭幅を検証する。
