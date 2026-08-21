# ChatGPT ConnectorのPhase 0本番有効化を確認する

## 利用者価値

マージ済みの同一commitをBrainbase API/MCPとChatGPT Connectorへ反映し、Graphを変更せずに、専用認証・保守読取り・dry-run・権限拒否が本番経路で一致することを確認できる。

## 依存

- `story-chatgpt-phase0-connector-sync`のPRがマージ済みであること。
- 本番API/MCPへ同一のマージcommitをdeployできること。

## 受け入れ条件

- [ ] AC-001: deploy前の本番runtime SHAをrollback先として記録する。deploy後はAPI/MCPのruntime SHAがマージcommitと一致し、DB migration versionを診断できる。
- [ ] AC-002: Connector専用サービス認証がorganization `unson`と19 project scopeへ束縛され、Canonical Task操作がHTTP 200になる。
- [ ] AC-003: 本番MCPの`tools/list`に6つのGraph Maintenance操作が存在し、ChatGPT Hostのschema cache更新後にも同じ6操作を発見できる。
- [ ] AC-004: `dec_01KQ8T8SXZ0YA7GQTE1CYEGJGK`を`retired` / version 2としてreadbackできる。
- [ ] AC-005: 変更なしdry-runがPlan Receiptを返す。権限なしApplyは構造化エラーになり、前後のGraph hashと行が一致する。

## 境界

- Batch 2のApplyは行わない。
- dry-runおよび権限拒否確認以外のGraph変更は行わない。
- secret値はGit、VibePro artifact、標準出力へ保存しない。
- いずれかのreadbackが失敗した場合は本番完了にせず、記録済みの旧SHAへrollbackしてruntime SHA・health・tools/listを再確認するか、Connector有効化を停止する。
