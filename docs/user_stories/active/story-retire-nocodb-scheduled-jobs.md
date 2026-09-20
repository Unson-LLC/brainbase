---
story_id: story-retire-nocodb-scheduled-jobs
title: NocoDB専用の定期処理を退役させる
status: active
created_at: 2026-09-20
---

# NocoDB専用の定期処理を退役させる

利用者はNocoDBを利用していないため、専用のスナップショット・ストーリー通知・進捗通知の定期処理をリポジトリから退役させたい。この変更では共有サーバーとCanonical Task APIを変更しない。

## 受け入れ条件

- 3つの専用スクリプトと、それらだけを起動する3つのスケジュールWorkflowが存在しない。
- 現行の共有サーバーとCanonical Taskのサービス経路は存在し、変更しない。
- 退役対象を呼び出す現行Workflow参照が残らない。
- 退役境界を依存なしの`node:test`で検証し、既存の退役契約CIから実行する。
- 運用ガイドから対象の定期処理を退役済みとして更新する。
- データ削除、NocoDB/Slackへの接続、Workflowの無効化、外部送信は行わない。

仕様: `docs/specs/story-retire-nocodb-scheduled-jobs-spec.md`
