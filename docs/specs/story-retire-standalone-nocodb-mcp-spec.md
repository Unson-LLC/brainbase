# Spec: Standalone NocoDB MCPの退役

## 対象

- `.mcp.json`
- `scripts/run-nocodb-mcp.sh`
- `mcp/nocodb/src/index.ts`
- `config/com.brainbase.mcp-nocodb.plist`
- `mcp/nocodb/tests/standalone-retirement.test.js`

`mcp/nocodb/src/nocodb-client.ts`、
`mcp/nocodb/src/canonical-task-write-guard.ts`、その証拠テストと
`config/infisical-targets.json`は移行・境界証拠として対象外にして保持する。

## 不変条件

1. `.mcp.json`は独立NocoDB HTTPサーバーを登録しない。
2. 退役ランチャーは最初の外部コマンド、ファイル読取り、認証値参照、環境値参照より前に
   終了コード78を返す。
3. 退役エントリはMCP SDKをimportせず、NocoDB URL/tokenを参照せず、HTTP transportを作らない。
4. canonical taskの直接mutation拒否と、非canonical移行経路の既存契約は変更しない。
5. データ、移行用RESTスクリプト、Infisicalの設定・secretは削除しない。

## 検証

- `npm --prefix mcp/nocodb test`
- `npm run test:run -- tests/unit/runtime-worktree-launchd.test.js`
- `git diff --check`

テストはInfisical/npxの実行マーカーと、接続不能なlocalhost URLをfixtureに渡し、
退役境界が実際に外部作用前で終了することを確認する。
