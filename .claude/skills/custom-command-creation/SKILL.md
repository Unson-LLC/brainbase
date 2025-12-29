---
name: custom-command-creation
description: Claude Codeカスタムコマンド作成の完全ガイド。配置場所の決定、必須手順、トラブルシューティング、テンプレート提供。カスタムコマンドを作成する際に使用。
---

# カスタムコマンド作成ガイド

Claude Codeのカスタムコマンド（Slash Commands）を**一発で作成**するための完全ガイド。

**Version**: 1.0.0
**Last Updated**: 2025-12-29
**Scope**: user（個人用）

---

## Triggers

以下の状況で使用：
- 新しいカスタムコマンドを作成する際
- カスタムコマンドが認識されない問題を解決する際
- コマンドファイルのフォーマットを確認したい際
- カスタムコマンドのベストプラクティスを参照したい際

---

## 1. 基本原則

### 1.1 配置場所の決定ロジック

**最重要**: Claude Codeは**現在の作業ディレクトリのリポジトリ**の`.claude/commands/`を参照する

```bash
# 現在の作業ディレクトリを確認
pwd
# 例: /Users/ksato/brainbase

# → コマンドファイルは以下に配置
# /Users/ksato/brainbase/.claude/commands/
```

**配置場所の優先順位**:
1. **プロジェクトコマンド**: `{現在のリポジトリ}/.claude/commands/` ← **必ずここに配置**
2. グローバルコマンド: `~/.claude/commands/` （プロジェクト横断で使いたい場合のみ）

### 1.2 必須手順（5ステップ）

```bash
# Step 1: ディレクトリ作成（存在しない場合）
mkdir -p .claude/commands

# Step 2: コマンドファイル作成
# ファイル名 = コマンド名（例: create-pr.md → /create-pr）
touch .claude/commands/{command-name}.md

# Step 3: パーミッション設定（644必須）
chmod 644 .claude/commands/{command-name}.md

# Step 4: git管理下に追加（必須）
git add .claude/commands/{command-name}.md

# Step 5: コミット
git commit -m "feat: add /{command-name} custom command"

# Step 6: Claude Code再起動
# ターミナルを再起動してClaude Codeを再度起動
```

**Why git管理が必須**:
- Claude Codeは**git管理下のファイルのみ**をカスタムコマンドとして認識する可能性が高い
- untrackedファイルは認識されない

---

## 2. コマンドファイルの構造

### 2.1 基本フォーマット

```markdown
# コマンドタイトル

コマンドの説明（1-2文）

**用途**:
- 用途1
- 用途2

---

## 0. 前提チェック

実行前に以下を確認してください:
- 前提条件1
- 前提条件2

---

## 1. ステップ1のタイトル

```bash
# bash コマンド例
echo "Hello"
```

---

## 2. ステップ2のタイトル

説明文...

```bash
# bash コマンド例
```

---

## 3. 完了確認

最終確認手順...
```

### 2.2 フォーマット規則

**必須要素**:
- ✅ H1ヘッダー（`# タイトル`）で始まる
- ✅ 説明セクション
- ✅ 番号付きセクション（`## 1.`, `## 2.`...）
- ✅ bashコードブロック（`` ```bash ... ``` ``）

**パーミッション**:
- ✅ `644` (`-rw-r--r--`)

**エンコーディング**:
- ✅ UTF-8（BOMなし）

---

## 3. 命名規則

### 3.1 コマンド名の決定

**ファイル名 → コマンド名**:
- `create-pr.md` → `/create-pr`
- `merge.md` → `/merge`
- `commit.md` → `/commit`

**命名のベストプラクティス**:
- ✅ **動詞で始める**：`create-pr`, `merge`, `commit`
- ✅ **kebab-case**：`create-pr`（スペースなし、ハイフン区切り）
- ✅ **短く具体的**：`create-pr` > `pr` （競合回避）
- ❌ **既存コマンドと競合しない**：`pr` → `/pr-comments`と競合

**競合チェック**:
```bash
# 既存コマンド一覧を確認
ls -la .claude/commands/

# 短い名前（pr, merge等）は既存の組み込みコマンドと競合しやすい
# → 動詞+名詞の組み合わせを推奨（create-pr, update-task等）
```

---

## 4. トラブルシューティング

### 4.1 コマンドが認識されない場合の診断フロー

```bash
# 診断1: ファイルの存在確認
ls -la .claude/commands/{command-name}.md

# 診断2: パーミッション確認（644であること）
ls -la .claude/commands/{command-name}.md
# 期待値: -rw-r--r--@ 1 user staff ...

# 診断3: エンコーディング確認（UTF-8であること）
file .claude/commands/{command-name}.md
# 期待値: Unicode text, UTF-8 text

# 診断4: BOMチェック（BOMがないこと）
hexdump -C .claude/commands/{command-name}.md | head -1
# 期待値: 23 20（= "# "）で始まる

# 診断5: git管理下確認（trackedであること）
git status .claude/commands/{command-name}.md
# 期待値: "Changes not staged" または "nothing to commit"
# NG: "Untracked files"

# 診断6: 作業ディレクトリ確認
pwd
# .claude/commands/が存在するディレクトリにいるか？
```

### 4.2 解決手順

**Issue A: untrackedファイル**
```bash
git add .claude/commands/{command-name}.md
git commit -m "feat: add /{command-name} command"
# Claude Code再起動
```

**Issue B: パーミッション不正**
```bash
chmod 644 .claude/commands/{command-name}.md
git add .claude/commands/{command-name}.md
git commit -m "fix: update permissions for {command-name}.md"
# Claude Code再起動
```

**Issue C: 作業ディレクトリ違い**
```bash
# 現在のディレクトリを確認
pwd

# 正しいリポジトリに移動
cd /path/to/correct/repository

# .claude/commands/を作成
mkdir -p .claude/commands

# コマンドファイルをコピー
cp /path/to/source/{command-name}.md .claude/commands/

# git add & commit
git add .claude/commands/
git commit -m "feat: add custom commands"

# Claude Code再起動
```

**Issue D: 命名競合**
```bash
# 既存コマンドとの競合チェック
# 例: /pr → /pr-comments と競合

# ファイル名変更
mv .claude/commands/pr.md .claude/commands/create-pr.md

# git add & commit
git add .claude/commands/
git commit -m "fix: rename pr.md to create-pr.md"

# Claude Code再起動
```

---

## 5. 実践例

### 5.1 新規コマンド作成（create-pr）

```bash
# Step 1: 作業ディレクトリ確認
pwd  # /Users/ksato/brainbase

# Step 2: .claude/commands/ディレクトリ作成
mkdir -p .claude/commands

# Step 3: テンプレートからコピー（または新規作成）
cat > .claude/commands/create-pr.md << 'EOF'
# PR作成コマンド

session/* ブランチから Pull Request を作成します。

**用途**:
- PRを作成してレビュー依頼

---

## 1. ブランチ確認

```bash
CURRENT_BRANCH=$(git branch --show-current)
echo "現在のブランチ: $CURRENT_BRANCH"
```

---

## 2. PR作成

```bash
gh pr create --title "PR Title" --body "PR Body" --web
```
EOF

# Step 4: パーミッション設定
chmod 644 .claude/commands/create-pr.md

# Step 5: 確認
ls -la .claude/commands/create-pr.md
file .claude/commands/create-pr.md

# Step 6: git add & commit
git add .claude/commands/create-pr.md
git commit -m "feat: add /create-pr custom command"

# Step 7: Claude Code再起動
# ターミナルを閉じて再起動

# Step 8: 動作確認
# Claude Codeで `/create-pr` と入力して表示されることを確認
```

---

## 6. テンプレート

### 6.1 シンプルコマンド

参照：`.claude/skills/custom-command-creation/templates/simple-command.md`

### 6.2 多段階コマンド

参照：`.claude/skills/custom-command-creation/templates/multi-phase-command.md`

### 6.3 条件分岐コマンド

参照：`.claude/skills/custom-command-creation/templates/conditional-command.md`

---

## 7. ベストプラクティス

### 7.1 コマンド設計

**原則**:
- ✅ **単一責任**：1コマンド = 1つの目的
- ✅ **冪等性**：何度実行しても同じ結果
- ✅ **エラーハンドリング**：前提チェック → 実行 → 確認
- ✅ **ユーザーフレンドリー**：エラーメッセージに解決策を含める

**例**:
```bash
# Good: エラーメッセージに解決策
if ! command -v gh &> /dev/null; then
  echo "Error: gh CLI がインストールされていません"
  echo "インストール: brew install gh"
  exit 1
fi

# Bad: エラーメッセージのみ
if ! command -v gh &> /dev/null; then
  echo "Error: gh CLI not found"
  exit 1
fi
```

### 7.2 ドキュメント

**必須セクション**:
1. **タイトル + 説明**：何をするコマンドか
2. **用途**：どんな時に使うか
3. **前提チェック**：実行前に確認すべきこと
4. **段階的手順**：1ステップずつ明確に
5. **完了確認**：正常終了の確認方法

---

## 8. Claude Code への通知

### 8.1 Skill適用時の自動実行

**このSkillが適用されたら、以下を自動実行**:

```bash
# 1. 作業ディレクトリ確認
echo "現在の作業ディレクトリ:"
pwd

# 2. .claude/commands/の存在確認
if [ -d ".claude/commands" ]; then
  echo "✅ .claude/commands/ 存在"
  ls -la .claude/commands/
else
  echo "⚠️ .claude/commands/ 未作成"
  echo "実行: mkdir -p .claude/commands"
fi

# 3. 既存コマンド一覧
echo "既存カスタムコマンド:"
ls .claude/commands/*.md 2>/dev/null | xargs -n1 basename | sed 's/\.md$//' | sed 's/^/  \//g' || echo "  なし"
```

### 8.2 コマンド作成フロー

**ユーザーが「〇〇するカスタムコマンドを作って」と依頼した場合**:

1. **命名確認**：コマンド名を決定（競合チェック含む）
2. **配置場所確認**：`pwd` で現在地確認 → `.claude/commands/` 作成
3. **ファイル作成**：テンプレートから生成
4. **パーミッション設定**：`chmod 644`
5. **git add & commit**：必須
6. **ユーザーに通知**：「Claude Codeを再起動して `/{command-name}` を試してください」

---

## 9. 参考リンク

**内部ドキュメント**:
- [git-workflow skill](..//git-workflow/SKILL.md): Git操作のベストプラクティス
- [CLAUDE.md](../../CLAUDE.md): 開発規約

**外部リソース**:
- [Claude Code Documentation](https://code.claude.com/docs/)
- [Slash Commands Guide](https://code.claude.com/docs/en/slash-commands.md)

---

**最終更新**: 2025-12-29
**作成者**: 佐藤圭吾
**ステータス**: Active
