// @ts-check
import { describe, expect, it } from 'vitest';

import {
    buildDecisionPlan,
    buildReviewQueue,
    buildSnsProjectionPlan,
    candidateSourceRef,
    safeCandidateSummary
} from '../../../scripts/personal-kg-review-projection.js';

const ACCESS = {
    ownerPersonId: 'sato_keigo',
    actorPersonId: 'sato_keigo',
    organizationId: 'unson'
};

function candidate(overrides = {}) {
    return {
        id: overrides.id || 'cand_default',
        cognitive_type: 'insight',
        owner_person_id: overrides.owner_person_id || 'sato_keigo',
        actor_person_id: 'sato_keigo',
        organization_id: overrides.organization_id || 'unson',
        source_system: overrides.source_system || 'oyasumi-meeting-personal-kg',
        source_event_ids: overrides.source_event_ids || ['github:minutes#personal_kg_core:default'],
        workspace: 'github',
        project_code: 'brainbase',
        project_ids: ['brainbase'],
        visibility: overrides.visibility || 'owner',
        sensitivity: overrides.sensitivity || 'internal',
        role_min: 'member',
        agency_level: overrides.agency_level || 'synthesize',
        promotion_status: overrides.promotion_status || 'candidate',
        requires_approval: overrides.requires_approval ?? true,
        redaction_status: overrides.redaction_status || 'none',
        body: overrides.body || 'Context: raw private candidate text must not be printed',
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category: overrides.category || 'operating_principle',
                memory_layer: overrides.memory_layer || 'personal_kg_core',
                source_kind: 'daily_interaction',
                source_ref: overrides.source_ref || 'codex-claude-conversation:2026-05-23#personal_kg_core:default',
                extraction_decision: overrides.extraction_decision || 'adopted',
                projection_allowed: overrides.projection_allowed ?? true,
                projection_gate: overrides.projection_gate || 'sns_projection_can_use_after_context_review'
            }
        },
        evidence_ids: [{ uri: 'fixture' }],
        created_at: '2026-05-23T00:00:00.000Z',
        updated_at: '2026-05-23T00:00:00.000Z',
        ...overrides
    };
}

describe('personal KG review projection CLI helpers', () => {
    it('builds safe summaries without exposing raw candidate body text', () => {
        const item = candidate({
            id: 'cand_needs_review',
            memory_layer: 'needs_review',
            body: '娘の手術と顧問先の月額予算15万円は出してはいけない'
        });

        const summary = safeCandidateSummary(item);
        const serialized = JSON.stringify(summary);

        expect(candidateSourceRef(item)).toBe('codex-claude-conversation:2026-05-23#personal_kg_core:default');
        expect(summary.body_length).toBe(26);
        expect(serialized).not.toContain('娘の手術');
        expect(serialized).not.toContain('月額予算15万円');
        expect(summary).not.toHaveProperty('body');
    });

    it('selects scoped needs_review and redaction candidates for review queue', () => {
        const queue = buildReviewQueue([
            candidate({ id: 'review_layer', memory_layer: 'needs_review' }),
            candidate({ id: 'review_redaction', redaction_status: 'needs_redaction' }),
            candidate({ id: 'other_owner', owner_person_id: 'other', memory_layer: 'needs_review' }),
            candidate({ id: 'other_source', source_system: 'other-source', memory_layer: 'needs_review' })
        ], { ...ACCESS, reviewScope: 'all' });

        expect(queue.map((item) => item.id)).toEqual(['review_layer', 'review_redaction']);
        expect(queue[0].review_reasons).toEqual(expect.arrayContaining(['memory_layer:needs_review']));
        expect(queue[1].review_reasons).toEqual(expect.arrayContaining(['redaction_status:needs_redaction']));
    });

    it('separates SNS projection eligibility, already_sns_ready records, and explicit blockers', () => {
        const plan = buildSnsProjectionPlan([
            candidate({ id: 'eligible_core' }),
            candidate({ id: 'ready', memory_layer: 'sns_ready' }),
            candidate({ id: 'blocked_redaction', redaction_status: 'needs_redaction' }),
            candidate({ id: 'blocked_redacted', redaction_status: 'redacted' }),
            candidate({ id: 'blocked_agency', agency_level: 'none' }),
            candidate({ id: 'blocked_other_owner', owner_person_id: 'other_owner' }),
            candidate({ id: 'blocked_visibility', visibility: 'org' }),
            candidate({ id: 'blocked_projection_false', projection_allowed: false }),
            candidate({ id: 'blocked_rejected', promotion_status: 'rejected' }),
            candidate({ id: 'blocked_expired', promotion_status: 'expired' }),
            candidate({ id: 'blocked_non_internal', sensitivity: 'confidential' })
        ], ACCESS);

        expect(plan.summary).toEqual({
            input_candidates: 11,
            eligible: 1,
            already_sns_ready: 1,
            blocked: 9
        });
        expect(plan.eligible.map((item) => item.id)).toEqual(['eligible_core']);
        expect(plan.already_sns_ready.map((item) => item.id)).toEqual(['ready']);
        expect(plan.blocked.find((item) => item.id === 'blocked_redaction').projection_blockers)
            .toEqual(expect.arrayContaining(['redaction_status:needs_redaction']));
        expect(plan.blocked.find((item) => item.id === 'blocked_redacted').projection_blockers)
            .toEqual(expect.arrayContaining(['redaction_status:redacted']));
        expect(plan.blocked.find((item) => item.id === 'blocked_agency').projection_blockers)
            .toEqual(expect.arrayContaining(['agency_level:none']));
        expect(plan.blocked.find((item) => item.id === 'blocked_other_owner').projection_blockers)
            .toEqual(expect.arrayContaining(['owner_person_id:not_requested_owner']));
        expect(plan.blocked.find((item) => item.id === 'blocked_visibility').projection_blockers)
            .toEqual(expect.arrayContaining(['visibility:not_owner']));
        expect(plan.blocked.find((item) => item.id === 'blocked_projection_false').projection_blockers)
            .toEqual(expect.arrayContaining(['projection_allowed:false']));
        expect(plan.blocked.find((item) => item.id === 'blocked_rejected').projection_blockers)
            .toEqual(expect.arrayContaining(['promotion_status:rejected']));
        expect(plan.blocked.find((item) => item.id === 'blocked_expired').projection_blockers)
            .toEqual(expect.arrayContaining(['promotion_status:expired']));
    });

    it('validates owner decisions as a dry-run before writes', () => {
        const plan = buildDecisionPlan([
            candidate({ id: 'approve_me', promotion_status: 'candidate', requires_approval: true }),
            candidate({ id: 'reject_me', promotion_status: 'pending_approval' }),
            candidate({ id: 'expire_me', promotion_status: 'pending_approval' }),
            candidate({ id: 'blocked_sensitive', redaction_status: 'needs_redaction' })
        ], [
            { id: 'approve_me', decision: 'approved', redaction_status: 'none', note: 'owner approved' },
            { id: 'reject_me', decision: 'rejected' },
            { id: 'expire_me', decision: 'expired' },
            { id: 'blocked_sensitive', decision: 'approved' },
            { id: 'missing', decision: 'expired' }
        ], ACCESS);

        expect(plan.summary).toEqual({ decisions: 5, ready: 3, blocked: 2 });
        expect(plan.items.find((item) => item.id === 'approve_me').status_transitions)
            .toEqual(['pending_approval', 'approved']);
        expect(plan.items.find((item) => item.id === 'reject_me').status_transitions)
            .toEqual(['rejected']);
        expect(plan.items.find((item) => item.id === 'expire_me').status_transitions)
            .toEqual(['expired']);
        expect(plan.items.find((item) => item.id === 'blocked_sensitive').errors)
            .toEqual(expect.arrayContaining(['approved:redaction_still_needs_review']));
        expect(plan.items.find((item) => item.id === 'missing').errors)
            .toEqual(expect.arrayContaining(['candidate:not_found']));
    });

    it('fails closed when identity is missing or tenant does not match', () => {
        expect(buildReviewQueue([candidate({ id: 'missing_identity' })], { reviewScope: 'all' })).toEqual([]);

        const queue = buildReviewQueue([
            candidate({ id: 'other_person', owner_person_id: 'other_person', actor_person_id: 'other_person' }),
            candidate({ id: 'other_tenant', organization_id: 'other_org' })
        ], { ...ACCESS, reviewScope: 'all' });
        expect(queue).toEqual([]);

        const plan = buildSnsProjectionPlan([
            candidate({ id: 'other_tenant', organization_id: 'other_org' })
        ], ACCESS);
        expect(plan.summary).toMatchObject({ input_candidates: 1, eligible: 0, blocked: 1 });
        expect(plan.blocked[0].projection_blockers)
            .toContain('organization_id:not_requested_organization');
    });
});
