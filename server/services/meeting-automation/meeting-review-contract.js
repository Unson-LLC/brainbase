// @ts-check

import { AppError } from '../../lib/errors.js';

export const MEETING_REVIEW_OUTPUT_DEFINITIONS = [
    {
        id: 'meeting_note_draft',
        title: '議事録ドラフト',
        type: 'meeting_note_draft',
        package_key: 'meeting_note_summary',
        loop_intent_key: 'transcript_to_meeting_note',
        write_back_target: 'meeting_note_draft'
    },
    {
        id: 'task_candidates',
        title: 'Task候補',
        type: 'task_candidates',
        package_key: 'task_candidates',
        loop_intent_key: 'meeting_note_to_tasks',
        write_back_target: 'task_store'
    },
    {
        id: 'decision_candidates',
        title: 'Decision候補',
        type: 'decision_candidates',
        package_key: 'decision_candidates',
        loop_intent_key: 'meeting_note_to_decisions',
        write_back_target: 'graph_ssot_decision'
    },
    {
        id: 'follow_up_draft',
        title: 'フォローアップ文面ドラフト',
        type: 'message_draft',
        package_key: 'follow_up_draft',
        loop_intent_key: 'post_meeting_follow_up_message',
        write_back_target: 'external_message_draft'
    },
    {
        id: 'promotion_candidates',
        title: 'Graph / Learning昇格候補',
        type: 'promotion_candidates',
        package_key: 'promotion_candidates',
        loop_intent_key: 'meeting_note_to_decisions',
        write_back_target: 'candidate_store'
    }
];

export const MEETING_REVIEW_HUMAN_STEP_DEFINITIONS = [
    {
        id: 'approve_meeting_note_publish',
        step_type: 'approval',
        prompt: '議事録ドラフトの公開可否を確認してください',
        reason: 'required_before_publish',
        protects: ['meeting_note_publish'],
        write_back_target: 'meeting_note_draft',
        loop_intent_key: 'transcript_to_meeting_note'
    },
    {
        id: 'approve_task_candidates',
        step_type: 'approval',
        prompt: 'Task候補を作成してよいか確認してください',
        reason: 'required_before_task_create',
        protects: ['task_create'],
        write_back_target: 'task_store',
        loop_intent_key: 'meeting_note_to_tasks'
    },
    {
        id: 'approve_decision_candidates',
        step_type: 'approval',
        prompt: 'Decision候補をGraph SSOTへ昇格してよいか確認してください',
        reason: 'required_before_graph_promotion',
        protects: ['decision_promotion', 'graph_promotion'],
        write_back_target: 'graph_ssot_decision',
        loop_intent_key: 'meeting_note_to_decisions'
    },
    {
        id: 'approve_follow_up_draft',
        step_type: 'approval',
        prompt: 'フォローアップ文面を外部送信してよいか確認してください',
        reason: 'required_before_external_send',
        protects: ['external_send'],
        write_back_target: 'external_message_draft',
        loop_intent_key: 'post_meeting_follow_up_message'
    },
    {
        id: 'approve_promotion_candidates',
        step_type: 'approval',
        prompt: 'Graph / Learning昇格候補を次の審査へ回してよいか確認してください',
        reason: 'required_before_candidate_promotion',
        protects: ['graph_candidate_promotion', 'learning_candidate_promotion'],
        write_back_target: 'candidate_store',
        loop_intent_key: 'meeting_note_to_decisions'
    }
];

const REQUIRED_LOOP_INTENT_KEYS = Array.from(new Set([
    ...MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.loop_intent_key),
    ...MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((definition) => definition.loop_intent_key)
]));
const REQUIRED_PACKAGE_KEYS = MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.package_key);

function validationError(message, stateTransition, details = {}) {
    return AppError.validation(message, {
        state_transition: stateTransition,
        ...details
    });
}

export function verifyMeetingReviewPackage({ repository, reviewPackage, orgId, projectId }) {
    const missingPackageKeys = REQUIRED_PACKAGE_KEYS
        .filter((key) => !Object.hasOwn(reviewPackage, key) || reviewPackage[key] == null);
    if (missingPackageKeys.length > 0) {
        throw validationError('review_package is missing required output payload key(s)', 'blocked_invalid_review_package', {
            missing_package_keys: missingPackageKeys,
            required_package_keys: REQUIRED_PACKAGE_KEYS
        });
    }

    const loopIntentIds = reviewPackage.loop_intent_ids;
    if (!loopIntentIds || typeof loopIntentIds !== 'object' || Array.isArray(loopIntentIds)) {
        throw validationError('review_package.loop_intent_ids must be a JSON object', 'blocked_loop_intent_mismatch', {
            required_loop_intent_keys: REQUIRED_LOOP_INTENT_KEYS
        });
    }
    const loopEntries = Object.entries(loopIntentIds)
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
        .filter(([, value]) => value);
    if (loopEntries.length === 0) {
        throw validationError('review_package.loop_intent_ids must include at least one id', 'blocked_loop_intent_mismatch', {
            required_loop_intent_keys: REQUIRED_LOOP_INTENT_KEYS
        });
    }
    const presentKeys = new Set(loopEntries.map(([key]) => key));
    const missingKeys = REQUIRED_LOOP_INTENT_KEYS.filter((key) => !presentKeys.has(key));
    if (missingKeys.length > 0) {
        throw validationError('review_package.loop_intent_ids is missing required meeting review key(s)', 'blocked_loop_intent_mismatch', {
            missing_loop_intent_keys: missingKeys,
            required_loop_intent_keys: REQUIRED_LOOP_INTENT_KEYS
        });
    }

    const loopIntents = loopEntries.map(([key, loopIntentId]) => {
        const loopIntent = repository.getLoopIntent(loopIntentId);
        if (!loopIntent) {
            throw AppError.validation(`loop_intent '${loopIntentId}' not found`, {
                state_transition: 'blocked_loop_intent_mismatch',
                loop_intent_key: key,
                loop_intent_id: loopIntentId
            });
        }
        if (loopIntent.org_id !== orgId || loopIntent.project_id !== projectId) {
            throw AppError.validation(`loop_intent '${loopIntentId}' belongs to '${loopIntent.org_id}/${loopIntent.project_id}'`, {
                state_transition: 'blocked_loop_intent_mismatch',
                loop_intent_key: key,
                loop_intent_id: loopIntentId,
                expected: { org_id: orgId, project_id: projectId },
                actual: { org_id: loopIntent.org_id, project_id: loopIntent.project_id }
            });
        }
        return { key, loop_intent: loopIntent };
    });

    return {
        loopIntents,
        loopIntentByKey: new Map(loopIntents.map((entry) => [entry.key, entry.loop_intent]))
    };
}
