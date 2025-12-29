# セッションコミット＆マージ（3モード対応版）

session/* ブランチを main へマージします。
3つのモード（**PRモード** / **安全モード** / **高速モード**）から選択できます。

**モード選択**:
- **PRモード（推奨・チーム開発）**: GitHub PR経由でマージ、CI/CDチェック、レビュー可能
- **安全モード（個人開発・symlink保護）**: worktree使用、大量削除対応
- **高速モード（個人開発・クリーン時）**: 直接マージ、高速

---
## 0. モード選択

### 質問: PRを作成してGitHub経由でマージしますか？ [Y/n]

#### Option A: PRモード（推奨・チーム開発向け）
- GitHub PR経由でマージ
- CI/CDチェック、レビュー可能
- --no-ff マージを GitHub側で実施
- → **Phase 1-PR へ**

#### Option B: 直接マージ（個人開発・高速）
- ローカルで直接マージ
- 安全モード または 高速モード選択
- → **Phase 1 へ（既存フロー）**

**使い分け**:
- PRモード: チーム開発、CI/CD有効、レビュー必要
- 安全/高速モード: 個人開発、CI不要、高速マージ優先

---
## 0-PR. 前提（PRモード用）
- 現ブランチ: `session/*` であること
- 全てのコミット完了
- テスト通過済み
- gh CLI インストール済み (`gh --version`)
- GitHub認証完了 (`gh auth status`)

---
## 1-PR. PRモード手順

### 1-PR-1. 前提確認

```bash
# ブランチ確認
CURRENT_BRANCH=$(git branch --show-current)
if [[ ! "$CURRENT_BRANCH" =~ ^session/ ]]; then
  echo "Error: session/* ブランチから実行してください"
  exit 1
fi

# gh CLI確認
if ! command -v gh &> /dev/null; then
  echo "Error: gh CLI がインストールされていません"
  echo "インストール: brew install gh"
  exit 1
fi

# GitHub認証確認
if ! gh auth status &> /dev/null; then
  echo "Error: GitHub認証が必要です"
  echo "実行: gh auth login"
  exit 1
fi

echo "✓ 前提確認完了"
```

### 1-PR-2. リモートへpush

```bash
echo "📤 リモートへpush中..."
git push -u origin "$CURRENT_BRANCH"

if [ $? -ne 0 ]; then
  echo "Error: push に失敗しました"
  exit 1
fi

echo "✓ Push完了"
```

### 1-PR-3. PR作成

```bash
# コミット数取得
COMMIT_COUNT=$(git rev-list --count main..HEAD)

# PR Title生成（単一/複数コミット対応）
if [ "$COMMIT_COUNT" -eq 1 ]; then
  PR_TITLE=$(git log -1 --format="%s")
else
  # ブランチ名から推測
  BRANCH_TYPE=$(echo "$CURRENT_BRANCH" | cut -d- -f4)
  BRANCH_NAME=$(echo "$CURRENT_BRANCH" | cut -d- -f5-)

  case "$BRANCH_TYPE" in
    feature) TYPE="feat" ;;
    fix) TYPE="fix" ;;
    refactor) TYPE="refactor" ;;
    hotfix) TYPE="hotfix" ;;
    *) TYPE="chore" ;;
  esac

  PR_TITLE="$TYPE: $BRANCH_NAME"
fi

# PR Body生成
PR_BODY=$(cat <<EOF
## Summary

$(git log main..HEAD --format="- %s")

## コミット履歴

\`\`\`
$(git log main..HEAD --oneline)
\`\`\`

## Test plan

- [ ] 全てのテストが通ることを確認
- [ ] 変更が意図通りに動作することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)

# PR作成（ブラウザは開かない）
echo "🔧 PR作成中..."
gh pr create --title "$PR_TITLE" --body "$PR_BODY"

if [ $? -ne 0 ]; then
  echo "Error: PR作成に失敗しました"
  exit 1
fi

echo "✓ PR作成完了"
```

### 1-PR-4. GitHub経由マージ

```bash
echo "🔀 GitHub経由でマージ中..."

# gh pr merge は --merge でmerge commit作成（--no-ff相当）
gh pr merge --merge --delete-branch

if [ $? -ne 0 ]; then
  echo "Error: マージに失敗しました"
  echo ""
  echo "考えられる原因:"
  echo "  - CI/CDチェックが未完了"
  echo "  - コンフリクトが発生"
  echo "  - レビュー承認が必要"
  echo ""
  echo "GitHub UI でPRを確認してください:"
  gh pr view --web
  exit 1
fi

echo "✓ マージ完了"
```

### 1-PR-5. ローカル同期

```bash
echo "🔄 ローカル同期中..."

git checkout main
git pull origin main
git fetch --prune

echo "✓ ローカル同期完了"
```

### 1-PR-6. 成功確認

```bash
echo ""
echo "✅ PRモードマージ成功！"
echo ""
git log --oneline -3
echo ""
echo "Merge pull request #X が表示されていることを確認してください"
```

**注意**:
- `gh pr merge --merge` は CI完了後にマージ実行（GitHub側で制御）
- コンフリクト時は GitHub UI で手動解決が必要
- ブランチは自動削除されます（--delete-branch）

---
## 1. 変更確認（汚染検知）【安全/高速モード用】
```bash
git status --porcelain
```
- `D .claude/...` や `D _codex/...` が並ぶ場合 → 汚染あり → **安全モード**へ。
- それ以外でクリーンなら高速モードも可。

---
## 2. セッション側のコミット【安全/高速モード用】（共通）
1) 必要な変更だけ add（symlink配下は除外推奨）  
```bash
git add <必要なファイルだけ>
git commit -m "<type>: <summary>"
```
コミット書式:
```
<type>: <summary>

なぜ:
- 変更の意図・背景

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```
2) ブランチをリモートへ
```bash
git push -u origin $(git branch --show-current)
```

---
## 3A. 安全モード（推奨・汚染時必須）
クリーンな一時 worktree でマージする。パスは必要に応じて調整。
```bash
cd /Users/ksato/workspace/brainbase        # 正本リポジトリルート
git fetch origin
git worktree add ../_merge-tmp main        # main をクリーンにチェックアウト
cd ../_merge-tmp
git merge origin/SESSION_BRANCH --no-ff -m "Merge session: SESSION_BRANCH"
# コンフリクト時はここで解決
git push origin main                       # push確認のうえ実行
cd ..
git worktree remove _merge-tmp             # 後片付け
```
- `SESSION_BRANCH` は実ブランチ名に置換。
- コンフリクト方針を決めてから解決（main優先/branch優先など）。

---
## 3B. 高速モード（ワークツリーがクリーンなときのみ）
```bash
git checkout main
git pull origin main
git merge SESSION_BRANCH --no-ff -m "Merge session: SESSION_BRANCH"
# コンフリクトあれば解決
git push origin main   # 要確認
git checkout SESSION_BRANCH
```

---
## 4. マージコミット書式
```
Merge session: {セッション名}

セッション内容:
- 主な変更点1
- 主な変更点2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---
## 5. 注意
- main 直で作業しない。session ブランチ専用。
- 汚染したワークツリーでは stash に頼らない（symlink で失敗するため）。必ず安全モードを使う。
- 一時 worktree を削除して後片付けを忘れない。
