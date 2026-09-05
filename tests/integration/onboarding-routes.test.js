import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createOnboardingRouter } from '../../server/routes/onboarding.js';
import { InMemoryCandidateRepository } from '../../server/services/candidate-store/candidate-repository.js';
import {
    InMemoryOnboardingRunRepository,
    JsonFileOnboardingRunRepository,
    OnboardingRuntimeService
} from '../../server/services/onboarding/onboarding-runtime-service.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const FIRST_VALUE_PRESENTATION = {
    presentation_contract_version: 'first_value_clarity.v1',
    presented_sections: ['覚えていたこと', 'つながったこと', '次にできること']
};

function createApp(projectCodes = ['brainbase']) {
    const calls = [];
    const service = {
        async startRun(actor, body) {
            calls.push({ actor, body });
            if (!actor.projectCodes.includes(body.project_code)) {
                const error = new Error('project outside authenticated scope');
                error.code = 'project_scope_denied';
                error.statusCode = 403;
                throw error;
            }
            return { id: 'onb_1', status: 'collecting', workflow_state: 'initialized', project_code: body.project_code };
        }
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.auth = { sub: 'per_owner', role: 'ceo' };
        req.access = { personId: 'per_owner', organizationId: 'org_unson', role: 'ceo', projectCodes };
        req.authSource = 'bearer';
        next();
    });
    app.use('/api/onboarding', createOnboardingRouter({ service }));
    return { app, calls };
}

describe('onboarding routes', () => {
    it('authenticated access contextをserviceへ渡しrunを201で作る', async () => {
        const { app, calls } = createApp();
        const response = await request(app).post('/api/onboarding/runs').send({
            project_code: 'brainbase', value_target: '最初の問い', source_mode: 'drive'
        }).expect(201);
        expect(response.body).toMatchObject({ id: 'onb_1', status: 'collecting', workflow_state: 'initialized' });
        expect(calls[0].actor).toMatchObject({ personId: 'per_owner', projectCodes: ['brainbase'], authSource: 'bearer' });
    });

    it('project scope違反を403の構造化errorとして返す', async () => {
        const { app } = createApp(['salestailor']);
        const response = await request(app).post('/api/onboarding/runs').send({
            project_code: 'brainbase', value_target: '最初の問い', source_mode: 'drive'
        }).expect(403);
        expect(response.body.error.code).toBe('project_scope_denied');
    });

    it('fixture APIでDrive収集からGraph昇格、10分以内の初回価値レビューまで通す', async () => {
        let nowMs = Date.parse('2026-08-02T00:00:00.000Z');
        const graphWrites = [];
        const graphEdges = [];
        const service = new OnboardingRuntimeService({
            repository: new InMemoryOnboardingRunRepository(),
            candidateRepository: new InMemoryCandidateRepository(),
            infoSSOTService: {
                async createOrUpdateGraphEntity(_access, input) {
                    graphWrites.push(input);
                    return { entity_id: input.id };
                },
                async createOrUpdateGraphEdge(_access, input) {
                    graphEdges.push(input);
                    return { from_id: input.fromId, to_id: input.toId, rel_type: input.relType };
                }
            },
            now: () => new Date(nowMs),
            idFactory: () => 'onb_api_fixture'
        });
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.auth = { sub: 'per_owner', role: 'ceo' };
            req.access = { personId: 'per_owner', organizationId: 'org_unson', role: 'ceo', projectCodes: ['brainbase'] };
            next();
        });
        app.use('/api/onboarding', createOnboardingRouter({ service }));

        const started = await request(app).post('/api/onboarding/runs').send({
            project_code: 'brainbase', value_target: '運営会社はどこか', source_mode: 'drive'
        }).expect(201);
        const ingested = await request(app).post(`/api/onboarding/runs/${started.body.id}/sources`).send({
            source: {
                mode: 'drive', source_id: 'drive:file-1', evidence_ref: 'drive:file-1#p2',
                content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
                observation_class: 'observed', evidence_id: 'drive:file-1#p2'
            }]
        }).expect(201);
        expect(ingested.body.candidates[0]).toMatchObject({
            fact: 'Unson LLC は Brainbase を運営している',
            evidence_ref: 'drive:file-1#p2'
        });
        expect(ingested.body.workflow_state).toBe('candidates_ready');

        const candidateId = ingested.body.candidates[0].id;
        const promoted = await request(app)
            .post(`/api/onboarding/runs/${started.body.id}/candidates/${candidateId}/review`)
            .send({ decision: 'approve', reason: 'evidence confirmed' })
            .expect(200);
        expect(graphWrites).toHaveLength(1);
        expect(graphEdges).toHaveLength(0);
        expect(graphWrites[0].payload).toMatchObject({
            derived_from_candidate_id: candidateId,
            evidence_ids: ['drive:file-1#p2']
        });
        expect(promoted.body.candidate.promoted_graph_entity_id).toBe(promoted.body.graph_entity_id);

        await request(app).post(`/api/onboarding/runs/${started.body.id}/first-value`).send({
            answer_hash: HASH_B,
            used_graph_entity_ids: [promoted.body.graph_entity_id],
            missing_context: [],
            ...FIRST_VALUE_PRESENTATION
        }).expect(200);
        nowMs += 9 * 60 * 1000;
        const completed = await request(app)
            .post(`/api/onboarding/runs/${started.body.id}/first-value/review`)
            .send({ verdict: 'useful' })
            .expect(200);

        expect(completed.body).toMatchObject({
            status: 'first_value_answer_reviewed',
            workflow_state: 'first_value_answer_reviewed',
            first_value_review: { verdict: 'useful', within_ten_minutes: true, elapsed_ms: 540000 }
        });
    });

    it('HTTP ingestはURL queryとpermission値に埋め込まれたcredential materialを拒否する', async () => {
        const service = new OnboardingRuntimeService({
            repository: new InMemoryOnboardingRunRepository(),
            candidateRepository: new InMemoryCandidateRepository(),
            infoSSOTService: {},
            idFactory: () => 'onb_api_secret_guard'
        });
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.auth = { sub: 'per_owner', role: 'ceo' };
            req.access = { personId: 'per_owner', organizationId: 'org_unson', role: 'ceo', projectCodes: ['brainbase'] };
            next();
        });
        app.use('/api/onboarding', createOnboardingRouter({ service }));
        await request(app).post('/api/onboarding/runs').send({
            project_code: 'brainbase', value_target: '秘密情報を保存しない', source_mode: 'drive'
        }).expect(201);

        const source = {
            mode: 'drive', source_id: 'drive:secret-query',
            evidence_ref: 'https://example.test/file?access_token=plaintext-secret',
            content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
        };
        const queryResponse = await request(app)
            .post('/api/onboarding/runs/onb_api_secret_guard/sources')
            .send({ source, candidates: [] })
            .expect(400);
        expect(queryResponse.body.error.code).toBe('secret_or_raw_content_rejected');

        const permissionResponse = await request(app)
            .post('/api/onboarding/runs/onb_api_secret_guard/sources')
            .send({
                source: {
                    ...source,
                    source_id: 'drive:secret-permission',
                    evidence_ref: 'drive:secret-permission',
                    permission_snapshot: { scope: 'access_token=plaintext-secret' }
                },
                candidates: []
            })
            .expect(400);
        expect(permissionResponse.body.error.code).toBe('secret_or_raw_content_rejected');

        for (const [sourceId, evidenceRef] of [
            ['drive:secret-userinfo-space', ' https://user:plaintext-secret@example.test/file'],
            ['drive:secret-double-encoded', 'https://example.test/file?access_token%253Dplaintext-secret']
        ]) {
            const response = await request(app)
                .post('/api/onboarding/runs/onb_api_secret_guard/sources')
                .send({ source: { ...source, source_id: sourceId, evidence_ref: evidenceRef }, candidates: [] })
                .expect(400);
            expect(response.body.error.code).toBe('secret_or_raw_content_rejected');
        }

        await request(app)
            .post('/api/onboarding/runs/onb_api_secret_guard/sources')
            .send({
                source: { ...source, source_id: 'drive:file-1', evidence_ref: 'drive:file-1#paragraph-2' },
                candidates: []
            })
            .expect(201);

        const run = await request(app).get('/api/onboarding/runs/onb_api_secret_guard').expect(200);
        expect(run.body).toMatchObject({
            sources: [{ source_id: 'drive:file-1', evidence_ref: 'drive:file-1#paragraph-2' }],
            candidates: []
        });
    });

    it.each(['approve', 'reject'])('HTTP %s reviewはsecret reasonをmutation前に400で拒否する', async (decision) => {
        const graphWrites = [];
        const candidateRepository = new InMemoryCandidateRepository();
        const service = new OnboardingRuntimeService({
            repository: new InMemoryOnboardingRunRepository(),
            candidateRepository,
            infoSSOTService: {
                async createOrUpdateGraphEntity(_access, input) {
                    graphWrites.push(input);
                    return { entity_id: input.id };
                }
            },
            idFactory: () => `onb_api_review_guard_${decision}`
        });
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.auth = { sub: 'per_owner', role: 'ceo' };
            req.access = { personId: 'per_owner', organizationId: 'org_unson', role: 'ceo', projectCodes: ['brainbase'] };
            next();
        });
        app.use('/api/onboarding', createOnboardingRouter({ service }));

        const started = await request(app).post('/api/onboarding/runs').send({
            project_code: 'brainbase', value_target: '秘密情報を保存しない', source_mode: 'drive'
        }).expect(201);
        const ingested = await request(app).post(`/api/onboarding/runs/${started.body.id}/sources`).send({
            source: {
                mode: 'drive', source_id: 'drive:file-review', evidence_ref: 'drive:file-review#p1',
                content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
                observation_class: 'observed', evidence_id: 'drive:file-review#p1'
            }]
        }).expect(201);
        const candidateId = ingested.body.candidates[0].id;
        const auditBefore = await candidateRepository.listAudit(candidateId);

        const response = await request(app)
            .post(`/api/onboarding/runs/${started.body.id}/candidates/${candidateId}/review`)
            .send({ decision, reason: 'access_token=plaintext-secret' })
            .expect(400);

        expect(response.body.error.code).toBe('secret_or_raw_content_rejected');
        expect(graphWrites).toHaveLength(0);
        expect(await candidateRepository.findById(candidateId)).toMatchObject({ promotion_status: 'pending_approval' });
        expect(await candidateRepository.listAudit(candidateId)).toHaveLength(auditBefore.length);
        const run = await request(app).get(`/api/onboarding/runs/${started.body.id}`).expect(200);
        expect(run.body).toMatchObject({ status: 'reviewing', workflow_state: 'candidates_ready' });
    });

    it('production JSON ledgerで同時API ingestした2つのsource receiptを保持する', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-onboarding-api-concurrency-'));
        try {
            const service = new OnboardingRuntimeService({
                repository: new JsonFileOnboardingRunRepository({ filePath: path.join(tempDir, 'runs.json') }),
                candidateRepository: new InMemoryCandidateRepository(),
                infoSSOTService: {},
                now: () => new Date('2026-08-02T00:00:00.000Z'),
                idFactory: () => 'onb_api_concurrent'
            });
            const app = express();
            app.use(express.json());
            app.use((req, _res, next) => {
                req.auth = { sub: 'per_owner', role: 'ceo' };
                req.access = { personId: 'per_owner', organizationId: 'org_unson', role: 'ceo', projectCodes: ['brainbase'] };
                next();
            });
            app.use('/api/onboarding', createOnboardingRouter({ service }));
            await request(app).post('/api/onboarding/runs').send({
                project_code: 'brainbase', value_target: '複数資料の共通知識', source_mode: 'drive'
            }).expect(201);
            const payload = (suffix) => ({
                source: {
                    mode: 'drive', source_id: `drive:file-${suffix}`, evidence_ref: `drive:file-${suffix}#p1`,
                    content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
                },
                candidates: [{
                    subject_type: 'org', fact: `資料${suffix}で確認した組織情報`,
                    observation_class: 'observed', evidence_id: `drive:file-${suffix}#p1`
                }]
            });

            const responses = await Promise.all([
                request(app).post('/api/onboarding/runs/onb_api_concurrent/sources').send(payload('1')),
                request(app).post('/api/onboarding/runs/onb_api_concurrent/sources').send(payload('2'))
            ]);
            expect(responses.map(({ status }) => status)).toEqual([201, 201]);

            const run = await request(app).get('/api/onboarding/runs/onb_api_concurrent').expect(200);
            expect(run.body.sources.map(({ source_id }) => source_id).sort()).toEqual(['drive:file-1', 'drive:file-2']);
            expect(run.body.candidates).toHaveLength(2);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('cold startのGETとAPI ingestが競合しても古いledger stateへ巻き戻さない', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-onboarding-cold-load-'));
        const filePath = path.join(tempDir, 'runs.json');
        try {
            await fs.writeFile(filePath, JSON.stringify({
                schema_version: 'onboarding_runs.v1',
                runs: [{
                    id: 'onb_api_cold_load', owner_person_id: 'per_owner', organization_id: 'org_unson', project_code: 'brainbase',
                    value_target: '再起動直後の競合確認', source_mode: 'drive', status: 'collecting',
                    sources: [], candidate_items: [], promoted_graph_entity_ids: [], source_ready_at: null,
                    first_value_receipt: null, first_value_review: null,
                    started_at: '2026-08-02T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z'
                }]
            }));
            let releaseRead;
            const readStarted = new Promise((resolve) => { releaseRead = resolve; });
            class DelayedInitialReadRepository extends JsonFileOnboardingRunRepository {
                async _readLedger() {
                    const snapshot = await super._readLedger();
                    releaseRead();
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    return snapshot;
                }
            }
            const repository = new DelayedInitialReadRepository({ filePath });
            const service = new OnboardingRuntimeService({
                repository,
                candidateRepository: new InMemoryCandidateRepository(),
                infoSSOTService: {},
                now: () => new Date('2026-08-02T00:00:00.000Z')
            });
            const app = express();
            app.use(express.json());
            app.use((req, _res, next) => {
                req.auth = { sub: 'per_owner', role: 'ceo' };
                req.access = { personId: 'per_owner', organizationId: 'org_unson', role: 'ceo', projectCodes: ['brainbase'] };
                next();
            });
            app.use('/api/onboarding', createOnboardingRouter({ service }));
            const coldGet = request(app).get('/api/onboarding/runs/onb_api_cold_load').then((response) => response);
            await readStarted;
            const ingest = request(app).post('/api/onboarding/runs/onb_api_cold_load/sources').send({
                source: {
                    mode: 'drive', source_id: 'drive:cold-file', evidence_ref: 'drive:cold-file#p1',
                    content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
                },
                candidates: [{
                    subject_type: 'org', fact: '再起動直後に確認した組織情報',
                    observation_class: 'observed', evidence_id: 'drive:cold-file#p1'
                }]
            });

            const [getResponse, ingestResponse] = await Promise.all([coldGet, ingest]);
            expect({ status: getResponse.status, body: getResponse.body }).toMatchObject({ status: 200 });
            expect(ingestResponse.status).toBe(201);
            const current = await request(app).get('/api/onboarding/runs/onb_api_cold_load').expect(200);
            expect(current.body.sources.map(({ source_id }) => source_id)).toEqual(['drive:cold-file']);
            const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
            expect(persisted.runs[0].sources.map(({ source_id }) => source_id)).toEqual(['drive:cold-file']);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
