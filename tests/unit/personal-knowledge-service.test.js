import { describe, expect, it, vi } from 'vitest';

import { PersonalKnowledgeService } from '../../server/services/personal-knowledge/personal-knowledge-service.js';

const access = { personId: 'person_a', organizationId: 'org_a', role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

describe('PersonalKnowledgeService', () => {
    it('creates an immutable owner-scoped event and initial transitions', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: {} })),
            findById: vi.fn(async () => null),
            createEvent: vi.fn(async (event) => event),
            appendTransition: vi.fn(async (_id, transition) => transition)
        };
        const service = new PersonalKnowledgeService({ repository, now: () => new Date('2026-08-14T00:00:00.000Z') });

        const result = await service.ingest({
            event_id: 'pke_1', occurred_at: '2026-08-13T23:00:00.000Z',
            source: { type: 'codex' }, source_pointer: { uri: 'codex://threads/t1' },
            body_hash: 'sha256:one', body: '個人の判断メモ'
        }, { access });

        expect(repository.createEvent).toHaveBeenCalledWith(expect.objectContaining({
            event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a'
        }), expect.objectContaining({ client: expect.any(Object), access }));
        expect(repository.appendTransition).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ event_id: 'pke_1', processing_stage: 'received', semantic_state: 'active' });
    });

    it('rejects reuse of the same event ID with a different immutable source pointer', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: {} })),
            findById: vi.fn(async () => ({
                event_id: 'pke_1', body_hash: 'sha256:one',
                source: { type: 'codex' }, source_pointer: { uri: 'codex://threads/original' }
            }))
        };
        const service = new PersonalKnowledgeService({ repository });

        await expect(service.ingest({
            event_id: 'pke_1', body_hash: 'sha256:one',
            source: { type: 'codex' }, source_pointer: { uri: 'codex://threads/changed' }
        }, { access })).rejects.toThrow('personal_knowledge_event_identity_conflict');
    });

    it('searches only the authenticated owner scope', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: { id: 'tx' } })),
            search: vi.fn(async () => [{ event_id: 'pke_1', body: 'private' }])
        };
        const service = new PersonalKnowledgeService({ repository });

        await service.search({ query: '判断', limit: 3 }, { access });

        expect(repository.transaction).toHaveBeenCalledWith(expect.any(Function), { access });
        expect(repository.search).toHaveBeenCalledWith(expect.objectContaining({ query: '判断', limit: 3 }), {
            access,
            client: { id: 'tx' }
        });
    });

    it('reads an event cycle inside the authenticated RLS transaction', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: { id: 'cycle-tx' } })),
            findById: vi.fn(async () => ({ event_id: 'pke_1' })),
            listTransitions: vi.fn(async () => [{ transition_type: 'processing_stage' }])
        };
        const service = new PersonalKnowledgeService({ repository });

        await service.getCycle('pke_1', { access });

        expect(repository.findById).toHaveBeenCalledWith('pke_1', { access, client: { id: 'cycle-tx' } });
        expect(repository.listTransitions).toHaveBeenCalledWith('pke_1', { access, client: { id: 'cycle-tx' } });
    });

    it('records ohayo usage as an append-only personal transition', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: { id: 'usage-tx' } })),
            findById: vi.fn(async () => ({ event_id: 'pke_1' })),
            appendTransition: vi.fn(async (_eventId, transition) => transition)
        };
        const service = new PersonalKnowledgeService({
            repository,
            now: () => new Date('2026-08-14T00:00:00.000Z')
        });

        await service.recordUsage('pke_1', { access });

        expect(repository.appendTransition).toHaveBeenCalledWith('pke_1', expect.objectContaining({
            transition_type: 'usage',
            payload: { routine: 'ohayo', outcome: 'used' }
        }), { access, client: { id: 'usage-tx' } });
    });

    it('runs routine summary, compaction and verification inside owner-scoped transactions', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: { id: 'routine-tx' } })),
            summarizeRoutineState: vi.fn(async () => ({ unprocessed_count: 0, episode_ids: ['ep_1'] })),
            compressRoutineEpisodes: vi.fn(async () => ({ confirmed: true, episode_ids: ['ep_1'] })),
            verifyRoutineRetrievability: vi.fn(async () => ({ retrievable: true, missing_ids: [] }))
        };
        const service = new PersonalKnowledgeService({ repository });

        await service.summarizeRoutineState({ project_id: 'brainbase' }, { access });
        await service.compressRoutineEpisodes({ project_id: 'brainbase', episode_ids: ['ep_1'] }, { access });
        await service.verifyRoutineRetrievability({ project_id: 'brainbase', episode_ids: ['ep_1'] }, { access });

        expect(repository.summarizeRoutineState).toHaveBeenCalledWith(
            { project_id: 'brainbase' }, { access, client: { id: 'routine-tx' } }
        );
        expect(repository.compressRoutineEpisodes).toHaveBeenCalledWith(
            { project_id: 'brainbase', episode_ids: ['ep_1'] }, { access, client: { id: 'routine-tx' } }
        );
        expect(repository.verifyRoutineRetrievability).toHaveBeenCalledWith(
            { project_id: 'brainbase', episode_ids: ['ep_1'] }, { access, client: { id: 'routine-tx' } }
        );
    });

    it('persists privileged proxy access in the authenticated transaction', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: { id: 'audit-tx' } })),
            recordPrivilegedAccess: vi.fn(async (entry) => entry)
        };
        const service = new PersonalKnowledgeService({
            repository,
            now: () => new Date('2026-08-14T00:00:00.000Z')
        });
        const entry = {
            action: 'personal_knowledge_proxy', personId: 'person_a', organizationId: 'org_a',
            actorPersonId: 'service_agent', projectCodes: ['brainbase'], clearance: ['internal']
        };

        await service.auditAccess(entry);

        expect(repository.recordPrivilegedAccess).toHaveBeenCalledWith(
            expect.objectContaining({ occurredAt: '2026-08-14T00:00:00.000Z' }),
            expect.objectContaining({ client: { id: 'audit-tx' }, access: expect.objectContaining({ personId: 'person_a' }) })
        );
    });
});
