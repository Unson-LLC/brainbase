---
story_id: story-t0-legacy-company-authority-retirement
title: 旧テナント会社権限経路の監査付き失効
status: done
created_at: 2026-09-05
updated_at: 2026-09-05
horizon: now
view: product
spec_docs:
  - path: docs/specs/story-t0-legacy-company-authority-retirement.md
    status: accepted
related:
  - story-t0-initial-tenant-slack-oauth-bootstrap
---

# 旧テナント会社権限経路の監査付き失効

## User Story

Brainbaseの運用担当として、別テナントへ移す会社権限が旧テナントで実行時に解決されるとき、対象を正確に固定し、dry-runと明示承認を経て、再実行可能な監査記録付きで失効したい。そうすれば、同じ人物が複数組織に所属できる状態を保ちながら、誤ったテナント配置だけを安全に止められる。

## Acceptance Criteria

- [x] AC-001: manifestはtenant、organization、project、membership、external identity、active bindingの期待値を完全に固定し、未知項目・秘密値・重複を拒否する。
- [x] AC-002: 対象membershipに宣言外のactive identityまたはactive bindingがある場合、書込みなしでfail closedにする。
- [x] AC-003: dry-runはapplyと同じ検証・更新・route readbackをtransaction内で実行し、必ずrollbackする。
- [x] AC-004: applyは `--approve-apply`、実行actor、idempotency keyを必須とし、同じkeyと同じmanifestの再実行で書込みを増やさない。異なるmanifestはconflictにする。
- [x] AC-005: applyは対象identityとbindingをrevoked、対象membershipをinactiveかつrevision増分にし、人物、auth grant、organization、project、workspace connectionを変更しない。
- [x] AC-006: commit後は別接続で対象行とruntime route 0件を読み戻す。欠落、partial、unknown、宣言外のactive行は成功にしない。
- [x] AC-007: 適用結果は既存のprovisioning operation ledgerへ秘密を含まないreceiptとして残す。

## Out of Scope

- 人物の統合や削除
- `auth_grants`、organization、project、workspace connectionの変更
- 移設先テナントでのSlack OAuth同意、人員登録、権限付与
- 本番applyそのもの
