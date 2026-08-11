// @ts-check

import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { MEETING_WORKFLOW_PACK_ID } from '../workflow/meeting-workflow-pack.js';
import {
    MEETING_REVIEW_HUMAN_STEP_DEFINITIONS,
    MEETING_REVIEW_OUTPUT_DEFINITIONS
} from './meeting-review-contract.js';
import {
    normalizeDecisionCandidates,
    normalizeFollowUpDraft
} from './meeting-candidate-contract.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_OWNER_ID = 'local-user';
const IMPLEMENTATION_KEY = 'meeting-review-package-ingest';
const SUCCESS_STATE_TRANSITIONS = [
    'package_received',
    'scope_resolved',
    'loop_intents_verified',
    'run_recorded',
    'outputs_recorded',
    'human_steps_recorded',
    'waiting_human'
];

function jsonClone(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}

function normalizeTags(value) {
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function readFirstOptionalString(input, ...keys) {
    for (const key of keys) {
        const value = input?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function stableId(prefix, ...parts) {
    const base = parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!base) return `${prefix}_${crypto.randomUUID()}`;
    if (base.length <= 96) return `${prefix}_${base}`;
    const hash = crypto.createHash('sha256').update(base).digest('hex').slice(0, 12);
    return `${prefix}_${base.slice(0, 83).replace(/_+$/g, '')}_${hash}`;
}

function sourceReplayKey(sourceEvent = {}) {
    if (!sourceEvent || typeof sourceEvent !== 'object') return null;
    const uri = sourceEvent.mcp_resource_uri || sourceEvent.artifact_ref || null;
    if (!uri) return null;
    return `${sourceEvent.provider || sourceEvent.source_system || ''}:${uri}`;
}

function sourceArtifactRef(sourceEvent = {}) {
    return readFirstOptionalString(sourceEvent, 'transcript_id', 'transcriptId', 'note_id', 'noteId', 'recording_id', 'recordingId', 'document_id', 'documentId', 'mcp_resource_uri', 'mcpResourceUri', 'permalink', 'url', 'file_id', 'fileId');
}

function sourceContentHash(sourceEvent = {}) {
    return readFirstOptionalString(sourceEvent, 'local_artifact_sha256', 'localArtifactSha256', 'transcript_sha256', 'transcriptSha256', 'content_hash', 'contentHash');
}

function sourceSystem(sourceEvent = {}) {
    return readFirstOptionalString(sourceEvent, 'source_system', 'sourceSystem', 'provider', 'source_provider', 'sourceProvider').toLowerCase();
}

function meetingIdentityRef(meetingIdentity = {}) {
    if (meetingIdentity.source === 'google_calendar') {
        return ['google-calendar', meetingIdentity.account || 'default', meetingIdentity.calendar_id || 'default', meetingIdentity.event_id || meetingIdentity.event_uid || 'unknown'].join(':');
    }
    return meetingIdentity.source ? `${meetingIdentity.source}:${meetingIdentity.event_id || meetingIdentity.title || 'unknown'}` : 'meeting_identity:unknown';
}

function sourceEventRef(sourceEvent = {}) {
    const system = sourceSystem(sourceEvent);
    if (system === 'tactiq') {
        return ['tactiq', sourceEvent.workspace || sourceEvent.account || 'default', sourceEvent.transcript_id || sourceEvent.transcriptId || sourceEvent.meeting_id || sourceEvent.meetingId || sourceEvent.mcp_resource_uri || sourceEvent.mcpResourceUri || sourceEvent.id || 'unknown'].join(':');
    }
    if (system === 'plaud') {
        return ['plaud', sourceEvent.account || sourceEvent.workspace || 'default', sourceEvent.recording_id || sourceEvent.recordingId || sourceEvent.note_id || sourceEvent.noteId || sourceEvent.mcp_resource_uri || sourceEvent.mcpResourceUri || sourceEvent.id || 'unknown'].join(':');
    }
    if (system === 'slack') {
        return ['slack', sourceEvent.workspace || 'default', sourceEvent.channel_id || sourceEvent.channel_name || 'unknown', sourceEvent.message_ts || sourceEvent.file_id || 'unknown'].join(':');
    }
    return system ? `${system}:${sourceEvent.id || 'unknown'}` : 'source_event:unknown';
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

export class MeetingReviewLedgerService {
    constructor({ repository }) {
        this.repository = repository;
    }

    _identity(context) {
        const { orgId, projectId, packageId, sourceEvent } = context;
        return {
            workflowId: stableId('wf', orgId, projectId, 'meeting_review_package_ingest'),
            runId: stableId('run', orgId, projectId, packageId, 'meeting_review_package_ingest'),
            replayKey: sourceReplayKey(sourceEvent)
        };
    }

    _findReplayRun(context) {
        const { workflowId, runId, replayKey } = this._identity(context);
        return this.repository.getRun(runId) || (replayKey
            ? this.repository.findRun({
                workflowId,
                predicate: (run) => sourceReplayKey(run.metadata?.source_event) === replayKey
            })
            : null);
    }

    _replayResult(context, replayRun) {
        const { orgId, projectId, caseScope, packageId, loopIntents, loopIntentByKey } = context;
        const { runId } = this._identity(context);
        return {
            meeting_review_ingest: {
                org_id: orgId,
                project_id: projectId,
                case_scope: caseScope,
                package_id: packageId,
                idempotent: true,
                ...(replayRun.id !== runId ? {
                    idempotent_source: 'source_artifact_match',
                    prior_package_id: replayRun.metadata?.package_id || null
                } : {}),
                note_generation_dispatch: {
                    status: 'skipped',
                    reason: 'idempotent_replay',
                    loop_intent_id: loopIntentByKey.get('transcript_to_meeting_note')?.id || null
                },
                state_transitions: ['package_received', 'scope_resolved', 'loop_intents_verified', 'idempotent_replay'],
                run: replayRun,
                outputs: this.repository.listOutputs(replayRun.id),
                human_steps: this.repository.listHumanSteps(replayRun.id),
                context_snapshots: this.repository.listContextSnapshots(replayRun.id),
                loop_intents: loopIntents.map((entry) => entry.loop_intent)
            }
        };
    }

    findReplay(context) {
        const replayRun = this._findReplayRun(context);
        return replayRun ? this._replayResult(context, replayRun) : null;
    }

    async recordNoteGeneration({
        orgId,
        projectId,
        packageId = null,
        runId = null,
        sourceTextHash,
        note,
        runner,
        actorId
    }) {
        const resolvedRunId = runId
            || stableId('run', orgId, projectId, packageId, 'meeting_review_package_ingest');
        const run = this.repository.getRun(resolvedRunId);
        if (!run) throw AppError.notFound('workflow_run', resolvedRunId);
        if (run.org_id !== orgId || run.project_id !== projectId) {
            throw AppError.validation(`workflow_run '${resolvedRunId}' belongs to '${run.org_id}/${run.project_id}'`, {
                state_transition: 'blocked_invalid_scope'
            });
        }

        const noteOutput = this.repository.listOutputs(resolvedRunId)
            .find((output) => output.metadata?.output_key === 'meeting_note_draft');
        if (!noteOutput) {
            throw AppError.validation(`workflow_run '${resolvedRunId}' has no meeting_note_draft output`, {
                state_transition: 'blocked_note_output_missing'
            });
        }

        const currentPayload = noteOutput.payload && typeof noteOutput.payload === 'object'
            ? noteOutput.payload
            : {};
        if (currentPayload.source_text_hash !== sourceTextHash) {
            throw AppError.validation('source_text_hash does not match the meeting_note_draft output', {
                state_transition: 'blocked_source_hash_mismatch',
                expected: currentPayload.source_text_hash || null
            });
        }

        const now = new Date().toISOString();
        const noteBody = note.body;
        const nextPayload = {
            ...currentPayload,
            title: typeof note.title === 'string' && note.title.trim()
                ? note.title.trim()
                : currentPayload.title,
            body: noteBody,
            generator: 'brainbase_meeting_pack',
            generation_source: 'transcript_to_meeting_note',
            generation_status: 'brainbase_generated',
            provider_note_authoritative: false,
            generated_at: now,
            generated_by: {
                type: typeof runner.type === 'string' && runner.type ? runner.type : 'unknown',
                session_id: typeof runner.session_id === 'string' ? runner.session_id : null,
                actor_id: actorId
            }
        };
        const updatedOutput = await this.repository.transaction(() => {
            const item = this.repository.updateOutput(noteOutput.id, {
                payload: nextPayload,
                preview: previewPayload(nextPayload),
                updated_at: now
            });
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_pack.note_generation.recorded',
                target_type: 'workflow_run',
                target_id: resolvedRunId,
                after: {
                    run_id: resolvedRunId,
                    output_id: noteOutput.id,
                    package_id: noteOutput.metadata?.package_id || packageId || null,
                    source_text_hash: sourceTextHash,
                    generation_status: nextPayload.generation_status,
                    state_transition: 'note_generation_recorded',
                    runner_type: nextPayload.generated_by?.type || null,
                    external_run_id: nextPayload.generated_by?.session_id || null,
                    generated_by: nextPayload.generated_by,
                    body_length: noteBody.length,
                    regenerated: currentPayload.generation_status === 'brainbase_generated'
                }
            });
            return item;
        });

        return {
            meeting_note_generation: {
                org_id: orgId,
                project_id: projectId,
                run_id: resolvedRunId,
                output_id: noteOutput.id,
                generation_status: nextPayload.generation_status,
                output: updatedOutput
            }
        };
    }

    resolveCandidateContext({
        orgId,
        projectId,
        packageId = null,
        runId = null,
        sourceTextHash
    }) {
        const resolvedRunId = runId
            || stableId('run', orgId, projectId, packageId, 'meeting_review_package_ingest');
        const run = this.repository.getRun(resolvedRunId);
        if (!run) throw AppError.notFound('workflow_run', resolvedRunId);
        if (run.org_id !== orgId || run.project_id !== projectId) {
            throw AppError.validation(`workflow_run '${resolvedRunId}' belongs to '${run.org_id}/${run.project_id}'`, {
                state_transition: 'blocked_invalid_scope'
            });
        }
        const outputs = this.repository.listOutputs(resolvedRunId);
        const noteOutput = outputs.find((output) => output.metadata?.output_key === 'meeting_note_draft');
        if (!noteOutput) {
            throw AppError.validation(`workflow_run '${resolvedRunId}' has no meeting_note_draft output`, {
                state_transition: 'blocked_note_output_missing'
            });
        }
        const noteHash = noteOutput.payload && typeof noteOutput.payload === 'object'
            ? noteOutput.payload.source_text_hash
            : null;
        if (noteHash !== sourceTextHash) {
            throw AppError.validation('source_text_hash does not match the meeting_note_draft output', {
                state_transition: 'blocked_source_hash_mismatch',
                expected: noteHash || null
            });
        }
        return { orgId, projectId, runId: resolvedRunId, run, outputs, noteOutput };
    }

    async recordCandidates({
        orgId,
        projectId,
        runId,
        outputs,
        noteOutput,
        packageId = null,
        sourceTextHash,
        runner,
        actorId,
        taskCandidates,
        decisionCandidates,
        followUpDraft
    }) {
        const now = new Date().toISOString();
        const generatedBy = {
            type: typeof runner.type === 'string' && runner.type ? runner.type : 'eve',
            session_id: typeof runner.session_id === 'string' ? runner.session_id : null,
            actor_id: actorId
        };
        const candidatePayloadBuilders = {
            task_candidates: () => taskCandidates,
            decision_candidates: (output) => normalizeDecisionCandidates(decisionCandidates, {
                caseScope: output.metadata?.case_scope || null,
                evidenceRefs: Array.isArray(output.metadata?.evidence_refs) ? output.metadata.evidence_refs : []
            }),
            follow_up_draft: () => normalizeFollowUpDraft(followUpDraft)
        };

        return this.repository.transaction(async () => {
            const updated = {};
            for (const [outputKey, buildPayload] of Object.entries(candidatePayloadBuilders)) {
                const output = outputs.find((candidate) => candidate.metadata?.output_key === outputKey);
                if (!output) continue;
                const payload = buildPayload(output);
                const updatedOutput = this.repository.updateOutput(output.id, {
                    payload,
                    preview: previewPayload(payload),
                    updated_at: now
                });
                updated[outputKey] = {
                    output_id: output.id,
                    count: Array.isArray(payload) ? payload.length : 1,
                    output: updatedOutput
                };
            }

            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_pack.candidates.recorded',
                target_type: 'workflow_run',
                target_id: runId,
                after: {
                    run_id: runId,
                    package_id: noteOutput.metadata?.package_id || packageId || null,
                    source_text_hash: sourceTextHash,
                    state_transition: 'meeting_candidates_recorded',
                    runner_type: generatedBy.type,
                    external_run_id: generatedBy.session_id,
                    generated_by: generatedBy,
                    task_candidate_count: updated.task_candidates?.count ?? 0,
                    decision_candidate_count: updated.decision_candidates?.count ?? 0,
                    follow_up_recorded: Boolean(updated.follow_up_draft)
                }
            });

            return {
                meeting_candidates: {
                    org_id: orgId,
                    project_id: projectId,
                    run_id: runId,
                    updated
                }
            };
        });
    }

    async persist(context, actor = {}) {
        const {
            reviewPackage,
            resolvedReviewPackage,
            packageId,
            meetingIdentity,
            sourceEvent,
            evidenceRefs,
            orgId,
            projectId,
            caseScope,
            projectResolution,
            graphPlaybookContext,
            loopIntents,
            loopIntentByKey
        } = context;
        const { workflowId, runId } = this._identity(context);
        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const now = new Date().toISOString();
        const stopConditions = normalizeTags(reviewPackage.stop_conditions || reviewPackage.stopConditions);

        return this.repository.transaction(async () => {
            const replayRun = this._findReplayRun(context);
            if (replayRun) return this._replayResult(context, replayRun);

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
                implementation_key: IMPLEMENTATION_KEY,
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
                    project_resolution: jsonClone(projectResolution),
                    graph_context: jsonClone(graphPlaybookContext.snapshot_data),
                    graph_ssot_playbook: jsonClone(graphPlaybookContext.graph_playbook),
                    loop_intent_ids: jsonClone(reviewPackage.loop_intent_ids || {}),
                    evidence_refs: evidenceRefs,
                    stop_conditions: stopConditions,
                    runner: { type: 'codex_generated_package', eve_connected: false }
                }
            });
            this.repository.createRunStep({
                id: stableId('step', runId, 'ingest_review_package'),
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
                    id: stableId('ctx', runId, 'meeting_identity'),
                    source_type: 'meeting_identity',
                    source_ref: meetingIdentityRef(meetingIdentity),
                    source_version: meetingIdentity.start || null,
                    content_hash: meetingIdentity.event_id || meetingIdentity.event_uid || null,
                    item_count: Object.keys(meetingIdentity).length,
                    preview: meetingIdentity.title || packageId,
                    data: jsonClone(meetingIdentity)
                },
                {
                    id: stableId('ctx', runId, 'source_event'),
                    source_type: 'meeting_source',
                    source_ref: sourceEventRef(sourceEvent),
                    source_version: sourceArtifactRef(sourceEvent) || sourceEvent.message_ts || sourceEvent.messageTs || null,
                    content_hash: sourceContentHash(sourceEvent) || null,
                    item_count: Object.keys(sourceEvent).length,
                    preview: sourceEvent.title || sourceEvent.channel_name || sourceEvent.transcript_id || sourceEvent.transcriptId || sourceEvent.recording_id || sourceEvent.recordingId || sourceEvent.note_id || sourceEvent.noteId || sourceEvent.file_id || packageId,
                    data: jsonClone(sourceEvent)
                },
                {
                    id: stableId('ctx', runId, 'graph_context'),
                    source_type: 'graph_ssot',
                    source_ref: `graph-context:${orgId}:${projectId}:${caseScope || packageId}`,
                    source_version: null,
                    content_hash: null,
                    item_count: graphPlaybookContext.item_count,
                    preview: graphPlaybookContext.graph_playbook.graph_context.status === 'resolved' ? `Graph SSOT context resolved (${graphPlaybookContext.item_count} entities)` : 'Graph SSOT context candidates with explicit fallback',
                    data: jsonClone(graphPlaybookContext.snapshot_data)
                },
                {
                    id: stableId('ctx', runId, 'review_package'),
                    source_type: 'review_package',
                    source_ref: packageId,
                    source_version: reviewPackage.schema_version || null,
                    content_hash: null,
                    item_count: MEETING_REVIEW_OUTPUT_DEFINITIONS.length,
                    preview: `${packageId} (${reviewPackage.status || 'unknown'})`,
                    data: { schema_version: reviewPackage.schema_version || null, status: reviewPackage.status || null, seed_id: reviewPackage.seed_id || null }
                }
            ].map((snapshot) => this.repository.createContextSnapshot({
                ...snapshot,
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                workflow_run_id: runId,
                permission: 'read'
            }));
            const outputs = MEETING_REVIEW_OUTPUT_DEFINITIONS.map((definition) => {
                const payload = resolvedReviewPackage[definition.package_key] ?? null;
                const loopIntent = loopIntentByKey.get(definition.loop_intent_key);
                return this.repository.createOutput({
                    id: stableId('out', runId, definition.id),
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
            const outputByTarget = new Map(outputs.map((output) => [output.metadata?.write_back_target, output]).filter(([target]) => Boolean(target)));
            const humanSteps = MEETING_REVIEW_HUMAN_STEP_DEFINITIONS.map((definition) => {
                const loopIntent = loopIntentByKey.get(definition.loop_intent_key);
                const protectedOutput = outputByTarget.get(definition.write_back_target) || null;
                return this.repository.createHumanStep({
                    id: stableId('human', runId, definition.id),
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
                        output_id: protectedOutput?.id || null,
                        output_key: protectedOutput?.metadata?.output_key || null,
                        output_type: protectedOutput?.type || protectedOutput?.output_type || null,
                        approval_kind: protectedOutput?.type || definition.write_back_target,
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
                    runner: { type: 'codex_generated_package', eve_connected: false },
                    project_resolution: jsonClone(projectResolution),
                    graph_ssot_playbook: jsonClone(graphPlaybookContext.graph_playbook),
                    state_transitions: SUCCESS_STATE_TRANSITIONS,
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
                    state_transitions: SUCCESS_STATE_TRANSITIONS,
                    run,
                    outputs,
                    human_steps: humanSteps,
                    context_snapshots: contextSnapshots,
                    loop_intents: loopIntents.map((entry) => entry.loop_intent)
                }
            };
        });
    }
}
