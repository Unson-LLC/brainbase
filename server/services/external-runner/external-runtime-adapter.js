// @ts-check

import crypto from 'node:crypto';
import { canonicalJson } from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import {
    ExternalRunnerContractError,
    validateExternalRunnerEnvelope
} from './contract-schema.js';

const APPROVAL_REQUIRED_STATUSES = new Set(['approval_required', 'waiting_human']);

function nowIso() {
    return new Date().toISOString();
}

function normalizeRunStatus(status) {
    if (status === 'completed') return 'success';
    if (APPROVAL_REQUIRED_STATUSES.has(status)) return 'waiting_human';
    if (status === 'blocked') return 'needs_action';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'failed') return 'failed';
    return status || 'queued';
}

function normalizeClosureState(status) {
    if (status === 'completed') return 'closed';
    if (APPROVAL_REQUIRED_STATUSES.has(status)) return 'open';
    if (status === 'cancelled') return 'closed';
    if (status === 'blocked' || status === 'failed') return 'needs_action';
    return 'open';
}

function normalizeActionRequired(status) {
    if (APPROVAL_REQUIRED_STATUSES.has(status)) return 'approve';
    if (status === 'blocked') return 'resolve_blocker';
    if (status === 'failed') return 'check_error';
    return 'none';
}

function idPart(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '_');
}

function externalRunIdPart(value) {
    const raw = String(value || 'unknown');
    const normalized = idPart(raw).slice(0, 80);
    const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
    return `${normalized}_${digest}`;
}

function firstNonBlank(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    return '';
}

function withoutUndefined(value) {
    if (Array.isArray(value)) return value.map((item) => withoutUndefined(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, withoutUndefined(child)]));
}

function companyAuthorityHandoffDigest(handoff) {
    return crypto.createHash('sha256')
        .update(canonicalJson(withoutUndefined(handoff)))
        .digest('hex');
}

export class ExternalRuntimeAdapter {
    normalize(payload) {
        const envelope = validateExternalRunnerEnvelope(payload);
        const workspaceId = envelope.run.workspace_id || 'default';
        const orgId = envelope.run.org_id || null;
        const projectId = envelope.run.project_id;
        const runScope = orgId ? `${idPart(orgId)}_${idPart(projectId)}` : idPart(projectId);
        const runId = `run_${runScope}_${idPart(envelope.runner.type)}_${externalRunIdPart(envelope.runner.external_run_id)}`;
        const workflowId = envelope.run.workflow_id
            || envelope.run.selected_workflow_id
            || `external_runner_${runScope}_${idPart(envelope.runner.agent_id)}`;
        const roleAgentInstanceId = envelope.run.role_agent_instance_id || null;
        const workflowTemplateId = envelope.run.workflow_template_id || null;
        const workflowBindingId = envelope.run.workflow_binding_id || null;
        const triggerId = envelope.run.trigger_id || null;
        const loopIntentId = envelope.run.loop_intent_id || null;
        const status = envelope.run.status;
        const createdAt = envelope.run.started_at || nowIso();
        const finishedAt = envelope.run.finished_at || (status === 'completed' ? nowIso() : null);

        const workflow = {
            id: workflowId,
            workspace_id: workspaceId,
            org_id: orgId,
            project_id: projectId,
            name: envelope.run.workflow_name || `${envelope.run.role_agent_id} external runner workflow`,
            description: envelope.run.workflow_description || `External runner workflow for ${envelope.runner.agent_id}`,
            enabled: true,
            owner_id: envelope.loop_control.owner_id,
            default_assignee_id: envelope.loop_control.owner_id,
            default_approver_id: envelope.loop_control.approval_owner_id,
            execution_env: 'external',
            risk_level: envelope.loop_control.risk_level || 'medium',
            hitl_policy: envelope.loop_control.hitl_policy || 'external_runner',
            timeout_ms: envelope.loop_control.timeout_ms || 3600000,
            implementation_key: `external-runner:${envelope.runner.type}`,
            context_sources: envelope.context_sources.map((source, index) => ({
                id: source.id || `ctx_${workflowId}_${index + 1}`,
                source_type: source.source_type,
                source_ref: source.source_ref,
                scope: source.scope || 'project',
                permission: source.permission || 'read',
                required: source.required !== false,
                preview: source.preview || null
            }))
        };

        const run = {
            id: runId,
            workspace_id: workspaceId,
            org_id: orgId,
            project_id: projectId,
            workflow_id: workflowId,
            role_agent_instance_id: roleAgentInstanceId,
            workflow_template_id: workflowTemplateId,
            workflow_binding_id: workflowBindingId,
            trigger_id: triggerId,
            loop_intent_id: loopIntentId,
            status: normalizeRunStatus(status),
            closure_state: normalizeClosureState(status),
            action_required: normalizeActionRequired(status),
            human_waiting: APPROVAL_REQUIRED_STATUSES.has(status),
            output_count: Array.isArray(envelope.outputs) ? envelope.outputs.length : 0,
            actor_id: envelope.runner.agent_id,
            trigger_type: envelope.run.trigger_type || 'external_runner',
            message: envelope.run.summary || null,
            started_at: createdAt,
            finished_at: finishedAt,
            metadata: {
                contract_version: envelope.contract_version,
                runner: envelope.runner,
                org_id: orgId,
                role_agent_id: envelope.run.role_agent_id,
                role_agent_instance_id: roleAgentInstanceId,
                workflow_template_id: workflowTemplateId,
                workflow_binding_id: workflowBindingId,
                trigger_id: triggerId,
                loop_intent_id: loopIntentId,
                selected_workflow_reason: envelope.run.selected_workflow_reason || null,
                eligibility: envelope.run.eligibility || null,
                judgment_dag_trace: envelope.judgment_dag_trace || null,
                loop_control: envelope.loop_control
            }
        };

        const contextSnapshots = envelope.context_sources.map((source, index) => ({
            id: source.snapshot_id || `ctxsnap_${runId}_${index + 1}`,
            workspace_id: workspaceId,
            org_id: orgId,
            project_id: projectId,
            workflow_id: workflowId,
            workflow_run_id: runId,
            source_type: source.source_type,
            source_ref: source.source_ref,
            digest: source.digest || null,
            redaction_status: source.redaction_status || 'not_required',
            metadata: {
                evidence_refs: source.evidence_refs || [],
                preview: source.preview || null
            }
        }));

        const companyAuthorityHandoffs = [];
        const humanSteps = (envelope.human_steps || []).map((step, index) => {
            const actionableText = firstNonBlank(step.prompt, step.title, step.description, step.approval_reason);
            const humanStepId = step.id || `human_${runId}_${index + 1}`;
            const handoff = step.company_authority_handoff;
            const observedRequesterId = handoff?.observed_request?.provider_identity?.authenticated_subject_id;
            const requestedBy = handoff
                ? handoff.requested_by || observedRequesterId
                : undefined;
            const handoffDigest = handoff ? companyAuthorityHandoffDigest(handoff) : null;
            const approvalOwnerId = handoff?.target_approver_id
                || step.required_by
                || envelope.loop_control.approval_owner_id;
            if (handoff) {
                for (const [field, actual] of [
                    ['requested_by', step.requested_by],
                    ['required_by', step.required_by],
                    ['requested_to', step.requested_to]
                ]) {
                    if (actual !== undefined && actual !== null && actual !== requestedBy && field === 'requested_by') {
                        throw new ExternalRunnerContractError(
                            'company_authority_human_approval_requester_mismatch',
                            `human_steps[${index}].${field} must match the observed Company Authority requester`,
                            { index, field, expected: requestedBy, actual }
                        );
                    }
                    if (actual !== undefined && actual !== null && actual !== approvalOwnerId && field !== 'requested_by') {
                        throw new ExternalRunnerContractError(
                            'company_authority_human_approval_approver_mismatch',
                            `human_steps[${index}].${field} must match the Company Authority target approver`,
                            { index, field, expected: approvalOwnerId, actual }
                        );
                    }
                }
                if (requestedBy !== observedRequesterId) {
                    throw new ExternalRunnerContractError(
                        'company_authority_human_approval_requester_mismatch',
                        `human_steps[${index}].company_authority_handoff.requested_by must match observed_request.provider_identity.authenticated_subject_id`,
                        { index, expected: observedRequesterId, actual: requestedBy }
                    );
                }
                companyAuthorityHandoffs.push({
                    humanStepId,
                    observedRequest: handoff.observed_request,
                    authorityResponse: handoff.authority_response,
                    executionHash: handoff.execution_hash || null,
                    handoffIdempotencyKey: handoff.handoff_idempotency_key,
                    targetApproverId: handoff.target_approver_id
                });
            }
            return {
                id: humanStepId,
                workspace_id: workspaceId,
                org_id: orgId,
                project_id: projectId,
                workflow_id: workflowId,
                workflow_run_id: runId,
                step_type: step.step_type || 'approval',
                status: step.status || 'pending',
                prompt: actionableText,
                title: step.title || actionableText,
                description: firstNonBlank(step.description, actionableText) || null,
                required_by: approvalOwnerId,
                requested_to: approvalOwnerId,
                ...(requestedBy ? { requested_by: requestedBy } : {}),
                metadata: {
                    prompt: actionableText || null,
                    approval_reason: step.approval_reason || null,
                    evidence_refs: step.evidence_refs || [],
                    ...(handoffDigest ? { company_authority_handoff_digest: handoffDigest } : {})
                }
            };
        });

        const outputs = (envelope.outputs || []).map((output, index) => ({
            id: output.id || `output_${runId}_${index + 1}`,
            workspace_id: workspaceId,
            org_id: orgId,
            project_id: projectId,
            workflow_id: workflowId,
            workflow_run_id: runId,
            output_type: output.output_type || output.type || 'artifact',
            title: output.title || `External runner output ${index + 1}`,
            body: output.body || output.content || '',
            visibility: output.visibility || 'internal',
            approval_required: Boolean(output.approval_required),
            metadata: {
                evidence_refs: output.evidence_refs || [],
                runner_output_ref: output.runner_output_ref || null
            }
        }));

        const auditEvents = [
            {
                workspace_id: workspaceId,
                org_id: orgId,
                project_id: projectId,
                actor_id: envelope.runner.agent_id,
                action: 'external_runner.ingested',
                target_type: 'workflow_run',
                target_id: runId,
                after: {
                    contract_version: envelope.contract_version,
                    org_id: orgId,
                    runner_type: envelope.runner.type,
                    external_run_id: envelope.runner.external_run_id,
                    trace_ref: envelope.runner.trace_ref || null,
                    role_agent_instance_id: roleAgentInstanceId,
                    workflow_template_id: workflowTemplateId,
                    workflow_binding_id: workflowBindingId,
                    trigger_id: triggerId,
                    loop_intent_id: loopIntentId
                }
            },
            ...envelope.rounds.map((round) => ({
                workspace_id: workspaceId,
                org_id: orgId,
                project_id: projectId,
                actor_id: envelope.runner.agent_id,
                action: 'external_runner.round_recorded',
                target_type: 'workflow_run',
                target_id: runId,
                after: round
            }))
        ];

        const learningCandidates = (envelope.learning_candidates || []).map((candidate) => ({
            candidate_id: candidate.candidate_id,
            cognitive_type: candidate.cognitive_type,
            body: candidate.body,
            promotion_policy: candidate.promotion_policy || 'manual_review',
            redaction_status: candidate.redaction_status || 'not_required',
            confidence: candidate.confidence || null,
            source: 'external_runner',
            org_ids: orgId ? [orgId] : [],
            project_ids: projectId ? [projectId] : [],
            project_id: projectId,
            workflow_run_id: candidate.workflow_run_id || runId,
            org_id: orgId,
            role_agent_instance_id: roleAgentInstanceId,
            workflow_template_id: workflowTemplateId,
            workflow_binding_id: workflowBindingId,
            trigger_id: triggerId,
            loop_intent_id: loopIntentId,
            evidence_refs: candidate.evidence_refs || [],
            owner_person_id: candidate.owner_person_id || envelope.loop_control.owner_id,
            actor_person_id: candidate.actor_person_id || envelope.runner.agent_id
        }));

        return {
            contractVersion: envelope.contract_version,
            runnerType: envelope.runner.type,
            externalRunId: envelope.runner.external_run_id,
            workflow,
            run,
            contextSnapshots,
            humanSteps,
            companyAuthorityHandoffs,
            outputs,
            auditEvents,
            learningCandidates
        };
    }
}
