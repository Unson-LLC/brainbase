---
story_id: story-meeting-workflow-calendar-input-v1
title: Meeting Workflow Pack Calendar Input v1
created_at: 2026-06-22
updated_at: 2026-06-22
status: active
architecture_docs: ["docs/architecture/meeting-workflow-calendar-input-architecture.md"]
spec_docs: ["docs/specs/story-meeting-workflow-calendar-input-v1-spec.md"]
---

# Meeting Workflow Pack Calendar Input v1

## 背景

Meeting Workflow Packは、会議で発生する判断・タスク・文脈をBrainbase上のLoopとして残すための最初の実証対象である。
ただし、会議業務Agentが動くには、まず実在する会議予定から`meeting_identity`を取得できる必要がある。

現在のBrainbaseには`gog`経由のGoogle Calendar取得口があるため、新しい外部連携を増やすのではなく、既存のCalendar取得サービスをWorkflow Controlへ接続する。

## ユーザーストーリー

Brainbase運用者として、Google Calendar上の実会議予定をMeeting Workflow Packへ取り込みたい。
そうすることで、MTG前準備Workflowが実在する会議予定を起点にLoop Intentを作成し、議事録・Task・Decision・Follow-upへつながる業務Loopの最初の入力を確定できる。

## 受け入れ条件

- [ ] AC-001: `gog calendar events`由来のtimed予定を、Meeting Workflow Packの`meeting_identity`として正規化できる。
- [ ] AC-002: Calendar予定から`pre-meeting-briefing`のschedule trigger Loop Intentを作成できる。
- [ ] AC-003: Loop Intentにはorg/project、Role Agent、Workflow Template、Workflow Binding、Workflow Triggerの系譜が残る。
- [ ] AC-004: 予定のevent id、calendar id、account、開始終了、参加者、会議URL、場所、説明、HTMLリンクを入力payloadに保持できる。
- [ ] AC-005: all-day予定は会議Loop Intentとして作成せず、skip理由を返す。
- [ ] AC-006: 複数calendarの一部取得失敗は、成功分をLoop Intent化し、失敗calendarを`skipped_events`へ返す。
- [ ] AC-007: Calendar未接続・認証失敗時はLoop Intentを作らず失敗する。
- [ ] AC-008: 取得対象calendarが全滅した場合は、Role Agent / Template / Binding / Triggerも含めてWorkflow Controlへ部分書き込みしない。
- [ ] AC-009: 同じCalendar予定を再取り込みしても安定IDで上書きされ、重複Loop Intentを作らない。
- [ ] AC-010: 既存のSchedule画面向け`listEventsForDate`の挙動を壊さない。
- [ ] AC-011: `account`指定時は複数Googleアカウント環境でも指定accountで取得できる。
- [ ] AC-012: API routeから同じ契約を実行でき、E2E/flow replayで状態遷移を検証できる。

## 状態遷移

```text
request received
→ calendar events fetched
→ zero-success fetch rejected without Workflow Control writes
→ meeting pack definitions upserted
→ timed events converted to ready Loop Intents
→ all-day / failed-calendar inputs returned as skipped evidence
→ repeated import overwrites the same stable Loop Intent id
```

## シナリオ句

- Scenario AC-001: `gog calendar events`で取得したtimed予定を`google_calendar`由来の`meeting_identity`へ正規化する。
- Scenario AC-002: 正規化した予定から`pre-meeting-briefing`の`schedule` trigger Loop Intentを作成する。
- Scenario AC-003: 作成されたLoop Intentからorg/project、Role Agent、Workflow Template、Workflow Binding、Workflow Triggerまで追跡できる。
- Scenario AC-004: Calendar event id、calendar id、account、開始終了、参加者、会議URL、場所、説明、HTMLリンクを`input_payload.meeting_identity`に保持する。
- Scenario AC-005: all-day予定はLoop Intent化せず、operatorに見える`skipped_events`として返す。
- Scenario AC-006: 複数calendarの一部取得失敗では成功calendarだけをLoop Intent化し、失敗calendarを`skipped_events`として返す。
- Scenario AC-007: Calendar未接続または認証失敗ではHTTP 400で失敗し、Loop Intentを作らない。
- Scenario AC-008: 取得対象calendarが全滅した場合はRole Agent / Template / Binding / Trigger / Loop Intent / Auditへ部分書き込みしない。
- Scenario AC-009: 同じCalendar予定の再取り込みでは安定IDで同じLoop Intentを上書きし、重複を作らない。
- Scenario AC-010: 既存Schedule画面が使う`listEventsForDate(date)`はdate入力、sort、all-day優先表示を維持する。
- Scenario AC-011: `account`指定時は`gog calendar events ... --account <account>`を使い、複数Googleアカウント環境でも指定accountで取得する。
- Scenario AC-012: API route経由で同じ契約を実行し、成功時と全滅時の`state_transitions`、承認待ちeligibility、audit evidenceまでflow replayで確認する。

## 本番パス行列

| Path | 入力 | 期待結果 | 対応AC |
|---|---|---|---|
| happy path | timed予定あり | MTG前準備Loop Intentを作成し、系譜とpayloadを保持する | AC-001, AC-002, AC-003, AC-004 |
| skipped input path | all-day予定あり | Loop Intent化せず`skipped_events`へ返す | AC-005 |
| partial calendar failure | 複数calendarの一部失敗 | 成功分だけ作成し、失敗calendarを返す | AC-006 |
| all calendar failure | 成功eventなし、失敗calendarのみ | HTTP 400で失敗し、Workflow Controlへ部分書き込みしない | AC-007, AC-008 |
| replay path | 同じ予定を再取り込み | 安定IDで上書きし、重複しない | AC-009 |
| compatibility path | 既存Schedule date取得 | all-day優先sortを維持する | AC-010 |
| multi-account path | account指定あり | 指定accountで`gog`を実行する | AC-011 |
| API flow replay path | route経由 | `state_transitions`とaudit evidenceを確認する | AC-012 |

## 非スコープ

- Eveやrunnerの実行開始。
- Task / Decision / Graph SSOTへの昇格。
- 外部メッセージ送信、予定作成、予定更新。
- UIの完成実装。
