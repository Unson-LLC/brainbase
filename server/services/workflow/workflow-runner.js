// @ts-check
import crypto from 'node:crypto';

function nowIso() {
    return new Date().toISOString();
}

function timeoutError(timeoutMs) {
    const error = new Error(`Workflow timed out after ${timeoutMs}ms`);
    error.name = 'WorkflowTimeoutError';
    return error;
}

function withTimeout(promise, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
    let timer = null;
    return Promise.race([
        promise,
        new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
        })
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function previewData(data) {
    if (data == null) return null;
    const text = JSON.stringify(data);
    return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

function contentHash(value) {
    const text = JSON.stringify(value ?? null);
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return `h${Math.abs(hash)}`;
}

function normalizeResult(result = {}) {
    return {
        status: result.status || 'success',
        closureState: result.closureState,
        outputCount: result.outputCount ?? 0,
        message: result.message || null,
        data: result.data ?? null,
        actionRequired: result.actionRequired || 'none',
        humanStep: result.humanStep || null
    };
}

function hitlPolicyRequiresHumanStep(workflow, options = {}) {
    const policy = String(workflow.hitl_policy || 'none').toLowerCase();
    return policy !== 'none' && !options.humanStepResolution && !options.dryRun;
}

export const WORKFLOW_RUN_STATUSES = new Set([
    'queued',
    'running',
    'success',
    'failed',
    'skipped',
    'waiting_human',
    'needs_action',
    'cancelled'
]);

export class WorkflowRunner {
    constructor({ repository, handlers = {} }) {
        this.repository = repository;
        this.handlers = handlers;
    }

    registerHandler(key, handler) {
        this.handlers[key] = handler;
    }

    async runWorkflow(workflow, options = {}) {
        if (!workflow?.id) {
            throw new Error('workflow.id is required');
        }
        const runId = options.runId || `run_${crypto.randomUUID()}`;
        const startedAt = nowIso();
        const workspaceId = options.workspaceId || workflow.workspace_id || 'default';
        const projectId = options.projectId || workflow.project_id;
        const timeoutMs = Number(workflow.timeout_ms || workflow.timeoutMs || 300000);
        const lockTtlMs = Math.max(timeoutMs, Number(options.lockTtlMs || workflow.lock_ttl_ms || 300000));
        const lock = this.repository.acquireWorkflowLock?.({
            workspace_id: workspaceId,
            workflow_id: workflow.id,
            locked_by: runId,
            ttl_ms: lockTtlMs
        });
        if (lock === null) {
            return this._transaction(() => {
                const skipped = this.repository.createRun({
                    id: runId,
                    workspace_id: workspaceId,
                    project_id: projectId,
                    workflow_id: workflow.id,
                    workflow_name: workflow.name,
                    status: 'skipped',
                    closure_state: 'closed',
                    trigger_type: options.triggerType || 'manual',
                    env: options.env || workflow.execution_env || 'local',
                    dry_run: Boolean(options.dryRun),
                    started_by: options.originalRequesterId || options.actorId || 'system',
                    owner_id: workflow.owner_id,
                    assignee_id: workflow.default_assignee_id || workflow.owner_id,
                    approver_id: workflow.default_approver_id || workflow.owner_id,
                    action_required: 'rerun',
                    human_waiting: false,
                    parent_run_id: options.parentRunId || null,
                    message: `Workflow '${workflow.id}' is already running`,
                    started_at: startedAt,
                    finished_at: nowIso(),
                    duration_ms: 0
                });
                this.repository.writeAuditLog({
                    workspace_id: workspaceId,
                    project_id: projectId,
                    actor_id: options.actorId || 'system',
                    action: 'workflow.run.skipped_locked',
                    target_type: 'workflow_run',
                    target_id: skipped.id,
                    after: { workflow_id: workflow.id }
                });
                return { run: skipped, result: { status: 'skipped', message: skipped.message } };
            });
        }
        const contextResolution = this._resolveContext(workflow, {
            workspaceId,
            projectId,
            runId
        });

        let run;
        let shouldReleaseLock = true;
        let mainStep;
        try {
            ({ run, mainStep } = await this._transaction(() => {
                const createdRun = this.repository.createRun({
                    id: runId,
                    workspace_id: workspaceId,
                    project_id: projectId,
                    workflow_id: workflow.id,
                    workflow_name: workflow.name,
                    status: 'running',
                    closure_state: 'open',
                    trigger_type: options.triggerType || 'manual',
                    env: options.env || workflow.execution_env || 'local',
                    dry_run: Boolean(options.dryRun),
                    started_by: options.originalRequesterId || options.actorId || 'system',
                    owner_id: workflow.owner_id,
                    assignee_id: workflow.default_assignee_id || workflow.owner_id,
                    approver_id: workflow.default_approver_id || workflow.owner_id,
                    action_required: 'none',
                    human_waiting: false,
                    parent_run_id: options.parentRunId || null,
                    started_at: startedAt
                });
                const createdStep = this.repository.createRunStep({
                    id: `step_${crypto.randomUUID()}`,
                    workspace_id: createdRun.workspace_id,
                    project_id: createdRun.project_id,
                    workflow_run_id: createdRun.id,
                    step_key: options.humanStepResolution ? 'human_resume' : 'run',
                    step_name: options.humanStepResolution ? 'Human resume' : 'Run workflow',
                    status: 'running',
                    action_required: 'none',
                    started_at: startedAt
                });
                for (const snapshot of contextResolution.snapshots) {
                    this.repository.createContextSnapshot({
                        id: `ctx_${crypto.randomUUID()}`,
                        workspace_id: createdRun.workspace_id,
                        project_id: createdRun.project_id,
                        workflow_run_id: createdRun.id,
                        ...snapshot
                    });
                }
                return { run: createdRun, mainStep: createdStep };
            }));
        } catch (error) {
            this.repository.releaseWorkflowLock?.({
                workspace_id: workspaceId,
                workflow_id: workflow.id,
                locked_by: runId
            });
            throw error;
        }

        if (contextResolution.missingRequired.length > 0) {
            const message = `Required context missing: ${contextResolution.missingRequired.map((item) => item.source_ref || item.source_type).join(', ')}`;
            run = await this._transaction(() => {
                const updatedRun = this.repository.updateRun(run.id, {
                    status: 'needs_action',
                    closure_state: 'needs_action',
                    finished_at: nowIso(),
                    duration_ms: Date.now() - new Date(startedAt).getTime(),
                    action_required: 'update_input',
                    message
                });
                this.repository.updateRunStep(mainStep.id, {
                    status: 'needs_action',
                    action_required: 'update_input',
                    message,
                    finished_at: nowIso()
                });
                this.repository.writeAuditLog({
                    workspace_id: updatedRun.workspace_id,
                    project_id: updatedRun.project_id,
                    actor_id: options.actorId || 'system',
                    action: 'workflow.run.needs_action',
                    target_type: 'workflow_run',
                    target_id: updatedRun.id,
                    after: { missing_context: contextResolution.missingRequired }
                });
                return updatedRun;
            });
            this.repository.releaseWorkflowLock?.({
                workspace_id: run.workspace_id,
                workflow_id: workflow.id,
                locked_by: runId
            });
            return { run, result: { status: 'needs_action', message } };
        }

        if (hitlPolicyRequiresHumanStep(workflow, options)) {
            const message = `Human approval required by policy: ${workflow.hitl_policy}`;
            let humanStep;
            ({ run, humanStep } = await this._transaction(() => {
                const createdHumanStep = this.repository.createHumanStep({
                    id: `human_${crypto.randomUUID()}`,
                    workspace_id: run.workspace_id,
                    project_id: run.project_id,
                    workflow_run_id: run.id,
                    workflow_id: workflow.id,
                    step_type: 'approval',
                    requested_by: run.started_by,
                    requested_to: workflow.default_approver_id || workflow.owner_id,
                    prompt: `Approve ${workflow.name || workflow.id}`,
                    reason: workflow.hitl_policy
                });
                const updatedRun = this.repository.updateRun(run.id, {
                    status: 'waiting_human',
                    closure_state: 'open',
                    human_waiting: true,
                    action_required: 'approve',
                    message,
                    finished_at: nowIso(),
                    duration_ms: Date.now() - new Date(startedAt).getTime()
                });
                this.repository.updateRunStep(mainStep.id, {
                    status: 'waiting_human',
                    action_required: 'approve',
                    message,
                    finished_at: nowIso()
                });
                this.repository.writeAuditLog({
                    workspace_id: updatedRun.workspace_id,
                    project_id: updatedRun.project_id,
                    actor_id: updatedRun.started_by,
                    action: 'workflow.human_step.created',
                    target_type: 'workflow_human_step',
                    target_id: createdHumanStep.id,
                    after: createdHumanStep
                });
                return { run: updatedRun, humanStep: createdHumanStep };
            }));
            this.repository.releaseWorkflowLock?.({
                workspace_id: run.workspace_id,
                workflow_id: workflow.id,
                locked_by: runId
            });
            return {
                run,
                result: {
                    status: 'waiting_human',
                    actionRequired: 'approve',
                    message
                },
                humanStep
            };
        }

        let handlerPromise = null;
        try {
            const handler = this._resolveHandler(workflow);
            handlerPromise = handler({
                workspaceId: run.workspace_id,
                projectId: run.project_id,
                workflowId: workflow.id,
                runId: run.id,
                triggerType: run.trigger_type,
                env: run.env,
                dryRun: run.dry_run,
                actorId: options.actorId || run.started_by,
                humanStepResolution: options.humanStepResolution || null,
                resolvedContext: contextResolution.snapshots
            }, workflow);
            const result = normalizeResult(await withTimeout(handlerPromise, timeoutMs));

            if (result.humanStep || result.status === 'waiting_human') {
                let humanStep;
                ({ run, humanStep } = await this._transaction(() => {
                    const createdHumanStep = this.repository.createHumanStep({
                        id: `human_${crypto.randomUUID()}`,
                        workspace_id: run.workspace_id,
                        project_id: run.project_id,
                        workflow_run_id: run.id,
                        workflow_id: workflow.id,
                        step_type: result.humanStep?.stepType || 'approval',
                        requested_by: run.started_by,
                        requested_to: workflow.default_approver_id || workflow.owner_id,
                        prompt: result.humanStep?.prompt || result.message || 'Human review required',
                        reason: result.humanStep?.reason || 'hitl_policy'
                    });
                    const updatedRun = this.repository.updateRun(run.id, {
                        status: 'waiting_human',
                        closure_state: 'open',
                        human_waiting: true,
                        action_required: result.actionRequired === 'none' ? 'approve' : result.actionRequired,
                        message: result.message,
                        output_count: result.outputCount,
                        finished_at: nowIso(),
                        duration_ms: Date.now() - new Date(startedAt).getTime()
                    });
                    this.repository.updateRunStep(mainStep.id, {
                        status: 'waiting_human',
                        action_required: updatedRun.action_required,
                        message: result.message,
                        output_count: result.outputCount,
                        finished_at: nowIso()
                    });
                    this.repository.writeAuditLog({
                        workspace_id: updatedRun.workspace_id,
                        project_id: updatedRun.project_id,
                        actor_id: updatedRun.started_by,
                        action: 'workflow.human_step.created',
                        target_type: 'workflow_human_step',
                        target_id: createdHumanStep.id,
                        after: createdHumanStep
                    });
                    return { run: updatedRun, humanStep: createdHumanStep };
                }));
                return { run, result, humanStep };
            }

            const status = WORKFLOW_RUN_STATUSES.has(result.status) ? result.status : 'success';
            run = await this._transaction(() => {
                if (result.data != null || result.outputCount > 0) {
                    this.repository.createOutput({
                        id: `out_${crypto.randomUUID()}`,
                        workspace_id: run.workspace_id,
                        project_id: run.project_id,
                        workflow_run_id: run.id,
                        workflow_id: workflow.id,
                        type: 'result',
                        title: result.message || `${workflow.name} output`,
                        preview: previewData(result.data),
                        metadata: { output_count: result.outputCount }
                    });
                }
                const updatedRun = this.repository.updateRun(run.id, {
                    status,
                    closure_state: result.closureState || (status === 'success' || status === 'skipped' ? 'closed' : 'needs_action'),
                    action_required: result.actionRequired,
                    output_count: result.outputCount,
                    message: result.message,
                    data_preview: previewData(result.data),
                    finished_at: nowIso(),
                    duration_ms: Date.now() - new Date(startedAt).getTime()
                });
                this.repository.updateRunStep(mainStep.id, {
                    status,
                    action_required: result.actionRequired,
                    message: result.message,
                    output_count: result.outputCount,
                    finished_at: nowIso()
                });
                this.repository.writeAuditLog({
                    workspace_id: updatedRun.workspace_id,
                    project_id: updatedRun.project_id,
                    actor_id: updatedRun.started_by,
                    action: 'workflow.run.finished',
                    target_type: 'workflow_run',
                    target_id: updatedRun.id,
                    after: { status: updatedRun.status, closure_state: updatedRun.closure_state }
                });
                return updatedRun;
            });
            return { run, result };
        } catch (error) {
            const isTimeout = error?.name === 'WorkflowTimeoutError';
            run = await this._transaction(() => {
                const updatedRun = this.repository.updateRun(run.id, {
                    status: 'failed',
                    closure_state: 'needs_action',
                    action_required: 'check_error',
                    error_message: error?.message || String(error),
                    finished_at: nowIso(),
                    duration_ms: Date.now() - new Date(startedAt).getTime()
                });
                this.repository.updateRunStep(mainStep.id, {
                    status: 'failed',
                    action_required: 'check_error',
                    error_message: updatedRun.error_message,
                    finished_at: nowIso()
                });
                this.repository.writeAuditLog({
                    workspace_id: updatedRun.workspace_id,
                    project_id: updatedRun.project_id,
                    actor_id: updatedRun.started_by,
                    action: 'workflow.run.failed',
                    target_type: 'workflow_run',
                    target_id: updatedRun.id,
                    after: { error_message: updatedRun.error_message, timeout: isTimeout }
                });
                return updatedRun;
            });
            if (isTimeout) {
                shouldReleaseLock = false;
                const workflowId = workflow.id;
                const lockedBy = runId;
                const release = () => this.repository.releaseWorkflowLock?.({
                    workspace_id: run.workspace_id,
                    workflow_id: workflowId,
                    locked_by: lockedBy
                });
                // Promise.race cannot cancel arbitrary handler side effects, so keep the lock
                // until the timed-out handler actually settles.
                handlerPromise?.finally(release);
            }
            return { run, error: run.error_message };
        } finally {
            if (shouldReleaseLock) {
                this.repository.releaseWorkflowLock?.({
                    workspace_id: run?.workspace_id || workspaceId,
                    workflow_id: workflow.id,
                    locked_by: runId
                });
            }
        }
    }

    async _transaction(callback) {
        if (typeof this.repository.transaction === 'function') {
            return this.repository.transaction(callback);
        }
        return callback();
    }

    _resolveHandler(workflow) {
        const key = workflow.implementation_key || workflow.id;
        const handler = this.handlers[key];
        if (!handler) {
            return async () => ({
                status: 'needs_action',
                closureState: 'needs_action',
                actionRequired: 'update_input',
                message: `No workflow handler registered for ${key}`
            });
        }
        return handler;
    }

    _resolveContext(workflow, ctx) {
        const contextSources = Array.isArray(workflow.context_sources) ? workflow.context_sources : [];
        const missingRequired = [];
        const snapshots = contextSources
            .map((source) => {
                const missing = source.required && (!source.source_ref || source.available === false);
                if (missing) missingRequired.push(source);
                return {
                    source_type: source.source_type || source.type || 'unknown',
                    source_ref: source.source_ref || null,
                    source_version: source.source_version || null,
                    content_hash: contentHash({
                        workflowId: workflow.id,
                        runId: ctx.runId,
                        source
                    }),
                    item_count: source.item_count ?? 0,
                    permission: source.permission || 'read',
                    preview: source.preview || null
                };
            });
        return { snapshots, missingRequired };
    }
}
