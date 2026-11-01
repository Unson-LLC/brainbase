# owner決定記録

Story ID: `story-mcp-queue-task-tools-v1`

- 日時: 2026-11-01 18:19 JST
- 決定者: owner
- 原文: 「brainbase#929 は get_task と claim_task を足した7つで進めてよい」

## 確定したこと

- 公開queue toolsは7つ: `list_my_tasks` / `get_task` / `claim_task` / `claim_next` / `renew_claim` / `attach_evidence` / `update_status`。
- backend注入時に7 toolsを登録する（AC-1）。
- 追加テスト`AC-2 reads an approved task by id`と`AC-4 claims an approved task by id without duplicates`は必ず追加する。
- read / writeを1つの実装PRにまとめてよい。

## 未確認のまま残ること

- `get_task` / `claim_task`のサーバー側専用APIの形（host adapterの契約として扱う）。
- 自身に未割当だがassignableなTaskをlistに含めるか。
- Specの未確認事項2〜5（応答schema、durable replay、principal binding、test subpath配布と段階公開の可否）。
- 状態はPlanned / Unreleased。実装は未着手。
