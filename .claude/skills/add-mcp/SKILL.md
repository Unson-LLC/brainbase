# MCP Server 追加ガイド（一発成功版）

**Version**: 1.0.0
**Last Updated**: 2026-01-02
**Maintainer**: Unson LLC

---

## 概要

新しいMCPサーバーを**一発で確実に**追加するための完全ガイド。今回のnocodb MCP追加で学んだ失敗パターンと解決策を体系化。

---

## 🚨 重要な前提知識

### MCPの3スコープ構造

| スコープ | ファイル | 用途 | 追加コマンド | 推奨度 |
|---------|---------|------|-------------|--------|
| **user** | `~/.claude.json` | 全プロジェクトで共有 | `claude mcp add -s user ...` | ⭐⭐⭐ 推奨 |
| **local** | `~/.claude.json` (project-specific) | 特定プロジェクト固有 | `claude mcp add -s local ...` (デフォルト) | ⭐⭐ 場合による |
| **project** | `.mcp.json` | プロジェクト内で共有 | `claude mcp add -s project ...` | ⭐ レア |

**推奨**: 基本的に`-s user`（userスコープ）を使う。worktreeなど複雑なディレクトリ構造でも確実に認識される。

---

## ✅ 一発成功の手順

### Step 1: 環境変数を`.env`に準備

```bash
# /Users/ksato/workspace/.env
NOCODB_URL=https://noco.unson.jp
NOCODB_TOKEN=your_token_here
```

### Step 2: `claude mcp add`コマンドで追加

**テンプレート**:
```bash
claude mcp add -s user --transport stdio <name> \
  --env KEY1=value1 \
  --env KEY2=value2 \
  -- <command> [args...]
```

**実例（nocodb）**:
```bash
claude mcp add -s user --transport stdio nocodb \
  --env NOCODB_URL=https://noco.unson.jp \
  --env NOCODB_TOKEN=hWlU_pB7o4WZMNiIPwPaJKBVNiQ5K83dE4s4wvL3 \
  -- npx tsx /Users/ksato/workspace/tools/nocodb-mcp/src/index.ts
```

**重要**:
- 環境変数は**直接値を指定**（`${NOCODB_URL}`ではない）
- `--`の後にコマンドとその引数を指定
- `-s user`を忘れずに

### Step 3: 確認

```bash
# MCPサーバーがリストに表示されるか確認
claude mcp list | grep <name>

# 詳細確認
claude mcp get <name>

# Claude Code UIで確認
# Claude Code内で: /mcp コマンドを実行
```

### Step 4: Claude Codeを再起動

```bash
# Ctrl+C で停止
claude --dangerously-skip-permissions
```

---

## ❌ よくある失敗パターン

### 1. settings.jsonを直接編集してしまう

**❌ 間違い**:
```json
// .claude/settings.json を直接編集
{
  "mcpServers": {
    "nocodb": { ... }
  }
}
```

**✅ 正しい方法**: `claude mcp add`コマンドを使う

### 2. 環境変数を`${VAR}`形式で指定

**❌ 間違い**:
```bash
--env NOCODB_URL='${NOCODB_URL}'
```

**✅ 正しい方法**:
```bash
--env NOCODB_URL=https://noco.unson.jp
```

### 3. stdoutにログを出力するコードを含めてしまう

**問題**: MCPプロトコルはstdoutをJSON-RPC専用にする必要がある

**❌ 間違い**:
```typescript
import { config } from "dotenv";
config({ path: "/path/to/.env" }); // dotenv 17.x はstdoutにログ出力
```

**✅ 正しい方法**:
- dotenvを使わず、環境変数を`claude mcp add`の`--env`で渡す
- またはdotenvのログを抑制する

### 4. ビルド成果物のパスを間違える

**❌ 間違い**:
```bash
-- node /path/to/build/index.js  # ビルド成果物が古い可能性
```

**✅ 正しい方法**:
```bash
-- npx tsx /path/to/src/index.ts  # TypeScriptソースを直接実行
```

### 5. スコープを指定しない（デフォルト`local`）

**問題**: worktree環境で認識されないことがある

**❌ 間違い**:
```bash
claude mcp add --transport stdio nocodb ...  # デフォルトはlocal
```

**✅ 正しい方法**:
```bash
claude mcp add -s user --transport stdio nocodb ...
```

---

## 🔧 トラブルシューティング

### MCPリストに表示されない

**確認手順**:

1. `claude mcp list`で接続状態を確認
   ```bash
   claude mcp list | grep <name>
   ```
   - `✓ Connected` → OK
   - 表示されない → 追加されていない

2. Claude Code UIで`/mcp`コマンドを実行
   - リストに表示される → OK
   - 表示されない → Claude Code再起動が必要

3. スコープを確認
   ```bash
   claude mcp get <name>
   # Scope: User config → 全プロジェクトで利用可能
   # Scope: Local config → プロジェクト固有
   ```

4. worktreeからの起動の場合
   - userスコープで追加されているか確認
   - localスコープだとworktreeで認識されない可能性

### MCPサーバーが起動しない

**確認手順**:

1. 手動でコマンドを実行してエラーを確認
   ```bash
   NOCODB_URL=... NOCODB_TOKEN=... npx tsx /path/to/index.ts
   ```

2. stdoutに余計なログが出ていないか確認
   ```bash
   # stderrを抑制してstdoutのみを確認
   NOCODB_URL=... NOCODB_TOKEN=... npx tsx /path/to/index.ts 2>/dev/null
   ```
   - 何も出力されない → OK（MCPサーバーはstdinを待っている）
   - ログが出力される → NG（stdoutを汚染している）

3. initializeメッセージに応答できるか確認
   ```bash
   echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | \
     NOCODB_URL=... NOCODB_TOKEN=... npx tsx /path/to/index.ts 2>&1
   ```
   - JSON-RPCレスポンスが返る → OK
   - エラーが出る → MCPサーバーの実装に問題

---

## 📝 チェックリスト

新しいMCPサーバーを追加する際、以下を確認：

- [ ] `.env`ファイルに環境変数を準備済み
- [ ] MCPサーバーのTypeScriptソースが存在
- [ ] MCPサーバーがstdoutにログを出力していない
- [ ] `claude mcp add -s user`コマンドで追加
- [ ] `--env`で環境変数を直接値で指定
- [ ] `-- npx tsx /path/to/src/index.ts`で起動
- [ ] `claude mcp list`で`✓ Connected`を確認
- [ ] Claude Codeを再起動
- [ ] `/mcp`コマンドでツールが表示されることを確認

---

## 🎯 推奨ワークフロー

```bash
# 1. MCPサーバーのディレクトリを作成
mkdir -p /Users/ksato/workspace/tools/<mcp-name>
cd /Users/ksato/workspace/tools/<mcp-name>

# 2. package.jsonとTypeScriptファイルを作成
npm init -y
mkdir src
# src/index.ts を実装

# 3. 環境変数を.envに追加
echo "MY_API_KEY=xxx" >> /Users/ksato/workspace/.env

# 4. MCPサーバーを追加
claude mcp add -s user --transport stdio <mcp-name> \
  --env MY_API_KEY=xxx \
  -- npx tsx /Users/ksato/workspace/tools/<mcp-name>/src/index.ts

# 5. 確認
claude mcp list | grep <mcp-name>

# 6. Claude Code再起動
# Ctrl+C → claude --dangerously-skip-permissions

# 7. UIで確認
# /mcp コマンドを実行
```

---

## 参考リンク

- Claude Code MCP Documentation: (内部ドキュメント参照)
- MCP Protocol Specification: https://modelcontextprotocol.io/

---

**最終更新**: 2026-01-02
**作成者**: Unson LLC
