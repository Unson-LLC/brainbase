# MCP Server追加コマンド

新しいMCPサーバーを**一発で確実に**追加するコマンド。

---

## 前提条件

1. MCPサーバーのTypeScriptソースが存在すること
2. 環境変数を`.env`ファイルに準備済みであること
3. MCPサーバーがstdoutにログを出力していないこと（stderrのみ使用）

---

## 実行手順

### Step 1: 環境変数の確認

ユーザーに確認してください：

```
以下の情報を教えてください：

1. MCPサーバー名: (例: nocodb, gmail, jibble)
2. 環境変数のキーと値: (例: NOCODB_URL=https://noco.unson.jp)
3. 起動コマンドパス: (例: /Users/ksato/workspace/tools/nocodb-mcp/src/index.ts)
```

### Step 2: `claude mcp add`コマンドで追加

**テンプレート**:
```bash
claude mcp add -s user --transport stdio <name> \
  --env KEY1=value1 \
  --env KEY2=value2 \
  -- npx tsx <path/to/src/index.ts>
```

**重要なポイント**:
- `-s user`: userスコープで追加（全プロジェクトで利用可能、worktree環境でも確実に認識）
- `--env`: 環境変数を**直接値で指定**（`${VAR}`形式は使わない）
- `--`: この後にコマンドとその引数を指定
- `npx tsx`: TypeScriptソースを直接実行（`node build/index.js`ではなく）

**実例（nocodb）**:
```bash
claude mcp add -s user --transport stdio nocodb \
  --env NOCODB_URL=https://noco.unson.jp \
  --env NOCODB_TOKEN=hWlU_pB7o4WZMNiIPwPaJKBVNiQ5K83dE4s4wvL3 \
  -- npx tsx /Users/ksato/workspace/tools/nocodb-mcp/src/index.ts
```

### Step 3: 確認

```bash
# MCPサーバーがリストに表示されるか確認
claude mcp list | grep <name>

# 詳細確認
claude mcp get <name>
```

**期待される出力**:
```
<name>: npx tsx /path/to/src/index.ts - ✓ Connected
```

### Step 4: Claude Codeを再起動

```
Ctrl+C で停止 → claude --dangerously-skip-permissions
```

または `/mcp` コマンドでリストを確認。

---

## トラブルシューティング

### MCPリストに表示されない場合

#### 1. スコープを確認
```bash
claude mcp get <name>
# Scope: User config → 全プロジェクトで利用可能
# Scope: Local config → プロジェクト固有（worktreeで認識されない可能性）
```

**対処**: `-s user`で追加し直す

#### 2. MCPサーバーが起動しない場合

**手動でコマンドを実行してエラーを確認**:
```bash
KEY1=value1 KEY2=value2 npx tsx /path/to/index.ts
```

**stdoutに余計なログが出ていないか確認**:
```bash
# stderrを抑制してstdoutのみを確認
KEY1=value1 KEY2=value2 npx tsx /path/to/index.ts 2>/dev/null
```

- 何も出力されない → OK（MCPサーバーはstdinを待っている）
- ログが出力される → NG（stdoutを汚染している）
  - 対処: dotenv等のログ出力を削除、またはstderrへリダイレクト

**initializeメッセージに応答できるか確認**:
```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | \
  KEY1=value1 KEY2=value2 npx tsx /path/to/index.ts 2>&1
```

- JSON-RPCレスポンスが返る → OK
- エラーが出る → MCPサーバーの実装に問題

#### 3. よくある失敗パターン

**❌ 間違い: settings.jsonを直接編集**
```json
// .claude/settings.json を直接編集（これは使われない）
{
  "mcpServers": {
    "nocodb": { ... }
  }
}
```

**✅ 正しい方法**: `claude mcp add`コマンドを使う

**❌ 間違い: 環境変数を`${VAR}`形式で指定**
```bash
--env NOCODB_URL='${NOCODB_URL}'
```

**✅ 正しい方法**: 直接値を指定
```bash
--env NOCODB_URL=https://noco.unson.jp
```

**❌ 間違い: dotenvがstdoutにログ出力**
```typescript
import { config } from "dotenv";
config({ path: "/path/to/.env" }); // dotenv 17.x はstdoutにログ出力
```

**✅ 正しい方法**: dotenvを使わず、`--env`で環境変数を渡す

---

## チェックリスト

- [ ] `.env`ファイルに環境変数を準備済み
- [ ] MCPサーバーのTypeScriptソースが存在
- [ ] MCPサーバーがstdoutにログを出力していない
- [ ] `claude mcp add -s user`コマンドで追加
- [ ] `--env`で環境変数を直接値で指定
- [ ] `-- npx tsx /path/to/src/index.ts`で起動
- [ ] `claude mcp list`で`✓ Connected`を確認
- [ ] Claude Codeを再起動（または`/mcp`コマンドで確認）

---

## 参考

詳細な解説は `skill: add-mcp` を参照してください。

---

最終更新: 2026-01-02
作成者: Unson LLC
