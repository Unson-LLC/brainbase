---
story_id: story-brainbase-agent-report-approval-inbox
title: agentレポートをworkflow engine経由でCompanion approval inboxに集約する
status: implemented
horizon: quarter
view: business
period: 2026-07
reason: C2。/ceo /cso /retro のagentレポートを既存 external-runner ingest 経由でCompanion approval inboxに集約し、承認でrunをクローズする。既存cloudflare_computer契約は不変（ALLOWED_RUNNER_TYPESにagent_report追加のみ）、DB migrationなし、cloudflare_computer/meeting_review経路は不変。退行リスクは低く、承認専用runの孤児化のみが新規リスクだったが本Storyで根本対応済み。
architecture_docs:
  - path: docs/architecture/story-brainbase-agent-report-approval-inbox-architecture.md
    status: accepted
spec_docs:
  - docs/specs/story-brainbase-agent-report-approval-inbox-spec.md
responsibility_authority_docs:
  - path: docs/responsibility-authority/agent-report-approval-inbox.json
    status: accepted
source_requirement:
  requirement_title: agentレポートが誰にも読まれず滞留・消失している。承認導線に載せて集約したい。
---

# agent レポートを Companion approval inbox に集約する（C2）

## 背景

`/ceo` `/cso` `/retro` の各 agent コマンドが `_inbox/pending.md` へ frontmatter 直書き＋`/tmp/{ceo,cso,retro}/` へ詳細レポート出力しており、誰にも読まれず滞留・消失している（`/tmp` は再起動で消える）。

## 実現したいこと

agent レポートを既存の workflow engine external-runner ingest（`POST /api/external-runner/ingest`）経由で Companion approval inbox に集約し、人間が「表示 → 承認 → クローズ」まで完結できる状態にする。表示 consumer は別リポジトリの Mac Companion。

## Acceptance Criteria

- [x] ac:1 agent レポートが `waiting_human` run として ingest され、`report_markdown` output と pending human_step を伴う（S-001）。
- [x] ac:2 全 human_step 承認で run が `success/closed` にクローズし、承認済みレポートが Companion approval inbox から退出し、孤児 needs_action run を残さない（S-002）。
- [x] ac:3 human_step 却下で run が `cancelled/closed` になり、兄弟 pending step を cancel する（S-007）。
- [x] ac:4 複数 human_step の一部のみ承認では run が `waiting_human` を維持する（S-008）。
- [x] ac:5 送信失敗時は `_inbox/pending.md` にフォールバック追記し、ユーザーが検知できる（S-005）。
- [x] ac:6 owner/approver 委譲は認証主体本人に限定され、ingest された run の owner/approver は認証主体に固定される（S-006）。

signal（本番稼働時の観測）: Mac Companion 承認 Focus Queue に agent レポートが表示され、承認操作で消える（前提: マージ + サーバー再起動 + owner-id alias 設定）。

詳細は spec / architecture doc を参照。
