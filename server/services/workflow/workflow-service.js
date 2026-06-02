// @ts-check

import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import {
    generateWorkflowDraft,
    testWorkflowDraft
} from './workflow-draft-generator.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_OWNER_ID = 'local-user';

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
        })
    };
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
    constructor({ repository, runner, configParser }) {
        this.repository = repository;
        this.runner = runner;
        this.configParser = configParser;
        this.projectConfigById = new Map();
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
        if (workflow.enabled === false) {
            throw AppError.validation(`workflow '${workflowId}' is disabled`);
        }
        await this._assertProjectSelectable(workflow.project_id);
        this._assertActorCanAccessProject(workflow.project_id, {
            sub: options.actorId,
            person_id: options.actorId,
            projectCodes: options.projectCodes || [],
            role: options.role,
            authSource: options.authSource
        });
        return this.runner.runWorkflow(workflow, options);
    }

    async rerun(runId, options = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const previous = this.repository.getRun(runId);
        if (!previous) throw AppError.notFound('workflow_run', runId);
        this._assertActorCanAccessProject(previous.project_id, actor);
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
        const resolved = this.repository.updateHumanStep(stepId, {
            status: resolution,
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
        if (!['approved', 'approve'].includes(String(resolution).toLowerCase())) {
            const previousRun = this.repository.getRun(step.workflow_run_id);
            const closedRun = previousRun
                ? this.repository.updateRun(previousRun.id, {
                    status: 'cancelled',
                    closure_state: 'closed',
                    human_waiting: false,
                    action_required: 'none',
                    message: `Human step ${resolution}`,
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
                    resolution,
                    status: closedRun?.status || 'cancelled'
                }
            });
            return { human_step: resolved, resumed_run: closedRun };
        }
        const previousRun = this.repository.getRun(step.workflow_run_id);
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

    _assertActorCanAccessProject(projectId, actor = {}) {
        if (!this._actorCanAccessProject(projectId, actor)) {
            throw AppError.forbidden(`project '${projectId}' is not accessible`);
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
