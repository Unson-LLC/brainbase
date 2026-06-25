// @ts-check

import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import {
    generateWorkflowDraft,
    testWorkflowDraft
} from './workflow-draft-generator.js';
import {
    MEETING_WORKFLOW_PACK_ID,
    MEETING_WORKFLOW_DEFINITIONS,
    buildMeetingWorkflowPackRecords,
    meetingPackIds
} from './meeting-workflow-pack.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_OWNER_ID = 'local-user';
const MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY = 'meeting-review-package-ingest';
const ALLOWED_TRIGGER_TYPES = new Set(['human', 'event', 'schedule']);
const ALLOWED_AUTONOMY_LEVELS = new Set(['human_only', 'draft_only', 'approval_required', 'auto_execute']);
const MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS = [
    'requested',
    'calendar_fetching',
    'meeting_pack_ensured',
    'loop_intents_ready',
    'skipped_inputs_reported'
];
const MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS = [
    'requested',
    'calendar_fetching',
    'calendar_fetch_failed_all',
    'failed_without_partial_write'
];
const MEETING_REVIEW_INGEST_SUCCESS_STATE_TRANSITIONS = [
    'package_received',
    'scope_resolved',
    'loop_intents_verified',
    'run_recorded',
    'outputs_recorded',
    'human_steps_recorded',
    'waiting_human'
];
const MEETING_REVIEW_OUTPUT_DEFINITIONS = [
    {
        id: 'meeting_note_draft',
        title: '議事録ドラフト',
        type: 'meeting_note_draft',
        package_key: 'meeting_note_summary',
        loop_intent_key: 'transcript_to_meeting_note',
        write_back_target: 'meeting_note_draft'
    },
    {
        id: 'task_candidates',
        title: 'Task候補',
        type: 'task_candidates',
        package_key: 'task_candidates',
        loop_intent_key: 'meeting_note_to_tasks',
        write_back_target: 'task_store'
    },
    {
        id: 'decision_candidates',
        title: 'Decision候補',
        type: 'decision_candidates',
        package_key: 'decision_candidates',
        loop_intent_key: 'meeting_note_to_decisions',
        write_back_target: 'graph_ssot_decision'
    },
    {
        id: 'follow_up_draft',
        title: 'フォローアップ文面ドラフト',
        type: 'message_draft',
        package_key: 'follow_up_draft',
        loop_intent_key: 'post_meeting_follow_up_message',
        write_back_target: 'external_message_draft'
    },
    {
        id: 'promotion_candidates',
        title: 'Graph / Learning昇格候補',
        type: 'promotion_candidates',
        package_key: 'promotion_candidates',
        loop_intent_key: 'meeting_note_to_decisions',
        write_back_target: 'candidate_store'
    }
];
const MEETING_REVIEW_HUMAN_STEP_DEFINITIONS = [
    {
        id: 'approve_meeting_note_publish',
        step_type: 'approval',
        prompt: '議事録ドラフトの公開可否を確認してください',
        reason: 'required_before_publish',
        protects: ['meeting_note_publish'],
        write_back_target: 'meeting_note_draft',
        loop_intent_key: 'transcript_to_meeting_note'
    },
    {
        id: 'approve_task_candidates',
        step_type: 'approval',
        prompt: 'Task候補を作成してよいか確認してください',
        reason: 'required_before_task_create',
        protects: ['task_create'],
        write_back_target: 'task_store',
        loop_intent_key: 'meeting_note_to_tasks'
    },
    {
        id: 'approve_decision_candidates',
        step_type: 'approval',
        prompt: 'Decision候補をGraph SSOTへ昇格してよいか確認してください',
        reason: 'required_before_graph_promotion',
        protects: ['decision_promotion', 'graph_promotion'],
        write_back_target: 'graph_ssot_decision',
        loop_intent_key: 'meeting_note_to_decisions'
    },
    {
        id: 'approve_follow_up_draft',
        step_type: 'approval',
        prompt: 'フォローアップ文面を外部送信してよいか確認してください',
        reason: 'required_before_external_send',
        protects: ['external_send'],
        write_back_target: 'external_message_draft',
        loop_intent_key: 'post_meeting_follow_up_message'
    },
    {
        id: 'approve_promotion_candidates',
        step_type: 'approval',
        prompt: 'Graph / Learning昇格候補を次の審査へ回してよいか確認してください',
        reason: 'required_before_candidate_promotion',
        protects: ['graph_candidate_promotion', 'learning_candidate_promotion'],
        write_back_target: 'candidate_store',
        loop_intent_key: 'meeting_note_to_decisions'
    }
];
const REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS = Array.from(new Set([
    ...MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.loop_intent_key),
    ...MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((definition) => definition.loop_intent_key)
]));
const REQUIRED_MEETING_REVIEW_PACKAGE_KEYS = MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => definition.package_key);

function meetingReviewValidationError(message, stateTransition, details = {}) {
    return AppError.validation(message, {
        state_transition: stateTransition,
        ...details
    });
}

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

function readStringList(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
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

function readReviewPackage(input = {}) {
    const candidate = input.review_package || input.reviewPackage || input.package || input;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw meetingReviewValidationError('review_package must be a JSON object', 'blocked_invalid_review_package');
    }
    return jsonClone(candidate);
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

function sourceRefForMeetingIdentity(meetingIdentity = {}) {
    if (meetingIdentity.source === 'google_calendar') {
        return [
            'google-calendar',
            meetingIdentity.account || 'default',
            meetingIdentity.calendar_id || 'default',
            meetingIdentity.event_id || meetingIdentity.event_uid || 'unknown'
        ].join(':');
    }
    return meetingIdentity.source ? `${meetingIdentity.source}:${meetingIdentity.event_id || meetingIdentity.title || 'unknown'}` : 'meeting_identity:unknown';
}

function sourceRefForSourceEvent(sourceEvent = {}) {
    if (sourceEvent.source_system === 'slack') {
        return [
            'slack',
            sourceEvent.workspace || 'default',
            sourceEvent.channel_id || sourceEvent.channel_name || 'unknown',
            sourceEvent.message_ts || sourceEvent.file_id || 'unknown'
        ].join(':');
    }
    return sourceEvent.source_system ? `${sourceEvent.source_system}:${sourceEvent.id || 'unknown'}` : 'source_event:unknown';
}

function loopIntentEntries(loopIntentIds) {
    if (!loopIntentIds || typeof loopIntentIds !== 'object' || Array.isArray(loopIntentIds)) {
        throw meetingReviewValidationError('review_package.loop_intent_ids must be a JSON object', 'blocked_loop_intent_mismatch', {
            required_loop_intent_keys: REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS
        });
    }
    const entries = Object.entries(loopIntentIds)
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
        .filter(([, value]) => value);
    if (entries.length === 0) {
        throw meetingReviewValidationError('review_package.loop_intent_ids must include at least one id', 'blocked_loop_intent_mismatch', {
            required_loop_intent_keys: REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS
        });
    }
    const presentKeys = new Set(entries.map(([key]) => key));
    const missingKeys = REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS.filter((key) => !presentKeys.has(key));
    if (missingKeys.length > 0) {
        throw meetingReviewValidationError('review_package.loop_intent_ids is missing required meeting review key(s)', 'blocked_loop_intent_mismatch', {
            missing_loop_intent_keys: missingKeys,
            required_loop_intent_keys: REQUIRED_MEETING_REVIEW_LOOP_INTENT_KEYS
        });
    }
    return entries;
}

function assertMeetingReviewPackageMapping(reviewPackage) {
    const missingPackageKeys = REQUIRED_MEETING_REVIEW_PACKAGE_KEYS.filter((key) => !Object.hasOwn(reviewPackage, key) || reviewPackage[key] == null);
    if (missingPackageKeys.length > 0) {
        throw meetingReviewValidationError('review_package is missing required output payload key(s)', 'blocked_invalid_review_package', {
            missing_package_keys: missingPackageKeys,
            required_package_keys: REQUIRED_MEETING_REVIEW_PACKAGE_KEYS
        });
    }
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

function createMeetingIdentityFromCalendarEvent(event, { account = null } = {}) {
    return {
        source: 'google_calendar',
        account: event.account || account || null,
        calendar_id: event.calendarId || null,
        event_id: event.calendarEventId || event.id || null,
        event_uid: event.iCalUID || null,
        title: event.title || '(無題)',
        start: event.startDateTime || null,
        end: event.endDateTime || null,
        all_day: Boolean(event.allDay),
        attendees: Array.isArray(event.attendees) ? event.attendees : [],
        organizer: event.organizer || null,
        conference_url: event.conferenceUrl || null,
        location: event.location || null,
        html_link: event.htmlLink || null,
        description: event.description || null
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

function assertWorkflowRunAllowed(workflow) {
    if (workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY) {
        throw AppError.validation('meeting-review-package-ingest workflows cannot be manually run; use /api/workflows/control/meeting-pack/review-ingest');
    }
}

function isMeetingReviewPackageWorkflow(workflow) {
    return workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY;
}

function isApprovedHumanResolution(status) {
    return ['approved', 'approve'].includes(String(status || '').toLowerCase());
}

function isPendingHumanStepStatus(status) {
    return String(status || '').toLowerCase() === 'pending';
}

function isRejectedHumanStepStatus(status) {
    return ['rejected', 'reject', 'cancelled', 'canceled', 'declined'].includes(String(status || '').toLowerCase());
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
    constructor({ repository, runner, configParser, googleCalendarService = null }) {
        this.repository = repository;
        this.runner = runner;
        this.configParser = configParser;
        this.googleCalendarService = googleCalendarService;
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
        const agent = this.repository.upsertRoleAgentInstance({
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
            item: agent,
            actor,
            action: 'workflow.role_agent_instance.upserted',
            targetType: 'role_agent_instance'
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
        const template = this.repository.upsertWorkflowTemplate({
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
            item: template,
            actor,
            action: 'workflow.template.upserted',
            targetType: 'workflow_template'
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
        const binding = this.repository.upsertWorkflowBinding({
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
            stop_conditions: normalizeTags(input.stop_conditions || input.stopConditions),
            approval_owner_id: readOptionalString(input, 'approval_owner_id', 'approvalOwnerId') || roleAgent.default_approver_id,
            cost_owner_id: readOptionalString(input, 'cost_owner_id', 'costOwnerId') || roleAgent.owner_id,
            enabled: input.enabled !== false
        });
        this._writeWorkflowControlAudit({
            item: binding,
            actor,
            action: 'workflow.binding.upserted',
            targetType: 'workflow_binding'
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
        const trigger = this.repository.upsertWorkflowTrigger({
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
            item: trigger,
            actor,
            action: 'workflow.trigger.upserted',
            targetType: 'workflow_trigger'
        });
        return { workflow_trigger: trigger };
    }

    async listLoopIntents({ orgId = null, projectId = null, workflowBindingId = null, triggerId = null } = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (projectId) this._assertActorCanAccessProject(projectId, actor);
        return {
            loop_intents: this.repository.listLoopIntents({ orgId, projectId, workflowBindingId, triggerId })
                .filter((intent) => this._actorCanAccessProject(intent.project_id, actor))
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
        const intent = this.repository.upsertLoopIntent({
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
            item: intent,
            actor,
            action: 'workflow.loop_intent.created',
            targetType: 'loop_intent'
        });
        return { loop_intent: intent };
    }

    async _prepareMeetingWorkflowPackRecords(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);
        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const records = buildMeetingWorkflowPackRecords({
            orgId,
            projectId,
            actorId,
            seedLoopIntents: input.seed_loop_intents !== false && input.seedLoopIntents !== false
        });
        return { orgId, projectId, actorId, records };
    }

    async reviewMeetingWorkflowPackDesign(input = {}, actor = {}) {
        const { orgId, projectId, records } = await this._prepareMeetingWorkflowPackRecords(input, actor);
        return {
            meeting_workflow_pack_design: {
                pack_id: records.pack_id,
                org_id: orgId,
                project_id: projectId,
                loop_pack_manifest: records.loop_pack_manifest,
                loop_pack_design_review: records.loop_pack_design_review
            }
        };
    }

    async bootstrapMeetingWorkflowPack(input = {}, actor = {}) {
        const { orgId, projectId, actorId, records } = await this._prepareMeetingWorkflowPackRecords(input, actor);
        if (records.loop_pack_design_review.status !== 'pass') {
            throw AppError.validation('loop pack design gate did not pass', {
                loop_pack_design_review: records.loop_pack_design_review
            });
        }

        const result = await this.repository.transaction(async () => {
            const roleAgent = this.repository.upsertRoleAgentInstance(records.role_agent_instance);
            const templates = records.workflow_templates.map((template) => this.repository.upsertWorkflowTemplate(template));
            const bindings = records.workflow_bindings.map((binding) => this.repository.upsertWorkflowBinding(binding));
            const triggers = records.workflow_triggers.map((trigger) => this.repository.upsertWorkflowTrigger(trigger));
            const loopIntents = records.loop_intents.map((intent) => this.repository.upsertLoopIntent(intent));
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_pack.bootstrapped',
                target_type: 'meeting_workflow_pack',
                target_id: records.pack_id,
                after: {
                    org_id: orgId,
                    project_id: projectId,
                    role_agent_instance_id: roleAgent.id,
                    workflow_template_ids: templates.map((template) => template.id),
                    workflow_binding_ids: bindings.map((binding) => binding.id),
                    workflow_trigger_ids: triggers.map((trigger) => trigger.id),
                    loop_intent_ids: loopIntents.map((intent) => intent.id),
                    loop_pack_design_review: {
                        gate_id: records.loop_pack_design_review.gate_id,
                        status: records.loop_pack_design_review.status,
                        manifest_digest: records.loop_pack_design_review.manifest_digest,
                        issues: records.loop_pack_design_review.issues,
                        rubric: records.loop_pack_design_review.rubric
                    }
                }
            });
            return {
                loop_pack_design_review: records.loop_pack_design_review,
                meeting_workflow_pack: {
                    pack_id: records.pack_id,
                    org_id: orgId,
                    project_id: projectId,
                    role_agent_instance: roleAgent,
                    workflow_templates: templates,
                    workflow_bindings: bindings,
                    workflow_triggers: triggers,
                    loop_intents: loopIntents
                }
            };
        });
        return result;
    }

    async createMeetingPackCalendarLoopIntents(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        if (!this.googleCalendarService) {
            throw AppError.validation('google_calendar_service is not configured');
        }
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        const from = requireInputString(input, 'from');
        const to = requireInputString(input, 'to');
        const account = readOptionalString(input, 'account');
        const calendarIds = readStringList(input, 'calendar_ids', 'calendarIds');
        await this._assertProjectSelectable(projectId);
        this._assertOrgReferenceAllowed(orgId);
        this._assertActorCanAccessProject(projectId, actor);

        const authStatus = !account && typeof this.googleCalendarService.getAuthStatus === 'function'
            ? await this.googleCalendarService.getAuthStatus()
            : null;
        if (authStatus && !authStatus.connected) {
            throw AppError.validation(`google calendar is not connected: ${authStatus.reason || 'unknown'}`, {
                skipped_events: [
                    {
                        calendar_id: null,
                        reason: authStatus.reason || 'google_calendar_not_connected',
                        message: authStatus.reason || null
                    }
                ],
                state_transitions: MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS
            });
        }

        const workflowDefinitionId = 'pre-meeting-briefing';
        const definition = MEETING_WORKFLOW_DEFINITIONS.find((candidate) => candidate.id === workflowDefinitionId);
        if (!definition) throw AppError.validation(`meeting workflow definition '${workflowDefinitionId}' is not configured`);

        const diagnostics = typeof this.googleCalendarService.listEventsWithDiagnostics === 'function'
            ? await this.googleCalendarService.listEventsWithDiagnostics({
                from,
                to,
                account,
                calendarIds: calendarIds.length > 0 ? calendarIds : null
            })
            : {
                events: await this.googleCalendarService.listEvents({
                    from,
                    to,
                    account,
                    calendarIds: calendarIds.length > 0 ? calendarIds : null
                }),
                skippedCalendars: []
            };
        const events = Array.isArray(diagnostics.events) ? diagnostics.events : [];
        const skippedEvents = Array.isArray(diagnostics.skippedCalendars)
            ? diagnostics.skippedCalendars.map((calendar) => ({
                calendar_id: calendar.calendar_id || null,
                reason: calendar.reason || 'calendar_fetch_failed',
                message: calendar.message || null
            }))
            : [];

        if (events.length === 0 && skippedEvents.length > 0) {
            throw AppError.validation(`google calendar is not connected: ${skippedEvents[0].reason || 'calendar_fetch_failed'}`, {
                skipped_events: skippedEvents,
                state_transitions: MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS
            });
        }

        return this.repository.transaction(async () => {
            await this.bootstrapMeetingWorkflowPack({
                org_id: orgId,
                project_id: projectId,
                seed_loop_intents: false
            }, actor);

            const ids = meetingPackIds({
                orgId,
                projectId,
                definitionId: workflowDefinitionId,
                triggerType: 'schedule'
            });
            const loopIntents = [];
            const effectiveAccount = account || authStatus?.defaultAccount || null;

            const ingestionInput = {
                from,
                to,
                account,
                calendarIds: calendarIds.length > 0 ? calendarIds : null
            };

            for (const event of events) {
                if (event?.allDay) {
                    skippedEvents.push({
                        event_id: event.calendarEventId || event.id || null,
                        title: event.title || null,
                        reason: 'all_day_event'
                    });
                    continue;
                }

                const meetingIdentity = createMeetingIdentityFromCalendarEvent(event, { account: effectiveAccount });
                const eventStableRef = meetingIdentity.event_id || event.id || `${meetingIdentity.title}:${meetingIdentity.start}`;
                const loopIntentId = createStableId(
                    'loop',
                    orgId,
                    projectId,
                    workflowDefinitionId,
                    'gcal',
                    meetingIdentity.calendar_id,
                    eventStableRef,
                    meetingIdentity.start
                );
                const result = await this.createLoopIntent({
                    id: loopIntentId,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_binding_id: ids.bindingId,
                    trigger_id: ids.triggerId,
                    input_ref: `google-calendar:${effectiveAccount || 'default'}:${meetingIdentity.calendar_id || 'default'}:${eventStableRef}`,
                    input_summary: `${meetingIdentity.title} ${meetingIdentity.start || ''}`.trim(),
                    input_payload: {
                        meeting_identity: meetingIdentity,
                        workflow_definition_id: workflowDefinitionId,
                        requested_output: definition.output_contract,
                        write_back_target: definition.write_back_target,
                        source: 'google_calendar'
                    }
                }, actor);
                loopIntents.push(result.loop_intent);
            }

            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                project_id: projectId,
                actor_id: actor.person_id || actor.sub || 'system',
                action: 'workflow.meeting_pack.calendar_inputs.ingested',
                target_type: 'meeting_workflow_pack',
                target_id: 'mana-meeting-workflow-pack-v1',
                after: {
                    org_id: orgId,
                    project_id: projectId,
                    from,
                    to,
                    account: effectiveAccount,
                    calendar_ids: calendarIds,
                    ingestion_input: ingestionInput,
                    events_considered: events.length,
                    loop_intent_ids: loopIntents.map((intent) => intent.id),
                    skipped_events: skippedEvents,
                    state_transitions: MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS
                }
            });

            return {
                meeting_calendar_inputs: {
                    org_id: orgId,
                    project_id: projectId,
                    workflow_definition_id: workflowDefinitionId,
                    from,
                    to,
                    account: effectiveAccount,
                    calendar_ids: calendarIds,
                    events_considered: events.length,
                    loop_intents: loopIntents,
                    skipped_events: skippedEvents,
                    state_transitions: MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS
                }
            };
        });
    }

    async ingestMeetingReviewPackage(input = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const reviewPackage = readReviewPackage(input);
        const packageId = readOptionalString(reviewPackage, 'package_id', 'packageId');
        const meetingIdentity = reviewPackage.meeting_identity && typeof reviewPackage.meeting_identity === 'object'
            ? reviewPackage.meeting_identity
            : {};
        const sourceEvent = reviewPackage.source_event && typeof reviewPackage.source_event === 'object'
            ? reviewPackage.source_event
            : {};
        const orgId = readOptionalString(input, 'org_id', 'orgId')
            || readOptionalString(reviewPackage, 'org_id', 'orgId')
            || readOptionalString(meetingIdentity, 'candidate_org_id', 'candidateOrgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId')
            || readOptionalString(reviewPackage, 'project_id', 'projectId')
            || readOptionalString(meetingIdentity, 'candidate_project_id', 'candidateProjectId');
        const caseScope = readOptionalString(input, 'case_scope', 'caseScope')
            || readOptionalString(reviewPackage, 'case_scope', 'caseScope')
            || readOptionalString(meetingIdentity, 'case_scope', 'caseScope');
        if (!packageId) {
            throw meetingReviewValidationError('review_package.package_id is required', 'blocked_invalid_review_package', {
                missing_package_keys: ['package_id']
            });
        }
        if (!orgId) {
            throw meetingReviewValidationError('org_id is required', 'blocked_invalid_scope', {
                field: 'org_id'
            });
        }
        if (!projectId) {
            throw meetingReviewValidationError('project_id is required', 'blocked_invalid_scope', {
                field: 'project_id',
                org_id: orgId
            });
        }
        try {
            await this._assertProjectSelectable(projectId);
            this._assertOrgReferenceAllowed(orgId);
        } catch (error) {
            if (error?.statusCode === 400) {
                throw meetingReviewValidationError(error.message, 'blocked_invalid_scope', {
                    org_id: orgId,
                    project_id: projectId
                });
            }
            throw error;
        }
        this._assertActorCanAccessProject(projectId, actor);

        assertMeetingReviewPackageMapping(reviewPackage);
        const loopEntries = loopIntentEntries(reviewPackage.loop_intent_ids);
        const loopIntents = loopEntries.map(([key, loopIntentId]) => {
            const loopIntent = this.repository.getLoopIntent(loopIntentId);
            if (!loopIntent) {
                throw AppError.validation(`loop_intent '${loopIntentId}' not found`, {
                    state_transition: 'blocked_loop_intent_mismatch',
                    loop_intent_key: key,
                    loop_intent_id: loopIntentId
                });
            }
            if (loopIntent.org_id !== orgId || loopIntent.project_id !== projectId) {
                throw AppError.validation(`loop_intent '${loopIntentId}' belongs to '${loopIntent.org_id}/${loopIntent.project_id}'`, {
                    state_transition: 'blocked_loop_intent_mismatch',
                    loop_intent_key: key,
                    loop_intent_id: loopIntentId,
                    expected: { org_id: orgId, project_id: projectId },
                    actual: { org_id: loopIntent.org_id, project_id: loopIntent.project_id }
                });
            }
            return { key, loop_intent: loopIntent };
        });
        const loopIntentByKey = new Map(loopIntents.map((entry) => [entry.key, entry.loop_intent]));
        const workflowId = createMeetingReviewStableId('wf', orgId, projectId, 'meeting_review_package_ingest');
        const runId = createMeetingReviewStableId('run', orgId, projectId, packageId, 'meeting_review_package_ingest');
        const existingRun = this.repository.getRun(runId);
        if (existingRun) {
            return {
                meeting_review_ingest: {
                    org_id: orgId,
                    project_id: projectId,
                    case_scope: caseScope,
                    package_id: packageId,
                    idempotent: true,
                    state_transitions: ['package_received', 'scope_resolved', 'loop_intents_verified', 'idempotent_replay'],
                    run: existingRun,
                    outputs: this.repository.listOutputs(runId),
                    human_steps: this.repository.listHumanSteps(runId),
                    context_snapshots: this.repository.listContextSnapshots(runId),
                    loop_intents: loopIntents.map((entry) => entry.loop_intent)
                }
            };
        }

        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const now = new Date().toISOString();
        const evidenceRefs = normalizeTags(reviewPackage.evidence_refs || reviewPackage.evidenceRefs);
        const stopConditions = normalizeTags(reviewPackage.stop_conditions || reviewPackage.stopConditions);

        return this.repository.transaction(async () => {
            const workflow = this.repository.upsertWorkflow({
                id: workflowId,
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                name: 'Meeting Review Package Ingest',
                description: 'Codex生成Review PackageをWorkflow Mission Controlの承認待ちrunへ取り込む',
                owner_id: actorId,
                default_assignee_id: actorId,
                default_approver_id: actorId,
                execution_env: 'local',
                risk_level: 'medium',
                hitl_policy: 'none',
                timeout_ms: 300000,
                implementation_key: MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY,
                context_sources: [{
                    id: `${workflowId}_package`,
                    source_type: 'review_package',
                    source_ref: packageId,
                    scope: 'meeting',
                    permission: 'read',
                    required: true,
                    preview: `${meetingIdentity.title || packageId} Review Package`
                }]
            });
            const run = this.repository.createRun({
                id: runId,
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                workflow_id: workflowId,
                workflow_name: workflow.name,
                status: 'waiting_human',
                closure_state: 'open',
                trigger_type: 'event',
                env: 'local',
                dry_run: false,
                started_by: actorId,
                owner_id: actorId,
                assignee_id: actorId,
                approver_id: actorId,
                action_required: 'approve',
                human_waiting: true,
                output_count: MEETING_REVIEW_OUTPUT_DEFINITIONS.length,
                message: 'Meeting Review Package is waiting for human approval',
                started_at: now,
                finished_at: now,
                duration_ms: 0,
                metadata: {
                    package_id: packageId,
                    seed_id: reviewPackage.seed_id || null,
                    case_scope: caseScope,
                    meeting_identity: jsonClone(meetingIdentity),
                    source_event: jsonClone(sourceEvent),
                    graph_context: jsonClone(meetingIdentity.graph_context || null),
                    loop_intent_ids: jsonClone(reviewPackage.loop_intent_ids || {}),
                    evidence_refs: evidenceRefs,
                    stop_conditions: stopConditions,
                    runner: {
                        type: 'codex_generated_package',
                        eve_connected: false
                    }
                }
            });
            this.repository.createRunStep({
                id: createMeetingReviewStableId('step', runId, 'ingest_review_package'),
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                workflow_run_id: runId,
                step_key: 'ingest_review_package',
                step_name: 'Review Package Ingest',
                status: 'waiting_human',
                action_required: 'approve',
                output_count: MEETING_REVIEW_OUTPUT_DEFINITIONS.length,
                message: 'Review Package outputs recorded and waiting for Human Gate',
                started_at: now,
                finished_at: now
            });
            const contextSnapshots = [
                {
                    id: createMeetingReviewStableId('ctx', runId, 'meeting_identity'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'meeting_identity',
                    source_ref: sourceRefForMeetingIdentity(meetingIdentity),
                    source_version: meetingIdentity.start || null,
                    content_hash: meetingIdentity.event_id || meetingIdentity.event_uid || null,
                    item_count: Object.keys(meetingIdentity).length,
                    permission: 'read',
                    preview: meetingIdentity.title || packageId,
                    data: jsonClone(meetingIdentity)
                },
                {
                    id: createMeetingReviewStableId('ctx', runId, 'source_event'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'meeting_source',
                    source_ref: sourceRefForSourceEvent(sourceEvent),
                    source_version: sourceEvent.message_ts || sourceEvent.file_id || null,
                    content_hash: sourceEvent.local_artifact_sha256 || null,
                    item_count: Object.keys(sourceEvent).length,
                    permission: 'read',
                    preview: sourceEvent.channel_name || sourceEvent.file_id || packageId,
                    data: jsonClone(sourceEvent)
                },
                {
                    id: createMeetingReviewStableId('ctx', runId, 'graph_context'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'graph_ssot',
                    source_ref: `graph-context:${orgId}:${projectId}:${caseScope || packageId}`,
                    source_version: null,
                    content_hash: null,
                    item_count: [
                        ...(meetingIdentity.graph_context?.org_entity_ids || []),
                        ...(meetingIdentity.graph_context?.person_entity_ids || [])
                    ].length,
                    permission: 'read',
                    preview: 'Graph SSOT context candidates',
                    data: {
                        ...jsonClone(meetingIdentity.graph_context || {}),
                        verification_status: 'candidate_from_review_package',
                        promoted_to_graph_ssot: false
                    }
                },
                {
                    id: createMeetingReviewStableId('ctx', runId, 'review_package'),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    source_type: 'review_package',
                    source_ref: packageId,
                    source_version: reviewPackage.schema_version || null,
                    content_hash: null,
                    item_count: MEETING_REVIEW_OUTPUT_DEFINITIONS.length,
                    permission: 'read',
                    preview: `${packageId} (${reviewPackage.status || 'unknown'})`,
                    data: {
                        schema_version: reviewPackage.schema_version || null,
                        status: reviewPackage.status || null,
                        seed_id: reviewPackage.seed_id || null
                    }
                }
            ].map((snapshot) => this.repository.createContextSnapshot(snapshot));
            const outputs = MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => {
                const payload = reviewPackage[definition.package_key] ?? null;
                const loopIntent = loopIntentByKey.get(definition.loop_intent_key);
                return this.repository.createOutput({
                    id: createMeetingReviewStableId('out', runId, definition.id),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    workflow_id: workflowId,
                    type: definition.type,
                    title: definition.title,
                    preview: previewPayload(payload),
                    metadata: {
                        package_id: packageId,
                        case_scope: caseScope,
                        output_key: definition.id,
                        package_key: definition.package_key,
                        loop_intent_id: loopIntent.id,
                        workflow_template_id: loopIntent.workflow_template_id,
                        workflow_binding_id: loopIntent.workflow_binding_id,
                        write_back_target: definition.write_back_target,
                        evidence_refs: evidenceRefs,
                        requires_human_approval: true,
                        runner_type: 'codex_generated_package'
                    },
                    payload: jsonClone(payload)
                });
            });
            const humanSteps = MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((definition) => {
                const loopIntent = loopIntentByKey.get(definition.loop_intent_key);
                return this.repository.createHumanStep({
                    id: createMeetingReviewStableId('human', runId, definition.id),
                    workspace_id: DEFAULT_WORKSPACE_ID,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_run_id: runId,
                    workflow_id: workflowId,
                    step_type: definition.step_type,
                    requested_by: actorId,
                    requested_to: actorId,
                    prompt: definition.prompt,
                    reason: definition.reason,
                    metadata: {
                        package_id: packageId,
                        case_scope: caseScope,
                        protects: definition.protects,
                        write_back_target: definition.write_back_target,
                        loop_intent_id: loopIntent.id,
                        requires_human_approval: true
                    }
                });
            });
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_review_package.ingested',
                target_type: 'workflow_run',
                target_id: runId,
                after: {
                    pack_id: MEETING_WORKFLOW_PACK_ID,
                    package_id: packageId,
                    case_scope: caseScope,
                    workflow_id: workflowId,
                    run_id: runId,
                    output_ids: outputs.map((output) => output.id),
                    human_step_ids: humanSteps.map((step) => step.id),
                    loop_intent_ids: loopIntents.map((entry) => entry.loop_intent.id),
                    runner: {
                        type: 'codex_generated_package',
                        eve_connected: false
                    },
                    state_transitions: MEETING_REVIEW_INGEST_SUCCESS_STATE_TRANSITIONS,
                    evidence_refs: evidenceRefs,
                    stop_conditions: stopConditions
                }
            });
            return {
                meeting_review_ingest: {
                    org_id: orgId,
                    project_id: projectId,
                    case_scope: caseScope,
                    package_id: packageId,
                    idempotent: false,
                    state_transitions: MEETING_REVIEW_INGEST_SUCCESS_STATE_TRANSITIONS,
                    run,
                    outputs,
                    human_steps: humanSteps,
                    context_snapshots: contextSnapshots,
                    loop_intents: loopIntents.map((entry) => entry.loop_intent)
                }
            };
        });
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
        await this._assertProjectSelectable(workflow.project_id);
        this._assertActorCanAccessProject(workflow.project_id, {
            sub: options.actorId,
            person_id: options.actorId,
            projectCodes: options.projectCodes || [],
            role: options.role,
            authSource: options.authSource
        });
        if (workflow.enabled === false) {
            throw AppError.validation(`workflow '${workflowId}' is disabled`);
        }
        assertWorkflowRunAllowed(workflow);
        return this.runner.runWorkflow(workflow, options);
    }

    async rerun(runId, options = {}, actor = {}) {
        await this._loadProjectConfigCache();
        const previous = this.repository.getRun(runId);
        if (!previous) throw AppError.notFound('workflow_run', runId);
        this._assertActorCanAccessProject(previous.project_id, actor);
        const workflow = this.repository.getWorkflow(previous.workflow_id);
        assertWorkflowRunAllowed(workflow);
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
        const approvedResolution = isApprovedHumanResolution(resolution);
        const resolvedStatus = approvedResolution ? 'approved' : resolution;
        const resolved = this.repository.updateHumanStep(stepId, {
            status: resolvedStatus,
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
        const previousRun = this.repository.getRun(step.workflow_run_id);
        const workflow = this.repository.getWorkflow(step.workflow_id);
        if (!approvedResolution) {
            const cancelledHumanStepIds = [];
            if (isMeetingReviewPackageWorkflow(workflow)) {
                for (const humanStep of this.repository.listHumanSteps(step.workflow_run_id)) {
                    if (humanStep.id !== stepId && isPendingHumanStepStatus(humanStep.status)) {
                        const cancelled = this.repository.updateHumanStep(humanStep.id, {
                            status: 'cancelled',
                            reason: `cancelled_after_${resolvedStatus}`,
                            resolved_at: new Date().toISOString(),
                            resolved_by: actor.person_id || actor.sub || 'system'
                        });
                        if (cancelled) cancelledHumanStepIds.push(cancelled.id);
                    }
                }
            }
            const closedRun = previousRun
                ? this.repository.updateRun(previousRun.id, {
                    status: 'cancelled',
                    closure_state: 'closed',
                    human_waiting: false,
                    action_required: 'none',
                    message: isMeetingReviewPackageWorkflow(workflow)
                        ? `Meeting Review Package stopped after human step ${resolvedStatus}`
                        : `Human step ${resolvedStatus}`,
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
                    resolution: resolvedStatus,
                    cancelled_human_step_ids: cancelledHumanStepIds,
                    status: closedRun?.status || 'cancelled'
                }
            });
            return { human_step: resolved, resumed_run: closedRun };
        }
        if (isMeetingReviewPackageWorkflow(workflow) && previousRun) {
            const allHumanSteps = this.repository.listHumanSteps(step.workflow_run_id);
            const pendingHumanSteps = allHumanSteps.filter((humanStep) => isPendingHumanStepStatus(humanStep.status));
            const approvedHumanSteps = allHumanSteps.filter((humanStep) => isApprovedHumanResolution(humanStep.status));
            const rejectedHumanSteps = allHumanSteps.filter((humanStep) => isRejectedHumanStepStatus(humanStep.status));
            const allApproved = allHumanSteps.length > 0 && approvedHumanSteps.length === allHumanSteps.length;
            const hasRejectedStep = rejectedHumanSteps.length > 0 || previousRun.status === 'cancelled';
            const updatedRun = hasRejectedStep
                ? this.repository.updateRun(previousRun.id, {
                    status: 'cancelled',
                    closure_state: 'closed',
                    human_waiting: false,
                    action_required: 'none',
                    message: 'Meeting Review Package human approvals stopped after rejected gate',
                    finished_at: new Date().toISOString()
                })
                : this.repository.updateRun(previousRun.id, {
                    status: allApproved ? 'success' : 'waiting_human',
                    closure_state: allApproved ? 'closed' : 'open',
                    human_waiting: !allApproved,
                    action_required: allApproved ? 'none' : 'approve',
                    message: allApproved
                        ? 'Meeting Review Package human approvals completed'
                        : `Meeting Review Package is waiting for ${pendingHumanSteps.length} human approval(s)`,
                    finished_at: new Date().toISOString()
                });
            this.repository.writeAuditLog({
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actor.person_id || actor.sub || 'system',
                action: hasRejectedStep
                    ? 'workflow.run.meeting_review_approvals.cancelled'
                    : allApproved
                    ? 'workflow.run.meeting_review_approvals.completed'
                    : 'workflow.run.meeting_review_approvals.progressed',
                target_type: 'workflow_run',
                target_id: previousRun.id,
                after: {
                    human_step_id: stepId,
                    approved_human_step_ids: approvedHumanSteps.map((humanStep) => humanStep.id),
                    pending_human_step_ids: pendingHumanSteps.map((humanStep) => humanStep.id),
                    rejected_human_step_ids: rejectedHumanSteps.map((humanStep) => humanStep.id),
                    status: updatedRun?.status || previousRun.status,
                    closure_state: updatedRun?.closure_state || previousRun.closure_state
                }
            });
            return { human_step: resolved, resumed_run: updatedRun };
        }
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
