# Info SSOT RLS 配備ゲート

`server/sql/info-ssot-schema.sql`、`server/sql/project-provisioning-schema.sql`、`server/sql/outcome-case-schema.sql` と `server/sql/info-ssot-rls.sql` を本番へ適用する前後のリリース手順。API/MCPを再起動する前に、このゲートを完了させる。

## 安全境界

- 接続先は `INFO_SSOT_DATABASE_URL` からのみ取得する。URL、token、passwordをログやReceiptへ出さない。
- schema、RLS、同一transaction内readback、negative smokeは `ON_ERROR_STOP=1` と `--single-transaction` で一括実行する。
- readbackまたはnegative smokeが失敗した場合、transactionをcommitせず、Receiptを作らず、API/MCPを起動しない。
- SQLは既存の `IF NOT EXISTS` とpolicy再作成規約に従い、再実行可能である。
- negative smokeのfixtureはtransaction内で作成・認可確認・拒否確認・削除を行う。成功後にGraphへfixtureを残さない。

## 適用前

```bash
cd /home/ubuntu/brainbase
test -z "$(git status --porcelain)"
TARGET_SHA="$(git rev-parse HEAD)"
: "${ROLLBACK_SHA:?set this to the 40-character SHA recorded before checkout advanced}"
grep -Eq '^[0-9a-f]{40}$' <<<"$TARGET_SHA"
grep -Eq '^[0-9a-f]{40}$' <<<"$ROLLBACK_SHA"
test -r scripts/info-ssot-apply.sh
test -r server/sql/info-ssot-schema.sql
test -r server/sql/project-provisioning-schema.sql
test -r server/sql/outcome-case-schema.sql
test -r server/sql/info-ssot-rls.sql
test -r server/sql/info-ssot-readback.sql
test -r server/sql/info-ssot-negative-smoke.sql
```

`INFO_SSOT_DATABASE_URL` はsystemd/Infisical等の秘密管理から注入する。値を`export`、echo、shell履歴へ残さない。
`INFO_SSOT_ROLLBACK_SHA` は必須であり、適用前に記録した40桁SHAを渡す。未指定ならDBへ接続せず停止する。

本番ロール `brainbase_app` をスキーマ適用後に作成した場合は、サービス起動前に
`server/sql/project-provisioning-schema.sql` を再適用する。これにより
`project_code_collision_sources`、`project_graph_identity_probe`、
`claim_project_code` の3関数が一括で付与され、readbackでも照合される。

## 適用とreadback

```bash
INFO_SSOT_GIT_SHA="$TARGET_SHA" \
INFO_SSOT_ROLLBACK_SHA="$ROLLBACK_SHA" \
INFO_SSOT_OPERATION_MODE="apply" \
INFO_SSOT_APPLY_RECEIPT_PATH="var/info-ssot-apply-receipt.json" \
bash scripts/info-ssot-apply.sh
```

このコマンドは次の順で実行する。

1. schema、RLS、in-transaction readback、transaction-local negative smokeを一つのtransactionで適用する。
2. commit後にRLS/readbackを再検査する。
3. 安全なDB識別子、PostgreSQL `server_version`、適用SHAを含むReceiptを同一ディレクトリへatomicに保存する。

Receiptの最低限の確認項目は、`status=applied`、`operation_mode=apply`、`database_bundle_sha`、`service_target_sha`、`apply_commit_sha`、`database`、`server_version`、`transaction=single`、`on_error_stop=true`、`readback.status=passed`、`readback.marker=INFO_SSOT_READBACK_OK`、`negative_smoke.status=passed`、`negative_smoke.marker=INFO_SSOT_NEGATIVE_SMOKE_OK`、`rollback.status=documented`である。通常適用では`database_bundle_sha`と`service_target_sha`が適用対象SHAに一致することを確認する。Receiptがない、または項目が欠ける場合は成功と扱わない。

## API/MCP再起動

適用コマンドの終了コード、Receipt、readback、negative smokeがすべて確認できるまで、`brainbase-ssot.service`とMCP runtimeを再起動してはならない。

```bash
sudo systemctl restart brainbase-ssot.service
sleep 3
curl -fsS http://127.0.0.1:55123/api/health
curl -fsS http://127.0.0.1:55123/api/version
```

再起動後も、`/api/version`のruntime SHAが`TARGET_SHA`と一致し、healthが成功することをreadbackする。Lightsail全体の手順は [`deploy-lightsail-production.md`](../brainbase-capabilities/runbooks/deploy-lightsail-production.md) を正本とする。

## 失敗時とrollback

適用中の失敗はtransaction rollbackとなる。API/MCPの再起動や新SHAへの切替を行わず、現在のサービス状態を確認する。出力されたエラーを根拠に修正した別SHAを準備し、同じ手順を最初から実行する。前回Receiptで失敗を補完しない。

再起動後にruntimeまたはreadbackが失敗した場合は、まずAPI/MCPを停止する。DBのRLSは旧定義へ戻さず、失敗SHAに含まれる検証済みSQL bundleを再適用して安全な状態を前方維持する。その後、サービスコードだけを適用前に記録した`ROLLBACK_SHA`へ戻す。旧SHAに新しいrunbook、apply script、SQLが含まれることは要求しない。

```bash
sudo systemctl stop brainbase-ssot.service
cd /home/ubuntu/brainbase
test -z "$(git status --porcelain)"
FAILED_SHA="$(git rev-parse HEAD)"
grep -Eq '^[0-9a-f]{40}$' <<<"$FAILED_SHA"
INFO_SSOT_GIT_SHA="$FAILED_SHA" \
INFO_SSOT_ROLLBACK_SHA="$ROLLBACK_SHA" \
INFO_SSOT_OPERATION_MODE="rollback_prepare" \
INFO_SSOT_APPLY_RECEIPT_PATH="var/info-ssot-rollback-receipt.json" \
bash scripts/info-ssot-apply.sh
git switch --detach "$ROLLBACK_SHA"
sudo systemctl start brainbase-ssot.service
```

rollback後もreadback、negative smoke、`/api/health`、`/api/version`を取り直す。Receiptの`operation_mode=rollback_prepare`、`database_bundle_sha=FAILED_SHA`、`service_target_sha=ROLLBACK_SHA`、`rollback.database_strategy=forward_only_rls`、`rollback.service_strategy=switch_to_recorded_sha`を確認する。RLSは破壊的なdown migrationを行わず、冪等な前方適用とreadbackで既知の安全な状態を維持する。

## 証跡チェックリスト

- [ ] 適用対象SHAとrollback SHA
- [ ] safe DB identity（接続URLではない）
- [ ] PostgreSQL `server_version`（秘密値を含まない安全な値）
- [ ] in-transaction / post-commit readback marker
- [ ] negative smoke markerとfixture cleanup
- [ ] Receiptの保存先とSHA
- [ ] rollback後のreadback、health、runtime SHA
