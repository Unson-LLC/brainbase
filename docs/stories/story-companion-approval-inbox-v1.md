---
story_id: story-companion-approval-inbox-v1
title: Brainbase Companion Approval Inbox API v1
status: active
date: 2026-06-28
architecture_docs:
  - docs/architecture/companion-approval-inbox-architecture.md
spec_docs:
  - docs/specs/story-companion-approval-inbox-v1-spec.md
---

# Brainbase Companion Approval Inbox API v1

## 背景

Mac Companion は佐藤が日常的に見る即応面であり、Brainbase Web は Pack 設計、実行状況、監査証跡を確認する管理面である。Meeting Workflow Pack で `workflow_runs` が `waiting_human` になっても、Mac 側がそれを見られなければ「会議 -> 判断 -> タスク -> Decision -> Graph -> 学習 -> 次回会議」の一周は日常業務として閉じない。

既存の `GET /api/workflows` は workflow ごとの latest run を返すため、古い pending run が隠れる可能性がある。Mac Companion には、Workflow Mission Control の正本から「いま人間が止めている承認」を決定的に引ける API が必要である。

## ユーザーストーリー

佐藤として、Mac Companion だけを見れば Brainbase 上で自分の承認待ちになっている業務ループを把握したい。各項目では、何を承認するのか、承認するとどの正本や外部面に進むのか、根拠となる output は何かを確認し、必要なら Brainbase Web の run 詳細へ遷移したい。

## 受け入れ基準

- [ ] **ac:1 approval-inbox-route**: `GET /api/companion/approval-inbox` が pending human step を持つ workflow run を一覧化する。
- [ ] **ac:2 all-runs-not-latest-only**: 一覧は latest run に限定せず、`workflow_runs` 全体から pending approval を拾う。
- [ ] **ac:3 run-envelope**: 各 approval item は `run_id`, `workflow_id`, `project_id`, `status`, `action_required`, `pending_human_steps`, `outputs`, `audit_refs` を含む。
- [ ] **ac:4 human-step-contract**: `pending_human_steps` は `write_back_target`, `approval_kind`, `prompt`, `status` を含み、Mac 側が「承認すると何が起きるか」を表示できる。
- [ ] **ac:5 output-contract**: `outputs` は `output_type`, `title`, `summary`, `payload`, `metadata` を含み、Mac 側が承認対象の本文や候補を表示できる。
- [ ] **ac:6 companion-auth**: missing auth / browser cookie-only auth は既存 companion guard と同じ方針で拒否される。
- [ ] **ac:7 reply-route-compatibility**: 既存の `/api/companion/reply-context` と `/api/companion/reply-draft` は互換性を維持する。
- [ ] **ac:8 context-evidence-contract**: 各 approval item は `owner_id`, `action_kind`, `context`, `evidence`, `web_url`, `web_route` を含み、Mac 側だけで判断文脈と根拠を確認し、必要なら Brainbase Web の run detail へ遷移できる。また pending approval が response `limit` を超える場合は、返却されない全件数を `has_more` と `omitted_count` で明示する。

## 影響面と検証方針

- 入力経路: `GET /api/companion/approval-inbox` の bearer/service/internal native request。
- 既存経路: `POST /api/companion/reply-context` と `POST /api/companion/reply-draft` は route 登録と service 依存を維持する。
- 正本データ: `workflow_runs`, `workflow_human_steps`, `workflow_outputs`, `workflow_context_snapshots`, `workflow_audit_logs` は読み取りのみ。承認 resolve や writeback は実行しない。
- 出力面: Mac Companion が読む JSON projection と、必要時に Brainbase Web の既存 Workflow Mission Control run detail へ戻る `web_url` / `web_route`。
- UX/E2E: Mac Companion 側の一覧・承認 UI は companion repo の `story-mac-companion-approval-focus-queue-v1` で扱う。Brainbase 側では API integration test、companion reply route の互換テスト、`/workflows?run_id=...` が Run Trace を開く deep-link E2E を証跡とする。

## スコープ外

- Mac Companion UI の詳細実装。
- Brainbase Workflow Mission Control の新規UI/全体再設計。
- Slack/Gmail/Graph への自動書き戻し。
- 承認時の output 編集差分の永続化。
