// @ts-check

import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { AutomationRunService } from '../automation-run/automation-run-service.js';
import { MeetingAutomationService } from '../meeting-automation/meeting-automation-service.js';
import { RunReceiptQueryService } from '../run-receipt/query-service.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_OWNER_ID = 'local-user';
const MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY = 'meeting-review-package-ingest';
const ALLOWED_TRIGGER_TYPES = new Set(['human', 'event', 'schedule']);
const ALLOWED_AUTONOMY_LEVELS = new Set(['human_only', 'draft_only', 'approval_required', 'auto_execute']);
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

function ownerHintCanonicalToken(value) {
    return normalizeOwnerHintSearchText(value).replace(/\s+/g, '');
}

function isGenericOwnerHint(value) {
    return ['担当者', '担当', '未設定', '未定', 'tbd', 'todo', 'owner', 'assignee']
        .includes(ownerHintCanonicalToken(value));
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

function projectCodeLookupVariants(projectId) {
    if (!projectId || typeof projectId !== 'string') return [];
    const trimmed = projectId.trim();
    if (!trimmed) return [];
    return Array.from(new Set([
        trimmed,
        trimmed.replace(/[-_]/g, ''),
        trimmed.replace(/_/g, '-'),
        trimmed.replace(/-/g, '_')
    ].filter(Boolean)));
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

function graphContextPeople(context = {}) {
    if (!context || typeof context !== 'object') return [];
    const entities = context.entities;
    const records = Array.isArray(entities)
        ? entities.filter((record) => record?.entity_type === 'person' || record?.type === 'person' || record?.payload?.entity_type === 'person')
        : (Array.isArray(entities?.person) ? entities.person : []);
    return records.map(normalizeTaskOwnerPerson).filter(Boolean);
}

function mergeTaskOwnerPeople(...peopleLists) {
    const peopleByKey = new Map();
    for (const person of peopleLists.flat()) {
        if (!person) continue;
        const aliasesKey = Array.isArray(person.aliases)
            ? person.aliases.map((alias) => normalizePeopleCompactText(alias)).filter(Boolean).sort().join('|')
            : '';
        const nameKey = [person.display_name, person.name, aliasesKey]
            .map((value) => normalizePeopleCompactText(value))
            .filter(Boolean)
            .join('::');
        const key = nameKey || person.person_id || person.entity_id || person.id || person.display_name;
        if (!key || peopleByKey.has(key)) continue;
        peopleByKey.set(key, person);
    }
    return Array.from(peopleByKey.values());
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
    const projectVariants = projectCodeLookupVariants(projectId);
    const contextMatch = Boolean(projectVariants.length && Array.isArray(person.project_ids)
        && person.project_ids.some((personProjectId) => projectVariants.includes(personProjectId)));
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
    const partialMatches = selectableCandidates.filter((person) => person.match === 'partial_name_or_alias');
    if (ownerCandidates.length === 1 && partialMatches.length === 1) return selectableCandidates[0];
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
    const actorProjectCodes = Array.isArray(actor.projectCodes)
        ? actor.projectCodes.filter((code) => typeof code === 'string' && code.trim()).map((code) => code.trim())
        : [];
    const projectCodes = Array.from(new Set([
        ...actorProjectCodes,
        ...projectCodeLookupVariants(projectId)
    ]));
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

function readFirstOptionalString(input, ...keys) {
    for (const key of keys) {
        const value = input?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
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

function buildEveSessionMessage({ loopIntent, roleAgent, template, binding, trigger, meetingNoteGeneration = null, overrideMessage = null }) {
    if (overrideMessage) return overrideMessage;
    const workflowName = template?.name || binding?.name || loopIntent.workflow_template_id || 'Brainbase workflow';
    const roleName = roleAgent?.name || loopIntent.role_agent_instance_id || 'Role Agent';
    return [
        'Execute this Brainbase Role Agent workflow as an Eve session.',
        `Role Agent: ${roleName}`,
        `Workflow: ${workflowName}`,
        `Trigger: ${trigger?.trigger_type || loopIntent.trigger_type || 'human'}`,
        'Use only the provided Brainbase context.',
        ...(meetingNoteGeneration ? [
            'Task: generate the Brainbase meeting note from context.meeting_note_generation.note_source (normalized transcript).',
            'Write the generated note back to Brainbase via the context.meeting_note_generation.write_back contract.'
        ] : []),
        'Do not send external messages, publish, create contracts, or promote Graph SSOT directly.',
        'Return execution results to Brainbase using the external_runner.v0 contract.'
    ].join('\n');
}

function readMeetingNoteGenerationDispatchRef(input) {
    const ref = input?.meeting_note_generation ?? input?.meetingNoteGeneration ?? null;
    if (ref === null || ref === undefined) return null;
    if (typeof ref !== 'object' || Array.isArray(ref)) {
        throw AppError.validation('meeting_note_generation must be a JSON object', {
            state_transition: 'blocked_invalid_meeting_note_generation_ref'
        });
    }
    const runId = readOptionalString(ref, 'run_id', 'runId');
    const packageId = readOptionalString(ref, 'package_id', 'packageId');
    if (!runId && !packageId) {
        throw AppError.validation('meeting_note_generation requires run_id or package_id', {
            state_transition: 'blocked_invalid_meeting_note_generation_ref'
        });
    }
    return { run_id: runId, package_id: packageId };
}

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

function assertEveCandidateList(value, collectionName, optionalStringFields) {
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

function assertEveMeetingCandidatesInput(input) {
    assertEveCandidateList(input.task_candidates, 'task_candidates', [
        'owner_hint',
        'ownerHint',
        'due_hint',
        'dueHint',
        'source_excerpt',
        'sourceExcerpt'
    ]);
    assertEveCandidateList(input.decision_candidates, 'decision_candidates', [
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

// Deterministic normalization of an Eve-generated candidate list. The LLM
// supplies the title/owner/decision text; Brainbase code owns the parts that
// must stay stable and auditable: id assignment, status, source, case_scope,
// and evidence refs (taken from the output's own metadata, not from the model).
function normalizeEveTaskCandidates(rawCandidates, { caseScope = null, evidenceRefs = [] } = {}) {
    if (!Array.isArray(rawCandidates)) return [];
    return rawCandidates
        .map((candidate) => (candidate && typeof candidate === 'object' ? candidate : null))
        .filter(Boolean)
        .map((candidate, index) => {
            const title = readOptionalString(candidate, 'title') || '';
            if (!title) return null;
            const ownerHint = taskCandidateOwnerHint(candidate) || null;
            const dueHint = readOptionalString(candidate, 'due_hint', 'dueHint') || null;
            const sourceExcerpt = readOptionalString(candidate, 'source_excerpt', 'sourceExcerpt') || null;
            return {
                id: createMeetingReviewStableId('task_candidate', caseScope || '', 'task', title, index),
                title,
                status: 'candidate',
                source: EVE_CANDIDATE_SOURCE,
                case_scope: caseScope,
                owner_hint: ownerHint,
                due_hint: dueHint,
                source_excerpt: sourceExcerpt,
                evidence_refs: evidenceRefs
            };
        })
        .filter(Boolean);
}

function normalizeEveDecisionCandidates(rawCandidates, { caseScope = null, evidenceRefs = [] } = {}) {
    if (!Array.isArray(rawCandidates)) return [];
    return rawCandidates
        .map((candidate) => (candidate && typeof candidate === 'object' ? candidate : null))
        .filter(Boolean)
        .map((candidate, index) => {
            const title = readOptionalString(candidate, 'title') || '';
            if (!title) return null;
            const sourceExcerpt = readOptionalString(candidate, 'source_excerpt', 'sourceExcerpt') || null;
            return {
                id: createMeetingReviewStableId('decision_candidate', caseScope || '', 'decision', title, index),
                title,
                status: 'candidate',
                source: EVE_CANDIDATE_SOURCE,
                case_scope: caseScope,
                decision_type: readOptionalString(candidate, 'decision_type', 'decisionType') || 'meeting_decision',
                source_excerpt: sourceExcerpt,
                evidence_refs: evidenceRefs
            };
        })
        .filter(Boolean);
}

function normalizeEveFollowUpDraft(rawDraft) {
    const body = rawDraft && typeof rawDraft === 'object'
        ? (typeof rawDraft.body === 'string' ? rawDraft.body : '')
        : '';
    // external_send_required_approval is forced true regardless of what the
    // model returns: the human external-send gate (approve_follow_up_draft)
    // must never be waivable by generated content.
    return {
        status: 'draft_only',
        external_send_required_approval: true,
        body
    };
}

function buildMeetingNoteGenerationHandoffContext({ loopIntent, run, output }) {
    const payload = output.payload && typeof output.payload === 'object' ? output.payload : {};
    const sourceTranscripts = Array.isArray(payload.source_transcripts) ? payload.source_transcripts : [];
    const packageId = output.metadata?.package_id || run.metadata?.package_id || null;
    return {
        task: 'transcript_to_meeting_note',
        run_id: run.id,
        package_id: packageId,
        output_id: output.id,
        source_text_hash: payload.source_text_hash,
        source_text_length: payload.source_text_length ?? null,
        generation_status: payload.generation_status || null,
        note_source: {
            title: payload.title || null,
            body: typeof payload.body === 'string' ? payload.body : '',
            source_transcripts: sourceTranscripts.map((transcript) => ({
                role: transcript.role || null,
                provider: transcript.provider || null,
                source_text_kind: transcript.source_text_kind || 'unknown',
                transcript_hash: transcript.transcript_hash || transcript.content_sha256 || null,
                text_length: transcript.text_length ?? (typeof transcript.text === 'string' ? transcript.text.length : 0),
                text: typeof transcript.text === 'string' ? transcript.text : ''
            }))
        },
        write_back: {
            method: 'POST',
            path: '/api/workflows/control/meeting-pack/note-generation',
            content_type: 'application/json',
            required_fields: ['org_id', 'project_id', 'run_id (or package_id)', 'source_text_hash', 'note.body'],
            payload_template: {
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                run_id: run.id,
                package_id: packageId,
                source_text_hash: payload.source_text_hash,
                note: {
                    title: '<generated meeting note title>',
                    body: '<generated meeting note markdown body>'
                },
                runner: { type: 'eve', session_id: '<eve session id>' }
            },
            rules: [
                'source_text_hash must exactly match the value provided in this context; mismatched write-backs are rejected.',
                'The write-back updates the meeting_note_draft output (generation_status: brainbase_source_ready -> brainbase_generated). It does not publish the note.',
                'Human approval (approve_meeting_note_publish) stays in Brainbase and must not be bypassed.'
            ]
        },
        candidates_write_back: {
            tool: 'record_meeting_candidates',
            required_fields: ['org_id', 'project_id', 'run_id', 'source_text_hash'],
            payload_template: {
                org_id: loopIntent.org_id,
                project_id: loopIntent.project_id,
                run_id: run.id,
                source_text_hash: payload.source_text_hash,
                task_candidates: [
                    { title: '<action item>', owner_hint: '<owner or null>', due_hint: '<due or null>', source_excerpt: '<evidence sentence>' }
                ],
                decision_candidates: [
                    { title: '<decision>', decision_type: 'meeting_decision', source_excerpt: '<evidence sentence>' }
                ],
                follow_up_draft: { body: '<follow-up message markdown>' },
                runner: { type: 'eve', session_id: '<eve session id>' }
            },
            rules: [
                'Call once, after staging the note, with the same org/project/run and source_text_hash as the note write-back.',
                'org_id, project_id, run_id, and source_text_hash must exactly match this context; mismatched candidate write-backs are excluded.',
                'Brainbase owns id assignment, status, source, evidence_refs and the external-send approval flag; return only the human-meaningful title/owner/due/decision/body text.',
                'Candidates are best-effort: they update the task_candidates / decision_candidates / follow_up_draft outputs but never publish, create tasks, or send messages. The human approval gates (approve_task_candidates / approve_decision_candidates / approve_follow_up_draft) stay in Brainbase.'
            ]
        }
    };
}

function buildEveSessionContext({ loopIntent, roleAgent, template, binding, trigger, meetingNoteGeneration = null }) {
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
        },
        ...(meetingNoteGeneration ? { meeting_note_generation: jsonClone(meetingNoteGeneration) } : {})
    };
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

function isPendingHumanStepStatus(status) {
    return String(status || '').toLowerCase() === 'pending';
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
    constructor({
        repository,
        runner,
        configParser,
        googleCalendarService = null,
        eveSessionClient = null,
        infoSSOTService = null,
        runReceiptQueryService = null,
        meetingAutomationService = null,
        automationRunService = null
    }) {
        this.repository = repository;
        this.runner = runner;
        this.configParser = configParser;
        this.googleCalendarService = googleCalendarService;
        this.eveSessionClient = eveSessionClient;
        this.infoSSOTService = infoSSOTService;
        this.projectConfigById = new Map();
        this.eveSessionDispatchInFlight = new Map();
        this.runReceiptQueryService = runReceiptQueryService || new RunReceiptQueryService({
            repository,
            prepareProjectAccess: () => this._loadProjectConfigCache(),
            assertProjectAccess: (projectId, actor) => this._assertActorCanAccessProject(projectId, actor),
            canAccessProject: (projectId, actor) => this._actorCanAccessProject(projectId, actor)
        });
        this.meetingAutomationService = meetingAutomationService || new MeetingAutomationService({
            repository,
            googleCalendarService,
            eveSessionClient,
            infoSSOTService,
            prepareProjectAccess: () => this._loadProjectConfigCache(),
            assertProjectSelectable: (projectId) => this._assertProjectSelectable(projectId),
            assertOrgReferenceAllowed: (orgId) => this._assertOrgReferenceAllowed(orgId),
            assertProjectAccess: (projectId, actor) => this._assertActorCanAccessProject(projectId, actor),
            createLoopIntent: (input, actor) => this.createLoopIntent(input, actor),
            resolveReviewTaskOwners: (reviewPackage, options) => this.resolveMeetingReviewTaskOwnersFromSSOT(reviewPackage, options),
            dispatchLoopIntentToEve: (loopIntentId, input, actor) => this.dispatchLoopIntentToEve(loopIntentId, input, actor)
        });
        this.automationRunService = automationRunService || new AutomationRunService({
            repository,
            runner,
            ensureDefaultWorkflows: () => this.ensureDefaultWorkflows(),
            prepareProjectAccess: () => this._loadProjectConfigCache(),
            assertProjectSelectable: (projectId) => this._assertProjectSelectable(projectId),
            assertProjectAccess: (projectId, actor) => this._assertActorCanAccessProject(projectId, actor),
            assertHumanStepAccess: (step, actor) => this._assertActorCanResolveHumanStep(step, actor)
        });
    }

    async ensureDefaultWorkflows() {
        await this._transaction(() => {
            if (!this.repository.getWorkflow('brainbase-alive')) {
                this.repository.upsertWorkflow(createBrainbaseAliveWorkflow());
            }
        });
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
        const agent = await this._transaction(() => {
            const item = this.repository.upsertRoleAgentInstance({
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
                item,
                actor,
                action: 'workflow.role_agent_instance.upserted',
                targetType: 'role_agent_instance'
            });
            return item;
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
        const template = await this._transaction(() => {
            const item = this.repository.upsertWorkflowTemplate({
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
                item,
                actor,
                action: 'workflow.template.upserted',
                targetType: 'workflow_template'
            });
            return item;
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
        const binding = await this._transaction(() => {
            const item = this.repository.upsertWorkflowBinding({
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
                item,
                actor,
                action: 'workflow.binding.upserted',
                targetType: 'workflow_binding'
            });
            return item;
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
        const trigger = await this._transaction(() => {
            const item = this.repository.upsertWorkflowTrigger({
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
                item,
                actor,
                action: 'workflow.trigger.upserted',
                targetType: 'workflow_trigger'
            });
            return item;
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
        const intent = await this._transaction(() => {
            const item = this.repository.upsertLoopIntent({
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
                item,
                actor,
                action: 'workflow.loop_intent.created',
                targetType: 'loop_intent'
            });
            return item;
        });
        return { loop_intent: intent };
    }


    async resolveMeetingReviewTaskOwnersFromSSOT(reviewPackage, { actor = {}, projectId = null, graphContext = null } = {}) {
        if (!this.infoSSOTService?.listGraphEntities || !Array.isArray(reviewPackage?.task_candidates)) {
            return reviewPackage;
        }

        const access = taskOwnerAccessFromActor(actor, projectId);
        const cache = new Map();
        const contextPeople = graphContextPeople(graphContext);
        const taskCandidates = [];

        for (const candidate of reviewPackage.task_candidates) {
            taskCandidates.push(await this.resolveMeetingReviewTaskOwnerCandidate(candidate, {
                access,
                projectId,
                contextPeople,
                cache
            }));
        }

        return {
            ...reviewPackage,
            task_candidates: taskCandidates
        };
    }

    async resolveMeetingReviewTaskOwnerCandidate(candidate, { access, projectId, cache, contextPeople = [] }) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
        if (candidate.selected_owner_id || candidate.selectedOwnerId) {
            const selectedOwnerId = candidate.selected_owner_id || candidate.selectedOwnerId;
            const lookup = await this.lookupTaskOwnerPeopleSSOT({
                access,
                projectId,
                ids: [selectedOwnerId],
                cache
            });
            const selectedPerson = mergeTaskOwnerPeople(lookup.people, contextPeople)
                .find((person) => person.person_id === selectedOwnerId);
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
                owner_candidates: mergeTaskOwnerPeople(lookup.people, contextPeople)
                    .map((person) => taskOwnerCandidatePayload(person, selectedOwnerId, projectId)),
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

        if (isGenericOwnerHint(ownerHint)) {
            return {
                ...candidate,
                owner_candidates: [],
                owner_resolution: {
                    source: 'graph_ssot',
                    status: 'unresolved',
                    reason: 'generic_owner_hint_requires_human_selection'
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
            mergeTaskOwnerPeople(lookup.people, contextPeople)
                .map((person) => taskOwnerCandidatePayload(person, ownerHint, projectId))
                .filter((person) => person.match !== 'search_result')
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
                    reason: ownerCandidates.length === 1
                        ? (selectedCandidate.match === 'exact_name_or_alias' ? 'unique_exact_name_or_alias' : 'unique_partial_name_or_alias')
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
        const projectCodeVariants = projectCodeLookupVariants(projectId);
        const cacheKey = `${projectCodeVariants.join(',')}:q:${searchQueries.join('|')}:id:${searchIds.join('|')}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        try {
            const recordsByKey = new Map();
            const addRecords = (records = []) => {
                for (const record of records) {
                    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
                    const key = record?.id || record?.entity_id || payload.person_id || payload.id || JSON.stringify(record);
                    if (!recordsByKey.has(key)) recordsByKey.set(key, record);
                }
            };
            for (const id of searchIds) {
                let scopedRecords = [];
                for (const projectCode of projectCodeVariants) {
                    const records = await this.infoSSOTService.listGraphEntities(access, {
                        projectCode,
                        entityType: 'person',
                        id,
                        limit: 1
                    });
                    addRecords(records);
                    scopedRecords = scopedRecords.concat(Array.isArray(records) ? records : []);
                }
                if (!scopedRecords.length || !projectCodeVariants.length) {
                    const records = await this.infoSSOTService.listGraphEntities(access, {
                        entityType: 'person',
                        id,
                        limit: 1
                    });
                    addRecords(records);
                }
            }
            for (const searchQuery of searchQueries) {
                for (const projectCode of projectCodeVariants) {
                    const records = await this.infoSSOTService.listGraphEntities(access, {
                        projectCode,
                        entityType: 'person',
                        query: searchQuery,
                        limit: 20
                    });
                    addRecords(records);
                }
                const records = await this.infoSSOTService.listGraphEntities(access, {
                        entityType: 'person',
                        query: searchQuery,
                        limit: 20
                });
                addRecords(records);
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
        const reviewScope = await this.meetingAutomationService.resolveReviewPackageScope(input, actor);
        const earlyReplay = this.meetingAutomationService.findReviewPackageReplay(reviewScope);
        if (earlyReplay) return earlyReplay;

        const resolvedContext = await this.meetingAutomationService.resolveReviewPackageGraphContext(reviewScope, actor);
        const ingestResult = await this.meetingAutomationService.persistReviewPackage(resolvedContext, actor);
        if (ingestResult.meeting_review_ingest.idempotent) return ingestResult;

        const { orgId, projectId, packageId, loopIntentByKey } = reviewScope;
        const runId = ingestResult.meeting_review_ingest.run.id;
        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        ingestResult.meeting_review_ingest.note_generation_dispatch = await this.meetingAutomationService.dispatchNoteGeneration({
            loopIntent: loopIntentByKey.get('transcript_to_meeting_note') || null,
            orgId,
            projectId,
            packageId,
            runId,
            actorId,
            actor
        });
        return ingestResult;
    }

    async recordMeetingNoteGeneration(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = readOptionalString(input, 'org_id', 'orgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId');
        const packageId = readOptionalString(input, 'package_id', 'packageId');
        const inputRunId = readOptionalString(input, 'run_id', 'runId');
        const sourceTextHash = readOptionalString(input, 'source_text_hash', 'sourceTextHash');
        const note = input.note && typeof input.note === 'object' ? input.note : {};
        const noteBody = typeof note.body === 'string' ? note.body : '';
        const runner = input.runner && typeof input.runner === 'object' ? input.runner : {};
        if (!orgId) {
            throw AppError.validation('org_id is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!projectId) {
            throw AppError.validation('project_id is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!inputRunId && !packageId) {
            throw AppError.validation('package_id or run_id is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!sourceTextHash) {
            throw AppError.validation('source_text_hash is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!noteBody.trim()) {
            throw AppError.validation('note.body is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);

        const runId = inputRunId
            || createMeetingReviewStableId('run', orgId, projectId, packageId, 'meeting_review_package_ingest');
        const run = this.repository.getRun(runId);
        if (!run) throw AppError.notFound('workflow_run', runId);
        if (run.org_id !== orgId || run.project_id !== projectId) {
            throw AppError.validation(`workflow_run '${runId}' belongs to '${run.org_id}/${run.project_id}'`, {
                state_transition: 'blocked_invalid_scope'
            });
        }
        const noteOutput = this.repository.listOutputs(runId)
            .find((output) => output.metadata?.output_key === 'meeting_note_draft');
        if (!noteOutput) {
            throw AppError.validation(`workflow_run '${runId}' has no meeting_note_draft output`, {
                state_transition: 'blocked_note_output_missing'
            });
        }
        const currentPayload = noteOutput.payload && typeof noteOutput.payload === 'object'
            ? noteOutput.payload
            : {};
        if (currentPayload.source_text_hash !== sourceTextHash) {
            throw AppError.validation('source_text_hash does not match the meeting_note_draft output', {
                state_transition: 'blocked_source_hash_mismatch',
                expected: currentPayload.source_text_hash || null
            });
        }

        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const now = new Date().toISOString();
        const nextPayload = {
            ...currentPayload,
            title: typeof note.title === 'string' && note.title.trim()
                ? note.title.trim()
                : currentPayload.title,
            body: noteBody,
            generator: 'brainbase_meeting_pack',
            generation_source: 'transcript_to_meeting_note',
            generation_status: 'brainbase_generated',
            provider_note_authoritative: false,
            generated_at: now,
            generated_by: {
                type: typeof runner.type === 'string' && runner.type ? runner.type : 'unknown',
                session_id: typeof runner.session_id === 'string' ? runner.session_id : null,
                actor_id: actorId
            }
        };
        const updatedOutput = await this._transaction(() => {
            const item = this.repository.updateOutput(noteOutput.id, {
                payload: nextPayload,
                preview: previewPayload(nextPayload),
                updated_at: now
            });
            // Target the run (not the output) so the entry reaches the Run Trace
            // audit panel, which lists audit logs by run id.
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_pack.note_generation.recorded',
                target_type: 'workflow_run',
                target_id: runId,
                after: {
                    run_id: runId,
                    output_id: noteOutput.id,
                    package_id: noteOutput.metadata?.package_id || packageId || null,
                    source_text_hash: sourceTextHash,
                    generation_status: nextPayload.generation_status,
                    state_transition: 'note_generation_recorded',
                    runner_type: nextPayload.generated_by?.type || null,
                    external_run_id: nextPayload.generated_by?.session_id || null,
                    generated_by: nextPayload.generated_by,
                    body_length: noteBody.length,
                    regenerated: currentPayload.generation_status === 'brainbase_generated'
                }
            });
            return item;
        });
        return {
            meeting_note_generation: {
                org_id: orgId,
                project_id: projectId,
                run_id: runId,
                output_id: noteOutput.id,
                generation_status: nextPayload.generation_status,
                output: updatedOutput
            }
        };
    }

    // Reconcile Eve-generated task/decision/follow-up candidates onto the sibling
    // outputs of the same meeting review ingest run. Mirrors recordMeetingNoteGeneration:
    // the source_text_hash is re-verified against the meeting_note_draft output, and
    // Brainbase code owns the deterministic normalization (id/status/source/approval flag)
    // so the LLM only supplies human-meaningful text. Candidate write-back never publishes
    // or creates tasks; the human approval gates stay in Brainbase.
    async recordMeetingCandidates(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = readOptionalString(input, 'org_id', 'orgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId');
        const packageId = readOptionalString(input, 'package_id', 'packageId');
        const inputRunId = readOptionalString(input, 'run_id', 'runId');
        const sourceTextHash = readOptionalString(input, 'source_text_hash', 'sourceTextHash');
        const runner = input.runner && typeof input.runner === 'object' ? input.runner : {};
        if (!orgId) {
            throw AppError.validation('org_id is required', { state_transition: 'blocked_invalid_candidates' });
        }
        if (!projectId) {
            throw AppError.validation('project_id is required', { state_transition: 'blocked_invalid_candidates' });
        }
        if (!inputRunId && !packageId) {
            throw AppError.validation('package_id or run_id is required', { state_transition: 'blocked_invalid_candidates' });
        }
        if (!sourceTextHash) {
            throw AppError.validation('source_text_hash is required', { state_transition: 'blocked_invalid_candidates' });
        }
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);

        const runId = inputRunId
            || createMeetingReviewStableId('run', orgId, projectId, packageId, 'meeting_review_package_ingest');
        const run = this.repository.getRun(runId);
        if (!run) throw AppError.notFound('workflow_run', runId);
        if (run.org_id !== orgId || run.project_id !== projectId) {
            throw AppError.validation(`workflow_run '${runId}' belongs to '${run.org_id}/${run.project_id}'`, {
                state_transition: 'blocked_invalid_scope'
            });
        }

        const outputs = this.repository.listOutputs(runId);
        const noteOutput = outputs.find((output) => output.metadata?.output_key === 'meeting_note_draft');
        if (!noteOutput) {
            throw AppError.validation(`workflow_run '${runId}' has no meeting_note_draft output`, {
                state_transition: 'blocked_note_output_missing'
            });
        }
        const noteHash = noteOutput.payload && typeof noteOutput.payload === 'object'
            ? noteOutput.payload.source_text_hash
            : null;
        if (noteHash !== sourceTextHash) {
            throw AppError.validation('source_text_hash does not match the meeting_note_draft output', {
                state_transition: 'blocked_source_hash_mismatch',
                expected: noteHash || null
            });
        }
        assertEveMeetingCandidatesInput(input);

        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const now = new Date().toISOString();
        const generatedBy = {
            type: typeof runner.type === 'string' && runner.type ? runner.type : 'eve',
            session_id: typeof runner.session_id === 'string' ? runner.session_id : null,
            actor_id: actorId
        };

        const taskOutput = outputs.find((output) => output.metadata?.output_key === 'task_candidates');
        const normalizedTaskCandidates = taskOutput
            ? normalizeEveTaskCandidates(input.task_candidates, {
                caseScope: taskOutput.metadata?.case_scope || null,
                evidenceRefs: Array.isArray(taskOutput.metadata?.evidence_refs) ? taskOutput.metadata.evidence_refs : []
            })
            : [];
        const resolvedTaskPackage = await this.resolveMeetingReviewTaskOwnersFromSSOT({
            task_candidates: normalizedTaskCandidates
        }, {
            actor,
            projectId,
            graphContext: run.metadata?.graph_context || null
        });

        const candidatePayloadBuilders = {
            task_candidates: () => resolvedTaskPackage.task_candidates,
            decision_candidates: (output) => normalizeEveDecisionCandidates(input.decision_candidates, {
                caseScope: output.metadata?.case_scope || null,
                evidenceRefs: Array.isArray(output.metadata?.evidence_refs) ? output.metadata.evidence_refs : []
            }),
            follow_up_draft: () => normalizeEveFollowUpDraft(input.follow_up_draft)
        };

        return this.repository.transaction(async () => {
            const updated = {};
            for (const [outputKey, buildPayload] of Object.entries(candidatePayloadBuilders)) {
                const output = outputs.find((candidate) => candidate.metadata?.output_key === outputKey);
                if (!output) continue;
                const payload = buildPayload(output);
                const updatedOutput = this.repository.updateOutput(output.id, {
                    payload,
                    preview: previewPayload(payload),
                    updated_at: now
                });
                updated[outputKey] = {
                    output_id: output.id,
                    count: Array.isArray(payload) ? payload.length : 1,
                    output: updatedOutput
                };
            }

            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_pack.candidates.recorded',
                target_type: 'workflow_run',
                target_id: runId,
                after: {
                    run_id: runId,
                    package_id: noteOutput.metadata?.package_id || packageId || null,
                    source_text_hash: sourceTextHash,
                    state_transition: 'meeting_candidates_recorded',
                    runner_type: generatedBy.type,
                    external_run_id: generatedBy.session_id,
                    generated_by: generatedBy,
                    task_candidate_count: updated.task_candidates?.count ?? 0,
                    decision_candidate_count: updated.decision_candidates?.count ?? 0,
                    follow_up_recorded: Boolean(updated.follow_up_draft)
                }
            });

            return {
                meeting_candidates: {
                    org_id: orgId,
                    project_id: projectId,
                    run_id: runId,
                    updated
                }
            };
        });
    }

    _resolveMeetingNoteGenerationHandoff(loopIntent, input) {
        const ref = readMeetingNoteGenerationDispatchRef(input);
        if (!ref) return null;
        const runId = ref.run_id
            || createMeetingReviewStableId('run', loopIntent.org_id, loopIntent.project_id, ref.package_id, 'meeting_review_package_ingest');
        const run = this.repository.getRun(runId);
        if (!run) throw AppError.notFound('workflow_run', runId);
        if (run.org_id !== loopIntent.org_id || run.project_id !== loopIntent.project_id) {
            throw AppError.validation(`workflow_run '${runId}' belongs to '${run.org_id}/${run.project_id}'`, {
                state_transition: 'blocked_meeting_note_generation_scope',
                loop_intent_id: loopIntent.id,
                run_id: runId,
                expected: { org_id: loopIntent.org_id, project_id: loopIntent.project_id },
                actual: { org_id: run.org_id, project_id: run.project_id }
            });
        }
        const output = this.repository.listOutputs(runId)
            .find((candidate) => candidate.metadata?.output_key === 'meeting_note_draft');
        if (output?.metadata?.loop_intent_id && output.metadata.loop_intent_id !== loopIntent.id) {
            throw AppError.validation(`meeting_note_draft output of workflow_run '${runId}' belongs to loop_intent '${output.metadata.loop_intent_id}'`, {
                state_transition: 'blocked_meeting_note_generation_scope',
                loop_intent_id: loopIntent.id,
                run_id: runId,
                output_loop_intent_id: output.metadata.loop_intent_id
            });
        }
        if (!output || !output.payload?.source_text_hash) {
            throw AppError.validation(`workflow_run '${runId}' has no dispatchable meeting_note_draft source`, {
                state_transition: 'blocked_meeting_note_generation_source_missing',
                loop_intent_id: loopIntent.id,
                run_id: runId,
                output_present: Boolean(output)
            });
        }
        return buildMeetingNoteGenerationHandoffContext({ loopIntent, run, output });
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

        const meetingNoteGeneration = this._resolveMeetingNoteGenerationHandoff(loopIntent, input);
        const existingSessionRef = loopIntent.metadata?.eve_session_ref || null;
        if (existingSessionRef?.session_id && input.force_new_session !== true && input.forceNewSession !== true) {
            const existingRun = existingSessionRef.workflow_run_id ? this.repository.getRun(existingSessionRef.workflow_run_id) : null;
            // The transcript_to_meeting_note loop intent is shared across all
            // meetings of an org/project, so a lingering eve_session_ref from a
            // previous meeting must not swallow a dispatch that references a
            // different ingest run: only reuse when the existing Eve run was
            // dispatched for the same meeting_note_generation run.
            const reusableForMeetingNoteGeneration = !meetingNoteGeneration
                || existingRun?.metadata?.meeting_note_generation?.run_id === meetingNoteGeneration.run_id;
            if (reusableForMeetingNoteGeneration) {
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
                meetingNoteGeneration,
                overrideMessage: readEveDispatchMessageOverride(input)
            }),
            context: buildEveSessionContext({ loopIntent, roleAgent, template, binding, trigger, meetingNoteGeneration })
        };
        let eveSession;
        try {
            eveSession = await this.eveSessionClient.createSession({
                message: handoff.message,
                context: handoff.context
            });
        } catch (error) {
            if (isEveSessionTimeoutError(error)) {
                const recovery = await this._recordEveSessionTimeoutRecovery({
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
                handoff_version: handoff.context.brainbase_handoff_version,
                ...(meetingNoteGeneration ? {
                    meeting_note_generation: {
                        run_id: meetingNoteGeneration.run_id,
                        package_id: meetingNoteGeneration.package_id,
                        source_text_hash: meetingNoteGeneration.source_text_hash
                    }
                } : {})
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
            return await this._transaction(persistDispatch);
        } catch (error) {
            const recovery = await this._recordEveDispatchPersistenceFailure({
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

    async _recordEveSessionTimeoutRecovery({ loopIntent, roleAgent, template, binding, handoff, workflowId, actorId, now, error }) {
        try {
            return await this._transaction(() => {
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
            });
        } catch (recoveryError) {
            return {
                error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
            };
        }
    }

    async _recordEveDispatchPersistenceFailure({ loopIntent, roleAgent, template, binding, eveSession, handoff, workflowId, runId, actorId, now, error }) {
        try {
            return await this._transaction(() => {
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
            });
        } catch (recoveryError) {
            return {
                error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
            };
        }
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
                api_path: `/api/workflow-runs/${encodeURIComponent(run.id)}`,
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

    async _transaction(callback) {
        if (typeof this.repository?.transaction !== 'function') {
            throw new Error('WorkflowService requires a transactional workflow repository');
        }
        return this.repository.transaction(callback);
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
