# MCP preflight fixtureの移植性

対象は `tests/integration/judgment-launcher-process.test.js` の候補preflight失敗ケースとする。

- テスト起動時に `BRAINBASE_RUNTIME_LOCK` をfixture内の専用ディレクトリへ設定する。
- production reconcilerの`/usr/bin/shlock`既定値は維持し、fixtureでは同じPID lock契約を持つstubを明示的に注入する。
- preflight失敗がcheckout更新より前に発生したこと、MCP checkoutがbase SHAのままであること、receiptが存在しないことを検証する。
- runtime lockは終了時のcleanupで解放され、fixture外へ副作用を残さない。

## 検証

対象integration testを単独実行し、続けてjudgment resolution test群をCIで確認する。
