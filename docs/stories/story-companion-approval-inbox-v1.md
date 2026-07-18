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

Mac Companionは佐藤が日常的に見る即応面である。Brainbaseの管理・診断はCodex/Claude CodeからMCPで行い、Brainbase Webはlogin、interactive consent、bootstrap、pairing、break-glass recoveryへ縮小する。Meeting Workflow Packで`workflow_runs`が`waiting_human`になっても、Mac側がそれを見られなければ「会議 -> 判断 -> タスク -> Decision -> Graph -> 学習 -> 次回会議」の一周は日常業務として閉じない。

当初の`GET /api/workflows` latest-run projectionでは古いpending runが隠れる可能性があったため、Mac Companionには「いま人間が止めている承認」を決定的に引ける専用APIを追加した。汎用Workflow一覧APIの廃止後も、この専用projectionを正本として維持する。

## ユーザーストーリー

佐藤として、Mac Companionだけを見ればBrainbase上で自分の承認待ちになっている業務ループを把握したい。各項目では、何を承認するのか、承認するとどの正本や外部面に進むのか、根拠となるoutputは何かを確認し、詳細な管理・診断が必要ならCodex/Claude Codeへ引き継ぎたい。

## 受け入れ基準

- [ ] **ac:1 approval-inbox-route**: `GET /api/companion/approval-inbox` が pending human step を持つ workflow run を一覧化する。
- [ ] **ac:2 all-runs-not-latest-only**: 一覧は latest run に限定せず、`workflow_runs` 全体から pending approval を拾う。
- [ ] **ac:3 run-envelope**: 各 approval item は `run_id`, `workflow_id`, `project_id`, `status`, `action_required`, `pending_human_steps`, `outputs`, `audit_refs` を含む。
- [ ] **ac:4 human-step-contract**: `pending_human_steps` は `write_back_target`, `approval_kind`, `prompt`, `status` を含み、Mac 側が「承認すると何が起きるか」を表示できる。
- [ ] **ac:5 output-contract**: `outputs` は `output_type`, `title`, `summary`, `payload`, `metadata` を含み、Mac 側が承認対象の本文や候補を表示できる。
- [ ] **ac:6 companion-auth**: missing auth / browser cookie-only auth は既存 companion guard と同じ方針で拒否される。
- [ ] **ac:7 reply-route-compatibility**: 既存の `/api/companion/reply-context` と `/api/companion/reply-draft` は互換性を維持する。
- [ ] **ac:8 context-evidence-contract**: 各approval itemは`owner_id`, `action_kind`, `context`, `evidence`と安定したrun identityを含み、Mac側だけで判断文脈と根拠を確認できる。既存`web_url` / `web_route`は移行中の互換フィールドとし、Macの必須判断経路にしない。またpending approvalがresponse `limit`を超える場合は、返却されない全件数を`has_more`と`omitted_count`で明示する。

## 影響面と検証方針

- 入力経路: `GET /api/companion/approval-inbox` の bearer/service/internal native request。
- 既存経路: `POST /api/companion/reply-context` と `POST /api/companion/reply-draft` は route 登録と service 依存を維持する。
- 正本データ: `workflow_runs`, `workflow_human_steps`, `workflow_outputs`, `workflow_context_snapshots`, `workflow_audit_logs` は読み取りのみ。承認 resolve や writeback は実行しない。
- 出力面: Mac Companionが読むJSON projection。詳細管理・診断は安定したrun identityを使ってMCPへ引き継ぐ。`web_url` / `web_route`はWeb retirement完了までの互換情報とする。
- UX/E2E: Mac Companion側の一覧・承認UIはcompanion repoの`story-mac-companion-approval-focus-queue-v1`で扱う。Brainbase側ではAPI integration testとcompanion reply routeの互換テストを証跡とする。Web deep-linkはretirement gateでは必須にしない。

## スコープ外

- Mac Companion UI の詳細実装。
- Brainbase Workflow Mission Control の新規UI/全体再設計。
- Slack/Gmail/Graph への自動書き戻し。
- 承認時の output 編集差分の永続化。
