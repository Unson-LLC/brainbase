# Standalone NocoDB MCPの退役

Status: implemented_locally

## Outcome

運用者として、使われていない独立NocoDB MCPの登録と起動経路を退役させ、
古い設定がInfisicalの認証情報を読み込んだり外部通信したりしない状態にしたい。
一方で、移行用のNocoDBクライアント、canonical taskの書込みガード、証拠テスト、
既存データと設定は保持する。

## Acceptance boundary

- `.mcp.json`に独立`nocodb`サーバー登録がない。
- 旧ランチャーと`mcp/nocodb/src/index.ts`は、Infisical・環境値・MCP SDKを読み込む前に
  退役コード（78）で終了する。
- `CanonicalTaskWriteGuard`とその契約テストは残り、canonical taskへの直接書込み拒否を
  継続して検証できる。
- NocoDBデータ、移行スクリプト、`config/infisical-targets.json`の設定は削除しない。

## Verification

`mcp/nocodb/tests/standalone-retirement.test.js`で登録、launchdテンプレート、
ランチャーのInfisical/npx未実行、退役エントリの環境値未読取りをfixtureで確認する。
既存の`canonical-task-write-guard.test.js`はcanonical taskの書込み境界を確認する。
