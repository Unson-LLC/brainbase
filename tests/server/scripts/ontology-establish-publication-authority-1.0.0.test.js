import { describe, expect, it } from 'vitest';
import { AUTHORITY, buildAuthorityPlan } from '../../../scripts/ontology-establish-publication-authority-1.0.0.js';

describe('Ontology 1.0.0 publication authority plan', () => {
    it('binds one Decision and three independent RACI lanes to the approved person and scope', () => {
        const plan = buildAuthorityPlan({
            sourceCommit: 'a'.repeat(40),
            releaseDigest: 'b'.repeat(64),
            impactScope: { graph_scope: 'project:brainbase' },
            projectId: 'brainbase'
        });
        expect(plan.entities).toHaveLength(4);
        expect(plan.edges).toHaveLength(8);
        expect(plan.entities[0].payload).toMatchObject({
            status: 'decided', ontology_source_commit_sha: 'a'.repeat(40), ontology_release_digest: 'b'.repeat(64),
            ontology_scope_entity_id: AUTHORITY.scopeId, ontology_proposer_entity_id: AUTHORITY.personId,
            ontology_decider_entity_id: AUTHORITY.personId
        });
        expect(plan.entities.slice(1).map((item) => item.payload.role_code)).toEqual(['R', 'A', 'A']);
        expect(plan.edges.filter((edge) => edge.relation === 'assigned_to').map((edge) => edge.to_id)).toEqual([
            AUTHORITY.personId, AUTHORITY.personId, AUTHORITY.personId
        ]);
    });

    it('rejects unbound commit and digest inputs', () => {
        expect(() => buildAuthorityPlan({ sourceCommit: 'HEAD', releaseDigest: 'b'.repeat(64), impactScope: {}, projectId: 'brainbase' })).toThrow(/SHA-1/);
        expect(() => buildAuthorityPlan({ sourceCommit: 'a'.repeat(40), releaseDigest: 'bad', impactScope: {}, projectId: 'brainbase' })).toThrow(/SHA-256/);
    });
});
