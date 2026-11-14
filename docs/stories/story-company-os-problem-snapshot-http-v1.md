---
story_id: story-company-os-problem-snapshot-http-v1
title: 信頼できる文脈から問題のスナップショットを作り、読み戻せる
status: in_progress
created_at: 2026-10-02
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-reservation-api-v1"]
external_dependencies: []
---

# 信頼できる文脈から問題のスナップショットを作り、読み戻せる

## 利用者成果

組織版や別のHTTPホストの開発者として、判断の対象（目的・基準・観測・モデル・制約・権限・資源・期限の参照）を固定した問題のスナップショットを、HTTPで作って同じIDで読み戻したい。予約と実行開始はこのスナップショットの照合が必須だが、これまで作る公開の入口が無かった。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: `@unson/brainbase-mcp/judgment-problem-snapshot-http`

保存・読み取り・参照の照合は既存の `saveJudgmentProblemSnapshot`・`loadJudgmentProblemSnapshot` が持つ。この入口は、認証済みの主体と、ホストが束ねる参照の照合（Foundationの読み取りなど）を渡すだけにする。

## 受入条件

- [x] AC-01: `POST /judgment-problem-snapshots` は本文の `snapshot` を保存し、受領（`snapshot_id`・`status`）を返す。同じ内容の再送は `existing` を返す。
- [x] AC-02: `GET /judgment-problem-snapshots/{snapshot_id}` は、今の参照で照合したスナップショットを返す。
- [x] AC-03: 主体はホストの文脈からだけ受け取る。本文の余計な項目は400、未認証は401、変更の出どころが確かめられなければ403。
- [x] AC-04: 読み取り方針の外の主体は、保存も読み取りもできない。参照が欠ける・照合できないときは保存しない。
