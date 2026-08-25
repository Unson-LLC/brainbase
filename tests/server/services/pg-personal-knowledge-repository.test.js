import { describe, expect, it, vi } from 'vitest';

import { PgPersonalKnowledgeRepository } from '../../../server/services/personal-knowledge/pg-personal-knowledge-repository.js';

const access = { personId: 'person_a', actorPersonId: 'actor_a', organizationId: 'org_a', role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

describe('PgPersonalKnowledgeRepository', () => {
    it('sets every RLS identity variable inside the transaction', async () => {
        const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
        const repository = new PgPersonalKnowledgeRepository({ pool: { query: client.query, connect: vi.fn(async () => client) } });

        await repository.transaction(async () => 'ok', { access });

        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.person_id', 'person_a']);
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.actor_person_id', 'actor_a']);
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.organization_id', 'org_a']);
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.project_codes', 'brainbase']);
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.role', 'member']);
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.clearance', 'internal']);
    });

    it('fails closed before SQL when person or organization context is absent', async () => {
        const pool = { query: vi.fn(), connect: vi.fn() };
        const repository = new PgPersonalKnowledgeRepository({ pool });

        await expect(repository.transaction(async () => 'no', { access: { personId: 'person_a' } }))
            .rejects.toThrow('personal_knowledge_identity_required');
        expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rejects direct queries that are not bound to an RLS transaction client', async () => {
        const pool = { query: vi.fn() };
        const repository = new PgPersonalKnowledgeRepository({ pool });

        await expect(repository.search({ query: 'private' }, { access }))
            .rejects.toThrow('personal_knowledge_transaction_required');
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('derives processing and semantic state independently from append-only transitions', async () => {
        const client = { query: vi.fn(async () => ({ rows: [{ event_id: 'pke_1' }] })) };
        const repository = new PgPersonalKnowledgeRepository({ pool: { query: vi.fn() } });

        await repository.findById('pke_1', { access, client });

        const [sql] = client.query.mock.calls[0];
        expect(sql).toContain("processing.processing_stage");
        expect(sql).toContain("semantic.semantic_state");
        expect(sql).toContain("transition.processing_stage IS NOT NULL");
        expect(sql).toContain("transition.semantic_state IS NOT NULL");
    });

    it('summarizes only the authenticated Personal Vault from append-only current state', async () => {
        const client = { query: vi.fn(async () => ({ rows: [{
            unprocessed_count: 1, contradiction_count: 2, expired_count: 3,
            episode_ids: ['ep_1']
        }] })) };
        const repository = new PgPersonalKnowledgeRepository({ pool: { query: vi.fn() } });

        const result = await repository.summarizeRoutineState(
            { project_id: 'brainbase' }, { access, client }
        );

        const [sql] = client.query.mock.calls[0];
        expect(sql).toContain('personal_knowledge_events');
        expect(sql).toContain('processing_stage IS NOT NULL');
        expect(sql).toContain('semantic_state IS NOT NULL');
        expect(result).toEqual(expect.objectContaining({ episode_ids: ['ep_1'] }));
    });

    it('persists immutable personal episode artifacts and confirms their readback', async () => {
        const client = { query: vi.fn()
            .mockResolvedValueOnce({ rows: [{ event_id: 'pke_1', parent_episode_id: 'ep_1', body_hash: 'h1', body: '判断A' }] })
            .mockResolvedValueOnce({ rows: [{ artifact_id: 'artifact_1' }] })
            .mockResolvedValueOnce({ rows: [{ episode_id: 'ep_1' }] }) };
        const repository = new PgPersonalKnowledgeRepository({ pool: { query: vi.fn() } });

        const result = await repository.compressRoutineEpisodes(
            { project_id: 'brainbase', episode_ids: ['ep_1'] }, { access, client }
        );

        const insertSql = client.query.mock.calls[1][0];
        expect(insertSql).toContain('INSERT INTO episode_compaction_artifacts');
        expect(insertSql).toContain("'personal'");
        expect(result).toEqual({ confirmed: true, episode_ids: ['ep_1'], missing_ids: [] });
    });
});
