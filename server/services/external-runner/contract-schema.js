// @ts-check

import { validateObservedExecutionRequest } from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';

const CONTRACT_VERSION = 'external_runner.v0';
const ALLOWED_RUNNER_TYPES = new Set(['cloudflare_computer', 'agent_report']);
const ALLOWED_RUN_STATUSES = new Set(['completed', 'approval_required', 'waiting_human', 'blocked', 'cancelled', 'failed']);
const ALLOWED_RUN_TRIGGER_TYPES = new Set(['human', 'event', 'schedule', 'external_runner']);
const ALLOWED_AUTONOMY_LEVELS = new Set(['human_only', 'draft_only', 'approval_required', 'auto_execute']);
const ALLOWED_ELIGIBILITY_STATUSES = new Set(['human_only', 'eligible', 'needs_approval', 'blocked']);
const APPROVAL_REQUIRED_STATUSES = new Set(['approval_required', 'waiting_human']);
const ALLOWED_COGNITIVE_TYPES = new Set(['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result']);

export class ExternalRunnerContractError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'ExternalRunnerContractError';
        this.code = code;
        this.details = details;
    }
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, path) {
    if (!isObject(value)) {
        throw new ExternalRunnerContractError('invalid_object', `${path} must be an object`, { path });
    }
    return value;
}

function requireString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ExternalRunnerContractError('missing_string', `${path} is required`, { path });
    }
    return value.trim();
}

function validateOptionalString(value, path) {
    if (value === undefined || value === null) return null;
    return requireString(value, path);
}

function validateOptionalEnum(value, path, allowed, code) {
    const normalized = validateOptionalString(value, path);
    if (normalized === null) return null;
    if (!allowed.has(normalized)) {
        throw new ExternalRunnerContractError(
            code,
            `${path}=${normalized} is not supported`,
            { path, value: normalized }
        );
    }
    return normalized;
}

function requireArray(value, path) {
    if (!Array.isArray(value)) {
        throw new ExternalRunnerContractError('invalid_array', `${path} must be an array`, { path });
    }
    return value;
}

function validateOptionalArray(value, path) {
    if (value === undefined || value === null) return [];
    return requireArray(value, path);
}

function validateLoopControl(loopControl) {
    const control = requireObject(loopControl, 'loop_control');
    requireString(control.owner_id, 'loop_control.owner_id');
    requireString(control.cost_owner_id, 'loop_control.cost_owner_id');
    requireString(control.approval_owner_id, 'loop_control.approval_owner_id');
    const stopConditions = requireArray(control.stop_conditions, 'loop_control.stop_conditions');
    if (stopConditions.length === 0) {
        throw new ExternalRunnerContractError(
            'missing_stop_condition',
            'loop_control.stop_conditions must contain at least one stop condition'
        );
    }
    stopConditions.forEach((condition, index) => {
        requireString(condition, `loop_control.stop_conditions[${index}]`);
    });
}

function validateContextSources(contextSources) {
    const sources = requireArray(contextSources, 'context_sources');
    if (sources.length === 0) {
        throw new ExternalRunnerContractError('missing_context_source', 'context_sources must contain at least one source');
    }
    sources.forEach((source, index) => {
        requireObject(source, `context_sources[${index}]`);
        requireString(source.source_type, `context_sources[${index}].source_type`);
        requireString(source.source_ref, `context_sources[${index}].source_ref`);
        if (source.redaction_status === 'blocked') {
            throw new ExternalRunnerContractError(
                'blocked_context_source',
                `context_sources[${index}] is blocked by redaction_status`,
                { index }
            );
        }
    });
}

function validateRounds(rounds) {
    const runnerRounds = requireArray(rounds, 'rounds');
    if (runnerRounds.length === 0) {
        throw new ExternalRunnerContractError('missing_round', 'rounds must contain at least one runner round');
    }
    runnerRounds.forEach((round, index) => {
        requireObject(round, `rounds[${index}]`);
        requireString(round.round_id, `rounds[${index}].round_id`);
        requireString(round.status, `rounds[${index}].status`);
        const evidenceRefs = requireArray(round.evidence_refs, `rounds[${index}].evidence_refs`);
        if (evidenceRefs.length === 0) {
            throw new ExternalRunnerContractError('missing_round_evidence', `rounds[${index}] must include evidence_refs`, { index });
        }
    });
}

const COMPANY_AUTHORITY_HANDOFF_FIELDS = new Set([
    'observed_request',
    'authority_response',
    'execution_hash',
    'handoff_idempotency_key',
    'target_approver_id',
    'requested_by'
]);

function validateCompanyAuthorityHumanApprovalHandoff(handoff, path) {
    const value = requireObject(handoff, path);
    for (const key of Object.keys(value)) {
        if (!COMPANY_AUTHORITY_HANDOFF_FIELDS.has(key)) {
            throw new ExternalRunnerContractError(
                'unknown_company_authority_handoff_field',
                `${path}.${key} is not allowed`,
                { path: `${path}.${key}` }
            );
        }
    }
    for (const field of ['observed_request', 'authority_response']) {
        requireObject(value[field], `${path}.${field}`);
    }
    try {
        validateObservedExecutionRequest(value.observed_request);
    } catch (error) {
        throw new ExternalRunnerContractError(
            'invalid_company_authority_observed_request',
            `${path}.observed_request is not a valid Company Authority request`,
            { path: `${path}.observed_request`, cause: error?.code || error?.message }
        );
    }
    requireString(value.handoff_idempotency_key, `${path}.handoff_idempotency_key`);
    requireString(value.target_approver_id, `${path}.target_approver_id`);
    validateOptionalString(value.execution_hash, `${path}.execution_hash`);
    validateOptionalString(value.requested_by, `${path}.requested_by`);
    return value;
}

function validateHumanSteps(payload) {
    const status = payload.run?.status;
    const allSteps = validateOptionalArray(payload.human_steps, 'human_steps');
    allSteps.forEach((step, index) => {
        requireObject(step, `human_steps[${index}]`);
        if (Object.prototype.hasOwnProperty.call(step, 'company_authority_handoff')) {
            if (!APPROVAL_REQUIRED_STATUSES.has(status)) {
                throw new ExternalRunnerContractError(
                    'company_authority_human_approval_requires_waiting_human',
                    `human_steps[${index}].company_authority_handoff requires run.status=${[...APPROVAL_REQUIRED_STATUSES].join(' or ')}`,
                    { index, status }
                );
            }
            validateCompanyAuthorityHumanApprovalHandoff(
                step.company_authority_handoff,
                `human_steps[${index}].company_authority_handoff`
            );
        }
    });
    if (!APPROVAL_REQUIRED_STATUSES.has(status)) return;
    if (allSteps.length === 0) {
        throw new ExternalRunnerContractError(
            'missing_human_step',
            `run.status=${status} requires at least one human_steps entry`
        );
    }
    allSteps.forEach((step, index) => {
        const actionableText = [step.prompt, step.title, step.description, step.approval_reason]
            .some((value) => typeof value === 'string' && value.trim() !== '');
        if (!actionableText) {
            throw new ExternalRunnerContractError(
                'missing_human_prompt',
                `human_steps[${index}] requires an actionable prompt, title, description, or approval_reason`,
                { index }
            );
        }
    });
}

function validateRunEligibility(eligibility) {
    if (eligibility === undefined || eligibility === null) return;
    const value = requireObject(eligibility, 'run.eligibility');
    validateOptionalEnum(
        value.status,
        'run.eligibility.status',
        ALLOWED_ELIGIBILITY_STATUSES,
        'unsupported_eligibility_status'
    );
    validateOptionalEnum(
        value.autonomy_level,
        'run.eligibility.autonomy_level',
        ALLOWED_AUTONOMY_LEVELS,
        'unsupported_autonomy_level'
    );
    if (value.requires_human_approval !== undefined && typeof value.requires_human_approval !== 'boolean') {
        throw new ExternalRunnerContractError(
            'invalid_boolean',
            'run.eligibility.requires_human_approval must be a boolean',
            { path: 'run.eligibility.requires_human_approval' }
        );
    }
}

function validateLearningCandidates(candidates) {
    const learningCandidates = validateOptionalArray(candidates, 'learning_candidates');
    learningCandidates.forEach((candidate, index) => {
        requireObject(candidate, `learning_candidates[${index}]`);
        requireString(candidate.candidate_id, `learning_candidates[${index}].candidate_id`);
        const cognitiveType = requireString(candidate.cognitive_type, `learning_candidates[${index}].cognitive_type`);
        if (!ALLOWED_COGNITIVE_TYPES.has(cognitiveType)) {
            throw new ExternalRunnerContractError(
                'invalid_cognitive_type',
                `learning_candidates[${index}].cognitive_type is not supported`,
                { index, cognitive_type: cognitiveType }
            );
        }
        requireString(candidate.body, `learning_candidates[${index}].body`);
        if (candidate.promotion_policy === 'auto_promote') {
            throw new ExternalRunnerContractError(
                'forbidden_auto_promotion',
                'external runners cannot auto-promote learning candidates into Graph SSOT',
                { index }
            );
        }
        if (candidate.redaction_status === 'blocked') {
            throw new ExternalRunnerContractError(
                'blocked_learning_candidate',
                `learning_candidates[${index}] is blocked by redaction_status`,
                { index }
            );
        }
    });
}

function validateOutputs(outputs) {
    const runnerOutputs = validateOptionalArray(outputs, 'outputs');
    runnerOutputs.forEach((output, index) => {
        requireObject(output, `outputs[${index}]`);
    });
}

export function validateExternalRunnerEnvelope(payload) {
    const envelope = requireObject(payload, 'payload');
    if (envelope.contract_version !== CONTRACT_VERSION) {
        throw new ExternalRunnerContractError(
            'unsupported_contract_version',
            `contract_version must be ${CONTRACT_VERSION}`
        );
    }
    const runner = requireObject(envelope.runner, 'runner');
    const runnerType = requireString(runner.type, 'runner.type');
    if (!ALLOWED_RUNNER_TYPES.has(runnerType)) {
        throw new ExternalRunnerContractError('unsupported_runner_type', `runner.type=${runnerType} is not supported`);
    }
    requireString(runner.external_run_id, 'runner.external_run_id');
    requireString(runner.agent_id, 'runner.agent_id');
    if (runnerType === 'cloudflare_computer') {
        requireString(runner.trace_ref, 'runner.trace_ref');
    }
    // agent_report runners are CLI-submitted markdown reports (bb-report-submit).
    // They do not have a hosted-runtime trace, so runner.trace_ref is not required.

    const run = requireObject(envelope.run, 'run');
    requireString(run.project_id, 'run.project_id');
    validateOptionalString(run.org_id, 'run.org_id');
    validateOptionalString(run.role_agent_instance_id, 'run.role_agent_instance_id');
    validateOptionalString(run.workflow_template_id, 'run.workflow_template_id');
    validateOptionalString(run.workflow_binding_id, 'run.workflow_binding_id');
    validateOptionalString(run.trigger_id, 'run.trigger_id');
    validateOptionalString(run.loop_intent_id, 'run.loop_intent_id');
    validateOptionalEnum(run.trigger_type, 'run.trigger_type', ALLOWED_RUN_TRIGGER_TYPES, 'unsupported_trigger_type');
    validateRunEligibility(run.eligibility);
    requireString(run.role_agent_id, 'run.role_agent_id');
    const runStatus = requireString(run.status, 'run.status');
    if (!ALLOWED_RUN_STATUSES.has(runStatus)) {
        throw new ExternalRunnerContractError(
            'unsupported_run_status',
            `run.status=${runStatus} is not supported by external_runner.v0`,
            { status: runStatus }
        );
    }
    validateLoopControl(envelope.loop_control);
    validateContextSources(envelope.context_sources);
    validateRounds(envelope.rounds);
    validateHumanSteps(envelope);
    validateOutputs(envelope.outputs);
    validateLearningCandidates(envelope.learning_candidates);
    return envelope;
}
