# 標準コミット実行

現在の変更を CLAUDE.md のコミットルールに従ってコミットします。

## 実行手順

1. `git status` で変更ファイルを確認
2. `git diff --stat HEAD` で変更量を確認
3. 会話の文脈から「なぜこの変更をしたか」を把握
4. コミットメッセージを生成:
   - type: feat/fix/docs/refactor/chore/style から選択
   - summary: 50文字以内で要約
   - why: 変更の意図・背景
   - what: 主な変更点（変更が多い場合）
5. `git add -A && git commit` を実行
6. 結果を報告

## コミットメッセージフォーマット

```
<type>: <summary>

なぜ:
- 変更の意図・背景

変更:
- 主な変更点（多い場合のみ）

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## 注意事項

- 秘密情報（.env, credentials等）が含まれていないか確認
- 変更が大きすぎる場合は分割を提案
- コミット後は `git status` で確認
