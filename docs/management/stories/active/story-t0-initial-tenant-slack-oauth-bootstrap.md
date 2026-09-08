---
story_id: story-t0-initial-tenant-slack-oauth-bootstrap
title: 初期テナント管理者が最初のSlack接続を安全に作れる
spec_docs:
  - docs/specs/story-t0-initial-tenant-slack-oauth-bootstrap.md
architecture_docs:
  - docs/architecture/story-t0-initial-tenant-slack-oauth-bootstrap.md
status: implementing
t0_program_status: implementing
created_at: 2026-09-05
updated_at: 2026-09-05
---

# 初期テナント管理者が最初のSlack接続を安全に作れる

## Story

本番運用者として、新しい事業体のテナントに最初の管理者を登録し、その管理者にだけ束縛したSlack OAuth同意URLを発行したい。これにより、既存テナントの認証情報を流用せず、最初のworkspace connectionがないため管理者認証もできない循環を安全に解消できる。

## 受け入れ基準

- [x] AC-001: 初期登録はhuman 1名かつ`tenant_admin`だけを受け付け、通常memberや複数人を拒否する。
- [x] AC-002: 初期登録はactive tenant、tenant project、Graph organizationを検証し、organization、person、auth grant、membershipだけを作る。
- [x] AC-003: 初期登録はworkspace connectionやexternal identityを作らず、通常の人員登録契約を緩めない。
- [x] AC-004: OAuth URL発行前に、同じtenant内のactiveな初期管理者membership、person、auth grant、projectをDBで再検証する。appは本番設定、workspace/appは署名stateとcallbackで一致検証する。
- [x] AC-005: OAuth intentは既存の署名・有効期限付きcontrol planeへ保存し、secret、token、authorization codeを出力しない。
- [x] AC-006: check、dry-run、明示承認付きapply／authorizeを分離し、失敗したDB clientをpoolへ正常返却しない。
- [ ] AC-007: focused test、実PostgreSQL統合テスト、型検査が通る。

## 完了境界

このStoryのマージ・配備だけではT0完了にしない。実Slack同意、credential store登録、workspace connection、通常の人員登録、別接続readback、cross-tenant negativeまでを本番で確認して完了とする。
