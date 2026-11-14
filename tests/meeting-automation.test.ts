import { describe, expect, it } from 'vitest';

import {
    MEETING_REVIEW_HUMAN_STEP_DEFINITIONS,
    MEETING_REVIEW_OUTPUT_DEFINITIONS,
    MeetingAutomationContractError,
    assertMeetingCandidatesInput,
    normalizeDecisionCandidates,
    normalizeFollowUpDraft,
    normalizeTaskCandidates,
    verifyMeetingReviewPackage
} from '../src/meeting-automation.js';

const validCandidateInput = {
    task_candidates: [{
        title: '確認事項を整理する',
        owner_hint: ' 梅田さん ',
        due_hint: '今週中',
        source_excerpt: '会議で合意した確認事項'
    }],
    decision_candidates: [{
        title: '導入時期を決める',
        decision_type: 'timing',
        source_excerpt: '次回会議で確定する'
    }],
    follow_up_draft: { body: '本日の確認事項を共有します。' }
};

function expectValidation(action: () => unknown, stateTransition: string) {
    expect(action).toThrow(MeetingAutomationContractError);
    try {
        action();
    } catch (error) {
        expect(error).toMatchObject({
            code: 'validation_error',
            statusCode: 400,
            details: { state_transition: stateTransition }
        });
    }
}

describe('meeting automation candidate contract', () => {
    it('validates bounded candidate input without external side effects', () => {
        expect(() => assertMeetingCandidatesInput(validCandidateInput)).not.toThrow();
    });

    it('rejects more than five candidates with a blocked transition', () => {
        const input = {
            ...validCandidateInput,
            task_candidates: Array.from({ length: 6 }, (_, index) => ({ title: `Task ${index}` }))
        };
        expectValidation(() => assertMeetingCandidatesInput(input), 'blocked_invalid_candidates');
    });

    it('rejects non-string optional fields and oversized follow-up bodies', () => {
        expectValidation(() => assertMeetingCandidatesInput({
            ...validCandidateInput,
            task_candidates: [{ title: 'Task', owner_hint: 42 }]
        }), 'blocked_invalid_candidates');
        expectValidation(() => assertMeetingCandidatesInput({
            ...validCandidateInput,
            follow_up_draft: { body: 'x'.repeat(10_001) }
        }), 'blocked_invalid_candidates');
    });

    it('normalizes task aliases and keeps source evidence attached', () => {
        const evidenceRefs = [{ kind: 'artifact_ref', ref: 's3:meeting/receipt.json' }];
        const normalized = normalizeTaskCandidates(validCandidateInput.task_candidates, {
            caseScope: 'case-42',
            evidenceRefs
        });

        expect(normalized).toEqual([{
            id: 'task_candidate_case_42_task',
            title: '確認事項を整理する',
            status: 'candidate',
            source: 'external_meeting_runtime',
            case_scope: 'case-42',
            owner_hint: '梅田さん',
            due_hint: '今週中',
            source_excerpt: '会議で合意した確認事項',
            evidence_refs: evidenceRefs
        }]);
    });

    it('normalizes decisions deterministically and defaults decision type', () => {
        const first = normalizeDecisionCandidates([{ title: ' 次回確認 ' }], { caseScope: 'case-42' });
        const second = normalizeDecisionCandidates([{ title: ' 次回確認 ' }], { caseScope: 'case-42' });

        expect(first).toEqual(second);
        expect(first[0]).toMatchObject({
            id: 'decision_candidate_case_42_decision',
            title: '次回確認',
            decision_type: 'meeting_decision',
            status: 'candidate',
            source: 'external_meeting_runtime'
        });
    });

    it('returns an approval-gated follow-up draft', () => {
        expect(normalizeFollowUpDraft({ body: '送信前に確認してください。' })).toEqual({
            status: 'draft_only',
            external_send_required_approval: true,
            body: '送信前に確認してください。'
        });
        expect(normalizeFollowUpDraft(undefined)).toMatchObject({
            status: 'draft_only',
            external_send_required_approval: true,
            body: ''
        });
    });
});

describe('meeting automation review contract', () => {
    const loopIntents = {
        transcript_to_meeting_note: { id: 'loop-note', org_id: 'org-1', project_id: 'project-1' },
        meeting_note_to_tasks: { id: 'loop-task', org_id: 'org-1', project_id: 'project-1' },
        meeting_note_to_decisions: { id: 'loop-decision', org_id: 'org-1', project_id: 'project-1' },
        post_meeting_follow_up_message: { id: 'loop-follow-up', org_id: 'org-1', project_id: 'project-1' }
    };

    const reviewPackage = {
        meeting_note_summary: { title: '議事録' },
        task_candidates: [],
        decision_candidates: [],
        follow_up_draft: { body: 'ドラフト' },
        promotion_candidates: [],
        loop_intent_ids: {
            transcript_to_meeting_note: 'loop-note',
            meeting_note_to_tasks: 'loop-task',
            meeting_note_to_decisions: 'loop-decision',
            post_meeting_follow_up_message: 'loop-follow-up'
        }
    };

    it('defines write-back outputs and human approval steps for every side effect', () => {
        expect(MEETING_REVIEW_OUTPUT_DEFINITIONS).toHaveLength(5);
        expect(MEETING_REVIEW_HUMAN_STEP_DEFINITIONS).toHaveLength(5);
        expect(MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.every((step) => step.step_type === 'approval')).toBe(true);
        expect(MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((step) => step.reason)).toContain('required_before_external_send');
    });

    it('resolves all scoped loop intents before consumers write back', () => {
        const repository = {
            getLoopIntent(id: string) {
                return Object.values(loopIntents).find((loopIntent) => loopIntent.id === id) ?? null;
            }
        };
        const result = verifyMeetingReviewPackage({
            repository,
            reviewPackage,
            orgId: 'org-1',
            projectId: 'project-1'
        });

        expect(result.loopIntents).toHaveLength(4);
        expect(result.loopIntentByKey.get('meeting_note_to_tasks')).toEqual(loopIntents.meeting_note_to_tasks);
    });

    it('rejects incomplete package output before repository lookup', () => {
        let repositoryCalls = 0;
        const repository = { getLoopIntent: () => { repositoryCalls += 1; return null; } };
        const incomplete = { ...reviewPackage, promotion_candidates: undefined };

        expectValidation(() => verifyMeetingReviewPackage({
            repository,
            reviewPackage: incomplete,
            orgId: 'org-1',
            projectId: 'project-1'
        }), 'blocked_invalid_review_package');
        expect(repositoryCalls).toBe(0);
    });

    it('rejects missing loop keys and cross-scope loop intents', () => {
        const repository = {
            getLoopIntent(id: string) {
                if (id === 'loop-task') return { id, org_id: 'org-2', project_id: 'project-1' };
                return Object.values(loopIntents).find((loopIntent) => loopIntent.id === id) ?? null;
            }
        };
        const missingKey = {
            ...reviewPackage,
            loop_intent_ids: { ...reviewPackage.loop_intent_ids, meeting_note_to_tasks: undefined }
        };
        expectValidation(() => verifyMeetingReviewPackage({
            repository,
            reviewPackage: missingKey,
            orgId: 'org-1',
            projectId: 'project-1'
        }), 'blocked_loop_intent_mismatch');

        expectValidation(() => verifyMeetingReviewPackage({
            repository,
            reviewPackage,
            orgId: 'org-1',
            projectId: 'project-1'
        }), 'blocked_loop_intent_mismatch');
    });
});
