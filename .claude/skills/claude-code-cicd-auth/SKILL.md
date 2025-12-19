---
name: claude-code-cicd-auth
description: Claude CodeをCI/CD・自動化環境で使うための認証設定ガイド。Maxプランのsetup-tokenで1年有効トークンを生成し、GitHub Actionsで活用する方法
---

## Triggers

以下の状況で使用：
- Claude CodeをGitHub Actionsで動かしたいとき
- セルフホストランナーでClaude Codeを自動実行したいとき
- Maxプランで従量課金なしにCI/CDを構築したいとき

# Claude Code CI/CD認証

## 認証方式の比較

| 方式 | 有効期限 | コスト | 用途 |
|------|---------|--------|------|
| `/login`（通常OAuth） | 約2-3時間 | Maxプラン内 | 対話的開発 |
| `setup-token` | 1年 | Maxプラン内 | CI/CD・自動化 |
| `ANTHROPIC_API_KEY` | 無期限 | 従量課金 | 大量処理・チーム利用 |

## setup-token（推奨）

### 生成方法

```bash
# ターミナルで対話的に実行（1回のみ）
claude setup-token
```

出力例：
```
✓ Long-lived authentication token created successfully!

Your OAuth token (valid for 1 year):
sk-ant-oat01-xxxxx...

Store this token securely. You won't be able to see it again.
Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>
```

### 特徴

- **1年間有効** - 年1回の再生成で運用可能
- **Maxプラン範囲内** - 追加の従量課金なし
- **単一ユーザー向け** - 個人プロジェクト・少人数チーム向け

## GitHub Actionsでの設定

### Step 1: Secretsに追加

```
Settings → Secrets and variables → Actions → New repository secret

Name: CLAUDE_CODE_OAUTH_TOKEN
Value: sk-ant-oat01-xxxxx...（setup-tokenで生成した値）
```

### Step 2: ワークフロー設定

```yaml
# .github/workflows/example.yml
name: Claude Code Job
on:
  workflow_dispatch:

jobs:
  run-claude:
    runs-on: [self-hosted, local]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Claude Code environment
        run: |
          mkdir -p ~/.claude
          echo '{"hasCompletedOnboarding": true}' > ~/.claude.json

      - name: Build prompt
        run: |
          cat > /tmp/prompt.txt << 'EOF'
          あなたのタスク内容をここに記述
          複数行のプロンプトも可能
          EOF

      - name: Run Claude Code
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        run: |
          cat /tmp/prompt.txt | claude --print > /tmp/result.txt 2>&1
          cat /tmp/result.txt
```

### 稼働例

以下のワークフローで実績あり：
- `.github/workflows/task-triage.yml` - 週次タスク棚卸し
- `.github/workflows/mana-self-improve.yml` - mana応答品質の自動改善

### Step 3: Onboarding設定（初回のみ）

コンテナ/新環境では `~/.claude.json` が必要：

```bash
mkdir -p ~/.claude
echo '{"hasCompletedOnboarding": true}' > ~/.claude.json
```

## セルフホストランナーでの利用

### 環境変数設定

```bash
# .bashrc または .zshrc
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-xxxxx..."
```

### headlessモードでの実行

```bash
# シンプルなプロンプト（特殊文字なし）
claude -p "プロンプト" --print

# 複雑なプロンプト（推奨：stdin経由）
cat prompt.txt | claude --print

# ツールを制限して実行
claude -p "コードレビューして" --allowedTools "Read,Glob,Grep" --print
```

**重要**: シェル特殊文字（`$`, `\``, `"`, 改行等）を含むプロンプトは `claude -p "$PROMPT"` で失敗します。
必ず **stdinパイプ** (`cat prompt.txt | claude --print`) を使用してください。

## トークン管理

### 有効期限の確認

Keychainに保存されたトークン情報を確認：

```bash
# macOS
security find-generic-password -s "Claude Code-credentials" -w | \
  python3 -c "import sys,json,datetime; \
  d=json.loads(sys.stdin.read()); \
  exp=datetime.datetime.fromtimestamp(d['claudeAiOauth']['expiresAt']/1000); \
  print(f'有効期限: {exp}')"
```

### 更新タイミング

- **setup-token**で生成したトークン → 1年後に再生成
- **通常OAuth**（/login） → 2-3時間で期限切れ（自動更新あり）

### トークン失効時

```bash
# 新しいトークンを生成
claude setup-token

# GitHub Secretsを更新
# Settings → Secrets → CLAUDE_CODE_OAUTH_TOKEN を編集
```

## 注意事項

### 制限

- **単一ユーザー向け** - Maxプランは個人利用想定
- **複数人チーム** - APIキー（従量課金）を推奨
- **大量処理** - レート制限あり、APIキー推奨

### セキュリティ

- トークンは**一度しか表示されない** - 安全に保管
- GitHub Secretsで管理 - 平文でコミットしない
- 漏洩時は即座に再生成

### トラブルシューティング

| 問題 | 原因 | 対策 |
|------|------|------|
| `OAuth token has expired` | 通常OAuthの期限切れ | `setup-token`で長期トークン生成 |
| onboarding画面が出る | `~/.claude.json`がない | `hasCompletedOnboarding: true`を設定 |
| `authentication_error` | トークン無効 | `setup-token`で再生成 |

## 実績

- **検証日**: 2025-12-15
- **Claude Code Version**: 2.0.65
- **確認済み**: `setup-token`で「valid for 1 year」のメッセージ出力を確認
- **稼働実績**: task-triage.yml, mana-self-improve.yml で動作確認済み

## 参考

- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless)
- [GitHub Issue #12447 - OAuth token expiration](https://github.com/anthropics/claude-code/issues/12447)
- [GitHub Issue #1454 - M2M Authentication Request](https://github.com/anthropics/claude-code/issues/1454)

---
最終更新: 2025-12-19
