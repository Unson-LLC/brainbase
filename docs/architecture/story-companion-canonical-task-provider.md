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

## SSOT

- 正本テーブルはbase `pva7l2qlu6fdfip`、table `m7iys8m7o1abr3f` の `タスク` に固定する。
  client requestや複数project mappingから選択しない。環境上書き時も起動時に一組へ確定し、mapping不在・不一致はfail-closedにする。
- 正本storeのproject/owner scopeは `brainbase` / configured Personal KG ownerである。
  Task IDはstore schema versionと固定storeを結合した署名付きopaque IDとし、別store IDを拒否する。
- `担当者PersonID` が権威ある担当者識別子で、既存 `担当者` は表示互換用の投影である。
- 既存行で `担当者PersonID` が空の場合は `assignee_person_id: null` と
  `normalization_warnings: ["assignee_unresolved"]` を返す。文字列一致で補完しない。
- 正規化APIが作る行には版、発生元参照、冪等キーとfingerprint、期限日時、待ち情報、完了日時を保存する。

## API構成

- `GET /api/companion/tasks`
- `GET /api/companion/tasks/:taskId`
- `POST /api/companion/tasks`
- `PATCH /api/companion/tasks/:taskId`
- `POST /api/companion/tasks/:taskId/transitions`

既存 `createCompanionRouter` の認証・owner guardを再利用する。owner credentialはserver-sideで
configured ownerへscopeし、別person filter/assignmentを403にする。service/internal credentialは
固定store内でGraph確認済みpersonを扱えるが、store/projectは変更できない。actorとauth sourceを監査する。

## 一度だけ作成

1. `resolveHumanStep` がapproved要求と `write_back_target=task_store` を検出する。
2. human stepのoutputからTask候補を取得する。
3. `id|candidate_id` とGraph確認済み `selected_owner_id` を持つresolved/already_selected object候補だけを受理し、legacy文字列、unresolved、ambiguous、ignored候補があれば理由付き409でpendingに残す。
4. `workflow-output:<outputId>:<candidateFingerprint>:<ordinal>` を並べ替えに安定した冪等キーとして全候補を作成する。
5. 1件ごとにTask IDをPostgres operation resultへcheckpointし、human step metadataへ互換投影する。全件成功後にphaseを進めてapprovedへ遷移する。
6. 応答はトップレベル `materialized_task_ids` と詳細materializationを返す。
7. 再要求でstepがapprovedなら保存済みまたは冪等keyから復元した同じ結果を返す。

NocoDB作成後にプロセスが停止しても、再試行は冪等キーで既存行を取得する。Task作成に
失敗した場合はhuman stepをpendingのまま残す。Workflow ledgerのtransactionは外部NocoDBを
巻き戻せないため、補償ではなく冪等な前進回復を採用する。

## 競合制御と永続調停

Postgres `canonical_task_operations` を実行調停台帳として使い、`(scope, operation_key)` のunique制約、
owner token、lease、fencing generation、fingerprint、result JSON、後処理phaseを保存する。Task本文や
状態は保存しないため、Taskの正本はNocoDBのままである。ただしleaseは外部書き込みを停止できないため、
createの最終防衛はNocoDB正本表の `冪等キー` DB一意制約が担う。

- createはidempotency key、update/transitionは共通scopeの`taskId:expectedVersion`、承認はstep IDをclaimする。
- claim取得後に現行Task版を再読込し、一致時だけNocoDBへ書く。変更patchには次版、最終操作key、fingerprintを含める。
- worker停止時はlease満了後にgenerationを増やして別processが引継ぎ、全checkpointは最新token/generationを要求する。
- 遅延した旧workerのcreateはNocoDB uniqueで同じ行へ収束し、mutationは同じ操作markerを同じrowへ書く。異なるfingerprintはoperation claim時に409となる。
- Postgres台帳が利用不能なら503にし、process内Mapだけで正しさを代替しない。

これにより同一・複数Brainbase processの並行POST、同一版更新、同一step承認を同じ方式で制御する。

## 前進回復

| 停止点 | 回復 |
|---|---|
| 一部Task作成後 | deterministic keyで既存Taskを回収し、残りを続行 |
| create成功後・checkpoint前 | operation結果またはNocoDB unique key照会からIDを復元 |
| 全ID保存後・approved前 | 外部createをせずapprovedへ進む |
| approved後・audit/run更新前 | Postgres phase/resultを返し、最新fenceを確認して未完了の後処理だけ再実行 |
| approvedだがIDなし | 全keyから復元できる場合だけmetadata修復。不足時は409で手動確認 |
| 同時approve | destination uniqueとstep claimで同一結果へ収束し、他方は同じ完了結果を読む |

## 選択肢と決定理由

- NocoDBだけのlookup-then-createは並行要求を原子的に止められないため棄却した。
- operation leaseだけの案は、leaseを失ったworkerの遅延NocoDB書き込みをfenceできないため棄却した。
- process内mutexは再起動・複数processを跨げないため補助最適化に限定した。
- TaskをPostgresへ複製する案はSSOTを増やすため棄却した。
- Task本文を持たない永続operation ledgerは既存NocoDB正本を保ちつつ、並行実行と回復を閉じられるため採用した。

運用責任はBrainbase serverが持つ。release前にPostgres schema、NocoDB列と冪等キー一意制約、固定storeをcheckし、
不足時はTask書き込み経路を停止する。障害復旧はoperation状態とNocoDB idempotency keyを照合して前進する。

release順序はPostgres operation schema、NocoDB列/unique、Brainbase API、実契約確認、Macの順とする。
両migrationは`--apply`と`--check`を提供し、NocoDB metadata APIでDB一意制約を保証できない環境は
fail-closedにして、基盤DB側の管理migrationを別途完了させる。

## 障害方針

- NocoDB未設定・通信失敗: `503 task_store_unavailable`
- Graph未確認・通信失敗: `503 assignee_directory_unavailable`
- person不存在: `422 invalid_assignee_person_id`
- 版不一致: `409 version_conflict` とcurrent Task
- 冪等キー再利用の内容不一致: `409 idempotency_conflict`

空配列、自由入力への退避、承認だけ先に進める処理は行わない。
