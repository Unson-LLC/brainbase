import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    InMemoryCandidateRepository,
    InvalidTransitionError
} from '../../server/services/candidate-store/candidate-repository.js';
import { baseDraft } from './_helpers.js';

const PROCESSING_STAGES = ['received', 'queued', 'extracted', 'resolved', 'indexed', 'retrievable'];
const TARGET_TIERS = ['ledger', 'episode', 'personal_kg', 'graph', 'skill_candidate'];

function stripSqlComments(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--.*$/gm, '');
}

describe('Memory Promotion Kernel schema ownership', () => {
    it('candidate-store-schemaだけがmemory_candidatesを所有しlearning-schemaは変更しない', () => {
        const candidateSchema = stripSqlComments(fs.readFileSync(
            path.resolve('server/sql/candidate-store-schema.sql'),
            'utf8'
        ));
        const learningSchema = stripSqlComments(fs.readFileSync(
            path.resolve('server/sql/learning-schema.sql'),
            'utf8'
        ));

        expect(candidateSchema).toMatch(/CREATE TABLE IF NOT EXISTS\s+memory_candidates\b/i);
        expect(candidateSchema).toContain('processing_stage');
        expect(candidateSchema).toContain('semantic_state');
        expect(candidateSchema).toContain('target_tier');
        expect(candidateSchema).toContain('recommended_subject_id');
        expect(learningSchema).not.toMatch(
            /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|UPDATE|DELETE\s+FROM)\s+memory_candidates\b/i
        );
    });

    it('互換移行は既存memory_candidatesを削除・truncate・dropしない', () => {
        const schema = stripSqlComments(fs.readFileSync(
            path.resolve('server/sql/candidate-store-schema.sql'),
            'utf8'
        ));

        expect(schema).not.toMatch(/\bDELETE\s+FROM\s+memory_candidates\b/i);
        expect(schema).not.toMatch(/\bTRUNCATE(?:\s+TABLE)?\s+memory_candidates\b/i);
        expect(schema).not.toMatch(/\bDROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+memory_candidates\b/i);
        for (const column of ['processing_stage', 'semantic_state', 'target_tier', 'recommended_subject_id']) {
            expect(schema).toMatch(new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${column}\\b`, 'i'));
        }
    });
});

describe('InMemoryCandidateRepository memory state axes', () => {
    it('候補をreceived / active / ledgerで初期化する', () => {
        const repository = new InMemoryCandidateRepository();
        const candidate = repository.create(baseDraft());

        expect(candidate).toMatchObject({
            processing_stage: 'received',
            semantic_state: 'active',
            target_tier: 'ledger'
        });
    });

    it('processingは単調に進み、semantic更新はprocessingを変えない', () => {
        const repository = new InMemoryCandidateRepository();
        const candidate = repository.create(baseDraft());

        expect(repository.transitionProcessingStage(candidate.id, 'received').processing_stage).toBe('received');
        expect(repository.transitionProcessingStage(candidate.id, 'queued').processing_stage).toBe('queued');
        const quarantined = repository.updateSemanticState(candidate.id, 'quarantined');
        expect(quarantined).toMatchObject({
            processing_stage: 'queued',
            semantic_state: 'quarantined'
        });
        expect(repository.transitionProcessingStage(candidate.id, 'extracted')).toMatchObject({
            processing_stage: 'extracted',
            semantic_state: 'quarantined'
        });
        expect(() => repository.transitionProcessingStage(candidate.id, 'queued'))
            .toThrow(InvalidTransitionError);
        expect(PROCESSING_STAGES).toContain(repository.findById(candidate.id).processing_stage);
    });

    it.each(TARGET_TIERS)('target_tier=%sを受け付ける', (targetTier) => {
        const repository = new InMemoryCandidateRepository();
        const candidate = repository.create(baseDraft({
            source_event_ids: [`session:target:${targetTier}`],
            target_tier: targetTier,
            ...(targetTier === 'graph' ? { recommended_subject_id: 'decision_stable_1' } : {})
        }));

        expect(candidate.target_tier).toBe(targetTier);
    });

    it('未知のtarget_tierとstable IDのないgraphを拒否し候補IDで補完しない', () => {
        const repository = new InMemoryCandidateRepository();

        expect(() => repository.create(baseDraft({ target_tier: 'wiki' }))).toThrow('target_tier');
        expect(() => repository.create(baseDraft({
            source_event_ids: ['session:graph:no-stable-id'],
            target_tier: 'graph',
            recommended_subject_type: 'decision'
        }))).toThrow('recommended_subject_id');
    });
});
