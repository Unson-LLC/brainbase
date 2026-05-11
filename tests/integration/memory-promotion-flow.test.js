import { readFileSync } from 'fs';

import { describe, expect, it } from 'vitest';

import { buildScopedMemoryResult } from '../../server/services/memory-scope-policy.js';

const rawLedgerFixture = JSON.parse(readFileSync('tests/fixtures/memory-promotion/raw-ledger.fixture.json', 'utf-8'));
const memoryCandidateFixture = JSON.parse(readFileSync('tests/fixtures/memory-promotion/memory-candidate.fixture.json', 'utf-8'));
const accessContextFixture = JSON.parse(readFileSync('tests/fixtures/memory-promotion/access-contexts.fixture.json', 'utf-8'));

function byId(items, idKey, id) {
    return items.find(item => item[idKey] === id);
}

function toPromotedGraphEntity(candidate, overrides = {}) {
    if (!['approved', 'auto_promoted'].includes(overrides.promotion_status || candidate.promotion_status)) {
        throw new Error(`candidate is not approved for graph promotion: ${candidate.candidate_id}`);
    }
    if ((overrides.redaction_status || candidate.redaction_status) === 'needs_redaction') {
        throw new Error(`candidate requires redaction before graph promotion: ${candidate.candidate_id}`);
    }

    return {
        id: `mem_${candidate.candidate_id}`,
        entity_type: candidate.subject_type === 'role' ? 'raci_assignment' : candidate.subject_type,
        project_code: candidate.project_code,
        role_min: candidate.role_min,
        sensitivity: candidate.sensitivity,
        payload: {
            memory_candidate_id: candidate.candidate_id,
            subject_type: candidate.subject_type,
            subject_id: candidate.subject_id,
            owner_person_id: candidate.owner_person_id,
            actor_person_id: candidate.actor_person_id,
            visibility: candidate.visibility,
            role_min: candidate.role_min,
            sensitivity: candidate.sensitivity,
            source_system: candidate.source_system,
            source_event_ids: candidate.source_event_ids,
            workspace: candidate.workspace,
            channel_id: candidate.channel_id,
            thread_ts: candidate.thread_ts,
            project_code: candidate.project_code,
            evidence_ids: candidate.evidence_ids,
            permission_snapshot: candidate.permission_snapshot,
            memory: candidate.memory,
            promoted_at: '2026-05-09T00:00:00.000Z'
        }
    };
}

describe('cross-repo memory promotion flow contract', () => {
    it('raw ledger evidence maps to candidate drafts without copying raw transcript into graph payload', () => {
        const rawById = new Map(rawLedgerFixture.records.map(record => [record.raw_event_id, record]));

        for (const candidate of memoryCandidateFixture.candidates) {
            for (const evidenceId of candidate.evidence_ids) {
                expect(rawById.has(evidenceId), candidate.candidate_id).toBe(true);
            }
            for (const sourceEventId of candidate.source_event_ids) {
                expect(rawById.has(sourceEventId), candidate.candidate_id).toBe(true);
            }
            expect(candidate.permission_snapshot).toMatchObject({
                roles: expect.any(Array),
                clearance: expect.any(Array)
            });
        }

        const manaRaw = byId(rawLedgerFixture.records, 'raw_event_id', 'raw_mana_slack_001');
        const manaCandidate = byId(memoryCandidateFixture.candidates, 'candidate_id', 'memcand_project_visible_001');
        expect(manaCandidate).toMatchObject({
            source_system: 'mana_slack',
            source_event_ids: [manaRaw.raw_event_id],
            evidence_ids: [manaRaw.raw_event_id],
            workspace: manaRaw.workspace,
            channel_id: manaRaw.channel_id,
            project_code: manaRaw.project_code
        });
    });

    it('approved candidate can be represented as Graph payload and retrieved only by allowed scoped contexts', () => {
        const candidate = byId(memoryCandidateFixture.candidates, 'candidate_id', 'memcand_project_visible_001');
        const promoted = toPromotedGraphEntity(candidate, {
            promotion_status: 'approved'
        });

        expect(promoted.payload).toMatchObject({
            memory_candidate_id: 'memcand_project_visible_001',
            source_event_ids: ['raw_mana_slack_001'],
            evidence_ids: ['raw_mana_slack_001'],
            workspace: 'unson',
            channel_id: 'C_BRAINBASE',
            project_code: 'brainbase'
        });
        expect(promoted.payload).not.toHaveProperty('raw_text');
        expect(promoted.payload).not.toHaveProperty('transcript');

        for (const context of accessContextFixture.contexts) {
            const result = buildScopedMemoryResult([promoted], context);
            const returnedIds = result.records.map(record => record.payload.memory_candidate_id);
            const shouldReturn = context.expected_memory.includes('memcand_project_visible_001');
            expect(returnedIds.includes('memcand_project_visible_001'), context.context_id).toBe(shouldReturn);
        }
    });

    it('redaction and role expiry prevent unsafe promotion or retrieval', () => {
        const policyCandidate = byId(memoryCandidateFixture.candidates, 'candidate_id', 'memcand_customer_policy_001');
        expect(() => toPromotedGraphEntity(policyCandidate, {
            promotion_status: 'approved'
        })).toThrow('requires redaction');

        const redactedPolicy = toPromotedGraphEntity({
            ...policyCandidate,
            redaction_status: 'redacted'
        }, {
            promotion_status: 'approved',
            redaction_status: 'redacted'
        });
        const expiredRoleContext = byId(accessContextFixture.contexts, 'context_id', 'expired_gm_role');
        const outsiderContext = byId(accessContextFixture.contexts, 'context_id', 'slack_channel_outsider');

        expect(buildScopedMemoryResult([redactedPolicy], expiredRoleContext).records).toHaveLength(0);
        expect(buildScopedMemoryResult([redactedPolicy], outsiderContext).records).toHaveLength(0);
    });
});
