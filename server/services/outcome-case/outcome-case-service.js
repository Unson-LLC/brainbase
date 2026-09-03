import crypto from 'crypto';

const CLOSURE_STATUSES = new Set(['open', 'incomplete', 'waiting_human', 'closed']);
const EXTERNAL_STATES = new Set([
    'unknown', 'accepted', 'processing', 'delivered', 'verified-complete', 'failed'
]);
const EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);
const READBACK_STATES = new Set(['confirm', 'unconfirmed', 'no_data']);
const CONSTRAINT_STATES = new Set(['satisfied', 'violated', 'unknown']);
const CREATE_FIELDS = new Set([
    'case_id', 'project_code', 'capability_id', 'user_observable_outcome',
    'protected_constraints', 'non_goals', 'authority', 'selected_domain_pack',
    'current_external_state', 'technical_story_refs', 'run_receipt_refs',
    'prior_attempt_refs', 'unresolved_failure_boundary'
]);
const EVALUATION_FIELDS = new Set([
    'technical_evidence', 'run_receipt_refs', 'external_readback', 'constraints_status',
    'evaluator', 'observed_at', 'current_external_state', 'unresolved_failure_boundary'
]);

export class OutcomeCaseError extends Error {
    constructor(code, message, { status = 422, details = null } = {}) {
        super(message);
        this.name = 'OutcomeCaseError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function validation(message, details = null) {
    return new OutcomeCaseError('validation_failed', message, { details });
}

function requireString(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw validation(`${field} is required`, { field });
    return value.trim();
}

function requireArray(value, field) {
    if (!Array.isArray(value)) throw validation(`${field} must be an array`, { field });
    return value.map((item, index) => requireString(item, `${field}[${index}]`));
}

function requirePlainObject(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw validation(`${field} must be an object`, { field });
    }
    return structuredClone(value);
}

function requireEnum(value, field, allowed) {
    if (!allowed.has(value)) throw validation(`${field} is not supported`, { field, value });
    return value;
}

function requireIsoTimestamp(value, field) {
    const normalized = requireString(value, field);
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw validation(`${field} must be an ISO timestamp`, { field });
    return parsed.toISOString();
}

function rejectUnknownFields(value, allowed, subject) {
    const unknown = Object.keys(value || {}).filter((key) => !allowed.has(key));
    if (unknown.length) throw validation(`${subject} contains unsupported fields`, { fields: unknown });
}

function uniqueRefs(value, field) {
    return [...new Set(requireArray(value, field))];
}

function clone(value) {
    return structuredClone(value);
}

function normalizeCreate(input, { now, generateCaseId }) {
    requirePlainObject(input, 'OutcomeCase');
    rejectUnknownFields(input, CREATE_FIELDS, 'OutcomeCase');
    const nowIso = now.toISOString();
    return {
        case_id: input.case_id === undefined ? generateCaseId() : requireString(input.case_id, 'case_id'),
        project_code: requireString(input.project_code, 'project_code'),
        capability_id: requireString(input.capability_id, 'capability_id'),
        user_observable_outcome: requireString(input.user_observable_outcome, 'user_observable_outcome'),
        protected_constraints: requireArray(input.protected_constraints, 'protected_constraints'),
        non_goals: requireArray(input.non_goals, 'non_goals'),
        authority: requirePlainObject(input.authority, 'authority'),
        selected_domain_pack: requireString(input.selected_domain_pack, 'selected_domain_pack'),
        terminal_evaluation: null,
        closure_status: 'open',
        current_external_state: requireEnum(
            input.current_external_state,
            'current_external_state',
            EXTERNAL_STATES
        ),
        technical_story_refs: uniqueRefs(input.technical_story_refs, 'technical_story_refs'),
        run_receipt_refs: uniqueRefs(input.run_receipt_refs, 'run_receipt_refs'),
        prior_attempt_refs: uniqueRefs(input.prior_attempt_refs, 'prior_attempt_refs'),
        unresolved_failure_boundary: input.unresolved_failure_boundary === null
            ? null
            : requireString(input.unresolved_failure_boundary, 'unresolved_failure_boundary'),
        revision: 1,
        created_at: nowIso,
        updated_at: nowIso
    };
}

function normalizeEvaluation(input) {
    requirePlainObject(input, 'evaluation');
    rejectUnknownFields(input, EVALUATION_FIELDS, 'evaluation');
    const technicalEvidence = requirePlainObject(input.technical_evidence, 'technical_evidence');
    rejectUnknownFields(technicalEvidence, new Set(['status', 'refs']), 'technical_evidence');
    const technicalStatus = requireEnum(technicalEvidence.status, 'technical_evidence.status', EVIDENCE_STATES);
    const technicalRefs = uniqueRefs(technicalEvidence.refs, 'technical_evidence.refs');
    if (technicalStatus === 'confirmed' && technicalRefs.length === 0) {
        throw validation('technical_evidence.refs is required when technical evidence is confirmed');
    }

    const externalReadback = requirePlainObject(input.external_readback, 'external_readback');
    rejectUnknownFields(externalReadback, new Set(['status', 'ref']), 'external_readback');
    const externalReadbackStatus = requireEnum(externalReadback.status, 'external_readback.status', READBACK_STATES);
    const externalReadbackRef = externalReadback.ref === undefined
        ? null
        : requireString(externalReadback.ref, 'external_readback.ref');
    if (externalReadbackStatus === 'confirm' && !externalReadbackRef) {
        throw validation('external_readback.ref is required when external readback is confirm');
    }

    return {
        technical_evidence: { status: technicalStatus, refs: technicalRefs },
        run_receipt_refs: uniqueRefs(input.run_receipt_refs, 'run_receipt_refs'),
        external_readback: { status: externalReadbackStatus, ref: externalReadbackRef },
        constraints_status: requireEnum(input.constraints_status, 'constraints_status', CONSTRAINT_STATES),
        evaluator: requireString(input.evaluator, 'evaluator'),
        observed_at: requireIsoTimestamp(input.observed_at, 'observed_at'),
        current_external_state: input.current_external_state === undefined
            ? undefined
            : requireEnum(input.current_external_state, 'current_external_state', EXTERNAL_STATES),
        unresolved_failure_boundary: input.unresolved_failure_boundary === undefined
            ? undefined
            : input.unresolved_failure_boundary === null
                ? null
                : requireString(input.unresolved_failure_boundary, 'unresolved_failure_boundary')
    };
}

export function deriveClosureStatus({ technicalEvidence, runReceipts, externalReadback, constraintsStatus }) {
    const allReceiptsConfirmed = runReceipts.length > 0
        && runReceipts.every((receipt) => receipt.evidence_state === 'confirmed');
    const closeEligible = technicalEvidence.status === 'confirmed'
        && allReceiptsConfirmed
        && externalReadback.status === 'confirm'
        && constraintsStatus === 'satisfied';
    if (closeEligible) return { closure_status: 'closed', close_eligible: true };
    if (externalReadback.status === 'no_data'
        || constraintsStatus === 'unknown'
        || runReceipts.some((receipt) => receipt.evidence_state === 'no_data')) {
        return { closure_status: 'waiting_human', close_eligible: false };
    }
    return { closure_status: 'incomplete', close_eligible: false };
}

export class OutcomeCaseService {
    constructor({ repository, readRunReceipt, now = () => new Date(), generateCaseId = () => `oc_${crypto.randomUUID()}` } = {}) {
        if (!repository) throw new Error('OutcomeCaseService requires repository');
        if (typeof readRunReceipt !== 'function') throw new Error('OutcomeCaseService requires readRunReceipt');
        this.repository = repository;
        this.readRunReceipt = readRunReceipt;
        this.now = now;
        this.generateCaseId = generateCaseId;
    }

    async create(input, actor = {}) {
        const outcomeCase = normalizeCreate(input, { now: this.now(), generateCaseId: this.generateCaseId });
        const existing = await this.repository.findByCaseId(outcomeCase.case_id);
        if (existing) throw new OutcomeCaseError('outcome_case_already_exists', 'OutcomeCase already exists', { status: 409 });
        return this.repository.create(outcomeCase, actor);
    }

    async read(caseId, actor = {}) {
        const outcomeCase = await this.repository.findByCaseId(requireString(caseId, 'case_id'), actor);
        if (!outcomeCase) throw new OutcomeCaseError('outcome_case_not_found', 'OutcomeCase not found', { status: 404 });
        return outcomeCase;
    }

    async evaluate(caseId, input, actor = {}) {
        const outcomeCase = await this.read(caseId, actor);
        const evaluation = normalizeEvaluation(input);
        const runReceipts = await Promise.all(evaluation.run_receipt_refs.map(async (runReceiptRef) => {
            const receipt = await this.readRunReceipt({
                projectCode: outcomeCase.project_code,
                runReceiptRef,
                actor
            });
            return {
                ref: runReceiptRef,
                evidence_state: EVIDENCE_STATES.has(receipt?.evidence_state)
                    ? receipt.evidence_state
                    : 'no_data'
            };
        }));
        const closure = deriveClosureStatus({
            technicalEvidence: evaluation.technical_evidence,
            runReceipts,
            externalReadback: evaluation.external_readback,
            constraintsStatus: evaluation.constraints_status
        });
        const updated = {
            ...clone(outcomeCase),
            run_receipt_refs: evaluation.run_receipt_refs,
            terminal_evaluation: {
                technical_evidence: evaluation.technical_evidence,
                run_receipts: runReceipts,
                external_readback: evaluation.external_readback,
                constraints_status: evaluation.constraints_status,
                evaluator: evaluation.evaluator,
                observed_at: evaluation.observed_at,
                close_eligible: closure.close_eligible
            },
            closure_status: closure.closure_status,
            current_external_state: evaluation.current_external_state ?? outcomeCase.current_external_state,
            unresolved_failure_boundary: evaluation.unresolved_failure_boundary === undefined
                ? outcomeCase.unresolved_failure_boundary
                : evaluation.unresolved_failure_boundary,
            revision: Number(outcomeCase.revision) + 1,
            updated_at: this.now().toISOString()
        };
        return this.repository.update(updated, { expectedRevision: outcomeCase.revision, actor });
    }
}

export const OUTCOME_CASE_CLOSURE_STATUSES = CLOSURE_STATUSES;
