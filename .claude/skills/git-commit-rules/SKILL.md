---
name: git-commit-rules
description: brainbaseにおけるGitコミットのルールとフォーマット。コミットメッセージの書き方、type一覧、自動提案タイミングを定義。コミット作成時に使用。
---

# Git コミットルール

brainbaseにおけるGitコミットの標準ルールです。

## Instructions

### 1. コミットメッセージフォーマット

```
<type>: <summary>（日本語可、50文字以内）

<why>
- なぜこの変更をしたのか（会話の文脈から）
- 何を達成しようとしていたのか

<what>（変更が多い場合のみ）
- 主な変更点1
- 主な変更点2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 2. type一覧

| type | 用途 |
|------|------|
| `feat` | 新機能・新規追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | リファクタリング（機能変更なし） |
| `chore` | ビルド・設定・運用系の変更 |
| `style` | フォーマット変更（機能に影響なし） |

### 3. コミット頻度

- **小さく・こまめに**（1つの論理的変更 = 1コミット）
- 大きな変更は分割してコミット
- タスクに紐づく場合はタスクIDを含める（推奨、例: `[TECHKNIGHT-HP-SALES]`）

### 4. 自動提案タイミング

Claudeは以下の条件で `/commit` の実行を提案する：
- 論理的なまとまりの変更が完了した時
- ユーザーが「できた」「完了」「OK」など完了を示唆した時
- 複数ファイルの関連変更が一段落した時

### 5. コミット実行コマンド

HEREDOCを使用してフォーマットを保持：

```bash
git commit -m "$(cat <<'EOF'
<type>: <summary>

なぜ:
- 理由1
- 理由2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 6. 禁止事項

- `git commit --amend` は原則禁止（pre-commit hook修正後のみ許可）
- `--no-verify`, `--no-gpg-sign` はユーザー明示要求時のみ
- mainへの直接push禁止（セッション内作業時）
- 秘密情報（.env, credentials.json等）のコミット禁止

## Examples

### 例1: 機能追加

```
feat: ユーザー認証機能を追加

なぜ:
- セキュリティ要件への対応
- マルチテナント対応の準備

変更:
- auth/middleware.ts 追加
- pages/login.tsx 追加

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 例2: ドキュメント更新

```
docs: プロジェクトファイルをproject.mdに統合

なぜ:
- MCP Serverでコンテキスト自動ロードするため
- 01-05の分散管理より1ファイルの方が扱いやすい

変更:
- 13プロジェクトのproject.md作成
- architecture_map.mdに新構造を反映

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 例3: バグ修正

```
fix: ログイン時のセッション切れを修正

なぜ:
- ユーザーから「5分でログアウトされる」との報告
- トークン更新ロジックの不具合

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

このルールに従うことで、一貫したコミット履歴を維持できます。
