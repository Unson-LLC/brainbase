import { createHash } from 'node:crypto';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createRunReceiptRouter } from '../../../server/routes/run-receipts.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';
import { RunReceiptIngestService } from '../../../server/services/run-receipt/ingest-service.js';
import { WorkflowService } from '../../../server/services/workflow/workflow-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function idempotencyKey(projectId, sourceType, externalRunId) {
    return `rr1_${createHash('sha256')
        .update(JSON.stringify([projectId, sourceType, externalRunId]))
        .digest('hex')}`;
}

function makeReceipt({ projectId = 'brainbase', externalRunId = 'mana-run-1' } = {}) {
    return {
        contract_version: 'run_receipt.v1',
        source: {
            type: 'mana',
            workflow_id: 'daily-secretary',
            runtime_target: 'lambda'
        },
        run: {
            project_id: projectId,
            external_run_id: externalRunId,
            status: 'success',
            evidence_state: 'confirmed',
            finished_at: '2026-07-15T00:00:00Z',
            evidence_refs: [{ kind: 'log_ref', ref: `cloudwatch:stream/${externalRunId}` }]
        },
        delivery: {
            idempotency_key: idempotencyKey(projectId, 'mana', externalRunId),
            attempt: 1
        }
    };
}

function createApp({
    authSource = 'internal',
    projectCodes = ['brainbase'],
    role = 'member',
    repository = new InMemoryWorkflowRepository(),
    lockAcquireTimeoutMs = 100
} = {}) {
    const app = express();
    const ingestService = new RunReceiptIngestService({
        workflowRepository: repository,
        lockAcquireTimeoutMs,
        lockRetryMs: 1
    });
    const workflowService = new WorkflowService({ repository, runner: {}, configParser: null });
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = authSource;
        req.auth = { sub: 'route-test', role };
        req.access = { personId: 'route-test', role, projectCodes };
        next();
    });
    app.use('/api/run-receipts', createRunReceiptRouter({ ingestService, workflowService }));
    app.use(errorHandler);
    return { app, repository, ingestService };
}

describe('run receipt routes', () => {
    it('POST ingest_createdは201、exact replayは200 duplicateを返す', async () => {
        const { app, repository } = createApp();

        const created = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(201);
        const duplicate = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(200);

        expect(created.body.status).toBe('created');
        expect(duplicate.body.status).toBe('duplicate');
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
    });

    it('POST ingest_cookie/session-only authは保存前に403で拒否する', async () => {
        const { app, repository } = createApp({ authSource: 'cookie' });

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(403);

        expect(response.body.error).toBe('server_to_server_auth_required');
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
    });

    it('POST ingest_access外projectは保存前に403で拒否する', async () => {
        const { app, repository } = createApp({ authSource: 'bearer', projectCodes: ['brainbase'] });

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt({ projectId: 'mana' }))
            .expect(403);

        expect(response.body.error).toBe('project_not_accessible');
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
    });

    it('POST ingest_contract conflictを400で返し原本を保持する', async () => {
        const { app, repository } = createApp();
        await request(app).post('/api/run-receipts/ingest').send(makeReceipt()).expect(201);
        const changed = makeReceipt();
        changed.run.status = 'cancelled';

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(changed)
            .expect(400);

        expect(response.body.code).toBe('run_receipt_conflict');
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
    });

    it('POST ingest_identity lock timeoutはretryable 503で返し書き込まない', async () => {
        const repository = new InMemoryWorkflowRepository();
        const { app, ingestService } = createApp({
            repository,
            lockAcquireTimeoutMs: 5
        });
        const normalized = ingestService.normalize(makeReceipt());
        repository.acquireWorkflowLock({
            ...normalized.lock,
            locked_by: 'other-owner',
            ttl_ms: 60000
        });

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(503);

        expect(response.headers['retry-after']).toBe('1');
        expect(response.body.code).toBe('run_receipt_lock_timeout');
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('GET inboxはqueryをserviceへ渡しoperatorのproject境界を保つ', async () => {
        const { app } = createApp({ authSource: 'bearer', projectCodes: ['brainbase'] });
        await request(app).post('/api/run-receipts/ingest').send(makeReceipt()).expect(201);

        const response = await request(app)
            .get('/api/run-receipts/inbox')
            .query({ project_id: 'brainbase', source_type: 'mana', run_status: 'success', evidence_state: 'confirmed', limit: 1 })
            .expect(200);

        expect(response.body).toMatchObject({ count: 1, has_more: false, omitted_count: 0 });
        expect(response.body.items[0]).toMatchObject({
            project_id: 'brainbase',
            source_status: 'success',
            evidence_state: 'confirmed',
            priority: 6
        });
    });

    it('GET inbox_access外projectは403で返す', async () => {
        const { app } = createApp({ authSource: 'bearer', projectCodes: ['brainbase'] });

        await request(app)
            .get('/api/run-receipts/inbox')
            .query({ project_id: 'mana' })
            .expect(403);
    });

    it('GET inbox_invalid filterは空成功へ丸めず400を返す', async () => {
        const { app } = createApp();

        const response = await request(app)
            .get('/api/run-receipts/inbox')
            .query({ evidence_state: 'unknown' })
            .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
});
