import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { InMemoryCandidateRepository } from '../../server/services/candidate-store/candidate-repository.js';
import { InfoSSOTService } from '../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../server/services/ontology-registry.js';
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
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sourceEventIdFor(runId, sourceId, evidenceId) {
    const sourceDigest = crypto.createHash('sha256').update(sourceId).digest('hex');
    return `${runId}:source_sha256:${sourceDigest}:${evidenceId}`;
}

function actor(projectCodes = ['brainbase'], personId = 'per_owner') {
    return {
        personId,
        role: 'ceo',
        projectCodes,
        access: { personId, role: 'ceo', projectCodes, clearance: ['internal'] }
    };
}

function createFixture({ infoSSOTService } = {}) {
    let nowMs = Date.parse('2026-08-02T00:00:00.000Z');
    let runCounter = 0;
    const graphWrites = [];
    const graphEdges = [];
    const candidateRepository = new InMemoryCandidateRepository();
    const service = new OnboardingRuntimeService({
        repository: new InMemoryOnboardingRunRepository(),
        candidateRepository,
        infoSSOTService: infoSSOTService || {
            async createOrUpdateGraphEntity(access, input) {
                graphWrites.push({ access, input });
                return { entity_id: input.id };
            },
            async createOrUpdateGraphEdge(access, input) {
                graphEdges.push({ access, input });
                return { from_id: input.fromId, to_id: input.toId, rel_type: input.relType };
            }
        },
        now: () => new Date(nowMs),
        idFactory: () => `onb_run_${String(++runCounter).padStart(3, '0')}`
    });
    return {
        service,
        graphWrites,
        graphEdges,
        candidateRepository,
        advance(ms) { nowMs += ms; }
    };
}

async function startAndIngest(fixture, candidates = [{
    subject_type: 'org',
    fact: 'Unson LLC は Brainbase を運営している',
    observation_class: 'observed',
    evidence_id: 'drive:file-1#paragraph-2'
}], sourceMode = 'drive') {
    const run = await fixture.service.startRun(actor(), {
        project_code: 'brainbase',
        value_target: 'Brainbaseを誰が運営しているか',
        source_mode: sourceMode
    });
    return fixture.service.ingestSource(actor(), run.id, {
        source: {
            mode: sourceMode,
            source_id: `${sourceMode}:source-1`,
            evidence_ref: `${sourceMode}:source-1#item-2`,
            content_hash: HASH_A,
            permission_snapshot: { visibility: 'owner', collected_by: 'host_agent' },
            collection_status: 'collected'
        },
        candidates
    });
}

describe('OnboardingRuntimeService', () => {
    it('初回価値の表示契約を開始時に示し、契約準拠の3節だけをreceiptへ記録する', async () => {
        const fixture = createFixture();
        const started = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '組織を理解する', source_mode: 'drive'
        });

        expect(started.first_value_presentation_contract).toEqual({
            version: 'first_value_clarity.v1',
            sections: ['覚えていたこと', 'つながったこと', '次にできること'],
            initial_format: 'short_bullets',
            initial_table: false,
            separate_confirmed_and_unverified: true,
            technical_details: 'separate_on_request',
            value_evidence: 'human_review',
            cli_sample_counts_as_value: false
        });

        const ingested = await fixture.service.ingestSource(actor(), started.id, {
            source: {
                mode: 'drive', source_id: 'drive:first-value', evidence_ref: 'drive:first-value#p1',
                content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
                observation_class: 'observed', evidence_id: 'drive:first-value#p1'
            }]
        });
        const promoted = await fixture.service.reviewCandidate(actor(), started.id, ingested.candidates[0].id, { decision: 'approve' });

        await expect(fixture.service.recordFirstValue(actor(), started.id, {
            answer_hash: HASH_B,
            used_graph_entity_ids: [promoted.graph_entity_id],
            missing_context: []
        })).rejects.toMatchObject({ code: 'first_value_presentation_invalid' });

        await expect(fixture.service.recordFirstValue(actor(), started.id, {
            answer_hash: HASH_B,
            used_graph_entity_ids: [promoted.graph_entity_id],
            missing_context: [],
            presentation_contract_version: 'first_value_clarity.v1',
            presented_sections: ['覚えていたこと', 'つながったこと', '次にできること']
        })).resolves.toMatchObject({
            first_value_receipt: {
                presentation_contract_version: 'first_value_clarity.v1',
                presented_sections: ['覚えていたこと', 'つながったこと', '次にできること']
            }
        });
    });

    it('source receiptだけをsource_ready、candidate追加後をcandidates_readyとして投影する', async () => {
        const fixture = createFixture();
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '組織を理解する', source_mode: 'drive'
        });
        const sourceReady = await fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'drive', source_id: 'drive:empty', evidence_ref: 'drive:empty#root',
                content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: []
        });
        expect(sourceReady).toMatchObject({ status: 'reviewing', workflow_state: 'source_ready', candidates: [] });

        const candidatesReady = await fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'drive', source_id: 'drive:facts', evidence_ref: 'drive:facts#p1',
                content_hash: HASH_B, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
                observation_class: 'observed', evidence_id: 'drive:facts#p1'
            }]
        });
        expect(candidatesReady).toMatchObject({ status: 'reviewing', workflow_state: 'candidates_ready' });
    });

    it('active ontology境界でもcross-store edgeを作らず双方向provenanceで昇格する', async () => {
        const statements = [];
        const graphQueries = [];
        const entityWrites = [];
        const registry = new OntologyRegistry({ rootDir });
        const activeRegistry = {
            hasCurrent: () => true,
            resolve: (options = {}) => {
                const release = registry.resolve({ version: options.version || '1.0.0', asOf: options.asOf });
                release.kernel.status = 'active';
                return release;
            }
        };
        const client = {
            async query(sql, params = []) {
                const text = String(sql);
                statements.push(text);
                if (text.includes('WHERE id = ANY')) graphQueries.push({ text, params });
                if (text.includes('INSERT INTO graph_edges')) throw new Error('cross-store edge insert must not run');
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                if (text.includes('INSERT INTO graph_entities')) entityWrites.push(params);
                return { rows: [] };
            },
            release() {}
        };
        const infoSSOTService = new InfoSSOTService({
            ontologyRegistry: activeRegistry,
            pool: { connect: async () => client }
        });
        const fixture = createFixture({ infoSSOTService });
        const ingested = await startAndIngest(fixture);
        const candidate = ingested.candidates[0];

        const promoted = await fixture.service.reviewCandidate(actor(), ingested.id, candidate.id, { decision: 'approve' });
        const promotedWrite = entityWrites.find((params) => params[0] === promoted.graph_entity_id);
        const durableCandidate = await fixture.candidateRepository.findById(candidate.id);

        expect(promoted.candidate).toMatchObject({
            promotion_status: 'promoted_to_graph',
            promoted_graph_entity_id: promoted.graph_entity_id
        });
        expect(JSON.parse(promotedWrite[3])).toMatchObject({
            derived_from_candidate_id: candidate.id,
            source_system: 'onboarding:drive',
            source_event_ids: [sourceEventIdFor(ingested.id, 'drive:source-1', candidate.evidence_ids[0])],
            evidence_ids: candidate.evidence_ids,
            permission_snapshot: { visibility: 'owner', collected_by: 'host_agent' },
            promoted_at: '2026-08-02T00:00:00.000Z',
            fact: 'Unson LLC は Brainbase を運営している'
        });
        expect(durableCandidate).toMatchObject({
            promoted_graph_entity_id: promoted.graph_entity_id,
            evidence_ids: candidate.evidence_ids
        });
        expect(graphQueries).not.toHaveLength(0);
        expect(graphQueries.some(({ params }) => params.flat(Infinity).includes(candidate.id))).toBe(false);
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_edges'))).toBe(false);
    });

    it.each(['mcp', 'drive', 'gmail', 'local_folder', 'single_document'])(
        '%s source modeでingestからGraph promotion、初回価値reviewまで完了できる',
        async (sourceMode) => {
            const fixture = createFixture();
            const started = await fixture.service.startRun(actor(), {
                project_code: 'brainbase', value_target: '状態確認', source_mode: sourceMode
            });
            expect(started).toMatchObject({ status: 'collecting', workflow_state: 'initialized' });
            const ingested = await startAndIngest(fixture, undefined, sourceMode);
            expect(ingested).toMatchObject({ project_code: 'brainbase', source_mode: sourceMode, status: 'reviewing', workflow_state: 'candidates_ready' });
            expect(ingested.candidates[0]).toMatchObject({
                fact: 'Unson LLC は Brainbase を運営している',
                evidence_ref: `${sourceMode}:source-1#item-2`
            });
            const promoted = await fixture.service.reviewCandidate(actor(), ingested.id, ingested.candidates[0].id, { decision: 'approve' });
            await expect(fixture.service.getRun(actor(), ingested.id)).resolves.toMatchObject({
                status: 'answering', workflow_state: 'promotion_reviewed'
            });
            await expect(fixture.service.recordFirstValue(actor(), ingested.id, {
                answer_hash: HASH_B, used_graph_entity_ids: [promoted.graph_entity_id], missing_context: [],
                ...FIRST_VALUE_PRESENTATION
            })).resolves.toMatchObject({ status: 'answering', workflow_state: 'first_value_ready' });
            await expect(fixture.service.reviewFirstValue(actor(), ingested.id, { verdict: 'useful' }))
                .resolves.toMatchObject({ status: 'first_value_answer_reviewed', workflow_state: 'first_value_answer_reviewed' });
        }
    );

    it('Drive receiptをrequest actorのaccessでGraphへ昇格して600秒以内のuseful完了を記録する', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const candidate = ingested.candidates[0];

        expect(ingested.status).toBe('reviewing');
        expect(fixture.graphWrites).toHaveLength(0);

        const promoted = await fixture.service.reviewCandidate(actor(), ingested.id, candidate.id, {
            decision: 'approve',
            reason: 'source evidence confirmed'
        });
        expect(promoted.candidate.promotion_status).toBe('promoted_to_graph');
        expect(promoted.graph_entity_id).toMatch(/^onb_/);
        expect(fixture.graphWrites).toHaveLength(1);
        expect(fixture.graphEdges).toHaveLength(0);
        expect(fixture.graphWrites[0].input.projectCode).toBe('brainbase');
        expect(fixture.graphWrites[0].input.payload).toMatchObject({
            derived_from_candidate_id: candidate.id,
            source_system: 'onboarding:drive',
            source_event_ids: [sourceEventIdFor(ingested.id, 'drive:source-1', candidate.evidence_ids[0])],
            evidence_ids: candidate.evidence_ids,
            permission_snapshot: { visibility: 'owner', collected_by: 'host_agent' },
            promoted_at: '2026-08-02T00:00:00.000Z'
        });
        expect(fixture.graphWrites[0].access).toEqual(actor().access);
        expect(promoted.candidate.promoted_graph_entity_id).toBe(promoted.graph_entity_id);

        await fixture.service.recordFirstValue(actor(), ingested.id, {
            answer_hash: HASH_B,
            used_graph_entity_ids: [promoted.graph_entity_id],
            missing_context: [],
            ...FIRST_VALUE_PRESENTATION
        });
        fixture.advance(10 * 60 * 1000);
        const completed = await fixture.service.reviewFirstValue(actor(), ingested.id, {
            verdict: 'useful'
        });

        expect(completed.status).toBe('first_value_answer_reviewed');
        expect(completed.first_value_review).toMatchObject({
            verdict: 'useful',
            within_ten_minutes: true,
            elapsed_ms: 600000
        });
        expect(JSON.stringify(completed)).not.toContain('Unson LLC は Brainbase');
    });

    it('600秒を超えたnot_useful完了を利用者向けreceiptへ正しく投影する', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const promoted = await fixture.service.reviewCandidate(
            actor(),
            ingested.id,
            ingested.candidates[0].id,
            { decision: 'approve' }
        );
        await fixture.service.recordFirstValue(actor(), ingested.id, {
            answer_hash: HASH_B,
            used_graph_entity_ids: [promoted.graph_entity_id],
            missing_context: [],
            ...FIRST_VALUE_PRESENTATION
        });
        fixture.advance(600001);

        await expect(fixture.service.reviewFirstValue(actor(), ingested.id, {
            verdict: 'not_useful'
        })).resolves.toMatchObject({
            status: 'first_value_answer_reviewed',
            workflow_state: 'first_value_answer_reviewed',
            first_value_review: {
                verdict: 'not_useful',
                elapsed_ms: 600001,
                within_ten_minutes: false
            }
        });
    });

    it('inferred candidateをapproveできずGraphへ書かない', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture, [{
            subject_type: 'org',
            fact: '運営会社は成長中だと推測される',
            observation_class: 'inferred',
            evidence_id: 'drive:file-1#paragraph-3'
        }]);

        await expect(fixture.service.reviewCandidate(actor(), ingested.id, ingested.candidates[0].id, {
            decision: 'approve'
        })).rejects.toMatchObject({ code: 'inferred_candidate_not_promotable', statusCode: 409 });
        expect(fixture.graphWrites).toHaveLength(0);
    });

    it('PII候補をreview-safe projectionで伏せ、手動approveでもGraphへ書かない', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture, [{
            subject_type: 'person',
            fact: '連絡先は 090-1234-5678',
            observation_class: 'observed',
            evidence_id: 'drive:file-1#paragraph-4'
        }]);
        const candidate = ingested.candidates[0];

        expect(candidate).toMatchObject({
            fact: null,
            redaction_status: 'needs_redaction',
            redaction_required: true
        });
        expect(JSON.stringify(ingested)).not.toContain('090-1234-5678');
        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidate.id, {
            decision: 'approve'
        })).rejects.toMatchObject({ code: 'candidate_redaction_required', statusCode: 409 });
        expect(fixture.graphWrites).toHaveLength(0);
        expect(fixture.graphEdges).toHaveLength(0);
        await expect(fixture.service.getRun(actor(), ingested.id))
            .resolves.toMatchObject({ status: 'reviewing' });
    });

    it('rejectしたcandidateを監査状態に残しGraphへ書かない', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const rejected = await fixture.service.reviewCandidate(actor(), ingested.id, ingested.candidates[0].id, {
            decision: 'reject', reason: 'source context did not support the fact'
        });
        expect(rejected).toMatchObject({
            candidate: { promotion_status: 'rejected', promoted_graph_entity_id: null },
            graph_entity_id: null
        });
        expect(fixture.graphWrites).toHaveLength(0);
        await expect(fixture.service.getRun(actor(), ingested.id)).resolves.toMatchObject({
            status: 'reviewing', workflow_state: 'promotion_reviewed'
        });
    });

    it.each([
        ['approve', 'Bearer TOP_SECRET_TOKEN', 'secret_or_raw_content_rejected'],
        ['reject', 'Bearer TOP_SECRET_TOKEN', 'secret_or_raw_content_rejected'],
        ['approve', 'x'.repeat(501), 'input_invalid'],
        ['reject', 'x'.repeat(501), 'input_invalid']
    ])('%s reviewの不正reasonをmutation前に拒否する', async (decision, reason, code) => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const candidateId = ingested.candidates[0].id;
        const auditBefore = await fixture.candidateRepository.listAudit(candidateId);

        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidateId, {
            decision, reason
        })).rejects.toMatchObject({ code, statusCode: 400 });

        expect(fixture.graphWrites).toHaveLength(0);
        expect(await fixture.candidateRepository.findById(candidateId)).toMatchObject({
            promotion_status: 'pending_approval'
        });
        expect(await fixture.candidateRepository.listAudit(candidateId)).toHaveLength(auditBefore.length);
        await expect(fixture.service.getRun(actor(), ingested.id)).resolves.toMatchObject({
            status: 'reviewing', workflow_state: 'candidates_ready'
        });
    });

    it('scope外project、secret/raw body、未昇格Graph IDをfail closedにする', async () => {
        const fixture = createFixture();
        await expect(fixture.service.startRun(actor(['salestailor']), {
            project_code: 'brainbase',
            value_target: '問い',
            source_mode: 'gmail'
        })).rejects.toMatchObject({ code: 'project_scope_denied', statusCode: 403 });

        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase',
            value_target: '問い',
            source_mode: 'gmail'
        });
        await expect(fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'gmail', source_id: 'gmail:thread-1', evidence_ref: 'gmail:thread-1',
                content_hash: HASH_A, collection_status: 'collected',
                permission_snapshot: { access_token: 'secret-value' },
                raw_body: 'must not be accepted'
            },
            candidates: []
        })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected', statusCode: 400 });

        await expect(fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'gmail', source_id: 'gmail:thread-2', evidence_ref: 'gmail:thread-2',
                content_hash: HASH_A, collection_status: 'collected',
                permission_snapshot: { token: 'fake-oauth-token-for-negative-test' }
            },
            candidates: []
        })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected', statusCode: 400 });
        await expect(fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'gmail', source_id: 'gmail:thread-3',
                evidence_ref: 'https://example.test/mail?id=3&access_token=plaintext-secret',
                content_hash: HASH_A, collection_status: 'collected',
                permission_snapshot: { visibility: 'owner' }
            },
            candidates: []
        })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected', statusCode: 400 });
        await expect(fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'gmail', source_id: 'gmail:thread-4', evidence_ref: 'gmail:thread-4',
                content_hash: HASH_A, collection_status: 'collected',
                permission_snapshot: { scope: 'access_token%3Dplaintext-secret' }
            },
            candidates: []
        })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected', statusCode: 400 });
        await expect(fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'gmail', source_id: 'gmail:thread-5',
                evidence_ref: 'https://user:plaintext-secret@example.test/mail/5',
                content_hash: HASH_A, collection_status: 'collected',
                permission_snapshot: { visibility: 'owner' }
            },
            candidates: []
        })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected', statusCode: 400 });
        for (const [sourceId, evidenceRef] of [
            ['gmail:thread-6', ' https://user:plaintext-secret@example.test/mail/6'],
            ['gmail:thread-7', 'https://example.test/mail?access_token%253Dplaintext-secret'],
            ['gmail:thread-8', 'https://example.test/mail?access_token%3Dplaintext-secret%ZZ'],
            ['gmail:thread-9', 'https://example.test/mail?access_token%ZZ=plaintext-secret'],
            ['gmail:thread-10', 'https://example.test/mail?access_token%E0%A4%A=plaintext-secret'],
            ['gmail:thread-11', 'https://example.test/oauth?client_secret=plaintext-secret'],
            ['gmail:thread-12', 'https://example.test/oauth?oauth_token=plaintext-secret'],
            ['gmail:thread-13', 'https://example.test/mail?access_token%ZZZZ=plaintext-secret'],
            ['gmail:thread-14', 'https://example.test/oauth?client_secret%malformed=plaintext-secret'],
            ['gmail:thread-15', 'https://example.test/oauth?oauth_token%ZZZZ=plaintext-secret']
        ]) {
            await expect(fixture.service.ingestSource(actor(), run.id, {
                source: {
                    mode: 'gmail', source_id: sourceId, evidence_ref: evidenceRef,
                    content_hash: HASH_A, collection_status: 'collected',
                    permission_snapshot: { visibility: 'owner' }
                },
                candidates: []
            })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected', statusCode: 400 });
        }
        await expect(fixture.service.getRun(actor(), run.id)).resolves.toMatchObject({ sources: [], candidates: [] });

        const ingested = await startAndIngest(fixture);
        await fixture.service.reviewCandidate(actor(), ingested.id, ingested.candidates[0].id, { decision: 'approve' });
        await expect(fixture.service.recordFirstValue(actor(), ingested.id, {
            answer_hash: HASH_B,
            used_graph_entity_ids: ['graph_not_promoted'],
            missing_context: [],
            ...FIRST_VALUE_PRESENTATION
        })).rejects.toMatchObject({ code: 'unpromoted_graph_reference', statusCode: 409 });
    });

    it('batch後半のinvalid candidateを全件事前検証し、孤児を残さず修正再試行できる', async () => {
        const fixture = createFixture();
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '組織を理解する', source_mode: 'drive'
        });
        const source = {
            mode: 'drive', source_id: 'drive:batch-1', evidence_ref: 'drive:batch-1#selection',
            content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
        };
        const valid = {
            subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
            observation_class: 'observed', evidence_id: 'drive:batch-1#p1'
        };

        await expect(fixture.service.ingestSource(actor(), run.id, {
            source,
            candidates: [valid, { ...valid, evidence_id: 'drive:batch-1#p2', observation_class: 'unsupported' }]
        })).rejects.toMatchObject({ code: 'input_invalid' });
        expect(await fixture.service.candidateRepository.list({ owner_person_id: 'per_owner' })).toHaveLength(0);
        await expect(fixture.service.getRun(actor(), run.id)).resolves.toMatchObject({ status: 'collecting', candidates: [] });

        const retried = await fixture.service.ingestSource(actor(), run.id, { source, candidates: [valid] });
        expect(retried).toMatchObject({ status: 'reviewing' });
        expect(retried.candidates).toHaveLength(1);
    });

    it('candidate作成後にrun ledger更新が失敗しても、同じbatchをidempotentに再開できる', async () => {
        const fixture = createFixture();
        const baseRepository = fixture.service.repository;
        const originalUpdate = baseRepository.update.bind(baseRepository);
        let failUpdate = true;
        baseRepository.update = async (...args) => {
            if (failUpdate) {
                failUpdate = false;
                throw new Error('simulated ledger failure');
            }
            return originalUpdate(...args);
        };
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '組織を理解する', source_mode: 'drive'
        });
        const input = {
            source: {
                mode: 'drive', source_id: 'drive:retry-1', evidence_ref: 'drive:retry-1#p1',
                content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
                observation_class: 'observed', evidence_id: 'drive:retry-1#p1'
            }]
        };

        await expect(fixture.service.ingestSource(actor(), run.id, input)).rejects.toThrow('simulated ledger failure');
        expect(await fixture.service.candidateRepository.list({ owner_person_id: 'per_owner' })).toHaveLength(1);
        const retried = await fixture.service.ingestSource(actor(), run.id, input);
        expect(retried.candidates).toHaveLength(1);
        expect(retried.candidates[0].promotion_status).toBe('pending_approval');
    });

    it('ledger失敗後の再試行でsubject・権限・content hashの差し替えを拒否する', async () => {
        const fixture = createFixture();
        const baseRepository = fixture.service.repository;
        const originalUpdate = baseRepository.update.bind(baseRepository);
        let failUpdate = true;
        baseRepository.update = async (...args) => {
            if (failUpdate) {
                failUpdate = false;
                throw new Error('simulated ledger failure');
            }
            return originalUpdate(...args);
        };
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '組織を理解する', source_mode: 'drive'
        });
        const input = {
            source: {
                mode: 'drive', source_id: 'drive:retry-conflict', evidence_ref: 'drive:retry-conflict#p1',
                content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
                observation_class: 'observed', evidence_id: 'drive:retry-conflict#p1'
            }]
        };

        await expect(fixture.service.ingestSource(actor(), run.id, input)).rejects.toThrow('simulated ledger failure');
        const changed = {
            source: {
                ...input.source,
                content_hash: HASH_B,
                permission_snapshot: { visibility: 'team' }
            },
            candidates: [{ ...input.candidates[0], subject_type: 'person' }]
        };
        await expect(fixture.service.ingestSource(actor(), run.id, changed))
            .rejects.toMatchObject({ code: 'source_receipt_conflict', statusCode: 409 });

        const [orphan] = await fixture.service.candidateRepository.list({ owner_person_id: 'per_owner' });
        expect(orphan).toMatchObject({
            recommended_subject_type: 'org',
            permission_snapshot: { visibility: 'owner' },
            promotion_status: 'pending_approval'
        });
        expect(JSON.parse(orphan.body)).toMatchObject({ content_hash: HASH_A });
        await expect(fixture.service.getRun(actor(), run.id))
            .resolves.toMatchObject({ status: 'collecting', sources: [], candidates: [] });

        const recovered = await fixture.service.ingestSource(actor(), run.id, input);
        expect(recovered.candidates).toHaveLength(1);
        expect(recovered.sources[0]).toMatchObject({
            content_hash: HASH_A,
            permission_snapshot: { visibility: 'owner' }
        });
    });

    it('同一projectの別ownerによるread・reviewを403かつwrite-freeにする', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const other = actor(['brainbase'], 'per_other');

        await expect(fixture.service.getRun(other, ingested.id))
            .rejects.toMatchObject({ code: 'onboarding_owner_denied', statusCode: 403 });
        await expect(fixture.service.reviewCandidate(other, ingested.id, ingested.candidates[0].id, { decision: 'approve' }))
            .rejects.toMatchObject({ code: 'onboarding_owner_denied', statusCode: 403 });
        expect(fixture.graphWrites).toHaveLength(0);
        expect(fixture.graphEdges).toHaveLength(0);
    });

    it.each(['service-token', 'internal'])('%s principalによる候補承認と初回価値評価を403で拒否する', async (authSource) => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const nonHuman = { ...actor(), authSource };

        await expect(fixture.service.reviewCandidate(nonHuman, ingested.id, ingested.candidates[0].id, {
            decision: 'approve'
        })).rejects.toMatchObject({ code: 'human_review_required', statusCode: 403 });
        expect(fixture.graphWrites).toHaveLength(0);

        const promoted = await fixture.service.reviewCandidate(actor(), ingested.id, ingested.candidates[0].id, {
            decision: 'approve'
        });
        await fixture.service.recordFirstValue(actor(), ingested.id, {
            answer_hash: HASH_B,
            used_graph_entity_ids: [promoted.graph_entity_id],
            missing_context: [],
            ...FIRST_VALUE_PRESENTATION
        });
        await expect(fixture.service.reviewFirstValue(nonHuman, ingested.id, { verdict: 'useful' }))
            .rejects.toMatchObject({ code: 'human_review_required', statusCode: 403 });
        await expect(fixture.service.getRun(actor(), ingested.id)).resolves.toMatchObject({
            status: 'answering',
            first_value_review: null
        });
    });

    it('Graph障害後はapproved candidateからidempotentにpromotionを再開できる', async () => {
        let fail = true;
        const fixture = createFixture();
        const original = fixture.service.infoSSOTService.createOrUpdateGraphEntity;
        fixture.service.infoSSOTService.createOrUpdateGraphEntity = async (...args) => {
            if (fail) {
                fail = false;
                throw new Error('Graph unavailable');
            }
            return original(...args);
        };
        const ingested = await startAndIngest(fixture);
        const candidateId = ingested.candidates[0].id;

        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidateId, { decision: 'approve' }))
            .rejects.toThrow('Graph unavailable');
        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidateId, { decision: 'approve' }))
            .resolves.toMatchObject({ candidate: { promotion_status: 'promoted_to_graph' } });
    });

    it('Graph昇格後のcandidate最終化失敗をpromoted状態から再開できる', async () => {
        const fixture = createFixture();
        const repository = fixture.service.candidateRepository;
        const original = repository.setPromotedGraphEntity.bind(repository);
        let fail = true;
        repository.setPromotedGraphEntity = async (...args) => {
            if (fail) {
                fail = false;
                throw new Error('simulated candidate finalization failure');
            }
            return original(...args);
        };
        const ingested = await startAndIngest(fixture);
        const candidateId = ingested.candidates[0].id;

        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidateId, { decision: 'approve' }))
            .rejects.toThrow('simulated candidate finalization failure');
        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidateId, { decision: 'approve' }))
            .resolves.toMatchObject({
                candidate: { promotion_status: 'promoted_to_graph', promoted_graph_entity_id: `onb_${candidateId}` },
                graph_entity_id: `onb_${candidateId}`
            });
        await expect(fixture.service.getRun(actor(), ingested.id)).resolves.toMatchObject({
            status: 'answering',
            promoted_graph_entity_ids: [`onb_${candidateId}`]
        });
    });

    it('Graph昇格後のrun ledger失敗を既存Graph IDへ再結合して回復する', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const repository = fixture.service.repository;
        const original = repository.update.bind(repository);
        let fail = true;
        repository.update = async (...args) => {
            if (fail) {
                fail = false;
                throw new Error('simulated post-promotion ledger failure');
            }
            return original(...args);
        };
        const candidateId = ingested.candidates[0].id;

        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidateId, { decision: 'approve' }))
            .rejects.toThrow('simulated post-promotion ledger failure');
        expect(fixture.graphWrites).toHaveLength(1);
        await expect(fixture.service.reviewCandidate(actor(), ingested.id, candidateId, { decision: 'approve' }))
            .resolves.toMatchObject({ graph_entity_id: `onb_${candidateId}` });
        expect(fixture.graphWrites).toHaveLength(1);
        await expect(fixture.service.getRun(actor(), ingested.id)).resolves.toMatchObject({
            status: 'answering',
            promoted_graph_entity_ids: [`onb_${candidateId}`]
        });
    });

    it('同一source_idへの別receipt版をcandidate write前に409で拒否する', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        await expect(fixture.service.ingestSource(actor(), ingested.id, {
            source: {
                mode: 'drive', source_id: 'drive:source-1', evidence_ref: 'drive:source-1#new-item',
                content_hash: HASH_B, permission_snapshot: { visibility: 'team' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'project', fact: 'Brainbase は新しい版を公開した',
                observation_class: 'observed', evidence_id: 'drive:source-1#new-item'
            }]
        })).rejects.toMatchObject({ code: 'source_receipt_conflict', statusCode: 409 });

        const candidates = await fixture.service.candidateRepository.list({ owner_person_id: 'per_owner' });
        expect(candidates).toHaveLength(1);
        await expect(fixture.service.getRun(actor(), ingested.id)).resolves.toMatchObject({
            sources: [{ content_hash: HASH_A, permission_snapshot: { visibility: 'owner' } }]
        });
    });

    it('同一source_idへの競合receiptを直列化し矛盾するcandidateを残さない', async () => {
        const fixture = createFixture();
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '競合するDrive sourceを理解する', source_mode: 'drive'
        });
        const ingest = (suffix, contentHash, visibility) => fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'drive', source_id: 'drive:concurrent-version', evidence_ref: `drive:concurrent-version#${suffix}`,
                content_hash: contentHash, permission_snapshot: { visibility }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: `source ${suffix} の観測事実`,
                observation_class: 'observed', evidence_id: `drive:concurrent-version#${suffix}`
            }]
        });

        const results = await Promise.allSettled([
            ingest('first', HASH_A, 'owner'),
            ingest('second', HASH_B, 'team')
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const [rejected] = results.filter((result) => result.status === 'rejected');
        expect(rejected.reason).toMatchObject({ code: 'source_receipt_conflict', statusCode: 409 });
        const current = await fixture.service.getRun(actor(), run.id);
        const durable = await fixture.candidateRepository.list({ owner_person_id: 'per_owner' });
        expect(current.sources).toHaveLength(1);
        expect(current.candidates).toHaveLength(1);
        expect(durable).toHaveLength(1);
        expect(JSON.parse(durable[0].body)).toMatchObject({
            content_hash: current.sources[0].content_hash,
            evidence_ref: current.sources[0].evidence_ref
        });
        expect(durable[0].permission_snapshot).toEqual(current.sources[0].permission_snapshot);
    });

    it('正規化後に同一となるsource_idも同じqueueで直列化する', async () => {
        const fixture = createFixture();
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '表記揺れのあるDrive sourceを理解する', source_mode: 'drive'
        });
        const ingest = (sourceId, suffix, contentHash, visibility) => fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'drive', source_id: sourceId, evidence_ref: `drive:normalized-version#${suffix}`,
                content_hash: contentHash, permission_snapshot: { visibility }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: `normalized source ${suffix} の観測事実`,
                observation_class: 'observed', evidence_id: `drive:normalized-version#${suffix}`
            }]
        });

        const results = await Promise.allSettled([
            ingest('drive:normalized-version', 'first', HASH_A, 'owner'),
            ingest(' drive:normalized-version ', 'second', HASH_B, 'team')
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const [rejected] = results.filter((result) => result.status === 'rejected');
        expect(rejected.reason).toMatchObject({ code: 'source_receipt_conflict', statusCode: 409 });
        const current = await fixture.service.getRun(actor(), run.id);
        const durable = await fixture.candidateRepository.list({ owner_person_id: 'per_owner' });
        expect(current.sources).toHaveLength(1);
        expect(current.candidates).toHaveLength(1);
        expect(durable).toHaveLength(1);
        expect(JSON.parse(durable[0].body)).toMatchObject({
            content_hash: current.sources[0].content_hash,
            evidence_ref: current.sources[0].evidence_ref
        });
        expect(durable[0].permission_snapshot).toEqual(current.sources[0].permission_snapshot);
    });

    it.each([
        ['長いsource_idの後にprefix source_id', 'drive:file:page', 'drive:file'],
        ['prefix source_idの後に長いsource_id', 'drive:file', 'drive:file:page']
    ])('%sも別receiptとして順序非依存に取り込める', async (_label, firstSourceId, secondSourceId) => {
        const fixture = createFixture();
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '複数Drive sourceを理解する', source_mode: 'drive'
        });
        const ingest = (sourceId, suffix) => fixture.service.ingestSource(actor(), run.id, {
            source: {
                mode: 'drive', source_id: sourceId, evidence_ref: `${sourceId}#${suffix}`,
                content_hash: suffix === 'first' ? HASH_A : HASH_B,
                permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: `source ${suffix} の観測事実`,
                observation_class: 'observed', evidence_id: `${sourceId}#${suffix}`
            }]
        });

        await ingest(firstSourceId, 'first');
        const completed = await ingest(secondSourceId, 'second');

        expect(completed.sources.map((source) => source.source_id)).toEqual([firstSourceId, secondSourceId]);
        expect(completed.candidates).toHaveLength(2);
        const durable = await fixture.candidateRepository.list({ owner_person_id: 'per_owner' });
        expect(durable).toHaveLength(2);
        expect(durable.map((candidate) => candidate.source_event_ids[0])).toEqual(expect.arrayContaining([
            sourceEventIdFor(run.id, firstSourceId, `${firstSourceId}#first`),
            sourceEventIdFor(run.id, secondSourceId, `${secondSourceId}#second`)
        ]));
    });

    it('run ledger失敗後もevidence_idを変えた別receipt版をdurable candidateから409で拒否する', async () => {
        const fixture = createFixture();
        const repository = fixture.service.repository;
        const originalUpdate = repository.update.bind(repository);
        let fail = true;
        repository.update = async (...args) => {
            if (fail) {
                fail = false;
                throw new Error('simulated source ledger failure');
            }
            return originalUpdate(...args);
        };
        const run = await fixture.service.startRun(actor(), {
            project_code: 'brainbase', value_target: '組織を理解する', source_mode: 'drive'
        });
        const first = {
            source: {
                mode: 'drive', source_id: 'drive:receipt-gap', evidence_ref: 'drive:receipt-gap#v1',
                content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
            },
            candidates: [{
                subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
                observation_class: 'observed', evidence_id: 'drive:receipt-gap#v1'
            }]
        };

        await expect(fixture.service.ingestSource(actor(), run.id, first))
            .rejects.toThrow('simulated source ledger failure');
        await expect(fixture.service.ingestSource(actor(), run.id, {
            source: {
                ...first.source,
                evidence_ref: 'drive:receipt-gap#v2', content_hash: HASH_B,
                permission_snapshot: { visibility: 'team' }
            },
            candidates: [{
                ...first.candidates[0], evidence_id: 'drive:receipt-gap#v2',
                fact: 'Unson LLC は Brainbase の新しい版を運営している'
            }]
        })).rejects.toMatchObject({ code: 'source_receipt_conflict', statusCode: 409 });

        const candidates = await fixture.service.candidateRepository.list({ owner_person_id: 'per_owner' });
        expect(candidates).toHaveLength(1);
        expect(candidates[0].evidence_ids).toEqual(['drive:receipt-gap#v1']);
        await expect(fixture.service.getRun(actor(), run.id))
            .resolves.toMatchObject({ status: 'collecting', sources: [], candidates: [] });
    });

    it('完了runを再度変更できず、missing_contextのsecret-like値を拒否する', async () => {
        const fixture = createFixture();
        const ingested = await startAndIngest(fixture);
        const promoted = await fixture.service.reviewCandidate(actor(), ingested.id, ingested.candidates[0].id, { decision: 'approve' });

        await expect(fixture.service.recordFirstValue(actor(), ingested.id, {
            answer_hash: HASH_B,
            used_graph_entity_ids: [promoted.graph_entity_id],
            missing_context: ['Bearer TOP_SECRET_TOKEN'],
            ...FIRST_VALUE_PRESENTATION
        })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected' });
        await fixture.service.recordFirstValue(actor(), ingested.id, {
            answer_hash: HASH_B, used_graph_entity_ids: [promoted.graph_entity_id], missing_context: ['customer_org_name'],
            ...FIRST_VALUE_PRESENTATION
        });
        await fixture.service.reviewFirstValue(actor(), ingested.id, { verdict: 'useful' });

        await expect(fixture.service.ingestSource(actor(), ingested.id, { source: {}, candidates: [] }))
            .rejects.toMatchObject({ code: 'onboarding_state_conflict', statusCode: 409 });
        await expect(fixture.service.reviewFirstValue(actor(), ingested.id, { verdict: 'not_useful' }))
            .rejects.toMatchObject({ code: 'onboarding_state_conflict', statusCode: 409 });
    });

    it('再起動可能なrun ledgerへraw本文を保存せずreceiptだけを永続化する', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-onboarding-ledger-'));
        const filePath = path.join(tempDir, 'runs.json');
        try {
            const candidateRepository = new InMemoryCandidateRepository();
            const createService = (repository) => new OnboardingRuntimeService({
                repository,
                candidateRepository,
                infoSSOTService: {
                    async createOrUpdateGraphEntity(_access, input) { return { entity_id: input.id }; },
                    async createOrUpdateGraphEdge(_access, input) { return { from_id: input.fromId, to_id: input.toId, rel_type: input.relType }; }
                },
                now: () => new Date('2026-08-02T00:00:00.000Z'),
                idFactory: () => 'onb_persisted'
            });
            const first = createService(new JsonFileOnboardingRunRepository({ filePath }));
            const run = await first.startRun(actor(), {
                project_code: 'brainbase', value_target: '運営会社はどこか', source_mode: 'drive'
            });
            await first.ingestSource(actor(), run.id, {
                source: {
                    mode: 'drive', source_id: 'drive:file-1', evidence_ref: 'drive:file-1#p2',
                    content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected'
                },
                candidates: [{
                    subject_type: 'org', fact: '永続化してはいけないraw由来の短いfact',
                    observation_class: 'observed', evidence_id: 'drive:file-1#p2'
                }]
            });

            const ledger = await fs.readFile(filePath, 'utf8');
            expect(ledger).not.toContain('永続化してはいけないraw由来の短いfact');
            expect(ledger).toContain('drive:file-1#p2');
            const reloaded = createService(new JsonFileOnboardingRunRepository({ filePath }));
            const resumed = await reloaded.getRun(actor(), run.id);
            expect(resumed).toMatchObject({ id: 'onb_persisted', status: 'reviewing', source_mode: 'drive' });
            expect(resumed.candidates[0]).toMatchObject({
                fact: '永続化してはいけないraw由来の短いfact',
                evidence_ref: 'drive:file-1#p2'
            });
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('JSON run ledgerへの同時更新を直列化しsource receiptを失わない', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-onboarding-concurrency-'));
        const filePath = path.join(tempDir, 'runs.json');
        try {
            const repository = new JsonFileOnboardingRunRepository({ filePath });
            await repository.create({ id: 'onb_concurrent', sources: [] });
            const appendSource = (sourceId) => repository.update('onb_concurrent', async (current) => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { ...current, sources: [...current.sources, sourceId] };
            });

            await Promise.all([appendSource('drive:file-1'), appendSource('gmail:message-1')]);

            await expect(repository.findById('onb_concurrent')).resolves.toMatchObject({
                sources: ['drive:file-1', 'gmail:message-1']
            });
            const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
            expect(persisted.runs[0].sources).toEqual(['drive:file-1', 'gmail:message-1']);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('JSON run ledgerの永続化失敗時にmemoryをrollbackし次のwriteを回復する', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-onboarding-ledger-failure-'));
        const filePath = path.join(tempDir, 'runs.json');
        try {
            const repository = new JsonFileOnboardingRunRepository({ filePath });
            await repository.create({ id: 'onb_rollback', sources: [] });
            repository.filePath = tempDir;

            await expect(repository.update('onb_rollback', (current) => ({
                ...current,
                sources: [...current.sources, 'drive:failed']
            }))).rejects.toBeTruthy();
            await expect(repository.findById('onb_rollback')).resolves.toMatchObject({ sources: [] });

            repository.filePath = filePath;
            await repository.update('onb_rollback', (current) => ({
                ...current,
                sources: [...current.sources, 'drive:recovered']
            }));
            await expect(repository.findById('onb_rollback')).resolves.toMatchObject({
                sources: ['drive:recovered']
            });
            const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
            expect(persisted.runs[0].sources).toEqual(['drive:recovered']);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('未知のrun ledger schemaを読み書きせずversion skewをfail-closedにする', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-onboarding-version-skew-'));
        const filePath = path.join(tempDir, 'runs.json');
        const unsupportedLedger = JSON.stringify({
            schema_version: 'onboarding_runs.v2',
            runs: [{ id: 'onb_future', sources: [] }]
        });
        try {
            await fs.writeFile(filePath, unsupportedLedger);
            const repository = new JsonFileOnboardingRunRepository({ filePath });

            await expect(repository.findById('onb_future')).rejects.toMatchObject({
                code: 'onboarding_ledger_schema_unsupported',
                statusCode: 503
            });
            await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(unsupportedLedger);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
