---
story_id: story-human-company-action-authority-provisioning
title: 実利用者の会社操作権限を既存アクセスへ付与する
status: active
created_at: 2026-09-06
updated_at: 2026-09-06
horizon: now
view: product
spec_docs:
  - path: docs/specs/story-human-company-action-authority-provisioning.md
    status: accepted
related:
  - story-t0-human-tenant-access-provisioning
  - story-canonical-company-authority-context
---

# 実利用者の会社操作権限を既存アクセスへ付与する

## User Story

Brainbaseの運用担当として、Slack OAuthと人物アクセス登録を終えた利用者へ会社操作権限を付与するとき、対象の人物・所属・Slack identity・resource・capability・effectをmanifestで固定し、dry-runとcommit後readbackを経て安全に適用したい。そうすれば、人物登録を操作許可と取り違えず、宣言した操作だけをcanonical company authority contextで解決できる。

## Acceptance Criteria

- [ ] AC-001: manifestはtenant、organization、project、Slack transport、人物、既存membership/identity、membershipの`expected_project_codes`、bindingの全権限値を固定し、未知項目・秘密値・重複を拒否する。
- [ ] AC-002: active tenant/project/organization/workspace connectionと、active human membership/Slack identityおよび`expected_project_codes`とのcanonical完全一致が満たされない場合は書込みなしでfail closedにする。
- [ ] AC-003: active bindingが0件なら次revisionを作成し、完全一致する1件ならnoop、差分または複数件ならconflict/ambiguousで停止する。
- [ ] AC-004: dry-runはapplyと同じtransaction処理とreadbackを行ってrollbackし、applyは明示承認とactorを必須にする。
- [ ] AC-005: apply後は別DB接続で宣言した全bindingをexact readbackし、欠落・partial・unknownを成功にしない。
- [ ] AC-006: 既存の人物、login grant、membership、external identity、workspace connectionは変更しない。
- [ ] AC-007: Story、Spec、実装、テストのリンクを維持し、VibeProは軽量なStory→Spec補助に限定する。

## Out of Scope

- Slack OAuth、人物、login grant、membership、external identityの新規登録
- service actorの権限付与
- 実操作や外部副作用の成功判定
- 旧テナント権限の失効

## 実装・検証リンク

- Spec: `docs/specs/story-human-company-action-authority-provisioning.md`
- 実装: `server/services/multitenant/human-action-authority-provisioner.js`
- CLI: `scripts/provision-human-action-authority.js`
- テスト: `tests/server/services/multitenant/human-action-authority-provisioner.test.js`
