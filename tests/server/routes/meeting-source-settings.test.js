import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createMeetingSourceSettingsRouter } from '../../../server/routes/meeting-source-settings.js';
import { MeetingSourceMcpSyncService } from '../../../server/services/meeting-source/meeting-source-mcp-sync-service.js';
import { MeetingSourceIntegrationCatalogService } from '../../../server/services/meeting-source/meeting-source-integration-catalog.js';

async function makeApp({ adapters = {}, workflowService = null, integrationCatalogService = null } = {}) {
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
    app.use('/api/settings/meeting-sources', createMeetingSourceSettingsRouter(service, {
        integrationCatalogService
    }));
    return { app, service };
}

describe('meeting source settings routes', () => {
    it('BDD_INTEGRATION_CATALOG_INV1_INV2 exposes integrations.sh-backed effective provider catalog without live network', async () => {
        const fetchImpl = vi.fn();
        const integrationCatalogService = new MeetingSourceIntegrationCatalogService({
            fetchImpl,
            clock: () => '2026-07-02T00:00:00.000Z'
        });
        const { app } = await makeApp({ integrationCatalogService });

        const res = await request(app)
            .get('/api/settings/meeting-sources/integration-catalog')
            .expect(200);

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(res.body).toMatchObject({
            version: 1,
            generated_at: '2026-07-02T00:00:00.000Z',
            upstream: {
                name: 'integrations.sh',
                purpose: expect.stringContaining('Brainbase override')
            }
        });
        expect(res.body.providers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: 'tactiq',
                domain: 'tactiq.io',
                role: 'online_primary',
                catalog_source: 'brainbase_override',
                catalog_status: 'override_required',
                effective: true,
                surfaces: [expect.objectContaining({
                    type: 'mcp',
                    configured_by: 'brainbase_mcp_runtime',
                    confidence: 'manual_override'
                })],
                auth: expect.objectContaining({
                    managed_by: 'brainbase_runtime',
                    credential_ref_required: true,
                    local_secret_storage: false
                }),
                upstream: expect.objectContaining({
                    name: 'integrations.sh',
                    detect_status: 'not_queried'
                }),
                upstream_detect: null
            }),
            expect.objectContaining({
                provider: 'plaud',
                domain: 'plaud.ai',
                role: 'offline_or_call_primary',
                catalog_source: 'brainbase_override',
                catalog_status: 'override_required',
                effective: true
            })
        ]));
    });

    it('BDD_INTEGRATION_CATALOG_INV3 refreshes one provider against integrations.sh and keeps Brainbase override effective', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                found: ['llms.txt', 'oauth-protected-resource'],
                mcp: [],
                integrationsJson: null,
                auth: ['oauth-protected-resource']
            })
        }));
        const integrationCatalogService = new MeetingSourceIntegrationCatalogService({ fetchImpl });
        const { app } = await makeApp({ integrationCatalogService });

        const res = await request(app)
            .post('/api/settings/meeting-sources/integration-catalog/tactiq/refresh')
            .send({})
            .expect(200);

        expect(fetchImpl).toHaveBeenCalledWith('https://integrations.sh/api/tactiq.io/detect', {
            headers: { accept: 'application/json' }
        });
        expect(res.body).toMatchObject({
            provider: 'tactiq',
            effective: true,
            catalog_source: 'brainbase_override',
            upstream_detect: {
                ok: true,
                status: 200,
                found: ['llms.txt', 'oauth-protected-resource'],
                mcp: [],
                integrations_json: null
            }
        });
    });

    it('BDD_INTEGRATION_CATALOG_INV4 returns 404 for unsupported providers', async () => {
        const integrationCatalogService = new MeetingSourceIntegrationCatalogService();
        const { app } = await makeApp({ integrationCatalogService });

        const res = await request(app)
            .get('/api/settings/meeting-sources/integration-catalog/unknown')
            .expect(404);

        expect(res.body.error).toContain('unsupported meeting source provider: unknown');
    });

    it('C-1 lists provider statuses with sync_policy without leaking credential refs', async () => {
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
        expect(res.body.sync_policy).toMatchObject({
            trigger_interval_minutes: 5,
            incremental_cursor_field: 'cursor.updated_since',
            overlap_window_hours: 24,
            initial_backfill_since: '2026-06-25T00:00:00.000Z',
            calendar_role: 'context_only',
            source_priority: ['tactiq_online', 'plaud_offline_or_tactiq_unavailable']
        });
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

    it('C-2/C-3 uses the runtime sync policy when preview has no explicit window', async () => {
        const tactiqPoll = vi.fn(async () => []);
        const { app, service } = await makeApp({
            adapters: {
                tactiq: {
                    poll: tactiqPoll
                }
            }
        });
        await service.connectProvider('tactiq', {
            account_label: 'ksato tactiq',
            credential_ref: 'secret:tactiq'
        });

        const res = await request(app)
            .post('/api/settings/meeting-sources/resync-preview')
            .send({ providers: ['tactiq'] })
            .expect(200);

        expect(res.body).toMatchObject({
            dry_run: true,
            sync_policy_mode: 'runtime_policy',
            sync_policy: {
                trigger_interval_minutes: 5,
                incremental_cursor_field: 'cursor.updated_since',
                overlap_window_hours: 24,
                initial_backfill_since: '2026-06-25T00:00:00.000Z',
                calendar_role: 'context_only',
                source_priority: ['tactiq_online', 'plaud_offline_or_tactiq_unavailable']
            }
        });
        expect(tactiqPoll).toHaveBeenCalledWith(expect.objectContaining({
            since: '2026-06-25T00:00:00.000Z',
            until: null
        }));
    });

    it('C-4 resolves providers-only preview from cursor minus overlap clamped to initial backfill', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const tactiqPoll = vi
            .fn()
            .mockResolvedValueOnce([{
                id: 'tactiq-cursor-seed',
                title: 'Cursor seed',
                transcript_text: 'seed meeting text',
                meeting_mode: 'online',
                updated_at: '2026-07-01T09:00:00.000Z'
            }])
            .mockResolvedValueOnce([]);
        const { app, service } = await makeApp({
            workflowService,
            adapters: {
                tactiq: {
                    poll: tactiqPoll
                }
            }
        });
        await service.connectProvider('tactiq', {
            account_label: 'ksato tactiq',
            credential_ref: 'secret:tactiq'
        });

        const seedPreview = await request(app)
            .post('/api/settings/meeting-sources/resync-preview')
            .send({
                providers: ['tactiq'],
                since: '2026-06-25T00:00:00.000Z',
                org_id: 'brainbase',
                project_id: 'brainbase'
            })
            .expect(200);
        await request(app)
            .post('/api/settings/meeting-sources/resync-confirm')
            .send({ preview_id: seedPreview.body.preview_id })
            .expect(200);

        const res = await request(app)
            .post('/api/settings/meeting-sources/resync-preview')
            .send({ providers: ['tactiq'] })
            .expect(200);

        expect(res.body.sync_policy_mode).toBe('runtime_policy');
        expect(tactiqPoll).toHaveBeenLastCalledWith(expect.objectContaining({
            since: '2026-06-30T09:00:00.000Z',
            until: null
        }));
    });

    it('C-3/C-4 resolves runtime windows per provider when cursor states differ', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const tactiqPoll = vi
            .fn()
            .mockResolvedValueOnce([{
                id: 'tactiq-cursor-seed',
                title: 'Cursor seed',
                transcript_text: 'seed meeting text',
                meeting_mode: 'online',
                updated_at: '2026-07-01T09:00:00.000Z'
            }])
            .mockResolvedValueOnce([]);
        const plaudPoll = vi.fn(async () => []);
        const { app, service } = await makeApp({
            workflowService,
            adapters: {
                tactiq: { poll: tactiqPoll },
                plaud: { poll: plaudPoll }
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

        const seedPreview = await request(app)
            .post('/api/settings/meeting-sources/resync-preview')
            .send({
                providers: ['tactiq'],
                since: '2026-06-25T00:00:00.000Z',
                org_id: 'brainbase',
                project_id: 'brainbase'
            })
            .expect(200);
        await request(app)
            .post('/api/settings/meeting-sources/resync-confirm')
            .send({ preview_id: seedPreview.body.preview_id })
            .expect(200);

        const res = await request(app)
            .post('/api/settings/meeting-sources/resync-preview')
            .send({ providers: ['tactiq', 'plaud'] })
            .expect(200);

        expect(res.body.sync_policy_mode).toBe('runtime_policy');
        expect(tactiqPoll).toHaveBeenLastCalledWith(expect.objectContaining({
            since: '2026-06-30T09:00:00.000Z',
            until: null
        }));
        expect(plaudPoll).toHaveBeenLastCalledWith(expect.objectContaining({
            since: '2026-06-25T00:00:00.000Z',
            until: null
        }));

        const scheduled = await service.runScheduledSync({
            providers: ['tactiq', 'plaud'],
            org_id: 'brainbase',
            project_id: 'brainbase',
            case_scope: 'internal'
        });
        const state = await service._loadState();

        expect(scheduled).toMatchObject({
            ok: true,
            submitted: false,
            reason: 'no_source_artifacts'
        });
        expect(state.previews[scheduled.preview_id].options).toMatchObject({
            sync_policy_mode: 'runtime_policy',
            until: '2026-07-02T00:00:00.000Z',
            provider_windows: {
                tactiq: { updated_since: '2026-06-30T09:00:00.000Z' },
                plaud: { updated_since: '2026-06-25T00:00:00.000Z' }
            }
        });
        expect(tactiqPoll).toHaveBeenLastCalledWith(expect.objectContaining({
            since: '2026-06-30T09:00:00.000Z',
            until: '2026-07-02T00:00:00.000Z'
        }));
        expect(plaudPoll).toHaveBeenLastCalledWith(expect.objectContaining({
            since: '2026-06-25T00:00:00.000Z',
            until: '2026-07-02T00:00:00.000Z'
        }));
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
                task_candidates: [
                    expect.objectContaining({
                        status: 'candidate',
                        source: 'meeting_review_package'
                    })
                ],
                decision_candidates: [
                    expect.objectContaining({
                        status: 'candidate',
                        source: 'meeting_review_package'
                    })
                ],
                follow_up_draft: expect.objectContaining({
                    status: 'draft_only',
                    external_send_required_approval: true,
                    body: expect.stringContaining('タスク候補')
                }),
                promotion_candidates: expect.any(Object)
            })
        });
    });
});
