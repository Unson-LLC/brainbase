const FIELDS = new Set([
    'schema_version', 'host', 'execution_id', 'turn_id', 'scope', 'status', 'stage',
    'failure', 'resume_from', 'evidence'
]);
const HOST_FIELDS = new Set(['type', 'adapter_id', 'adapter_version']);
const FAILURE_FIELDS = new Set(['code', 'summary', 'upstream_code', 'retryable']);
const EVIDENCE_FIELDS = new Set(['state', 'refs']);
const STATUSES = new Set(['completed', 'partial', 'failed', 'blocked', 'unknown']);
const STAGES = new Set(['open', 'resolve', 'execute', 'finalize', 'deliver', 'readback']);
const EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);
const HOST_TYPES = new Set(['codex', 'claude-code']);
const SCOPES = new Set(['host_turn', 'external_effect']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function object(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
    return value;
}

function exact(value, allowed, field) {
    object(value, field);
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${field}.${key} is not allowed`);
}

function id(value, field) {
    if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${field} is invalid`);
    return value;
}

function text(value, field) {
    if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
        throw new TypeError(`${field} is invalid`);
    }
    return value;
}

function ref(value, field) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new TypeError(`${field} is invalid`);
    }
    return value;
}

function evidenceRef(value, field) {
    const normalized = ref(value, field);
    if (normalized.startsWith('/') || /^file:/iu.test(normalized)) {
        throw new TypeError(`${field} is invalid`);
    }
    return normalized;
}

export function normalizeJudgmentExecutionOutcome(input) {
    exact(input, FIELDS, 'outcome');
    if (input.schema_version !== 'judgment_execution_outcome.v1') throw new TypeError('schema_version is invalid');
    exact(input.host, HOST_FIELDS, 'host');
    const host = {
        type: id(input.host.type, 'host.type'),
        adapter_id: id(input.host.adapter_id, 'host.adapter_id'),
        adapter_version: id(input.host.adapter_version, 'host.adapter_version')
    };
    if (!HOST_TYPES.has(host.type)) throw new TypeError('host.type is not registered');
    if (!SCOPES.has(input.scope)) throw new TypeError('scope is invalid');
    if (!STATUSES.has(input.status)) throw new TypeError('status is invalid');
    if (!STAGES.has(input.stage)) throw new TypeError('stage is invalid');
    exact(input.evidence, EVIDENCE_FIELDS, 'evidence');
    if (!EVIDENCE_STATES.has(input.evidence.state)) throw new TypeError('evidence.state is invalid');
    if (!Array.isArray(input.evidence.refs)) throw new TypeError('evidence.refs is invalid');
    let evidenceRefs;
    try {
        evidenceRefs = input.evidence.refs.map((reference, index) => evidenceRef(reference, `evidence.refs[${index}]`));
    } catch {
        throw new TypeError('evidence.refs is invalid');
    }
    const incomplete = input.status !== 'completed';
    if (incomplete && (!input.failure || !input.resume_from)) {
        throw new TypeError('failure and resume_from are required for a non-completed outcome');
    }
    let failure = null;
    if (input.failure != null) {
        exact(input.failure, FAILURE_FIELDS, 'failure');
        failure = {
            code: id(input.failure.code, 'failure.code'),
            summary: text(input.failure.summary, 'failure.summary'),
            upstream_code: input.failure.upstream_code == null ? null : id(input.failure.upstream_code, 'failure.upstream_code'),
            retryable: input.failure.retryable
        };
        if (typeof failure.retryable !== 'boolean') throw new TypeError('failure.retryable is invalid');
    }
    if (input.status === 'completed' && (failure || input.resume_from != null)) {
        throw new TypeError('completed outcome cannot have failure or resume_from');
    }
    if (input.status === 'completed'
        && (input.evidence.state !== 'confirmed' || input.evidence.refs.length === 0)) {
        throw new TypeError('completed outcome requires confirmed evidence refs');
    }
    if (input.status === 'completed' && input.scope === 'external_effect' && input.stage !== 'readback') {
        throw new TypeError('completed external effect requires readback');
    }
    if (input.status === 'completed' && input.scope === 'host_turn' && input.stage !== 'finalize') {
        throw new TypeError('completed host turn requires finalize');
    }
    return {
        schema_version: input.schema_version,
        host,
        execution_id: ref(input.execution_id, 'execution_id'),
        turn_id: ref(input.turn_id, 'turn_id'),
        scope: input.scope,
        status: input.status,
        stage: input.stage,
        failure,
        resume_from: input.resume_from == null ? null : id(input.resume_from, 'resume_from'),
        evidence: { state: input.evidence.state, refs: evidenceRefs }
    };
}
