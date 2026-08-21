# ChatGPT ConnectorをPhase 0 Graph Maintenanceへ同期する

## 利用者価値

ChatGPTから、Brainbase本番のPhase 0保守状態を旧payloadと混同せず読み取り、公開済みのGraph Maintenance操作とCanonical Taskを同じ認証scopeで利用できる。

## 受け入れ条件

- [ ] AC-001: MCPのtool discoveryに6つのGraph Maintenance操作が存在する。
- [ ] AC-002: Graph APIから取得した`lifecycle_status`、`semantic_state`、`version`を、業務payloadの`status`と分離して`search`と`get_entity`へ表示する。
- [ ] AC-003: Admin Graph読取りは`id`と`q`を現在のAPIへそのまま転送し、保守列を返す。
- [ ] AC-004: 専用サービス認証はorganizationと19 project scopeへ束縛され、Canonical Task読取りがHTTP 200になる。
- [ ] AC-005: 本番で対象Decisionを`retired` / version 2として読め、変更なしdry-runがReceiptを返す。Apply権限拒否は構造化エラーになり、Graphを変更しない。

## 境界

- Batch 2のApplyは本Storyに含めない。
- `payload.status`は業務状態として保持し、保守上のlifecycleへ置換しない。
- secret値はGit、VibePro artifact、標準出力へ保存しない。
