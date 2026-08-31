---
story_id: story-t0-slack-installation-failure-diagnostics
title: Slack installation失敗を秘密なしで段階別に再読込できる
spec_docs:
  - docs/specs/story-t0-slack-installation-failure-diagnostics.md
status: done
t0_program_status: implementing
created_at: 2026-08-31
updated_at: 2026-08-31
---

# Slack installation失敗を秘密なしで段階別に再読込できる

## Story

T0の運用担当者として、Slack installation callbackが失敗したとき、authorization code、token、credential ref、upstream responseを保存せずに、失敗段階・安定した失敗コード・cleanup結果を同じintentのledgerから再読込したい。これにより将来の失敗を安全に原因分離できるようにする。ただし過去のgeneric failureを推測で分類せず、local contract evidenceをproduction E2Eの代替にしない。

## 受け入れ基準

- [x] AC-001: `oauth_exchange | exchange_normalize | connection_reserve | credential_store | db_register` の固定段階を保存する。
- [x] AC-002: adapter由来の既知失敗はallowlist済みstable codeへ変換し、unknown・偽装codeはstage別generic codeへ閉じる。
- [x] AC-003: cleanup結果を `not_needed | revoked | failed` で保存し、revoke失敗を成功へ丸めない。
- [x] AC-004: internal repository readbackはintent/tenant/request digest/attempt/stage/code/cleanupだけを返し、raw code、token、credential ref、upstream bodyを返さない。
- [x] AC-005: public routeの応答契約は変更せず、internal diagnosticを公開しない。
- [x] AC-006: focused unit/schema testsが通り、production実行・deploy・OAuth retryは行われていない。

## ローカル検証証跡

- 変更面単体・schema: 6 files / 80 tests pass
- 実PostgreSQL integration: 3 files / 15 tests pass
- TypeScript typecheck、対象ESLint、Task JSON parse、`git diff --check`: pass
- 独立レビュー: PASS、blocking 0
- production execution / deploy / OAuth retry / secret参照: 0回

## 完了境界

このStoryが完了してもT0 Programは`implementing`のまま。本番bridge、OAuth、PostgreSQL、credential store、UsageEvent/OperationReceiptのsame-run readbackは`not_collected`であり、過去2件の`INSTALLATION_EXCHANGE_FAILED`のroot causeは復元不能である。
