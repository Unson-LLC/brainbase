import { createHash, randomUUID } from 'node:crypto';

const EXTERNAL_RUNTIME_CANDIDATE_SOURCE = 'external_meeting_runtime';
const EXTERNAL_RUNTIME_CANDIDATE_MAX_COUNT = 5;
const EXTERNAL_RUNTIME_CANDIDATE_FIELD_MAX_LENGTHS: Readonly<Record<string, number>> = Object.freeze({
    title: 500,
    owner_hint: 200,
    ownerHint: 200,
    due_hint: 200,
    dueHint: 200,
    source_excerpt: 2_000,
    sourceExcerpt: 2_000,
    decision_type: 100,
    decisionType: 100
});
const EXTERNAL_RUNTIME_FOLLOW_UP_BODY_MAX_LENGTH = 10_000;

type RecordValue = Record<string, unknown>;

export interface MeetingCandidate {
    id: string;
    title: string;
    status: 'candidate';
    source: typeof EXTERNAL_RUNTIME_CANDIDATE_SOURCE;
    case_scope: string | null;
    owner_hint?: string | null;
    due_hint?: string | null;
    decision_type?: string;
    source_excerpt?: string | null;
    evidence_refs: unknown[];
}

export interface FollowUpDraft {
    status: 'draft_only';
    external_send_required_approval: true;
    body: string;
}

export interface MeetingLoopIntent {
    id?: string;
    org_id: string;
    project_id: string;
    [key: string]: unknown;
}

export interface MeetingLoopIntentRepository {
    getLoopIntent(loopIntentId: string): MeetingLoopIntent | null | undefined;
}

export interface MeetingReviewPackage {
    meeting_note_summary: unknown;
    task_candidates: unknown;
    decision_candidates: unknown;
    follow_up_draft: unknown;
    promotion_candidates: unknown;
    loop_intent_ids: Record<string, unknown>;
    [key: string]: unknown;
}

export interface VerifyMeetingReviewPackageInput {
    repository: MeetingLoopIntentRepository;
    reviewPackage: MeetingReviewPackage;
    orgId: string;
    projectId: string;
}

export interface MeetingReviewLoopIntentEntry {
    key: string;
    loop_intent: MeetingLoopIntent;
}

export interface VerifiedMeetingReviewPackage {
    loopIntents: MeetingReviewLoopIntentEntry[];
    loopIntentByKey: Map<string, MeetingLoopIntent>;
}

export class MeetingAutomationContractError extends Error {
    readonly code = 'validation_error';
    readonly statusCode = 400;
    readonly status = 400;
    readonly timestamp: string;
    readonly details: RecordValue;

    constructor(message: string, details: RecordValue = {}) {
        super(message);
        this.name = 'MeetingAutomationContractError';
        this.timestamp = new Date().toISOString();
        this.details = details;
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                timestamp: this.timestamp
            }
        };
    }
}

function validationError(message: string, stateTransition: string, details: RecordValue = {}) {
    return new MeetingAutomationContractError(message, {
        state_transition: stateTransition,
        ...details
    });
}

function asRecord(value: unknown): RecordValue | null {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as RecordValue
        : null;
}

function readOptionalString(input: unknown, snakeKey: string, camelKey = snakeKey): string | null {
    const record = asRecord(input);
    const value = record?.[snakeKey] ?? record?.[camelKey];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stableId(prefix: string, ...parts: unknown[]) {
    const base = parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!base) return `${prefix}_${randomUUID()}`;
    if (base.length <= 96) return `${prefix}_${base}`;
    const hash = createHash('sha256').update(base).digest('hex').slice(0, 12);
    return `${prefix}_${base.slice(0, 83).replace(/_+$/g, '')}_${hash}`;
}

function taskCandidateOwnerHint(candidate: RecordValue) {
    return readOptionalString(candidate, 'owner_hint', 'ownerHint')
        || readOptionalString(candidate, 'assignee_hint', 'assigneeHint')
        || readOptionalString(candidate, 'owner')
        || readOptionalString(candidate, 'assignee')
        || null;
}

function assertOptionalCandidateString(
    candidate: RecordValue,
    fieldName: string,
    index: number,
    collectionName: string
) {
    const value = candidate[fieldName];
    // Normalized candidates deliberately use null for absent optional values.
    // Keep that representation valid when a host owner resolver returns the
    // normalized package for post-resolution contract verification.
    if (value !== undefined && value !== null && typeof value !== 'string') {
        throw validationError(`${collectionName}[${index}].${fieldName} must be a string`, 'blocked_invalid_candidates');
    }
    const maxLength = EXTERNAL_RUNTIME_CANDIDATE_FIELD_MAX_LENGTHS[fieldName];
    if (typeof value === 'string' && maxLength && value.length > maxLength) {
        throw validationError(
            `${collectionName}[${index}].${fieldName} must be at most ${maxLength} characters`,
            'blocked_invalid_candidates'
        );
    }
}

function assertCandidateList(value: unknown, collectionName: string, optionalStringFields: string[]) {
    if (!Array.isArray(value)) {
        throw validationError(`${collectionName} must be an array`, 'blocked_invalid_candidates');
    }
    if (value.length > EXTERNAL_RUNTIME_CANDIDATE_MAX_COUNT) {
        throw validationError(
            `${collectionName} must contain at most ${EXTERNAL_RUNTIME_CANDIDATE_MAX_COUNT} candidates`,
            'blocked_invalid_candidates'
        );
    }
    value.forEach((candidateValue, index) => {
        const candidate = asRecord(candidateValue);
        if (!candidate) {
            throw validationError(`${collectionName}[${index}] must be a JSON object`, 'blocked_invalid_candidates');
        }
        if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) {
            throw validationError(`${collectionName}[${index}].title must be a non-empty string`, 'blocked_invalid_candidates');
        }
        if (candidate.title.length > EXTERNAL_RUNTIME_CANDIDATE_FIELD_MAX_LENGTHS.title) {
            throw validationError(
                `${collectionName}[${index}].title must be at most ${EXTERNAL_RUNTIME_CANDIDATE_FIELD_MAX_LENGTHS.title} characters`,
                'blocked_invalid_candidates'
            );
        }
        optionalStringFields.forEach((fieldName) => {
            assertOptionalCandidateString(candidate, fieldName, index, collectionName);
        });
    });
}

export function assertMeetingCandidatesInput(input: unknown): asserts input is RecordValue {
    const record = asRecord(input) ?? {};
    assertCandidateList(record.task_candidates, 'task_candidates', [
        'owner_hint',
        'ownerHint',
        'due_hint',
        'dueHint',
        'source_excerpt',
        'sourceExcerpt'
    ]);
    assertCandidateList(record.decision_candidates, 'decision_candidates', [
        'decision_type',
        'decisionType',
        'source_excerpt',
        'sourceExcerpt'
    ]);
    const followUpDraft = asRecord(record.follow_up_draft);
    if (!followUpDraft) {
        throw validationError('follow_up_draft must be a JSON object', 'blocked_invalid_candidates');
    }
    if (typeof followUpDraft.body !== 'string') {
        throw validationError('follow_up_draft.body must be a string', 'blocked_invalid_candidates');
    }
    if (followUpDraft.body.length > EXTERNAL_RUNTIME_FOLLOW_UP_BODY_MAX_LENGTH) {
        throw validationError(
            `follow_up_draft.body must be at most ${EXTERNAL_RUNTIME_FOLLOW_UP_BODY_MAX_LENGTH} characters`,
            'blocked_invalid_candidates'
        );
    }
}

export function normalizeTaskCandidates(
    rawCandidates: unknown,
    { caseScope = null, evidenceRefs = [] }: { caseScope?: string | null; evidenceRefs?: unknown[] } = {}
): MeetingCandidate[] {
    if (!Array.isArray(rawCandidates)) return [];
    return rawCandidates
        .map((candidate) => asRecord(candidate))
        .filter((candidate): candidate is RecordValue => Boolean(candidate))
        .map((candidate, index): MeetingCandidate | null => {
            const title = readOptionalString(candidate, 'title') || '';
            if (!title) return null;
            return {
                id: stableId('task_candidate', caseScope || '', 'task', title, index),
                title,
                status: 'candidate' as const,
                source: EXTERNAL_RUNTIME_CANDIDATE_SOURCE as typeof EXTERNAL_RUNTIME_CANDIDATE_SOURCE,
                case_scope: caseScope,
                owner_hint: taskCandidateOwnerHint(candidate),
                due_hint: readOptionalString(candidate, 'due_hint', 'dueHint'),
                source_excerpt: readOptionalString(candidate, 'source_excerpt', 'sourceExcerpt'),
                evidence_refs: evidenceRefs
            };
        })
        .filter((candidate): candidate is MeetingCandidate => Boolean(candidate));
}

export function normalizeDecisionCandidates(
    rawCandidates: unknown,
    { caseScope = null, evidenceRefs = [] }: { caseScope?: string | null; evidenceRefs?: unknown[] } = {}
): MeetingCandidate[] {
    if (!Array.isArray(rawCandidates)) return [];
    return rawCandidates
        .map((candidate) => asRecord(candidate))
        .filter((candidate): candidate is RecordValue => Boolean(candidate))
        .map((candidate, index): MeetingCandidate | null => {
            const title = readOptionalString(candidate, 'title') || '';
            if (!title) return null;
            return {
                id: stableId('decision_candidate', caseScope || '', 'decision', title, index),
                title,
                status: 'candidate' as const,
                source: EXTERNAL_RUNTIME_CANDIDATE_SOURCE as typeof EXTERNAL_RUNTIME_CANDIDATE_SOURCE,
                case_scope: caseScope,
                decision_type: readOptionalString(candidate, 'decision_type', 'decisionType') || 'meeting_decision',
                source_excerpt: readOptionalString(candidate, 'source_excerpt', 'sourceExcerpt'),
                evidence_refs: evidenceRefs
            };
        })
        .filter((candidate): candidate is MeetingCandidate => Boolean(candidate));
}

export function normalizeFollowUpDraft(rawDraft: unknown): FollowUpDraft {
    const record = asRecord(rawDraft);
    return {
        status: 'draft_only',
        external_send_required_approval: true,
        body: typeof record?.body === 'string' ? record.body : ''
    };
}

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
] as const;

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
] as const;

const REQUIRED_LOOP_INTENT_KEYS = Array.from(new Set([
    ...MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.loop_intent_key),
    ...MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((definition) => definition.loop_intent_key)
]));
const REQUIRED_PACKAGE_KEYS = MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.package_key);

export function verifyMeetingReviewPackage({
    repository,
    reviewPackage,
    orgId,
    projectId
}: VerifyMeetingReviewPackageInput): VerifiedMeetingReviewPackage {
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
    const loopEntries = Object.entries(loopIntentIds as RecordValue)
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''] as const)
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
            throw validationError(`loop_intent '${loopIntentId}' not found`, 'blocked_loop_intent_mismatch', {
                loop_intent_key: key,
                loop_intent_id: loopIntentId
            });
        }
        if (loopIntent.org_id !== orgId || loopIntent.project_id !== projectId) {
            throw validationError(
                `loop_intent '${loopIntentId}' belongs to '${loopIntent.org_id}/${loopIntent.project_id}'`,
                'blocked_loop_intent_mismatch',
                {
                    loop_intent_key: key,
                    loop_intent_id: loopIntentId,
                    expected: { org_id: orgId, project_id: projectId },
                    actual: { org_id: loopIntent.org_id, project_id: loopIntent.project_id }
                }
            );
        }
        return { key, loop_intent: loopIntent };
    });

    return {
        loopIntents,
        loopIntentByKey: new Map(loopIntents.map((entry) => [entry.key, entry.loop_intent]))
    };
}
