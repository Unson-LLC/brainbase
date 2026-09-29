# Spec: プロジェクト一覧の表示切替

`createGraphProjectsView` に `showProjectLedger` を追加する。既定値は `true`。`false` のとき `renderHostWorkspace` はホスト側の `workspaceLedger` だけを省く。API読込、選択状態、右欄、own share は変えない。

テストでは `false` の場合に一覧行がなく、詳細と集計が残ること、既定値で一覧行が残ることを確認する。
