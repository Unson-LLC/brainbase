// @ts-check

import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import {
    generateWorkflowDraft,
    testWorkflowDraft
} from './workflow-draft-generator.js';
import {
    MEETING_WORKFLOW_PACK_ID,
    MEETING_WORKFLOW_DEFINITIONS,
    buildMeetingWorkflowPackRecords,
    meetingPackIds
} from './meeting-workflow-pack.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_OWNER_ID = 'local-user';
const MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY = 'meeting-review-package-ingest';
const ALLOWED_TRIGGER_TYPES = new Set(['human', 'event', 'schedule']);
const ALLOWED_AUTONOMY_LEVELS = new Set(['human_only', 'draft_only', 'approval_required', 'auto_execute']);
const MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS = [
    'requested',
    'calendar_fetching',
    'meeting_pack_ensured',
    'loop_intents_ready',
    'skipped_inputs_reported'
];
const MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS = [
    'requested',
    'calendar_fetching',
    'calendar_fetch_failed_all',
    'failed_without_partial_write'
];
const EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY = 'eve-session-dispatch';
const EVE_SESSION_DISPATCH_STATE_TRANSITIONS = [
    'loop_intent_loaded',
    'control_refs_resolved',
    'eve_session_requested',
    'eve_session_recorded',
    'awaiting_eve_result'
];
const EVE_SESSION_DISPATCH_LOCK_TTL_MS = 600000;
const DEFAULT_EVE_STOP_CONDITIONS = [
    'missing_context',
    'privacy_scope_leak',
    'human_approval_required'
];
const MEETING_REVIEW_INGEST_SUCCESS_STATE_TRANSITIONS = [
    'package_received',
    'scope_resolved',
    'loop_intents_verified',
    'run_recorded',
    'outputs_recorded',
    'human_steps_recorded',
    'waiting_human'
];
const MEETING_REVIEW_OUTPUT_DEFINITIONS = [
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
const MEETING_REVIEW_HUMAN_STEP_DEFINITIONS = [
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
const REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS = Array.from(new Set([
    ...MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.loop_intent_key),
    ...MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((definition) => definition.loop_intent_key)
]));
const REQUIRED_MEETING_REVIEW_PACKAGE_KEYS = MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.package_key);
const MEETING_PACK_GRAPH_SSOT_ENTITY_TYPES = [
    'project',
    'person',
    'org',
    'decision',
    'raci_assignment',
    'glossary_term',
    'kpi',
    'initiative'
];
const MEETING_PACK_GRAPH_PLAYBOOK_NODES = [
    'source_intake',
    'project_resolution_gate',
    'project_scoped_graph_context',
    'mention_resolution',
    'glossary_resolution',
    'meeting_note_generation',
    'task_candidate_generation',
    'decision_candidate_generation',
    'graph_promotion_candidates',
    'human_review_package'
];
const MEETING_PACK_GRAPH_PLAYBOOK_EDGES = [
    ['source_intake', 'project_resolution_gate'],
    ['project_resolution_gate', 'project_scoped_graph_context'],
    ['project_scoped_graph_context', 'mention_resolution'],
    ['project_scoped_graph_context', 'glossary_resolution'],
    ['mention_resolution', 'meeting_note_generation'],
    ['glossary_resolution', 'meeting_note_generation'],
    ['meeting_note_generation', 'task_candidate_generation'],
    ['meeting_note_generation', 'decision_candidate_generation'],
    ['decision_candidate_generation', 'graph_promotion_candidates'],
    ['task_candidate_generation', 'human_review_package'],
    ['graph_promotion_candidates', 'human_review_package']
];
const MEETING_PACK_GRAPH_PLAYBOOK_EXCEPTION_BRANCHES = {
    source_intake: [
        'missing_transcript_or_slack_attachment',
        'source_artifact_hash_missing'
    ],
    project_resolution_gate: [
        'missing_project_candidate',
        'multiple_project_candidates',
        'project_access_denied'
    ],
    project_scoped_graph_context: [
        'graph_ssot_unavailable',
        'empty_project_context'
    ],
    glossary_resolution: [
        'empty_project_glossary',
        'term_conflict_requires_human_review'
    ],
    meeting_note_generation: [
        'source_fact_not_in_transcript',
        'graph_context_used_as_fact_source'
    ],
    human_review_package: [
        'task_create_requires_human_approval',
        'decision_promotion_requires_human_approval',
        'graph_write_requires_human_approval',
        'external_send_requires_human_approval'
    ]
};

function meetingReviewValidationError(message, stateTransition, details = {}) {
    return AppError.validation(message, {
        state_transition: stateTransition,
        ...details
    });
}

function normalizeProjectKey(value) {
    if (!value || typeof value !== 'string') return '';
    return value.toLowerCase().replace(/_/g, '-');
}

function projectAccessKeys(projectId, projectConfig = null) {
    const keys = new Set();
    const normalizedId = normalizeProjectKey(projectId);
    if (normalizedId) {
        keys.add(normalizedId);
        keys.add(normalizedId.replace(/-/g, ''));
    }
    const aliases = Array.isArray(projectConfig?.aliases) ? projectConfig.aliases : [];
    for (const alias of aliases) {
        const normalizedAlias = normalizeProjectKey(alias);
        if (normalizedAlias) {
            keys.add(normalizedAlias);
            keys.add(normalizedAlias.replace(/-/g, ''));
        }
    }
    const githubRepo = normalizeProjectKey(projectConfig?.github?.repo);
    if (githubRepo) {
        keys.add(githubRepo);
        keys.add(githubRepo.replace(/-/g, ''));
    }
    if (normalizedId.endsWith('-app')) {
        const parentId = normalizedId.slice(0, -4);
        keys.add(parentId);
        keys.add(parentId.replace(/-/g, ''));
    }
    return keys;
}

function workflowPriority(workflow) {
    const run = workflow.latest_run || {};
    if (run.human_waiting || run.status === 'waiting_human') return 0;
    if (run.action_required && run.action_required !== 'none') return 1;
    if (run.status === 'failed') return 2;
    if (run.status === 'needs_action') return 3;
    if (!run.id) return 5;
    return 4;
}

function companionApprovalPriority({ pendingHumanSteps = [], outputs = [], run = {} } = {}) {
    const highRiskTargets = new Set([
        'external_message_draft',
        'graph_ssot_decision',
        'candidate_store',
        'task_store'
    ]);
    const protectedTargets = [
        ...pendingHumanSteps.map((step) => step?.metadata?.write_back_target || step?.write_back_target),
        ...outputs.map((output) => output?.metadata?.write_back_target)
    ].filter(Boolean);
    if (run.status === 'failed' || protectedTargets.some((target) => highRiskTargets.has(target))) {
        return 'high';
    }
    if (pendingHumanSteps.length > 1) return 'medium';
    return 'low';
}

function isActionableCompanionApprovalRun(run = {}) {
    const status = String(run.status || '').toLowerCase();
    if (['success', 'succeeded', 'cancelled', 'canceled', 'resolved', 'skipped', 'closed'].includes(status)) return false;
    if (run.closure_state === 'closed') return false;
    if (run.human_waiting === true) return true;
    if (status === 'waiting_human') return true;
    return Boolean(run.action_required && run.action_required !== 'none');
}

function outputSummary(output) {
    const preview = typeof output?.preview === 'string' ? output.preview.trim() : '';
    if (preview) return preview.slice(0, 240);
    const payload = output?.payload;
    if (Array.isArray(payload)) return `${payload.length}件`;
    if (payload && typeof payload === 'object') {
        const keys = Object.keys(payload);
        if (keys.length > 0) return keys.slice(0, 6).join(', ');
    }
    if (payload == null) return '';
    return String(payload).slice(0, 240);
}

function normalizeCompanionApprovalOutput(output) {
    return {
        id: output.id,
        output_type: output.type || output.output_type || null,
        title: output.title || output.type || output.id,
        summary: outputSummary(output),
        preview: output.preview || null,
        payload: output.payload ?? null,
        metadata: output.metadata || {},
        created_at: output.created_at || null
    };
}

function normalizeCompanionApprovalHumanStep(step) {
    const metadata = step.metadata || {};
    return {
        id: step.id,
        prompt: step.prompt || '',
        status: step.status || 'pending',
        step_type: step.step_type || null,
        requested_by: step.requested_by || null,
        requested_to: step.requested_to || null,
        approval_kind: metadata.approval_kind || metadata.reason || step.reason || step.step_type || 'approval',
        write_back_target: metadata.write_back_target || step.write_back_target || null,
        protects: Array.isArray(metadata.protects) ? metadata.protects : [],
        loop_intent_id: metadata.loop_intent_id || null,
        metadata,
        created_at: step.created_at || null,
        updated_at: step.updated_at || null
    };
}

function normalizePeopleText(value) {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .replace(/^@+/, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function normalizePeopleCompactText(value) {
    return normalizePeopleText(value).replace(/\s+/g, '');
}

function normalizeOwnerHintSearchText(value) {
    return normalizePeopleText(value).replace(/(さん|様|氏)$/u, '').trim();
}

function ownerHintSearchQueries(ownerHint) {
    return Array.from(new Set([
        normalizePeopleText(ownerHint),
        normalizeOwnerHintSearchText(ownerHint)
    ].filter(Boolean)));
}

function isSpeakerOwnerHint(value) {
    const normalized = normalizePeopleText(value);
    return /^speaker\s*\d+$/.test(normalized) || /^話者\s*\d+$/.test(normalized);
}

function personNameValues(person = {}) {
    return [
        person.display_name,
        person.name,
        ...(Array.isArray(person.aliases) ? person.aliases : [])
    ].filter((value) => typeof value === 'string' && value.trim());
}

function normalizeProjectIDs(value) {
    if (!value) return [];
    const values = Array.isArray(value) ? value : [value];
    return Array.from(new Set(values
        .flatMap((item) => {
            if (Array.isArray(item)) return normalizeProjectIDs(item);
            if (typeof item === 'string') return [item];
            if (!item || typeof item !== 'object') return [];
            return [item.id, item.project_id, item.projectId, item.project_code, item.projectCode, item.code, item.slug, item.name];
        })
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim())));
}

function normalizeTaskOwnerPerson(record) {
    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
    const id = record?.id || record?.entity_id || payload.person_id || payload.id || '';
    const displayName = payload.display_name || payload.name || record?.label || id;
    if (!id || !displayName) return null;
    const projectIds = normalizeProjectIDs([
        payload.project_ids,
        payload.projectIds,
        payload.project_codes,
        payload.projectCodes,
        payload.projects,
        payload.member_of,
        payload.memberOf,
        payload.member_of_project_codes,
        payload.memberOfProjectCodes,
        payload.member_of_project_ids,
        payload.memberOfProjectIds,
        payload.project_id,
        payload.projectId,
        payload.project_code,
        payload.projectCode,
        record?.project_id,
        record?.projectId,
        record?.project_code,
        record?.projectCode,
        record?.project_codes,
        record?.projectCodes,
        record?.member_of,
        record?.memberOf,
        record?.member_of_project_codes,
        record?.memberOfProjectCodes,
        record?.member_of_project_ids,
        record?.memberOfProjectIds,
        record?.projects,
        record?.project
    ]);
    return {
        id,
        person_id: id,
        entity_id: record?.entity_id || id,
        display_name: displayName,
        name: payload.name || displayName,
        aliases: Array.isArray(payload.aliases) ? payload.aliases.filter((alias) => typeof alias === 'string' && alias.trim()) : [],
        email: payload.email || null,
        org: payload.org || payload.organization || null,
        role: payload.role || null,
        status: payload.status || 'active',
        project_ids: projectIds,
        source: 'graph_ssot'
    };
}

function taskCandidateOwnerHint(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return '';
    return readOptionalString(candidate, 'owner_hint', 'ownerHint')
        || readOptionalString(candidate, 'assignee_hint', 'assigneeHint')
        || readOptionalString(candidate, 'owner', 'owner')
        || readOptionalString(candidate, 'assignee', 'assignee')
        || '';
}

function taskOwnerCandidatePayload(person, ownerHint, projectId = null) {
    const ownerHintCompact = normalizePeopleCompactText(ownerHint);
    const normalizedHintCompact = normalizePeopleCompactText(normalizeOwnerHintSearchText(ownerHint));
    const nameCompacts = personNameValues(person).map((value) => normalizePeopleCompactText(value));
    const exact = nameCompacts
        .some((value) => value === ownerHintCompact || value === normalizedHintCompact);
    const partial = !exact
        && normalizedHintCompact.length >= 2
        && nameCompacts.some((value) => value.includes(normalizedHintCompact));
    const contextMatch = Boolean(projectId && Array.isArray(person.project_ids) && person.project_ids.includes(projectId));
    const baseScore = exact ? 100 : (partial ? 70 : 30);
    const score = baseScore + (contextMatch ? 50 : 0) + (person.status === 'inactive' ? 0 : 5);
    return {
        person_id: person.person_id,
        entity_id: person.entity_id,
        display_name: person.display_name,
        aliases: person.aliases,
        project_ids: person.project_ids || [],
        status: person.status || 'active',
        source: 'graph_ssot',
        match: exact ? 'exact_name_or_alias' : (partial ? 'partial_name_or_alias' : 'search_result'),
        context_match: contextMatch,
        score
    };
}

function sortTaskOwnerCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        return String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ja');
    });
}

function confidentlySelectedTaskOwnerCandidate(ownerCandidates) {
    const selectableCandidates = ownerCandidates.filter((person) => String(person.status || 'active').toLowerCase() !== 'inactive');
    if (!selectableCandidates.length) return null;
    const exactMatches = selectableCandidates.filter((person) => person.match === 'exact_name_or_alias');
    if (ownerCandidates.length === 1 && exactMatches.length === 1) return selectableCandidates[0];
    const [first, second] = selectableCandidates;
    const firstScore = first?.score || 0;
    const secondScore = second?.score || 0;
    if (
        first
        && first.context_match
        && ['exact_name_or_alias', 'partial_name_or_alias'].includes(first.match)
        && firstScore - secondScore >= 20
    ) {
        return first;
    }
    return null;
}

function taskOwnerAccessFromActor(actor = {}, projectId = null) {
    const role = typeof actor.role === 'string' ? actor.role.toLowerCase() : '';
    const projectCodes = Array.isArray(actor.projectCodes) && actor.projectCodes.length
        ? actor.projectCodes
        : (projectId ? [projectId] : []);
    return {
        role: ['member', 'gm', 'ceo'].includes(role) ? role : 'ceo',
        projectCodes,
        clearance: Array.isArray(actor.clearance) && actor.clearance.length ? actor.clearance : ['internal'],
        personId: actor.person_id || actor.personId || actor.sub || null
    };
}

function normalizeCompanionApprovalContextSnapshot(snapshot) {
    return {
        id: snapshot.id,
        source_type: snapshot.source_type || snapshot.type || null,
        source_ref: snapshot.source_ref || snapshot.ref || null,
        source_version: snapshot.source_version || null,
        title: snapshot.title || snapshot.source_type || snapshot.id,
        summary: snapshot.preview || snapshot.summary || '',
        payload: snapshot.data ?? snapshot.payload ?? null,
        metadata: snapshot.metadata || {},
        created_at: snapshot.created_at || null
    };
}

function normalizeCompanionApprovalEvidence(auditLog) {
    return {
        id: auditLog.id,
        action: auditLog.action || null,
        target_type: auditLog.target_type || null,
        target_id: auditLog.target_id || null,
        summary: auditLog.summary || auditLog.message || auditLog.action || '',
        before: auditLog.before ?? null,
        after: auditLog.after ?? null,
        metadata: auditLog.metadata || {},
        created_at: auditLog.created_at || null
    };
}

function companionApprovalActionKind({ pendingHumanSteps = [], outputs = [], run = {} } = {}) {
    const firstStep = pendingHumanSteps[0] || {};
    const stepMetadata = firstStep.metadata || {};
    return stepMetadata.action_kind
        || stepMetadata.approval_kind
        || outputs[0]?.type
        || outputs[0]?.output_type
        || stepMetadata.write_back_target
        || outputs[0]?.metadata?.action_kind
        || outputs[0]?.metadata?.write_back_target
        || run.action_required
        || 'approval';
}

function companionApprovalOwner({ run = {}, workflow = null, pendingHumanSteps = [] } = {}) {
    const firstStep = pendingHumanSteps[0] || {};
    return firstStep.requested_to
        || firstStep.assignee_id
        || firstStep.approver_id
        || run.approver_id
        || run.assignee_id
        || run.owner_id
        || workflow?.default_approver_id
        || workflow?.default_assignee_id
        || workflow?.owner_id
        || run.metadata?.owner_id
        || null;
}

function runDisplayTitle(run, workflow) {
    return run?.metadata?.meeting_identity?.title
        || run?.metadata?.title
        || workflow?.name
        || run?.workflow_id
        || run?.id
        || 'Workflow approval';
}

function readString(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    return typeof value === 'string' ? value.trim() : '';
}

function readOptionalString(input, snakeKey, camelKey = snakeKey) {
    const value = readString(input, snakeKey, camelKey);
    return value || null;
}

function readOptionalJsonValue(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'object') {
        throw AppError.validation(`${snakeKey} must be a JSON object or array`);
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        throw AppError.validation(`${snakeKey} must be JSON serializable`);
    }
}

function requireInputString(input, snakeKey, camelKey = snakeKey) {
    const value = readString(input, snakeKey, camelKey);
    if (!value) throw AppError.validation(`${snakeKey} is required`);
    return value;
}

function ensureAllowed(value, allowed, fieldName) {
    if (!allowed.has(value)) {
        throw AppError.validation(`${fieldName} must be one of ${Array.from(allowed).join(', ')}`);
    }
}

function normalizeTags(value) {
    return Array.isArray(value)
        ? value.map((item) => String(item).trim()).filter(Boolean)
        : [];
}

function readStringList(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function readStrictStringList(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    return normalizeStrictStringList(value, snakeKey);
}

function normalizeStrictStringList(value, fieldName) {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    if (!Array.isArray(value)) {
        throw AppError.validation(`${fieldName} must be an array of non-empty strings`);
    }
    return value.map((item, index) => {
        if (typeof item !== 'string' || item.trim() === '') {
            throw AppError.validation(`${fieldName}[${index}] must be a non-empty string`);
        }
        return item.trim();
    });
}

function readPersistedStrictStringList(record, key, fieldName) {
    if (!record || !Object.prototype.hasOwnProperty.call(record, key)) return [];
    const value = record[key];
    if (!Array.isArray(value)) {
        throw AppError.validation(`${fieldName} must be an array of non-empty strings`);
    }
    return normalizeStrictStringList(value, fieldName);
}

function createStableIdBase(...parts) {
    return parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function createStableId(prefix, ...parts) {
    const base = createStableIdBase(...parts).slice(0, 96);
    return base ? `${prefix}_${base}` : `${prefix}_${crypto.randomUUID()}`;
}

function createEveSessionRunId(loopIntent, sessionId) {
    const sessionBase = createStableIdBase(sessionId).slice(0, 24) || 'session';
    const hashSource = [
        loopIntent?.workspace_id || DEFAULT_WORKSPACE_ID,
        loopIntent?.org_id,
        loopIntent?.project_id,
        loopIntent?.id,
        sessionId
    ].join(':');
    const hash = crypto.createHash('sha256').update(hashSource).digest('hex').slice(0, 12);
    const suffix = `${sessionBase}_${hash}`;
    const stemBase = createStableIdBase(loopIntent?.org_id, loopIntent?.project_id, loopIntent?.id, 'eve_session') || 'eve_session';
    const maxStemLength = Math.max(12, 96 - suffix.length - 1);
    const stem = stemBase.slice(0, maxStemLength).replace(/_+$/g, '') || 'eve_session';
    return `run_${stem}_${suffix}`;
}

function eveDispatchLockWorkflowId(loopIntent) {
    return `eve_session_dispatch:${loopIntent?.id || 'unknown'}`;
}

function isEveSessionTimeoutError(error) {
    return error?.code === 'eve_session_timeout';
}

function createMeetingReviewStableId(prefix, ...parts) {
    const base = createStableIdBase(...parts);
    if (!base) return `${prefix}_${crypto.randomUUID()}`;
    if (base.length <= 96) return `${prefix}_${base}`;
    const hash = crypto.createHash('sha256').update(base).digest('hex').slice(0, 12);
    const stem = base.slice(0, 83).replace(/_+$/g, '');
    return `${prefix}_${stem}_${hash}`;
}

function jsonClone(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}

function graphContextEntities(context = {}) {
    if (!context || typeof context !== 'object') return [];
    const entities = context.entities;
    if (Array.isArray(entities)) return entities;
    if (!entities || typeof entities !== 'object') return [];
    return Object.values(entities).flatMap((records) => Array.isArray(records) ? records : []);
}

function graphContextTypeCounts(context = {}) {
    if (!context || typeof context !== 'object') return {};
    const entities = context.entities;
    if (Array.isArray(entities)) {
        return entities.reduce((counts, record) => {
            const type = record?.entity_type || record?.type || record?.payload?.entity_type || 'unknown';
            counts[type] = (counts[type] || 0) + 1;
            return counts;
        }, {});
    }
    if (!entities || typeof entities !== 'object') return {};
    return Object.fromEntries(Object.entries(entities).map(([type, records]) => [
        type,
        Array.isArray(records) ? records.length : 0
    ]));
}

function graphContextEntityCount(context = {}) {
    return graphContextEntities(context).length;
}

function graphContextGlossaryCount(context = {}) {
    const entities = context?.entities;
    if (Array.isArray(entities)) {
        return entities.filter((record) => record?.entity_type === 'glossary_term' || record?.type === 'glossary_term').length;
    }
    return Array.isArray(entities?.glossary_term) ? entities.glossary_term.length : 0;
}

function buildMeetingPackProjectResolution({ input = {}, reviewPackage = {}, meetingIdentity = {}, orgId, projectId, caseScope }) {
    const evidence = buildMeetingPackProjectResolutionEvidence({ input, reviewPackage, meetingIdentity });
    const source = evidence.explicit_input.project_id
        ? 'explicit_input'
        : evidence.review_package_scope.project_id
            ? 'review_package_scope'
            : 'meeting_identity_candidate';
    return {
        status: 'single_high_confidence_project',
        org_id: orgId,
        project_id: projectId,
        case_scope: caseScope || null,
        source,
        candidates: [{
            org_id: orgId,
            project_id: projectId,
            confidence: 1,
            selected: true,
            source
        }],
        evidence
    };
}

function buildMeetingPackProjectResolutionEvidence({ input = {}, reviewPackage = {}, meetingIdentity = {} }) {
    return {
        explicit_input: {
            org_id: readOptionalString(input, 'org_id', 'orgId'),
            project_id: readOptionalString(input, 'project_id', 'projectId')
        },
        review_package_scope: {
            org_id: readOptionalString(reviewPackage, 'org_id', 'orgId'),
            project_id: readOptionalString(reviewPackage, 'project_id', 'projectId')
        },
        meeting_identity_candidate: {
            org_id: readOptionalString(meetingIdentity, 'candidate_org_id', 'candidateOrgId'),
            project_id: readOptionalString(meetingIdentity, 'candidate_project_id', 'candidateProjectId')
        }
    };
}

function projectCandidateIdsFromMeetingIdentity(meetingIdentity = {}) {
    const rawCandidates = [
        ...(Array.isArray(meetingIdentity.candidate_project_ids) ? meetingIdentity.candidate_project_ids : []),
        ...(Array.isArray(meetingIdentity.candidateProjectIds) ? meetingIdentity.candidateProjectIds : []),
        ...(Array.isArray(meetingIdentity.project_candidates) ? meetingIdentity.project_candidates : []),
        ...(Array.isArray(meetingIdentity.projectCandidates) ? meetingIdentity.projectCandidates : [])
    ];
    const candidateIds = rawCandidates
        .map((candidate) => {
            if (typeof candidate === 'string') return candidate.trim();
            if (!candidate || typeof candidate !== 'object') return '';
            return readOptionalString(candidate, 'project_id', 'projectId', 'id');
        })
        .filter(Boolean);
    return Array.from(new Set(candidateIds));
}

function buildMeetingPackProjectResolutionBlocker({
    input = {},
    reviewPackage = {},
    meetingIdentity = {},
    orgId = null,
    projectId = null,
    caseScope = null,
    code,
    message
}) {
    const evidence = buildMeetingPackProjectResolutionEvidence({ input, reviewPackage, meetingIdentity });
    const candidateProjectIds = projectCandidateIdsFromMeetingIdentity(meetingIdentity);
    const candidates = candidateProjectIds.length > 0
        ? candidateProjectIds.map((candidateProjectId) => ({
            org_id: orgId || evidence.meeting_identity_candidate.org_id || null,
            project_id: candidateProjectId,
            confidence: null,
            selected: false,
            source: 'meeting_identity_candidates'
        }))
        : [];
    return {
        status: code,
        org_id: orgId || null,
        project_id: projectId || null,
        case_scope: caseScope || null,
        source: 'pre_ingest_validation',
        candidates,
        evidence,
        active_exception: {
            node: 'project_resolution_gate',
            code,
            message
        }
    };
}

function buildMeetingPackPreIngestGraphPlaybook({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, code, message }) {
    const projectResolution = buildMeetingPackProjectResolutionBlocker({
        input,
        reviewPackage,
        meetingIdentity,
        orgId,
        projectId,
        caseScope,
        code,
        message
    });
    const graphPlaybook = buildMeetingPackGraphPlaybook({
        orgId,
        projectId,
        caseScope,
        packageId,
        sourceEvent,
        evidenceRefs,
        projectResolution,
        graphStatus: 'not_requested',
        graphError: message
    });
    return {
        project_resolution: projectResolution,
        graph_ssot_playbook: graphPlaybook
    };
}

function sourceEvidenceStatus(sourceEvent = {}, evidenceRefs = []) {
    const hasSlackAttachment = Boolean(sourceEvent.file_id || sourceEvent.fileId);
    const hasTranscriptHash = Boolean(sourceEvent.local_artifact_sha256 || sourceEvent.localArtifactSha256);
    const hasMessageRef = Boolean(sourceEvent.message_ts || sourceEvent.messageTs);
    const hasEvidenceRefs = Array.isArray(evidenceRefs) && evidenceRefs.length > 0;
    return {
        has_slack_attachment: hasSlackAttachment,
        has_transcript_hash: hasTranscriptHash,
        has_message_ref: hasMessageRef,
        has_evidence_refs: hasEvidenceRefs,
        status: (hasSlackAttachment || hasTranscriptHash || hasEvidenceRefs) ? 'source_evidence_present' : 'source_evidence_missing'
    };
}

function buildMeetingPackGraphPlaybook({
    orgId,
    projectId,
    caseScope,
    packageId,
    sourceEvent = {},
    evidenceRefs = [],
    projectResolution,
    graphContext = null,
    graphStatus = 'unavailable',
    graphError = null
} = {}) {
    const sourceStatus = sourceEvidenceStatus(sourceEvent, evidenceRefs);
    const entityCount = graphContextEntityCount(graphContext);
    const typeCounts = graphContextTypeCounts(graphContext);
    const glossaryCount = graphContextGlossaryCount(graphContext);
    const activeExceptions = [];
    if (sourceStatus.status === 'source_evidence_missing') {
        activeExceptions.push({ node: 'source_intake', code: 'missing_transcript_or_slack_attachment' });
    }
    if (!sourceStatus.has_transcript_hash) {
        activeExceptions.push({ node: 'source_intake', code: 'source_artifact_hash_missing' });
    }
    if (projectResolution?.active_exception?.node === 'project_resolution_gate') {
        activeExceptions.push(jsonClone(projectResolution.active_exception));
    }
    if (graphStatus === 'unavailable') {
        activeExceptions.push({ node: 'project_scoped_graph_context', code: 'graph_ssot_unavailable', message: graphError || null });
    } else if (graphStatus !== 'not_requested' && entityCount === 0) {
        activeExceptions.push({ node: 'project_scoped_graph_context', code: 'empty_project_context' });
    }
    if (graphStatus === 'resolved' && glossaryCount === 0) {
        activeExceptions.push({ node: 'glossary_resolution', code: 'empty_project_glossary' });
    }
    const nodeStatus = (nodeId) => {
        if (activeExceptions.some((exception) => exception.node === nodeId)) return 'exception_recorded';
        if (nodeId === 'project_scoped_graph_context') {
            if (graphStatus === 'resolved') return 'completed';
            if (graphStatus === 'not_requested') return 'blocked';
            return 'fallback_recorded';
        }
        if (nodeId === 'glossary_resolution') {
            if (graphStatus === 'not_requested') return 'blocked';
            return glossaryCount > 0 ? 'completed' : 'fallback_recorded';
        }
        return 'completed';
    };
    return {
        version: 'meeting_pack_graph_ssot_playbook.v1',
        package_id: packageId,
        org_id: orgId,
        project_id: projectId,
        case_scope: caseScope || null,
        dag: {
            nodes: MEETING_PACK_GRAPH_PLAYBOOK_NODES.map((id) => ({ id, status: nodeStatus(id) })),
            edges: MEETING_PACK_GRAPH_PLAYBOOK_EDGES.map(([from, to]) => ({ from, to }))
        },
        project_resolution: projectResolution,
        source_intake: sourceStatus,
        graph_context: {
            source: 'brainbase_graph_ssot',
            status: graphStatus,
            project_id: projectId,
            entity_types: MEETING_PACK_GRAPH_SSOT_ENTITY_TYPES,
            include_edges: true,
            entity_count: entityCount,
            type_counts: typeCounts,
            error: graphError || null
        },
        glossary_resolution: {
            status: graphStatus === 'resolved'
                ? (glossaryCount > 0 ? 'resolved' : 'empty_project_glossary')
                : (graphStatus === 'not_requested' ? 'not_requested' : 'unavailable'),
            entity_count: glossaryCount
        },
        generation_contract: {
            fact_source: 'transcript_and_slack_attachment',
            graph_ssot_role: 'project_scoped_entity_identity_relationship_glossary_context',
            project_must_be_resolved_before_graph_lookup: true,
            graph_context_must_not_override_missing_transcript_facts: true,
            task_create_requires_human_gate: true,
            graph_write_requires_human_gate: true
        },
        exception_branches: jsonClone(MEETING_PACK_GRAPH_PLAYBOOK_EXCEPTION_BRANCHES),
        active_exceptions: activeExceptions
    };
}

function graphContextSnapshotData({ meetingIdentity = {}, graphContext = null, graphPlaybook }) {
    const candidateContext = meetingIdentity.graph_context && typeof meetingIdentity.graph_context === 'object'
        ? meetingIdentity.graph_context
        : {};
    const graphResolved = graphPlaybook?.graph_context?.status === 'resolved';
    return {
        ...jsonClone(candidateContext),
        verification_status: graphResolved ? 'verified_from_graph_ssot' : 'candidate_from_review_package',
        promoted_to_graph_ssot: false,
        graph_context_source: graphResolved ? 'brainbase_graph_ssot' : 'review_package_candidate',
        graph_ssot_context: graphContext ? jsonClone(graphContext) : null,
        graph_ssot_playbook: jsonClone(graphPlaybook)
    };
}

function graphContextSnapshotItemCount({ meetingIdentity = {}, graphContext = null, graphPlaybook }) {
    if (graphPlaybook?.graph_context?.status === 'resolved') return graphContextEntityCount(graphContext);
    return [
        ...(meetingIdentity.graph_context?.org_entity_ids || []),
        ...(meetingIdentity.graph_context?.person_entity_ids || [])
    ].length;
}

function attachGraphPlaybookToReviewPackage(reviewPackage, graphPlaybook) {
    const cloned = jsonClone(reviewPackage);
    if (cloned.meeting_note_summary && typeof cloned.meeting_note_summary === 'object' && !Array.isArray(cloned.meeting_note_summary)) {
        cloned.meeting_note_summary = {
            ...cloned.meeting_note_summary,
            graph_ssot_playbook: jsonClone(graphPlaybook),
            project_resolution: jsonClone(graphPlaybook.project_resolution),
            graph_context_status: jsonClone(graphPlaybook.graph_context)
        };
    }
    return cloned;
}

function eveDispatchBlockReasons(loopIntent) {
    const reasons = [];
    const status = String(loopIntent?.status || '').toLowerCase();
    const eligibilityStatus = String(loopIntent?.eligibility?.status || '').toLowerCase();
    if (loopIntent?.enabled === false) reasons.push('loop_intent_disabled');
    if (['blocked', 'human_only', 'cancelled', 'canceled'].includes(status)) {
        reasons.push(`loop_intent_status_${status}`);
    }
    if (['blocked', 'human_only'].includes(eligibilityStatus)) {
        reasons.push(`eligibility_${eligibilityStatus}`);
    }
    if (Array.isArray(loopIntent?.blocked_reasons)) {
        reasons.push(...loopIntent.blocked_reasons.filter(Boolean).map((reason) => `blocked_reason_${reason}`));
    }
    if (['blocked', 'human_only'].includes(eligibilityStatus) && Array.isArray(loopIntent?.eligibility?.reasons)) {
        reasons.push(...loopIntent.eligibility.reasons.filter(Boolean).map((reason) => `eligibility_reason_${reason}`));
    }
    return Array.from(new Set(reasons));
}

function isBlockedEveDispatch(loopIntent) {
    return eveDispatchBlockReasons(loopIntent).length > 0;
}

function redactedEveSessionRef(session) {
    return {
        session_id: session.session_id,
        continuation_token_present: Boolean(session.continuation_token)
    };
}

function hasOwn(value, key) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function redactLoopIntentForResponse(loopIntent) {
    const cloned = jsonClone(loopIntent);
    const ref = cloned?.metadata?.eve_session_ref;
    if (ref && typeof ref === 'object' && hasOwn(ref, 'continuation_token')) {
        cloned.metadata.eve_session_ref = {
            ...ref,
            continuation_token_present: Boolean(ref.continuation_token || ref.continuation_token_present)
        };
        delete cloned.metadata.eve_session_ref.continuation_token;
    }
    return cloned;
}

function readEveDispatchMessageOverride(input) {
    if (!Object.prototype.hasOwnProperty.call(input || {}, 'message')) return null;
    if (typeof input.message !== 'string' || input.message.trim() === '') {
        throw AppError.validation('message is required', {
            state_transition: 'blocked_eve_message_required'
        });
    }
    return input.message.trim();
}

function assertNoCallerSuppliedEveContinuationToken(input) {
    const disallowedFields = ['continuation_token', 'continuationToken'].filter((field) => hasOwn(input, field));
    if (!disallowedFields.length) return;
    throw AppError.validation('continuation_token is server-owned and cannot be supplied by clients', {
        state_transition: 'blocked_eve_continuation_token_input',
        disallowed_fields: disallowedFields
    });
}

function eveLoopControlStopConditions(binding, loopIntent) {
    const stopConditions = normalizeStrictStringList([
        ...readPersistedStrictStringList(binding, 'stop_conditions', 'loop_control.stop_conditions'),
        ...readPersistedStrictStringList(loopIntent, 'stop_conditions', 'loop_control.stop_conditions'),
        ...readPersistedStrictStringList(loopIntent?.eligibility, 'stop_conditions', 'loop_control.stop_conditions')
    ], 'loop_control.stop_conditions');
    return stopConditions.length > 0 ? stopConditions : DEFAULT_EVE_STOP_CONDITIONS;
}

function eveDispatchContextSnapshotData(sourceType, data) {
    if (sourceType === 'loop_intent') {
        return redactLoopIntentForResponse(data);
    }
    return jsonClone(data);
}

function eveDispatchContextSnapshotRedactionStatus(sourceType, data) {
    if (sourceType !== 'loop_intent') return 'not_required';
    return hasOwn(data?.metadata?.eve_session_ref, 'continuation_token') ? 'redacted' : 'not_required';
}

function buildEveSessionMessage({ loopIntent, roleAgent, template, binding, trigger, overrideMessage = null }) {
    if (overrideMessage) return overrideMessage;
    const workflowName = template?.name || binding?.name || loopIntent.workflow_template_id || 'Brainbase workflow';
    const roleName = roleAgent?.name || loopIntent.role_agent_instance_id || 'Role Agent';
    return [
        'Execute this Brainbase Role Agent workflow as an Eve session.',
        `Role Agent: ${roleName}`,
        `Workflow: ${workflowName}`,
        `Trigger: ${trigger?.trigger_type || loopIntent.trigger_type || 'human'}`,
        'Use only the provided Brainbase context.',
        'Do not send external messages, publish, create contracts, or promote Graph SSOT directly.',
        'Return execution results to Brainbase using the external_runner.v0 contract.'
    ].join('\n');
}

function buildEveSessionContext({ loopIntent, roleAgent, template, binding, trigger }) {
    return {
        brainbase_handoff_version: 'eve_session_handoff.v0',
        expected_result_contract: 'external_runner.v0',
        source_of_truth: 'brainbase',
        loop_intent: redactLoopIntentForResponse(loopIntent),
        role_agent_instance: roleAgent ? jsonClone(roleAgent) : null,
        workflow_template: template ? jsonClone(template) : null,
        workflow_binding: binding ? jsonClone(binding) : null,
        workflow_trigger: trigger ? jsonClone(trigger) : null,
        loop_control: {
            owner_id: roleAgent?.owner_id || loopIntent.requested_by || DEFAULT_OWNER_ID,
            cost_owner_id: binding?.cost_owner_id || roleAgent?.owner_id || loopIntent.requested_by || DEFAULT_OWNER_ID,
            approval_owner_id: binding?.approval_owner_id || roleAgent?.default_approver_id || loopIntent.requested_by || DEFAULT_OWNER_ID,
            autonomy_level: binding?.autonomy_level || loopIntent.eligibility?.autonomy_level || 'approval_required',
            stop_conditions: eveLoopControlStopConditions(binding, loopIntent),
            eligibility: loopIntent.eligibility || null
        },
        write_back_rules: {
            external_send_requires_brainbase_human_gate: true,
            graph_promotion_requires_candidate_store: true,
            learning_candidates_require_redaction_check: true
        }
    };
}

function readReviewPackage(input = {}) {
    const candidate = input.review_package || input.reviewPackage || input.package || input;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw meetingReviewValidationError('review_package must be a JSON object', 'blocked_invalid_review_package');
    }
    return jsonClone(candidate);
}

function previewPayload(value) {
    if (Array.isArray(value)) return `${value.length}件`;
    if (value && typeof value === 'object') {
        if (typeof value.body === 'string') return value.body.slice(0, 500);
        const text = JSON.stringify(value);
        return text.length > 500 ? `${text.slice(0, 500)}...` : text;
    }
    if (value == null) return '';
    return String(value).slice(0, 500);
}

function sourceRefForMeetingIdentity(meetingIdentity = {}) {
    if (meetingIdentity.source === 'google_calendar') {
        return [
            'google-calendar',
            meetingIdentity.account || 'default',
            meetingIdentity.calendar_id || 'default',
            meetingIdentity.event_id || meetingIdentity.event_uid || 'unknown'
        ].join(':');
    }
    return meetingIdentity.source ? `${meetingIdentity.source}:${meetingIdentity.event_id || meetingIdentity.title || 'unknown'}` : 'meeting_identity:unknown';
}

function sourceRefForSourceEvent(sourceEvent = {}) {
    if (sourceEvent.source_system === 'slack') {
        return [
            'slack',
            sourceEvent.workspace || 'default',
            sourceEvent.channel_id || sourceEvent.channel_name || 'unknown',
            sourceEvent.message_ts || sourceEvent.file_id || 'unknown'
        ].join(':');
    }
    return sourceEvent.source_system ? `${sourceEvent.source_system}:${sourceEvent.id || 'unknown'}` : 'source_event:unknown';
}

function loopIntentEntries(loopIntentIds) {
    if (!loopIntentIds || typeof loopIntentIds !== 'object' || Array.isArray(loopIntentIds)) {
        throw meetingReviewValidationError('review_package.loop_intent_ids must be a JSON object', 'blocked_loop_intent_mismatch', {
            required_loop_intent_keys: REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS
        });
    }
    const entries = Object.entries(loopIntentIds)
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
        .filter(([, value]) => value);
    if (entries.length === 0) {
        throw meetingReviewValidationError('review_package.loop_intent_ids must include at least one id', 'blocked_loop_intent_mismatch', {
            required_loop_intent_keys: REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS
        });
    }
    const presentKeys = new Set(entries.map(([key]) => key));
    const missingKeys = REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS.filter((key) => !presentKeys.has(key));
    if (missingKeys.length > 0) {
        throw meetingReviewValidationError('review_package.loop_intent_ids is missing required meeting review key(s)', 'blocked_loop_intent_mismatch', {
            missing_loop_intent_keys: missingKeys,
            required_loop_intent_keys: REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS
        });
    }
    return entries;
}

function assertMeetingReviewPackageMapping(reviewPackage) {
    const missingPackageKeys = REQUIRED_MEETING_REVIEW_PACKAGE_KEYS.filter((key) => !Object.hasOwn(reviewPackage, key) || reviewPackage[key] == null);
    if (missingPackageKeys.length > 0) {
        throw meetingReviewValidationError('review_package is missing required output payload key(s)', 'blocked_invalid_review_package', {
            missing_package_keys: missingPackageKeys,
            required_package_keys: REQUIRED_MEETING_REVIEW_PACKAGE_KEYS
        });
    }
}

function eligibilityFrom({ binding, trigger, input }) {
    const reasons = [];
    if (binding.enabled === false) reasons.push('workflow_binding_disabled');
    if (trigger && trigger.enabled === false) reasons.push('workflow_trigger_disabled');
    const explicitBlockers = normalizeTags(input.blocked_reasons || input.blockedReasons);
    reasons.push(...explicitBlockers);
    if (reasons.length > 0) {
        return {
            status: 'blocked',
            autonomy_level: binding.autonomy_level,
            requires_human_approval: true,
            reasons
        };
    }
    if (binding.autonomy_level === 'human_only') {
        return {
            status: 'human_only',
            autonomy_level: binding.autonomy_level,
            requires_human_approval: true,
            reasons: ['autonomy_level_human_only']
        };
    }
    if (binding.autonomy_level === 'approval_required') {
        return {
            status: 'needs_approval',
            autonomy_level: binding.autonomy_level,
            requires_human_approval: true,
            reasons: ['autonomy_level_approval_required']
        };
    }
    return {
        status: 'eligible',
        autonomy_level: binding.autonomy_level,
        requires_human_approval: binding.autonomy_level === 'draft_only',
        reasons: binding.autonomy_level === 'draft_only' ? ['draft_output_only'] : []
    };
}

function createMeetingIdentityFromCalendarEvent(event, { account = null } = {}) {
    return {
        source: 'google_calendar',
        account: event.account || account || null,
        calendar_id: event.calendarId || null,
        event_id: event.calendarEventId || event.id || null,
        event_uid: event.iCalUID || null,
        title: event.title || '(無題)',
        start: event.startDateTime || null,
        end: event.endDateTime || null,
        all_day: Boolean(event.allDay),
        attendees: Array.isArray(event.attendees) ? event.attendees : [],
        organizer: event.organizer || null,
        conference_url: event.conferenceUrl || null,
        location: event.location || null,
        html_link: event.htmlLink || null,
        description: event.description || null
    };
}

export function createBrainbaseAliveWorkflow({ projectId = 'general', ownerId = DEFAULT_OWNER_ID } = {}) {
    return {
        id: 'brainbase-alive',
        workspace_id: DEFAULT_WORKSPACE_ID,
        project_id: projectId,
        name: 'Brainbase Alive',
        description: 'Brainbase workflow runner and ledger smoke check',
        enabled: true,
        schedule: null,
        owner_id: ownerId,
        default_assignee_id: ownerId,
        default_approver_id: ownerId,
        execution_env: 'local',
        risk_level: 'low',
        hitl_policy: 'none',
        timeout_ms: 30000,
        implementation_key: 'brainbase-alive',
        context_sources: [{
            id: 'ctx-project',
            source_type: 'project',
            source_ref: projectId,
            scope: 'project',
            permission: 'read',
            required: true,
            preview: 'Project association smoke context'
        }]
    };
}

export function createDefaultWorkflowHandlers({ clock = () => new Date() } = {}) {
    return {
        'brainbase-alive': async (ctx) => ({
            status: 'success',
            closureState: 'closed',
            actionRequired: 'none',
            outputCount: 1,
            message: `Brainbase alive. env=${ctx.env}`,
            data: {
                checkedAt: clock().toISOString(),
                workspaceId: ctx.workspaceId,
                projectId: ctx.projectId,
                workflowId: ctx.workflowId,
                runId: ctx.runId
            }
        }),
        'manual-placeholder': async (ctx, workflow) => ({
            status: 'success',
            closureState: 'closed',
            actionRequired: 'none',
            outputCount: 1,
            message: ctx.humanStepResolution
                ? `${workflow.name} resumed after human step ${ctx.humanStepResolution.resolution}`
                : `${workflow.name} recorded`,
            data: {
                workflowId: ctx.workflowId,
                projectId: ctx.projectId,
                humanStepResolution: ctx.humanStepResolution || null,
                recordedAt: clock().toISOString()
            }
        }),
        [MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY]: async () => {
            throw AppError.validation('meeting-review-package-ingest must be executed through review-ingest API');
        }
    };
}

function assertWorkflowRunAllowed(workflow) {
    if (workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY) {
        throw AppError.validation('meeting-review-package-ingest workflows cannot be manually run; use /api/workflows/control/meeting-pack/review-ingest');
    }
    if (workflow?.implementation_key === EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY) {
        throw AppError.validation('eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session');
    }
}

function isMeetingReviewPackageWorkflow(workflow) {
    return workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY;
}

function isApprovedHumanResolution(status) {
    return ['approved', 'approve'].includes(String(status || '').toLowerCase());
}

function isPendingHumanStepStatus(status) {
    return String(status || '').toLowerCase() === 'pending';
}

function isRejectedHumanStepStatus(status) {
    return ['rejected', 'reject', 'cancelled', 'canceled', 'declined'].includes(String(status || '').toLowerCase());
}

function normalizeWorkflowInput(input, { projectId, ownerId, assigneeId, approverId } = {}) {
    const id = input.id || `wf_${crypto.randomUUID()}`;
    const effectiveOwnerId = ownerId || input.owner_id || DEFAULT_OWNER_ID;
    const effectiveAssigneeId = assigneeId || input.default_assignee_id || effectiveOwnerId;
    const effectiveApproverId = approverId || input.default_approver_id || effectiveOwnerId;
    return {
        id,
        workspace_id: input.workspace_id || DEFAULT_WORKSPACE_ID,
        project_id: input.project_id || projectId,
        name: input.name || id,
        description: input.description || '',
        enabled: input.enabled !== false,
        schedule: input.schedule || null,
        owner_id: effectiveOwnerId,
        default_assignee_id: effectiveAssigneeId,
        default_approver_id: effectiveApproverId,
        execution_env: input.execution_env || input.executionMode || 'local',
        risk_level: input.risk_level || input.riskLevel || 'low',
        hitl_policy: input.hitl_policy || input.hitlPolicy || 'none',
        timeout_ms: input.timeout_ms || input.timeoutMs || 300000,
        implementation_key: input.implementation_key || input.implementationKey || 'manual-placeholder',
        context_sources: Array.isArray(input.context_sources)
            ? input.context_sources
            : (Array.isArray(input.contextSources) ? input.contextSources : [])
    };
}

export class WorkflowService {
    constructor({ repository, runner, configParser, googleCalendarService = null, eveSessionClient = null, infoSSOTService = null }) {
        this.repository = repository;
        this.runner = runner;
        this.configParser = configParser;
        this.googleCalendarService = googleCalendarService;
        this.eveSessionClient = eveSessionClient;
        this.infoSSOTService = infoSSOTService;
        this.projectConfigById = new Map();
        this.eveSessionDispatchInFlight = new Map();
    }

    async ensureDefaultWorkflows() {
        if (!this.repository.getWorkflow('brainbase-alive')) {
            this.repository.upsertWorkflow(createBrainbaseAliveWorkflow());
        }
    }

    async listWorkflows({ projectId = null } = {}, actor = {}) {
        await this.ensureDefaultWorkflows();
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);
        const workflows = this.repository.listWorkflows()
            .filter((workflow) => !projectId || workflow.project_id === projectId)
            .filter((workflow) => this._actorCanAccessProject(workflow.project_id, actor))
            .map((workflow) => ({
                ...workflow,
                latest_run: this.repository.listRuns({ workflowId: workflow.id, limit: 1 })[0] || null
            }))
            .map((workflow) => ({
                ...workflow,
                latest_context_snapshots: workflow.latest_run
                    ? this.repository.listContextSnapshots(workflow.latest_run.id)
                    : [],
                latest_human_steps: workflow.latest_run
                    ? this.repository.listHumanSteps(workflow.latest_run.id)
                    : []
            }))
            .sort((a, b) => {
                const priority = workflowPriority(a) - workflowPriority(b);
                if (priority !== 0) return priority;
                const aTime = a.latest_run?.finished_at || a.latest_run?.started_at || a.latest_run?.created_at || a.updated_at || '';
                const bTime = b.latest_run?.finished_at || b.latest_run?.started_at || b.latest_run?.created_at || b.updated_at || '';
                return String(bTime).localeCompare(String(aTime));
            });
        return { workflows };
    }

    async getWorkflow(workflowId, actor = {}) {
        await this.ensureDefaultWorkflows();
        await this._loadProjectConfigCache();
        const workflow = this.repository.getWorkflow(workflowId);
        if (!workflow) throw AppError.notFound('workflow', workflowId);
        this._assertActorCanAccessProject(workflow.project_id, actor);
        return {
            workflow,
            context_sources: this.repository.listWorkflowContextSources(workflowId),
            runs: this.repository.listRuns({ workflowId, limit: 20 })
        };
    }

    async createWorkflow(input, actor = {}) {
        const projectId = input.project_id || input.projectId;
        if (!projectId) throw AppError.validation('project_id is required');
        await this._assertProjectSelectable(projectId);
        this._assertActorCanAccessProject(projectId, actor);
        if (input.id && this.repository.getWorkflow(input.id)) {
            throw AppError.conflict(`workflow '${input.id}' already exists`);
        }
        const workflow = normalizeWorkflowInput(input, {
            projectId,
            ownerId: actor.person_id || actor.sub || DEFAULT_OWNER_ID,
            assigneeId: actor.person_id || actor.sub || DEFAULT_OWNER_ID,
            approverId: actor.person_id || actor.sub || DEFAULT_OWNER_ID
        });
        const created = this.repository.upsertWorkflow(workflow);
        this.repository.writeAuditLog({
            workspace_id: created.workspace_id,
            project_id: created.project_id,
            actor_id: actor.person_id || actor.sub || 'system',
            action: 'workflow.created',
            target_type: 'workflow',
            target_id: created.id,
            after: created
        });
        return { workflow: created };
    }

    async listRoleAgentInstances({ orgId = null, projectId = null, roleArchetypeId = null } = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);
        return {
            role_agent_instances: this.repository.listRoleAgentInstances({ orgId, projectId, roleArchetypeId })
                .filter((agent) => this._actorCanAccessProject(agent.project_id, actor))
        };
    }

    async createRoleAgentInstance(input, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);
        const roleArchetypeId = requireInputString(input, 'role_archetype_id', 'roleArchetypeId');
        const id = readOptionalString(input, 'id') || createStableId('rai', orgId, projectId, roleArchetypeId);
        const agent = this.repository.upsertRoleAgentInstance({
            id,
            workspace_id: input.workspace_id || DEFAULT_WORKSPACE_ID,
            org_id: orgId,
            project_id: projectId,
            role_archetype_id: roleArchetypeId,
            name: readOptionalString(input, 'name') || `${orgId} ${roleArchetypeId} agent`,
            description: readOptionalString(input, 'description') || '',
            owner_id: readOptionalString(input, 'owner_id', 'ownerId') || actor.person_id || actor.sub || DEFAULT_OWNER_ID,
            default_approver_id: readOptionalString(input, 'default_approver_id', 'defaultApproverId') || actor.person_id || actor.sub || DEFAULT_OWNER_ID,
            context_policy: input.context_policy || input.contextPolicy || {},
            tool_scope: input.tool_scope || input.toolScope || {},
            workflow_constraints: input.workflow_constraints || input.workflowConstraints || {},
            tags: normalizeTags(input.tags),
            enabled: input.enabled !== false
        });
        this._writeWorkflowControlAudit({
            item: agent,
            actor,
            action: 'workflow.role_agent_instance.upserted',
            targetType: 'role_agent_instance'
        });
        return { role_agent_instance: agent };
    }

    async listWorkflowTemplates({ orgId = null, projectId = null, workflowKind = null } = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);
        return {
            workflow_templates: this.repository.listWorkflowTemplates({ orgId, projectId, workflowKind })
                .filter((template) => this._actorCanAccessWorkflowTemplate(template, actor))
        };
    }

    async createWorkflowTemplate(input, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = readOptionalString(input, 'org_id', 'orgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId');
        if (projectId) {
            await this._assertProjectSelectable(projectId);
            this._assertActorCanAccessProject(projectId, actor);
        } else if (!this._actorCanManageGlobalWorkflowTemplate(actor)) {
            throw AppError.forbidden('project_id is required for workflow_template creation');
        }
        if (orgId) this._assertOrgReferenceAllowed(orgId);
        const id = readOptionalString(input, 'id') || createStableId('wft', orgId, projectId, readString(input, 'name'));
        const template = this.repository.upsertWorkflowTemplate({
            id,
            workspace_id: input.workspace_id || DEFAULT_WORKSPACE_ID,
            org_id: orgId,
            project_id: projectId,
            name: requireInputString(input, 'name'),
            description: readOptionalString(input, 'description') || '',
            workflow_kind: readOptionalString(input, 'workflow_kind', 'workflowKind') || 'operational',
            judgment_dag_id: readOptionalString(input, 'judgment_dag_id', 'judgmentDagId'),
            spec_ref: readOptionalString(input, 'spec_ref', 'specRef'),
            task_schema: input.task_schema || input.taskSchema || {},
            output_schema: input.output_schema || input.outputSchema || {},
            tags: normalizeTags(input.tags),
            enabled: input.enabled !== false
        });
        this._writeWorkflowControlAudit({
            item: template,
            actor,
            action: 'workflow.template.upserted',
            targetType: 'workflow_template'
        });
        return { workflow_template: template };
    }

    async listWorkflowBindings({ orgId = null, projectId = null, roleAgentInstanceId = null } = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);
        return {
            workflow_bindings: this.repository.listWorkflowBindings({ orgId, projectId, roleAgentInstanceId })
                .filter((binding) => this._actorCanAccessProject(binding.project_id, actor))
        };
    }

    async createWorkflowBinding(input, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);
        const roleAgentInstanceId = requireInputString(input, 'role_agent_instance_id', 'roleAgentInstanceId');
        const workflowTemplateId = requireInputString(input, 'workflow_template_id', 'workflowTemplateId');
        const roleAgent = this.repository.getRoleAgentInstance(roleAgentInstanceId);
        if (!roleAgent) throw AppError.notFound('role_agent_instance', roleAgentInstanceId);
        if (roleAgent.org_id !== orgId) {
            throw AppError.validation(`role_agent_instance '${roleAgentInstanceId}' belongs to org '${roleAgent.org_id}'`);
        }
        if (roleAgent.project_id !== projectId) {
            throw AppError.validation(`role_agent_instance '${roleAgentInstanceId}' belongs to project '${roleAgent.project_id}'`);
        }
        this._assertActorCanAccessProject(roleAgent.project_id, actor);
        const template = this.repository.getWorkflowTemplate(workflowTemplateId);
        if (!template) throw AppError.notFound('workflow_template', workflowTemplateId);
        if (template.org_id && template.org_id !== orgId) {
            throw AppError.validation(`workflow_template '${workflowTemplateId}' belongs to org '${template.org_id}'`);
        }
        if (template.project_id && template.project_id !== projectId) {
            throw AppError.validation(`workflow_template '${workflowTemplateId}' belongs to project '${template.project_id}'`);
        }
        if (template.project_id) this._assertActorCanAccessProject(template.project_id, actor);
        const autonomyLevel = readOptionalString(input, 'autonomy_level', 'autonomyLevel') || 'approval_required';
        ensureAllowed(autonomyLevel, ALLOWED_AUTONOMY_LEVELS, 'autonomy_level');
        const id = readOptionalString(input, 'id') || createStableId('wfb', orgId, roleAgentInstanceId, workflowTemplateId);
        const binding = this.repository.upsertWorkflowBinding({
            id,
            workspace_id: input.workspace_id || DEFAULT_WORKSPACE_ID,
            org_id: orgId,
            project_id: projectId,
            role_agent_instance_id: roleAgentInstanceId,
            workflow_template_id: workflowTemplateId,
            workflow_id: readOptionalString(input, 'workflow_id', 'workflowId'),
            name: readOptionalString(input, 'name') || `${roleAgent.name} -> ${template.name}`,
            workflow_selection_reason: readOptionalString(input, 'workflow_selection_reason', 'workflowSelectionReason'),
            judgment_dag_id: readOptionalString(input, 'judgment_dag_id', 'judgmentDagId') || template.judgment_dag_id || null,
            autonomy_level: autonomyLevel,
            stop_conditions: readStrictStringList(input, 'stop_conditions', 'stopConditions'),
            approval_owner_id: readOptionalString(input, 'approval_owner_id', 'approvalOwnerId') || roleAgent.default_approver_id,
            cost_owner_id: readOptionalString(input, 'cost_owner_id', 'costOwnerId') || roleAgent.owner_id,
            enabled: input.enabled !== false
        });
        this._writeWorkflowControlAudit({
            item: binding,
            actor,
            action: 'workflow.binding.upserted',
            targetType: 'workflow_binding'
        });
        return { workflow_binding: binding };
    }

    async listWorkflowTriggers({ orgId = null, projectId = null, workflowBindingId = null, triggerType = null } = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);
        return {
            workflow_triggers: this.repository.listWorkflowTriggers({ orgId, projectId, workflowBindingId, triggerType })
                .filter((trigger) => this._actorCanAccessProject(trigger.project_id, actor))
        };
    }

    async createWorkflowTrigger(input, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);
        const workflowBindingId = requireInputString(input, 'workflow_binding_id', 'workflowBindingId');
        const binding = this.repository.getWorkflowBinding(workflowBindingId);
        if (!binding) throw AppError.notFound('workflow_binding', workflowBindingId);
        if (binding.org_id !== orgId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to org '${binding.org_id}'`);
        }
        if (binding.project_id !== projectId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to project '${binding.project_id}'`);
        }
        this._assertActorCanAccessProject(binding.project_id, actor);
        const triggerType = readOptionalString(input, 'trigger_type', 'triggerType') || 'human';
        ensureAllowed(triggerType, ALLOWED_TRIGGER_TYPES, 'trigger_type');
        const id = readOptionalString(input, 'id') || createStableId('wftg', orgId, workflowBindingId, triggerType, readString(input, 'name'));
        const trigger = this.repository.upsertWorkflowTrigger({
            id,
            workspace_id: input.workspace_id || DEFAULT_WORKSPACE_ID,
            org_id: orgId,
            project_id: projectId,
            workflow_binding_id: workflowBindingId,
            trigger_type: triggerType,
            name: readOptionalString(input, 'name') || `${triggerType} trigger`,
            event_source: readOptionalString(input, 'event_source', 'eventSource'),
            schedule: input.schedule || null,
            human_prompt_ref: readOptionalString(input, 'human_prompt_ref', 'humanPromptRef'),
            enabled: input.enabled !== false
        });
        this._writeWorkflowControlAudit({
            item: trigger,
            actor,
            action: 'workflow.trigger.upserted',
            targetType: 'workflow_trigger'
        });
        return { workflow_trigger: trigger };
    }

    async listLoopIntents({ orgId = null, projectId = null, workflowBindingId = null, triggerId = null } = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);
        return {
            loop_intents: this.repository.listLoopIntents({ orgId, projectId, workflowBindingId, triggerId })
                .filter((intent) => this._actorCanAccessProject(intent.project_id, actor))
                .map((intent) => redactLoopIntentForResponse(intent))
        };
    }

    async createLoopIntent(input, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);
        const workflowBindingId = requireInputString(input, 'workflow_binding_id', 'workflowBindingId');
        const binding = this.repository.getWorkflowBinding(workflowBindingId);
        if (!binding) throw AppError.notFound('workflow_binding', workflowBindingId);
        if (binding.org_id !== orgId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to org '${binding.org_id}'`);
        }
        if (binding.project_id !== projectId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to project '${binding.project_id}'`);
        }
        this._assertActorCanAccessProject(binding.project_id, actor);
        const triggerId = readOptionalString(input, 'trigger_id', 'triggerId');
        const trigger = triggerId ? this.repository.getWorkflowTrigger(triggerId) : null;
        if (triggerId && !trigger) throw AppError.notFound('workflow_trigger', triggerId);
        if (trigger && trigger.org_id !== orgId) {
            throw AppError.validation(`workflow_trigger '${triggerId}' belongs to org '${trigger.org_id}'`);
        }
        if (trigger && trigger.project_id !== projectId) {
            throw AppError.validation(`workflow_trigger '${triggerId}' belongs to project '${trigger.project_id}'`);
        }
        if (trigger && trigger.workflow_binding_id !== workflowBindingId) {
            throw AppError.validation(`workflow_trigger '${triggerId}' belongs to binding '${trigger.workflow_binding_id}'`);
        }
        const triggerType = trigger?.trigger_type || readOptionalString(input, 'trigger_type', 'triggerType') || 'human';
        ensureAllowed(triggerType, ALLOWED_TRIGGER_TYPES, 'trigger_type');
        const eligibility = eligibilityFrom({ binding, trigger, input });
        const id = readOptionalString(input, 'id') || createStableId('loop', orgId, workflowBindingId, triggerId || 'manual', crypto.randomUUID());
        const intent = this.repository.upsertLoopIntent({
            id,
            workspace_id: input.workspace_id || DEFAULT_WORKSPACE_ID,
            org_id: orgId,
            project_id: projectId,
            role_agent_instance_id: binding.role_agent_instance_id,
            workflow_template_id: binding.workflow_template_id,
            workflow_binding_id: workflowBindingId,
            workflow_trigger_id: triggerId,
            trigger_id: triggerId,
            trigger_type: triggerType,
            requested_by: actor.person_id || actor.sub || readOptionalString(input, 'requested_by', 'requestedBy') || 'system',
            input_ref: readOptionalString(input, 'input_ref', 'inputRef'),
            input_summary: readOptionalString(input, 'input_summary', 'inputSummary'),
            input_payload: readOptionalJsonValue(input, 'input_payload', 'inputPayload'),
            eligibility,
            selected_workflow_reason: binding.workflow_selection_reason || readOptionalString(input, 'selected_workflow_reason', 'selectedWorkflowReason'),
            judgment_dag_id: binding.judgment_dag_id || null,
            status: eligibility.status === 'blocked' || eligibility.status === 'human_only' ? eligibility.status : 'ready'
        });
        this._writeWorkflowControlAudit({
            item: intent,
            actor,
            action: 'workflow.loop_intent.created',
            targetType: 'loop_intent'
        });
        return { loop_intent: intent };
    }

    async _prepareMeetingWorkflowPackRecords(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);
        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const records = buildMeetingWorkflowPackRecords({
            orgId,
            projectId,
            actorId,
            seedLoopIntents: input.seed_loop_intents !== false && input.seedLoopIntents !== false
        });
        return { orgId, projectId, actorId, records };
    }

    async reviewMeetingWorkflowPackDesign(input = {}, actor = {}) {
        const { orgId, projectId, records } = await this._prepareMeetingWorkflowPackRecords(input, actor);
        return {
            meeting_workflow_pack_design: {
                pack_id: records.pack_id,
                org_id: orgId,
                project_id: projectId,
                loop_pack_manifest: records.loop_pack_manifest,
                loop_pack_design_review: records.loop_pack_design_review
            }
        };
    }

    async bootstrapMeetingWorkflowPack(input = {}, actor = {}) {
        const { orgId, projectId, actorId, records } = await this._prepareMeetingWorkflowPackRecords(input, actor);
        if (records.loop_pack_design_review.status !== 'pass') {
            throw AppError.validation('loop pack design gate did not pass', {
                loop_pack_design_review: records.loop_pack_design_review
            });
        }

        const result = await this.repository.transaction(async () => {
            const roleAgent = this.repository.upsertRoleAgentInstance(records.role_agent_instance);
            const templates = records.workflow_templates.map((template) => this.repository.upsertWorkflowTemplate(template));
            const bindings = records.workflow_bindings.map((binding) => this.repository.upsertWorkflowBinding(binding));
            const triggers = records.workflow_triggers.map((trigger) => this.repository.upsertWorkflowTrigger(trigger));
            const loopIntents = records.loop_intents.map((intent) => this.repository.upsertLoopIntent(intent));
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_pack.bootstrapped',
                target_type: 'meeting_workflow_pack',
                target_id: records.pack_id,
                after: {
                    org_id: orgId,
                    project_id: projectId,
                    role_agent_instance_id: roleAgent.id,
                    workflow_template_ids: templates.map((template) => template.id),
                    workflow_binding_ids: bindings.map((binding) => binding.id),
                    workflow_trigger_ids: triggers.map((trigger) => trigger.id),
                    loop_intent_ids: loopIntents.map((intent) => intent.id),
                    loop_pack_design_review: {
                        gate_id: records.loop_pack_design_review.gate_id,
                        status: records.loop_pack_design_review.status,
                        manifest_digest: records.loop_pack_design_review.manifest_digest,
                        issues: records.loop_pack_design_review.issues,
                        rubric: records.loop_pack_design_review.rubric
                    }
                }
            });
            return {
                loop_pack_design_review: records.loop_pack_design_review,
                meeting_workflow_pack: {
                    pack_id: records.pack_id,
                    org_id: orgId,
                    project_id: projectId,
                    role_agent_instance: roleAgent,
                    workflow_templates: templates,
                    workflow_bindings: bindings,
                    workflow_triggers: triggers,
                    loop_intents: loopIntents
                }
            };
        });
        return result;
    }

    async createMeetingPackCalendarLoopIntents(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (!this.googleCalendarService) {
            throw AppError.validation('google_calendar_service is not configured');
        }
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        const from = requireInputString(input, 'from');
        const to = requireInputString(input, 'to');
        const account = readOptionalString(input, 'account');
        const calendarIds = readStringList(input, 'calendar_ids', 'calendarIds');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);

        const authStatus = !account && typeof this.googleCalendarService.getAuthStatus === 'function'
            ? await this.googleCalendarService.getAuthStatus()
            : null;
        if (authStatus && !authStatus.connected) {
            throw AppError.validation(`google calendar is not connected: ${authStatus.reason || 'unknown'}`, {
                skipped_events: [
                    {
                        calendar_id: null,
                        reason: authStatus.reason || 'google_calendar_not_connected',
                        message: authStatus.reason || null
                    }
                ],
                state_transitions: MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS
            });
        }

        const workflowDefinitionId = 'pre-meeting-briefing';
        const definition = MEETING_WORKFLOW_DEFINITIONS.find((candidate) => candidate.id === workflowDefinitionId);
        if (!definition) throw AppError.validation(`meeting workflow definition '${workflowDefinitionId}' is not configured`);

        const diagnostics = typeof this.googleCalendarService.listEventsWithDiagnostics === 'function'
            ? await this.googleCalendarService.listEventsWithDiagnostics({
                from,
                to,
                account,
                calendarIds: calendarIds.length > 0 ? calendarIds : null
            })
            : {
                events: await this.googleCalendarService.listEvents({
                    from,
                    to,
                    account,
                    calendarIds: calendarIds.length > 0 ? calendarIds : null
                }),
                skippedCalendars: []
            };
        const events = Array.isArray(diagnostics.events) ? diagnostics.events : [];
        const skippedEvents = Array.isArray(diagnostics.skippedCalendars)
            ? diagnostics.skippedCalendars.map((calendar) => ({
                calendar_id: calendar.calendar_id || null,
                reason: calendar.reason || 'calendar_fetch_failed',
                message: calendar.message || null
            }))
            : [];

        if (events.length === 0 && skippedEvents.length > 0) {
            throw AppError.validation(`google calendar is not connected: ${skippedEvents[0].reason || 'calendar_fetch_failed'}`, {
                skipped_events: skippedEvents,
                state_transitions: MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS
            });
        }

        return this.repository.transaction(async () => {
            await this.bootstrapMeetingWorkflowPack({
                org_id: orgId,
                project_id: projectId,
                seed_loop_intents: false
            }, actor);

            const ids = meetingPackIds({
                orgId,
                projectId,
                definitionId: workflowDefinitionId,
                triggerType: 'schedule'
            });
            const loopIntents = [];
            const effectiveAccount = account || authStatus?.defaultAccount || null;

            const ingestionInput = {
                from,
                to,
                account,
                calendarIds: calendarIds.length > 0 ? calendarIds : null
            };

            for (const event of events) {
                if (event?.allDay) {
                    skippedEvents.push({
                        event_id: event.calendarEventId || event.id || null,
                        title: event.title || null,
                        reason: 'all_day_event'
                    });
                    continue;
                }

                const meetingIdentity = createMeetingIdentityFromCalendarEvent(event, { account: effectiveAccount });
                const eventStableRef = meetingIdentity.event_id || event.id || `${meetingIdentity.title}:${meetingIdentity.start}`;
                const loopIntentId = createStableId(
                    'loop',
                    orgId,
                    projectId,
                    workflowDefinitionId,
                    'gcal',
                    meetingIdentity.calendar_id,
                    eventStableRef,
                    meetingIdentity.start
                );
                const result = await this.createLoopIntent({
                    id: loopIntentId,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_binding_id: ids.bindingId,
                    trigger_id: ids.triggerId,
                    input_ref: `google-calendar:${effectiveAccount || 'default'}:${meetingIdentity.calendar_id || 'default'}:${eventStableRef}`,
                    input_summary: `${meetingIdentity.title} ${meetingIdentity.start || ''}`.trim(),
                    input_payload: {
                        meeting_identity: meetingIdentity,
                        workflow_definition_id: workflowDefinitionId,
                        requested_output: definition.output_contract,
                        write_back_target: definition.write_back_target,
                        source: 'google_calendar'
                    }
                }, actor);
                loopIntents.push(result.loop_intent);
            }

            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                project_id: projectId,
                actor_id: actor.person_id || actor.sub || 'system',
                action: 'workflow.meeting_pack.calendar_inputs.ingested',
                target_type: 'meeting_workflow_pack',
                target_id: 'mana-meeting-workflow-pack-v1',
                after: {
                    org_id: orgId,
                    project_id: projectId,
                    from,
                    to,
                    account: effectiveAccount,
                    calendar_ids: calendarIds,
                    ingestion_input: ingestionInput,
                    events_considered: events.length,
                    loop_intent_ids: loopIntents.map((intent) => intent.id),
                    skipped_events: skippedEvents,
                    state_transitions: MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS
                }
            });

            return {
                meeting_calendar_inputs: {
                    org_id: orgId,
                    project_id: projectId,
                    workflow_definition_id: workflowDefinitionId,
                    from,
                    to,
                    account: effectiveAccount,
                    calendar_ids: calendarIds,
                    events_considered: events.length,
                    loop_intents: loopIntents,
                    skipped_events: skippedEvents,
                    state_transitions: MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS
                }
            };
        });
    }

    async resolveMeetingReviewTaskOwnersFromSSOT(reviewPackage, { actor = {}, projectId = null } = {}) {
        if (!this.infoSSOTService?.listGraphEntities || !Array.isArray(reviewPackage?.task_candidates)) {
            return reviewPackage;
        }

        const access = taskOwnerAccessFromActor(actor, projectId);
        const cache = new Map();
        const taskCandidates = [];

        for (const candidate of reviewPackage.task_candidates) {
            taskCandidates.push(await this.resolveMeetingReviewTaskOwnerCandidate(candidate, {
                access,
                projectId,
                cache
            }));
        }

        return {
            ...reviewPackage,
            task_candidates: taskCandidates
        };
    }

    async resolveMeetingPackGraphSSOTPlaybook({
        actor = {},
        orgId,
        projectId,
        caseScope = null,
        packageId,
        sourceEvent = {},
        evidenceRefs = [],
        meetingIdentity = {},
        projectResolution
    } = {}) {
        const access = taskOwnerAccessFromActor(actor, projectId);
        let graphContext = null;
        let graphStatus = 'unavailable';
        let graphError = null;

        if (this.infoSSOTService?.getContext) {
            try {
                graphContext = await this.infoSSOTService.getContext(access, {
                    projectCode: projectId,
                    entityTypes: MEETING_PACK_GRAPH_SSOT_ENTITY_TYPES.join(','),
                    limit: 80,
                    humanReadable: false,
                    includeEdges: true,
                    includePhilosophy: false,
                    scope: caseScope || 'meeting_pack'
                });
                graphStatus = 'resolved';
            } catch (error) {
                graphStatus = 'unavailable';
                graphError = error?.message || 'graph_ssot_context_lookup_failed';
                graphContext = null;
            }
        } else {
            graphError = 'info_ssot_get_context_not_available';
        }

        const graphPlaybook = buildMeetingPackGraphPlaybook({
            orgId,
            projectId,
            caseScope,
            packageId,
            sourceEvent,
            evidenceRefs,
            projectResolution,
            graphContext,
            graphStatus,
            graphError
        });

        return {
            graph_context: graphContext,
            graph_playbook: graphPlaybook,
            snapshot_data: graphContextSnapshotData({
                meetingIdentity,
                graphContext,
                graphPlaybook
            }),
            item_count: graphContextSnapshotItemCount({
                meetingIdentity,
                graphContext,
                graphPlaybook
            })
        };
    }

    async resolveMeetingReviewTaskOwnerCandidate(candidate, { access, projectId, cache }) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
        if (candidate.selected_owner_id || candidate.selectedOwnerId) {
            const selectedOwnerId = candidate.selected_owner_id || candidate.selectedOwnerId;
            const lookup = await this.lookupTaskOwnerPeopleSSOT({
                access,
                projectId,
                ids: [selectedOwnerId],
                cache
            });
            const selectedPerson = lookup.people?.find((person) => person.person_id === selectedOwnerId);
            if (lookup.status === 'ok' && selectedPerson) {
                return {
                    ...candidate,
                    selected_owner_id: selectedPerson.person_id,
                    selected_owner: candidate.selected_owner || candidate.selectedOwner || selectedPerson.display_name,
                    owner_candidates: [taskOwnerCandidatePayload(selectedPerson, selectedOwnerId, projectId)],
                    owner_resolution: {
                        source: 'graph_ssot',
                        status: 'already_selected',
                        reason: 'selected_owner_id_verified_in_people_ssot'
                    }
                };
            }

            const {
                selected_owner_id: _selectedOwnerId,
                selectedOwnerId: _selectedOwnerIdCamel,
                selected_owner: _selectedOwner,
                selectedOwner: _selectedOwnerCamel,
                ...candidateWithoutUnverifiedOwner
            } = candidate;

            return {
                ...candidateWithoutUnverifiedOwner,
                owner_candidates: lookup.people?.map((person) => taskOwnerCandidatePayload(person, selectedOwnerId, projectId)) || [],
                owner_resolution: {
                    source: 'graph_ssot',
                    status: 'unresolved',
                    reason: lookup.status === 'unavailable'
                        ? 'people_ssot_unavailable'
                        : 'selected_owner_id_not_found_in_people_ssot'
                }
            };
        }

        const ownerHint = taskCandidateOwnerHint(candidate);
        if (!ownerHint) return candidate;

        if (isSpeakerOwnerHint(ownerHint)) {
            return {
                ...candidate,
                owner_resolution: {
                    source: 'graph_ssot',
                    status: 'ignored',
                    reason: 'speaker_label_is_not_people_ssot'
                }
            };
        }

        const queries = ownerHintSearchQueries(ownerHint);
        if (!queries.length) return candidate;

        const lookup = await this.lookupTaskOwnerPeopleSSOT({
            access,
            projectId,
            queries,
            cache
        });
        if (lookup.status === 'unavailable') {
            return {
                ...candidate,
                owner_resolution: {
                    source: 'graph_ssot',
                    status: 'unresolved',
                    reason: 'people_ssot_unavailable'
                }
            };
        }

        const ownerCandidates = sortTaskOwnerCandidates(
            lookup.people.map((person) => taskOwnerCandidatePayload(person, ownerHint, projectId))
        );
        const selectedCandidate = confidentlySelectedTaskOwnerCandidate(ownerCandidates);
        if (selectedCandidate) {
            return {
                ...candidate,
                selected_owner_id: selectedCandidate.person_id,
                selected_owner: selectedCandidate.display_name,
                owner_candidates: ownerCandidates,
                owner_resolution: {
                    source: 'graph_ssot',
                    status: 'resolved',
                    confidence: selectedCandidate.match === 'exact_name_or_alias' ? 1 : 0.9,
                    reason: ownerCandidates.length === 1 && selectedCandidate.match === 'exact_name_or_alias'
                        ? 'unique_exact_name_or_alias'
                        : 'context_ranked_owner_hint'
                }
            };
        }

        return {
            ...candidate,
            owner_candidates: ownerCandidates,
            owner_resolution: {
                source: 'graph_ssot',
                status: ownerCandidates.length > 1 ? 'ambiguous' : 'unresolved',
                reason: ownerCandidates.length > 1 ? 'ambiguous_people_ssot_candidate' : 'no_people_ssot_candidate'
            }
        };
    }

    async lookupTaskOwnerPeopleSSOT({ access, projectId, query = null, queries = null, ids = null, cache }) {
        const searchQueries = Array.isArray(queries) && queries.length ? queries : [query].filter(Boolean);
        const searchIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
        const cacheKey = `${projectId || ''}:q:${searchQueries.join('|')}:id:${searchIds.join('|')}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        try {
            const recordsByKey = new Map();
            for (const id of searchIds) {
                const records = await this.infoSSOTService.listGraphEntities(access, {
                    projectCode: projectId,
                    entityType: 'person',
                    id,
                    limit: 1
                });
                for (const record of records) {
                    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
                    const key = record?.id || record?.entity_id || payload.person_id || payload.id || JSON.stringify(record);
                    if (!recordsByKey.has(key)) recordsByKey.set(key, record);
                }
            }
            for (const searchQuery of searchQueries) {
                const records = await this.infoSSOTService.listGraphEntities(access, {
                    projectCode: projectId,
                    entityType: 'person',
                    query: searchQuery,
                    limit: 20
                });
                for (const record of records) {
                    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
                    const key = record?.id || record?.entity_id || payload.person_id || payload.id || JSON.stringify(record);
                    if (!recordsByKey.has(key)) recordsByKey.set(key, record);
                }
            }
            const people = Array.from(recordsByKey.values())
                .map(normalizeTaskOwnerPerson)
                .filter(Boolean);
            const result = { status: 'ok', people };
            cache.set(cacheKey, result);
            return result;
        } catch {
            const result = { status: 'unavailable', people: [] };
            cache.set(cacheKey, result);
            return result;
        }
    }

    async ingestMeetingReviewPackage(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const reviewPackage = readReviewPackage(input);
        const packageId = readOptionalString(reviewPackage, 'package_id', 'packageId');
        const meetingIdentity = reviewPackage.meeting_identity && typeof reviewPackage.meeting_identity === 'object'
            ? reviewPackage.meeting_identity
            : {};
        const sourceEvent = reviewPackage.source_event && typeof reviewPackage.source_event === 'object'
            ? reviewPackage.source_event
            : {};
        const evidenceRefs = normalizeTags(reviewPackage.evidence_refs || reviewPackage.evidenceRefs);
        const orgId = readOptionalString(input, 'org_id', 'orgId')
            || readOptionalString(reviewPackage, 'org_id', 'orgId')
            || readOptionalString(meetingIdentity, 'candidate_org_id', 'candidateOrgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId')
            || readOptionalString(reviewPackage, 'project_id', 'projectId')
            || readOptionalString(meetingIdentity, 'candidate_project_id', 'candidateProjectId');
        const caseScope = readOptionalString(input, 'case_scope', 'caseScope')
            || readOptionalString(reviewPackage, 'case_scope', 'caseScope')
            || readOptionalString(meetingIdentity, 'case_scope', 'caseScope');
        if (!packageId) {
            throw meetingReviewValidationError('review_package.package_id is required', 'blocked_invalid_review_package', {
                missing_package_keys: ['package_id']
            });
        }
        if (!orgId) {
            const blocker = buildMeetingPackPreIngestGraphPlaybook({
                input,
                reviewPackage,
                meetingIdentity,
                orgId,
                projectId,
                caseScope,
                packageId,
                sourceEvent,
                evidenceRefs,
                code: 'missing_project_candidate',
                message: 'org_id is required before project scoped Graph SSOT lookup'
            });
            throw meetingReviewValidationError('org_id is required', 'blocked_invalid_scope', {
                field: 'org_id',
                ...blocker
            });
        }
        if (!projectId) {
            const code = projectCandidateIdsFromMeetingIdentity(meetingIdentity).length > 1
                ? 'multiple_project_candidates'
                : 'missing_project_candidate';
            const blocker = buildMeetingPackPreIngestGraphPlaybook({
                input,
                reviewPackage,
                meetingIdentity,
                orgId,
                projectId,
                caseScope,
                packageId,
                sourceEvent,
                evidenceRefs,
                code,
                message: code === 'multiple_project_candidates'
                    ? 'multiple project candidates require human project selection before Graph SSOT lookup'
                    : 'project_id is required before project scoped Graph SSOT lookup'
            });
            throw meetingReviewValidationError('project_id is required', 'blocked_invalid_scope', {
                field: 'project_id',
                org_id: orgId,
                ...blocker
            });
        }
        try {
            await this._assertProjectSelectable(projectId);
            this._assertOrgReferenceAllowed(orgId);
            this._assertActorCanAccessProject(projectId, actor);
        } catch (error) {
            if (error?.statusCode === 400) {
                const blocker = buildMeetingPackPreIngestGraphPlaybook({
                    input,
                    reviewPackage,
                    meetingIdentity,
                    orgId,
                    projectId,
                    caseScope,
                    packageId,
                    sourceEvent,
                    evidenceRefs,
                    code: 'project_access_denied',
                    message: error.message
                });
                throw meetingReviewValidationError(error.message, 'blocked_invalid_scope', {
                    org_id: orgId,
                    project_id: projectId,
                    ...blocker
                });
            }
            throw error;
        }

        assertMeetingReviewPackageMapping(reviewPackage);
        const loopEntries = loopIntentEntries(reviewPackage.loop_intent_ids);
        const loopIntents = loopEntries.map(([key, loopIntentId]) => {
            const loopIntent = this.repository.getLoopIntent(loopIntentId);
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
        const loopIntentByKey = new Map(loopIntents.map((entry) => [entry.key, entry.loop_intent]));
        const workflowId = createMeetingReviewStableId('wf', orgId, projectId, 'meeting_review_package_ingest');
        const runId = createMeetingReviewStableId('run', orgId, projectId, packageId, 'meeting_review_package_ingest');
        const existingRun = this.repository.getRun(runId);
        if (existingRun) {
            return {
                meeting_review_ingest: {
                    org_id: orgId,
                    project_id: projectId,
                    case_scope: caseScope,
                    package_id: packageId,
                    idempotent: true,
                    state_transitions: ['package_received', 'scope_resolved', 'loop_intents_verified', 'idempotent_replay'],
                    run: existingRun,
                    outputs: this.repository.listOutputs(runId),
                    human_steps: this.repository.listHumanSteps(runId),
                    context_snapshots: this.repository.listContextSnapshots(runId),
                    loop_intents: loopIntents.map((entry) => entry.loop_intent)
                }
            };
        }

        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const now = new Date().toISOString();
        const stopConditions = normalizeTags(reviewPackage.stop_conditions || reviewPackage.stopConditions);
        const projectResolution = buildMeetingPackProjectResolution({
            input,
            reviewPackage,
            meetingIdentity,
            orgId,
            projectId,
            caseScope
        });
        const graphPlaybookContext = await this.resolveMeetingPackGraphSSOTPlaybook({
            actor,
            orgId,
            projectId,
            caseScope,
            packageId,
            sourceEvent,
            evidenceRefs,
            meetingIdentity,
            projectResolution
        });
        const reviewPackageWithPlaybook = attachGraphPlaybookToReviewPackage(
            reviewPackage,
            graphPlaybookContext.graph_playbook
        );
        const resolvedReviewPackage = await this.resolveMeetingReviewTaskOwnersFromSSOT(reviewPackageWithPlaybook, {
            actor,
            projectId
        });

        return this.repository.transaction(async () => {
            const workflow = this.repository.upsertWorkflow({
                id: workflowId,
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                name: 'Meeting Review Package Ingest',
                description: 'Codex生成Review PackageをWorkflow Mission Controlの承認待ちrunへ取り込む',
                owner_id: actorId,
                default_assignee_id: actorId,
                default_approver_id: actorId,
                execution_env: 'local',
                risk_level: 'medium',
                hitl_policy: 'none',
                timeout_ms: 300000,
                implementation_key: MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY,
                context_sources: [{
                    id: `${workflowId}_package`,
                    source_type: 'review_package',
                    source_ref: packageId,
                    scope: 'meeting',
                    permission: 'read',
                    required: true,
                    preview: `${meetingIdentity.title || packageId} Review Package`
                }]
            });
            const run = this.repository.createRun({
                id: runId,
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                workflow_id: workflowId,
                workflow_name: workflow.name,
                status: 'waiting_human',
                closure_state: 'open',
                trigger_type: 'event',
                env: 'local',
                dry_run: false,
                started_by: actorId,
                owner_id: actorId,
                assignee_id: actorId,
                approver_id: actorId,
                action_required: 'approve',
                human_waiting: true,
                output_count: MEETING_REVIEW_OUTPUT_DEFINITIONS.length,
                message: 'Meeting Review Package is waiting for human approval',
                started_at: now,
                finished_at: now,
                duration_ms: 0,
                metadata: {
                    package_id: packageId,
                    seed_id: reviewPackage.seed_id || null,
                    case_scope: caseScope,
                    meeting_identity: jsonClone(meetingIdentity),
                    source_event: jsonClone(sourceEvent),
                    project_resolution: jsonClone(projectResolution),
                    graph_context: jsonClone(graphPlaybookContext.snapshot_data),
                    graph_ssot_playbook: jsonClone(graphPlaybookContext.graph_playbook),
                    loop_intent_ids: jsonClone(reviewPackage.loop_intent_ids || {}),
                    evidence_refs: evidenceRefs,
                    stop_conditions: stopConditions,
                    runner: {
                        type: 'codex_generated_package',
                        eve_connected: false
                    }
                }
            });
            this.repository.createRunStep({
                id: createMeetingReviewStableId('step', runId, 'ingest_review_package'),
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                workflow_run_id: runId,
                step_key: 'ingest_review_package',
                step_name: 'Review Package Ingest',
                status: 'waiting_human',
                action_required: 'approve',
                output_count: MEETING_REVIEW_OUTPUT_DEFINITIONS.length,
                message: 'Review Package outputs recorded and waiting for Human Gate',
                started_at: now,
                finished_at: now
            });
            const contextSnapshots = [
                {
                    id: createMeetingReviewStableId('ctx', runId, 'meeting_identity'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'meeting_identity',
                    source_ref: sourceRefForMeetingIdentity(meetingIdentity),
                    source_version: meetingIdentity.start || null,
                    content_hash: meetingIdentity.event_id || meetingIdentity.event_uid || null,
                    item_count: Object.keys(meetingIdentity).length,
                    permission: 'read',
                    preview: meetingIdentity.title || packageId,
                    data: jsonClone(meetingIdentity)
                },
                {
                    id: createMeetingReviewStableId('ctx', runId, 'source_event'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'meeting_source',
                    source_ref: sourceRefForSourceEvent(sourceEvent),
                    source_version: sourceEvent.message_ts || sourceEvent.file_id || null,
                    content_hash: sourceEvent.local_artifact_sha256 || null,
                    item_count: Object.keys(sourceEvent).length,
                    permission: 'read',
                    preview: sourceEvent.channel_name || sourceEvent.file_id || packageId,
                    data: jsonClone(sourceEvent)
                },
                {
                    id: createMeetingReviewStableId('ctx', runId, 'graph_context'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'graph_ssot',
                    source_ref: `graph-context:${orgId}:${projectId}:${caseScope || packageId}`,
                    source_version: null,
                    content_hash: null,
                    item_count: graphPlaybookContext.item_count,
                    permission: 'read',
                    preview: graphPlaybookContext.graph_playbook.graph_context.status === 'resolved'
                        ? `Graph SSOT context resolved (${graphPlaybookContext.item_count} entities)`
                        : 'Graph SSOT context candidates with explicit fallback',
                    data: jsonClone(graphPlaybookContext.snapshot_data)
                },
                {
                    id: createMeetingReviewStableId('ctx', runId, 'review_package'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'review_package',
                    source_ref: packageId,
                    source_version: reviewPackage.schema_version || null,
                    content_hash: null,
                    item_count: MEETING_REVIEW_OUTPUT_DEFINITIONS.length,
                    permission: 'read',
                    preview: `${packageId} (${reviewPackage.status || 'unknown'})`,
                    data: {
                        schema_version: reviewPackage.schema_version || null,
                        status: reviewPackage.status || null,
                        seed_id: reviewPackage.seed_id || null
                    }
                }
            ].map((snapshot) => this.repository.createContextSnapshot(snapshot));
            const outputs = MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => {
                const payload = resolvedReviewPackage[definition.package_key] ?? null;
                const loopIntent = loopIntentByKey.get(definition.loop_intent_key);
                return this.repository.createOutput({
                    id: createMeetingReviewStableId('out', runId, definition.id),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    workflow_id: workflowId,
                    type: definition.type,
                    title: definition.title,
                    preview: previewPayload(payload),
                    metadata: {
                        package_id: packageId,
                        case_scope: caseScope,
                        output_key: definition.id,
                        package_key: definition.package_key,
                        loop_intent_id: loopIntent.id,
                        workflow_template_id: loopIntent.workflow_template_id,
                        workflow_binding_id: loopIntent.workflow_binding_id,
                        write_back_target: definition.write_back_target,
                        evidence_refs: evidenceRefs,
                        requires_human_approval: true,
                        runner_type: 'codex_generated_package'
                    },
                    payload: jsonClone(payload)
                });
            });
            const humanSteps = MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((definition) => {
                const loopIntent = loopIntentByKey.get(definition.loop_intent_key);
                return this.repository.createHumanStep({
                    id: createMeetingReviewStableId('human', runId, definition.id),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    workflow_id: workflowId,
                    step_type: definition.step_type,
                    requested_by: actorId,
                    requested_to: actorId,
                    prompt: definition.prompt,
                    reason: definition.reason,
                    metadata: {
                        package_id: packageId,
                        case_scope: caseScope,
                        protects: definition.protects,
                        write_back_target: definition.write_back_target,
                        loop_intent_id: loopIntent.id,
                        requires_human_approval: true
                    }
                });
            });
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_review_package.ingested',
                target_type: 'workflow_run',
                target_id: runId,
                after: {
                    pack_id: MEETING_WORKFLOW_PACK_ID,
                    package_id: packageId,
                    case_scope: caseScope,
                    workflow_id: workflowId,
                    run_id: runId,
                    output_ids: outputs.map((output) => output.id),
                    human_step_ids: humanSteps.map((step) => step.id),
                    loop_intent_ids: loopIntents.map((entry) => entry.loop_intent.id),
                    runner: {
                        type: 'codex_generated_package',
                        eve_connected: false
                    },
                    project_resolution: jsonClone(projectResolution),
                    graph_ssot_playbook: jsonClone(graphPlaybookContext.graph_playbook),
                    state_transitions: MEETING_REVIEW_INGEST_SUCCESS_STATE_TRANSITIONS,
                    evidence_refs: evidenceRefs,
                    stop_conditions: stopConditions
                }
            });
            return {
                meeting_review_ingest: {
                    org_id: orgId,
                    project_id: projectId,
                    case_scope: caseScope,
                    package_id: packageId,
                    idempotent: false,
                    state_transitions: MEETING_REVIEW_INGEST_SUCCESS_STATE_TRANSITIONS,
                    run,
                    outputs,
                    human_steps: humanSteps,
                    context_snapshots: contextSnapshots,
                    loop_intents: loopIntents.map((entry) => entry.loop_intent)
                }
            };
        });
    }

    async dispatchLoopIntentToEve(loopIntentId, input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        this.repository.reload?.();
        let loopIntent = this.repository.getLoopIntent(loopIntentId);
        if (!loopIntent) throw AppError.notFound('loop_intent', loopIntentId);
        this._assertActorCanAccessProject(loopIntent.project_id, actor);
        assertNoCallerSuppliedEveContinuationToken(input);

        const dispatchLockOwner = createStableId('eve_dispatch_owner', process.pid, Date.now(), crypto.randomUUID());
        const dispatchLockWorkspaceId = loopIntent.workspace_id || DEFAULT_WORKSPACE_ID;
        const dispatchLockWorkflowId = eveDispatchLockWorkflowId(loopIntent);
        const dispatchLock = this.repository.acquireWorkflowLock?.({
            workspace_id: dispatchLockWorkspaceId,
            workflow_id: dispatchLockWorkflowId,
            locked_by: dispatchLockOwner,
            ttl_ms: EVE_SESSION_DISPATCH_LOCK_TTL_MS
        });
        if (!dispatchLock) {
            throw AppError.conflict(`loop_intent '${loopIntentId}' already has an Eve dispatch in progress`, {
                state_transition: 'blocked_eve_dispatch_in_progress',
                loop_intent_id: loopIntentId,
                lock_workflow_id: dispatchLockWorkflowId
            });
        }

        try {
        this.repository.reload?.();
        loopIntent = this.repository.getLoopIntent(loopIntentId);
        if (!loopIntent) throw AppError.notFound('loop_intent', loopIntentId);
        const timeoutRecovery = loopIntent.metadata?.eve_dispatch_timeout_recovery || null;
        if (timeoutRecovery?.recovery_required) {
            throw AppError.conflict(`loop_intent '${loopIntentId}' requires operator reconciliation before another Eve dispatch`, {
                state_transition: 'blocked_eve_dispatch_timeout_recovery_required',
                loop_intent_id: loopIntentId,
                recovery_run_id: timeoutRecovery.recovery_run_id || null,
                attempted_at: timeoutRecovery.attempted_at || null
            });
        }
        if (isBlockedEveDispatch(loopIntent)) {
            const blockedReasons = eveDispatchBlockReasons(loopIntent);
            throw AppError.validation(`loop_intent '${loopIntentId}' is not eligible for Eve dispatch`, {
                state_transition: 'blocked_loop_intent_not_dispatchable',
                loop_intent_id: loopIntentId,
                status: loopIntent.status,
                eligibility: loopIntent.eligibility || null,
                blocked_reasons: blockedReasons
            });
        }

        const roleAgent = loopIntent.role_agent_instance_id
            ? this.repository.getRoleAgentInstance(loopIntent.role_agent_instance_id)
            : null;
        const template = loopIntent.workflow_template_id
            ? this.repository.getWorkflowTemplate(loopIntent.workflow_template_id)
            : null;
        const binding = loopIntent.workflow_binding_id
            ? this.repository.getWorkflowBinding(loopIntent.workflow_binding_id)
            : null;
        const triggerRefId = loopIntent.trigger_id || loopIntent.workflow_trigger_id || null;
        const trigger = triggerRefId
            ? this.repository.getWorkflowTrigger(triggerRefId)
            : null;

        this._assertDispatchControlRef('role_agent_instance', roleAgent, loopIntent.role_agent_instance_id, loopIntent);
        this._assertDispatchControlRef('workflow_template', template, loopIntent.workflow_template_id, loopIntent, { allowGlobalOrg: true, allowGlobalProject: true });
        this._assertDispatchControlRef('workflow_binding', binding, loopIntent.workflow_binding_id, loopIntent);
        this._assertDispatchControlRef('workflow_trigger', trigger, triggerRefId, loopIntent);
        this._assertDispatchControlLineage({ loopIntent, roleAgent, template, binding, trigger, triggerRefId });
        const workflowId = binding?.workflow_id || createStableId('wf', loopIntent.org_id, loopIntent.project_id, 'eve_session_dispatch');
        this._assertDispatchWorkflowRef(workflowId, loopIntent);
        if (roleAgent?.enabled === false || template?.enabled === false || binding?.enabled === false || trigger?.enabled === false) {
            throw AppError.validation(`loop_intent '${loopIntentId}' references a disabled control record`, {
                state_transition: 'blocked_disabled_control_ref',
                loop_intent_id: loopIntentId
            });
        }

        const existingSessionRef = loopIntent.metadata?.eve_session_ref || null;
        if (existingSessionRef?.session_id && input.force_new_session !== true && input.forceNewSession !== true) {
            const existingRun = existingSessionRef.workflow_run_id ? this.repository.getRun(existingSessionRef.workflow_run_id) : null;
            const existingWorkflow = existingRun?.workflow_id ? this.repository.getWorkflow(existingRun.workflow_id) : null;
            this._assertExistingEveSessionReplayRef(existingSessionRef, existingRun, existingWorkflow, loopIntent, workflowId);
            return {
                eve_session_dispatch: {
                    org_id: loopIntent.org_id,
                    project_id: loopIntent.project_id,
                    loop_intent_id: loopIntent.id,
                    idempotent: true,
                    state_transitions: ['loop_intent_loaded', 'control_refs_resolved', 'existing_eve_session_reused'],
                    workflow: existingWorkflow,
                    run: existingRun,
                    loop_intent: redactLoopIntentForResponse(loopIntent),
                    eve_session: redactedEveSessionRef(existingSessionRef),
                    handoff: null
                }
            };
        }

        const activeDispatch = this.eveSessionDispatchInFlight.get(loopIntent.id);
        if (activeDispatch) {
            return activeDispatch;
        }

        const dispatchPromise = (async () => {
        if (!this.eveSessionClient?.isConfigured?.()) {
            throw AppError.validation('eve_session_client is not configured', {
                state_transition: 'blocked_eve_not_configured',
                required_env: ['EVE_API_BASE_URL'],
                optional_env: ['EVE_API_TOKEN', 'EVE_API_TIMEOUT_MS']
            });
        }

        const handoff = {
            message: buildEveSessionMessage({
                loopIntent,
                roleAgent,
                template,
                binding,
                trigger,
                overrideMessage: readEveDispatchMessageOverride(input)
            }),
            context: buildEveSessionContext({ loopIntent, roleAgent, template, binding, trigger })
        };
        let eveSession;
        try {
            eveSession = await this.eveSessionClient.createSession({
                message: handoff.message,
                context: handoff.context
            });
        } catch (error) {
            if (isEveSessionTimeoutError(error)) {
                const recovery = this._recordEveSessionTimeoutRecovery({
                    loopIntent,
                    roleAgent,
                    template,
                    binding,
                    handoff,
                    workflowId,
                    actorId: actor.person_id || actor.sub || loopIntent.requested_by || DEFAULT_OWNER_ID,
                    now: new Date().toISOString(),
                    error
                });
                throw AppError.validation('Eve session create timed out with unknown remote session state', {
                    state_transition: 'blocked_eve_session_timeout_recovery_required',
                    loop_intent_id: loopIntentId,
                    recovery_run_id: recovery?.run?.id || null,
                    recovery_recorded: Boolean(recovery?.run),
                    recovery_error: recovery?.error || null,
                    eve_error_code: error?.code || null,
                    eve_status: error?.status || null
                });
            }
            throw AppError.validation('Eve session create failed', {
                state_transition: 'blocked_eve_session_create_failed',
                loop_intent_id: loopIntentId,
                eve_error_code: error?.code || null,
                eve_status: error?.status || null
            });
        }
        if (!eveSession.session_id) {
            throw AppError.validation('Eve session response did not include a session id', {
                state_transition: 'blocked_eve_session_id_missing',
                loop_intent_id: loopIntentId
            });
        }

        const actorId = actor.person_id || actor.sub || loopIntent.requested_by || DEFAULT_OWNER_ID;
        const now = new Date().toISOString();
        const runId = createEveSessionRunId(loopIntent, eveSession.session_id);

        const persistDispatch = async () => {
            const workflow = this.repository.upsertWorkflow({
            id: workflowId,
            workspace_id: loopIntent.workspace_id || DEFAULT_WORKSPACE_ID,
            org_id: loopIntent.org_id,
            project_id: loopIntent.project_id,
            name: `${template?.name || binding?.name || 'Brainbase'} Eve Session`,
            description: 'Brainbase Loop IntentをEve sessionへdispatchする外部実行workflow',
            owner_id: roleAgent?.owner_id || loopIntent.requested_by || actorId,
            default_assignee_id: roleAgent?.owner_id || loopIntent.requested_by || actorId,
            default_approver_id: binding?.approval_owner_id || roleAgent?.default_approver_id || actorId,
            execution_env: 'external',
            risk_level: 'medium',
            hitl_policy: 'external_runner',
            timeout_ms: 3600000,
            implementation_key: EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY,
            context_sources: [{
                id: `${workflowId}_loop_intent`,
                source_type: 'loop_intent',
                source_ref: loopIntent.id,
                scope: 'workflow',
                permission: 'read',
                required: true,
                preview: loopIntent.input_summary || loopIntent.id
            }]
            });
            const run = this.repository.createRun({
            id: runId,
            workspace_id: workflow.workspace_id,
            org_id: loopIntent.org_id,
            project_id: loopIntent.project_id,
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            role_agent_instance_id: loopIntent.role_agent_instance_id,
            workflow_template_id: loopIntent.workflow_template_id,
            workflow_binding_id: loopIntent.workflow_binding_id,
            trigger_id: loopIntent.trigger_id,
            loop_intent_id: loopIntent.id,
            status: 'running',
            closure_state: 'open',
            trigger_type: loopIntent.trigger_type || 'human',
            env: 'eve',
            dry_run: false,
            started_by: actorId,
            owner_id: workflow.owner_id,
            assignee_id: workflow.default_assignee_id,
            approver_id: workflow.default_approver_id,
            action_required: 'await_eve_result',
            human_waiting: false,
            output_count: 0,
            message: 'Eve session dispatched; awaiting external_runner.v0 result ingest',
            started_at: now,
            metadata: {
                runner: {
                    type: 'eve',
                    session_id: eveSession.session_id,
                    continuation_token_present: Boolean(eveSession.continuation_token)
                },
                loop_intent_id: loopIntent.id,
                expected_result_contract: 'external_runner.v0',
                state_transitions: EVE_SESSION_DISPATCH_STATE_TRANSITIONS,
                handoff_version: handoff.context.brainbase_handoff_version
            }
            });
            this.repository.createRunStep({
            id: createStableId('step', run.id, 'eve_session_create'),
            workspace_id: run.workspace_id,
            org_id: loopIntent.org_id,
            project_id: loopIntent.project_id,
            workflow_run_id: run.id,
            step_key: 'eve_session_create',
            step_name: 'Create Eve session',
            status: 'success',
            action_required: 'await_eve_result',
            started_at: now,
            finished_at: now,
            metadata: {
                eve_session_id: eveSession.session_id,
                continuation_token_present: Boolean(eveSession.continuation_token)
            }
            });
            [
            ['loop_intent', loopIntent.id, loopIntent],
            ['role_agent_instance', roleAgent?.id, roleAgent],
            ['workflow_template', template?.id, template],
            ['workflow_binding', binding?.id, binding],
            ['workflow_trigger', trigger?.id, trigger]
            ].filter(([, sourceRef, data]) => sourceRef && data).forEach(([sourceType, sourceRef, data]) => {
                this.repository.createContextSnapshot({
                    id: createStableId('ctx', run.id, sourceType),
                    workspace_id: run.workspace_id,
                    org_id: loopIntent.org_id,
                    project_id: loopIntent.project_id,
                    workflow_run_id: run.id,
                    workflow_id: workflow.id,
                    source_type: sourceType,
                    source_ref: sourceRef,
                    redaction_status: eveDispatchContextSnapshotRedactionStatus(sourceType, data),
                    data: eveDispatchContextSnapshotData(sourceType, data),
                    preview: data.name || data.input_summary || sourceRef
                });
            });

            const eveSessionRef = {
                session_id: eveSession.session_id,
                continuation_token: eveSession.continuation_token,
                workflow_run_id: run.id,
                dispatched_at: now,
                expected_result_contract: 'external_runner.v0'
            };
            const updatedLoopIntent = this.repository.upsertLoopIntent({
                ...loopIntent,
                status: 'dispatched',
                metadata: {
                    ...(loopIntent.metadata || {}),
                    eve_session_ref: eveSessionRef
                }
            });
            this.repository.writeAuditLog({
                workspace_id: run.workspace_id,
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                actor_id: actorId,
                action: 'workflow.eve_session.dispatched',
                target_type: 'workflow_run',
                target_id: run.id,
                after: {
                    loop_intent_id: loopIntent.id,
                    eve_session_id: eveSession.session_id,
                    continuation_token_present: Boolean(eveSession.continuation_token),
                    state_transitions: EVE_SESSION_DISPATCH_STATE_TRANSITIONS,
                    expected_result_contract: 'external_runner.v0'
                }
            });

            return {
                eve_session_dispatch: {
                    org_id: loopIntent.org_id,
                    project_id: loopIntent.project_id,
                    loop_intent_id: loopIntent.id,
                    idempotent: false,
                    state_transitions: EVE_SESSION_DISPATCH_STATE_TRANSITIONS,
                    workflow,
                    run,
                    loop_intent: redactLoopIntentForResponse(updatedLoopIntent),
                    eve_session: redactedEveSessionRef(eveSessionRef),
                    handoff
                }
            };
        };

        try {
            if (typeof this.repository.transaction === 'function') {
                return await this.repository.transaction(persistDispatch);
            }
            return await persistDispatch();
        } catch (error) {
            const recovery = this._recordEveDispatchPersistenceFailure({
                loopIntent,
                roleAgent,
                template,
                binding,
                eveSession,
                handoff,
                workflowId,
                runId,
                actorId,
                now,
                error
            });
            throw AppError.validation('Eve session dispatched but Brainbase persistence failed', {
                state_transition: 'blocked_eve_dispatch_persistence_failed',
                loop_intent_id: loopIntent.id,
                eve_session_id: eveSession.session_id,
                continuation_token_present: Boolean(eveSession.continuation_token),
                workflow_id: workflowId,
                recovery_run_id: recovery?.run?.id || null,
                recovery_recorded: Boolean(recovery?.run),
                recovery_error: recovery?.error || null,
                persistence_error: error instanceof Error ? error.message : String(error)
            });
        }
        })();
        this.eveSessionDispatchInFlight.set(loopIntent.id, dispatchPromise);
        try {
            return await dispatchPromise;
        } finally {
            if (this.eveSessionDispatchInFlight.get(loopIntent.id) === dispatchPromise) {
                this.eveSessionDispatchInFlight.delete(loopIntent.id);
            }
        }
        } finally {
            this.repository.releaseWorkflowLock?.({
                workspace_id: dispatchLockWorkspaceId,
                workflow_id: dispatchLockWorkflowId,
                locked_by: dispatchLockOwner
            });
        }
    }

    _recordEveSessionTimeoutRecovery({ loopIntent, roleAgent, template, binding, handoff, workflowId, actorId, now, error }) {
        try {
            const workflow = this.repository.upsertWorkflow({
                id: workflowId,
                workspace_id: loopIntent.workspace_id || DEFAULT_WORKSPACE_ID,
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                name: `${template?.name || binding?.name || 'Brainbase'} Eve Session`,
                description: 'Brainbase Loop IntentをEve sessionへdispatchする外部実行workflow',
                owner_id: roleAgent?.owner_id || loopIntent.requested_by || actorId,
                default_assignee_id: roleAgent?.owner_id || loopIntent.requested_by || actorId,
                default_approver_id: binding?.approval_owner_id || roleAgent?.default_approver_id || actorId,
                execution_env: 'external',
                risk_level: 'medium',
                hitl_policy: 'external_runner',
                timeout_ms: 3600000,
                implementation_key: EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY,
                context_sources: [{
                    id: `${workflowId}_loop_intent`,
                    source_type: 'loop_intent',
                    source_ref: loopIntent.id,
                    scope: 'workflow',
                    permission: 'read',
                    required: true,
                    preview: loopIntent.input_summary || loopIntent.id
                }]
            });
            const runId = createStableId('run', loopIntent.workspace_id || DEFAULT_WORKSPACE_ID, loopIntent.org_id, loopIntent.project_id, loopIntent.id, 'eve_session_timeout', now);
            const existingRun = this.repository.getRun(runId);
            const runPayload = {
                id: runId,
                workspace_id: workflow.workspace_id,
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                workflow_id: workflow.id,
                workflow_name: workflow.name,
                role_agent_instance_id: loopIntent.role_agent_instance_id,
                workflow_template_id: loopIntent.workflow_template_id,
                workflow_binding_id: loopIntent.workflow_binding_id,
                trigger_id: loopIntent.trigger_id,
                loop_intent_id: loopIntent.id,
                status: 'blocked',
                closure_state: 'open',
                trigger_type: loopIntent.trigger_type || 'human',
                env: 'eve',
                dry_run: false,
                started_by: actorId,
                owner_id: workflow.owner_id,
                assignee_id: workflow.default_assignee_id,
                approver_id: workflow.default_approver_id,
                action_required: 'operator_reconcile_eve_session_timeout',
                human_waiting: true,
                output_count: 0,
                message: 'Eve session create timed out after the request was sent; remote session state is unknown and operator reconciliation is required before retry',
                started_at: now,
                finished_at: now,
                metadata: {
                    runner: {
                        type: 'eve',
                        session_id_known: false,
                        continuation_token_present: false
                    },
                    loop_intent_id: loopIntent.id,
                    expected_result_contract: 'external_runner.v0',
                    state_transitions: [...EVE_SESSION_DISPATCH_STATE_TRANSITIONS, 'blocked_eve_session_timeout_recovery_required'],
                    handoff_version: handoff.context.brainbase_handoff_version,
                    eve_session_timeout_recovery_required: true,
                    eve_error_code: error?.code || null,
                    persistence_note: 'Brainbase did not receive an Eve session id; automatic retry is blocked to avoid duplicate remote sessions.'
                }
            };
            const run = existingRun
                ? this.repository.updateRun(runId, runPayload)
                : this.repository.createRun(runPayload);
            this.repository.upsertLoopIntent({
                ...loopIntent,
                status: 'blocked',
                blocked_reasons: Array.from(new Set([
                    ...(Array.isArray(loopIntent.blocked_reasons) ? loopIntent.blocked_reasons : []),
                    'eve_session_timeout_unknown_remote_state'
                ])),
                metadata: {
                    ...(loopIntent.metadata || {}),
                    eve_dispatch_timeout_recovery: {
                        recovery_required: true,
                        recovery_run_id: run.id,
                        attempted_at: now,
                        error_code: error?.code || null,
                        message: error instanceof Error ? error.message : String(error)
                    }
                }
            });
            this.repository.writeAuditLog({
                workspace_id: run.workspace_id,
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                actor_id: actorId,
                action: 'workflow.eve_session.timeout_recovery_required',
                target_type: 'workflow_run',
                target_id: run.id,
                after: {
                    loop_intent_id: loopIntent.id,
                    state_transition: 'blocked_eve_session_timeout_recovery_required',
                    session_id_known: false,
                    expected_result_contract: 'external_runner.v0',
                    eve_error_code: error?.code || null
                }
            });
            return { workflow, run };
        } catch (recoveryError) {
            return {
                error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
            };
        }
    }

    _recordEveDispatchPersistenceFailure({ loopIntent, roleAgent, template, binding, eveSession, handoff, workflowId, runId, actorId, now, error }) {
        try {
            const workflow = this.repository.upsertWorkflow({
                id: workflowId,
                workspace_id: loopIntent.workspace_id || DEFAULT_WORKSPACE_ID,
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                name: `${template?.name || binding?.name || 'Brainbase'} Eve Session`,
                description: 'Brainbase Loop IntentをEve sessionへdispatchする外部実行workflow',
                owner_id: roleAgent?.owner_id || loopIntent.requested_by || actorId,
                default_assignee_id: roleAgent?.owner_id || loopIntent.requested_by || actorId,
                default_approver_id: binding?.approval_owner_id || roleAgent?.default_approver_id || actorId,
                execution_env: 'external',
                risk_level: 'medium',
                hitl_policy: 'external_runner',
                timeout_ms: 3600000,
                implementation_key: EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY,
                context_sources: [{
                    id: `${workflowId}_loop_intent`,
                    source_type: 'loop_intent',
                    source_ref: loopIntent.id,
                    scope: 'workflow',
                    permission: 'read',
                    required: true,
                    preview: loopIntent.input_summary || loopIntent.id
                }]
            });
            const runPayload = {
                id: runId,
                workspace_id: workflow.workspace_id,
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                workflow_id: workflow.id,
                workflow_name: workflow.name,
                role_agent_instance_id: loopIntent.role_agent_instance_id,
                workflow_template_id: loopIntent.workflow_template_id,
                workflow_binding_id: loopIntent.workflow_binding_id,
                trigger_id: loopIntent.trigger_id,
                loop_intent_id: loopIntent.id,
                status: 'blocked',
                closure_state: 'open',
                trigger_type: loopIntent.trigger_type || 'human',
                env: 'eve',
                dry_run: false,
                started_by: actorId,
                owner_id: workflow.owner_id,
                assignee_id: workflow.default_assignee_id,
                approver_id: workflow.default_approver_id,
                action_required: 'operator_reconcile_eve_session',
                human_waiting: true,
                output_count: 0,
                message: 'Eve session was created, but Brainbase persistence failed; operator reconciliation is required',
                started_at: now,
                finished_at: now,
                metadata: {
                    runner: {
                        type: 'eve',
                        session_id: eveSession.session_id,
                        continuation_token_present: Boolean(eveSession.continuation_token)
                    },
                    loop_intent_id: loopIntent.id,
                    expected_result_contract: 'external_runner.v0',
                    state_transitions: [...EVE_SESSION_DISPATCH_STATE_TRANSITIONS, 'blocked_eve_dispatch_persistence_failed'],
                    handoff_version: handoff.context.brainbase_handoff_version,
                    dispatch_persistence_failed: true,
                    persistence_error: error instanceof Error ? error.message : String(error)
                }
            };
            const existingRun = this.repository.getRun(runId);
            const run = existingRun
                ? this.repository.updateRun(runId, runPayload)
                : this.repository.createRun(runPayload);
            const eveSessionRef = {
                session_id: eveSession.session_id,
                continuation_token: eveSession.continuation_token,
                workflow_run_id: run.id,
                dispatched_at: now,
                expected_result_contract: 'external_runner.v0',
                persistence_recovery_required: true
            };
            this.repository.upsertLoopIntent({
                ...loopIntent,
                status: 'dispatched',
                metadata: {
                    ...(loopIntent.metadata || {}),
                    eve_session_ref: eveSessionRef,
                    eve_dispatch_persistence_error: {
                        recorded_at: now,
                        message: error instanceof Error ? error.message : String(error)
                    }
                }
            });
            this.repository.writeAuditLog({
                workspace_id: run.workspace_id,
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                actor_id: actorId,
                action: 'workflow.eve_session.dispatch_persistence_failed',
                target_type: 'workflow_run',
                target_id: run.id,
                after: {
                    loop_intent_id: loopIntent.id,
                    eve_session_id: eveSession.session_id,
                    continuation_token_present: Boolean(eveSession.continuation_token),
                    state_transition: 'blocked_eve_dispatch_persistence_failed',
                    expected_result_contract: 'external_runner.v0',
                    persistence_error: error instanceof Error ? error.message : String(error)
                }
            });
            return { workflow, run };
        } catch (recoveryError) {
            return {
                error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
            };
        }
    }

    async generateDraft(input, actor = {}) {
        const projectId = input.project_id || input.projectId;
        if (!projectId) throw AppError.validation('project_id is required');
        await this._assertProjectSelectable(projectId);
        this._assertActorCanAccessProject(projectId, actor);
        const draft = generateWorkflowDraft(input);
        return { draft };
    }

    async testDraft(input, actor = {}) {
        const draft = input.draft || input;
        const projectId = draft.workflow?.project_id || draft.workflow?.projectId || draft.project_id || draft.projectId;
        if (!projectId) throw AppError.validation('project_id is required');
        await this._assertProjectSelectable(projectId);
        this._assertActorCanAccessProject(projectId, actor);
        return { test_result: testWorkflowDraft(draft) };
    }

    async updateWorkflow(workflowId, patch, actor = {}) {
        await this.ensureDefaultWorkflows();
        const current = this.repository.getWorkflow(workflowId);
        if (!current) throw AppError.notFound('workflow', workflowId);
        this._assertActorCanAccessProject(current.project_id, actor);
        const nextProjectId = patch.project_id || patch.projectId || current.project_id;
        await this._assertProjectSelectable(nextProjectId);
        this._assertActorCanAccessProject(nextProjectId, actor);
        const updated = this.repository.updateWorkflow(workflowId, normalizeWorkflowInput({
            ...current,
            ...patch,
            id: workflowId,
            project_id: nextProjectId
        }, {
            projectId: nextProjectId,
            ownerId: current.owner_id,
            assigneeId: current.default_assignee_id,
            approverId: current.default_approver_id
        }));
        this.repository.writeAuditLog({
            workspace_id: updated.workspace_id,
            project_id: updated.project_id,
            actor_id: actor.person_id || actor.sub || 'system',
            action: 'workflow.updated',
            target_type: 'workflow',
            target_id: updated.id,
            before: current,
            after: updated
        });
        return { workflow: updated };
    }

    async runWorkflow(workflowId, options = {}) {
        await this.ensureDefaultWorkflows();
        await this._loadProjectConfigCache();
        const workflow = this.repository.getWorkflow(workflowId);
        if (!workflow) throw AppError.notFound('workflow', workflowId);
        await this._assertProjectSelectable(workflow.project_id);
        this._assertActorCanAccessProject(workflow.project_id, {
            sub: options.actorId,
            person_id: options.actorId,
            projectCodes: options.projectCodes || [],
            role: options.role,
            authSource: options.authSource
        });
        if (workflow.enabled === false) {
            throw AppError.validation(`workflow '${workflowId}' is disabled`);
        }
        assertWorkflowRunAllowed(workflow);
        return this.runner.runWorkflow(workflow, options);
    }

    async rerun(runId, options = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const previous = this.repository.getRun(runId);
        if (!previous) throw AppError.notFound('workflow_run', runId);
        this._assertActorCanAccessProject(previous.project_id, actor);
        const workflow = this.repository.getWorkflow(previous.workflow_id);
        assertWorkflowRunAllowed(workflow);
        return this.runWorkflow(previous.workflow_id, {
            ...options,
            projectCodes: actor.projectCodes || [],
            role: actor.role,
            authSource: actor.authSource,
            parentRunId: runId,
            triggerType: 'retry',
            env: previous.env
        });
    }

    async getRun(runId, actor = {}) {
        await this._loadProjectConfigCache();
        const run = this.repository.getRun(runId);
        if (!run) throw AppError.notFound('workflow_run', runId);
        this._assertActorCanAccessProject(run.project_id, actor);
        return {
            run,
            run_steps: this.repository.listRunSteps(runId),
            context_snapshots: this.repository.listContextSnapshots(runId),
            human_steps: this.repository.listHumanSteps(runId),
            outputs: this.repository.listOutputs(runId),
            audit_logs: this.repository.listAuditLogs({ targetId: runId })
        };
    }

    async listCompanionApprovalInbox({ projectId = null, limit = 100 } = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);

        const runs = this.repository.listRuns({ projectId, limit: null })
            .filter((run) => this._actorCanAccessProject(run.project_id, actor));
        const allItems = [];

        for (const run of runs) {
            if (!isActionableCompanionApprovalRun(run)) continue;

            const pendingHumanSteps = this.repository
                .listHumanSteps(run.id)
                .filter((step) => isPendingHumanStepStatus(step.status));
            if (pendingHumanSteps.length === 0) continue;

            const workflow = this.repository.getWorkflow(run.workflow_id) || null;
            const outputs = this.repository.listOutputs(run.id);
            const auditLogs = this.repository.listAuditLogs({ targetId: run.id, limit: 20 });
            const contextSnapshots = this.repository.listContextSnapshots(run.id);
            const sourceUrl = run.metadata?.source_event?.permalink
                || run.metadata?.source_url
                || run.metadata?.meeting_identity?.source_url
                || null;
            const normalizedHumanSteps = pendingHumanSteps.map(normalizeCompanionApprovalHumanStep);
            const normalizedOutputs = outputs.map(normalizeCompanionApprovalOutput);
            const normalizedEvidence = auditLogs.map(normalizeCompanionApprovalEvidence);
            const actionKind = companionApprovalActionKind({
                pendingHumanSteps,
                outputs,
                run
            });

            allItems.push({
                id: `approval_${run.id}`,
                kind: 'workflow_approval',
                title: runDisplayTitle(run, workflow),
                summary: `${pendingHumanSteps.length}件の承認待ち、${outputs.length}件のoutput`,
                priority: companionApprovalPriority({ pendingHumanSteps, outputs, run }),
                owner_id: companionApprovalOwner({ run, workflow, pendingHumanSteps }),
                action_kind: actionKind,
                workflow_id: run.workflow_id,
                workflow_name: workflow?.name || run.workflow_id,
                run_id: run.id,
                web_url: `/workflows?run_id=${encodeURIComponent(run.id)}`,
                web_route: {
                    path: '/workflows',
                    view: 'run',
                    run_id: run.id,
                    api_path: `/api/workflow-runs/${encodeURIComponent(run.id)}`
                },
                project_id: run.project_id || workflow?.project_id || null,
                org_id: run.org_id || run.metadata?.org_id || null,
                case_scope: run.metadata?.case_scope || run.metadata?.meeting_identity?.case_scope || null,
                status: run.status || null,
                action_required: run.action_required || null,
                created_at: run.created_at || run.started_at || null,
                updated_at: run.updated_at || run.finished_at || run.started_at || run.created_at || null,
                source_url: sourceUrl,
                pending_human_steps: normalizedHumanSteps,
                outputs: normalizedOutputs,
                context: contextSnapshots.map(normalizeCompanionApprovalContextSnapshot),
                audit_refs: auditLogs.map((log) => log.id).filter(Boolean),
                evidence: normalizedEvidence,
                metadata: {
                    meeting_identity: run.metadata?.meeting_identity || null,
                    source_event: run.metadata?.source_event || null,
                    stop_conditions: run.metadata?.stop_conditions || []
                }
            });
        }

        const items = allItems.slice(0, limit);
        return {
            items,
            count: items.length,
            has_more: allItems.length > limit,
            omitted_count: Math.max(allItems.length - items.length, 0)
        };
    }

    async resolveHumanStep(stepId, input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const step = this.repository.getHumanStep(stepId);
        if (!step) throw AppError.notFound('workflow_human_step', stepId);
        if (input.run_id && input.run_id !== step.workflow_run_id) {
            throw AppError.validation(`human step '${stepId}' does not belong to run '${input.run_id}'`);
        }
        this._assertActorCanAccessProject(step.project_id, actor);
        this._assertActorCanResolveHumanStep(step, actor);
        if (step.status !== 'pending') {
            throw AppError.conflict(`human step '${stepId}' is already ${step.status}`);
        }
        const resolution = input.resolution || input.status || 'approved';
        const approvedResolution = isApprovedHumanResolution(resolution);
        const resolvedStatus = approvedResolution ? 'approved' : resolution;
        const resolved = this.repository.updateHumanStep(stepId, {
            status: resolvedStatus,
            response_ref: input.response_ref || input.responseRef || null,
            reason: input.reason || step.reason || null,
            resolved_at: new Date().toISOString(),
            resolved_by: actor.person_id || actor.sub || 'system'
        });
        this.repository.writeAuditLog({
            workspace_id: step.workspace_id,
            project_id: step.project_id,
            actor_id: actor.person_id || actor.sub || 'system',
            action: 'workflow.human_step.resolved',
            target_type: 'workflow_human_step',
            target_id: stepId,
            after: resolved
        });
        const previousRun = this.repository.getRun(step.workflow_run_id);
        const workflow = this.repository.getWorkflow(step.workflow_id);
        if (!approvedResolution) {
            const cancelledHumanStepIds = [];
            if (isMeetingReviewPackageWorkflow(workflow)) {
                for (const humanStep of this.repository.listHumanSteps(step.workflow_run_id)) {
                    if (humanStep.id !== stepId && isPendingHumanStepStatus(humanStep.status)) {
                        const cancelled = this.repository.updateHumanStep(humanStep.id, {
                            status: 'cancelled',
                            reason: `cancelled_after_${resolvedStatus}`,
                            resolved_at: new Date().toISOString(),
                            resolved_by: actor.person_id || actor.sub || 'system'
                        });
                        if (cancelled) cancelledHumanStepIds.push(cancelled.id);
                    }
                }
            }
            const closedRun = previousRun
                ? this.repository.updateRun(previousRun.id, {
                    status: 'cancelled',
                    closure_state: 'closed',
                    human_waiting: false,
                    action_required: 'none',
                    message: isMeetingReviewPackageWorkflow(workflow)
                        ? `Meeting Review Package stopped after human step ${resolvedStatus}`
                        : `Human step ${resolvedStatus}`,
                    finished_at: new Date().toISOString()
                })
                : null;
            this.repository.writeAuditLog({
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actor.person_id || actor.sub || 'system',
                action: 'workflow.run.human_step.cancelled',
                target_type: 'workflow_run',
                target_id: step.workflow_run_id,
                after: {
                    human_step_id: stepId,
                    resolution: resolvedStatus,
                    cancelled_human_step_ids: cancelledHumanStepIds,
                    status: closedRun?.status || 'cancelled'
                }
            });
            return { human_step: resolved, resumed_run: closedRun };
        }
        if (isMeetingReviewPackageWorkflow(workflow) && previousRun) {
            const allHumanSteps = this.repository.listHumanSteps(step.workflow_run_id);
            const pendingHumanSteps = allHumanSteps.filter((humanStep) => isPendingHumanStepStatus(humanStep.status));
            const approvedHumanSteps = allHumanSteps.filter((humanStep) => isApprovedHumanResolution(humanStep.status));
            const rejectedHumanSteps = allHumanSteps.filter((humanStep) => isRejectedHumanStepStatus(humanStep.status));
            const allApproved = allHumanSteps.length > 0 && approvedHumanSteps.length === allHumanSteps.length;
            const hasRejectedStep = rejectedHumanSteps.length > 0 || previousRun.status === 'cancelled';
            const updatedRun = hasRejectedStep
                ? this.repository.updateRun(previousRun.id, {
                    status: 'cancelled',
                    closure_state: 'closed',
                    human_waiting: false,
                    action_required: 'none',
                    message: 'Meeting Review Package human approvals stopped after rejected gate',
                    finished_at: new Date().toISOString()
                })
                : this.repository.updateRun(previousRun.id, {
                    status: allApproved ? 'success' : 'waiting_human',
                    closure_state: allApproved ? 'closed' : 'open',
                    human_waiting: !allApproved,
                    action_required: allApproved ? 'none' : 'approve',
                    message: allApproved
                        ? 'Meeting Review Package human approvals completed'
                        : `Meeting Review Package is waiting for ${pendingHumanSteps.length} human approval(s)`,
                    finished_at: new Date().toISOString()
                });
            this.repository.writeAuditLog({
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actor.person_id || actor.sub || 'system',
                action: hasRejectedStep
                    ? 'workflow.run.meeting_review_approvals.cancelled'
                    : allApproved
                    ? 'workflow.run.meeting_review_approvals.completed'
                    : 'workflow.run.meeting_review_approvals.progressed',
                target_type: 'workflow_run',
                target_id: previousRun.id,
                after: {
                    human_step_id: stepId,
                    approved_human_step_ids: approvedHumanSteps.map((humanStep) => humanStep.id),
                    pending_human_step_ids: pendingHumanSteps.map((humanStep) => humanStep.id),
                    rejected_human_step_ids: rejectedHumanSteps.map((humanStep) => humanStep.id),
                    status: updatedRun?.status || previousRun.status,
                    closure_state: updatedRun?.closure_state || previousRun.closure_state
                }
            });
            return { human_step: resolved, resumed_run: updatedRun };
        }
        const resume = await this.runWorkflow(step.workflow_id, {
            actorId: actor.person_id || actor.sub || 'system',
            projectCodes: actor.projectCodes || [],
            role: actor.role,
            authSource: actor.authSource,
            parentRunId: step.workflow_run_id,
            triggerType: 'human_resume',
            env: previousRun?.env || 'local',
            humanStepResolution: {
                stepId,
                resolution,
                responseRef: resolved.response_ref,
                reason: resolved.reason
            }
        });
        this.repository.writeAuditLog({
            workspace_id: step.workspace_id,
            project_id: step.project_id,
            actor_id: actor.person_id || actor.sub || 'system',
            action: 'workflow.run.human_step.resumed',
            target_type: 'workflow_run',
            target_id: resume.run.id,
            after: {
                human_step_id: stepId,
                previous_run_id: step.workflow_run_id,
                status: resume.run.status
            }
        });
        return { human_step: resolved, resumed_run: resume.run };
    }

    async _assertProjectSelectable(projectId) {
        if (!projectId) throw AppError.validation('project_id is required');
        if (projectId === 'general') return;
        const projectConfig = await this._loadProjectConfigCache();
        if (!projectConfig) return;
        const exists = (projectConfig.projects || []).some((project) => (
            project.id === projectId
            && project.archived !== true
            && project.session_select !== false
        ));
        if (!exists) {
            throw AppError.validation(`project '${projectId}' is not selectable`);
        }
    }

    _actorCanAccessProject(projectId, actor = {}) {
        if (!projectId) return true;
        if (!actor || Object.keys(actor).length === 0) return true;
        if (actor.authSource === 'internal' || actor.sub === 'internal_api' || actor.person_id === 'internal_api') return true;
        if (['admin', 'ceo'].includes(String(actor.role || '').toLowerCase())) return true;
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        if (projectCodes.length === 0) return false;
        const allowedCodes = new Set(projectCodes.flatMap((code) => {
            const normalized = normalizeProjectKey(code);
            return normalized ? [normalized, normalized.replace(/-/g, '')] : [];
        }));
        if (allowedCodes.size === 0) return false;
        const projectConfig = this._getCachedProjectConfig(projectId);
        const keys = projectAccessKeys(projectId, projectConfig);
        return Array.from(keys).some((key) => allowedCodes.has(key));
    }

    _actorCanManageGlobalWorkflowTemplate(actor = {}) {
        if (!actor || Object.keys(actor).length === 0) return true;
        if (actor.authSource === 'internal' || actor.sub === 'internal_api' || actor.person_id === 'internal_api') return true;
        return ['admin', 'ceo'].includes(String(actor.role || '').toLowerCase());
    }

    _actorCanAccessWorkflowTemplate(template, actor = {}) {
        if (template.project_id) return this._actorCanAccessProject(template.project_id, actor);
        if (this._actorCanManageGlobalWorkflowTemplate(actor)) return true;
        if (template.org_id) return false;
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        return projectCodes.length > 0;
    }

    _assertActorCanAccessProject(projectId, actor = {}) {
        if (!this._actorCanAccessProject(projectId, actor)) {
            throw AppError.forbidden(`project '${projectId}' is not accessible`);
        }
    }

    _assertOrgReferenceAllowed(orgId) {
        if (!orgId) throw AppError.validation('org_id is required');
        if (!this.projectConfigById || this.projectConfigById.size === 0) return;
        const normalizedOrg = normalizeProjectKey(orgId);
        const orgKeys = new Set();
        for (const [projectId, projectConfig] of this.projectConfigById.entries()) {
            for (const key of projectAccessKeys(projectId, projectConfig)) {
                orgKeys.add(key);
            }
        }
        if (!orgKeys.has(normalizedOrg) && !orgKeys.has(normalizedOrg.replace(/-/g, ''))) {
            throw AppError.validation(`org '${orgId}' is not a known Graph org reference`);
        }
    }

    _assertActorCanResolveHumanStep(step, actor = {}) {
        const actorId = actor.person_id || actor.sub || null;
        if (actor.authSource === 'internal' || actorId === 'internal_api') return;
        if (['admin', 'ceo'].includes(String(actor.role || '').toLowerCase())) return;
        if (!actorId || actorId !== step.requested_to) {
            throw AppError.forbidden(`human step '${step.id}' is not assigned to this actor`);
        }
    }

    _assertDispatchControlRef(type, record, recordId, loopIntent, { allowGlobalOrg = false, allowGlobalProject = false } = {}) {
        if (!recordId) return;
        if (!record) throw AppError.notFound(type, recordId);
        if (!allowGlobalOrg && record.org_id !== loopIntent.org_id) {
            throw AppError.validation(`${type} '${recordId}' belongs to org '${record.org_id}'`, {
                state_transition: 'blocked_loop_control_ref_mismatch',
                field: `${type}.org_id`,
                expected: loopIntent.org_id,
                actual: record.org_id
            });
        }
        if (allowGlobalOrg && record.org_id && record.org_id !== loopIntent.org_id) {
            throw AppError.validation(`${type} '${recordId}' belongs to org '${record.org_id}'`, {
                state_transition: 'blocked_loop_control_ref_mismatch',
                field: `${type}.org_id`,
                expected: loopIntent.org_id,
                actual: record.org_id
            });
        }
        if (!allowGlobalProject && record.project_id !== loopIntent.project_id) {
            throw AppError.validation(`${type} '${recordId}' belongs to project '${record.project_id}'`, {
                state_transition: 'blocked_loop_control_ref_mismatch',
                field: `${type}.project_id`,
                expected: loopIntent.project_id,
                actual: record.project_id
            });
        }
        if (allowGlobalProject && record.project_id && record.project_id !== loopIntent.project_id) {
            throw AppError.validation(`${type} '${recordId}' belongs to project '${record.project_id}'`, {
                state_transition: 'blocked_loop_control_ref_mismatch',
                field: `${type}.project_id`,
                expected: loopIntent.project_id,
                actual: record.project_id
            });
        }
    }

    _assertDispatchControlLineage({ loopIntent, roleAgent, template, binding, trigger, triggerRefId }) {
        const fail = (field, expected, actual) => {
            throw AppError.validation(`loop_intent '${loopIntent.id}' references inconsistent control records`, {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: loopIntent.id,
                field,
                expected,
                actual
            });
        };
        if (loopIntent.trigger_id && loopIntent.workflow_trigger_id && loopIntent.trigger_id !== loopIntent.workflow_trigger_id) {
            fail('loop_intent.trigger_id', loopIntent.workflow_trigger_id, loopIntent.trigger_id);
        }
        if (binding && loopIntent.workflow_binding_id && binding.id !== loopIntent.workflow_binding_id) {
            fail('workflow_binding.id', loopIntent.workflow_binding_id, binding.id);
        }
        if (trigger && triggerRefId && trigger.id !== triggerRefId) {
            fail('workflow_trigger.id', triggerRefId, trigger.id);
        }
        if (binding && roleAgent && binding.role_agent_instance_id !== roleAgent.id) {
            fail('workflow_binding.role_agent_instance_id', roleAgent.id, binding.role_agent_instance_id);
        }
        if (binding && loopIntent.role_agent_instance_id && binding.role_agent_instance_id !== loopIntent.role_agent_instance_id) {
            fail('workflow_binding.role_agent_instance_id', loopIntent.role_agent_instance_id, binding.role_agent_instance_id);
        }
        if (binding && template && binding.workflow_template_id !== template.id) {
            fail('workflow_binding.workflow_template_id', template.id, binding.workflow_template_id);
        }
        if (binding && loopIntent.workflow_template_id && binding.workflow_template_id !== loopIntent.workflow_template_id) {
            fail('workflow_binding.workflow_template_id', loopIntent.workflow_template_id, binding.workflow_template_id);
        }
        if (binding && trigger && trigger.workflow_binding_id !== binding.id) {
            fail('workflow_trigger.workflow_binding_id', binding.id, trigger.workflow_binding_id);
        }
        if (trigger && loopIntent.workflow_binding_id && trigger.workflow_binding_id !== loopIntent.workflow_binding_id) {
            fail('workflow_trigger.workflow_binding_id', loopIntent.workflow_binding_id, trigger.workflow_binding_id);
        }
    }

    _assertDispatchWorkflowRef(workflowId, loopIntent) {
        if (!workflowId) return;
        const workflow = this.repository.getWorkflow(workflowId);
        if (!workflow) return;
        const fail = (field, expected, actual) => {
            throw AppError.validation(`workflow '${workflowId}' cannot be reused for loop_intent '${loopIntent.id}'`, {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: loopIntent.id,
                workflow_id: workflowId,
                field,
                expected,
                actual
            });
        };
        const expectedWorkspaceId = loopIntent.workspace_id || DEFAULT_WORKSPACE_ID;
        const actualWorkspaceId = workflow.workspace_id || DEFAULT_WORKSPACE_ID;
        if (actualWorkspaceId !== expectedWorkspaceId) {
            fail('workflow.workspace_id', expectedWorkspaceId, actualWorkspaceId);
        }
        if ((workflow.org_id || null) !== (loopIntent.org_id || null)) {
            fail('workflow.org_id', loopIntent.org_id || null, workflow.org_id || null);
        }
        if (workflow.project_id !== loopIntent.project_id) {
            fail('workflow.project_id', loopIntent.project_id, workflow.project_id);
        }
        if (workflow.implementation_key !== EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY) {
            fail('workflow.implementation_key', EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY, workflow.implementation_key || null);
        }
    }

    _assertExistingEveSessionReplayRef(existingSessionRef, existingRun, existingWorkflow, loopIntent, workflowId) {
        if (!existingSessionRef?.workflow_run_id) return;
        const fail = (field, expected, actual) => {
            throw AppError.validation(`eve_session_ref for loop_intent '${loopIntent.id}' cannot replay workflow_run '${existingSessionRef.workflow_run_id}'`, {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: loopIntent.id,
                workflow_run_id: existingSessionRef.workflow_run_id,
                workflow_id: existingRun?.workflow_id || null,
                field,
                expected,
                actual
            });
        };
        if (!existingRun) {
            fail('eve_session_ref.workflow_run_id', 'existing workflow_run', null);
        }
        if (!existingWorkflow) {
            fail('workflow_run.workflow_id', 'existing workflow', existingRun.workflow_id || null);
        }
        const expectedWorkspaceId = loopIntent.workspace_id || DEFAULT_WORKSPACE_ID;
        const actualWorkspaceId = existingRun.workspace_id || DEFAULT_WORKSPACE_ID;
        if (actualWorkspaceId !== expectedWorkspaceId) {
            fail('workflow_run.workspace_id', expectedWorkspaceId, actualWorkspaceId);
        }
        if ((existingRun.org_id || null) !== (loopIntent.org_id || null)) {
            fail('workflow_run.org_id', loopIntent.org_id || null, existingRun.org_id || null);
        }
        if (existingRun.project_id !== loopIntent.project_id) {
            fail('workflow_run.project_id', loopIntent.project_id, existingRun.project_id);
        }
        if ((existingRun.loop_intent_id || null) !== loopIntent.id) {
            fail('workflow_run.loop_intent_id', loopIntent.id, existingRun.loop_intent_id || null);
        }
        if (existingRun.workflow_id !== workflowId) {
            fail('workflow_run.workflow_id', workflowId, existingRun.workflow_id || null);
        }
        this._assertDispatchWorkflowRef(existingRun.workflow_id, loopIntent);
    }

    _writeWorkflowControlAudit({ item, actor, action, targetType }) {
        this.repository.writeAuditLog({
            workspace_id: item.workspace_id || DEFAULT_WORKSPACE_ID,
            org_id: item.org_id || null,
            project_id: item.project_id || null,
            actor_id: actor.person_id || actor.sub || 'system',
            action,
            target_type: targetType,
            target_id: item.id,
            after: item
        });
    }

    _getCachedProjectConfig(projectId) {
        return this.projectConfigById?.get(projectId) || null;
    }

    async _loadProjectConfigCache() {
        if (!this.configParser?.getProjects) return null;
        const projectConfig = await this.configParser.getProjects();
        this.projectConfigById = new Map((projectConfig.projects || []).map((project) => [project.id, project]));
        return projectConfig;
    }
}
