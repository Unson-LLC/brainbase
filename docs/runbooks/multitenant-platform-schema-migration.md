# マルチテナント基盤スキーマ移行

## 目的

`server/sql/multitenant-platform-schema.sql`をBrainbaseのPostgreSQL正本へ安全に適用し、同じGit HEADのスキーマhash、テーブル、列、RLS、policyを読戻す。

この手順はスキーマの適用手順である。既存データのtenant帰属、隔離、rollbackは`PostgresTenantMigrationAdapter`のMigrationPlan単位で別途実行する。

## 安全境界

- 接続先は`INFO_SSOT_DATABASE_URL`または`INFO_SSOT_DB_URL`だけから取得する。汎用`DATABASE_URL`へfallbackしない。
- 接続文字列、token、passwordを引数、標準出力、移行結果へ含めない。
- `--check`はcatalogと移行台帳のreadbackだけを行い、DDLを書かない。
- `--dry-run`はadvisory lockを取得し、同じDDLとreadbackを1 transaction内で実行後、必ずrollbackする。
- `--apply`は`--approve-apply`と`BRAINBASE_MIGRATION_ACTOR`の両方がなければ開始しない。
- applyはadvisory lock、DDL、schema hash台帳、readbackを同一transactionで実行する。readback不一致時はcommitしない。
- SQLは`IF NOT EXISTS`とpolicy再作成で再実行可能にする。既存列の削除や既存データの書換えは行わない。

## 本番適用前

1. 適用対象のGit SHAとdeploymentを記録する。
2. secret管理基盤から対象環境へ`INFO_SSOT_DATABASE_URL`を注入する。値をシェル履歴や監査票へ転記しない。
3. operatorを識別できる非秘密値を`BRAINBASE_MIGRATION_ACTOR`へ設定する。
4. 同じHEADで対象テストを実行する。

```bash
npm run test:run -- tests/server/scripts/multitenant-platform-schema-migration.test.js tests/server/services/multitenant/schema-migration-runner.integration.test.js
```

## 実行順序

既存環境でまだこのrunnerを使っていない場合、最初の`--check`は台帳不在として失敗する。その失敗を「0件」や「適用済み」へ読み替えない。

```bash
npm run migrate:multitenant-platform-schema -- --dry-run
npm run migrate:multitenant-platform-schema -- --apply --approve-apply
npm run migrate:multitenant-platform-schema -- --check
```

成功時は各コマンドが秘密値を含まないJSONを1行出力する。移行票には最低限、次を保存する。

- Git SHA
- deployment ID／対象環境名
- `migration_id`
- `schema_sha256`
- `mode`
- `persisted`
- `table_count`
- `column_count`
- `rls_table_count`
- `policy_table_count`
- `ledger_matches`
- 実行時刻とoperator

`--apply`の成功だけでは移行完了にしない。直後の`--check`が同じ`schema_sha256`を返し、runtimeのtenant境界テストと本番readbackが成功して初めて当該スキーマを利用可能と判定する。

## 失敗時

- `SCHEMA_READBACK_FAILED`: 不足table、column、RLS、policyを修復するまでruntimeを有効化しない。
- `SCHEMA_VERSION_MISMATCH`: repoのSQLと適用台帳が一致していない。別HEADの結果を流用しない。
- `UPSTREAM_UNAVAILABLE`: PostgreSQL側ログを確認する。runnerはdriverエラーや接続秘密値を標準エラーへ展開しない。
- apply transaction中の失敗: runnerがrollbackする。再度`--dry-run`から行う。
- commit後の不整合: destructive rollbackを即時実行しない。runtimeを無効化し、修正版の前方移行を別Git SHAで準備する。既存データのrollbackはMigrationPlanのmigration ID単位で行う。

本番へのapply、runtime有効化、データ移行はそれぞれ独立した操作と証跡として扱う。
