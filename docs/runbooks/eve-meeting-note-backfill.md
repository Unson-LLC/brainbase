# Eve議事録生成バックフィル runbook

対象story: `story-eve-dispatch-handoff-transcript-context`

`transcript_to_meeting_note` のEve dispatchがtranscript未同梱だった期間にingestされたrun
（`meeting_note_draft` outputが `generation_status: brainbase_source_ready` のまま）を、
transcript同梱の新しいhandoffで再dispatchする手順。

## 前提

- brainbaseランタイム（launchd, `http://localhost:31013`）が稼働していること
- Eve dispatchが設定済みであること（Infisical `brainbase/production` の `EVE_API_*` 4キー。PR #1020）
- **Eve側の書き戻しtoolがデプロイ済みであること**（brainbase-eve-agents PR #5 `record_meeting_note_generation`）。
  未デプロイのままバックフィルすると、Eveセッションは作られるが書き戻せず、runは `brainbase_source_ready` のまま残る（データ破壊はないがセッションが無駄になり再dispatchが必要）
- 認証: `INTERNAL_API_SECRET`（`x-internal-api-key`）またはブラウザセッションと同等のBearer token

## リリース手順とロールバック

**リリース順序（この順を守る）:**

1. brainbase-eve-agents PR #5 をmergeしVercelデプロイ（`record_meeting_note_generation` tool）
2. brainbase本体のstory PRをdevelopへmergeし、ランタイムへ反映（`./scripts` の通常反映フロー）
3. 本runbookに従ってバックフィルを実行

**ロールバック:**

- brainbase側は `git revert` で安全に戻せる。本変更が永続化するのは追加的な
  `run.metadata.meeting_note_generation`（run_id/package_id/source_text_hash）のみで、
  旧コードはこのフィールドを読まないためデータ移行・スキーマ変更は不要
- revert後も、dispatch済みEveセッションからの書き戻しは従来から存在する
  `POST /api/workflows/control/meeting-pack/note-generation`（hash一致必須）で受理されるか、
  runが `brainbase_source_ready` のまま残るだけで破壊は起きない

**観測（デプロイ後の確認先）:**

- audit log: `workflow.meeting_pack.note_generation.dispatch_requested` / `dispatch_skipped` /
  `workflow.eve_session.dispatched` / `workflow.meeting_pack.note_generation.recorded`
- Eve dispatch runの `metadata.meeting_note_generation`（対象run参照）と
  ingest runの `meeting_note_draft.payload.generation_status`

## 手順

### 1. 候補の確認（dry-run）

ledgerは正本ランタイムの `var/workflow-ledger.json` を読む（読み取りのみ）。
ランタイムは launchd `com.brainbase.ui` の WorkingDirectory（通常 `/Users/ksato/workspace/code/brainbase`。
`plutil -p ~/Library/LaunchAgents/com.brainbase.ui.plist | grep WorkingDirectory` で確認できる）。

```bash
node script/backfill-eve-meeting-note-dispatch.mjs \
  --ledger /Users/ksato/workspace/code/brainbase/var/workflow-ledger.json
```

- `brainbase_source_ready` のままの `meeting_note_draft` outputを持つrunが列挙される（2026-07-11時点で17件想定）
- `source_text_hash` が無いrunはdispatch不能としてskip表示される。該当recordingを再ingest（re-sync）してから再実行する

### 2. 実dispatch

```bash
node script/backfill-eve-meeting-note-dispatch.mjs \
  --ledger <runtime>/var/workflow-ledger.json \
  --api-key "$INTERNAL_API_SECRET" \
  --execute
```

- 各候補に対し `POST /api/workflows/control/loop-intents/:loopIntentId/eve-session` を
  `{ force_new_session: true, meeting_note_generation: { run_id } }` で呼ぶ
- 別runを参照するdispatchは、残っている `eve_session_ref` が別会議のものなら自動的に
  新規セッションを作る（session再利用は同一 `meeting_note_generation.run_id` の場合のみ）。
  `force_new_session: true` は「同じrunに対する失敗セッションをやり直す」ケースを確実に
  カバーするための明示指定として付ける
- 特定runだけ再dispatchする場合は `--run-id <run_id>` を付ける（複数指定可）

### 3. 結果確認

- dispatch成功: レスポンスの `eve_session_dispatch.run.id`（Eve側run）と `eve_session.session_id` を控える
- Eveが議事録を生成すると `POST /api/workflows/control/meeting-pack/note-generation` 経由で
  対象runの `meeting_note_draft` が `brainbase_generated` に遷移する
- 確認: `GET /api/workflow-runs/<ingest run_id>` の outputsで
  `payload.generation_status === 'brainbase_generated'` を確認
- audit log: `workflow.meeting_pack.note_generation.recorded` が対象runに記録される

## 失敗時の切り分け

| 症状 | 原因 / 対応 |
|---|---|
| 400 `blocked_invalid_meeting_note_generation_ref` | `meeting_note_generation` にrun_id/package_idが無い（手組みリクエスト時）。参照を付けて再実行 |
| 400 `blocked_meeting_note_generation_source_missing` | outputに `source_text_hash` が無い。recordingを再ingestしてから再実行 |
| 400 `blocked_meeting_note_generation_scope` | run/loop intentのorg・project不一致。候補の `loop_intent_id` がoutput metadata由来か確認 |
| 409 `blocked_eve_dispatch_in_progress` | 同一loop intentのdispatchが進行中。完了を待って再実行 |
| 409 `blocked_eve_dispatch_timeout_recovery_required` | タイムアウト回復待ちのrun。operator reconciliation（recovery run）を先に処理 |
| 401 認証エラー | `--api-key`（`INTERNAL_API_SECRET`）未指定または不一致。Infisicalの値を確認 |
| Eve側でfailedエンベロープ | Eveセッションログを確認。handoff contextに `meeting_note_generation` が含まれているかをEve側入力で確認 |
