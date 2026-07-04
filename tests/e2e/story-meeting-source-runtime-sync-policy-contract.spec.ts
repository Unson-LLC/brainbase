import { test, expect } from '@playwright/test';

import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

import { createMeetingSourceSettingsRouter } from '../../server/routes/meeting-source-settings.js';
import { MeetingSourceMcpSyncService } from '../../server/services/meeting-source/meeting-source-mcp-sync-service.js';

const storyId = 'story-meeting-source-runtime-sync-policy';
const initialBackfillSince = '2026-06-25T00:00:00.000Z';

async function readFile(filePath: string) {
  return fs.readFile(filePath, 'utf8');
}

async function makeApp({
  adapters = {},
  workflowService = null
}: {
  adapters?: Record<string, any>;
  workflowService?: any;
} = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-source-runtime-policy-e2e-'));
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
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return { app, service, dir };
}

test.describe(storyId, () => {
  test(`${storyId} AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 INV-1 INV-2 INV-3 INV-4 S-1 S-2 S-3 S-4 flow_replay artifact_replay scenario_clause_e2e provider-only preview uses runtime policy`, async () => {
    const story = await readFile('docs/stories/story-meeting-source-runtime-sync-policy.md');
    const spec = await readFile('docs/specs/story-meeting-source-runtime-sync-policy-spec.md');
    const architecture = await readFile('docs/architecture/story-meeting-source-runtime-sync-policy-architecture.md');
    const serviceSource = await readFile('server/services/meeting-source/meeting-source-mcp-sync-service.js');

    expect(story + spec, 'AC-1 provider status exposes sync_policy').toContain('sync_policy');
    expect(spec, 'Design Diagrams MUST-HAVE threat_model').toContain('kind: threat_model');
    expect(architecture, 'AC-6 カレンダーは補助文脈であり、同期対象のSSOTではない。').toContain('Calendar: supplementary context only');
    expect(serviceSource, 'AP-1 legacy explicit-window rejection is removed').not.toContain(['resync', 'requires', 'since'].join(' '));
    expect(serviceSource, 'AP-1 legacy bounded-window helper is removed').not.toContain('_assert' + 'BoundedWindow');

    const pollCalls: any[] = [];
    const plaudPollCalls: any[] = [];
    const workflowCalls: any[] = [];
    const pollResponses: any[][] = [
      [],
      [{
        id: 'tactiq-cursor-seed',
        title: 'Cursor seed meeting',
        transcript_text: 'cursor seed transcript',
        meeting_mode: 'online',
        resource_uri: 'mcp://tactiq/transcripts/tactiq-cursor-seed',
        updated_at: '2026-07-01T09:00:00.000Z'
      }],
      []
    ];
    const workflowService = {
      async ingestMeetingReviewPackage(reviewPackage: any, options: any) {
        workflowCalls.push({ reviewPackage, options });
        return { ok: true };
      }
    };
    const { app, service } = await makeApp({
      workflowService,
      adapters: {
        tactiq: {
          async poll(options: any) {
            pollCalls.push(options);
            return pollResponses.shift() || [];
          }
        },
        plaud: {
          async poll(options: any) {
            plaudPollCalls.push(options);
            return [];
          }
        }
      }
    });
    await service.connectProvider('tactiq', {
      account_label: 'ksato tactiq',
      credential_ref: 'secret:tactiq'
    });
    await service.connectProvider('plaud', {
      account_label: 'ksato plaud',
      credential_ref: 'secret:plaud'
    });

    const status = await request(app)
      .get('/api/settings/meeting-sources/mcp-providers')
      .expect(200);

    expect(status.body.sync_policy, 'AC-1 S-1 public sync policy').toMatchObject({
      trigger_interval_minutes: 5,
      incremental_cursor_field: 'cursor.updated_since',
      overlap_window_hours: 24,
      initial_backfill_since: initialBackfillSince,
      calendar_role: 'context_only',
      source_priority: ['tactiq_online', 'plaud_offline_or_tactiq_unavailable']
    });
    expect(JSON.stringify(status.body), 'AC-1 credential refs must not leak').not.toContain('secret:tactiq');

    const noCursorPreview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({ providers: ['tactiq'] })
      .expect(200);

    expect(noCursorPreview.body.sync_policy_mode, 'AC-2 runtime policy mode').toBe('runtime_policy');
    expect(pollCalls.at(-1), 'AC-2 AC-3 S-2 no cursor starts from initial backfill').toMatchObject({
      since: initialBackfillSince,
      until: null
    });

    const seedPreview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({
        providers: ['tactiq'],
        since: initialBackfillSince,
        org_id: 'brainbase',
        project_id: 'brainbase'
      })
      .expect(200);
    await request(app)
      .post('/api/settings/meeting-sources/resync-confirm')
      .send({ preview_id: seedPreview.body.preview_id })
      .expect(200);
    expect(workflowCalls, 'existing confirm path still ingests preview output').toHaveLength(1);

    const cursorPreview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({ providers: ['tactiq'] })
      .expect(200);

    expect(cursorPreview.body.sync_policy_mode, 'AC-4 S-3 cursor preview still uses runtime policy').toBe('runtime_policy');
    expect(pollCalls.at(-1), 'AC-4 S-3 cursor minus 24h overlap').toMatchObject({
      since: '2026-06-30T09:00:00.000Z',
      until: null
    });
    expect(cursorPreview.body.sync_policy.trigger_interval_minutes, 'AC-5 デフォルトの同期worker頻度は5分である。').toBe(5);
    expect(cursorPreview.body.sync_policy.summary, 'AC-5 summary is displayable by clients').toContain('5 minutes');
    expect(status.body.sync_policy.calendar_role, 'AC-6 カレンダーは補助文脈であり、同期対象のSSOTではない。').toBe('context_only');

    const mixedProviderPreview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({ providers: ['tactiq', 'plaud'] })
      .expect(200);

    expect(mixedProviderPreview.body.sync_policy_mode, 'S-3 provider-specific runtime windows stay in policy mode').toBe('runtime_policy');
    expect(pollCalls.at(-1), 'S-3 tactiq keeps cursor minus 24h when mixed with a no-cursor provider').toMatchObject({
      since: '2026-06-30T09:00:00.000Z',
      until: null
    });
    expect(plaudPollCalls.at(-1), 'S-2 no-cursor plaud still starts at initial backfill even when tactiq has a cursor').toMatchObject({
      since: initialBackfillSince,
      until: null
    });
  });
});
