# brainbase認証セットアップ

brainbaseへの認証を完了し、bundled Brainbase MCPを登録するコマンド。

---

## 概要

このコマンドは以下を自動実行します：

1. **Device Code Flow で認証**
   - ブラウザでSlack認証を実行
   - OAuth 2.0 PKCE (RFC 7636) を使用

2. **トークン保存**
   - `~/.brainbase/tokens.json` に保存
   - MCP Server が自動的に使用

3. **bundled Brainbase MCP登録**
   - `claude mcp add -s user` で `brainbase` を再登録
   - Graph API固定 (`BRAINBASE_ENTITY_SOURCE=graphapi`)
   - 接続先は `https://graph.brain-base.work`（`BRAINBASE_API_URL` で上書き可能）

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

📡 Requesting device code from https://graph.brain-base.work...
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

### Step 3: トークン保存 + MCP登録

```
✅ 認証完了
✅ Tokens saved to ~/.brainbase/tokens.json
✅ brainbase MCP registered (scope: user)

✅ Setup complete!
   Your MCP server will now automatically use these tokens.
   Restart Claude Code to apply changes.
```

---

## トラブルシューティング

### エラー: MCP登録に失敗

```
❌ MCP registration skipped: Failed to register brainbase MCP.
   Run this manually after setup:
   npm run mcp:add:brainbase
```

**原因**:
- `claude` CLIがPATHに無い
- MCP設定が壊れている
- npm依存が未インストール（`gray-matter`不足）

**対処**:
1. 依存関係をインストール
   ```bash
   npm install
   ```

2. MCPを手動再登録
   ```bash
   npm run mcp:add:brainbase
   npm run mcp:get:brainbase
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
- **MCP再登録**: `npm run mcp:add:brainbase`

---

最終更新: 2026-02-09
作成者: Unson LLC
