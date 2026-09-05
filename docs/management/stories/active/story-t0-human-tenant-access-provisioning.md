---
story_id: story-t0-human-tenant-access-provisioning
title: 別事業体の実利用者をテナント境界付きで登録できる
spec_docs:
  - docs/specs/story-t0-human-tenant-access-provisioning.md
  - docs/specs/story-t0-human-tenant-access-provisioning.vibepro.json
architecture_docs:
  - docs/architecture/story-t0-human-tenant-access-provisioning.md
status: implementing
t0_program_status: implementing
created_at: 2026-09-05
updated_at: 2026-09-05
---

# 別事業体の実利用者をテナント境界付きで登録できる

## Story

Brainbaseの本番運用担当として、TechKnightの実利用者をUnsonとは別のテナントへ、再実行可能な宣言から安全に登録したい。そうすれば、同じ人物が複数事業体に関わる場合も、Slack workspace、所属、役割、権限、会社権限を混同せず、本番OAuthと実行経路を検証できる。

## 受け入れ基準

- [ ] AC-001: tenant、organization、project、person、Slack workspace/appを宣言で完全に束縛する。
- [ ] AC-002: `check`、`dry-run`、明示承認付き`apply`を分離し、途中失敗は全件rollbackする。
- [ ] AC-003: person、login grant、tenant membership、external identityを別状態として保存・再読込する。
- [ ] AC-004: 同じ宣言の再実行はnoopとなり、同じ自然キーの異なる宣言や複数候補はfail-closeする。
- [ ] AC-005: tenant RLS contextをtransaction内で固定し、別tenantの同名organizationを更新しない。
- [ ] AC-006: manifest、ログ、receiptへtoken、secret、OAuth codeを保存しない。
- [ ] AC-007: Graph organizationとactive Slack workspace connectionを検証し、commit後に別接続で全状態を再読込する。

## 本番対象

- TechKnight tenant: `ten_01M1QE4P77064VBSZNN73WQHC8`
- tenant organization ID: `org_techknight_business`
- Graph organization ID: `techknight`
- project: `prj_01KGCS8BVTT1PYSX3WFX23PJVF` / `techknight`
- workspace: `T07A9J3PEMB`
- tenant admin: 佐藤圭吾
- genuine human member: 梅田遼

梅田さんのログイン、OAuth同意、承認操作は本人の実操作としてのみ完了扱いにする。代理操作やIDの借用を成功証跡にしない。

## 完了境界

コード・テスト・マージ・配備だけでは完了にしない。本番DBのexact readbackと、TechKnight workspaceの実ユーザー認証を確認して初めてT0の該当境界を完了とする。
