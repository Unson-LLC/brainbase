---
story_id: story-brainbase-routine-liveness
title: Brainbase記憶ルーティンの生存確認
status: ready_for_review
created_at: 2026-08-13
updated_at: 2026-08-13
architecture_docs:
  - docs/architecture/brainbase-routine-liveness-architecture.md
spec_docs:
  - docs/specs/brainbase-routine-liveness-spec.md
---

# Brainbase記憶ルーティンの生存確認

## 背景

`/ohayo`、`/oyasumi`、`/retro`は定期実行されていても、実行ID付きRun ReceiptがBrainbaseへ届かなければ、停止と正常な0件を区別できない。現在はsource run identityが欠けたconnector observationが残り、ループが静かに停止できる。

## User Story

Brainbase operatorとして、記憶ルーティンが期限内に完了し、必要な成果物を残したかを自動判定したい。なぜなら、停止した第二の脳を翌朝まで正常に見せたくないから。

## Acceptance Criteria

- [x] 3ルーティンの期待実行時刻、猶予時間、必須成果物が機械可読な正本にある。
- [x] 実行時は`CODEX_THREAD_ID`をsource run identityとして使い、Run Receiptの`project_id`は常に`brainbase`になる。
- [x] Receipt送信不能時は永続Outboxへ残り、5回失敗後にDead Letterへ移る。
- [x] 猶予時間を超えてReceiptがないルーティンと、Dead Letterがあるルーティンを成功や0件にしない。
- [x] `/ohayo`向け診断は要介入の異常を最大3件、決定的な順序で返す。
- [x] `ohayo`と`oyasumi`は20分、`retro`は60分の猶予時間を使う。

## 運用確認

31013の実環境でのReceipt送信、異常投影、3ルーティン7回連続実行は、ランタイム反映後の運用完了条件として別途確認する。
