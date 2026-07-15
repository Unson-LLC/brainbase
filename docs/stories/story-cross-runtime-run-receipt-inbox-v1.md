---
story_id: story-cross-runtime-run-receipt-inbox-v1
title: Cross-runtime run receipt inbox v1
status: active
created_at: 2026-07-15
updated_at: 2026-07-15
horizon: quarter
view: business
period: 2026Q3
architecture_docs:
  - docs/architecture/ADR-016-run-receipt-control-plane-boundary.md
  - docs/architecture/story-cross-runtime-run-receipt-inbox-v1.md
spec_docs:
  - docs/specs/cross-runtime-run-receipt-inbox-v1.md
---

# Cross-runtime run receipt inbox v1

## 背景

Mana、Codex Automations、GitHub Actions、SalesTailorでは自動実行が増えているが、成否・停止理由・証跡の見え方がランタイムごとに分断されている。そのため、実行されていない状態を「0件」、証拠未取得を「成功」と誤認しやすく、人間が確認すべきrunを横断して発見できない。

BrainbaseにはWorkflow Mission Controlのrun台帳があり、Eve向けには詳細な `external_runner.v0` がある。4ソースの運用結果を集約するためにEve専用契約を流用すると、Role Agent、round、learning candidateなど不要な責務まで各connectorへ強制してしまう。

## User Story

Brainbase operatorとして、異なるruntimeの最終実行結果を同じAgent Run Inboxで確認したい。なぜなら、失敗、blocked、人間待ち、未確認、no dataをゼロ件や成功から区別し、次に人間が介入すべきrunへ優先順で到達したいから。

## Business Outcome

- 対象ユーザー: 複数runtimeの自動実行を監督するBrainbase operator。
- 課題: sourceごとの画面やログを巡回しないと、停止中のrunと証拠未取得runを区別できない。
- 成功状態: 4ソースの最終runを1つのInboxで優先順に確認し、blocked、failed、waiting human、unconfirmed、no dataへ到達できる。
- 主要KPI: sourceごとの手動巡回をせずに、要介入runの100%がAgent Run Inboxの上位に現れる。
- 運用指標: `blocked|failed|waiting_human` のreceiptについて、actionまたはblocker理由の欠落を0件に保つ。
- 優先度: 4 connector Storyの前提となる共通契約なので最優先。

## Acceptance Criteria

- [ ] ac:1 `run_receipt.v1` はsource、project、workflow、external run identity、run status、evidence stateを必須検証し、不正なreceiptを保存前に拒否する。
- [ ] ac:2 同じ `project_id + source.type + external_run_id` の再送は既存runを返すduplicateとなり、別projectまたは別sourceの同じexternal run idは別runとして保存される。
- [ ] ac:3 receiptはWorkflow Mission Controlのworkflow runへ投影され、sourceの `run_status` と `evidence_state` を失わない。
- [ ] ac:4 `success`、`failed`、`blocked`、`waiting_human`、`cancelled` を区別し、`unconfirmed` と `no_data` を成功または0件へ潰さない。
- [ ] ac:5 Agent Run Inboxはaction required、failure、blocked、unconfirmed/no_dataを決定的な優先順位で返し、source/project/status/evidence stateで絞り込める。
- [ ] ac:6 raw logや顧客本文は複製せず、証跡はsource-owned URLまたはartifact referenceとして保存する。
- [ ] ac:7 ingest認証はserver-to-server credentialを要求し、認証主体がアクセスできないprojectへのreceiptを拒否する。
- [ ] ac:8 receipt deliveryの成否とsource runの成否を別フィールドとして扱い、delivery成功をrun成功と解釈しない。

## Workflow State Scenarios

- `workflow state transition`: source `success` はBrainbase `success / closed / none` へ写る。ただし `evidence_state=unconfirmed|no_data` はInboxで確認対象として残る。
- `workflow state transition`: source `failed` は `failed / needs_action / check_error` へ写る。
- `workflow state transition`: source `blocked` は `needs_action / needs_action / resolve_blocker` へ写る。
- `workflow state transition`: source `waiting_human` は `waiting_human / open / review_run` へ写る。
- `workflow state transition`: source `cancelled` は `cancelled / closed / none` へ写り、successに含めない。
- `workflow retry matrix`: 同じproject/source/external run idで同一payloadの再送はduplicate、内容が異なる再送はconflictとして拒否する。
- `workflow rollback guard`: contract、auth、project、idempotency conflictの検証が失敗した場合、workflow runやauditを部分保存しない。

## Failure Modes

- `schema_failure`: 未定義status/evidence state、空のidentity、壊れたevidence refは400で拒否する。
- `auth_denied`: cookieだけのbrowser requestやproject非許可credentialは403で拒否する。
- `source_unavailable`: connectorがsourceへ接続できない場合は0件ではなくblockedまたはno_data/unconfirmedのreceiptとして表現する。
- `delivery_failure`: connector側outbox/retryで扱い、Brainbaseに届いたreceiptのsource run statusを書き換えない。

## 非目標

- 4ソース固有のAPI接続・schedule・outbox実装は各connector Storyで扱う。
- Eve向け `external_runner.v0` を置き換えない。
- raw logs、顧客返信、transcriptをBrainbaseへ複製しない。
- receiptからGraph SSOTへ自動学習・自動昇格しない。
