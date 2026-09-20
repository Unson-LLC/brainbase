---
story_id: story-device-login-provider-neutral-copy
title: Deviceログイン画面の組織認証表示をprovider-neutralにする
spec_docs:
  - docs/specs/story-device-login-provider-neutral-copy.md
architecture_docs: []
status: completed
created_at: 2026-09-20
updated_at: 2026-09-20
---

# Deviceログイン画面の組織認証表示をprovider-neutralにする

CLIのDeviceログイン利用者として、実際に設定された認証方式と異なるサービス名を画面で案内されず、組織アカウントの認証へ進みたい。これにより、画面表示と実際のOAuth遷移の不一致による混乱を防ぐ。

## 受け入れ基準

- [x] Deviceログイン画面の見出し、説明、ボタンが組織認証を示すprovider-neutralな文言になっている。
- [x] 認証情報が見つからないエラーもprovider-neutralな文言になっている。
- [x] Google Workspace、Growin、Slackなど特定providerの表示文言をDeviceログイン画面へ固定しない。
- [x] 認証方式、OAuth開始endpoint、redirect、device approvalのbackend契約を変更しない。
- [x] provider-neutralな表示を対象surface契約テストで検証できる。

## 検証結果

- 旧文言ではsurface testが失敗することを確認後、修正して成功。
- 対象lockfileで依存を導入し、surface・Slack route・Google providerの3ファイル44テストが成功。
- `public/jsconfig.json`の型検査、`git diff --check`が成功。
- 実装の完了を示す。本番配信・本人のOAuth完了は別の運用検証として扱う。

## スコープ外

- provider選択やruntime設定の変更
- OAuth endpoint、redirect、callback、device approvalの変更
- 本番デプロイ、認証E2E、外部サービスへの操作
