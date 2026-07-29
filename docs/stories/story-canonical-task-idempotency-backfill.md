---
story_id: story-canonical-task-idempotency-backfill
title: 既存Taskへ冪等キーを決定的にbackfillする
status: active
date: 2026-07-29
related_architecture:
  - docs/architecture/ADR-016-canonical-task-single-writer.md
  - docs/architecture/story-canonical-task-postgres-ssot.md
related_specs:
  - docs/specs/story-canonical-task-idempotency-backfill.md
responsibility_authority_docs:
  - docs/responsibility-authority/companion-canonical-task-provider.json
---

# 既存Taskへ冪等キーを決定的にbackfillする

## Who / Problem / Outcome

- **Who**: Canonical TaskのPostgreSQL移行を実行するBrainbase本番運用者。
- **Problem**: 本番NocoDBの既存Canonical Task行の大半（実測264件中240件）に冪等キーがなく、
  `story-canonical-task-postgres-ssot`で実装した移行は「冪等キーなし行」を明示エラーで停止する。
  このままではPostgreSQL移行workflowを開始できない。
- **Outcome**: 既存行へ`legacy:nocodb:<record-id>`形式の決定的な冪等キーをdry-run確認つきで
  採番でき、移行workflowを前提条件を満たした状態で開始できる。

## Current reality

PostgreSQL移行（PR #1085, merge `8dc54d88f`）はdevelopへマージ済みだが、移行元のNocoDB行の
大半に冪等キーがない。`scripts/migrate-canonical-task-postgres-store.js`は冪等キー欠落行を
検出すると`NocoDB migration source contains a row without legacy ID or idempotency key`で
失敗する設計であり、既存行への安全な採番手段が存在しない。

## Failure modes

- 採番が非決定的だと、再実行のたびに別キーになり冪等性が壊れる。
- 既存キーと採番キーが衝突すると、NocoDBの冪等キーunique制約またはPostgreSQL移行の
  競合検査で失敗する。
- backfill途中で停止した場合に残存欠落行が見えないと、移行が途中状態で開始される。
- 検査なしの一括書込は、writer稼働中の行と競合し得る。

## Done evidence

- backfillスクリプトの単体テスト（dry-run非書込、apply採番、競合停止、ページング、検証）がpassする。
- 既存のCanonical Task移行スクリプト回帰テストが現在HEADでpassする。
- dry-run出力が件数のみ（本文・secretなし）で対象件数と競合0件を報告する。

## Scope

- `scripts/backfill-canonical-task-idempotency-keys.js`（dry-run/apply、競合検出、apply後再検証）を追加する。
- npm script `backfill:canonical-task-idempotency-keys` を追加する。
- `docs/runbooks/canonical-task-cutover.md` のbefore-enable手順へbackfill前提手順を追記する。
- Canonical TaskのAPI契約、single-writer、readiness、移行workflow本体は変更しない。
- 本番NocoDBへのapply実行は本Storyに含めない（runbookの明示承認手順に従う）。

## Acceptance Criteria

- **AC-1**: 冪等キーを持たない行だけが対象になり、キーは`legacy:nocodb:<record-id>`で決定的に導出される。
- **AC-2**: dry-runは一切書込まず、総数・既存・欠落・競合の件数を報告する。
- **AC-3**: 採番キーが既存キーと衝突する場合、applyは書込前に失敗する。
- **AC-4**: apply後に全行再取得で欠落0件を検証し、残存があれば失敗として報告する。

## Scenario IDs

- S-001: dry-runで対象件数を安全に確認する。
- S-002: applyで欠落行だけへ決定的キーを採番する。
- S-003: キー競合を書込前に検出して停止する。
- S-004: apply後の再検証で完了を保証する。

### S-001: dry-runで対象件数を安全に確認する

`--dry-run`は全行をページングで読み、総数・既存キー数・欠落数・競合数だけを返す。PATCHは発行しない。

### S-002: applyで欠落行だけへ決定的キーを採番する

`--apply`は欠落行のみへ`legacy:nocodb:<record-id>`をPATCHする。既存キーの行は変更しない。

### S-003: キー競合を書込前に検出して停止する

採番予定キーが他行の既存キーと一致する場合、1件も書込まずにエラー終了する。

### S-004: apply後の再検証で完了を保証する

apply完了後に全行を再取得し、欠落行が0件でなければエラー終了して残数を報告する。

## Architecture decision

新しいADRは不要。本変更は`docs/architecture/ADR-016-canonical-task-single-writer.md`と
`docs/architecture/story-canonical-task-postgres-ssot.md`が定める移行前提の範囲内で、
移行元データの前提条件（冪等キー全行保有）を満たすための一回性の運用スクリプトである。
実行はrunbookの通り、writer排水後・移行workflow開始前に限定する。

## Release and rollback

- Operator: Brainbase本番運用者。
- Release: developへのマージのみ。コード配備に本番挙動の変更はない（スクリプトは手動実行）。
- 実行: runbook `docs/runbooks/canonical-task-cutover.md` before-enable手順0に従い、
  dry-run確認と明示承認の後にapplyする。
- Rollback: backfillは冪等キー列への追記のみで、Task本文を変更しない。誤採番時は
  `legacy:nocodb:`プレフィクスで対象行を特定して修正できる。
