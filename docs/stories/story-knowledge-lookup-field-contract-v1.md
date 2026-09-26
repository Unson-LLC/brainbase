---
story_id: story-knowledge-lookup-field-contract-v1
title: 知識取得の入力誤りを修正して本文取得を継続できる
status: implemented
implementation_started: true
owner_repository: brainbase
---

# 利用者成果

知識を必要とする利用者として、取得項目の入力誤りを訂正し、同じ目的の本文取得と根拠付き終了まで進めたい。

## 変更方針

SIMPLIFICATION。既存のHost継続契約とLookup APIに重複する入力検証を揃える。回復用の別ワークフローやジャーナル書換えは追加しない。

## 受入条件

- AC-01: APIが受け付けないrequired_fieldsはHostでも固定前に拒否され、正しい項目で再試行できる。
- AC-02: 有効な取得条件は固定され、取得中に条件を弱める変更を認めない。
- AC-03: finishに必要な情報をHostとAPIが同じ条件で検証する。不完全な終了要求を実行済みや通信失敗として扱わない。
- AC-04: 既存の取得予算、権限、実際のreadに基づく充足判定を維持する。
- AC-05: Hostの案内から有効な取得項目と終了要求を構成できる。

## 調査

Graphifyは対象worktreeのgraphが存在せず影響範囲はunknown。知識継続とAPIの実装・関連テストを直接確認する。

## 検証

- 関連2ファイルの30テスト成功。`npm run build`、`git diff --check`成功。
- 1回のレビューで検出した固定前検証・終了要求の境界差・負例テストを修正し、関連範囲を再検証済み。
- 本番反映はHostのOSS依存更新に接続する。
