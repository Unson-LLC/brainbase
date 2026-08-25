# ChatGPT ConnectorをPhase 0 Graph Maintenanceへ同期する

## 利用者価値

ChatGPTから、Brainbase本番のPhase 0保守状態を旧payloadと混同せず読み取り、公開済みのGraph Maintenance操作とCanonical Taskを同じ認証scopeで利用できる。

## 受け入れ条件

- [ ] AC-001: MCPのtool discoveryに6つのGraph Maintenance操作が存在する。
- [ ] AC-002: Graph APIから取得した`lifecycle_status`、`semantic_state`、`version`を、業務payloadの`status`と分離して`search`と`get_entity`へ表示する。
- [ ] AC-003: Admin Graph読取りは`id`と`q`を現在のAPIへそのまま転送し、保守列を返す。
- [ ] AC-004: MCPは明示された`BRAINBASE_GRAPH_API_TOKEN`を保存済み個人tokenより優先し、環境tokenがない場合だけ既存fallbackを使う。

## 境界

- Batch 2のApplyは本Storyに含めない。
- `payload.status`は業務状態として保持し、保守上のlifecycleへ置換しない。
- secret値はGit、VibePro artifact、標準出力へ保存しない。
- 専用サービス認証の本番投入、同一SHAのreadback、ChatGPT Hostのschema cache更新は、マージ後に`story-chatgpt-phase0-connector-production-activation`で検証する。本StoryのPR前Gateへ本番先行deployを要求しない。
