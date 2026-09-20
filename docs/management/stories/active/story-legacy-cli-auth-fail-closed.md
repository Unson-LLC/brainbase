---
story_id: story-legacy-cli-auth-fail-closed
title: CLI認証の旧insecure headerフォールバックを撤去する
spec_docs:
  - docs/specs/story-legacy-cli-auth-fail-closed.md
architecture_docs: []
status: completed
created_at: 2026-09-20
updated_at: 2026-09-20
---

# CLI認証の旧insecure headerフォールバックを撤去する

Brainbase CLI利用者として、Slack Device Code Flowが利用できないときに、入力したrole・project・clearanceを認証情報として保存・送信する旧経路へ切り替わらず、正規のログイン手順へ戻れるようにしたい。これにより、CLIが本人確認されていない権限ヘッダーを作成する経路を持たない状態にする。

## 受け入れ基準

- [x] Device Code Flowの404・接続失敗で手入力のrole/project/clearanceを求めず、原因と正規ログインの再実行方法を表示して失敗する。
- [x] 旧`insecure_header`形式の`auth.json`をCLIの学習・プロジェクト操作で送信しない。
- [x] 旧`insecure_header`形式の保存値を`auth status`で現行ログインとして表示しない。
- [x] Slack Device Code Flowの成功時は従来どおりBearer tokenを`auth.json`へ保存する。
- [x] `tokens.json`のSlackログイン由来Bearer tokenと、共有Google providerのサーバー側契約は変更しない。

## 検証

- 旧保存値の拒否、Device Flow 404・接続失敗時のfail-closed、成功時のBearer保存をCLI単体テストで確認する。
- 既存の学習CLI・プロジェクトプロビジョニングCLIテストを再実行する。
- 本番・外部サービス・保存済みの利用者認証情報は変更しない。

## スコープ外

- サーバーの`/api/auth/token/exchange`、insecure header middleware、共有Google providerの削除。
- `auth.json`・`tokens.json`の既存ファイル削除や本番デプロイ。
