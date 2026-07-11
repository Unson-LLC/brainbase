# 標準コミット実行

現在の変更に説明をつけてコミットします。
**SNS投稿のネタになるよう「悩み→判断→結果」の過程も記録する。**

## 前提

- brainbaseは素の **git** で管理されている
- 意図に対応するファイルを明示的に `git add <path>` してから `git commit` する（`git add -A` / `git add .` は禁止）
- dirty なまま放置するのは禁止。詳細は `.claude/rules/commit-strategy.md`

## 実行手順

1. **ブランチ確認**
   - `git branch --show-current` で現在のブランチを確認
   - `git log --oneline -5` で直近のコミットを確認

2. **変更内容の確認**
   - `git status` で変更ファイルを確認
   - `git diff` で変更内容を確認（必要に応じて）

3. **会話の文脈から以下を抽出:**
   - **悩み**: 何に悩んだか（トレードオフ、選択肢の比較、迷い）
   - **判断**: なぜその判断をしたか（理由、根拠、決め手）
   - **結果**: どうなったか、何が変わったか

4. **ステージしてコミット:**
   ```bash
   git add <対象ファイル...> && git commit -m "$(cat <<'EOF'
   <type>: <summary>

   悩み→判断:
   - 何に悩んだか
   - なぜこの判断をしたか
   （※思考過程がある場合のみ。単純な修正では省略可）

   なぜ:
   - 変更の意図・背景

   変更:
   - 主な変更点（多い場合のみ）

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

5. **結果を確認:**
   ```bash
   git log -1 --stat
   ```

6. **学習抽出をバックグラウンドで起動（明示的な作業完了イベント）:**
   ```bash
   # 作業単位の区切り = commit なので、このタイミングで学習候補抽出を走らせる
   # 終わるのを待たず、nohup で投げっぱなし（2h cron が保険で拾う）
   nohup bash /Users/ksato/workspace/common/ops/scripts/drain-learn-queue.sh \
     > /dev/null 2>&1 &
   ```
   - 別プロセスで codex exec が transcript を分析
   - 候補は `brainbase learn inbox` に積まれる
   - 毎朝 `/ohayo` で件数確認、週次 `/retro` で apply/reject

## コミットメッセージフォーマット

```
<type>: <summary>（日本語可、50文字以内）

悩み→判断:
- 何に悩んだか（例：AとBどちらを採用するか）
- なぜこの判断をしたか（例：〜の理由でAを選択）
（※思考過程がある場合のみ。単純な修正では省略可）

なぜ:
- 変更の意図・背景

変更:
- 主な変更点（多い場合のみ）

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### type一覧

| type | 用途 |
|------|------|
| `feat` | 新機能・新規追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | リファクタリング（機能変更なし） |
| `chore` | ビルド・設定・運用系の変更 |
| `style` | フォーマット変更（機能に影響なし） |

## git特有の注意事項

- コミットメッセージを直前で修正したい場合は `git commit --amend`（push済みなら force-push が必要になるため注意）
- 過去のコミットを修正したい場合は `git rebase -i` で戻って編集（協働ブランチでは避ける）
- branchは自動で動かない。必要なら `git branch -f <name> <commit>` で手動設定

## 禁止事項

- 秘密情報（.env, credentials.json等）を含む変更を放置しない
- 変更が大きすぎる場合は `git add -p` でファイルを分割してコミットすることを提案
