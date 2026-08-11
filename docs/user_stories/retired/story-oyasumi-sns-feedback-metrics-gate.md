---
story_id: story-oyasumi-sns-feedback-metrics-gate
title: Oyasumi SNS feedback metrics gate
status: retired
owner: sato_keigo
retired_reason: 2026-08-11に日次ルーティンをBrainbase内の判断・Run Receipt・Personal KGへ限定し、SNS取得を責務外にしたため。
---

# Oyasumi SNS feedback metrics gate（廃止）

このStoryは`/oyasumi`がSNS metrics pollingとfeedback learningを直接実行する契約を定義していた。

現在の`/oyasumi`は外部サービスを直接巡回しない。SNS metrics capability自体の実装と履歴は残すが、日次ルーティンからは呼び出さない。現行の正本は`.claude/commands/oyasumi.md`を参照する。
