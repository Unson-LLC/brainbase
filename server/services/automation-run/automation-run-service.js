// @ts-check

import { AppError } from '../../lib/errors.js';

const MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY = 'meeting-review-package-ingest';
const EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY = 'eve-session-dispatch';
const AGENT_REPORT_INGEST_IMPLEMENTATION_KEY = 'external-runner:agent_report';

function assertWorkflowRunAllowed(workflow) {
    if (workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY) {
        throw AppError.validation('meeting-review-package-ingest workflows cannot be manually run; use /api/workflows/control/meeting-pack/review-ingest');
    }
    if (workflow?.implementation_key === EVE_SESSION_DISPATCH_IMPLEMENTATION_KEY) {
        throw AppError.validation('eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session');
    }
}

function isMeetingReviewPackageWorkflow(workflow) {
    return workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY;
}

function isAgentReportWorkflow(workflow) {
    return workflow?.implementation_key === AGENT_REPORT_INGEST_IMPLEMENTATION_KEY;
}

function isApprovalOnlyIngestWorkflow(workflow) {
    return isMeetingReviewPackageWorkflow(workflow) || isAgentReportWorkflow(workflow);
}

function isRunReceiptWorkflow(workflow) {
    return Boolean(workflow?.metadata?.run_receipt || workflow?.metadata?.surface === 'run_receipt');
}

function isRunReceiptRun(run) {
    return Boolean(run?.metadata?.run_receipt);
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

export class AutomationRunService {
    constructor({
        repository,
        runner,
        ensureDefaultWorkflows = async () => {},
        prepareProjectAccess = async () => {},
        assertProjectSelectable = async () => {},
        assertProjectAccess = () => {},
        assertHumanStepAccess = () => {}
    }) {
        this.repository = repository;
        this.runner = runner;
        this.ensureDefaultWorkflows = ensureDefaultWorkflows;
        this.prepareProjectAccess = prepareProjectAccess;
        this.assertProjectSelectable = assertProjectSelectable;
        this.assertProjectAccess = assertProjectAccess;
        this.assertHumanStepAccess = assertHumanStepAccess;
    }

    async runWorkflow(workflowId, options = {}) {
        await this.ensureDefaultWorkflows();
        await this.prepareProjectAccess();
        const workflow = this.repository.getWorkflow(workflowId);
        if (!workflow) throw AppError.notFound('workflow', workflowId);
        if (isRunReceiptWorkflow(workflow)) throw AppError.notFound('workflow', workflowId);
        await this.assertProjectSelectable(workflow.project_id);
        this.assertProjectAccess(workflow.project_id, {
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
        await this.prepareProjectAccess();
        const previous = this.repository.getRun(runId);
        if (!previous) throw AppError.notFound('workflow_run', runId);
        if (isRunReceiptRun(previous)) throw AppError.notFound('workflow_run', runId);
        this.assertProjectAccess(previous.project_id, actor);
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
        await this.prepareProjectAccess();
        const run = this.repository.getRun(runId);
        if (!run) throw AppError.notFound('workflow_run', runId);
        if (isRunReceiptRun(run)) throw AppError.notFound('workflow_run', runId);
        this.assertProjectAccess(run.project_id, actor);
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
        await this.prepareProjectAccess();
        const initialStep = this.repository.getHumanStep(stepId);
        if (!initialStep) throw AppError.notFound('workflow_human_step', stepId);
        if (input.run_id && input.run_id !== initialStep.workflow_run_id) {
            throw AppError.validation(`human step '${stepId}' does not belong to run '${input.run_id}'`);
        }
        this.assertProjectAccess(initialStep.project_id, actor);
        this.assertHumanStepAccess(initialStep, actor);
        const resolution = input.resolution || input.status || 'approved';
        const approvedResolution = isApprovedHumanResolution(resolution);
        const resolvedStatus = approvedResolution ? 'approved' : resolution;
        const mutation = await this._transaction(() => {
            const step = this.repository.getHumanStep(stepId);
            if (!step) throw AppError.notFound('workflow_human_step', stepId);
            if (step.status !== 'pending') {
                throw AppError.conflict(`human step '${stepId}' is already ${step.status}`);
            }
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
                if (isApprovalOnlyIngestWorkflow(workflow)) {
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
                            : isAgentReportWorkflow(workflow)
                            ? `Agent report stopped after human step ${resolvedStatus}`
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
                return { terminal: { human_step: resolved, resumed_run: closedRun } };
            }
            if (isApprovalOnlyIngestWorkflow(workflow) && previousRun) {
                const approvalLabel = isMeetingReviewPackageWorkflow(workflow) ? 'Meeting Review Package' : 'Agent report';
                const auditPrefix = isMeetingReviewPackageWorkflow(workflow)
                    ? 'workflow.run.meeting_review_approvals'
                    : 'workflow.run.agent_report_approvals';
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
                        message: `${approvalLabel} human approvals stopped after rejected gate`,
                        finished_at: new Date().toISOString()
                    })
                    : this.repository.updateRun(previousRun.id, {
                        status: allApproved ? 'success' : 'waiting_human',
                        closure_state: allApproved ? 'closed' : 'open',
                        human_waiting: !allApproved,
                        action_required: allApproved ? 'none' : 'approve',
                        message: allApproved
                            ? `${approvalLabel} human approvals completed`
                            : `${approvalLabel} is waiting for ${pendingHumanSteps.length} human approval(s)`,
                        finished_at: new Date().toISOString()
                    });
                this.repository.writeAuditLog({
                    workspace_id: step.workspace_id,
                    project_id: step.project_id,
                    actor_id: actor.person_id || actor.sub || 'system',
                    action: hasRejectedStep
                        ? `${auditPrefix}.cancelled`
                        : allApproved
                        ? `${auditPrefix}.completed`
                        : `${auditPrefix}.progressed`,
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
                return { terminal: { human_step: resolved, resumed_run: updatedRun } };
            }
            return { step, resolved, previousRun };
        });
        if (mutation.terminal) return mutation.terminal;
        const { step, resolved, previousRun } = mutation;
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
        await this._transaction(() => {
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
        });
        return { human_step: resolved, resumed_run: resume.run };
    }

    async _transaction(callback) {
        if (typeof this.repository.transaction === 'function') {
            return this.repository.transaction(callback);
        }
        return callback();
    }
}
