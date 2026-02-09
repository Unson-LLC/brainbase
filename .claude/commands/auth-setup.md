# brainbase認証セットアップ

brainbaseへの認証を完了し、config.ymlを自動生成するコマンド。

---

## 概要

このコマンドは以下を自動実行します：

1. **Device Code Flow で認証**
   - ブラウザでSlack認証を実行
   - OAuth 2.0 PKCE (RFC 7636) を使用

2. **トークン保存**
   - `~/.brainbase/tokens.json` に保存
   - MCP Server が自動的に使用

3. **config.yml 自動生成・配置**
   - `/api/setup/config` を呼び出し
   - `~/workspace/config.yml` に自動保存
   - アクセス可能なプロジェクト一覧を表示

---

## 実行方法

### コマンド

```bash
npm run auth-setup
```

または Claude Code から：

```
/auth-setup
```

---

## 実行フロー

### Step 1: Device Code 取得

```
🔐 Brainbase MCP Setup - OAuth 2.0 Device Code Flow

📡 Requesting device code from http://localhost:31013...
✅ Device code received

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. 以下のURLをブラウザで開いてください:
     https://graph.brain-base.work/device?user_code=WXYZ-1234

  2. または、手動でコードを入力してください:
     コード: WXYZ-1234
     URL:    https://graph.brain-base.work/device

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 2: ブラウザで認証

1. 表示されたURLをブラウザで開く
2. Slack認証を完了
3. 成功メッセージを確認

### Step 3: トークン保存 + config.yml 生成

```
✅ 認証完了
✅ Tokens saved to ~/.brainbase/tokens.json

📥 config.yml を自動生成中...
✅ config.yml を保存しました: /Users/ksato/workspace/config.yml

📊 アクセス可能なプロジェクト: 5件
  - brainbase (prj_brainbase)
  - mana (prj_mana)
  - salestailor (prj_salestailor)
  ...

✅ Setup complete!
   Your MCP server will now automatically use these tokens.
   Restart Claude Code to apply changes.
```

---

## トラブルシューティング

### エラー: config.yml の生成に失敗

```
❌ config.yml の生成に失敗しました: Failed to fetch
   Web UI から手動でダウンロードできます: http://localhost:31013/setup
```

**原因**:
- brainbase サーバーが起動していない
- ネットワーク接続の問題
- 認証トークンが無効

**対処**:
1. brainbase サーバーの起動確認
   ```bash
   curl http://localhost:31013/api/health
   ```

2. Web UI から手動でダウンロード
   ```
   http://localhost:31013/setup
   ```

### エラー: Device code expired

```
❌ Error: Device code expired (timeout: 10 minutes)
```

**対処**: コマンドを再実行して10分以内に認証を完了してください。

### エラー: User denied the authorization request

```
❌ Error: User denied the authorization request
```

**対処**: 認証画面で「許可」をクリックしてください。

---

## 既存のトークンがある場合

既に `~/.brainbase/tokens.json` が存在する場合、3秒間の猶予期間が表示されます：

```
⚠️  Tokens already exist at ~/.brainbase/tokens.json
   This will overwrite existing tokens.
   Press Ctrl+C to cancel, or wait 3 seconds to continue...
```

キャンセルする場合は `Ctrl+C` を押してください。

---

## 参考

- **認証フロー**: OAuth 2.0 Device Code Flow (RFC 8628)
- **PKCE**: Proof Key for Code Exchange (RFC 7636)
- **トークン保存先**: `~/.brainbase/tokens.json`
- **config.yml 保存先**: `~/workspace/config.yml`
- **Web UI**: `http://localhost:31013/setup`

---

最終更新: 2026-02-09
作成者: Unson LLC
