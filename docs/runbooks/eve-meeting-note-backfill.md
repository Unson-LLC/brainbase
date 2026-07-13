# Eve議事録生成バックフィル runbook

対象story: `story-eve-dispatch-handoff-transcript-context` / `story-eve-meeting-note-pull-reconciler` / `story-eve-meeting-candidates-pull-reconciler`

> **2026-07-13更新（pull型reconciler）**: Eve側からのpush書き戻しは行わない。書き戻しは**brainbase側のpull型reconciler**（`EveMeetingNoteReconciler`）が行う: dispatch済みEveセッションのstreamを定期ポーリング（デフォルト5分、`BRAINBASE_EVE_NOTE_RECONCILER_INTERVAL_MS`）し、`record_meeting_note_generation` / `record_meeting_candidates` tool-call inputを取り出して、`source_text_hash` / `run_id` をdispatch時のmetadataと突合のうえ反映する。即時反映したい場合はLightsail内から手動トリガする:
>
> ```bash
> set -a; . /home/ubuntu/brainbase/.env; set +a
> curl -s -X POST -H "x-internal-api-key: $INTERNAL_API_SECRET" \
>   http://127.0.0.1:55123/api/workflows/control/meeting-pack/eve-note-reconcile | jq
> # → { checked, recorded, already_recorded, blocked, pending, errors } のサマリーが返る
> ```
>
> `INTERNAL_API_SECRET` の値は標準出力へ出さない。internal API key経路はブラウザ用CSRF tokenを必要としない。

`transcript_to_meeting_note` のEve dispatchがtranscript未同梱だった期間にingestされたrun
（`meeting_note_draft` outputが `generation_status: brainbase_source_ready` のまま）を、
transcript同梱の新しいhandoffで再dispatchする手順。

## 前提

- Brainbase本番ランタイム（Lightsail `brainbase-nocodb`、systemd `brainbase-ssot.service`、`http://127.0.0.1:55123`）が稼働していること
- Eve dispatchが設定済みであること（Infisical `brainbase/production` の `EVE_API_*` 4キー。PR #1020）
- **Eve側のmeeting-agentが生成専任版であること**（brainbase-eve-agents PR #6以降。`record_meeting_note_generation` は外部POSTせずtool-call inputをstageするだけで、書き戻しはbrainbase側reconcilerがstreamから行う）
- **brainbase側でreconcilerが有効であること**（デフォルト有効。`BRAINBASE_EVE_NOTE_RECONCILER_ENABLED=0` で無効化されていないこと。起動ログ `[eve-note-reconciler] scheduler started` で確認）
- 認証: `INTERNAL_API_SECRET`（`x-internal-api-key`）またはブラウザセッションと同等のBearer token

## リリース手順とロールバック

**リリース順序（この順を守る）:**

1. brainbase-eve-agentsのproducerをVercel productionへデプロイし、deployment statusが `Ready` であることを確認する
2. brainbase本体のconsumer story PRを`develop`へmergeする
3. Lightsail `brainbase-nocodb:/home/ubuntu/brainbase` をmerge済み`origin/develop`へ切り替え、`brainbase-ssot.service`を再起動する
4. `systemctl is-active`、実行中SHA、`GET http://127.0.0.1:55123/api/health`、起動ログの`[eve-note-reconciler] scheduler started`を確認する
5. 本runbookに従い、対象を`--run-id`で1件に限定してdry-run後に再dispatchする

**ロールバック:**

- デプロイ前に現在のLightsail checkoutを`ops/lightsail-pre-<story>-<timestamp>`へ退避し、未コミット変更があればそのブランチだけへcommitする。`git reset --hard`や未コミット変更の破棄は行わない
- 即時ロールバックは`git switch ops/lightsail-pre-<story>-<timestamp>`、`sudo systemctl restart brainbase-ssot.service`の順で行い、active SHA、health、scheduler logを再確認する
- merge後の正本ロールバックはmerge commitを`git revert`し、そのrevert済み`origin/develop`を同じ手順でデプロイする
- 本変更が永続化するのは追加的な`run.metadata.meeting_note_generation`と候補output/auditで、不可逆migrationはない
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

ledgerはLightsail正本ランタイムの `/home/var/workflow-ledger.json` を読む（dry-runは読み取りのみ）。
作業ディレクトリは `/home/ubuntu/brainbase`、systemd unitは`brainbase-ssot.service`である。

```bash
node script/backfill-eve-meeting-note-dispatch.mjs \
  --ledger /home/var/workflow-ledger.json \
  --run-id <target_ingest_run_id>
```

- `brainbase_source_ready` のままの `meeting_note_draft` outputを持つrunが列挙される（2026-07-11時点で17件想定）
- `source_text_hash` が無いrunはdispatch不能としてskip表示される。該当recordingを再ingest（re-sync）してから再実行する

### 2. 実dispatch

```bash
set -a; . /home/ubuntu/brainbase/.env; set +a
node script/backfill-eve-meeting-note-dispatch.mjs \
  --ledger /home/var/workflow-ledger.json \
  --base-url http://127.0.0.1:55123 \
  --api-key "$INTERNAL_API_SECRET" \
  --run-id <target_ingest_run_id> \
  --execute
```

- 各候補に対し `POST /api/workflows/control/loop-intents/:loopIntentId/eve-session` を
  `{ force_new_session: true, meeting_note_generation: { run_id } }` で呼ぶ
- 別runを参照するdispatchは、残っている `eve_session_ref` が別会議のものなら自動的に
  新規セッションを作る（session再利用は同一 `meeting_note_generation.run_id` の場合のみ）。
  `force_new_session: true` は「同じrunに対する失敗セッションをやり直す」ケースを確実に
  カバーするための明示指定として付ける
- 本番の`--execute`では`--run-id <run_id>`を必須とし、直前のdry-runが`backfill candidates: 1`であることを確認する。限定しない一括実行は禁止

### 3. 結果確認

- dispatch成功: レスポンスの `eve_session_dispatch.run.id`（Eve側run）と `eve_session.session_id` を控える
- Eveが議事録を生成すると、**reconcilerがセッションstreamから議事録をpull**してローカルの
  note-generation契約で反映し、対象runの `meeting_note_draft` が `brainbase_generated` に遷移する
  （次のtickを待たない場合は冒頭の手動トリガ `POST /api/workflows/control/meeting-pack/eve-note-reconcile` を実行）
- 確認: `GET /api/workflow-runs/<ingest run_id>` の outputsで
  `payload.generation_status === 'brainbase_generated'` を確認
- audit log: `workflow.meeting_pack.note_generation.recorded`（ingest run）と
  `workflow.meeting_pack.note_generation.reconciled`（Eve dispatch run）が記録され、
  dispatch runは `success` / `closure_state: closed` で閉じる

## blocked runの回復手順（operator_review_eve_session）

reconcilerは、回復不能な状態を検知するとEve dispatch runを `blocked` +
`action_required: operator_review_eve_session` + `human_waiting: true` にして
Mission Controlの注意面に載せる。`run.message` と audit
`workflow.meeting_pack.note_generation.reconcile_blocked` の内容で分岐する:

| run.message / audit reason | 意味 | 回復手順 |
|---|---|---|
| `Eve session ended (parked/completed/failed) without a matching record_meeting_note_generation call` | Eveセッションが議事録なしで終端（旧agent世代のセッション、生成失敗など） | Eveセッションstreamを確認のうえ、`POST /api/workflows/control/loop-intents/:loopIntentId/eve-session` を `{ force_new_session: true, meeting_note_generation: { run_id } }` で再dispatch（またはバックフィルスクリプトを `--run-id` 付きで再実行） |
| 同上 + audit/metadataの `mismatched_note_calls > 0` | streamに議事録tool-callはあったが `source_text_hash` が突合値と不一致（別会議・改ざん・stale handoff） | handoffが対象runの正しいhashを向いていたか確認。対象runのtranscriptが正しければ `force_new_session: true` で再dispatch |
| `Meeting note write-back was rejected permanently: ...`（reason: `record_failed_permanent`） | ローカルnote-generation契約が400/404で恒久拒否（例: dispatch後の再ingestでdraftの `source_text_hash` が変わった、ingest runが消えた） | metadataの `record_state_transition` を確認。`blocked_source_hash_mismatch` なら現draftに対して `force_new_session: true` で**再dispatch**（古いセッションの議事録は現draftに適用できない）。run不在なら再ingestから |

blockedにした後もreconcilerはそのrunを再ポーリングしない（対象は `status: running` のみ）。
回復dispatchが成功すると新しいEve dispatch runが作られ、以降は通常フローで反映される。

## 候補書き戻し失敗の回復手順（operator_review_eve_candidates）

候補outputのtransactional writeに失敗したrunは`blocked` +
`action_required: operator_review_eve_candidates`としてMission Controlに表示される。

1. 対象runの`run.message`、`metadata.eve_note_reconciler.candidates`、audit `workflow.meeting_pack.candidates.reconcile_blocked`を確認し、`run_id`、`source_text_hash`、失敗stageを記録する
2. 現在の`meeting_note_draft.payload.source_text_hash`とdispatch metadataのhashを突合する
3. hash一致かつ一時的な保存失敗なら、同じingest runだけを`--run-id`に指定してdry-runし、候補が1件であることを確認して再dispatchする
4. hash不一致なら古いEve候補を適用しない。正しいtranscriptを再ingestし、新しいrun IDを限定指定して再dispatchする
5. 回復後は候補outputとaudit `workflow.meeting_pack.candidates.recorded`および`workflow.meeting_pack.note_generation.reconciled`を確認し、担当者曖昧時は`selected_owner`を自動設定せずPeople SSOT候補から人が選ぶ

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
