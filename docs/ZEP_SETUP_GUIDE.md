# ZEP MCP統合 セットアップガイド

## 現状

ZEP MCP統合の実装は完了していますが、ZEP_API_KEYが設定されていないため、E2Eテストを実行できません。

## 必要な手順

### 1. ZEP API KEYの取得

1. [Zep Cloud](https://www.getzep.com/)にアクセス
2. アカウント作成/ログイン
3. API Keyを取得（形式: `z_xxxxx...`）

### 2. API KEYの設定

#### 方法A: Claude Desktop設定（推奨）

`~/Library/Application Support/Claude/claude_desktop_config.json`に追加:

```json
{
  "mcpServers": {
    "zep": {
      "command": "node",
      "args": ["/Users/ksato/workspace/tools/zep-mcp-server/build/index.js"],
      "env": {
        "ZEP_API_KEY": "z_xxxxx..."
      }
    },
    // 既存のMCPサーバー設定...
  }
}
```

#### 方法B: システム環境変数

`~/.zshrc`に追加:

```bash
export ZEP_API_KEY="z_xxxxx..."
```

その後:

```bash
source ~/.zshrc
```

#### 方法C: プロジェクト.envファイル

`/Users/ksato/workspace/.worktrees/session-1766800478873-workspace/brainbase-ui/.env`:

```bash
ZEP_API_KEY=z_xxxxx...
```

⚠️ **注意**: `.gitignore`に`.env`が含まれていることを確認してください。

### 3. E2Eテストの実行

```bash
cd /Users/ksato/workspace/.worktrees/session-1766800478873-workspace/brainbase-ui

# 方法A（Claude Desktop設定の場合）
# → Claude Codeを再起動すると自動的にZEP_API_KEYが利用可能に

# 方法B（システム環境変数の場合）
source ~/.zshrc
node test-zep-integration.js

# 方法C（.envファイルの場合）
export $(cat .env | xargs)
node test-zep-integration.js
```

### 4. 実際のセッション終了時の動作確認

E2Eテストが成功したら、実際のClaude Codeセッションで動作確認:

```bash
# Claude Codeでセッション開始
# → 何か作業を実施（例: タスク作成、コード編集）

# セッション終了
# → .claude/hooks/notify-stop.shが自動実行される
# → ZepServiceがjsonlファイルを解析してZEPに保存

# ZEPで確認
# → Claude Codeから mcp__zep__zep_get_memory を実行
# → 会話履歴とFactsが取得できることを確認
```

### 5. 動作確認チェックリスト

- [ ] ZEP_API_KEYが設定されている
- [ ] `node test-zep-integration.js`が成功する
- [ ] ZepMCPClient接続テストが成功
- [ ] ClaudeLogParserがjsonlファイルを正常に解析
- [ ] ZepServiceがセッション開始/終了を処理
- [ ] 実際のClaude Codeセッション終了時にZEPに保存される
- [ ] ZEPから会話履歴とFactsが取得できる

## 実装済みファイル

### サーバー側
- `server/services/zep-mcp-client.js` - ZEP MCP通信クライアント
- `server/services/zep-service.js` - セッション管理ビジネスロジック
- `server/utils/claude-log-parser.js` - jsonl解析ユーティリティ
- `server/controllers/session-controller.js` - HTTPエンドポイント
- `server/routes/sessions.js` - ルーティング

### フック
- `.claude/hooks/notify-stop.sh` - セッション終了時の自動実行フック

### テスト
- `test-zep-integration.js` - E2E統合テスト

## トラブルシューティング

### ZEP_API_KEY not found

```bash
# 環境変数が設定されているか確認
echo $ZEP_API_KEY

# Claude Desktop設定を確認
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | grep -A 5 "zep"
```

### ZEP MCP接続エラー

```bash
# ZEP MCPサーバーのビルド確認
cd /Users/ksato/workspace/tools/zep-mcp-server
npm run build

# 手動テスト
export ZEP_API_KEY="z_xxxxx..."
node build/index.js
```

### jsonlファイルが見つからない

```bash
# runtime_logsディレクトリを確認
ls -la ~/Library/Application\ Support/Claude/runtime_logs/*.jsonl

# 最新のjsonlファイルを確認
ls -lt ~/Library/Application\ Support/Claude/runtime_logs/*.jsonl | head -1
```

## 次のステップ

1. **ZEP_API_KEYを設定**
2. **E2Eテストを実行** (`node test-zep-integration.js`)
3. **実際のセッションで動作確認**
4. **Memory Check Protocol統合** (CLAUDE.mdの§0に従ってBrainbase MCP → ZEP MCP → _codex の3層確認フローを実装)

## 関連ドキュメント

- `/Users/ksato/workspace/tools/zep-mcp-server/README.md` - ZEP MCP詳細
- `CLAUDE.md` - brainbase開発標準（§0 Memory Check Protocol）
- `server/services/zep-service.js` - 実装詳細
