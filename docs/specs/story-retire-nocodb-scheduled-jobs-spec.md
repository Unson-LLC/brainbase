---
spec_id: SPEC-story-retire-nocodb-scheduled-jobs
title: NocoDB専用定期処理退役 Spec
status: draft
date: 2026-09-20
story_id: story-retire-nocodb-scheduled-jobs
implementation_files:
  - scripts/daily-snapshot.js
  - scripts/send-story-alerts.js
  - scripts/send-story-progress-to-slack.js
  - .github/workflows/daily-snapshot.yml
  - .github/workflows/daily-story-alerts.yml
  - .github/workflows/weekly-story-progress.yml
  - docs/guides/github-actions-cicd-operating-guide.md
test_files:
  - tests/server/scripts/nocodb-scheduled-jobs-retirement.test.mjs
---

# SPEC: NocoDB専用定期処理退役

## Invariants

- **INV-1**: 専用スナップショット、ストーリーアラート、ストーリー進捗の各スクリプトとスケジュールWorkflowは存在しない。
- **INV-2**: 現行の共有`server.js`、Canonical Taskサービス、companionルートは存在し、退役対象の削除で変更されない。
- **INV-3**: `.github/workflows` の現行Workflowは退役対象のスクリプトを実行しない。
- **INV-4**: 退役契約テストはNode.js組み込み`node:test`だけで実行でき、ネットワーク・DB・外部送信を行わない。

## Change boundary

削除対象は次の6ファイルに限定する。

- `scripts/daily-snapshot.js`
- `scripts/send-story-alerts.js`
- `scripts/send-story-progress-to-slack.js`
- `.github/workflows/daily-snapshot.yml`
- `.github/workflows/daily-story-alerts.yml`
- `.github/workflows/weekly-story-progress.yml`

運用ガイドには、NocoDB専用の3系統が退役済みであることを記録する。既存の共有NocoDBサービス、Slack共通処理、migration script、履歴監査文書は変更しない。

## Verification

| Clause | Test |
|---|---|
| INV-1 | `tests/server/scripts/nocodb-scheduled-jobs-retirement.test.mjs` の削除対象存在確認 |
| INV-2 | 同テストの共有サーバー経路確認 |
| INV-3 | 同テストのWorkflow参照確認 |
| INV-4 | `node --test tests/server/scripts/nocodb-scheduled-jobs-retirement.test.mjs` |
