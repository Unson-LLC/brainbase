// @ts-check

import crypto from 'node:crypto';

import { AppError } from '../../lib/errors.js';

const EVE_CANDIDATE_SOURCE = 'eve_meeting_agent';
const EVE_CANDIDATE_MAX_COUNT = 5;
const EVE_CANDIDATE_FIELD_MAX_LENGTHS = Object.freeze({
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
const EVE_FOLLOW_UP_BODY_MAX_LENGTH = 10_000;

function readOptionalString(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stableId(prefix, ...parts) {
    const base = parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!base) return `${prefix}_${crypto.randomUUID()}`;
    if (base.length <= 96) return `${prefix}_${base}`;
    const hash = crypto.createHash('sha256').update(base).digest('hex').slice(0, 12);
    return `${prefix}_${base.slice(0, 83).replace(/_+$/g, '')}_${hash}`;
}

function taskCandidateOwnerHint(candidate) {
    return readOptionalString(candidate, 'owner_hint', 'ownerHint')
        || readOptionalString(candidate, 'assignee_hint', 'assigneeHint')
        || readOptionalString(candidate, 'owner')
        || readOptionalString(candidate, 'assignee')
        || null;
}

function assertOptionalCandidateString(candidate, fieldName, index, collectionName) {
    if (candidate[fieldName] !== undefined && typeof candidate[fieldName] !== 'string') {
        throw AppError.validation(`${collectionName}[${index}].${fieldName} must be a string`, {
            state_transition: 'blocked_invalid_candidates'
        });
    }
    const maxLength = EVE_CANDIDATE_FIELD_MAX_LENGTHS[fieldName];
    if (typeof candidate[fieldName] === 'string' && maxLength && candidate[fieldName].length > maxLength) {
        throw AppError.validation(`${collectionName}[${index}].${fieldName} must be at most ${maxLength} characters`, {
            state_transition: 'blocked_invalid_candidates'
        });
    }
}

function assertCandidateList(value, collectionName, optionalStringFields) {
    if (!Array.isArray(value)) {
        throw AppError.validation(`${collectionName} must be an array`, {
            state_transition: 'blocked_invalid_candidates'
        });
    }
    if (value.length > EVE_CANDIDATE_MAX_COUNT) {
        throw AppError.validation(`${collectionName} must contain at most ${EVE_CANDIDATE_MAX_COUNT} candidates`, {
            state_transition: 'blocked_invalid_candidates'
        });
    }
    value.forEach((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw AppError.validation(`${collectionName}[${index}] must be a JSON object`, {
                state_transition: 'blocked_invalid_candidates'
            });
        }
        if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) {
            throw AppError.validation(`${collectionName}[${index}].title must be a non-empty string`, {
                state_transition: 'blocked_invalid_candidates'
            });
        }
        if (candidate.title.length > EVE_CANDIDATE_FIELD_MAX_LENGTHS.title) {
            throw AppError.validation(`${collectionName}[${index}].title must be at most ${EVE_CANDIDATE_FIELD_MAX_LENGTHS.title} characters`, {
                state_transition: 'blocked_invalid_candidates'
            });
        }
        optionalStringFields.forEach((fieldName) => {
            assertOptionalCandidateString(candidate, fieldName, index, collectionName);
        });
    });
}

export function assertMeetingCandidatesInput(input) {
    assertCandidateList(input.task_candidates, 'task_candidates', [
        'owner_hint',
        'ownerHint',
        'due_hint',
        'dueHint',
        'source_excerpt',
        'sourceExcerpt'
    ]);
    assertCandidateList(input.decision_candidates, 'decision_candidates', [
        'decision_type',
        'decisionType',
        'source_excerpt',
        'sourceExcerpt'
    ]);
    if (!input.follow_up_draft || typeof input.follow_up_draft !== 'object' || Array.isArray(input.follow_up_draft)) {
        throw AppError.validation('follow_up_draft must be a JSON object', {
            state_transition: 'blocked_invalid_candidates'
        });
    }
    if (typeof input.follow_up_draft.body !== 'string') {
        throw AppError.validation('follow_up_draft.body must be a string', {
            state_transition: 'blocked_invalid_candidates'
        });
    }
    if (input.follow_up_draft.body.length > EVE_FOLLOW_UP_BODY_MAX_LENGTH) {
        throw AppError.validation(`follow_up_draft.body must be at most ${EVE_FOLLOW_UP_BODY_MAX_LENGTH} characters`, {
            state_transition: 'blocked_invalid_candidates'
        });
    }
}

export function normalizeTaskCandidates(rawCandidates, { caseScope = null, evidenceRefs = [] } = {}) {
    if (!Array.isArray(rawCandidates)) return [];
    return rawCandidates
        .map((candidate) => (candidate && typeof candidate === 'object' ? candidate : null))
        .filter(Boolean)
        .map((candidate, index) => {
            const title = readOptionalString(candidate, 'title') || '';
            if (!title) return null;
            return {
                id: stableId('task_candidate', caseScope || '', 'task', title, index),
                title,
                status: 'candidate',
                source: EVE_CANDIDATE_SOURCE,
                case_scope: caseScope,
                owner_hint: taskCandidateOwnerHint(candidate),
                due_hint: readOptionalString(candidate, 'due_hint', 'dueHint'),
                source_excerpt: readOptionalString(candidate, 'source_excerpt', 'sourceExcerpt'),
                evidence_refs: evidenceRefs
            };
        })
        .filter(Boolean);
}

export function normalizeDecisionCandidates(rawCandidates, { caseScope = null, evidenceRefs = [] } = {}) {
    if (!Array.isArray(rawCandidates)) return [];
    return rawCandidates
        .map((candidate) => (candidate && typeof candidate === 'object' ? candidate : null))
        .filter(Boolean)
        .map((candidate, index) => {
            const title = readOptionalString(candidate, 'title') || '';
            if (!title) return null;
            return {
                id: stableId('decision_candidate', caseScope || '', 'decision', title, index),
                title,
                status: 'candidate',
                source: EVE_CANDIDATE_SOURCE,
                case_scope: caseScope,
                decision_type: readOptionalString(candidate, 'decision_type', 'decisionType') || 'meeting_decision',
                source_excerpt: readOptionalString(candidate, 'source_excerpt', 'sourceExcerpt'),
                evidence_refs: evidenceRefs
            };
        })
        .filter(Boolean);
}

export function normalizeFollowUpDraft(rawDraft) {
    return {
        status: 'draft_only',
        external_send_required_approval: true,
        body: typeof rawDraft?.body === 'string' ? rawDraft.body : ''
    };
}
