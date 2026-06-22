# Meeting Workflow Pack Calendar Input v1 Spec

## API

`POST /api/workflows/control/meeting-pack/calendar-inputs`

### Request

```json
{
  "org_id": "salestailor",
  "project_id": "salestailor",
  "from": "2026-06-22T00:00:00+09:00",
  "to": "2026-06-23T00:00:00+09:00",
  "account": "k.sato@sales-tailor.jp",
  "calendar_ids": ["primary"]
}
```

### Response

```json
{
  "meeting_calendar_inputs": {
    "org_id": "salestailor",
    "project_id": "salestailor",
    "workflow_definition_id": "pre-meeting-briefing",
    "events_considered": 1,
    "loop_intents": [],
    "skipped_events": [],
    "state_transitions": [
      "requested",
      "calendar_fetching",
      "meeting_pack_ensured",
      "loop_intents_ready",
      "skipped_inputs_reported"
    ]
  }
}
```

## Invariants

- INV-001: Calendar取得は`GoogleCalendarService`に閉じ、WorkflowService内で`gog`を直接実行しない。
- INV-002: Calendar予定から作るLoop Intentは`pre-meeting-briefing`のschedule triggerに紐づく。
- INV-003: `meeting_identity.source`は`google_calendar`である。
- INV-004: `meeting_identity`には`account`、`calendar_id`、`event_id`、`title`、`start`、`end`を保持する。
- INV-005: all-day予定はLoop Intent化しない。
- INV-006: 同じ予定のLoop Intent idは安定し、再取り込みで重複しない。
- INV-007: Calendar未接続時はWorkflow Controlへ部分書き込みしない。

## シナリオ

- S-001: timed Calendar eventをMTG前準備Loop Intentへ変換する。
- S-002: all-day Calendar eventをskipする。
- S-003: account指定時に`gog calendar events`へaccountを渡す。
- S-004: 会議URLを`hangoutLink`、`conferenceData.entryPoints`、説明・場所内URLから抽出する。
- S-005: 複数calendarの一部取得失敗では、成功calendarの予定をLoop Intent化し、失敗calendarを`skipped_events`へ返す。
- S-006: 取得成功eventが0件で失敗calendarだけがある場合は、Workflow Controlへ部分書き込みしない。
- S-007: 同じCalendar eventの再取り込みでは同じLoop Intent idを使い、重複を作らない。
- S-008: `listEventsForDate`は既存Schedule画面向けのdate入力・sort・all-day優先挙動を維持する。
- S-009: workflow state transition matrix は成功時の`requested -> calendar_fetching -> meeting_pack_ensured -> loop_intents_ready -> skipped_inputs_reported`と、全滅時の`requested -> calendar_fetching -> calendar_fetch_failed_all -> failed_without_partial_write`をAPIレスポンスとaudit evidenceに明示し、retry/replay時も同じstable Loop Intent idへ収束する。

## Workflow State Machine

```text
requested
→ calendar_fetching
→ calendar_fetch_failed_all: fail without Role Agent / Template / Binding / Trigger / Loop Intent writes
→ calendar_fetch_partial: keep successful events and append failed calendars to skipped_events
→ meeting_pack_ensured
→ loop_intents_ready
→ skipped_inputs_reported
```

## 失敗モード

- FM-001: Calendar service未設定なら400で失敗する。
- FM-002: Calendar auth未接続なら400で失敗する。
- FM-003: gog取得失敗時は該当calendarの取得をskipし、成功分だけ返す。
- FM-004: org/project権限がない場合は既存Workflow Controlの認可で拒否する。

## Verification Matrix

- AC-001, AC-002, AC-003, AC-004: `tests/server/services/workflow-org-agent-control.test.js`と`tests/e2e/story-meeting-workflow-calendar-input-v1-contract.spec.ts`で検証する。
- AC-005, AC-006: all-day skipとfailed calendar skipをunit/E2Eで検証する。
- AC-007, AC-008: disconnected / failed-account pathが書き込みゼロで失敗することをunit/E2Eで検証する。
- AC-009: repeated importのLoop Intent id安定性をunit/E2Eで検証する。
- AC-010, AC-011: `tests/unit/google-calendar-service.test.js`で既存date取得とaccount指定取得を検証する。
- AC-012: `tests/e2e/story-meeting-workflow-calendar-input-v1-contract.spec.ts`でAPI routeのflow replayを検証する。
