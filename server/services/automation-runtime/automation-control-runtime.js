// @ts-check

import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { ProjectAccessPolicy } from '../project-access/project-access-policy.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_OWNER_ID = 'local-user';
const ALLOWED_TRIGGER_TYPES = new Set(['human', 'event', 'schedule']);
const ALLOWED_AUTONOMY_LEVELS = new Set(['human_only', 'draft_only', 'approval_required', 'auto_execute']);
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

/**
 * Internal persistence engine shared by the narrow automation-control services.
 * Production callers must use the facades in this directory instead.
 */
export class AutomationControlRuntime {
    constructor({
        repository,
        configParser,
        projectAccessPolicy = null
    }) {
        this.repository = repository;
        this.projectAccessPolicy = projectAccessPolicy || new ProjectAccessPolicy({ configParser });
    }

    async listRoleAgentInstances({ orgId = null, projectId = null, roleArchetypeId = null } = {}, actor = {}) {
        await this.projectAccessPolicy.prepare(actor);
        if (projectId) this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        return {
            role_agent_instances: this.repository.listRoleAgentInstances({ orgId, projectId, roleArchetypeId })
                .filter((agent) => this.projectAccessPolicy.canAccessProject(agent.project_id, actor))
        };
    }

    async createRoleAgentInstance(input, actor = {}) {
        await this.projectAccessPolicy.prepare(actor);
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this.projectAccessPolicy.assertProjectSelectable(projectId, actor);
        this.projectAccessPolicy.assertOrgReferenceAllowed(orgId, actor);
        this.projectAccessPolicy.assertProjectAccess(projectId, actor);
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
        await this.projectAccessPolicy.prepare(actor);
        if (projectId) this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        return {
            workflow_templates: this.repository.listWorkflowTemplates({ orgId, projectId, workflowKind })
                .filter((template) => this._actorCanAccessWorkflowTemplate(template, actor))
        };
    }

    async createWorkflowTemplate(input, actor = {}) {
        await this.projectAccessPolicy.prepare(actor);
        const orgId = readOptionalString(input, 'org_id', 'orgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId');
        if (projectId) {
            await this.projectAccessPolicy.assertProjectSelectable(projectId, actor);
            this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        } else if (!this._actorCanManageGlobalWorkflowTemplate(actor)) {
            throw AppError.forbidden('project_id is required for workflow_template creation');
        }
        if (orgId) this.projectAccessPolicy.assertOrgReferenceAllowed(orgId, actor);
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
        await this.projectAccessPolicy.prepare(actor);
        if (projectId) this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        return {
            workflow_bindings: this.repository.listWorkflowBindings({ orgId, projectId, roleAgentInstanceId })
                .filter((binding) => this.projectAccessPolicy.canAccessProject(binding.project_id, actor))
        };
    }

    async createWorkflowBinding(input, actor = {}) {
        await this.projectAccessPolicy.prepare(actor);
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this.projectAccessPolicy.assertProjectSelectable(projectId, actor);
        this.projectAccessPolicy.assertOrgReferenceAllowed(orgId, actor);
        this.projectAccessPolicy.assertProjectAccess(projectId, actor);
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
        this.projectAccessPolicy.assertProjectAccess(roleAgent.project_id, actor);
        const template = this.repository.getWorkflowTemplate(workflowTemplateId);
        if (!template) throw AppError.notFound('workflow_template', workflowTemplateId);
        if (template.org_id && template.org_id !== orgId) {
            throw AppError.validation(`workflow_template '${workflowTemplateId}' belongs to org '${template.org_id}'`);
        }
        if (template.project_id && template.project_id !== projectId) {
            throw AppError.validation(`workflow_template '${workflowTemplateId}' belongs to project '${template.project_id}'`);
        }
        if (template.project_id) this.projectAccessPolicy.assertProjectAccess(template.project_id, actor);
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
        await this.projectAccessPolicy.prepare(actor);
        if (projectId) this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        return {
            workflow_triggers: this.repository.listWorkflowTriggers({ orgId, projectId, workflowBindingId, triggerType })
                .filter((trigger) => this.projectAccessPolicy.canAccessProject(trigger.project_id, actor))
        };
    }

    async createWorkflowTrigger(input, actor = {}) {
        await this.projectAccessPolicy.prepare(actor);
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this.projectAccessPolicy.assertProjectSelectable(projectId, actor);
        this.projectAccessPolicy.assertOrgReferenceAllowed(orgId, actor);
        this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        const workflowBindingId = requireInputString(input, 'workflow_binding_id', 'workflowBindingId');
        const binding = this.repository.getWorkflowBinding(workflowBindingId);
        if (!binding) throw AppError.notFound('workflow_binding', workflowBindingId);
        if (binding.org_id !== orgId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to org '${binding.org_id}'`);
        }
        if (binding.project_id !== projectId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to project '${binding.project_id}'`);
        }
        this.projectAccessPolicy.assertProjectAccess(binding.project_id, actor);
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
        await this.projectAccessPolicy.prepare(actor);
        if (projectId) this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        return {
            loop_intents: this.repository.listLoopIntents({ orgId, projectId, workflowBindingId, triggerId })
                .filter((intent) => this.projectAccessPolicy.canAccessProject(intent.project_id, actor))
                .map((intent) => redactLoopIntentForResponse(intent))
        };
    }

    async createLoopIntent(input, actor = {}) {
        await this.projectAccessPolicy.prepare(actor);
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this.projectAccessPolicy.assertProjectSelectable(projectId, actor);
        this.projectAccessPolicy.assertOrgReferenceAllowed(orgId, actor);
        this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        const workflowBindingId = requireInputString(input, 'workflow_binding_id', 'workflowBindingId');
        const binding = this.repository.getWorkflowBinding(workflowBindingId);
        if (!binding) throw AppError.notFound('workflow_binding', workflowBindingId);
        if (binding.org_id !== orgId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to org '${binding.org_id}'`);
        }
        if (binding.project_id !== projectId) {
            throw AppError.validation(`workflow_binding '${workflowBindingId}' belongs to project '${binding.project_id}'`);
        }
        this.projectAccessPolicy.assertProjectAccess(binding.project_id, actor);
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



    _actorCanManageGlobalWorkflowTemplate(actor = {}) {
        if (!actor || Object.keys(actor).length === 0) return true;
        if (actor.authSource === 'internal' || actor.sub === 'internal_api' || actor.person_id === 'internal_api') return true;
        return ['admin', 'ceo'].includes(String(actor.role || '').toLowerCase());
    }

    _actorCanAccessWorkflowTemplate(template, actor = {}) {
        if (template.project_id) return this.projectAccessPolicy.canAccessProject(template.project_id, actor);
        if (this._actorCanManageGlobalWorkflowTemplate(actor)) return true;
        if (template.org_id) return false;
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        return projectCodes.length > 0;
    }

    async _transaction(callback) {
        if (typeof this.repository?.transaction !== 'function') {
            throw new Error('Automation control requires a transactional workflow repository');
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

}
