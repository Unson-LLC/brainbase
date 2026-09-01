// @ts-check

function priority({ pendingHumanSteps = [], outputs = [], run = {} } = {}) {
    const highRiskTargets = new Set(['external_message_draft', 'graph_ssot_decision', 'candidate_store', 'task_store']);
    const protectedTargets = [
        ...pendingHumanSteps.map((step) => step?.metadata?.write_back_target || step?.write_back_target),
        ...outputs.map((output) => output?.metadata?.write_back_target)
    ].filter(Boolean);
    if (run.status === 'failed' || protectedTargets.some((target) => highRiskTargets.has(target))) return 'high';
    if (pendingHumanSteps.length > 1) return 'medium';
    return 'low';
}

function isActionable(run = {}) {
    const status = String(run.status || '').toLowerCase();
    if (['success', 'succeeded', 'cancelled', 'canceled', 'resolved', 'skipped', 'closed'].includes(status)) return false;
    if (run.closure_state === 'closed') return false;
    return run.human_waiting === true || status === 'waiting_human' || Boolean(run.action_required && run.action_required !== 'none');
}

function outputSummary(output) {
    const preview = typeof output?.preview === 'string' ? output.preview.trim() : '';
    if (preview) return preview.slice(0, 240);
    const payload = output?.payload;
    if (Array.isArray(payload)) return `${payload.length}件`;
    if (payload && typeof payload === 'object') {
        const keys = Object.keys(payload);
        if (keys.length > 0) return keys.slice(0, 6).join(', ');
    }
    return payload == null ? '' : String(payload).slice(0, 240);
}

function normalizeOutput(output) {
    return {
        id: output.id,
        output_type: output.type || output.output_type || null,
        title: output.title || output.type || output.id,
        summary: outputSummary(output),
        preview: output.preview || null,
        payload: output.payload ?? null,
        metadata: output.metadata || {},
        created_at: output.created_at || null
    };
}

function normalizeHumanStep(step) {
    const metadata = step.metadata || {};
    return {
        id: step.id,
        prompt: step.prompt || '',
        status: step.status || 'pending',
        step_type: step.step_type || null,
        requested_by: step.requested_by || null,
        requested_to: step.requested_to || null,
        approval_kind: metadata.approval_kind || metadata.reason || step.reason || step.step_type || 'approval',
        write_back_target: metadata.write_back_target || step.write_back_target || null,
        protects: Array.isArray(metadata.protects) ? metadata.protects : [],
        loop_intent_id: metadata.loop_intent_id || null,
        metadata,
        created_at: step.created_at || null,
        updated_at: step.updated_at || null
    };
}

function normalizeContext(snapshot) {
    return {
        id: snapshot.id,
        source_type: snapshot.source_type || snapshot.type || null,
        source_ref: snapshot.source_ref || snapshot.ref || null,
        source_version: snapshot.source_version || null,
        title: snapshot.title || snapshot.source_type || snapshot.id,
        summary: snapshot.preview || snapshot.summary || '',
        payload: snapshot.data ?? snapshot.payload ?? null,
        metadata: snapshot.metadata || {},
        created_at: snapshot.created_at || null
    };
}

function normalizeEvidence(auditLog) {
    return {
        id: auditLog.id,
        action: auditLog.action || null,
        target_type: auditLog.target_type || null,
        target_id: auditLog.target_id || null,
        summary: auditLog.summary || auditLog.message || auditLog.action || '',
        before: auditLog.before ?? null,
        after: auditLog.after ?? null,
        metadata: auditLog.metadata || {},
        created_at: auditLog.created_at || null
    };
}

function actionKind({ pendingHumanSteps = [], outputs = [], run = {} } = {}) {
    const firstStep = pendingHumanSteps[0] || {};
    const metadata = firstStep.metadata || {};
    return metadata.action_kind || metadata.approval_kind || outputs[0]?.type || outputs[0]?.output_type
        || metadata.write_back_target || outputs[0]?.metadata?.action_kind || outputs[0]?.metadata?.write_back_target
        || run.action_required || 'approval';
}

function owner({ run = {}, workflow = null, pendingHumanSteps = [] } = {}) {
    const firstStep = pendingHumanSteps[0] || {};
    return firstStep.requested_to || firstStep.assignee_id || firstStep.approver_id || run.approver_id
        || run.assignee_id || run.owner_id || workflow?.default_approver_id || workflow?.default_assignee_id
        || workflow?.owner_id || run.metadata?.owner_id || null;
}

function displayTitle(run, workflow) {
    return run?.metadata?.meeting_identity?.title || run?.metadata?.title || workflow?.name
        || run?.workflow_id || run?.id || 'Automation approval';
}

export class CompanionApprovalInboxService {
    constructor({ repository, projectAccessPolicy }) {
        this.repository = repository;
        this.projectAccessPolicy = projectAccessPolicy;
    }

    async list({ projectId = null, limit = 100 } = {}, actor = {}) {
        await this.projectAccessPolicy.prepare(actor);
        if (projectId) this.projectAccessPolicy.assertProjectAccess(projectId, actor);
        const runs = this.repository.listRuns({ projectId, limit: null })
            .filter((run) => this.projectAccessPolicy.canAccessProject(run.project_id, actor));
        const allItems = [];

        for (const run of runs) {
            if (!isActionable(run)) continue;
            const pendingHumanSteps = this.repository.listHumanSteps(run.id)
                .filter((step) => String(step.status || '').toLowerCase() === 'pending');
            if (pendingHumanSteps.length === 0) continue;
            const workflow = this.repository.getWorkflow(run.workflow_id) || null;
            const outputs = this.repository.listOutputs(run.id);
            const auditLogs = this.repository.listAuditLogs({ targetId: run.id, limit: 20 });
            const contextSnapshots = this.repository.listContextSnapshots(run.id);
            allItems.push({
                id: `approval_${run.id}`,
                kind: 'workflow_approval',
                title: displayTitle(run, workflow),
                summary: `${pendingHumanSteps.length}件の承認待ち、${outputs.length}件のoutput`,
                priority: priority({ pendingHumanSteps, outputs, run }),
                owner_id: owner({ run, workflow, pendingHumanSteps }),
                action_kind: actionKind({ pendingHumanSteps, outputs, run }),
                workflow_id: run.workflow_id,
                workflow_name: workflow?.name || run.workflow_id,
                run_id: run.id,
                api_path: `/api/workflow-runs/${encodeURIComponent(run.id)}`,
                project_id: run.project_id || workflow?.project_id || null,
                org_id: run.org_id || run.metadata?.org_id || null,
                case_scope: run.metadata?.case_scope || run.metadata?.meeting_identity?.case_scope || null,
                status: run.status || null,
                action_required: run.action_required || null,
                created_at: run.created_at || run.started_at || null,
                updated_at: run.updated_at || run.finished_at || run.started_at || run.created_at || null,
                source_url: run.metadata?.source_event?.permalink || run.metadata?.source_url || run.metadata?.meeting_identity?.source_url || null,
                pending_human_steps: pendingHumanSteps.map(normalizeHumanStep),
                outputs: outputs.map(normalizeOutput),
                context: contextSnapshots.map(normalizeContext),
                audit_refs: auditLogs.map((log) => log.id).filter(Boolean),
                evidence: auditLogs.map(normalizeEvidence),
                metadata: {
                    meeting_identity: run.metadata?.meeting_identity || null,
                    source_event: run.metadata?.source_event || null,
                    stop_conditions: run.metadata?.stop_conditions || []
                }
            });
        }

        const items = allItems.slice(0, limit);
        return { items, count: items.length, has_more: allItems.length > limit, omitted_count: Math.max(allItems.length - items.length, 0) };
    }
}
