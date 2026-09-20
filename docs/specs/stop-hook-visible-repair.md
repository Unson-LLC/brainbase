# Stop Hook visible repair spec

## Routing

- `classification.intent === "answer"`、`action_kind` が `none` または `read`、`risk === "low"` かつ domain が `engineering` / `operations` の場合、その domain DAG を `direct.v1` に置き換える。
- signal DAG と authority DAG の追加規則は変えない。
- 上記の低リスク説明回答に signal DAG が加わっても、調査・実装用の node evidence 契約は付与しない。
- `write` / `external` または高リスクの `answer` は、従来の domain DAG と node evidence 契約を維持する。
- `answer` 以外の intent は既存の domain DAG を維持する。

## Stop repair output

- `output.reason` はモデルが次に行う修復作業だけを伝える。
- 監査行の全文と、回答本文へ監査行を追加させる指示は `output.reason` に含めない。
- 監査行の最終表示は既存の `systemMessage` に限定し、Hook 出力へ独自フィールドを追加しない。

## Verification

- service unit test で answer と investigate のルーティング差を固定する。
- host unit test で node evidence 修復理由から監査行が除かれることを固定する。
- 既存の judgment resolver unit / integration tests を通す。
