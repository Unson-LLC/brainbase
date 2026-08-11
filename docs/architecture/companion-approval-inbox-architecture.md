---
title: Companion Approval Inbox Architecture
status: active
date: 2026-06-28
story_id: story-companion-approval-inbox-v1
---

# Companion Approval Inbox Architecture

## 境界

`GET /api/companion/approval-inbox` は、Brainbase の Workflow Mission Control から Mac Companion 向けに承認待ちだけを投影する native/server-to-server API である。正本は引き続き `workflow_runs`, `workflow_human_steps`, `workflow_outputs`, `workflow_audit_logs` に残る。Mac Companion は承認キューの表示面であり、正本 DB ではない。

## コンポーネント

- Route: `server/routes/companion.js`
- Controller: `server/controllers/companion-controller.js`
- Service: `server/services/companion/approval-inbox-service.js`
- Repository: `server/services/workflow/workflow-repository.js`
- Data: `var/workflow-ledger.json`

## データフロー

1. Mac Companion が Brainbase bearer/service/internal credential で `/api/companion/approval-inbox` を呼ぶ。
2. Companion access guard が native/server-to-server 境界と owner access を検証する。
3. `CompanionApprovalInboxService` が `workflow_runs` 全体を走査し、pending の `workflow_human_steps` を持つ run を抽出する。
4. 各 run に対して `outputs`, `audit_logs`, `context_snapshots` を読み、Mac 表示用の Approval Item に正規化する。
5. API は `items` と `count` を返す。Mac はこれを Focus Queue として Inbox に統合する。

## 設計判断

- 廃止前の`GET /api/workflows` latest-run projectionを流用しない。専用approval projectionを正本とし、古いpending runを隠さない。
- Brainbase approval を Gmail/Slack の `SourceEvent` に変換しない。承認対象は外部メッセージではなく Workflow 正本である。
- API は承認対象の raw output payload を含める。Mac 側で「承認前に本文を読める」ことが UX 上の必須条件である。
- Resolve は既存の `POST /api/workflow-runs/:runId/human-steps/:stepId/resolve` を正とする。Companion 専用 resolve は v1 では追加しない。

## 安全性

この API は表示用 projection であり、外部送信、Graph 昇格、Task 作成、Decision 作成を直接実行しない。実際の承認は既存 human step resolve API を通り、audit log に残る。
