import { describe, expect, it, vi } from 'vitest';

import { InfoSSOTKnowledgeGraphRepository } from '../../server/services/knowledge-event/info-ssot-knowledge-graph-repository.js';

const access = {
    personId: 'person_reviewer', organizationId: 'org_a', role: 'gm',
    projectCodes: ['brainbase'], clearance: ['internal']
};

function serviceFixture() {
    const client = { query: vi.fn(async () => ({ rows: [{ id: 'project_uuid' }] })) };
    const infoSSOTService = {
        withAccessContext: vi.fn(async (_access, work) => work(client)),
        assertDecisionAuthority: vi.fn(async () => undefined),
        commitOntologyGraph: vi.fn(async (_access, input) => ({
            entity_id: input.entity.id,
            edge_count: input.edges?.length || 0,
            ontology_version: '1.0.0'
        }))
    };
    return { client, infoSSOTService };
}

describe('InfoSSOTKnowledgeGraphRepository normalized promotion', () => {
    it('validates decision authority before committing a normalized decision', async () => {
        const { client, infoSSOTService } = serviceFixture();
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const result = await repository.commitNormalizedPromotion({
            project_code: 'brainbase',
            entity: {
                id: 'decision_1',
                type: 'decision',
                payload: {
                    statement: '暗黙fallbackを禁止する',
                    decision_authority: { decider_id: 'person_a', domain: 'brainbase_architecture' },
                    promotion_evidence: { normalized_payload_hash: 'sha256:abc' }
                }
            },
            edges: [],
            context_entities: [],
            role_min: 'member',
            sensitivity: 'internal'
        }, { client, access });

        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledWith(client, {
            projectId: 'project_uuid',
            projectCode: 'brainbase',
            personId: 'person_a',
            decisionDomain: 'brainbase_architecture'
        });
        expect(infoSSOTService.commitOntologyGraph).toHaveBeenCalledWith(
            access,
            expect.objectContaining({
                projectCode: 'brainbase',
                entity: expect.objectContaining({ id: 'decision_1', type: 'decision' })
            }),
            { client, access_context_applied: true }
        );
        expect(result).toMatchObject({ id: 'decision_1', entity_type: 'decision' });
    });

    it('commits normalized entities and explicit relations without fabricating authority', async () => {
        const { client, infoSSOTService } = serviceFixture();
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const result = await repository.commitNormalizedPromotion({
            project_code: 'brainbase',
            entity: {
                id: 'project_brainbase',
                type: 'project',
                payload: { name: 'Brainbase', promotion_evidence: { normalized_payload_hash: 'sha256:abc' } }
            },
            edges: [{
                from_id: 'project_brainbase', to_id: 'org_unson', relation: 'owned_by',
                payload: { promotion_evidence: { normalized_payload_hash: 'sha256:abc' } }
            }],
            context_entities: [{ id: 'org_unson', type: 'org' }],
            role_min: 'member',
            sensitivity: 'internal'
        }, { client, access });

        expect(infoSSOTService.assertDecisionAuthority).not.toHaveBeenCalled();
        expect(infoSSOTService.commitOntologyGraph).toHaveBeenCalledWith(
            access,
            expect.objectContaining({
                edges: [expect.objectContaining({ relation: 'owned_by' })],
                contextEntities: [{ id: 'org_unson', type: 'org' }]
            }),
            { client, access_context_applied: true }
        );
        expect(result).toMatchObject({ id: 'project_brainbase', edge_count: 1 });
    });

    const expectDirectDecisionUpdateToUseGuard = async (method) => {
        const client = {
            query: vi.fn(async (sql) => {
                if (String(sql).includes("payload->'decision_authority'")) {
                    return { rows: [{ project_id: 'project_uuid', decision_domain: 'engineering' }] };
                }
                if (String(sql).includes("to_regclass('public.project_registry')")) {
                    return { rows: [{ project_registry: null }] };
                }
                if (String(sql).includes('UPDATE graph_entities')) {
                    return { rows: [{ id: 'decision_1', entity_type: 'decision', payload: {} }] };
                }
                return { rows: [] };
            })
        };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository[method]({
            id: 'decision_1',
            event_id: 'event_1',
            replacement_event_id: 'event_2',
            replacement_candidate_id: 'candidate_2',
            source_pointer: null
        }, { client, access });

        const lockIndex = client.query.mock.calls.findIndex(([sql]) => String(sql).includes('pg_try_advisory_xact_lock'));
        const updateIndex = client.query.mock.calls.findIndex(([sql]) => String(sql).includes('UPDATE graph_entities'));
        expect(lockIndex).toBeGreaterThanOrEqual(0);
        expect(updateIndex).toBeGreaterThan(lockIndex);
    };

    it('supersedeDecisionは直接UPDATE前に共通Graph ID guardを通る', async () => {
        await expectDirectDecisionUpdateToUseGuard('supersedeDecision');
    });

    it('retractDecisionは直接UPDATE前に共通Graph ID guardを通る', async () => {
        await expectDirectDecisionUpdateToUseGuard('retractDecision');
    });

    it('lifecycle変更は認証personのdecision authority不足時にGraph更新しない', async () => {
        const client = { query: vi.fn(async (sql) => {
            if (String(sql).includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', decision_domain: 'engineering' }] };
            }
            return { rows: [] };
        }) };
        const denied = Object.assign(new Error('Decision authority missing'), { code: 'decision_authority_missing' });
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => { throw denied; })
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await expect(repository.changeLifecycle({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            state: 'retired', reason: 'obsolete', actor_person_id: access.personId
        }, { access })).rejects.toBe(denied);
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO knowledge_lifecycle_history'))).toBe(false);
    });

    it('lifecycle変更はpayloadとGraph正規列のversion/statusを同時に進める', async () => {
        const client = { query: vi.fn(async (sql) => {
            if (String(sql).includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', decision_domain: 'engineering' }] };
            }
            if (String(sql).includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (String(sql).includes('UPDATE graph_entities')) {
                return { rows: [{ id: 'decision_1', entity_type: 'decision', payload: { version: 'lc_next' } }] };
            }
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository.changeLifecycle({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            state: 'retired', reason: 'obsolete', actor_person_id: access.personId
        }, { access });

        const update = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE graph_entities'));
        expect(update[0]).toContain('lifecycle_status=$8::text');
        expect(update[0]).toContain('version=entity.version+1');
        expect(update[1].at(-1)).toBe('inactive');
    });

    it('本文改訂はauthority確認後にCAS更新し、前後snapshotを履歴へ保存する', async () => {
        const oldPayload = {
            statement: 'old', version: 'v1', decision_authority: { domain: 'engineering' }
        };
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('SELECT from_version, to_snapshot')) return { rows: [] };
            if (text.includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', payload: oldPayload, decision_domain: 'engineering' }] };
            }
            if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
            if (text.includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (text.includes('UPDATE graph_entities')) {
                return { rows: [{ id: 'decision_1', entity_type: 'decision', payload: { ...oldPayload, statement: 'new', version: 'rev_next' } }] };
            }
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository.reviseDecision({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            idempotency_key: 'rev-1', reason: 'clarify', content: 'new',
            content_hash: 'sha256:new', actor_person_id: access.personId
        }, { access });

        const update = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE graph_entities'));
        expect(update[0]).toContain("entity.payload->>'version'=$3");
        expect(update[0]).toContain('version=entity.version+1');
        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledWith(client, {
            projectId: 'project_uuid', projectCode: 'brainbase', personId: access.personId,
            decisionDomain: 'engineering'
        });
        const history = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO knowledge_revision_history'));
        expect(JSON.parse(history[1][8])).toEqual(oldPayload);
        expect(JSON.parse(history[1][9])).toMatchObject({ statement: 'new', content_hash: 'sha256:new' });
    });

    it('同じ改訂keyは同一入力だけ再利用し、内容変更は409にする', async () => {
        const prior = { statement: 'new', title: 'Decision', version: 'rev_2' };
        const client = { query: vi.fn(async (sql) => String(sql).includes('SELECT from_version, to_snapshot')
            ? { rows: [{ from_version: 'v1', to_snapshot: prior }] }
            : { rows: [] }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const base = {
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            idempotency_key: 'rev-1', reason: 'clarify', content: 'new', title: 'Decision',
            content_hash: 'sha256:new', actor_person_id: access.personId
        };

        await expect(repository.reviseDecision(base, { access })).resolves.toMatchObject({
            idempotent: true, payload: prior
        });
        await expect(repository.reviseDecision({ ...base, content: 'changed' }, { access }))
            .rejects.toMatchObject({ code: 'knowledge_revision_idempotency_conflict', status: 409 });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
    });

    it('判断domainは認証personのGraph RACIだけから列挙する', async () => {
        const client = { query: vi.fn(async () => ({ rows: [{ domain: 'engineering' }, { domain: 'finance' }] })) };
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, work) => work(client)) };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await expect(repository.listDecisionAuthorityDomains({ project_code: 'brainbase' }, { access }))
            .resolves.toEqual(['engineering', 'finance']);
        expect(client.query).toHaveBeenCalledWith(expect.stringContaining("raci.role_code LIKE 'decision:%'"), [
            'brainbase', access.personId
        ]);
    });
});
