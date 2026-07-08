---
story_id: story-brainbase-decision-events-kpi-v1
title: 判断委任KPIフェーズ1 サーバー側イベント受信・週次集計
status: active
date: 2026-07-08
---

# 判断委任KPIフェーズ1: サーバー側イベント受信・週次集計

## Story

mac-companionがGmail/Slackの判断イベント（AI下書きの採用・修正・自力対応・エスカレーション・ルール作成など）をBrainbaseへPOSTし、Brainbaseが冪等に永続化する。週次でKPI（委任率・差戻し率・エスカレーション件数・境界拡張数）を集計してSlackへ投稿し、判断委任の進捗を定量的に追えるようにする。

これは `.vibepro/spec/story-brainbase-human-decision-queue-attention-edge-v0/` の未実装スタブ（参照ドキュメント不在）を置き換えるフェーズ1実装である。

## Acceptance Criteria

- **ac:1 route**: Brainbaseは `POST /api/companion/decision-events` を公開し、mac-companion側と固定された契約（`event_id` / `occurred_at` / `item_dedupe_key` / `provider` / `event_type` 等）を受け付ける。契約フィールド名・型は変更しない。
- **ac:2 auth-reuse**: 既存の companion アクセスガード（server-to-server認証: internal / service-token / bearer(owner)）をそのまま再利用し、新規の認可ロジックを追加しない。未認証・非ownerは403で拒否する。
- **ac:3 validation**: `event_type` は固定enum（surfaced, ai_drafted, draft_accepted, draft_edited, self_handled, escalated, ignored, rule_created）のみ受け付け、`occurred_at` 必須・ISO8601検証を行う。不正な入力は永続化前に400で拒否する。
- **ac:4 idempotency**: `event_id` を冪等キーとし、重複POSTは200で既存recordを返して無視する（上書きしない）。
- **ac:5 persistence**: `server/services/companion/decision-event-service.js` が workflow-repository のJSON ledgerパターン（atomic write: tmp書き込み→rename、破損ファイルquarantine）を踏襲し、`data/companion-decision-events/{yyyy-mm}.json` へ月別追記する。`insertEvent(event)` / `listEvents({from,to})` のインターフェースを持つ。
- **ac:6 read-api**: `GET /api/companion/decision-events?from=&to=` （同ガード）で週次集計とデバッグ用にイベントを取得できる。
- **ac:7 weekly-kpi**: `scripts/send-decision-kpi-to-slack.js` が直近7日の委任率 = (draft_accepted+draft_edited)/(draft_accepted+draft_edited+self_handled)、差戻し率 = draft_edited/(draft_accepted+draft_edited)、エスカレーション件数、境界拡張数（rule_created件数）を集計してSlackへ投稿する。
- **ac:8 no-fake-zero**: データが無い週は委任率・差戻し率を0%で偽装せず「計測不能」と明示する。イベント0件の週は「イベント未受信」と報告する。

## Workflow Scenarios

- **scenario:event-accepted**: 認証済みPOST → validateDecisionEvent → 新規event_id → 月別ファイルへatomic write → 201 duplicate=false。
- **scenario:event-duplicate**: 認証済みPOST → 既存event_idと一致 → 永続化せず既存recordを返す → 200 duplicate=true。
- **scenario:event-rejected**: 必須フィールド欠落またはenum不正 → 永続化前に400 invalid_decision_event。
- **scenario:auth-rejected**: 未認証（cookie等）または非owner bearer → 403（server_to_server_auth_required / personal_kg_owner_required）。
- **scenario:weekly-report**: launchd/cronがスクリプトを実行 → GET decision-events?from=&to= → KPI集計 → Slack Block Kit投稿。分母0は「計測不能」、イベント0件は「イベント未受信」。
- **scenario:corrupt-ledger**: 月別JSONファイル破損 → quarantine（.corrupt-<timestamp>へrename）して空ledgerとして継続動作。

## Out Of Scope

- mac-companion側のイベント送信実装（同じ契約で別途実装中）。
- Postgres移行・ダッシュボードUI。
- GitHub Actionsからの集計実行（companion APIはserver-to-server認証のみでhosted runnerから到達保証がないため、サーバーローカルのlaunchd/cron実行を採用）。
- `metadata` フィールドのスキーマ検証（フェーズ2でのフォローアップ）。

## References

- Architecture: `docs/architecture/decision-events-kpi-architecture.md`
- Responsibility Authority: `docs/responsibility-authority/decision-events-kpi.json`
- 実装: `server/services/companion/decision-event-service.js`, `server/routes/companion.js`, `server/controllers/companion-controller.js`, `scripts/send-decision-kpi-to-slack.js`
- テスト: `tests/server/services/companion/decision-event-service.test.js`, `tests/server/routes/companion-decision-events.test.js`, `tests/server/scripts/send-decision-kpi-to-slack.test.js`, `tests/e2e/story-brainbase-decision-events-kpi-v1-decision-events-api-contract.spec.ts`
