---
name: git-commit-rules
description: コミットメッセージのフォーマット定義（jj対応）。type一覧、メッセージ構造、実行コマンドの正本。コミット粒度・回帰防止は `.claude/rules/commit-strategy.md` を参照。
---

## Triggers

以下の状況で使用：
- コミット説明を設定するとき
- コミットメッセージのフォーマットを確認したいとき
- /commitコマンドを実行するとき

# コミットメッセージフォーマット（jj対応）

このSkillは**フォーマット定義の正本**。コミット粒度・回帰防止ルールは `.claude/rules/commit-strategy.md` に定義。

## Instructions

### 1. jjでのコミットフロー

jjではworking copyが常にコミット。`git add` + `git commit` は不要。

```bash
# 1. 変更内容を確認
jj diff --stat

# 2. コミット説明を設定
jj describe -m "<message>"

# 3. 次の変更に進む
jj new
```

### 2. コミットメッセージフォーマット

```
<type>: <summary>（日本語可、50文字以内）

<why>
- なぜこの変更をしたのか（会話の文脈から）
- 何を達成しようとしていたのか

<what>（変更が多い場合のみ）
- 主な変更点1
- 主な変更点2

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 3. type一覧

| type | 用途 |
|------|------|
| `feat` | 新機能・新規追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | リファクタリング（機能変更なし） |
| `chore` | ビルド・設定・運用系の変更 |
| `style` | フォーマット変更（機能に影響なし） |

### 4. コミット粒度

> **詳細は `.claude/rules/commit-strategy.md` を参照**

基本: 1つの意図 = 1コミット。分割は `jj split` で。

### 5. コミット実行コマンド

```bash
jj describe -m "$(cat <<'EOF'
<type>: <summary>

なぜ:
- 理由1
- 理由2

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

jj new
```

### 6. jj特有の操作

| 操作 | コマンド | 説明 |
|------|---------|------|
| 説明を書き直す | `jj describe -m "..."` | 何度でも変更可能 |
| 過去のコミットを修正 | `jj edit <change-id>` | 子孫は自動rebase |
| コミットを分割 | `jj split` | 大きな変更を分ける |
| bookmark設定 | `jj bookmark set <name> -r @-` | 手動で設定が必要 |

### 7. 禁止事項

- 秘密情報（.env, credentials.json等）を含む変更を放置しない
- mainへの直接変更は原則禁止（セッション内作業時）

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

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 例2: バグ修正

```
fix: ログイン時のセッション切れを修正

なぜ:
- ユーザーから「5分でログアウトされる」との報告
- トークン更新ロジックの不具合

Co-Authored-By: Claude <noreply@anthropic.com>
```
