// @ts-check

import { createHash } from 'node:crypto';

const CONTRACT_VERSION = 'run_receipt.v1';
const SOURCE_TYPES = new Set(['mana', 'codex_automations', 'github_actions', 'salestailor', 'openryoko']);
const RUN_STATUSES = new Set(['success', 'failed', 'blocked', 'waiting_human', 'cancelled']);
const EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);
const OBSERVATION_KINDS = new Set(['source_run', 'connector_observation']);
const ACTIONS = new Set([
    'none',
    'check_error',
    'resolve_blocker',
    'review_run',
    'retry_run',
    'reauthorize',
    'contact_owner'
]);
const EVIDENCE_KINDS = new Set(['url', 'artifact_ref', 'log_ref']);
const JUDGMENT_TRACE_SCHEMA_VERSION = 'meeting_judgment_trace.v1';
const TRACE_COVERAGE_STATES = new Set(['confirmed', 'partial', 'unknown']);
const TRACE_GRAPH_PLAYBOOK_STATUSES = new Set(['executed', 'partial', 'not_executed', 'unknown']);
const TRACE_NODE_STATUSES = new Set(['completed', 'skipped', 'blocked', 'unknown']);
const TRACE_FEEDBACK_ACTIONS = new Set(['adopt', 'correct', 'reject', 'not_useful']);
const FORBIDDEN_KEYS = new Set([
    'content',
    'body',
    'raw_log',
    'rawLog',
    'transcript',
    'customer_text',
    'customerText',
    'payload'
]);
const TOP_LEVEL_KEYS = new Set(['contract_version', 'source', 'run', 'delivery']);
const SOURCE_KEYS = new Set(['type', 'workflow_id', 'name', 'runtime_target']);
const RUN_KEYS = new Set([
    'project_id',
    'org_id',
    'external_run_id',
    'parent_external_run_id',
    'workflow_name',
    'status',
    'evidence_state',
    'started_at',
    'finished_at',
    'summary',
    'blocker_reason',
    'action_required',
    'observation_kind',
    'metrics',
    'evidence_refs',
    'judgment_trace'
]);
const DELIVERY_KEYS = new Set(['idempotency_key', 'attempt', 'sent_at']);
const EVIDENCE_KEYS = new Set(['kind', 'ref', 'label']);
const TRACE_KEYS = new Set([
    'schema_version',
    'dag',
    'graph_playbook_status',
    'nodes',
    'glossary',
    'quality',
    'corrections',
    'replay'
]);
const TRACE_DAG_KEYS = new Set(['id', 'version']);
const TRACE_NODE_KEYS = new Set([
    'id',
    'node_id',
    'status',
    'outcome',
    'event_id',
    'sequence',
    'node_version',
    'next_branch',
    'started_at',
    'finished_at',
    'input_refs',
    'evidence_refs'
]);
const TRACE_GLOSSARY_KEYS = new Set(['coverage', 'term_refs', 'unresolved_count']);
const TRACE_TERM_KEYS = new Set(['term_id', 'surface_form', 'entity_ref', 'evidence_refs']);
const TRACE_STATE_KEYS = new Set(['status', 'evidence_refs', 'issue_codes']);
const TRACE_CORRECTION_KEYS = new Set([
    'feedback_id',
    'corrects_event_id',
    'action',
    'reason',
    'evidence_refs',
    'replacement'
]);
const TRACE_REPLACEMENT_KEYS = new Set(['event_id', 'subject_type', 'subject_id', 'summary', 'evidence_refs']);
const TRACE_REPLAY_KEYS = new Set([
    'status',
    'evidence_refs',
    'verified_run_ids',
    'changed_version_refs',
    'original_failure_refs',
    'separate_case_refs'
]);
const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9_+.-]{1,31}:[^\s]{1,2000}$/;
const ROUTINE_ARTIFACT_REF_PATTERN = /^routine-artifacts\/[a-z0-9_-]+\/[a-f0-9]{64}\.json$/;
const EMBEDDED_CREDENTIAL_PATTERN = /^[a-z][a-z0-9+.-]{1,31}:(?:\/\/)?[^/?#\s@]+(?::[^/?#\s@]*)?@/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_OR_NEWLINE_PATTERN = /[\u0000-\u001f\u007f]/;
const METRIC_CONTENT_PATTERN = /(?:^|[_-])(content|body|raw|log|transcript|customer)(?:$|[_-])/i;

export class RunReceiptContractError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'RunReceiptContractError';
        this.code = code;
        this.details = details;
    }
}

function fail(code, message, details = {}) {
    throw new RunReceiptContractError(code, message, details);
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, path) {
    if (!isObject(value)) fail('invalid_object', `${path} must be an object`, { path });
    return value;
}

function rejectForbiddenKeys(value, path = 'receipt') {
    if (Array.isArray(value)) {
        value.forEach((item, index) => rejectForbiddenKeys(item, `${path}[${index}]`));
        return;
    }
    if (!isObject(value)) return;
    Object.entries(value).forEach(([key, child]) => {
        if (FORBIDDEN_KEYS.has(key)) {
            fail('forbidden_key', `${path}.${key} is forbidden`, { path: `${path}.${key}` });
        }
        rejectForbiddenKeys(child, `${path}.${key}`);
    });
}

function rejectUnknownKeys(value, allowed, path) {
    Object.keys(value).forEach((key) => {
        if (!allowed.has(key)) fail('unknown_field', `${path}.${key} is not supported`, { path: `${path}.${key}` });
    });
}

function requireString(value, path, maxLength = 200) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail('missing_string', `${path} is required`, { path });
    }
    if (value !== value.trim()) fail('invalid_string', `${path} must not have surrounding whitespace`, { path });
    if (value.length > maxLength) fail('string_too_long', `${path} exceeds ${maxLength} characters`, { path, max_length: maxLength });
    if (CONTROL_OR_NEWLINE_PATTERN.test(value)) fail('invalid_string', `${path} must be single-line and control-character free`, { path });
    return value;
}

function optionalString(value, path, maxLength) {
    if (value === undefined || value === null) return undefined;
    return requireString(value, path, maxLength);
}

function requireEnum(value, path, allowed, code) {
    const normalized = requireString(value, path);
    if (!allowed.has(normalized)) fail(code, `${path}=${normalized} is not supported`, { path, value: normalized });
    return normalized;
}

function optionalEnum(value, path, allowed, code) {
    if (value === undefined || value === null) return undefined;
    return requireEnum(value, path, allowed, code);
}

function validateTimestamp(value, path, required = false) {
    if (value === undefined || value === null) {
        if (required) fail('missing_timestamp', `${path} is required`, { path });
        return undefined;
    }
    const timestamp = requireString(value, path, 64);
    const epoch = Date.parse(timestamp);
    if (!RFC3339_PATTERN.test(timestamp) || !Number.isFinite(epoch)) {
        fail('invalid_timestamp', `${path} must be RFC 3339`, { path });
    }
    return { timestamp, epoch };
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]));
}

function compactJson(value) {
    return JSON.stringify(stableValue(value));
}

function sortEvidenceRefs(refs) {
    return [...refs].sort((left, right) => (
        left.kind.localeCompare(right.kind)
        || left.ref.localeCompare(right.ref)
        || String(left.label || '').localeCompare(String(right.label || ''))
    ));
}

function hasIndependentEvidence(leftRefs, rightRefs) {
    const left = new Set(leftRefs.map((ref) => `${ref.kind}:${ref.ref}`));
    return rightRefs.some((ref) => !left.has(`${ref.kind}:${ref.ref}`));
}

function validateMetrics(value) {
    if (value === undefined || value === null) return undefined;
    const metrics = requireObject(value, 'run.metrics');
    const normalized = {};
    Object.keys(metrics).sort().forEach((key) => {
        requireString(key, `run.metrics.${key}`, 120);
        if (METRIC_CONTENT_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) {
            fail('forbidden_metric_name', `run.metrics.${key} is content-like`, { path: `run.metrics.${key}` });
        }
        const metric = metrics[key];
        if (metric !== null && typeof metric !== 'boolean' && !(typeof metric === 'number' && Number.isFinite(metric))) {
            fail('invalid_metric_value', `run.metrics.${key} must be a finite number, boolean, or null`, {
                path: `run.metrics.${key}`
            });
        }
        normalized[key] = metric;
    });
    return normalized;
}

function validateEvidenceRefs(value, path = 'run.evidence_refs', maxLength = null) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail('invalid_array', `${path} must be an array`, { path });
    if (maxLength !== null && value.length > maxLength) {
        fail('array_too_long', `${path} exceeds ${maxLength} entries`, { path, max_length: maxLength });
    }
    const refs = value.map((entry, index) => {
        const entryPath = `${path}[${index}]`;
        const ref = requireObject(entry, entryPath);
        rejectUnknownKeys(ref, EVIDENCE_KEYS, entryPath);
        const kind = requireEnum(ref.kind, `${entryPath}.kind`, EVIDENCE_KINDS, 'unsupported_evidence_kind');
        const reference = requireString(ref.ref, `${entryPath}.ref`, 2048);
        const label = optionalString(ref.label, `${entryPath}.label`, 120);
        if (EMBEDDED_CREDENTIAL_PATTERN.test(reference)) {
            fail('invalid_evidence_ref', `${entryPath}.ref must not contain embedded credentials`, { path: `${entryPath}.ref` });
        }
        if (kind === 'url') {
            let parsed;
            try {
                parsed = new URL(reference);
            } catch {
                fail('invalid_evidence_ref', `${entryPath}.ref must be an absolute HTTPS URL`, { path: `${entryPath}.ref` });
            }
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                fail('invalid_evidence_ref', `${entryPath}.ref must be an absolute HTTPS URL without credentials`, { path: `${entryPath}.ref` });
            }
        } else if (!OPAQUE_REF_PATTERN.test(reference) && !ROUTINE_ARTIFACT_REF_PATTERN.test(reference)) {
            fail('invalid_evidence_ref', `${entryPath}.ref must be a source-owned opaque reference`, { path: `${entryPath}.ref` });
        }
        return { kind, ref: reference, ...(label ? { label } : {}) };
    });
    return sortEvidenceRefs(refs);
}

function validateCount(value, path) {
    if (value === undefined || value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
        fail('invalid_count', `${path} must be a non-negative safe integer`, { path });
    }
    return value;
}

function validateCodeList(value, path, maxLength = 32) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail('invalid_array', `${path} must be an array`, { path });
    if (value.length > maxLength) fail('array_too_long', `${path} exceeds ${maxLength} entries`, { path, max_length: maxLength });
    return value.map((entry, index) => requireString(entry, `${path}[${index}]`, 120));
}

function validateStringList(value, path, maxLength = 32, itemMaxLength = 320) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail('invalid_array', `${path} must be an array`, { path });
    if (value.length > maxLength) fail('array_too_long', `${path} exceeds ${maxLength} entries`, {
        path,
        max_length: maxLength
    });
    return value.map((entry, index) => requireString(entry, `${path}[${index}]`, itemMaxLength));
}

function validateTraceState(value, path) {
    const state = value === undefined || value === null ? {} : requireObject(value, path);
    rejectUnknownKeys(state, TRACE_STATE_KEYS, path);
    const status = optionalEnum(state.status, `${path}.status`, TRACE_COVERAGE_STATES, 'unsupported_trace_status') || 'unknown';
    const evidenceRefs = validateEvidenceRefs(state.evidence_refs, `${path}.evidence_refs`, 32);
    if (status === 'confirmed' && evidenceRefs.length === 0) {
        fail('missing_trace_evidence', `${path}.status=confirmed requires evidence_refs`, { path });
    }
    return {
        status,
        evidence_refs: evidenceRefs,
        issue_codes: validateCodeList(state.issue_codes, `${path}.issue_codes`)
    };
}

function validateReplacement(value, path) {
    if (value === undefined || value === null) return undefined;
    const replacement = requireObject(value, path);
    rejectUnknownKeys(replacement, TRACE_REPLACEMENT_KEYS, path);
    const subjectType = optionalString(replacement.subject_type, `${path}.subject_type`, 120);
    const subjectId = optionalString(replacement.subject_id, `${path}.subject_id`, 300);
    const summary = optionalString(replacement.summary, `${path}.summary`, 500);
    const eventId = optionalString(replacement.event_id, `${path}.event_id`, 300);
    const evidenceRefs = validateEvidenceRefs(replacement.evidence_refs, `${path}.evidence_refs`, 32);
    return {
        ...(eventId ? { event_id: eventId } : {}),
        ...(subjectType ? { subject_type: subjectType } : {}),
        ...(subjectId ? { subject_id: subjectId } : {}),
        ...(summary ? { summary } : {}),
        evidence_refs: evidenceRefs
    };
}

function validateJudgmentTrace(value) {
    if (value === undefined || value === null) return undefined;
    const trace = requireObject(value, 'run.judgment_trace');
    rejectUnknownKeys(trace, TRACE_KEYS, 'run.judgment_trace');
    const schemaVersion = requireString(trace.schema_version, 'run.judgment_trace.schema_version', 80);
    if (schemaVersion !== JUDGMENT_TRACE_SCHEMA_VERSION) {
        fail('unsupported_judgment_trace_version', `run.judgment_trace.schema_version must be ${JUDGMENT_TRACE_SCHEMA_VERSION}`);
    }

    const dag = requireObject(trace.dag, 'run.judgment_trace.dag');
    rejectUnknownKeys(dag, TRACE_DAG_KEYS, 'run.judgment_trace.dag');
    const dagId = requireString(dag.id, 'run.judgment_trace.dag.id', 200);
    const dagVersion = requireString(dag.version, 'run.judgment_trace.dag.version', 120);
    const graphPlaybookStatus = optionalEnum(
        trace.graph_playbook_status,
        'run.judgment_trace.graph_playbook_status',
        TRACE_GRAPH_PLAYBOOK_STATUSES,
        'unsupported_graph_playbook_status'
    ) || 'unknown';

    if (!Array.isArray(trace.nodes)) fail('invalid_array', 'run.judgment_trace.nodes must be an array', { path: 'run.judgment_trace.nodes' });
    if (trace.nodes.length > 256) fail('array_too_long', 'run.judgment_trace.nodes exceeds 256 entries', {
        path: 'run.judgment_trace.nodes',
        max_length: 256
    });
    const nodes = trace.nodes.map((nodeValue, index) => {
        const path = `run.judgment_trace.nodes[${index}]`;
        const node = requireObject(nodeValue, path);
        rejectUnknownKeys(node, TRACE_NODE_KEYS, path);
        const id = requireString(node.id, `${path}.id`, 200);
        const nodeId = optionalString(node.node_id, `${path}.node_id`, 200);
        const status = requireEnum(node.status, `${path}.status`, TRACE_NODE_STATUSES, 'unsupported_trace_node_status');
        const outcome = optionalString(node.outcome, `${path}.outcome`, 120);
        const eventId = optionalString(node.event_id, `${path}.event_id`, 300);
        const sequence = node.sequence === undefined || node.sequence === null
            ? undefined
            : validateCount(node.sequence, `${path}.sequence`);
        const nodeVersion = optionalString(node.node_version, `${path}.node_version`, 120);
        const nextBranch = optionalString(node.next_branch, `${path}.next_branch`, 160);
        const startedAt = validateTimestamp(node.started_at, `${path}.started_at`);
        const finishedAt = validateTimestamp(node.finished_at, `${path}.finished_at`);
        const inputRefs = validateStringList(node.input_refs, `${path}.input_refs`, 32, 320);
        return {
            id,
            ...(nodeId ? { node_id: nodeId } : {}),
            status,
            ...(outcome ? { outcome } : {}),
            ...(eventId ? { event_id: eventId } : {}),
            ...(sequence !== undefined && sequence !== null ? { sequence } : {}),
            ...(nodeVersion ? { node_version: nodeVersion } : {}),
            ...(nextBranch ? { next_branch: nextBranch } : {}),
            ...(startedAt ? { started_at: startedAt.timestamp } : {}),
            ...(finishedAt ? { finished_at: finishedAt.timestamp } : {}),
            ...(inputRefs.length > 0 ? { input_refs: inputRefs } : {}),
            evidence_refs: validateEvidenceRefs(node.evidence_refs, `${path}.evidence_refs`, 32)
        };
    });

    const glossaryValue = trace.glossary === undefined || trace.glossary === null ? {} : requireObject(trace.glossary, 'run.judgment_trace.glossary');
    rejectUnknownKeys(glossaryValue, TRACE_GLOSSARY_KEYS, 'run.judgment_trace.glossary');
    const glossaryCoverage = optionalEnum(
        glossaryValue.coverage,
        'run.judgment_trace.glossary.coverage',
        TRACE_COVERAGE_STATES,
        'unsupported_glossary_coverage'
    ) || 'unknown';
    const termValues = glossaryValue.term_refs === undefined || glossaryValue.term_refs === null
        ? []
        : glossaryValue.term_refs;
    if (!Array.isArray(termValues)) fail('invalid_array', 'run.judgment_trace.glossary.term_refs must be an array', {
        path: 'run.judgment_trace.glossary.term_refs'
    });
    if (termValues.length > 256) fail('array_too_long', 'run.judgment_trace.glossary.term_refs exceeds 256 entries', {
        path: 'run.judgment_trace.glossary.term_refs',
        max_length: 256
    });
    const termRefs = termValues.map((termValue, index) => {
        const path = `run.judgment_trace.glossary.term_refs[${index}]`;
        const term = requireObject(termValue, path);
        rejectUnknownKeys(term, TRACE_TERM_KEYS, path);
        const termId = requireString(term.term_id, `${path}.term_id`, 300);
        const surfaceForm = optionalString(term.surface_form, `${path}.surface_form`, 160);
        const entityRef = optionalString(term.entity_ref, `${path}.entity_ref`, 300);
        return {
            term_id: termId,
            ...(surfaceForm ? { surface_form: surfaceForm } : {}),
            ...(entityRef ? { entity_ref: entityRef } : {}),
            evidence_refs: validateEvidenceRefs(term.evidence_refs, `${path}.evidence_refs`, 16)
        };
    });

    const correctionValues = trace.corrections === undefined || trace.corrections === null ? [] : trace.corrections;
    if (!Array.isArray(correctionValues)) fail('invalid_array', 'run.judgment_trace.corrections must be an array', {
        path: 'run.judgment_trace.corrections'
    });
    if (correctionValues.length > 128) fail('array_too_long', 'run.judgment_trace.corrections exceeds 128 entries', {
        path: 'run.judgment_trace.corrections',
        max_length: 128
    });
    const corrections = correctionValues.map((correctionValue, index) => {
        const path = `run.judgment_trace.corrections[${index}]`;
        const correction = requireObject(correctionValue, path);
        rejectUnknownKeys(correction, TRACE_CORRECTION_KEYS, path);
        const feedbackId = optionalString(correction.feedback_id, `${path}.feedback_id`, 300);
        const correctsEventId = requireString(correction.corrects_event_id, `${path}.corrects_event_id`, 300);
        const action = requireEnum(correction.action, `${path}.action`, TRACE_FEEDBACK_ACTIONS, 'unsupported_trace_feedback_action');
        const reason = optionalString(correction.reason, `${path}.reason`, 500);
        const replacement = validateReplacement(correction.replacement, `${path}.replacement`);
        return {
            ...(feedbackId ? { feedback_id: feedbackId } : {}),
            corrects_event_id: correctsEventId,
            action,
            ...(reason ? { reason } : {}),
            evidence_refs: validateEvidenceRefs(correction.evidence_refs, `${path}.evidence_refs`, 32),
            ...(replacement ? { replacement } : {})
        };
    });

    const replayValue = trace.replay === undefined || trace.replay === null ? {} : requireObject(trace.replay, 'run.judgment_trace.replay');
    rejectUnknownKeys(replayValue, TRACE_REPLAY_KEYS, 'run.judgment_trace.replay');
    const replayStatus = optionalEnum(
        replayValue.status,
        'run.judgment_trace.replay.status',
        TRACE_COVERAGE_STATES,
        'unsupported_replay_status'
    ) || 'unknown';
    const replayEvidenceRefs = validateEvidenceRefs(replayValue.evidence_refs, 'run.judgment_trace.replay.evidence_refs', 64);
    const changedVersionRefs = validateEvidenceRefs(
        replayValue.changed_version_refs,
        'run.judgment_trace.replay.changed_version_refs',
        16
    );
    const originalFailureRefs = validateEvidenceRefs(
        replayValue.original_failure_refs,
        'run.judgment_trace.replay.original_failure_refs',
        16
    );
    const separateCaseRefs = validateEvidenceRefs(
        replayValue.separate_case_refs,
        'run.judgment_trace.replay.separate_case_refs',
        16
    );
    if (replayStatus === 'confirmed'
        && (replayEvidenceRefs.length === 0
            || changedVersionRefs.length === 0
            || originalFailureRefs.length === 0
            || separateCaseRefs.length === 0
            || !hasIndependentEvidence(originalFailureRefs, separateCaseRefs))) {
        fail('missing_replay_evidence', 'run.judgment_trace.replay.status=confirmed requires changed version, original failure, and separate case evidence', {
            path: 'run.judgment_trace.replay'
        });
    }
    const verifiedRunIds = replayValue.verified_run_ids === undefined || replayValue.verified_run_ids === null
        ? []
        : replayValue.verified_run_ids;
    if (!Array.isArray(verifiedRunIds)) fail('invalid_array', 'run.judgment_trace.replay.verified_run_ids must be an array', {
        path: 'run.judgment_trace.replay.verified_run_ids'
    });
    if (verifiedRunIds.length > 32) fail('array_too_long', 'run.judgment_trace.replay.verified_run_ids exceeds 32 entries', {
        path: 'run.judgment_trace.replay.verified_run_ids',
        max_length: 32
    });

    return {
        schema_version: schemaVersion,
        dag: { id: dagId, version: dagVersion },
        graph_playbook_status: graphPlaybookStatus,
        nodes,
        glossary: {
            coverage: glossaryCoverage,
            term_refs: termRefs,
            unresolved_count: validateCount(glossaryValue.unresolved_count, 'run.judgment_trace.glossary.unresolved_count')
        },
        quality: validateTraceState(trace.quality, 'run.judgment_trace.quality'),
        corrections,
        replay: {
            status: replayStatus,
            evidence_refs: replayEvidenceRefs,
            verified_run_ids: verifiedRunIds.map((value, index) => requireString(value, `run.judgment_trace.replay.verified_run_ids[${index}]`, 300)),
            changed_version_refs: changedVersionRefs,
            original_failure_refs: originalFailureRefs,
            separate_case_refs: separateCaseRefs
        }
    };
}

export function createRunReceiptIdentity({ projectId, sourceType, externalRunId, sourceWorkflowId }) {
    const digest = sha256(JSON.stringify([projectId, sourceType, externalRunId]));
    const workflowDigest = sha256(JSON.stringify([projectId, sourceType, sourceWorkflowId]));
    return {
        digest,
        idempotency_key: `rr1_${digest}`,
        run_id: `run_receipt_run_${digest.slice(0, 32)}`,
        workflow_id: `run_receipt_wf_${workflowDigest.slice(0, 32)}`
    };
}

function projectStatus(status, sourceAction) {
    const defaults = {
        success: ['success', 'closed', 'none', false],
        failed: ['failed', 'needs_action', 'check_error', false],
        blocked: ['needs_action', 'needs_action', 'resolve_blocker', false],
        waiting_human: ['waiting_human', 'open', 'review_run', true],
        cancelled: ['cancelled', 'closed', 'none', false]
    };
    const [wmcStatus, closureState, defaultAction, humanWaiting] = defaults[status];
    return {
        status: wmcStatus,
        closure_state: closureState,
        action_required: sourceAction && sourceAction !== 'none' ? sourceAction : defaultAction,
        human_waiting: humanWaiting
    };
}

export function normalizeRunReceipt(payload) {
    const envelope = requireObject(payload, 'receipt');
    rejectForbiddenKeys(envelope);
    rejectUnknownKeys(envelope, TOP_LEVEL_KEYS, 'receipt');
    if (envelope.contract_version !== CONTRACT_VERSION) {
        fail('unsupported_contract_version', `contract_version must be ${CONTRACT_VERSION}`);
    }

    const sourceValue = requireObject(envelope.source, 'source');
    const runValue = requireObject(envelope.run, 'run');
    const deliveryValue = requireObject(envelope.delivery, 'delivery');
    rejectUnknownKeys(sourceValue, SOURCE_KEYS, 'source');
    rejectUnknownKeys(runValue, RUN_KEYS, 'run');
    rejectUnknownKeys(deliveryValue, DELIVERY_KEYS, 'delivery');

    const source = {
        type: requireEnum(sourceValue.type, 'source.type', SOURCE_TYPES, 'unsupported_source_type'),
        workflow_id: requireString(sourceValue.workflow_id, 'source.workflow_id'),
        ...(optionalString(sourceValue.name, 'source.name', 120) ? { name: sourceValue.name } : {}),
        ...(optionalString(sourceValue.runtime_target, 'source.runtime_target', 120)
            ? { runtime_target: sourceValue.runtime_target }
            : {})
    };
    const startedAt = validateTimestamp(runValue.started_at, 'run.started_at');
    const finishedAt = validateTimestamp(runValue.finished_at, 'run.finished_at');
    if (!startedAt && !finishedAt) fail('missing_timestamp', 'run.started_at or run.finished_at is required');
    if (startedAt && finishedAt && finishedAt.epoch < startedAt.epoch) {
        fail('invalid_timestamp_order', 'run.finished_at may not precede run.started_at');
    }
    const evidenceRefs = validateEvidenceRefs(runValue.evidence_refs);
    const metrics = validateMetrics(runValue.metrics);
    const judgmentTrace = validateJudgmentTrace(runValue.judgment_trace);
    const actionRequired = optionalEnum(
        runValue.action_required,
        'run.action_required',
        ACTIONS,
        'unsupported_action_required'
    );
    const run = {
        project_id: requireString(runValue.project_id, 'run.project_id'),
        external_run_id: requireString(runValue.external_run_id, 'run.external_run_id'),
        status: requireEnum(runValue.status, 'run.status', RUN_STATUSES, 'unsupported_run_status'),
        evidence_state: requireEnum(
            runValue.evidence_state,
            'run.evidence_state',
            EVIDENCE_STATES,
            'unsupported_evidence_state'
        ),
        observation_kind: optionalEnum(
            runValue.observation_kind,
            'run.observation_kind',
            OBSERVATION_KINDS,
            'unsupported_observation_kind'
        ) || 'source_run',
        ...(optionalString(runValue.org_id, 'run.org_id', 200) ? { org_id: runValue.org_id } : {}),
        ...(optionalString(runValue.parent_external_run_id, 'run.parent_external_run_id', 200)
            ? { parent_external_run_id: runValue.parent_external_run_id }
            : {}),
        ...(optionalString(runValue.workflow_name, 'run.workflow_name', 120)
            ? { workflow_name: runValue.workflow_name }
            : {}),
        ...(startedAt ? { started_at: startedAt.timestamp } : {}),
        ...(finishedAt ? { finished_at: finishedAt.timestamp } : {}),
        ...(optionalString(runValue.summary, 'run.summary', 500) ? { summary: runValue.summary } : {}),
        ...(optionalString(runValue.blocker_reason, 'run.blocker_reason', 300)
            ? { blocker_reason: runValue.blocker_reason }
            : {}),
        ...(actionRequired ? { action_required: actionRequired } : {}),
        ...(metrics !== undefined ? { metrics } : {}),
        ...(judgmentTrace !== undefined ? { judgment_trace: judgmentTrace } : {}),
        evidence_refs: evidenceRefs
    };

    if (run.evidence_state === 'confirmed' && evidenceRefs.length === 0) {
        fail('missing_confirmed_evidence', 'evidence_state=confirmed requires at least one evidence reference');
    }
    if (['failed', 'blocked'].includes(run.status)
        && !run.blocker_reason
        && (!run.action_required || run.action_required === 'none')) {
        fail('missing_failure_action', `run.status=${run.status} requires blocker_reason or non-none action_required`);
    }
    const isConnectorObservation = run.observation_kind === 'connector_observation';
    const usesConnectorObservationIdentity = source.workflow_id === '__connector_observation__';
    if (isConnectorObservation !== usesConnectorObservationIdentity) {
        fail('invalid_connector_observation', 'connector_observation identity and kind must match');
    }
    if (isConnectorObservation) {
        const valid = run.status === 'blocked'
            && ['no_data', 'unconfirmed'].includes(run.evidence_state)
            && Boolean(run.blocker_reason);
        if (!valid) fail('invalid_connector_observation', 'connector_observation invariants are not satisfied');
    }

    const identity = createRunReceiptIdentity({
        projectId: run.project_id,
        sourceType: source.type,
        externalRunId: run.external_run_id,
        sourceWorkflowId: source.workflow_id
    });
    const idempotencyKey = requireString(deliveryValue.idempotency_key, 'delivery.idempotency_key', 68);
    if (idempotencyKey !== identity.idempotency_key) {
        fail('invalid_idempotency_key', 'delivery.idempotency_key does not match the canonical receipt identity');
    }
    if (deliveryValue.attempt !== undefined
        && (!Number.isSafeInteger(deliveryValue.attempt) || deliveryValue.attempt < 1)) {
        fail('invalid_delivery_attempt', 'delivery.attempt must be a positive safe integer');
    }
    const sentAt = validateTimestamp(deliveryValue.sent_at, 'delivery.sent_at');
    const delivery = {
        idempotency_key: idempotencyKey,
        ...(deliveryValue.attempt !== undefined ? { attempt: deliveryValue.attempt } : {}),
        ...(sentAt ? { sent_at: sentAt.timestamp } : {})
    };
    const immutable = stableValue({
        contract_version: CONTRACT_VERSION,
        source,
        run
    });
    return {
        contract_version: CONTRACT_VERSION,
        source,
        run,
        delivery,
        immutable,
        identity,
        payload_digest: sha256(compactJson(immutable)),
        projection: projectStatus(run.status, run.action_required)
    };
}
