---
spec_id: spec-brainbase-agent-report-approval-inbox
story_id: story-brainbase-agent-report-approval-inbox
status: accepted
---

# Spec: agentレポートを Companion approval inbox に集約する（C2）

- story-id: `story-brainbase-agent-report-approval-inbox`
- date: 2026-07-05
- architecture: [docs/architecture/story-brainbase-agent-report-approval-inbox-architecture.md](../architecture/story-brainbase-agent-report-approval-inbox-architecture.md)
- responsibility-authority: [docs/responsibility-authority/agent-report-approval-inbox.json](../responsibility-authority/agent-report-approval-inbox.json)

## 目的

`/ceo` `/cso` `/retro` の agent レポートを既存の workflow engine（external-runner ingest）経由で Companion approval inbox に集約し、「表示 → 承認 → クローズ」まで閉じるループにする。

## 契約拡張（唯一のサーバー変更）

- `server/services/external-runner/contract-schema.js` の `ALLOWED_RUNNER_TYPES` に `agent_report` を追加。`runner.type=agent_report` のとき `runner.eve.trace_ref` を要求しない（eve 検証は不変）。
- `scripts/bin/bb-report-submit.mjs`（新規CLI）: markdown → external_runner.v0 payload → `POST /api/external-runner/ingest`。失敗時のみ `_inbox/pending.md` にフォールバック（channel は `agent/` プレフィックスから導出）。
- `server/services/automation-run/automation-run-service.js`: `implementation_key=external-runner:agent_report` の承認専用 run を `resolveHumanStep` で特殊ケース化（`isAgentReportWorkflow` / `isApprovalOnlyIngestWorkflow`）し、承認時にクローズ。eve は除外。

## Diagrams

- kind: state
  path: `docs/architecture/story-brainbase-agent-report-approval-inbox-architecture.md`
  purpose: agent_report run の状態遷移（waiting_human → 承認で success/closed、却下で cancelled/closed、部分承認は waiting_human 維持）を示す。eve は除外され従来 resume 経路を維持。
- kind: threat_model
  path: `docs/architecture/story-brainbase-agent-report-approval-inbox-architecture.md`
  purpose: ingest 経路のなりすまし送信・不正 payload・孤児 run 蓄積・読み取り 403（owner_id 不一致）の脅威と緩和を示す。

## Scenario Clauses

- S-001: `workflow state transition` agent_report ingest は `waiting_human / open / approve` の run に写り、`report_markdown` output と pending human_step を伴う。
- S-002: `workflow state transition` 全 human_step 承認で run は `success / closed / none` に写り、Companion approval inbox から退出する。孤児 needs_action run を残さない。
- S-003: `workflow state transition` human_step 却下で run は `cancelled / closed` に写り、兄弟 pending step を cancel する。
- S-004: `workflow state transition` 複数 human_step のうち一部のみ承認の場合、run は `waiting_human` を維持する。
- S-005: `workflow auth boundary` agent_report ingest は既存の `/api/external-runner` auth guard 配下に置かれ、owner/approver 委譲は runner.type 非依存で認証主体本人に限定される。
- S-006: `compatibility guard` eve（external-runner:eve）は承認専用クローズの特殊ケースから除外され、登録ハンドラ経由の resume 経路を維持する。
- S-007: `fallback guard` ingest 送信失敗（接続不可 / HTTP 非2xx / token 欠如）時は `_inbox/pending.md` に frontmatter 追記し、ユーザーが検知できる形で残す。

## Gate Rules

- `runner.type=agent_report` は `runner.eve.trace_ref` を要求しない（eve は従来どおり必須）。
- agent_report run は登録ランナーハンドラを持たないため、`resolveHumanStep` の承認専用クローズ経路を必ず通り、generic `runWorkflow` フォールバックへ落とさない。
- ライブ E2E は本 PR マージ + サーバー再起動が前提（稼働サーバーは agent_report 未マージ）。それまでは in-process E2E で代替検証する。

## Known Issues / 前提条件

- companion.js の `DEFAULT_OWNER_PERSON_ID='sato_keigo'` が正規トークンの personId（`per_01KGYC7NNS0VXADK7NP48W4VR5`）と不一致だと approval-inbox 読み取りが 403 になる。C2 稼働の前提として env `BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS` への alias 追加（または owner ID 正式化）が必要。本 PR スコープ外。
- 本番反映には C2 マージ後のサーバー再起動が必要（agent_report 未マージのため）。
