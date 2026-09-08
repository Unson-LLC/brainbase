---
story_id: story-t0-dedicated-slack-installation-oauth
title: TechKnight専用Slack OAuthで別テナント接続できる
spec_docs:
  - docs/specs/story-t0-dedicated-slack-installation-oauth.md
architecture_docs:
  - docs/architecture/story-t0-dedicated-slack-installation-oauth.md
status: implementing
t0_program_status: implementing
created_at: 2026-09-05
updated_at: 2026-09-05
---

# TechKnight専用Slack OAuthで別テナント接続できる

## Story

TechKnightの本番運用担当者として、Brainbaseログイン用Slackアプリを変更せずに、TechKnightのSlackアプリをTechKnightテナントへOAuth接続したい。これにより事業体が異なるUnsonとTechKnightの資格情報・workspace connectionを同じテナントへ混在させず、T0本番検証を進められる。

## 受け入れ基準

- [x] AC-001: installation control planeは専用client ID/secret/token URLが設定された場合にそれをOAuth交換へ使う。
- [x] AC-002: 専用設定がない既存環境はAuthServiceのSlack設定へ後方互換で戻る。
- [x] AC-003: 専用設定7項目の一つでも存在し、必須組合せが欠ける場合はfail-closeし、利用可能と報告しない。
- [x] AC-004: `BRAINBASE_SLACK_INSTALLATION_APP_ID`とOAuth client IDを同一値と仮定しない。
- [x] AC-005: authorization code、client secret、tokenをログ・Story・検証証跡へ保存しない。
- [x] AC-006: focused unit testと既存installation統合テストが通る。
- [ ] AC-007: Slackが更新トークンを返さない場合も、credential storeの`refresh_revision=0`を正本DBへ登録し、workspace connectionを有効化できる。

## 完了境界

このStoryのマージ・本番配備だけではT0完了にしない。TechKnight workspaceのOAuth同意、credential store登録、workspace connection、別接続でのreadbackまでが本番で確認された時点でT0の該当境界を完了とする。
