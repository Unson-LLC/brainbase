import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createMeetingSourceSettingsRouter } from '../../../server/routes/meeting-source-settings.js';
import { MeetingSourceMcpSyncService } from '../../../server/services/meeting-source/meeting-source-mcp-sync-service.js';

async function makeApp({ adapters = {}, workflowService = null } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-source-route-'));
    const service = new MeetingSourceMcpSyncService({
        stateFile: path.join(dir, 'state.json'),
        adapters,
        workflowService,
        clock: () => '2026-07-02T00:00:00.000Z'
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.actor = { sub: 'per_keigo', role: 'gm' };
        req.access = { role: 'gm', personId: 'per_keigo', projectCodes: ['brainbase'] };
        next();
    });
    app.use('/api/settings/meeting-sources', createMeetingSourceSettingsRouter(service));
    return { app, service };
}

describe('meeting source settings routes', () => {
    it('lists provider statuses without leaking credential refs', async () => {
        const { app, service } = await makeApp();
        await service.connectProvider('tactiq', {
            account_label: 'ksato tactiq',
            credential_ref: 'plain-secret-ref'
        });

        const res = await request(app)
            .get('/api/settings/meeting-sources/mcp-providers')
            .expect(200);

        expect(res.body.providers.find(p => p.provider === 'tactiq')).toMatchObject({
            provider: 'tactiq',
            enabled: true,
            auth_status: 'connected',
            has_credential_ref: true
        });
        expect(JSON.stringify(res.body)).not.toContain('plain-secret-ref');
        expect(res.body.providers.find(p => p.provider === 'tactiq')).not.toHaveProperty('credential_ref');
    });

    it('connects and tests a provider through POST endpoints', async () => {
        const { app } = await makeApp({
            adapters: {
                plaud: {
                    test: vi.fn(async () => ({ ok: true, auth_status: 'connected' }))
                }
            }
        });

        const connect = await request(app)
            .post('/api/settings/meeting-sources/mcp-providers/plaud/connect')
            .send({ account_label: 'ksato plaud', credential_ref: 'secret:plaud' })
            .expect(200);
        expect(connect.body.account_label).toBe('ksato plaud');
        expect(JSON.stringify(connect.body)).not.toContain('secret:plaud');

        const test = await request(app)
            .post('/api/settings/meeting-sources/mcp-providers/plaud/test')
            .send({})
            .expect(200);
        expect(test.body.ok).toBe(true);
    });

    it('requires a bounded resync window before dry-run', async () => {
        const { app } = await makeApp();

        const res = await request(app)
            .post('/api/settings/meeting-sources/resync-preview')
            .send({ providers: ['tactiq'] })
            .expect(400);

        expect(res.body.error).toContain('resync requires');
    });

    it('returns conflict when confirm is called without a dry-run preview', async () => {
        const { app } = await makeApp();

        const res = await request(app)
            .post('/api/settings/meeting-sources/resync-confirm')
            .send({ preview_id: 'missing-preview' })
            .expect(409);

        expect(res.body.error).toContain('preview not found');
    });

    it('submits confirmed preview to review ingest through the UI-facing route', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const { app, service } = await makeApp({
            workflowService,
            adapters: {
                tactiq: {
                    poll: vi.fn(async () => [{
                        id: 'tactiq-1',
                        title: 'Online source',
                        transcript_text: 'meeting text',
                        meeting_mode: 'online',
                        updated_at: '2026-06-25T03:00:00.000Z'
                    }])
                }
            }
        });
        await service.connectProvider('tactiq', {
            account_label: 'ksato tactiq',
            credential_ref: 'secret:tactiq'
        });
        const preview = await request(app)
            .post('/api/settings/meeting-sources/resync-preview')
            .send({
                providers: ['tactiq'],
                since: '2026-06-25T00:00:00.000Z',
                org_id: 'brainbase',
                project_id: 'brainbase'
            })
            .expect(200);

        const confirmed = await request(app)
            .post('/api/settings/meeting-sources/resync-confirm')
            .send({ preview_id: preview.body.preview_id })
            .expect(200);

        expect(confirmed.body.submitted).toBe(true);
        expect(workflowService.ingestMeetingReviewPackage).toHaveBeenCalledTimes(1);
        expect(workflowService.ingestMeetingReviewPackage.mock.calls[0][0]).toMatchObject({
            org_id: 'brainbase',
            project_id: 'brainbase',
            review_package: expect.objectContaining({
                org_id: 'brainbase',
                project_id: 'brainbase',
                source_event: expect.objectContaining({ source_system: 'tactiq' }),
                meeting_note_summary: expect.any(Object),
                task_candidates: [],
                decision_candidates: [],
                follow_up_draft: expect.any(Object),
                promotion_candidates: expect.any(Object)
            })
        });
    });
});
