---
story_id: story-t0-slack-provider-error-readback
title: Slack OAuth失敗を安全な固定コードで読戻せる
spec_docs:
  - docs/specs/story-t0-slack-provider-error-readback.md
status: active
created_at: 2026-09-05
updated_at: 2026-09-05
---

# Slack OAuth失敗を安全な固定コードで読戻せる

## Story

T0の運用担当者として、Slack OAuthがprovider rejectionで失敗したとき、provider response bodyやauthorization codeを保存せず、原因を区別できる固定コードを同じinstallation intentの診断台帳から読み戻したい。これにより、秘密を露出せずに次の修復を決められる。

## 受け入れ基準

- [x] AC-001: Slackの既知エラーを用途別の固定コードへ変換し、未知の値は`OAUTH_EXCHANGE_REJECTED`へ閉じる。
- [x] AC-002: 固定コードは既存のtenant/intent別診断台帳へ保存され、provider response body、authorization code、token、例外messageを保存しない。
- [x] AC-003: 公開callbackは従来どおり`UPSTREAM_UNAVAILABLE`だけを返す。
- [ ] AC-004: 対象単体テストとroute契約テストが通り、本番で新しい失敗または成功を同じintentから読み戻す。

## 現在の再現証跡

- 本番の同意後、同じintentのledgerは`oauth_exchange / OAUTH_EXCHANGE_REJECTED`で失敗し、接続は0件だった。
- 無効コードによる安全な検査ではSlackが`invalid_code`を返し、Client ID、Client Secret、redirect URIが検証段階を通過した。
- 既存adapterはSlackの`payload.error`をすべて破棄するため、次の修復判断に必要な区別を読み戻せない。

## 完了境界

ローカルテスト、PR、CI、本番反映だけではT0を完了にしない。新しいOAuth intentについて、Slack接続、資格情報参照、利用イベント、操作レシートの実読戻しが揃った時点でT0の完了判定を行う。
