// @ts-check
import { describe, it, expect } from 'vitest';
import { PersonalKnowledgeGraphReader } from '../../../../server/services/sns/personal-knowledge-graph-reader.js';
import { SnsReadonlyCurator } from '../../../../server/services/sns/sns-readonly-curator.js';
import { makeService, baseDraft } from '../../../candidate-store/_helpers.js';
import { viewer } from '../_helpers.js';

function makeReader(deps = {}) {
    const { service } = makeService();
    return {
        service,
        reader: new PersonalKnowledgeGraphReader({ candidateService: service, ...deps })
    };
}

describe('personal KG SNS lifelog seed', () => {
    it('S-3: owner-visible first-person memory can seed a public lifelog candidate', async () => {
        const { service, reader } = makeReader();
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            body: '今日はAI PMの責任分界を見直した。自分の判断ログを残すことにした。',
            source_event_ids: ['session:kg:lifelog'],
            permission_snapshot: {
                seed: { category: 'work_log' }
            }
        }));

        const curator = new SnsReadonlyCurator({
            graphReader: reader,
            candidateService: service
        });

        const snsDrafts = await curator.generateDrafts(
            viewer('sato_keigo'),
            { limit: 3 }
        );
        const saved = await curator.saveDraftsToCandidateStore(
            snsDrafts,
            viewer('sato_keigo')
        );

        expect(saved).toHaveLength(1);
        expect(saved[0].candidate.cognitive_type).toBe('observation');
        expect(saved[0].candidate.source_system).toBe('sns-lifelog-curator');
        expect(saved[0].candidate.visibility).toBe('owner');
        expect(saved[0].candidate.permission_snapshot.sns).toMatchObject({
            mode: 'public_lifelog',
            lifelog_check: {
                decision: 'pass',
                first_person_evidence: true
            }
        });
    });
});
