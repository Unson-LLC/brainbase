---
name: claude-code-hooks-gotchas
description: Claude Code Hooksの設定と動作に関する重要な注意事項とgotcha集。設定形式、トリガータイミング、デバッグ方法をまとめた運用ガイド
location: managed
type: project
---

## Triggers

以下の状況で使用：
- Claude Code Hooksを設定するとき
- Hooksが動作しない際のトラブルシューティング
- Stopトリガーの発火タイミングを確認したいとき

# Claude Code Hooks 運用ガイド - 重要な注意事項とGotcha

Claude Code Hooksの設定・運用時に遭遇しやすい問題と解決策をまとめたガイド。

## 設定形式の注意点

### JSON形式は必ず `{"hooks": {...}}` のネスト構造で記述する

**問題**: hooks設定をトップレベルに直接書くと動作しない

```json
❌ 誤った例
{
  "sessionStart": {...},
  "userPromptSubmit": {...}
}
```

```json
✅ 正しい例
{
  "hooks": {
    "sessionStart": {...},
    "userPromptSubmit": {...}
  }
}
```

**原因**: Claude Codeの設定パーサーは `hooks` キーの存在を前提としている

**確認方法**:
```bash
# 設定ファイルの構造を確認
cat ~/.config/claude-code/settings.json | jq '.hooks'
```

## Stopトリガーの発火タイミング

### Stopトリガーは「エージェントの応答完了時のみ」発火する

**重要**: ユーザーによる中断（Ctrl+C等）では発火しない

```yaml
hooks:
  stop:
    command: "echo 'cleanup after response'"
```

**発火するケース**:
- エージェントが応答を完了した直後
- エラーなく正常終了した時

**発火しないケース**:
- ユーザーがCtrl+Cで中断した時
- セッションがクラッシュした時
- タイムアウトで強制終了した時

**適した用途**:
- 応答完了後のクリーンアップ
- セッション統計の記録
- 完了通知の送信

**不適切な用途**:
- 必ず実行されるべきクリーンアップ（→ sessionEnd推奨）
- 中断時の状態保存（→ 別の仕組みが必要）

## デバッグとトラブルシューティング

### Hooksが動作しない時の確認手順

1. **設定ファイルの構文チェック**
   ```bash
   cat ~/.config/claude-code/settings.json | jq .
   ```
   エラーが出る場合はJSON構文エラー

2. **hooks キーの存在確認**
   ```bash
   cat ~/.config/claude-code/settings.json | jq '.hooks'
   ```
   `null` が返る場合は設定形式が誤っている

3. **コマンドの実行権限確認**
   ```bash
   # スクリプトを直接実行してみる
   bash /path/to/hook-script.sh
   ```

4. **ログの確認**
   Hooksの実行ログは Claude Code のセッションログに出力される

### よくあるエラーパターン

| エラー症状 | 原因 | 解決策 |
|-----------|------|--------|
| Hooksが全く動作しない | `{"hooks": {...}}` 形式になっていない | ネスト構造に修正 |
| Stopが発火しない | ユーザーが中断している | sessionEndトリガーを検討 |
| スクリプトがエラーになる | パスが相対パス | 絶対パスに変更 |
| 環境変数が使えない | シェルの初期化が不完全 | スクリプト内で明示的にsource |

## 実践的なHooks設定例

### セッション開始時の環境チェック

```json
{
  "hooks": {
    "sessionStart": {
      "command": "~/.config/claude-code/hooks/check-environment.sh",
      "showOutput": true
    }
  }
}
```

### 応答完了後の統計記録

```json
{
  "hooks": {
    "stop": {
      "command": "echo \"Session completed: $(date)\" >> ~/claude-sessions.log",
      "showOutput": false
    }
  }
}
```

### 複数のトリガーを組み合わせた構成

```json
{
  "hooks": {
    "sessionStart": {
      "command": "/path/to/startup-check.sh",
      "showOutput": true
    },
    "userPromptSubmit": {
      "command": "/path/to/log-prompt.sh",
      "showOutput": false
    },
    "stop": {
      "command": "/path/to/cleanup.sh",
      "showOutput": false
    }
  }
}
```

## 参考情報

- Claude Code公式ドキュメント: Hooks設定ガイド
- 関連スキル: `claude-code-cicd-auth`（CI/CD環境での認証設定）
- 設定ファイルパス: `~/.config/claude-code/settings.json`

---

**最終更新**: 2025-12-17
**情報源**: セッション履歴からの自動抽出
