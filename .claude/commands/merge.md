# セッションコミット＆マージ

現在のセッションブランチの変更をコミットし、mainにマージします。
セッション完了時のワンストップコマンド。

## 実行手順

1. **ブランチ確認**
   - `git branch --show-current` で現在のブランチを確認
   - `session/*` ブランチでなければ中止（mainで実行不可）

2. **変更確認**
   - `git status` で変更ファイルを確認
   - `git diff --stat HEAD` で変更量を確認
   - 変更がなければマージのみ実行

3. **セッションブランチにコミット**
   - CLAUDE.mdのコミットルールに従う
   - 悩み→判断の過程があれば記録
   - `git add -A && git commit`

4. **mainにマージ**
   ```bash
   git checkout main
   git pull origin main  # リモートの最新を取得
   git merge {session-branch} --no-ff -m "Merge session: {セッション名}"
   ```

5. **コンフリクト対応**
   - コンフリクト発生時は手動解決を案内
   - 解決後に再度 `/merge` を実行

6. **プッシュ確認**
   - 「mainにpushしますか？」と確認
   - Yes → `git push origin main`
   - No → ローカルのみ（後でpush可能）

7. **セッションブランチに戻る**
   - `git checkout {session-branch}`
   - worktreeはそのまま維持（UIからアーカイブで削除）

## コミットメッセージフォーマット

### セッションコミット
```
<type>: <summary>

なぜ:
- 変更の意図・背景

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### マージコミット
```
Merge session: {セッション名}

セッション内容:
- 主な変更点1
- 主な変更点2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## 注意事項

- mainブランチでは実行不可（セッションブランチ専用）
- コンフリクト時は手動解決が必要
- pushはオプション（確認あり）
- worktree削除はUIから「アーカイブ」で実行
