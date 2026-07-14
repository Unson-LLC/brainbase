---
title: Companion Canonical Task Provider Architecture
status: proposed
date: 2026-07-14
story_id: story-companion-canonical-task-provider
---

# Companion Canonical Task Provider Architecture

## 決定

Brainbaseプロジェクトの既存NocoDB Task表を個人Taskの正本として維持し、その上に
`CanonicalTaskService` を置く。Mac CompanionとWorkflow承認は必ずこのserviceを経由し、
NocoDBの自由入力列を直接Task権限として扱わない。

## 所有境界

| 層 | 所有するもの | 所有しないもの |
|---|---|---|
| Mac Companion | 一覧・入力・状態操作・エラー回復UI | Task正本、人物名寄せ、監査 |
| Companion Task API | 認証、入力検証、HTTP契約 | Taskの別保存 |
| CanonicalTaskService | 状態遷移、People ID検証、冪等性、版競合、監査 | UI |
| NocoDB Task repository | 既存Task表の永続化と検索 | 人物同定、業務判断 |
| Graph SSOT | `person_id` と表示名 | Task状態 |
| WorkflowService | 承認順序と再試行 | 独自Task作成ロジック |

## 正本と投影

- 正本テーブルはBrainbase mappingの `タスク`。Mac専用のJSON/SQLite/別NocoDB表は作らない。
- `担当者PersonID` が権威ある担当者識別子で、既存 `担当者` は表示互換用の投影である。
- 既存行で `担当者PersonID` が空の場合は `assignee_person_id: null` と
  `normalization_warnings: ["assignee_unresolved"]` を返す。文字列一致で補完しない。
- 正規化APIが作る行には版、発生元参照、冪等キーとfingerprint、期限日時、待ち情報、完了日時を保存する。

## API構成

- `GET /api/companion/tasks`
- `POST /api/companion/tasks`
- `PATCH /api/companion/tasks/:taskId`
- `POST /api/companion/tasks/:taskId/transitions`

既存 `createCompanionRouter` の認証・owner guardを再利用する。Task IDはNocoDB record IDを
外部契約へ直接露出させない不透明IDとして符号化し、repositoryだけが復号する。

## 一度だけ作成

1. `resolveHumanStep` がapproved要求と `write_back_target=task_store` を検出する。
2. human stepのoutputからTask候補を取得する。
3. `human-step:<stepId>:candidate:<index>` を冪等キーとして全候補を作成する。
4. 全件成功後にTask ID群をhuman step metadataへ保存し、approvedへ遷移する。
5. 再要求でstepがapprovedかつTask ID群がある場合は、競合ではなく同じ結果を返す。

NocoDB作成後にプロセスが停止しても、再試行は冪等キーで既存行を取得する。Task作成に
失敗した場合はhuman stepをpendingのまま残す。Workflow ledgerのtransactionは外部NocoDBを
巻き戻せないため、補償ではなく冪等な前進回復を採用する。

## 競合制御

更新は `expected_version` と保存済み `Version` の一致を確認し、成功時に1増やす。同一
Brainbaseプロセス内ではTask ID単位で直列化する。NocoDB自体にCASがないため、複数の
Brainbase writerを同時稼働させないことを運用前提とし、将来複数writer化する際はDB側CASへ
置き換える。

## 障害方針

- NocoDB未設定・通信失敗: `503 task_store_unavailable`
- Graph未確認・通信失敗: `503 assignee_directory_unavailable`
- person不存在: `422 invalid_assignee_person_id`
- 版不一致: `409 task_version_conflict` とcurrent Task
- 冪等キー再利用の内容不一致: `409 idempotency_conflict`

空配列、自由入力への退避、承認だけ先に進める処理は行わない。

