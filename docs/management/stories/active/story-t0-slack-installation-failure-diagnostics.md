---
story_id: story-t0-slack-installation-failure-diagnostics
title: Slack installation失敗を秘密なしで段階別に再読込できる
spec_docs:
  - docs/specs/story-t0-slack-installation-failure-diagnostics.md
architecture_docs:
  - docs/architecture/story-t0-slack-installation-failure-diagnostics.md
status: done
t0_program_status: implementing
created_at: 2026-08-31
updated_at: 2026-09-03
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
- [x] AC-006: focused unit/schema testsとlocal composed E2Eが通る。composed E2Eはbootstrap→auth/CSRF→authorize/exchange→OAuth・credential adapter→PostgreSQL failure readbackを単一経路で通し、operator readbackの現行受入境界はrepository-levelとする。public diagnostic API/UI、production実行・deploy・OAuth retryは含めない。

## ローカル検証証跡

- VibePro unit verification: 4 files / 60 tests pass
- VibePro integration verification: 4 files / 56 tests pass（実PostgreSQLのfailed write/readback、composed local flow、旧台帳からの冪等migrationを含む）
- VibePro typecheck verification、対象ESLint、Task JSON parse、`git diff --check`: pass
- exact HEAD、実行時刻、出力digest、作業ツリー不変性は `.vibepro/pr/story-t0-slack-installation-failure-diagnostics/verification-runs/` と `verification-evidence.json` を正本とし、このStory本文へ固定SHAを複製しない。
- 独立レビューは現行HEADごとに `.vibepro/reviews/story-t0-slack-installation-failure-diagnostics/` へ記録し、古いHEADの結果を再利用しない。
- production execution / deploy / OAuth retry / secret参照: 0回

## 完了境界

このStoryが完了してもT0 Programは`implementing`のまま。local composed flowのoperator readbackはrepository-levelに限られる。本番bridge、OAuth、PostgreSQL、credential store、UsageEvent/OperationReceiptのsame-run readbackは`not_collected`であり、過去2件の`INSTALLATION_EXCHANGE_FAILED`のroot causeは復元不能である。
