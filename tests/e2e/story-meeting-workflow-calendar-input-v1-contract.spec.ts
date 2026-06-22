import { test, expect } from '@playwright/test';

import express from 'express';
import fs from 'node:fs';
import request from 'supertest';

import { createWorkflowRouter } from '../../server/routes/workflows.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { GoogleCalendarService } from '../../server/services/google-calendar-service.js';

const storyId = 'story-meeting-workflow-calendar-input-v1';

function readFile(path: string) {
  return fs.readFileSync(path, 'utf8');
}

function createWorkflowControlApp(googleCalendarService: any) {
  const app = express();
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'salestailor', session_select: true }
        ]
      };
    }
  };
  const service = new WorkflowService({ repository, runner, configParser, googleCalendarService });
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: 'keigo', role: 'admin' };
    req.access = {
      personId: 'keigo',
      projectCodes: ['salestailor'],
      role: 'admin'
    };
    next();
  });
  app.use('/api/workflows', createWorkflowRouter(service));
  app.use((err: any, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return { app, repository };
}

test.describe('story-meeting-workflow-calendar-input-v1', () => {
  test('ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 ac:12 story-meeting-workflow-calendar-input-v1 traceability contract', () => {
    const story = readFile('docs/stories/story-meeting-workflow-calendar-input-v1.md');
    const spec = readFile('docs/specs/story-meeting-workflow-calendar-input-v1-spec.md');
    const architecture = readFile('docs/architecture/meeting-workflow-calendar-input-architecture.md');
    const workflowService = readFile('server/services/workflow/workflow-service.js');
    const calendarService = readFile('server/services/google-calendar-service.js');
    const route = readFile('server/routes/workflows.js');

    // story-meeting-workflow-calendar-input-v1 ac:1 AC-001: `gog calendar events`由来のtimed予定を、Meeting Workflow Packの`meeting_identity`として正規化できる。
    expect(story + workflowService, 'story-meeting-workflow-calendar-input-v1 ac:1 AC-001: `gog calendar events`由来のtimed予定を、Meeting Workflow Packの`meeting_identity`として正規化できる。').toContain("source: 'google_calendar'");
    // story-meeting-workflow-calendar-input-v1 ac:2 AC-002: Calendar予定から`pre-meeting-briefing`のschedule trigger Loop Intentを作成できる。
    expect(story + workflowService, 'story-meeting-workflow-calendar-input-v1 ac:2 AC-002: Calendar予定から`pre-meeting-briefing`のschedule trigger Loop Intentを作成できる。').toContain("workflowDefinitionId = 'pre-meeting-briefing'");
    // story-meeting-workflow-calendar-input-v1 ac:3 AC-003: Loop Intentにはorg/project、Role Agent、Workflow Template、Workflow Binding、Workflow Triggerの系譜が残る。
    expect(story + workflowService, 'story-meeting-workflow-calendar-input-v1 ac:3 AC-003: Loop Intentにはorg/project、Role Agent、Workflow Template、Workflow Binding、Workflow Triggerの系譜が残る。').toContain('role_agent_instance_id');
    // story-meeting-workflow-calendar-input-v1 ac:4 AC-004: 予定のevent id、calendar id、account、開始終了、参加者、会議URL、場所、説明、HTMLリンクを入力payloadに保持できる。
    expect(story + workflowService, 'story-meeting-workflow-calendar-input-v1 ac:4 AC-004: 予定のevent id、calendar id、account、開始終了、参加者、会議URL、場所、説明、HTMLリンクを入力payloadに保持できる。').toContain('conference_url');
    // story-meeting-workflow-calendar-input-v1 ac:5 AC-005: all-day予定は会議Loop Intentとして作成せず、skip理由を返す。
    expect(story + workflowService, 'story-meeting-workflow-calendar-input-v1 ac:5 AC-005: all-day予定は会議Loop Intentとして作成せず、skip理由を返す。').toContain("reason: 'all_day_event'");
    // story-meeting-workflow-calendar-input-v1 ac:6 AC-006: 複数calendarの一部取得失敗は、成功分をLoop Intent化し、失敗calendarを`skipped_events`へ返す。
    expect(story + calendarService, 'story-meeting-workflow-calendar-input-v1 ac:6 AC-006: 複数calendarの一部取得失敗は、成功分をLoop Intent化し、失敗calendarを`skipped_events`へ返す。').toContain('skippedCalendars.push');
    // story-meeting-workflow-calendar-input-v1 ac:7 AC-007: Calendar未接続・認証失敗時はLoop Intentを作らず失敗する。
    expect(story + workflowService, 'story-meeting-workflow-calendar-input-v1 ac:7 AC-007: Calendar未接続・認証失敗時はLoop Intentを作らず失敗する。').toContain('google calendar is not connected');
    // story-meeting-workflow-calendar-input-v1 ac:8 AC-008: 取得対象calendarが全滅した場合は、Role Agent / Template / Binding / Triggerも含めてWorkflow Controlへ部分書き込みしない。
    expect(story + spec, 'story-meeting-workflow-calendar-input-v1 ac:8 AC-008: 取得対象calendarが全滅した場合は、Role Agent / Template / Binding / Triggerも含めてWorkflow Controlへ部分書き込みしない。').toContain('Workflow Controlへ部分書き込みしない');
    // story-meeting-workflow-calendar-input-v1 ac:9 AC-009: 同じCalendar予定を再取り込みしても安定IDで上書きされ、重複Loop Intentを作らない。
    expect(story + workflowService, 'story-meeting-workflow-calendar-input-v1 ac:9 AC-009: 同じCalendar予定を再取り込みしても安定IDで上書きされ、重複Loop Intentを作らない。').toContain('eventStableRef');
    // story-meeting-workflow-calendar-input-v1 ac:10 AC-010: 既存のSchedule画面向け`listEventsForDate`の挙動を壊さない。
    expect(story + calendarService, 'story-meeting-workflow-calendar-input-v1 ac:10 AC-010: 既存のSchedule画面向け`listEventsForDate`の挙動を壊さない。').toContain('async listEventsForDate(date)');
    // story-meeting-workflow-calendar-input-v1 ac:11 AC-011: `account`指定時は複数Googleアカウント環境でも指定accountで取得できる。
    expect(story + calendarService, 'story-meeting-workflow-calendar-input-v1 ac:11 AC-011: `account`指定時は複数Googleアカウント環境でも指定accountで取得できる。').toContain("...(account ? ['--account', account] : [])");
    // story-meeting-workflow-calendar-input-v1 ac:12 AC-012: API routeから同じ契約を実行でき、E2E/flow replayで状態遷移を検証できる。
    expect(story + route, 'story-meeting-workflow-calendar-input-v1 ac:12 AC-012: API routeから同じ契約を実行でき、E2E/flow replayで状態遷移を検証できる。').toContain('/control/meeting-pack/calendar-inputs');
    expect(architecture, 'story-meeting-workflow-calendar-input-v1 ac:12 flow replay pathを設計に明示する').toContain('Workflow Control');
  });

  test(`${storyId} ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 AC-001 AC-002 AC-003 AC-004 AC-005 AC-006 calendar予定をMTG前準備Loop Intentへ変換し、all-dayとcalendar失敗を可視化する`, async () => {
    const googleCalendarService = {
      async getAuthStatus() {
        return { connected: true, defaultAccount: 'k.sato@sales-tailor.jp' };
      },
      async listEventsWithDiagnostics() {
        return {
          events: [
            {
              id: 'gcal:primary:evt-1',
              calendarEventId: 'evt-1',
              iCalUID: 'uid-1@example.com',
              calendarId: 'primary',
              account: 'k.sato@sales-tailor.jp',
              title: 'Mana定例',
              startDateTime: '2026-06-22T10:00:00+09:00',
              endDateTime: '2026-06-22T11:00:00+09:00',
              allDay: false,
              attendees: [{ email: 'sato@example.com', responseStatus: 'accepted' }],
              conferenceUrl: 'https://meet.google.com/abc-defg-hij',
              location: 'Google Meet',
              htmlLink: 'https://calendar.google.com/event?eid=evt-1',
              description: '週次の実会議'
            },
            {
              id: 'gcal:primary:holiday',
              calendarEventId: 'holiday',
              calendarId: 'primary',
              title: '祝日',
              startDate: '2026-06-22',
              endDate: '2026-06-23',
              allDay: true
            }
          ],
          skippedCalendars: [
            {
              calendar_id: 'team',
              reason: 'calendar_fetch_failed',
              message: 'calendar forbidden'
            }
          ]
        };
      }
    };
    const { app, repository } = createWorkflowControlApp(googleCalendarService);

    const res = await request(app)
      .post('/api/workflows/control/meeting-pack/calendar-inputs')
      .send({
        org_id: 'salestailor',
        project_id: 'salestailor',
        from: '2026-06-22T00:00:00+09:00',
        to: '2026-06-23T00:00:00+09:00',
        account: 'k.sato@sales-tailor.jp',
        calendar_ids: ['primary', 'team']
      })
      .expect(201);

    // ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 / AC-001 AC-002 AC-003 AC-004 AC-005 AC-006: Calendar入力をMeeting Loop Intentへ正規化し、skip証跡も返す。
    expect(res.body.meeting_calendar_inputs).toMatchObject({
      org_id: 'salestailor',
      project_id: 'salestailor',
      workflow_definition_id: 'pre-meeting-briefing',
      events_considered: 2,
      state_transitions: [
        'requested',
        'calendar_fetching',
        'meeting_pack_ensured',
        'loop_intents_ready',
        'skipped_inputs_reported'
      ],
      loop_intents: [
        expect.objectContaining({
          org_id: 'salestailor',
          project_id: 'salestailor',
          role_agent_instance_id: expect.stringContaining('meeting_ops'),
          workflow_template_id: expect.stringContaining('pre_meeting_briefing'),
          workflow_binding_id: expect.stringContaining('meeting_ops_pre_meeting_briefing'),
          workflow_trigger_id: expect.stringContaining('pre_meeting_briefing_schedule'),
          trigger_type: 'schedule',
          input_payload: expect.objectContaining({
            meeting_identity: expect.objectContaining({
              source: 'google_calendar',
              account: 'k.sato@sales-tailor.jp',
              calendar_id: 'primary',
              event_id: 'evt-1',
              title: 'Mana定例',
              start: '2026-06-22T10:00:00+09:00',
              end: '2026-06-22T11:00:00+09:00',
              conference_url: 'https://meet.google.com/abc-defg-hij',
              location: 'Google Meet',
              html_link: 'https://calendar.google.com/event?eid=evt-1',
              description: '週次の実会議',
              attendees: [{ email: 'sato@example.com', responseStatus: 'accepted' }]
            }),
            workflow_definition_id: 'pre-meeting-briefing',
            requested_output: 'agenda / context brief',
            write_back_target: 'workflow_output',
            source: 'google_calendar'
          })
        })
      ],
      skipped_events: expect.arrayContaining([
        {
          event_id: 'holiday',
          title: '祝日',
          reason: 'all_day_event'
        },
        {
          calendar_id: 'team',
          reason: 'calendar_fetch_failed',
          message: 'calendar forbidden'
        }
      ])
    });
    expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(1);
  });

  test(`${storyId} ac:7 ac:8 AC-007 AC-008 calendar取得が全滅した場合はWorkflow Controlへ部分書き込みせずoperator-visible errorを返す`, async () => {
    const googleCalendarService = {
      async listEventsWithDiagnostics() {
        return {
          events: [],
          skippedCalendars: [
            {
              calendar_id: 'primary',
              reason: 'calendar_fetch_failed',
              message: 'missing account token'
            }
          ]
        };
      }
    };
    const { app, repository } = createWorkflowControlApp(googleCalendarService);

    const res = await request(app)
      .post('/api/workflows/control/meeting-pack/calendar-inputs')
      .send({
        org_id: 'salestailor',
        project_id: 'salestailor',
        from: '2026-06-22T00:00:00+09:00',
        to: '2026-06-23T00:00:00+09:00',
        account: 'missing@example.com'
      })
      .expect(400);

    // ac:7 ac:8 / AC-007 AC-008: 全滅時はoperator-visible errorを返し、Workflow Controlへ部分書き込みしない。
    expect(res.body).toEqual({
      error: 'google calendar is not connected: calendar_fetch_failed',
      state_transitions: [
        'requested',
        'calendar_fetching',
        'calendar_fetch_failed_all',
        'failed_without_partial_write'
      ],
      skipped_events: [
        {
          calendar_id: 'primary',
          reason: 'calendar_fetch_failed',
          message: 'missing account token'
        }
      ]
    });
    expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
    expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(0);
    expect(repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
    expect(repository.listWorkflowTriggers({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
    expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
  });

  test(`${storyId} ac:9 AC-009 同じcalendar予定を再取り込みしても安定IDで上書きされ重複しない`, async () => {
    const googleCalendarService = {
      async getAuthStatus() {
        return { connected: true, defaultAccount: 'k.sato@sales-tailor.jp' };
      },
      async listEventsWithDiagnostics() {
        return {
          events: [
            {
              id: 'gcal:primary:evt-stable',
              calendarEventId: 'evt-stable',
              calendarId: 'primary',
              title: '再取り込みMTG',
              startDateTime: '2026-06-22T13:00:00+09:00',
              endDateTime: '2026-06-22T14:00:00+09:00',
              allDay: false
            }
          ],
          skippedCalendars: []
        };
      }
    };
    const { app, repository } = createWorkflowControlApp(googleCalendarService);
    const payload = {
      org_id: 'salestailor',
      project_id: 'salestailor',
      from: '2026-06-22T00:00:00+09:00',
      to: '2026-06-23T00:00:00+09:00',
      account: 'k.sato@sales-tailor.jp',
      calendar_ids: ['primary']
    };

    const first = await request(app)
      .post('/api/workflows/control/meeting-pack/calendar-inputs')
      .send(payload)
      .expect(201);
    const second = await request(app)
      .post('/api/workflows/control/meeting-pack/calendar-inputs')
      .send(payload)
      .expect(201);

    // ac:9 / AC-009: 再取り込みは同じLoop Intent idへ収束し、重複を作らない。
    expect(first.body.meeting_calendar_inputs.loop_intents[0].id).toBe(second.body.meeting_calendar_inputs.loop_intents[0].id);
    expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(1);
  });

  test(`${storyId} ac:10 AC-010 listEventsForDateは既存Schedule向けの日付取得とall-day優先sortを維持する`, async () => {
    const handlers: Record<string, unknown> = {
      '--version': 'v0.9.0',
      'auth status --json --no-input': {
        account: {
          credentials_exists: true,
          email: 'k.sato@sales-tailor.jp'
        }
      },
      'calendar events primary --from 2026-06-22 --to 2026-06-23 --json --no-input --max 200': {
        items: [
          {
            id: 'timed',
            summary: '通常MTG',
            start: { dateTime: '2026-06-22T10:00:00+09:00' },
            end: { dateTime: '2026-06-22T11:00:00+09:00' }
          },
          {
            id: 'all-day',
            summary: '終日予定',
            start: { date: '2026-06-22' },
            end: { date: '2026-06-23' }
          }
        ]
      }
    };
    const service = new GoogleCalendarService({
      execFileImpl: async (_command: string, args: string[]) => {
        const key = args.join(' ');
        if (!(key in handlers)) throw new Error(`Unexpected command: ${key}`);
        const value = handlers[key];
        return {
          stdout: typeof value === 'string' ? value : JSON.stringify(value),
          stderr: ''
        };
      }
    });

    const events = await service.listEventsForDate('2026-06-22');

    // ac:10 / AC-010: 既存Schedule画面向けの日付取得、sort、all-day優先表示を維持する。
    expect(events.map((event) => event.title)).toEqual(['終日予定', '通常MTG']);
    expect(events[0]).toMatchObject({ allDay: true, start: null, source: 'google-calendar' });
    expect(events[1]).toMatchObject({ allDay: false, start: '10:00', end: '11:00' });
  });

  test(`${storyId} ac:11 AC-011 account指定時はgog calendar eventsへaccountを渡す`, async () => {
    const seenCommands: string[] = [];
    const service = new GoogleCalendarService({
      execFileImpl: async (_command: string, args: string[]) => {
        const key = args.join(' ');
        seenCommands.push(key);
        if (key === '--version') {
          return { stdout: 'v0.9.0', stderr: '' };
        }
        if (key === 'calendar events primary --from 2026-06-22T00:00:00+09:00 --to 2026-06-23T00:00:00+09:00 --json --no-input --max 200 --account k.sato@sales-tailor.jp') {
          return {
            stdout: JSON.stringify({
              items: [
                {
                  id: 'evt-account',
                  summary: 'Account指定MTG',
                  start: { dateTime: '2026-06-22T15:00:00+09:00' },
                  end: { dateTime: '2026-06-22T16:00:00+09:00' }
                }
              ]
            }),
            stderr: ''
          };
        }
        throw new Error(`Unexpected command: ${key}`);
      }
    });

    const events = await service.listEvents({
      from: '2026-06-22T00:00:00+09:00',
      to: '2026-06-23T00:00:00+09:00',
      account: 'k.sato@sales-tailor.jp',
      calendarIds: ['primary']
    });

    // ac:11 / AC-011: account指定時はgog calendar eventsへ--accountを渡す。
    expect(seenCommands).toContain('calendar events primary --from 2026-06-22T00:00:00+09:00 --to 2026-06-23T00:00:00+09:00 --json --no-input --max 200 --account k.sato@sales-tailor.jp');
    expect(events[0]).toMatchObject({
      account: 'k.sato@sales-tailor.jp',
      calendarEventId: 'evt-account',
      title: 'Account指定MTG'
    });
  });

  test(`${storyId} ac:12 AC-012 API routeのflow replay/state transitionを実行できる`, async () => {
    const googleCalendarService = {
      async getAuthStatus() {
        return { connected: true, defaultAccount: 'k.sato@sales-tailor.jp' };
      },
      async listEventsWithDiagnostics() {
        return {
          events: [
            {
              id: 'gcal:primary:evt-flow',
              calendarEventId: 'evt-flow',
              calendarId: 'primary',
              title: 'Flow Replay MTG',
              startDateTime: '2026-06-22T17:00:00+09:00',
              endDateTime: '2026-06-22T18:00:00+09:00',
              allDay: false
            }
          ],
          skippedCalendars: []
        };
      }
    };
    const { app, repository } = createWorkflowControlApp(googleCalendarService);

    const res = await request(app)
      .post('/api/workflows/control/meeting-pack/calendar-inputs')
      .send({
        org_id: 'salestailor',
        project_id: 'salestailor',
        from: '2026-06-22T00:00:00+09:00',
        to: '2026-06-23T00:00:00+09:00',
        account: 'k.sato@sales-tailor.jp',
        calendar_ids: ['primary']
      })
      .expect(201);

    // ac:12 / AC-012: API route経由でready状態、承認待ちeligibility、audit evidenceまでflow replayする。
    expect(res.body.meeting_calendar_inputs.loop_intents[0]).toMatchObject({
      trigger_type: 'schedule',
      status: 'ready',
      eligibility: {
        status: 'needs_approval',
        autonomy_level: 'approval_required',
        requires_human_approval: true,
        reasons: ['autonomy_level_approval_required']
      }
    });
    expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'workflow.meeting_pack.bootstrapped' }),
      expect.objectContaining({ action: 'workflow.meeting_pack.calendar_inputs.ingested' })
    ]));
    const calendarIngestAudit = repository
      .listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })
      .find((entry) => entry.action === 'workflow.meeting_pack.calendar_inputs.ingested');
    expect(calendarIngestAudit).toMatchObject({
      after: {
        state_transitions: [
          'requested',
          'calendar_fetching',
          'meeting_pack_ensured',
          'loop_intents_ready',
          'skipped_inputs_reported'
        ],
        skipped_events: [],
        loop_intent_ids: [res.body.meeting_calendar_inputs.loop_intents[0].id]
      }
    });
  });
});
