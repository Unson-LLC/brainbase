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
    'evidence_refs'
]);
const DELIVERY_KEYS = new Set(['idempotency_key', 'attempt', 'sent_at']);
const EVIDENCE_KEYS = new Set(['kind', 'ref', 'label']);
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

function validateEvidenceRefs(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail('invalid_array', 'run.evidence_refs must be an array', { path: 'run.evidence_refs' });
    const refs = value.map((entry, index) => {
        const path = `run.evidence_refs[${index}]`;
        const ref = requireObject(entry, path);
        rejectUnknownKeys(ref, EVIDENCE_KEYS, path);
        const kind = requireEnum(ref.kind, `${path}.kind`, EVIDENCE_KINDS, 'unsupported_evidence_kind');
        const reference = requireString(ref.ref, `${path}.ref`, 2048);
        const label = optionalString(ref.label, `${path}.label`, 120);
        if (EMBEDDED_CREDENTIAL_PATTERN.test(reference)) {
            fail('invalid_evidence_ref', `${path}.ref must not contain embedded credentials`, { path: `${path}.ref` });
        }
        if (kind === 'url') {
            let parsed;
            try {
                parsed = new URL(reference);
            } catch {
                fail('invalid_evidence_ref', `${path}.ref must be an absolute HTTPS URL`, { path: `${path}.ref` });
            }
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                fail('invalid_evidence_ref', `${path}.ref must be an absolute HTTPS URL without credentials`, { path: `${path}.ref` });
            }
        } else if (!OPAQUE_REF_PATTERN.test(reference) && !ROUTINE_ARTIFACT_REF_PATTERN.test(reference)) {
            fail('invalid_evidence_ref', `${path}.ref must be a source-owned opaque reference`, { path: `${path}.ref` });
        }
        return { kind, ref: reference, ...(label ? { label } : {}) };
    });
    return sortEvidenceRefs(refs);
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
