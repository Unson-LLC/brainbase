// @ts-check
import { describe, it, expect } from 'vitest';

import { makeService } from '../../candidate-store/_helpers.js';
import { PersonalKnowledgeGraphReader } from '../../../server/services/sns/personal-knowledge-graph-reader.js';
import {
    buildSatoKeigoSnsFoundationCandidates,
    SATO_KEIGO_SNS_FOUNDATION_ITEMS,
    SATO_KEIGO_SNS_FOUNDATION_SEED_VERSION,
    SATO_KEIGO_SNS_FOUNDATION_SOURCE_SYSTEM
} from '../../../server/seeds/personal-kg/sato-keigo-sns-foundation-candidates.js';

const viewer = {
    sub: 'sato_keigo',
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    role: 'ceo',
    workspace: 'unson',
    org_ids: ['unson'],
    project_ids: ['brainbase'],
    team_ids: []
};

describe('Sato Keigo public lifelog policy seed', () => {
    it('contains policy only, without old growth or Persona mechanisms', () => {
        const categories = new Set(SATO_KEIGO_SNS_FOUNDATION_ITEMS.map((item) => item.category));
        const body = SATO_KEIGO_SNS_FOUNDATION_ITEMS.map((item) => item.body).join('\n');

        expect(categories).toEqual(new Set(['content_design', 'operating_principle']));
        expect(SATO_KEIGO_SNS_FOUNDATION_SEED_VERSION).toBe('2026-07-28-sns-public-lifelog-v2');
        expect(body).toContain('公開ライフログ');
        expect(body).toContain('一次体験がなければ候補は0件');
        expect(body).not.toMatch(/Persona Brain|Peer Circle|Own Proof|週21|フォロワー2,000/);
    });

    it('builds deterministic owner-visible policy candidates', () => {
        const candidates = buildSatoKeigoSnsFoundationCandidates();
        expect(candidates).toHaveLength(8);

        const ids = new Set();
        for (const candidate of candidates) {
            expect(candidate.id).toMatch(/^seed_sns_lifelog_/);
            expect(ids.has(candidate.id)).toBe(false);
            ids.add(candidate.id);
            expect(candidate.source_system).toBe(SATO_KEIGO_SNS_FOUNDATION_SOURCE_SYSTEM);
            expect(candidate.owner_person_id).toBe('sato_keigo');
            expect(candidate.organization_id).toBe('unson');
            expect(candidate.visibility).toBe('owner');
            expect(candidate.requires_approval).toBe(true);
            expect(candidate.permission_snapshot.seed.supersedes_seed_version).toBe('2026-05-12-sns-foundation-v1');
            expect(candidate.evidence_ids[0].hash).toMatch(/^sha256:/);
        }
    });

    it('can be stored and read with the policy category intact', async () => {
        const { service } = makeService();
        const candidates = buildSatoKeigoSnsFoundationCandidates();
        for (const candidate of candidates) {
            const result = await service.createCandidate(candidate);
            expect(result.blocked).toBeFalsy();
        }

        const reader = new PersonalKnowledgeGraphReader({ candidateService: service });
        const sources = await reader.listRecentEntities({
            since: '2026-01-01T00:00:00.000Z',
            viewer
        });

        expect(sources).toHaveLength(candidates.length);
        expect(sources.every((source) => ['content_design', 'operating_principle'].includes(source.category))).toBe(true);
        expect(sources.some((source) => source.body.includes('おばあちゃんの知恵袋'))).toBe(true);
    });
});
