// @ts-check

const CONTRACT_VERSION = 'external_runner.v0';
const ALLOWED_RUNNER_TYPES = new Set(['eve']);
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

function validateHumanSteps(payload) {
    const status = payload.run?.status;
    const allSteps = validateOptionalArray(payload.human_steps, 'human_steps');
    allSteps.forEach((step, index) => {
        requireObject(step, `human_steps[${index}]`);
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
    if (runnerType === 'eve') {
        const eve = requireObject(runner.eve, 'runner.eve');
        requireString(eve.trace_ref, 'runner.eve.trace_ref');
    }

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
