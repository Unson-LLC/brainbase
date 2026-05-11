// @ts-check
import { describe, it, expect } from 'vitest';

import { makeService } from '../../candidate-store/_helpers.js';
import { PersonalKnowledgeGraphReader } from '../../../server/services/sns/personal-knowledge-graph-reader.js';
import {
    buildSatoKeigoSnsFoundationCandidates,
    SATO_KEIGO_SNS_FOUNDATION_ITEMS,
    SATO_KEIGO_SNS_FOUNDATION_SOURCE_SYSTEM
} from '../../../server/seeds/personal-kg/sato-keigo-sns-foundation-candidates.js';

const viewer = {
    sub: 'sato_keigo',
    role: 'ceo',
    workspace: 'unson',
    org_ids: ['unson'],
    project_ids: ['brainbase'],
    team_ids: []
};

describe('Sato Keigo SNS foundation personal KG seed', () => {
    it('contains the required foundation categories before SNS draft generation', () => {
        const categories = new Set(SATO_KEIGO_SNS_FOUNDATION_ITEMS.map((item) => item.category));
        expect(categories).toEqual(new Set([
            'philosophy',
            'content_design',
            'proof',
            'peer_circle',
            'reaction_log'
        ]));
    });

    it('builds valid owner-visible candidate-store drafts with deterministic provenance', () => {
        const candidates = buildSatoKeigoSnsFoundationCandidates();
        expect(candidates.length).toBeGreaterThanOrEqual(20);

        const ids = new Set();
        const sourceEvents = new Set();
        for (const candidate of candidates) {
            expect(candidate.id).toMatch(/^seed_sns_foundation_/);
            expect(ids.has(candidate.id)).toBe(false);
            ids.add(candidate.id);

            expect(candidate.source_system).toBe(SATO_KEIGO_SNS_FOUNDATION_SOURCE_SYSTEM);
            expect(candidate.owner_person_id).toBe('sato_keigo');
            expect(candidate.actor_person_id).toBe('sato_keigo');
            expect(candidate.visibility).toBe('owner');
            expect(candidate.sensitivity).toBe('internal');
            expect(candidate.agency_level).toBe('synthesize');
            expect(candidate.requires_approval).toBe(true);
            expect(candidate.redaction_status).toBe('none');
            expect(candidate.permission_snapshot.seed.category).toBeTruthy();
            expect(candidate.evidence_ids[0].hash).toMatch(/^sha256:/);

            expect(sourceEvents.has(candidate.source_event_ids[0])).toBe(false);
            sourceEvents.add(candidate.source_event_ids[0]);
        }
    });

    it('can be inserted into candidate-store and read back through PersonalKnowledgeGraphReader', async () => {
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
        expect(sources.some((source) => source.body.includes('Persona Brain'))).toBe(true);
        expect(sources.some((source) => source.body.includes('PR #684'))).toBe(true);
        expect(sources.some((source) => source.body.includes('Peer Circle'))).toBe(true);
    });
});
