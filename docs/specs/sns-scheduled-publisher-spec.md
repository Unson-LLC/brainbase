---
spec_id: SPEC-sns-scheduled-publisher
title: SNS予約投稿の実行者 Specification
status: draft
date: 2026-05-14
story_id: str.brainbase.sns-scheduled-publisher
related_specs:
  - SPEC-sns-posting-engine
implementation_files:
  - server/services/sns/sns-scheduled-publisher.js
  - scripts/run-sns-scheduled-posts.js
test_files:
  - tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js
  - tests/sns/ops/run-sns-scheduled-posts.test.js
---

# SPEC: SNS予約投稿の実行者

## Invariants

- **INV-1**: runnerはSNS Posting Ledgerから `status=scheduled` かつ `scheduled_at <= now` の投稿だけをdue postとして扱う。
- **INV-2**: runnerは公開投稿が明示的に有効化されていない場合、X投稿スクリプトを呼ばない。
- **INV-3**: runnerは手動投稿と同じ `SnsLedgerPublishService` 経路を使い、独自のX投稿経路を持たない。
- **INV-4**: runnerは冪等であり、同じLedger rowを二重投稿しない。
- **INV-5**: `scheduled_at` の比較はJST/UTCの扱いを実装とテストで明示する。
- **INV-6**: 投稿失敗はUIで再確認できる状態としてLedgerに残し、黙って破棄しない。
- **INV-7**: dry-runはdue-post選択だけを検証し、X投稿スクリプトを呼ばない。

## Contracts

### Contract-1: Scheduled Publisher

- **input**: `now`, `dry_run`, `auto_publish_enabled`, `actor`
- **output**: `{ scanned, due, posted, skipped, failed, dry_run }`
- **preconditions**: 投稿対象はSNS Posting Ledgerに存在し、statusが `scheduled` である。
- **postconditions**: 成功した投稿は `posted`、失敗した投稿はレビュー可能な失敗状態または失敗metadata付きの状態になる。
- **error cases**: X投稿スクリプト失敗、account利用不可、時刻変換不正、同時実行競合。

### Contract-2: Deployment Entry Point

- **input**: CLIまたはlaunchd/cronからの定期実行。
- **output**: 実行サマリーとログ。
- **preconditions**: 本番公開投稿には明示設定が必要である。
- **postconditions**: due postの結果がLedgerとログに残る。

## Scenarios

### S-1: 期限到来した予約投稿を投稿する

- **given**: `status=scheduled` かつ `scheduled_at <= now` の投稿がある。
- **when**: runnerを公開投稿有効で実行する。
- **then**: `SnsLedgerPublishService` 経由で投稿され、Ledgerは `posted` と `posted_url` を持つ。

### S-2: 公開投稿が無効なら投稿しない

- **given**: due postがある。
- **when**: `auto_publish_enabled=false` でrunnerを実行する。
- **then**: X投稿スクリプトは呼ばれず、投稿はskipとして記録される。

### S-3: 同時実行でも二重投稿しない

- **given**: 同じdue postに対してrunnerが同時に起動する。
- **when**: 両方がdue-post処理を試みる。
- **then**: 片方だけが投稿し、もう片方はstatus変化を検知してskipする。

### S-4: dry-runで選択だけ確認する

- **given**: due postがある。
- **when**: `dry_run=true` でrunnerを実行する。
- **then**: due件数は返るが、X投稿スクリプトとLedger mutationは実行しない。

### S-5: 投稿失敗を見える状態に残す

- **given**: due postがある。
- **when**: X投稿スクリプトまたはaccount確認が失敗する。
- **then**: 失敗理由がLedgerに残り、SNS UIからレビュー/再実行判断ができる。

## Anti-patterns

- **AP-1**: runnerが `SnsLedgerPublishService` を迂回してX投稿スクリプトを直接呼ぶ。
- **AP-2**: `approved` の投稿をrunnerが自動投稿する。
- **AP-3**: 自動投稿フラグなしで本番投稿する。
- **AP-4**: 失敗した投稿をUIから見えない状態にする。
- **AP-5**: JST/UTCを暗黙に扱い、slot時刻と実行時刻がずれる。

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1, S-1 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | Planned |
| INV-2, S-2, AP-3 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | Planned |
| INV-3, AP-1 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | Planned |
| INV-4, S-3 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | Planned |
| INV-5, AP-5 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | Planned |
| INV-6, S-5, AP-4 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | Planned |
| INV-7, S-4 | tests/sns/ops/run-sns-scheduled-posts.test.js | Planned |
