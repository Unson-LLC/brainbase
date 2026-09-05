import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { resolve } from 'node:path';

import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOnboardingRouter } from '../../server/routes/onboarding.js';
import { PgCandidateRepository } from '../../server/services/candidate-store/candidate-repository.js';
import {
    InMemoryOnboardingRunRepository,
    OnboardingRuntimeService
} from '../../server/services/onboarding/onboarding-runtime-service.js';

const { Pool } = pg;
const HASH = `sha256:${'a'.repeat(64)}`;

async function availablePort() {
    const server = net.createServer();
    await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    return address.port;
}

describe.sequential('onboarding HTTP flow with PostgreSQL candidate RLS', () => {
    let container;
    let dataDirectory;
    let postgresBin;
    let adminPool;
    let appPool;
    let app;
    let runCounter = 0;

    beforeAll(async () => {
        let adminUrl;
        try {
            const testcontainersModule = '@testcontainers/postgresql';
            const { PostgreSqlContainer } = await import(testcontainersModule);
            container = await new PostgreSqlContainer('postgres:16-alpine').start();
            adminUrl = container.getConnectionUri();
        } catch {
            postgresBin = ['/usr/local/opt/postgresql@16/bin', '/opt/homebrew/opt/postgresql@16/bin']
                .find((candidate) => fs.existsSync(resolve(candidate, 'initdb')));
            if (!postgresBin) throw new Error('Docker or PostgreSQL 16 binaries are required for this integration test');
            dataDirectory = fs.mkdtempSync(resolve(os.tmpdir(), 'brainbase-onboarding-rls-'));
            const port = await availablePort();
            execFileSync(resolve(postgresBin, 'initdb'), ['-D', dataDirectory, '--auth=trust', '--no-locale'], { stdio: 'ignore' });
            execFileSync(resolve(postgresBin, 'pg_ctl'), [
                '-D', dataDirectory, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'
            ], { stdio: 'ignore' });
            adminUrl = `postgresql://127.0.0.1:${port}/postgres`;
        }
        adminPool = new Pool({ connectionString: adminUrl });
        await adminPool.query(await readFile(resolve(process.cwd(), 'server/sql/candidate-store-schema.sql'), 'utf8'));
        await adminPool.query(`
            CREATE ROLE onboarding_rls_app LOGIN PASSWORD 'test-only' NOSUPERUSER NOBYPASSRLS;
            GRANT USAGE ON SCHEMA public TO onboarding_rls_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO onboarding_rls_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO onboarding_rls_app;
        `);

        const appUrl = new URL(adminUrl);
        appUrl.username = 'onboarding_rls_app';
        appUrl.password = 'test-only';
        appPool = new Pool({ connectionString: appUrl.toString() });

        const service = new OnboardingRuntimeService({
            repository: new InMemoryOnboardingRunRepository(),
            candidateRepository: new PgCandidateRepository({ pool: appPool }),
            infoSSOTService: {
                async createOrUpdateGraphEntity(_access, input) {
                    return { entity_id: input.id };
                }
            },
            idFactory: () => `onb_pg_rls_${++runCounter}`
        });
        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.auth = { sub: 'per_owner', role: 'ceo' };
            req.access = {
                personId: 'per_owner',
                organizationId: req.get('x-organization-id') || undefined,
                role: 'ceo',
                projectCodes: ['brainbase'],
                clearance: ['internal']
            };
            req.authSource = 'bearer';
            next();
        });
        app.use('/api/onboarding', createOnboardingRouter({ service }));
    }, 120_000);

    afterAll(async () => {
        await appPool?.end();
        await adminPool?.end();
        if (container) {
            await container.stop();
        } else if (dataDirectory) {
            execFileSync(resolve(postgresBin, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
            fs.rmSync(dataDirectory, { recursive: true, force: true });
        }
    });

    it('ingest and approval pass FORCE RLS and remain readable through HTTP', async () => {
        const headers = { 'x-organization-id': 'org_unson' };
        const started = await request(app)
            .post('/api/onboarding/runs')
            .set(headers)
            .send({ project_code: 'brainbase', value_target: '運営会社を確認する', source_mode: 'drive' })
            .expect(201);

        const ingested = await request(app)
            .post(`/api/onboarding/runs/${started.body.id}/sources`)
            .set(headers)
            .send({
                source: {
                    mode: 'drive',
                    source_id: 'drive:postgres-rls',
                    evidence_ref: 'drive:postgres-rls#p1',
                    content_hash: HASH,
                    permission_snapshot: { visibility: 'owner' },
                    collection_status: 'collected'
                },
                candidates: [{
                    subject_type: 'org',
                    fact: 'Unson LLC は Brainbase を運営している',
                    observation_class: 'observed',
                    evidence_id: 'drive:postgres-rls#p1'
                }]
            })
            .expect(201);

        expect(ingested.body).toMatchObject({
            status: 'reviewing',
            workflow_state: 'candidates_ready',
            candidates: [{ promotion_status: 'pending_approval' }]
        });
        const candidateId = ingested.body.candidates[0].id;
        const storedAfterIngest = await adminPool.query(
            'SELECT organization_id, org_ids, promotion_status FROM memory_candidates WHERE id = $1',
            [candidateId]
        );
        expect(storedAfterIngest.rows).toEqual([{
            organization_id: 'org_unson',
            org_ids: ['org_unson'],
            promotion_status: 'pending_approval'
        }]);

        await request(app)
            .get(`/api/onboarding/runs/${started.body.id}`)
            .set(headers)
            .expect(200)
            .expect(({ body }) => {
                expect(body.candidates).toEqual([
                    expect.objectContaining({ id: candidateId, promotion_status: 'pending_approval' })
                ]);
            });

        const reviewed = await request(app)
            .post(`/api/onboarding/runs/${started.body.id}/candidates/${candidateId}/review`)
            .set(headers)
            .send({ decision: 'approve', reason: 'evidence confirmed' })
            .expect(200);
        expect(reviewed.body).toMatchObject({
            candidate: { id: candidateId, promotion_status: 'promoted_to_graph' },
            graph_entity_id: `onb_${candidateId}`
        });

        const storedAfterReview = await adminPool.query(
            'SELECT organization_id, promotion_status, promoted_graph_entity_id FROM memory_candidates WHERE id = $1',
            [candidateId]
        );
        expect(storedAfterReview.rows).toEqual([{
            organization_id: 'org_unson',
            promotion_status: 'promoted_to_graph',
            promoted_graph_entity_id: `onb_${candidateId}`
        }]);
    }, 120_000);

    it('organization context missing fails closed before candidate persistence', async () => {
        const started = await request(app)
            .post('/api/onboarding/runs')
            .send({ project_code: 'brainbase', value_target: '組織境界を確認する', source_mode: 'drive' })
            .expect(201);

        const response = await request(app)
            .post(`/api/onboarding/runs/${started.body.id}/sources`)
            .send({
                source: {
                    mode: 'drive',
                    source_id: 'drive:missing-org',
                    evidence_ref: 'drive:missing-org#p1',
                    content_hash: HASH,
                    permission_snapshot: { visibility: 'owner' },
                    collection_status: 'collected'
                },
                candidates: [{
                    subject_type: 'org',
                    fact: '組織IDのない候補は保存しない',
                    observation_class: 'observed',
                    evidence_id: 'drive:missing-org#p1'
                }]
            })
            .expect(403);

        expect(response.body.error.code).toBe('onboarding_organization_context_required');
        const persisted = await adminPool.query(
            "SELECT id FROM memory_candidates WHERE source_system = 'onboarding:drive' AND body LIKE '%missing-org%'"
        );
        expect(persisted.rows).toEqual([]);
    }, 120_000);
});
