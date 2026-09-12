---
story_id: parent-contract-delegation
title: 子エージェントが親の判断契約の委任範囲で作業できる
status: active
architecture_docs:
  - path: docs/architecture/ADR-parent-contract-delegation.md
    status: referenced
    reason: 親が判断と最終監査を所有し、子は実行結果を親へ返す責任境界を定める。
---

利用者として、親が判断した作業を子に委任したとき、子にも独立した開始処理を要求されて止まることなく、親が結果を集約して回答できるようにしたい。

## Acceptance Criteria

- Hostの親子情報と子turnへの委任メッセージを照合した子は独立Resolverなしで作業できる。
- 未解決・終了済みの親、偽装・不明・対象外の委任は拒否する。
- 子の実行結果は親契約へ紐付け、親の判断完了や必須能力の達成を代行しない。
- 子の完了はCodexの既存通知を親が確認する。専用の終了記録を要求せず、利用者向け最終監査は親だけが確定する。

対象は同一リポジトリの直接の子。通常の権限・承認は維持する。自然言語の委任範囲をHookが意味分類する仕組みは追加しない。

Spec: [判断契約](../specs/parent-contract-delegation.vibepro.json)

今回の変更方針: SIMPLIFICATION。実機でCodexの完了通知と親への報告を確認済みのため、重複する子専用終了記録を削除する。親子照合と通常の権限は維持する。
