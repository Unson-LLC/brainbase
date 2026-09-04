// @ts-check
import { describe, it, expect } from 'vitest';
import { PersonalKnowledgeGraphReader } from '../../../server/services/sns/personal-knowledge-graph-reader.js';
import { SnsReadonlyCurator } from '../../../server/services/sns/sns-readonly-curator.js';
import { makeService, baseDraft, approver } from '../../candidate-store/_helpers.js';
import { viewer } from '../curator/_helpers.js';

function makeReader(deps = {}) {
    const { service } = makeService();
    return {
        service,
        reader: new PersonalKnowledgeGraphReader({ candidateService: service, ...deps })
    };
}

describe('personal KG SNS seed reader', () => {
    it('S-1: owner-visible insight candidate becomes a personal KG source entity with provenance', async () => {
        const { service, reader } = makeReader();
        const { candidate } = await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            body: '気づいた: Claude Code法人導入はツール導入ではなく業務フロー設計の問題',
            source_event_ids: ['session:kg:insight'],
            evidence_ids: [{ raw_event_id: 'raw_1', uri: 'brainbase:session:kg#highlight-0', hash: 'sha256:kg' }]
        }));

        const sources = await reader.listRecentEntities({
            since: '2026-05-01T00:00:00.000Z',
            viewer: viewer('sato_keigo', { interests: ['Claude Code', '業務フロー'] })
        });

        expect(sources).toHaveLength(1);
        expect(sources[0]).toEqual(expect.objectContaining({
            id: `candidate:${candidate.id}`,
            source_candidate_id: candidate.id,
            cognitive_type: 'insight',
            body: '気づいた: Claude Code法人導入はツール導入ではなく業務フロー設計の問題',
            agency_level: 'synthesize',
            sensitivity: 'internal',
            owner_person_id: 'sato_keigo',
            visibility: 'owner'
        }));
        expect(sources[0].derived_from).toEqual(['session:kg:insight']);
        expect(sources[0].evidence_ids[0].uri).toBe('brainbase:session:kg#highlight-0');
    });

    it('S-2: excludes non-personal, unsafe, rejected, expired, and sns-curator candidates', async () => {
        const { service, reader } = makeReader();
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            source_event_ids: ['session:kg:ok'],
            body: '気づいた: AI PMは意思決定の証跡があると進む'
        }));
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            source_event_ids: ['session:kg:other-owner'],
            owner_person_id: 'umeda',
            actor_person_id: 'umeda',
            body: '気づいた: other owner'
        }));
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            source_event_ids: ['session:kg:agency-none'],
            agency_level: 'none',
            body: '気づいた: agency none'
        }));
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            source_event_ids: ['session:kg:redacted'],
            redaction_status: 'redacted',
            body: '[redacted]'
        }));
        await service.createCandidate(baseDraft({
            cognitive_type: 'claim',
            source_system: 'sns-curator',
            source_event_ids: ['curator:already-draft'],
            body: 'already generated SNS draft'
        }));
        const rejected = await service.createCandidate(baseDraft({
            cognitive_type: 'claim',
            source_event_ids: ['session:kg:rejected'],
            body: 'reject me',
            recommended_subject_type: 'decision'
        }));
        await service.requestApproval(rejected.candidate.id, approver());
        await service.rejectCandidate(rejected.candidate.id, approver(), 'not a source');
        const expired = await service.createCandidate(baseDraft({
            cognitive_type: 'claim',
            source_event_ids: ['session:kg:expired'],
            body: 'expire me'
        }));
        service.expireCandidate(expired.candidate.id);

        const sources = await reader.listRecentEntities({
            since: '2026-05-01T00:00:00.000Z',
            viewer: viewer('sato_keigo', { interests: ['AI PM'] })
        });

        expect(sources.map((s) => s.derived_from[0])).toEqual(['session:kg:ok']);
    });

    it('S-2b: excludes a same-owner candidate from another organization', async () => {
        const { service, reader } = makeReader();
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            source_event_ids: ['session:kg:unson'],
            organization_id: 'unson',
            body: '気づいた: unson tenant'
        }));
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            source_event_ids: ['session:kg:other-org'],
            organization_id: 'other-org',
            org_ids: ['other-org'],
            body: '気づいた: other tenant'
        }));

        const sources = await reader.listRecentEntities({
            since: '2026-05-01T00:00:00.000Z',
            viewer: viewer('sato_keigo')
        });

        expect(sources.map((source) => source.derived_from[0])).toEqual(['session:kg:unson']);
        expect(sources[0].organization_id).toBe('unson');
    });

    it('S-2c: rejects a read without explicit actor and organization identity', async () => {
        const { reader } = makeReader();

        await expect(reader.listRecentEntities({
            viewer: { owner_person_id: 'sato_keigo' }
        })).rejects.toThrow('personal_kg_actor_person_id_required');
    });

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
