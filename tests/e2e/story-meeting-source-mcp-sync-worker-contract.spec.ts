import { test, expect, type Page } from '@playwright/test';

import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

import { createMeetingSourceSettingsRouter } from '../../server/routes/meeting-source-settings.js';
import {
  MeetingSourceMcpSyncService,
  buildSourceEventFromArtifact,
  dedupeSourceArtifacts,
  normalizeSourceArtifact
} from '../../server/services/meeting-source/meeting-source-mcp-sync-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';

const storyId = 'story-meeting-source-mcp-sync-worker';
const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const defaultPort = isWorktree ? 31014 : 31013;
const e2ePort = process.env.BRAINBASE_E2E_PORT || (isWorktree ? String(defaultPort) : (process.env.BRAINBASE_PORT || process.env.PORT || String(defaultPort)));
const baseUrl = process.env.BRAINBASE_BASE_URL || `http://localhost:${e2ePort}`;

function readFile(filePath: string) {
  return fs.readFileSync(filePath, 'utf8');
}

async function fulfillJson(route: any, body: any, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function openApp(page: Page) {
  await page.goto(baseUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.brainbaseApp !== undefined);
}

function defaultMeetingSourcePreviewBody() {
  return {
    preview_id: 'preview_provider_skip_reasons',
    dry_run: true,
    artifact_count: 0,
    expected_meeting_pack_count: 0,
    provider_results: [
      { provider: 'tactiq', artifact_count: 0, skipped: true, reason: 'adapter_not_configured' },
      { provider: 'plaud', artifact_count: 0, skipped: true, reason: 'provider_not_connected' }
    ],
    clusters: [],
    errors: []
  };
}

async function stubSettingsMeetingSourceRoutes(page: Page, previewBody: any = defaultMeetingSourcePreviewBody()) {
  await page.route('**/api/config/integrity', route => fulfillJson(route, {
    stats: { projects: 1 },
    summary: { errors: 0, warnings: 0 },
    issues: []
  }));
  await page.route('**/api/config/unified', route => fulfillJson(route, { sections: [] }));
  await page.route('**/api/config/organizations', route => fulfillJson(route, []));
  await page.route('**/api/config/notifications', route => fulfillJson(route, { channels: {}, dnd: {} }));
  await page.route('**/api/config', route => fulfillJson(route, {
    projects: { projects: [{ id: 'brainbase', emoji: '' }] },
    slack: { workspaces: {}, channels: [], members: [] },
    github: [],
    nocodb: []
  }));
  await page.route('**/api/health', route => fulfillJson(route, { ok: true }));
  await page.route('**/api/state', route => fulfillJson(route, { sessions: [], preferences: {} }));
  await page.route('**/api/settings/meeting-sources/mcp-providers', route => fulfillJson(route, {
    providers: [
      {
        provider: 'tactiq',
        enabled: true,
        auth_status: 'connected',
        account_label: 'ksato tactiq',
        has_credential_ref: true,
        capabilities: ['online_transcript', 'mcp_resource'],
        cursor: {}
      },
      {
        provider: 'plaud',
        enabled: false,
        auth_status: 'disconnected',
        account_label: '',
        has_credential_ref: false,
        capabilities: ['offline_recording', 'call_recording', 'mcp_resource'],
        cursor: {}
      }
    ]
  }));
  await page.route('**/api/settings/meeting-sources/resync-preview', route => fulfillJson(route, previewBody));
}

async function createSyncFixture({
  adapters = {},
  workflowService = null
}: {
  adapters?: Record<string, any>;
  workflowService?: any;
} = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'meeting-source-e2e-'));
  const service = new MeetingSourceMcpSyncService({
    stateFile: path.join(dir, 'state.json'),
    adapters,
    workflowService,
    clock: () => '2026-07-02T00:00:00.000Z'
  });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = { sub: 'per_keigo', role: 'gm' };
    req.access = { role: 'gm', personId: 'per_keigo', projectCodes: ['brainbase'] };
    next();
  });
  app.use('/api/settings/meeting-sources', createMeetingSourceSettingsRouter(service));
  app.use((err: any, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return { app, service, dir };
}

function createRealWorkflowServiceFixture() {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'brainbase', session_select: true }
        ]
      };
    }
  };
  const workflowService = new WorkflowService({ repository, runner, configParser });
  const actor = {
    sub: 'per_keigo',
    personId: 'per_keigo',
    role: 'admin',
    projectCodes: ['brainbase']
  };
  return { repository, workflowService, actor };
}

test.describe(storyId, () => {
  test('ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 ac:12 ac:13 S-001 S-002 S-003 story-meeting-source-mcp-sync-worker traceability contract', () => {
    const story = readFile('docs/stories/story-meeting-source-mcp-sync-worker.md');
    const runtimePolicyStory = readFile('docs/stories/story-meeting-source-runtime-sync-policy.md');
    const spec = readFile('docs/specs/story-meeting-source-mcp-sync-worker-spec.md');
    const architecture = readFile('docs/architecture/meeting-source-mcp-sync-worker-architecture.md');
    const service = readFile('server/services/meeting-source/meeting-source-mcp-sync-service.js');
    const adapters = readFile('server/services/meeting-source/meeting-source-mcp-adapters.js');
    const coreServices = readFile('server/bootstrap/core-services.js');
    const server = readFile('server.js');
    const gracefulShutdown = readFile('server/bootstrap/graceful-shutdown.js');
    const route = readFile('server/routes/meeting-source-settings.js');
    const settingsUi = readFile('public/modules/settings/settings-core.js');

    // story-meeting-source-mcp-sync-worker ac:1 AC-001: Tactiq/Plaud MCP artifactをMeeting Packのsource_eventへ変換できる。
    expect(story + service, `${storyId} ac:1 AC-001 source_event`).toContain('buildSourceEventFromArtifact');
    // story-meeting-source-mcp-sync-worker ac:2 AC-002: onlineはTactiq、offline/callはPlaudを一次ソースにできる。
    expect(story + service, `${storyId} ac:2 AC-002 source priority`).toContain("artifact.meeting_mode === 'online' && artifact.provider === 'tactiq'");
    // story-meeting-source-mcp-sync-worker ac:3 AC-003: transcript hash/resource uriで重複sourceを束ねる。
    expect(story + service, `${storyId} ac:3 AC-003 dedupe`).toContain('dedupeSourceArtifacts');
    // story-meeting-source-mcp-sync-worker ac:4 AC-004: transcript_sha256/content_hash/mcp_resource_uriをsource_eventへ残す。
    expect(story + service, `${storyId} ac:4 AC-004 evidence fields`).toContain('transcript_sha256');
    // story-meeting-source-mcp-sync-worker ac:5 AC-005: dry-run previewはruntime policyでbounded windowを解決できる。
    expect(runtimePolicyStory + service, `${storyId} ac:5 AC-005 runtime policy preview`).toContain('providers` だけでも成功');
    expect(service, `${storyId} ac:5 AC-005 provider runtime window`).toContain('_runtimePolicySince');
    // story-meeting-source-mcp-sync-worker ac:6 AC-006: confirm時だけMeeting Pack ingestへ送る。
    expect(story + service, `${storyId} ac:6 AC-006 confirm ingest`).toContain('workflowService.ingestMeetingReviewPackage');
    expect(service + server, `${storyId} ac:6 AC-006 scheduled worker`).toContain('startScheduledSync');
    // story-meeting-source-mcp-sync-worker ac:7 AC-007: 片方のprovider障害はもう片方の同期を止めない。
    expect(story + service, `${storyId} ac:7 AC-007 provider isolation`).toContain('errors.push');
    // story-meeting-source-mcp-sync-worker ac:8 AC-008: Calendarに存在しない電話/雑談もsource artifactから同期できる。
    expect(architecture + service, `${storyId} ac:8 AC-008 calendar independent`).toContain('calendar_event_id: raw.calendar_event_id || null');
    // story-meeting-source-mcp-sync-worker ac:9 AC-009: Settings UIでMCP providerの接続/疎通/解除を管理できる。
    expect(route + settingsUi, `${storyId} ac:9 AC-009 settings provider management`).toContain('/mcp-providers');
    expect(adapters + coreServices, `${storyId} ac:9 AC-009 mcp adapter wiring`).toContain('createMeetingSourceMcpAdaptersFromEnv');
    // story-meeting-source-mcp-sync-worker ac:10 AC-010: credential_refをAPIレスポンスに漏らさない。
    expect(story + service, `${storyId} ac:10 AC-010 credential redaction`).toContain('credential_ref: _credentialRef');
    // story-meeting-source-mcp-sync-worker ac:11 AC-011: dry-run結果をoperatorが確認してから反映できる。
    expect(route + settingsUi, `${storyId} ac:11 AC-011 preview then confirm`).toContain('/resync-preview');
    expect(route + settingsUi, `${storyId} ac:11 AC-011 preview then confirm`).toContain('/resync-confirm');
    // story-meeting-source-mcp-sync-worker ac:12 AC-012: workerのcursorは成功submit後だけ進む。
    expect(story + service, `${storyId} ac:12 AC-012 cursor advancement`).toContain('last_seen_external_id');
    expect(gracefulShutdown, `${storyId} ac:12 AC-012 scheduler shutdown`).toContain('stopScheduledSync');
    // story-meeting-source-mcp-sync-worker ac:13 AC-013: graceful shutdownはMeeting Source MCP workerをsession runtime cleanup前に停止する。
    expect(story + spec, `${storyId} ac:13 AC-013 shutdown contract`).toContain('AC-013');
    expect(gracefulShutdown, `${storyId} ac:13 AC-013 stop worker`).toContain('stop-meeting-source-mcp-sync');
    expect(gracefulShutdown.indexOf('stop-meeting-source-mcp-sync'), `${storyId} ac:13 AC-013 stop before session cleanup`)
      .toBeLessThan(gracefulShutdown.indexOf('cleanup-session-runtime'));
    // story-meeting-source-mcp-sync-worker S-001 S-002 S-003: source_event、provider isolation、Settings運用の3つをStory contractに含める。
    expect(spec + architecture, `${storyId} S-001 S-002 S-003`).toContain('S-001');
    expect(spec + architecture, `${storyId} S-001 S-002 S-003`).toContain('S-002');
    expect(spec + architecture, `${storyId} S-001 S-002 S-003`).toContain('S-003');
  });

  test(`${storyId} ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:12 AC-001 AC-002 AC-003 AC-004 AC-005 AC-006 AC-012 Tactiq/PlaudをdedupeしMeeting Packへconfirmする`, async () => {
    const workflowService = {
      calls: [] as any[],
      async ingestMeetingReviewPackage(reviewPackage: any, options: any) {
        this.calls.push({ reviewPackage, options });
        return { ok: true };
      }
    };
    const { app, service } = await createSyncFixture({
      workflowService,
      adapters: {
        tactiq: {
          async poll({ since }: any) {
            expect(since).toBe('2026-06-25T00:00:00.000Z');
            return [{
              id: 'tactiq-online-1',
              title: 'Online strategy meeting',
              transcript_text: 'same transcript from online meeting',
              note_text: '# Tactiq provider minutes\nDo not adopt provider minutes.',
              meeting_mode: 'online',
              calendar_event_id: 'calendar-optional',
              participants: [{ name: 'Keigo Sato' }],
              resource_uri: 'mcp://tactiq/transcripts/tactiq-online-1',
              updated_at: '2026-06-25T03:00:00.000Z'
            }];
          }
        },
        plaud: {
          async poll() {
            return [{
              id: 'plaud-online-1',
              title: 'Online strategy meeting',
              transcript_text: 'same transcript from online meeting',
              note_text: '# Plaud provider note\nDo not adopt Plaud provider text.',
              meeting_mode: 'online',
              participants: [{ name: 'Keigo Sato' }],
              resource_uri: 'mcp://plaud/recordings/plaud-online-1',
              updated_at: '2026-06-25T03:05:00.000Z'
            }];
          }
        }
      }
    });
    await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });
    await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

    const preview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({
        providers: ['tactiq', 'plaud'],
        since: '2026-06-25T00:00:00.000Z',
        org_id: 'brainbase',
        project_id: 'brainbase',
        case_scope: 'meeting-source-e2e'
      })
      .expect(200);

    // ac:1 ac:2 ac:3 ac:5 / AC-001 AC-002 AC-003 AC-005: bounded dry-runで2 providerを1 meeting clusterへ束ね、online一次ソースはTactiqにする。
    expect(preview.body.dry_run).toBe(true);
    expect(preview.body.artifact_count).toBe(2);
    expect(preview.body.expected_meeting_pack_count).toBe(1);
    expect(preview.body.excluded_from_meeting_pack_count).toBe(0);
    expect(preview.body.meeting_pack_exclusions).toEqual([]);
    expect(preview.body.clusters[0]).toMatchObject({
      primary_source: {
        provider: 'tactiq',
        mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-online-1',
        has_text: true
      },
      supporting_sources: [
        expect.objectContaining({ provider: 'plaud' })
      ],
      providers: ['tactiq', 'plaud']
    });

    const confirmed = await request(app)
      .post('/api/settings/meeting-sources/resync-confirm')
      .send({ preview_id: preview.body.preview_id })
      .expect(200);

    // ac:4 ac:6 ac:12 / AC-004 AC-006 AC-012: confirm後だけsource_event証跡付きでMeeting Pack ingestへ渡し、成功providerのcursorを進める。
    expect(confirmed.body.submitted).toBe(true);
    expect(JSON.stringify(confirmed.body.review_packages)).not.toContain('Tactiq provider minutes');
    expect(confirmed.body.review_packages[0].meeting_note_summary.body).toBe('[redacted]');
    expect(confirmed.body.review_packages[0].meeting_note_summary.body_redacted).toBe(true);
    expect(confirmed.body.review_packages[0].meeting_note_summary.source_transcripts[0].text).toBeUndefined();
    expect(confirmed.body.review_packages[0].meeting_note_summary.source_transcripts[0].text_redacted).toBe(true);
    // Candidates start empty (awaiting Eve); the pull-based reconciler fills them post-ingest.
    expect(confirmed.body.review_packages[0].task_candidates).toEqual([]);
    expect(confirmed.body.review_packages[0].decision_candidates).toEqual([]);
    expect(confirmed.body.review_packages[0].follow_up_draft).toMatchObject({
      status: 'awaiting_eve_generation',
      external_send_required_approval: true,
      body: ''
    });
    expect(workflowService.calls).toHaveLength(1);
    expect(workflowService.calls[0].reviewPackage).toMatchObject({
      org_id: 'brainbase',
      project_id: 'brainbase',
      review_package: {
        org_id: 'brainbase',
        project_id: 'brainbase',
        case_scope: 'meeting-source-e2e',
        source_event: {
          source_system: 'tactiq',
          source_kind: 'transcript',
          provider: 'tactiq',
          source_provider: 'tactiq',
          source_id: 'tactiq-online-1',
          provider_source_id: 'tactiq-online-1',
          mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-online-1',
          transcript_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          calendar_event_id: 'calendar-optional',
          ingested_by: 'meeting_source_mcp_sync_worker',
          meeting_mode: 'online'
        },
        supporting_source_events: [
          expect.objectContaining({
            provider: 'plaud',
            mcp_resource_uri: 'mcp://plaud/recordings/plaud-online-1'
          })
        ],
        loop_intent_ids: expect.objectContaining({
          transcript_to_meeting_note: expect.any(String),
          meeting_note_to_tasks: expect.any(String),
          meeting_note_to_decisions: expect.any(String),
          post_meeting_follow_up_message: expect.any(String)
        }),
        meeting_note_summary: expect.objectContaining({
          title: 'Online strategy meeting',
          generator: 'brainbase_meeting_pack',
          generation_source: 'transcript_to_meeting_note',
          generation_status: 'brainbase_source_ready',
          provider_note_authoritative: false,
          source_text_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          source_transcripts: [
            expect.objectContaining({
              role: 'primary',
              provider: 'tactiq',
              mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-online-1',
              text: 'same transcript from online meeting',
              source_text_kind: 'transcript',
              authoritative_for_minutes: true
            }),
            expect.objectContaining({
              role: 'supporting',
              provider: 'plaud',
              mcp_resource_uri: 'mcp://plaud/recordings/plaud-online-1',
              text: 'same transcript from online meeting',
              source_text_kind: 'transcript',
              authoritative_for_minutes: true
            })
          ]
        }),
        task_candidates: [],
        decision_candidates: [],
        follow_up_draft: expect.objectContaining({
          status: 'awaiting_eve_generation',
          external_send_required_approval: true,
          body: ''
        }),
        promotion_candidates: expect.any(Object),
        meeting_identity: {
          title: 'Online strategy meeting',
          source: 'mcp_meeting_source',
          mode: 'online',
          candidate_org_id: 'brainbase',
          candidate_project_id: 'brainbase'
        }
      },
    });
    const meetingNoteSummary = workflowService.calls[0].reviewPackage.review_package.meeting_note_summary;
    expect(meetingNoteSummary.body).toContain('Brainbase Meeting Pack');
    expect(meetingNoteSummary.body).toContain('same transcript from online meeting');
    expect(meetingNoteSummary.body).not.toContain('Tactiq provider minutes');
    expect(meetingNoteSummary.body).not.toContain('Plaud provider note');
    expect(meetingNoteSummary.source_text_hash).toBe(
      workflowService.calls[0].reviewPackage.review_package.source_event.content_sha256
    );

    const statuses = await request(app)
      .get('/api/settings/meeting-sources/mcp-providers')
      .expect(200);
    expect(statuses.body.providers.find((provider: any) => provider.provider === 'tactiq').cursor.updated_since).toBe('2026-06-25T03:00:00.000Z');
    expect(statuses.body.providers.find((provider: any) => provider.provider === 'plaud').cursor.updated_since).toBe('2026-06-25T03:05:00.000Z');
  });

  test(`${storyId} ac:7 ac:8 AC-007 AC-008 Tactiq障害時もPlaudの電話/雑談sourceをCalendarなしでpreviewできる`, async () => {
    const { app, service } = await createSyncFixture({
      adapters: {
        tactiq: {
          async poll() {
            throw new Error('tactiq mcp timeout');
          }
        },
        plaud: {
          async poll() {
            return [{
              id: 'plaud-call-1',
              title: 'Phone call without calendar event',
              transcript_text: 'offline call transcript',
              meeting_mode: 'call',
              phone_number: '+81-3-0000-0000',
              resource_uri: 'mcp://plaud/recordings/plaud-call-1',
              updated_at: '2026-06-25T04:00:00.000Z'
            }];
          }
        }
      }
    });
    await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });
    await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

    const preview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({
        providers: ['tactiq', 'plaud'],
        since: '2026-06-25T00:00:00.000Z',
        org_id: 'brainbase',
        project_id: 'brainbase'
      })
      .expect(200);

    // ac:7 / AC-007: provider障害はerrorsへ隔離され、成功分は候補として残る。
    expect(preview.body.errors).toEqual([{ provider: 'tactiq', message: 'tactiq mcp timeout' }]);
    expect(preview.body.provider_results).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'tactiq', artifact_count: 0, error: 'tactiq mcp timeout' }),
      expect.objectContaining({ provider: 'plaud', artifact_count: 1, skipped: false })
    ]));
    // ac:8 / AC-008: Calendar予定が存在しない電話/雑談でもPlaud artifactだけでMeeting Pack候補になる。
    expect(preview.body.clusters).toHaveLength(1);
    expect(preview.body.clusters[0].primary_source).toMatchObject({
      provider: 'plaud',
      meeting_mode: 'call',
      raw_metadata: { calendar_event_id: null }
    });
  });

  test(`${storyId} ac:6 ac:12 AC-006 AC-012 confirmは実WorkflowServiceのMeeting Review Package ingest契約で通る`, async () => {
    const { repository, workflowService, actor } = createRealWorkflowServiceFixture();
    const { service } = await createSyncFixture({
      workflowService,
      adapters: {
        tactiq: {
          async poll() {
            return [{
              id: 'tactiq-real-ingest-1',
              title: 'Real ingest contract meeting',
              transcript_text: 'real workflow ingest text',
              meeting_mode: 'online',
              resource_uri: 'mcp://tactiq/transcripts/tactiq-real-ingest-1',
              updated_at: '2026-06-25T05:00:00.000Z'
            }];
          }
        }
      }
    });
    await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });

    const preview = await service.previewResync({
      providers: ['tactiq'],
      since: '2026-06-25T00:00:00.000Z',
      org_id: 'brainbase',
      project_id: 'brainbase',
      case_scope: 'real-workflow-ingest'
    });
    const confirmed = await service.confirmResync({ preview_id: preview.preview_id, actor });

    // ac:6 ac:12 / AC-006 AC-012: 実WorkflowServiceにreview_package封筒で入り、run/output/human stepまで作成される。
    expect(confirmed.submitted).toBe(true);
    expect(repository.ledger.runs).toHaveLength(1);
    expect(repository.ledger.outputs.map((output: any) => output.type)).toEqual(expect.arrayContaining([
      'meeting_note_draft',
      'task_candidates',
      'decision_candidates',
      'message_draft',
      'promotion_candidates'
    ]));
    expect(repository.ledger.human_steps.map((step: any) => step.reason)).toEqual(expect.arrayContaining([
      'required_before_publish',
      'required_before_task_create',
      'required_before_graph_promotion',
      'required_before_external_send',
      'required_before_candidate_promotion'
    ]));
    expect(repository.ledger.runs[0].metadata.source_event).toMatchObject({
      source_system: 'tactiq',
      provider: 'tactiq',
      mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-real-ingest-1'
    });
  });

  test(`${storyId} ac:6 ac:12 AC-006 AC-012 scheduled worker advances cursor for provider notes but does not submit them as Brainbase minutes`, async () => {
    const workflowService = {
      calls: [] as any[],
      async ingestMeetingReviewPackage(reviewPackage: any, options: any) {
        this.calls.push({ reviewPackage, options });
        return { ok: true };
      }
    };
    const { service } = await createSyncFixture({
      workflowService,
      adapters: {
        tactiq: {
          async poll() {
            return [{
              id: 'tactiq-provider-note-only-1',
              title: 'Provider note only',
              note_text: '# Tactiq AI Minutes\nThis provider note must not become Brainbase minutes.',
              meeting_mode: 'online',
              resource_uri: 'mcp://tactiq/transcripts/tactiq-provider-note-only-1',
              updated_at: '2026-06-25T06:00:00.000Z'
            }];
          }
        }
      }
    });
    await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });

    const result = await service.runScheduledSync({
      providers: ['tactiq'],
      updated_since: '2026-06-25T00:00:00.000Z',
      org_id: 'brainbase',
      project_id: 'brainbase'
    });
    const statuses = await service.listProviderStatuses();

    // ac:6 ac:12 / AC-006 AC-012: provider noteはBrainbase議事録本文にせず、処理済みcursorだけを進めて再同期ループを防ぐ。
    expect(result).toMatchObject({
      ok: true,
      submitted: false,
      reason: 'no_transcript_artifacts_for_meeting_pack',
      artifact_count: 1,
      excluded_from_meeting_pack_count: 1,
      meeting_pack_count: 0,
      cursor_advanced_for_excluded_artifacts: true
    });
    expect(workflowService.calls).toHaveLength(0);
    expect(statuses.providers.find((provider: any) => provider.provider === 'tactiq').cursor.updated_since).toBe('2026-06-25T06:00:00.000Z');
    expect(statuses.providers.find((provider: any) => provider.provider === 'tactiq').cursor.last_seen_external_id).toBe('tactiq-provider-note-only-1');
  });

  test(`${storyId} ac:9 ac:10 ac:11 S-003 AC-009 AC-010 AC-011 Settings APIで接続管理・credential redaction・preview必須を保証する`, async () => {
    const { app } = await createSyncFixture({
      adapters: {
        tactiq: {
          async test() {
            return { ok: true, auth_status: 'connected' };
          }
        }
      }
    });

    const connect = await request(app)
      .post('/api/settings/meeting-sources/mcp-providers/tactiq/connect')
      .send({ account_label: 'ksato tactiq', credential_ref: 'secret:tactiq-token' })
      .expect(200);
    // ac:9 ac:10 / AC-009 AC-010: Settings APIで接続でき、credential_refは返さない。
    expect(connect.body).toMatchObject({
      provider: 'tactiq',
      enabled: true,
      auth_status: 'connected',
      account_label: 'ksato tactiq',
      has_credential_ref: true
    });
    expect(JSON.stringify(connect.body)).not.toContain('secret:tactiq-token');

    const status = await request(app)
      .get('/api/settings/meeting-sources/mcp-providers')
      .expect(200);
    expect(status.body.providers.find((provider: any) => provider.provider === 'tactiq')).not.toHaveProperty('credential_ref');
    expect(JSON.stringify(status.body)).not.toContain('secret:tactiq-token');

    const testProvider = await request(app)
      .post('/api/settings/meeting-sources/mcp-providers/tactiq/test')
      .send({})
      .expect(200);
    expect(testProvider.body).toMatchObject({ provider: 'tactiq', ok: true, auth_status: 'connected' });

    const runtimePolicyPreview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({ providers: ['tactiq'] })
      .expect(200);
    // ac:11 / AC-011: operatorはruntime policyで解決されたbounded dry-runを見てからconfirmする。
    expect(runtimePolicyPreview.body).toMatchObject({
      dry_run: true,
      sync_policy_mode: 'runtime_policy',
      artifact_count: 0,
      expected_meeting_pack_count: 0
    });
    expect(runtimePolicyPreview.body.provider_results).toEqual([
      expect.objectContaining({
        provider: 'tactiq',
        skipped: true,
        reason: 'adapter_not_configured'
      })
    ]);

    const disconnect = await request(app)
      .post('/api/settings/meeting-sources/mcp-providers/tactiq/disconnect')
      .send({})
      .expect(200);
    expect(disconnect.body).toMatchObject({
      provider: 'tactiq',
      enabled: false,
      auth_status: 'disconnected',
      has_credential_ref: false
    });
  });

  test(`${storyId} ac:7 ac:9 ac:11 S-003 provider_results_ui Settings previewでprovider別skip理由を表示する`, async ({ page }) => {
    await stubSettingsMeetingSourceRoutes(page);
    await openApp(page);
    await page.waitForFunction(() => Boolean(window.brainbaseApp?.settingsCore));

    await page.evaluate(async () => {
      window.brainbaseApp.settingsCore.currentTab = 'integrations';
      window.brainbaseApp.settingsCore.pendingIntegrationSubTab = 'meeting-sources';
      await window.brainbaseApp.settingsCore.ui.openModal();
    });

    await expect(page.locator('#integration-detail-meeting-sources')).toHaveClass(/active/);
    await page.locator('#meeting-source-since').fill('2026-06-25T00:00');
    await page.locator('#meeting-source-org').fill('brainbase');
    await page.locator('#meeting-source-project').fill('brainbase');
    await page.locator('#meeting-source-preview-btn').click();

    const providerResults = page.locator('[data-meeting-source-provider-results]');
    await expect(providerResults).toBeVisible();
    await expect(providerResults).toContainText('tactiq');
    await expect(providerResults).toContainText('adapter_not_configured');
    await expect(providerResults).toContainText('plaud');
    await expect(providerResults).toContainText('provider_not_connected');
    await expect(page.locator('#meeting-source-preview-result')).toContainText('providerの状態と理由を確認してください');
  });

  test(`${storyId} ac:9 ac:10 ac:11 S-003 settings_ui shows sync policy and source preview details`, async ({ page }) => {
    await stubSettingsMeetingSourceRoutes(page, {
      preview_id: 'preview_source_details',
      dry_run: true,
      artifact_count: 2,
      expected_meeting_pack_count: 1,
      provider_results: [
        { provider: 'tactiq', artifact_count: 1, skipped: false },
        { provider: 'plaud', artifact_count: 1, skipped: false }
      ],
      clusters: [{
        source_cluster_id: 'msrc_online_1',
        title: 'Online strategy meeting',
        meeting_mode: 'online',
        providers: ['tactiq', 'plaud'],
        primary_source: {
          provider: 'tactiq',
          provider_source_id: 'tactiq-online-1',
          external_id: 'tactiq-online-1',
          mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-online-1'
        },
        supporting_sources: [{
          provider: 'plaud',
          provider_source_id: 'plaud-online-1',
          external_id: 'plaud-online-1',
          mcp_resource_uri: 'mcp://plaud/recordings/plaud-online-1'
        }]
      }],
      errors: []
    });
    await openApp(page);

    await page.evaluate(async () => {
      window.brainbaseApp.settingsCore.currentTab = 'integrations';
      window.brainbaseApp.settingsCore.pendingIntegrationSubTab = 'meeting-sources';
      await window.brainbaseApp.settingsCore.ui.openModal();
    });

    await expect(page.locator('#integration-detail-meeting-sources')).toHaveClass(/active/);
    await expect(page.locator('#meeting-source-poll-interval-minutes')).toHaveValue('15');
    await expect(page.locator('#meeting-source-overlap-hours')).toHaveValue('24');
    await expect(page.locator('#meeting-source-provider-priority')).toHaveValue('mode_default');
    await page.locator('#meeting-source-since').fill('2026-06-25T00:00');
    await page.locator('#meeting-source-org').fill('brainbase');
    await page.locator('#meeting-source-project').fill('brainbase');
    await page.locator('#meeting-source-preview-btn').click();

    const previewResult = page.locator('#meeting-source-preview-result');
    await expect(previewResult).toContainText('expected Meeting Pack: 1');
    await expect(previewResult).toContainText('Primary Source');
    await expect(previewResult).toContainText('tactiq:tactiq-online-1');
    await expect(previewResult).toContainText('Supporting Sources');
    await expect(previewResult).toContainText('plaud:plaud-online-1');
  });

  test(`${storyId} ac:1 ac:2 ac:3 ac:4 AC-001 AC-002 AC-003 AC-004 pure source_event helpers keep MCP evidence stable`, () => {
    const tactiq = normalizeSourceArtifact({
      id: 'tactiq-1',
      title: 'Evidence meeting',
      transcript_text: 'stable evidence text',
      meeting_mode: 'online',
      resource_uri: 'mcp://tactiq/transcripts/tactiq-1',
      updated_at: '2026-06-25T01:00:00.000Z'
    }, 'tactiq');
    const plaud = normalizeSourceArtifact({
      id: 'plaud-1',
      title: 'Evidence meeting',
      transcript_text: 'stable evidence text',
      meeting_mode: 'online',
      resource_uri: 'mcp://plaud/recordings/plaud-1',
      updated_at: '2026-06-25T01:05:00.000Z'
    }, 'plaud');

    const [cluster] = dedupeSourceArtifacts([plaud, tactiq]);
    const sourceEvent = buildSourceEventFromArtifact(cluster.primary_source, {
      sourceClusterId: cluster.source_cluster_id,
      supportingSources: cluster.supporting_sources
    });

    expect(cluster.primary_source.provider).toBe('tactiq');
    expect(cluster.supporting_sources.map((source) => source.provider)).toEqual(['plaud']);
    expect(sourceEvent).toMatchObject({
      source_system: 'tactiq',
      source_provider: 'tactiq',
      provider: 'tactiq',
      source_kind: 'transcript',
      provider_role: 'online_primary',
      source_cluster_id: cluster.source_cluster_id,
      source_id: 'tactiq-1',
      provider_source_id: 'tactiq-1',
      mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-1',
      artifact_ref: 'mcp://tactiq/transcripts/tactiq-1',
      transcript_sha256: tactiq.transcript_hash,
      content_sha256: tactiq.transcript_hash,
      content_hash: tactiq.transcript_hash,
      supporting_source_count: 1
    });
  });
});
