// @ts-check
import { describe, it, expect } from 'vitest';

import { makeService } from '../../candidate-store/_helpers.js';
import { PersonalKnowledgeGraphReader } from '../../../server/services/sns/personal-knowledge-graph-reader.js';
import {
    buildSatoKeigoBaaoMinutesCandidates,
    SATO_KEIGO_BAAO_MINUTES_ITEMS,
    SATO_KEIGO_BAAO_MINUTES_SOURCE_INVENTORY,
    SATO_KEIGO_BAAO_MINUTES_SOURCE_SYSTEM
} from '../../../server/seeds/personal-kg/sato-keigo-baao-minutes-candidates.js';

const viewer = {
    sub: 'sato_keigo',
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    role: 'ceo',
    workspace: 'unson',
    org_ids: ['unson', 'baao'],
    project_ids: ['brainbase', 'baao'],
    team_ids: []
};

describe('Sato Keigo BAAO minutes personal KG seed', () => {
    it('keeps a source inventory before extracting personal KG memory', () => {
        expect(SATO_KEIGO_BAAO_MINUTES_SOURCE_INVENTORY.length).toBeGreaterThanOrEqual(5);

        for (const source of SATO_KEIGO_BAAO_MINUTES_SOURCE_INVENTORY) {
            expect(source.id).toMatch(/^baao-minutes:/);
            expect(source.project_code).toBe('baao');
            expect(source.source_path).toMatch(/^\/Users\/ksato\/workspace\/projects\/baao\/meetings\//);
            expect(source.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(source.kind).toMatch(/^(minutes|transcript)$/);
            expect(source.focus.length).toBeGreaterThan(0);
        }
    });

    it('extracts only foundation memory categories from BAAO minutes, not SNS draft ideas', () => {
        const categories = new Set(SATO_KEIGO_BAAO_MINUTES_ITEMS.map((item) => item.category));
        expect(categories).toEqual(new Set([
            'philosophy',
            'operating_principle',
            'proof',
            'relationship',
            'content_design'
        ]));

        expect(SATO_KEIGO_BAAO_MINUTES_ITEMS.length).toBeGreaterThanOrEqual(18);
        expect(SATO_KEIGO_BAAO_MINUTES_ITEMS.some((item) => item.body.includes('立ち位置'))).toBe(true);
        expect(SATO_KEIGO_BAAO_MINUTES_ITEMS.some((item) => item.body.includes('AI駆動PM'))).toBe(true);
        expect(SATO_KEIGO_BAAO_MINUTES_ITEMS.some((item) => item.body.includes('人間承認'))).toBe(true);
        expect(SATO_KEIGO_BAAO_MINUTES_ITEMS.some((item) => item.body.includes('投稿案:'))).toBe(false);
    });

    it('builds owner-visible candidates with deterministic meeting provenance', () => {
        const candidates = buildSatoKeigoBaaoMinutesCandidates();
        expect(candidates).toHaveLength(SATO_KEIGO_BAAO_MINUTES_ITEMS.length);

        const ids = new Set();
        const sourceEvents = new Set();
        for (const candidate of candidates) {
            expect(candidate.id).toMatch(/^seed_baao_minutes_/);
            expect(ids.has(candidate.id)).toBe(false);
            ids.add(candidate.id);

            expect(candidate.source_system).toBe(SATO_KEIGO_BAAO_MINUTES_SOURCE_SYSTEM);
            expect(candidate.owner_person_id).toBe('sato_keigo');
            expect(candidate.actor_person_id).toBe('sato_keigo');
            expect(candidate.organization_id).toBe('unson');
            expect(candidate.workspace).toBe('unson');
            expect(candidate.project_code).toBe('baao');
            expect(candidate.org_ids).toContain('baao');
            expect(candidate.project_ids).toContain('baao');
            expect(candidate.visibility).toBe('owner');
            expect(candidate.sensitivity).toBe('internal');
            expect(candidate.agency_level).toBe('synthesize');
            expect(candidate.requires_approval).toBe(true);
            expect(candidate.redaction_status).toBe('none');
            expect(candidate.permission_snapshot.seed.category).toBeTruthy();
            expect(candidate.permission_snapshot.seed.review_status).toBe('approved_by_owner_prompt');
            expect(candidate.evidence_ids[0].uri).toMatch(/^file:\/\/\/Users\/ksato\/workspace\/projects\/baao\/meetings\//);
            expect(candidate.evidence_ids[0].line_start).toBeGreaterThan(0);
            expect(candidate.evidence_ids[0].hash).toMatch(/^sha256:/);

            expect(sourceEvents.has(candidate.source_event_ids[0])).toBe(false);
            sourceEvents.add(candidate.source_event_ids[0]);
        }
    });

    it('can be inserted into candidate-store and read back through PersonalKnowledgeGraphReader', async () => {
        const { service } = makeService();
        const candidates = buildSatoKeigoBaaoMinutesCandidates();
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
        expect(sources.some((source) => source.body.includes('自分・仕事・関係性'))).toBe(true);
        expect(sources.some((source) => source.body.includes('MANA'))).toBe(true);
        expect(sources.some((source) => source.body.includes('人間承認'))).toBe(true);
    });
});
