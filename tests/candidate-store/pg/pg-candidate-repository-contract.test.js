// @ts-check
import { describe, it, expect } from 'vitest';
import {
    PgCandidateRepository,
    DuplicateCandidateError,
    InvalidTransitionError
} from '../../../server/services/candidate-store/candidate-repository.js';
import { baseDraft } from '../_helpers.js';

class ScriptedPg {
    constructor(responses = []) {
        this.responses = responses;
        this.calls = [];
    }

    async query(sql, params = []) {
        this.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        const next = this.responses.shift();
        if (!next) return { rows: [] };
        if (next.error) throw next.error;
        return { rows: next.rows || [] };
    }
}

const dbRow = (overrides = {}) => ({
    id: 'cand_pg_1',
    cognitive_type: 'observation',
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    source_system: 'brainbase',
    source_event_ids: ['session:pg:1'],
    workspace: 'unson',
    channel_id: null,
    thread_ts: null,
    project_code: 'brainbase',
    org_ids: ['unson'],
    project_ids: [],
    team_id: null,
    visibility: 'owner',
    sensitivity: 'internal',
    role_min: 'member',
    agency_level: 'synthesize',
    recommended_subject_type: null,
    recommended_subject_id: null,
    processing_stage: 'received',
    semantic_state: 'active',
    target_tier: 'ledger',
    recommended_owner_person_id: null,
    promotion_status: 'candidate',
    promoted_graph_entity_id: null,
    requires_approval: true,
    permission_snapshot: null,
    evidence_ids: [],
    body: 'Pg contract candidate',
    redaction_status: 'none',
    confidence: null,
    expires_at: null,
    created_at: new Date('2026-05-11T00:00:00.000Z'),
    updated_at: new Date('2026-05-11T00:00:00.000Z'),
    ...overrides
});

describe('PgCandidateRepository contract', () => {
    it('creates candidate rows with JSON/array fields and returns normalized records', async () => {
        const pg = new ScriptedPg([{ rows: [] }, { rows: [dbRow()] }]);
        const repo = new PgCandidateRepository({ pool: pg });
        const created = await repo.create(baseDraft({
            id: 'cand_pg_1',
            body: 'Pg contract candidate',
            source_event_ids: ['session:pg:1']
        }));

        expect(created.created_at).toBe('2026-05-11T00:00:00.000Z');
        expect(created.source_event_ids).toEqual(['session:pg:1']);
        expect(created).toMatchObject({
            processing_stage: 'received',
            semantic_state: 'active',
            target_tier: 'ledger'
        });
        expect(pg.calls[1].sql).toContain('INSERT INTO memory_candidates');
        expect(pg.calls[1].sql).toContain('processing_stage');
        expect(pg.calls[1].sql).toContain('semantic_state');
        expect(pg.calls[1].sql).toContain('target_tier');
        expect(pg.calls[1].params).toEqual(expect.arrayContaining(['received', 'active', 'ledger']));
        expect(pg.calls[1].params).toContain('cand_pg_1');
        expect(pg.calls[1].params).toContain(JSON.stringify(['session:pg:1']));
    });

    it('lists rows with DB-side owner filter, created_at ordering, and limit', async () => {
        const pg = new ScriptedPg([{ rows: [dbRow()] }]);
        const repo = new PgCandidateRepository({ pool: pg });

        const rows = await repo.list({ owner_person_id: 'sato_keigo', order_by: 'created_at', order_direction: 'desc', limit: 1 });

        expect(rows).toHaveLength(1);
        expect(pg.calls[0].sql).toContain('WHERE owner_person_id = $1');
        expect(pg.calls[0].sql).toContain('ORDER BY created_at DESC, id DESC');
        expect(pg.calls[0].sql).toContain('LIMIT $2');
        expect(pg.calls[0].params).toEqual(['sato_keigo', 1]);
    });

    it('lists rows with DB-side id filter before limit', async () => {
        const pg = new ScriptedPg([{ rows: [dbRow()] }]);
        const repo = new PgCandidateRepository({ pool: pg });

        await repo.list({ id: 'cand_pg_1', limit: 1 });

        expect(pg.calls[0].sql).toContain('WHERE id = $1');
        expect(pg.calls[0].sql).toContain('LIMIT $2');
        expect(pg.calls[0].params).toEqual(['cand_pg_1', 1]);
    });

    it('lists durable onboarding candidates by exact source system and source-event prefix', async () => {
        const pg = new ScriptedPg([{ rows: [dbRow()] }]);
        const repo = new PgCandidateRepository({ pool: pg });

        await repo.list({
            owner_person_id: 'sato_keigo',
            source_system: 'onboarding:drive',
            source_event_prefix: `run_1:source_sha256:${'a'.repeat(64)}:`
        });

        expect(pg.calls[0].sql).toContain('source_system = $2');
        expect(pg.calls[0].sql).toContain('starts_with(event_id, $3)');
        expect(pg.calls[0].params).toEqual([
            'sato_keigo',
            'onboarding:drive',
            `run_1:source_sha256:${'a'.repeat(64)}:`
        ]);
    });

    it('lists Personal KG rows with owner ACL, derived policy fields, and bounded limit', async () => {
        const pg = new ScriptedPg([{ rows: [dbRow({ memory_layer: 'personal_kg_core', sns_ready: true })] }]);
        const repo = new PgCandidateRepository({ pool: pg });

        const rows = await repo.listPersonalKg({
            owner_person_id: 'sato_keigo',
            role: 'gm',
            clearance: ['internal'],
            cognitive_types: ['observation', 'insight'],
            memory_layer: 'personal_kg_core',
            limit: 1
        });

        expect(rows[0]).toMatchObject({ id: 'cand_pg_1', memory_layer: 'personal_kg_core', sns_ready: true });
        expect(pg.calls[0].sql).toContain('FROM memory_candidates');
        expect(pg.calls[0].sql).toContain("semantic_state = 'active'");
        expect(pg.calls[0].sql).toContain('owner_person_id = $1');
        expect(pg.calls[0].sql).toContain("visibility IN ('owner', 'private')");
        expect(pg.calls[0].sql).toContain('role_min IS NULL OR role_min = ANY');
        expect(pg.calls[0].sql).toContain('sensitivity IS NULL OR sensitivity = ANY');
        expect(pg.calls[0].sql).toContain("permission_snapshot->'seed'->>'projection_allowed'");
        expect(pg.calls[0].sql).toContain("permission_snapshot->>'projection_allowed'");
        expect(pg.calls[0].sql).toContain('ORDER BY created_at DESC, id DESC');
        expect(pg.calls[0].sql).toContain('LIMIT $6');
        expect(pg.calls[0].params).toEqual(['sato_keigo', ['observation', 'insight'], ['member', 'gm'], ['internal'], 'personal_kg_core', 1]);
    });

    it('lists Personal KG owner-read rows without applying generic role or sensitivity filters', async () => {
        const pg = new ScriptedPg([{ rows: [dbRow({ sensitivity: 'confidential' })] }]);
        const repo = new PgCandidateRepository({ pool: pg });

        await repo.listPersonalKg({
            owner_person_id: 'sato_keigo',
            role: 'member',
            clearance: ['internal'],
            owner_read: true,
            limit: 5
        });

        expect(pg.calls[0].sql).not.toContain('role_min IS NULL OR role_min = ANY');
        expect(pg.calls[0].sql).not.toContain('sensitivity IS NULL OR sensitivity = ANY');
        expect(pg.calls[0].params).toEqual(['sato_keigo', ['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result'], 5]);
    });

    it('summarizes Personal KG rows with DB-side aggregation', async () => {
        const pg = new ScriptedPg([{
            rows: [{
                total: 2,
                active_count: 2,
                core_count: 1,
                sns_ready_count: 1,
                review_count: 1,
                needs_redaction_count: 1,
                agency_none_count: 0,
                latest_seen_at: new Date('2026-06-13T18:03:15.814Z'),
                counts_by_cognitive_type: { observation: 1, insight: 1 },
                counts_by_promotion_status: { candidate: 1, approved: 1 },
                counts_by_redaction_status: { none: 1, needs_redaction: 1 },
                counts_by_source_system: { brainbase: 2 },
                counts_by_memory_layer: { personal_kg_core: 1, sns_ready: 1 }
            }]
        }]);
        const repo = new PgCandidateRepository({ pool: pg });

        const summary = await repo.summarizePersonalKg({ owner_person_id: 'sato_keigo', role: 'member', clearance: ['internal'] });

        expect(summary).toMatchObject({
            total: 2,
            active_count: 2,
            core_count: 1,
            sns_ready_count: 1,
            review_count: 1,
            needs_redaction_count: 1,
            agency_none_count: 0,
            counts_by_cognitive_type: { observation: 1, insight: 1 }
        });
        expect(summary.latest_seen_at).toBe('2026-06-13T18:03:15.814Z');
        expect(pg.calls[0].sql).toContain('WITH filtered AS');
        expect(pg.calls[0].sql).toContain("semantic_state = 'active'");
        expect(pg.calls[0].sql).toContain('jsonb_object_agg');
        expect(pg.calls[0].sql).toContain("permission_snapshot->'seed'->>'projection_allowed'");
        expect(pg.calls[0].sql).toContain("permission_snapshot->>'projection_allowed'");
        expect(pg.calls[0].params).toEqual(['sato_keigo', ['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result'], ['member'], ['internal']]);
    });

    it('searches only active Personal KG rows', async () => {
        const pg = new ScriptedPg([{ rows: [dbRow()] }]);
        const repo = new PgCandidateRepository({ pool: pg });

        await repo.searchPersonalKg({ owner_person_id: 'sato_keigo', query: '価格', limit: 5 });

        expect(pg.calls[0].sql).toContain("semantic_state = 'active'");
    });

    it('maps unique source constraint violations to DuplicateCandidateError', async () => {
        const pg = new ScriptedPg([{ error: Object.assign(new Error('duplicate'), { code: '23505' }) }]);
        const repo = new PgCandidateRepository({ pool: pg });
        await expect(repo.create(baseDraft())).rejects.toBeInstanceOf(DuplicateCandidateError);
    });

    it('rejects an existing primary id before insert even when the source key differs', async () => {
        const pg = new ScriptedPg([{ rows: [{ id: 'candidate-stable-id' }] }]);
        const repo = new PgCandidateRepository({ pool: pg });

        await expect(repo.create(baseDraft({
            id: 'candidate-stable-id',
            source_event_ids: ['session:different-source-key']
        }))).rejects.toBeInstanceOf(DuplicateCandidateError);

        expect(pg.calls).toHaveLength(1);
        expect(pg.calls[0].sql).toContain('id = $1');
        expect(pg.calls[0].params[0]).toBe('candidate-stable-id');
    });

    it('transitions status in one transaction and appends audit', async () => {
        const pg = new ScriptedPg([
            {},
            { rows: [dbRow()] },
            { rows: [dbRow({ promotion_status: 'pending_approval' })] },
            { rows: [{ id: 1, candidate_id: 'cand_pg_1', actor_person_id: 'sato_keigo', previous_status: 'candidate', next_status: 'pending_approval', decided_at: new Date('2026-05-11T00:00:01.000Z') }] },
            {}
        ]);
        const repo = new PgCandidateRepository({ pool: pg });
        const transitioned = await repo.transition('cand_pg_1', 'pending_approval', { actor_person_id: 'sato_keigo' });

        expect(transitioned.promotion_status).toBe('pending_approval');
        expect(pg.calls.map((c) => c.sql)).toEqual(expect.arrayContaining([
            'BEGIN',
            'COMMIT'
        ]));
        expect(pg.calls.some((c) => c.sql.includes('INSERT INTO promotion_audit_events'))).toBe(true);
    });

    it('rejects invalid status transitions before update', async () => {
        const pg = new ScriptedPg([
            {},
            { rows: [dbRow({ promotion_status: 'pending_approval' })] },
            {}
        ]);
        const repo = new PgCandidateRepository({ pool: pg });

        await expect(repo.transition('cand_pg_1', 'candidate', { actor_person_id: 'sato_keigo' }))
            .rejects.toBeInstanceOf(InvalidTransitionError);
        expect(pg.calls.some((c) => c.sql.startsWith('UPDATE memory_candidates'))).toBe(false);
        expect(pg.calls.map((c) => c.sql)).toContain('ROLLBACK');
    });

    it('processingを単調に進め、semantic列には触れない', async () => {
        const pg = new ScriptedPg([
            {},
            { rows: [dbRow({ processing_stage: 'received', semantic_state: 'quarantined' })] },
            { rows: [dbRow({ processing_stage: 'queued', semantic_state: 'quarantined' })] },
            {}
        ]);
        const repo = new PgCandidateRepository({ pool: pg });

        const updated = await repo.transitionProcessingStage('cand_pg_1', 'queued');

        expect(updated).toMatchObject({ processing_stage: 'queued', semantic_state: 'quarantined' });
        const update = pg.calls.find((call) => call.sql.startsWith('UPDATE memory_candidates'));
        expect(update.sql).toContain('processing_stage');
        expect(update.sql).not.toContain('semantic_state');
    });

    it('processingの逆行を拒否して永続状態を更新しない', async () => {
        const pg = new ScriptedPg([
            {},
            { rows: [dbRow({ processing_stage: 'extracted' })] },
            {}
        ]);
        const repo = new PgCandidateRepository({ pool: pg });

        await expect(repo.transitionProcessingStage('cand_pg_1', 'queued'))
            .rejects.toBeInstanceOf(InvalidTransitionError);
        expect(pg.calls.some((call) => call.sql.startsWith('UPDATE memory_candidates'))).toBe(false);
    });

    it('semanticを独立更新しprocessing列には触れない', async () => {
        const pg = new ScriptedPg([{
            rows: [dbRow({ processing_stage: 'indexed', semantic_state: 'contradicted' })]
        }]);
        const repo = new PgCandidateRepository({ pool: pg });

        const updated = await repo.updateSemanticState('cand_pg_1', 'contradicted');

        expect(updated).toMatchObject({ processing_stage: 'indexed', semantic_state: 'contradicted' });
        expect(pg.calls[0].sql).toContain('semantic_state');
        expect(pg.calls[0].sql).not.toContain('processing_stage');
    });
});
