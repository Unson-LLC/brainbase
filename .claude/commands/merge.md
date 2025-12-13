# セッションコミット＆マージ（安全モード対応版）

大量削除（symlink越しの .claude や _codex）が混入しても安全にセッションを main へ取り込む手順。  
デフォルトは **安全モード**（クリーンな一時 worktree を使う）。既存のワークツリーがクリーンなときのみ高速モードを使う。

---
## 0. 前提
- 現ブランチ: `session/*` であること。`main` なら中止。
- symlink 配下の大量 `D` をコミットしない（例: `.claude/**`, `_codex/**`）。

---
## 1. 変更確認（汚染検知）
```bash
git status --porcelain
```
- `D .claude/...` や `D _codex/...` が並ぶ場合 → 汚染あり → **安全モード**へ。
- それ以外でクリーンなら高速モードも可。

---
## 2. セッション側のコミット（どちらのモードでも共通）
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
