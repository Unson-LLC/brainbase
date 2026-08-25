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
});
