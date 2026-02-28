# 標準コミット実行（jj）

現在の変更に説明をつけ、次の変更に進みます。
**SNS投稿のネタになるよう「悩み→判断→結果」の過程も記録する。**

## 前提

- brainbaseは **Jujutsu (jj)** で管理されている
- jjではworking copyが常にコミット。`git add` + `git commit` は不要
- `jj describe` で説明をつけ、`jj new` で次の変更に進む

## 実行手順

1. **ワークスペース確認**
   - `jj workspace list` で現在のワークスペースを確認
   - `jj log -r @ --no-pager` で現在のworking copyを確認

2. **変更内容の確認**
   - `jj diff --stat` で変更ファイルを確認
   - `jj diff` で変更内容を確認（必要に応じて）

3. **会話の文脈から以下を抽出:**
   - **悩み**: 何に悩んだか（トレードオフ、選択肢の比較、迷い）
   - **判断**: なぜその判断をしたか（理由、根拠、決め手）
   - **結果**: どうなったか、何が変わったか

4. **コミットメッセージを設定:**
   ```bash
   jj describe -m "$(cat <<'EOF'
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

5. **次の変更に進む:**
   ```bash
   jj new
   ```

6. **結果を確認:**
   ```bash
   jj log -r @- --no-pager
   ```

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

## jj特有の注意事項

- `jj describe` は現在のworking copy（`@`）の説明を更新する。何度でも書き直せる
- `jj new` を実行すると、現在の `@` が確定し、新しい空の `@` が作られる
- 過去のコミットを修正したい場合は `jj edit <change-id>` で戻って `jj describe` で修正。子孫は自動rebase
- bookmarkは自動で動かない。必要なら `jj bookmark set <name> -r @-` で手動設定

## 禁止事項

- 秘密情報（.env, credentials.json等）を含む変更を放置しない
- 変更が大きすぎる場合は `jj split` で分割を提案
