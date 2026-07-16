import { describe, expect, it } from 'vitest';

import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    MEETING_WORKFLOW_DEFINITIONS,
    meetingPackIds
} from '../../../server/services/workflow/meeting-workflow-pack.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';

function makeService({
    repository = new InMemoryWorkflowRepository(),
    handlers = createDefaultWorkflowHandlers(),
    googleCalendarService = null,
    eveSessionClient = null,
    infoSSOTService = null
} = {}) {
    const runner = new WorkflowRunner({ repository, handlers });
    const configParser = {
        async getProjects() {
            return {
                root: '/workspace',
                projects: [
                    { id: 'unson', session_select: true, aliases: ['unson-os'] },
                    { id: 'salestailor', session_select: true, aliases: ['sales-tailor'] },
                    { id: 'tech-knight', session_select: true },
                    { id: 'techknight', session_select: true }
                ]
            };
        }
    };
    const service = new WorkflowService({ repository, runner, configParser, googleCalendarService, eveSessionClient, infoSSOTService });
    const actor = {
        sub: 'keigo',
        person_id: 'keigo',
        role: 'admin',
        projectCodes: ['unson', 'salestailor']
    };
    return { repository, service, actor };
}

function makeInfoSSOTPeopleService(records = []) {
    const calls = [];
    const recordProjectCodes = (record) => {
        const payload = record.payload || {};
        return new Set([
            record.project_id,
            record.projectId,
            record.project_code,
            record.projectCode,
            record.project_codes,
            record.projectCodes,
            record.member_of_project_codes,
            record.memberOfProjectCodes,
            payload.project_id,
            payload.projectId,
            payload.project_code,
            payload.projectCode,
            payload.project_codes,
            payload.projectCodes,
            payload.member_of_project_codes,
            payload.memberOfProjectCodes
        ].flat().filter(Boolean).map(String));
    };
    return {
        calls,
        async listGraphEntities(access, options = {}) {
            calls.push({ access, options });
            const projectCode = String(options.projectCode || '').trim();
            const accessProjectCodes = new Set(
                (Array.isArray(access?.projectCodes) ? access.projectCodes : [])
                    .filter(Boolean)
                    .map(String)
            );
            const isVisibleToAccess = (record) => {
                const recordProjects = recordProjectCodes(record);
                return !accessProjectCodes.size
                    || !recordProjects.size
                    || [...recordProjects].some((code) => accessProjectCodes.has(code));
            };
            if (options.id) {
                return records.filter((record) => {
                    const payload = record.payload || {};
                    if (projectCode && !recordProjectCodes(record).has(projectCode)) return false;
                    if (projectCode && !isVisibleToAccess(record)) return false;
                    return [record.id, record.entity_id, payload.person_id, payload.id]
                        .filter(Boolean)
                        .some((value) => String(value) === String(options.id));
                });
            }
            const query = String(options.query || '').trim().replace(/^@+/, '').toLowerCase();
            return records.filter((record) => {
                const payload = record.payload || {};
                if (projectCode && !recordProjectCodes(record).has(projectCode)) return false;
                if (projectCode && !isVisibleToAccess(record)) return false;
                const values = [
                    record.id,
                    payload.name,
                    payload.display_name,
                    ...(Array.isArray(payload.aliases) ? payload.aliases : [])
                ].filter(Boolean).map((value) => String(value).toLowerCase());
                if (!query) return true;
                return values.some((value) => value.includes(query));
            });
        }
    };
}

function makeEveSessionClient({
    sessionId = 'eve-session-service-001',
    continuationToken = 'cont-service-001',
    sessions = null,
    reject = null
} = {}) {
    const calls = [];
    return {
        calls,
        isConfigured() {
            return true;
        },
        async createSession(input) {
            calls.push(input);
            if (reject) throw reject;
            const next = Array.isArray(sessions) && sessions.length
                ? sessions[Math.min(calls.length - 1, sessions.length - 1)]
                : { session_id: sessionId, continuation_token: continuationToken };
            return {
                session_id: next.session_id ?? next.sessionId ?? null,
                continuation_token: next.continuation_token ?? next.continuationToken ?? null,
                response: { ok: true }
            };
        }
    };
}

function sampleMeetingReviewPackage({
    orgId = 'salestailor',
    projectId = 'salestailor',
    packageId = 'meeting-review-package-service-test'
} = {}) {
    return {
        schema_version: '0.1.0',
        package_id: packageId,
        status: 'review_required',
        meeting_identity: {
            source: 'google_calendar',
            account: 'info@example.com',
            calendar_id: 'primary',
            event_id: 'evt-1',
            title: '会議レビュー',
            start: '2026-06-25T13:00:00+09:00',
            end: '2026-06-25T14:00:00+09:00',
            candidate_org_id: orgId,
            candidate_project_id: projectId,
            case_scope: 'service-loop-test',
            graph_context: {
                org_entity_ids: ['org-service'],
                person_entity_ids: ['person-service']
            }
        },
        source_event: {
            source_system: 'slack',
            workspace: 'unson',
            channel_id: 'C08SYTDR7R8',
            message_ts: '1782367965.844209',
            file_id: 'F0BCYNXMP6H',
            local_artifact_sha256: 'abc123'
        },
        loop_intent_ids: {
            pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
            transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
            meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
            meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
            post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
        },
        meeting_note_summary: {
            background: ['背景'],
            agreements: ['合意'],
            open_questions: ['未決']
        },
        task_candidates: ['次のタスク'],
        decision_candidates: ['次の判断'],
        follow_up_draft: {
            status: 'draft_only',
            external_send_required_approval: true,
            body: 'ありがとうございました。'
        },
        promotion_candidates: {
            graph: ['org:service'],
            learning: ['学習候補']
        },
        evidence_refs: ['transcript:00:01:00-00:02:00'],
        stop_conditions: ['external_send_requires_human_approval']
    };
}

function expectedLegacyStableId(prefix, ...parts) {
    const base = parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96);
    return base ? `${prefix}_${base}` : null;
}

class TriggerPersistenceFailureRepository extends InMemoryWorkflowRepository {
    upsertWorkflowTrigger(trigger) {
        if (trigger?.id?.includes('transcript_to_meeting_note')) {
            throw new Error('persistence_failure: workflow_triggers write failed');
        }
        return super.upsertWorkflowTrigger(trigger);
    }
}

class LoopIntentSecondWriteFailureRepository extends InMemoryWorkflowRepository {
    constructor() {
        super();
        this.loopIntentWriteCount = 0;
    }

    upsertLoopIntent(intent) {
        if (intent?.input_payload?.source === 'google_calendar') {
            this.loopIntentWriteCount += 1;
            if (this.loopIntentWriteCount === 2) {
                throw new Error('persistence_failure: loop_intents write failed');
            }
        }
        return super.upsertLoopIntent(intent);
    }
}

class MeetingReviewOutputFailureRepository extends InMemoryWorkflowRepository {
    createOutput(output) {
        if (output?.type === 'decision_candidates') {
            throw new Error('persistence_failure: workflow_outputs write failed');
        }
        return super.createOutput(output);
    }
}

async function createAgentStack(service, actor, {
    orgId,
    projectId,
    roleAgentInstanceId,
    templateId,
    bindingId,
    triggerId,
    autonomyLevel = 'approval_required',
    triggerType = 'human',
    bindingEnabled = true,
    triggerEnabled = true
}) {
    await service.createRoleAgentInstance({
        id: roleAgentInstanceId,
        org_id: orgId,
        project_id: projectId,
        role_archetype_id: 'sales',
        name: `${orgId} sales agent`,
        context_policy: { graph_refs: [`org:${orgId}`], customer_scope: `${orgId}:active_accounts` },
        tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
        workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
    }, actor);
    await service.createWorkflowTemplate({
        id: templateId,
        name: `${orgId} sales followup`,
        workflow_kind: 'sales',
        judgment_dag_id: 'sales-followup-v1'
    }, actor);
    await service.createWorkflowBinding({
        id: bindingId,
        org_id: orgId,
        project_id: projectId,
        role_agent_instance_id: roleAgentInstanceId,
        workflow_template_id: templateId,
        autonomy_level: autonomyLevel,
        workflow_selection_reason: `${orgId}の営業接触期限を判断する`,
        enabled: bindingEnabled
    }, actor);
    await service.createWorkflowTrigger({
        id: triggerId,
        org_id: orgId,
        project_id: projectId,
        workflow_binding_id: bindingId,
        trigger_type: triggerType,
        enabled: triggerEnabled
    }, actor);
}

describe('WorkflowService org agent loop control', () => {
    it('does not expose the retired generic manual-run adapter', () => {
        expect(WorkflowService.prototype.runWorkflow).toBeUndefined();
    });

    it('story-mana-meeting-workflow-pack-data-v1 S-001 bootstraps meeting pack records into Workflow Control data', async () => {
        const { repository, service, actor } = makeService();

        const result = await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);

        expect(result.loop_pack_design_review).toMatchObject({
            gate_id: 'loop_pack_design_gate.v0',
            status: 'pass',
            pack_id: 'mana-meeting-workflow-pack-v1'
        });
        expect(result.loop_pack_design_review.manifest_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(result.meeting_workflow_pack.role_agent_instance).toMatchObject({
            name: 'Meeting Ops Agent',
            role_archetype_id: 'meeting-ops',
            org_id: 'salestailor',
            project_id: 'salestailor'
        });
        expect(result.meeting_workflow_pack.workflow_templates.map((template) => template.id)).toEqual([
            'wft_salestailor_salestailor_pre_meeting_briefing',
            'wft_salestailor_salestailor_transcript_to_meeting_note',
            'wft_salestailor_salestailor_meeting_note_to_tasks',
            'wft_salestailor_salestailor_meeting_note_to_decisions',
            'wft_salestailor_salestailor_post_meeting_follow_up_message'
        ]);
        expect(result.meeting_workflow_pack.workflow_bindings).toHaveLength(5);
        expect(result.meeting_workflow_pack.workflow_bindings.every((binding) => (
            binding.autonomy_level === 'approval_required'
                && binding.role_agent_instance_id === result.meeting_workflow_pack.role_agent_instance.id
                && binding.enabled === true
        ))).toBe(true);
        expect(result.meeting_workflow_pack.workflow_triggers.map((trigger) => trigger.trigger_type).sort()).toEqual([
            'event',
            'event',
            'event',
            'event',
            'human',
            'human',
            'human',
            'human',
            'human',
            'schedule'
        ]);
        for (const definition of MEETING_WORKFLOW_DEFINITIONS) {
            const ids = meetingPackIds({
                orgId: 'salestailor',
                projectId: 'salestailor',
                definitionId: definition.id
            });
            const binding = result.meeting_workflow_pack.workflow_bindings.find((candidate) => candidate.id === ids.bindingId);
            expect(binding).toMatchObject({
                id: ids.bindingId,
                workflow_template_id: ids.templateId,
                autonomy_level: 'approval_required',
                enabled: true
            });

            const definitionTriggers = result.meeting_workflow_pack.workflow_triggers
                .filter((trigger) => trigger.workflow_binding_id === ids.bindingId)
                .sort((left, right) => left.trigger_type.localeCompare(right.trigger_type));
            expect(definitionTriggers.map((trigger) => trigger.trigger_type)).toEqual([...definition.trigger_types].sort());
            for (const triggerType of definition.trigger_types) {
                const trigger = definitionTriggers.find((candidate) => candidate.trigger_type === triggerType);
                expect(trigger).toMatchObject({
                    id: meetingPackIds({
                        orgId: 'salestailor',
                        projectId: 'salestailor',
                        definitionId: definition.id,
                        triggerType
                    }).triggerId,
                    org_id: 'salestailor',
                    project_id: 'salestailor',
                    workflow_binding_id: ids.bindingId,
                    enabled: true
                });
                expect(trigger.event_source).toBe(triggerType === 'event' ? 'mana.meeting' : null);
                expect(trigger.schedule).toEqual(triggerType === 'schedule' ? { offset: 'before_meeting', minutes: 30 } : null);
                expect(trigger.human_prompt_ref).toBe(triggerType === 'human' ? `mana:${definition.id}` : null);
            }
        }
        expect(result.meeting_workflow_pack.loop_intents).toHaveLength(5);
        expect(result.meeting_workflow_pack.loop_intents).toEqual(expect.arrayContaining([
            expect.objectContaining({
                input_payload: expect.objectContaining({
                    meeting_identity: null,
                    source: 'meeting_pack_bootstrap'
                }),
                eligibility: expect.objectContaining({
                    status: 'needs_approval',
                    requires_human_approval: true
                })
            })
        ]));
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        const auditLogs = repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' });
        expect(auditLogs).toEqual([
            expect.objectContaining({ action: 'workflow.meeting_pack.bootstrapped', target_type: 'meeting_workflow_pack' })
        ]);
        expect(auditLogs[0].after.loop_pack_design_review).toMatchObject({
            status: 'pass',
            manifest_digest: result.loop_pack_design_review.manifest_digest
        });
    });

    it('story-mana-meeting-workflow-pack-data-v1 INV-001 INV-003 INV-004 INV-005 INV-006 INV-007 executable coverage marker', async () => {
        const { repository, service, actor } = makeService();

        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);

        expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toEqual([
            expect.objectContaining({ role_archetype_id: 'meeting-ops', name: 'Meeting Ops Agent' })
        ]);
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(5);
        const persistedBindings = repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' });
        expect(persistedBindings).toHaveLength(5);
        expect(persistedBindings.every((binding) => binding.autonomy_level === 'approval_required')).toBe(true);
        for (const definition of MEETING_WORKFLOW_DEFINITIONS) {
            const ids = meetingPackIds({
                orgId: 'salestailor',
                projectId: 'salestailor',
                definitionId: definition.id
            });
            expect(persistedBindings.find((binding) => binding.id === ids.bindingId)).toMatchObject({
                workflow_template_id: ids.templateId,
                autonomy_level: 'approval_required'
            });
        }
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                input_payload: expect.objectContaining({ meeting_identity: null }),
                eligibility: expect.objectContaining({ status: 'needs_approval' })
            })
        ]));
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
    });

    it('story-mana-meeting-workflow-pack-data-v1 S-009 INV-002 keeps meeting pack bootstrap idempotent', async () => {
        const { repository, service, actor } = makeService();

        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);

        expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(1);
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(5);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(5);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(10);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(5);
    });

    it('story-eve-dispatch-handoff-transcript-context AC-004 S-002 rejects a referenced dispatch whose run belongs to another org/project', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        await service.bootstrapMeetingWorkflowPack({ org_id: 'unson', project_id: 'unson' }, actor);
        const ingest = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor);
        const salestailorRunId = ingest.meeting_review_ingest.run.id;
        const unsonNoteLoopIntentId = meetingPackIds({
            orgId: 'unson',
            projectId: 'unson',
            definitionId: 'transcript-to-meeting-note'
        }).loopIntentId;
        const callsBefore = eveSessionClient.calls.length;

        await expect(service.dispatchLoopIntentToEve(unsonNoteLoopIntentId, {
            meeting_note_generation: { run_id: salestailorRunId }
        }, { ...actor, projectCodes: ['unson', 'salestailor'] })).rejects.toMatchObject({
            details: expect.objectContaining({
                state_transition: 'blocked_meeting_note_generation_scope',
                expected: { org_id: 'unson', project_id: 'unson' },
                actual: { org_id: 'salestailor', project_id: 'salestailor' }
            })
        });
        expect(eveSessionClient.calls).toHaveLength(callsBefore);
    });

    it('story-eve-runtime-session-connection-v0 S-001 dispatches a Loop Intent to an Eve session and records Brainbase control-plane evidence', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository
            .listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })
            .find((intent) => intent.input_payload.workflow_definition_id === 'pre-meeting-briefing');

        const result = await service.dispatchLoopIntentToEve(loopIntent.id, {}, actor);

        expect(eveSessionClient.calls).toHaveLength(1);
        expect(eveSessionClient.calls[0].message).toContain('Execute this Brainbase Role Agent workflow as an Eve session.');
        expect(eveSessionClient.calls[0].context).toMatchObject({
            brainbase_handoff_version: 'eve_session_handoff.v0',
            expected_result_contract: 'external_runner.v0',
            source_of_truth: 'brainbase',
            loop_intent: expect.objectContaining({ id: loopIntent.id }),
            write_back_rules: {
                external_send_requires_brainbase_human_gate: true,
                graph_promotion_requires_candidate_store: true,
                learning_candidates_require_redaction_check: true
            }
        });
        expect(result.eve_session_dispatch).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            loop_intent_id: loopIntent.id,
            idempotent: false,
            state_transitions: [
                'loop_intent_loaded',
                'control_refs_resolved',
                'eve_session_requested',
                'eve_session_recorded',
                'awaiting_eve_result'
            ],
            run: expect.objectContaining({
                status: 'running',
                closure_state: 'open',
                action_required: 'await_eve_result',
                human_waiting: false,
                loop_intent_id: loopIntent.id,
                metadata: expect.objectContaining({
                    expected_result_contract: 'external_runner.v0',
                    runner: {
                        type: 'eve',
                        session_id: 'eve-session-service-001',
                        continuation_token_present: true
                    }
                })
            }),
            eve_session: {
                session_id: 'eve-session-service-001',
                continuation_token_present: true
            }
        });
        expect(result.eve_session_dispatch.run.metadata.runner.continuation_token).toBeUndefined();
        expect(JSON.stringify(result.eve_session_dispatch)).not.toContain('cont-service-001');
        const persistedLoopIntent = repository.getLoopIntent(loopIntent.id);
        expect(persistedLoopIntent).toMatchObject({
            status: 'dispatched',
            metadata: {
                eve_session_ref: {
                    session_id: 'eve-session-service-001',
                    continuation_token: 'cont-service-001',
                    workflow_run_id: result.eve_session_dispatch.run.id,
                    expected_result_contract: 'external_runner.v0'
                }
            }
        });
        expect(repository.listContextSnapshots(result.eve_session_dispatch.run.id).map((snapshot) => snapshot.source_type)).toEqual([
            'loop_intent',
            'role_agent_instance',
            'workflow_template',
            'workflow_binding',
            'workflow_trigger'
        ]);
        expect(repository.listRunSteps(result.eve_session_dispatch.run.id)).toEqual([
            expect.objectContaining({
                step_key: 'eve_session_create',
                status: 'success',
                action_required: 'await_eve_result'
            })
        ]);
        expect(repository.listAuditLogs({ targetId: result.eve_session_dispatch.run.id })).toEqual([
            expect.objectContaining({
                action: 'workflow.eve_session.dispatched',
                after: expect.objectContaining({
                    eve_session_id: 'eve-session-service-001',
                    expected_result_contract: 'external_runner.v0'
                })
            })
        ]);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);

        const runDetail = await service.getRun(result.eve_session_dispatch.run.id, actor);
        expect(runDetail.run.metadata.runner).toMatchObject({
            type: 'eve',
            session_id: 'eve-session-service-001',
            continuation_token_present: true
        });
        expect(runDetail.run.metadata.runner.continuation_token).toBeUndefined();
        expect(JSON.stringify(runDetail.run)).not.toContain('cont-service-001');

        const replay = await service.dispatchLoopIntentToEve(loopIntent.id, {}, actor);
        expect(replay.eve_session_dispatch).toMatchObject({
            idempotent: true,
            workflow: expect.objectContaining({ id: result.eve_session_dispatch.workflow.id }),
            run: expect.objectContaining({ id: result.eve_session_dispatch.run.id }),
            eve_session: {
                session_id: 'eve-session-service-001',
                continuation_token_present: true
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
    });

    it('story-eve-runtime-session-connection-v0 S-003 force_new_session creates a new Eve session instead of replaying the existing one', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessions: [
                { session_id: 'eve-session-service-001', continuation_token: 'cont-service-001' },
                { session_id: 'eve-session-service-002', continuation_token: 'cont-service-002' }
            ]
        });
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        const first = await service.dispatchLoopIntentToEve(loopIntent.id, {}, actor);
        const forced = await service.dispatchLoopIntentToEve(loopIntent.id, { forceNewSession: true }, actor);

        expect(first.eve_session_dispatch.eve_session.session_id).toBe('eve-session-service-001');
        expect(first.eve_session_dispatch.run.id).not.toBe(forced.eve_session_dispatch.run.id);
        expect(forced.eve_session_dispatch.run.id).toContain('eve_session_service_002');
        expect(forced.eve_session_dispatch).toMatchObject({
            idempotent: false,
            eve_session: {
                session_id: 'eve-session-service-002',
                continuation_token_present: true
            }
        });
        expect(eveSessionClient.calls).toHaveLength(2);
        expect(eveSessionClient.calls[1].context.loop_intent.metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-service-001',
            continuation_token_present: true
        });
        expect(eveSessionClient.calls[1].context.loop_intent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        expect(forced.eve_session_dispatch.handoff.context.loop_intent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        expect(repository.getLoopIntent(loopIntent.id).metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-service-002',
            continuation_token: 'cont-service-002',
            workflow_run_id: forced.eve_session_dispatch.run.id
        });
        const forcedRun = await service.getRun(forced.eve_session_dispatch.run.id, actor);
        const loopIntentSnapshot = forcedRun.context_snapshots.find((snapshot) => snapshot.source_type === 'loop_intent');
        expect(loopIntentSnapshot).toMatchObject({
            redaction_status: 'redacted',
            data: {
                metadata: {
                    eve_session_ref: {
                        session_id: 'eve-session-service-001',
                        continuation_token_present: true
                    }
                }
            }
        });
        expect(loopIntentSnapshot.data.metadata.eve_session_ref.continuation_token).toBeUndefined();
        const listedLoopIntent = (await service.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' }, actor))
            .loop_intents
            .find((item) => item.id === loopIntent.id);
        expect(listedLoopIntent.metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-service-002',
            continuation_token_present: true
        });
        expect(listedLoopIntent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        const replay = await service.dispatchLoopIntentToEve(loopIntent.id, {}, actor);
        expect(replay.eve_session_dispatch).toMatchObject({
            idempotent: true,
            workflow: expect.objectContaining({ id: forced.eve_session_dispatch.workflow.id }),
            run: expect.objectContaining({ id: forced.eve_session_dispatch.run.id }),
            eve_session: {
                session_id: 'eve-session-service-002',
                continuation_token_present: true
            }
        });
    });

    it('story-eve-runtime-session-connection-v0 S-010 redacts null Eve continuation tokens from public surfaces', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessionId: 'eve-session-service-null-token',
            continuationToken: null
        });
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        const result = await service.dispatchLoopIntentToEve(loopIntent.id, {}, actor);

        expect(result.eve_session_dispatch.eve_session).toEqual({
            session_id: 'eve-session-service-null-token',
            continuation_token_present: false
        });
        expect(result.eve_session_dispatch.loop_intent.metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-service-null-token',
            continuation_token_present: false
        });
        expect(result.eve_session_dispatch.loop_intent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        const listedLoopIntent = (await service.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' }, actor))
            .loop_intents
            .find((item) => item.id === loopIntent.id);
        expect(listedLoopIntent.metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-service-null-token',
            continuation_token_present: false
        });
        expect(listedLoopIntent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        expect(repository.getLoopIntent(loopIntent.id).metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-service-null-token',
            continuation_token: null
        });
    });

    it('story-eve-runtime-session-connection-v0 S-001 supplies default Eve stop conditions for custom bindings', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const ids = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        const binding = repository.getWorkflowBinding(ids.bindingId);
        repository.upsertWorkflowBinding({
            ...binding,
            stop_conditions: []
        });

        await service.dispatchLoopIntentToEve(ids.loopIntentId, {}, actor);

        expect(eveSessionClient.calls[0].context.loop_control.stop_conditions).toEqual([
            'missing_context',
            'privacy_scope_leak',
            'human_approval_required'
        ]);
    });

    it('story-eve-runtime-session-connection-v0 S-001 rejects non-string Eve stop conditions before handoff', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const ids = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        const binding = repository.getWorkflowBinding(ids.bindingId);
        repository.upsertWorkflowBinding({
            ...binding,
            stop_conditions: [{}]
        });

        await expect(service.dispatchLoopIntentToEve(ids.loopIntentId, {}, actor)).rejects.toMatchObject({
            message: 'loop_control.stop_conditions[0] must be a non-empty string'
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.ledger.runs).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-001 rejects persisted non-array Eve stop conditions before handoff', async () => {
        const cases = [
            ['binding', (repository, ids) => {
                const binding = repository.getWorkflowBinding(ids.bindingId);
                repository.upsertWorkflowBinding({
                    ...binding,
                    stop_conditions: { invalid: true }
                });
            }],
            ['binding null', (repository, ids) => {
                const binding = repository.getWorkflowBinding(ids.bindingId);
                repository.upsertWorkflowBinding({
                    ...binding,
                    stop_conditions: null
                });
            }],
            ['binding empty string', (repository, ids) => {
                const binding = repository.getWorkflowBinding(ids.bindingId);
                repository.upsertWorkflowBinding({
                    ...binding,
                    stop_conditions: ''
                });
            }],
            ['loop intent', (repository, ids) => {
                const loopIntent = repository.getLoopIntent(ids.loopIntentId);
                repository.upsertLoopIntent({
                    ...loopIntent,
                    stop_conditions: { invalid: true }
                });
            }],
            ['eligibility', (repository, ids) => {
                const loopIntent = repository.getLoopIntent(ids.loopIntentId);
                repository.upsertLoopIntent({
                    ...loopIntent,
                    eligibility: {
                        ...(loopIntent.eligibility || {}),
                        stop_conditions: { invalid: true }
                    }
                });
            }]
        ];

        for (const [, mutate] of cases) {
            const eveSessionClient = makeEveSessionClient();
            const { repository, service, actor } = makeService({ eveSessionClient });
            await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
            const ids = meetingPackIds({
                orgId: 'salestailor',
                projectId: 'salestailor',
                definitionId: 'pre-meeting-briefing',
                triggerType: 'schedule'
            });
            mutate(repository, ids);

            await expect(service.dispatchLoopIntentToEve(ids.loopIntentId, {}, actor)).rejects.toMatchObject({
                message: 'loop_control.stop_conditions must be an array of non-empty strings'
            });
            expect(eveSessionClient.calls).toHaveLength(0);
            expect(repository.ledger.runs).toHaveLength(0);
        }
    });

    it('story-eve-runtime-session-connection-v0 S-001 rejects public Workflow Binding stop conditions that are not non-empty strings', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const roleAgent = repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })[0];
        const template = repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        await expect(service.createWorkflowBinding({
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: roleAgent.id,
            workflow_template_id: template.id,
            stop_conditions: [{}]
        }, actor)).rejects.toMatchObject({
            message: 'stop_conditions[0] must be a non-empty string'
        });
        expect(eveSessionClient.calls).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-004 blocks disabled or explicitly blocked Loop Intent before Eve dispatch', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];
        repository.upsertLoopIntent({
            ...loopIntent,
            enabled: false,
            blocked_reasons: ['manual_hold']
        });

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: `loop_intent '${loopIntent.id}' is not eligible for Eve dispatch`,
            details: {
                state_transition: 'blocked_loop_intent_not_dispatchable',
                loop_intent_id: loopIntent.id,
                blocked_reasons: expect.arrayContaining(['loop_intent_disabled', 'blocked_reason_manual_hold'])
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.ledger.runs).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-004 blocks Automation Run core for Eve dispatch workflow', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const first = await service.dispatchLoopIntentToEve(
            meetingPackIds({
                orgId: 'salestailor',
                projectId: 'salestailor',
                definitionId: 'pre-meeting-briefing',
                triggerType: 'schedule'
            }).loopIntentId,
            {},
            actor
        );

        await expect(service.automationRunService.runWorkflow(first.eve_session_dispatch.workflow.id, {
            actorId: actor.person_id,
            projectCodes: actor.projectCodes,
            role: actor.role,
            authSource: actor.authSource
        })).rejects.toMatchObject({
            message: 'eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session'
        });
        await expect(service.rerun(first.eve_session_dispatch.run.id, {
            actorId: actor.person_id
        }, actor)).rejects.toMatchObject({
            message: 'eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session'
        });
    });

    it('story-eve-runtime-session-connection-v0 FM-001 fails loud before writes when Eve client is not configured', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: 'eve_session_client is not configured',
            details: {
                state_transition: 'blocked_eve_not_configured',
                required_env: ['EVE_API_BASE_URL']
            }
        });

        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
        expect(repository.getLoopIntent(loopIntent.id)).toMatchObject({
            status: 'ready',
            eligibility: {
                status: 'needs_approval'
            }
        });
    });

    it('story-eve-runtime-session-connection-v0 gate blocks empty Eve dispatch messages before network calls', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, { message: '   ' }, actor)).rejects.toMatchObject({
            message: 'message is required',
            details: {
                state_transition: 'blocked_eve_message_required'
            }
        });

        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
        expect(repository.getLoopIntent(loopIntent.id)).toMatchObject({ status: 'ready' });
        expect(repository.getLoopIntent(loopIntent.id).metadata).toBeUndefined();
    });

    it('story-eve-runtime-session-connection-v0 gate rejects caller-supplied Eve continuation tokens before network calls', async () => {
        for (const input of [
            { continuation_token: 'caller-continuation-token' },
            { continuationToken: 'caller-continuation-token' }
        ]) {
            const eveSessionClient = makeEveSessionClient();
            const { repository, service, actor } = makeService({ eveSessionClient });
            await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
            const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

            await expect(service.dispatchLoopIntentToEve(loopIntent.id, input, actor)).rejects.toMatchObject({
                message: 'continuation_token is server-owned and cannot be supplied by clients',
                details: {
                    state_transition: 'blocked_eve_continuation_token_input'
                }
            });

            expect(eveSessionClient.calls).toHaveLength(0);
            expect(repository.ledger.runs).toHaveLength(0);
            expect(repository.ledger.run_steps).toHaveLength(0);
            expect(repository.getLoopIntent(loopIntent.id)).toMatchObject({ status: 'ready' });
            expect(repository.getLoopIntent(loopIntent.id).metadata).toBeUndefined();
        }
    });

    it('story-eve-runtime-session-connection-v0 FM-002 negative_path blocks Eve create failures before Brainbase writes', async () => {
        const eveError = new Error('Eve HTTP 502');
        eveError.code = 'eve_session_create_failed';
        eveError.status = 502;
        const eveSessionClient = makeEveSessionClient({ reject: eveError });
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: 'Eve session create failed',
            details: {
                state_transition: 'blocked_eve_session_create_failed',
                loop_intent_id: loopIntent.id,
                eve_error_code: 'eve_session_create_failed',
                eve_status: 502
            }
        });

        expect(eveSessionClient.calls).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
        expect(repository.ledger.context_snapshots).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.getLoopIntent(loopIntent.id)).toMatchObject({ status: 'ready' });
        expect(repository.getLoopIntent(loopIntent.id).metadata).toBeUndefined();
    });

    it('story-eve-runtime-session-connection-v0 S-016 records timeout recovery and blocks automatic retry', async () => {
        const eveError = new Error('Eve session create timed out after 30000ms');
        eveError.code = 'eve_session_timeout';
        const eveSessionClient = makeEveSessionClient({ reject: eveError });
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: 'Eve session create timed out with unknown remote session state',
            details: {
                state_transition: 'blocked_eve_session_timeout_recovery_required',
                loop_intent_id: loopIntent.id,
                recovery_recorded: true,
                eve_error_code: 'eve_session_timeout'
            }
        });

        expect(eveSessionClient.calls).toHaveLength(1);
        expect(repository.ledger.run_steps).toHaveLength(0);
        expect(repository.ledger.context_snapshots).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        const recoveryRun = repository.ledger.runs[0];
        expect(recoveryRun).toMatchObject({
            status: 'blocked',
            action_required: 'operator_reconcile_eve_session_timeout',
            human_waiting: true,
            metadata: {
                runner: {
                    type: 'eve',
                    session_id_known: false,
                    continuation_token_present: false
                },
                eve_session_timeout_recovery_required: true
            }
        });
        expect(repository.getLoopIntent(loopIntent.id)).toMatchObject({
            status: 'blocked',
            blocked_reasons: expect.arrayContaining(['eve_session_timeout_unknown_remote_state']),
            metadata: {
                eve_dispatch_timeout_recovery: {
                    recovery_required: true,
                    recovery_run_id: recoveryRun.id,
                    error_code: 'eve_session_timeout'
                }
            }
        });
        expect(repository.listAuditLogs({ targetId: recoveryRun.id })[0]).toMatchObject({
            action: 'workflow.eve_session.timeout_recovery_required',
            after: {
                state_transition: 'blocked_eve_session_timeout_recovery_required',
                session_id_known: false
            }
        });

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: `loop_intent '${loopIntent.id}' requires operator reconciliation before another Eve dispatch`,
            details: {
                state_transition: 'blocked_eve_dispatch_timeout_recovery_required',
                loop_intent_id: loopIntent.id,
                recovery_run_id: recoveryRun.id
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
    });

    it('story-eve-runtime-session-connection-v0 S-016 blocks Eve dispatch when another process holds the Loop Intent dispatch lock', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];
        repository.acquireWorkflowLock({
            workspace_id: loopIntent.workspace_id || 'default',
            workflow_id: `eve_session_dispatch:${loopIntent.id}`,
            locked_by: 'other-process',
            ttl_ms: 600000
        });

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: `loop_intent '${loopIntent.id}' already has an Eve dispatch in progress`,
            details: {
                state_transition: 'blocked_eve_dispatch_in_progress',
                loop_intent_id: loopIntent.id,
                lock_workflow_id: `eve_session_dispatch:${loopIntent.id}`
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.ledger.runs).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 FM-003 boundary_condition blocks missing Eve session id before Brainbase writes', async () => {
        const eveSessionClient = makeEveSessionClient({ sessionId: null, continuationToken: 'cont-without-session' });
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: 'Eve session response did not include a session id',
            details: {
                state_transition: 'blocked_eve_session_id_missing',
                loop_intent_id: loopIntent.id
            }
        });

        expect(eveSessionClient.calls).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
        expect(repository.ledger.context_snapshots).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.getLoopIntent(loopIntent.id)).toMatchObject({ status: 'ready' });
        expect(repository.getLoopIntent(loopIntent.id).metadata).toBeUndefined();
    });

    it('story-eve-runtime-session-connection-v0 S-013 records recovery evidence when Brainbase persistence fails after Eve session creation', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessionId: 'eve-session-service-recovery',
            continuationToken: 'cont-service-recovery'
        });
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const loopIntent = repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })[0];
        const originalCreateContextSnapshot = repository.createContextSnapshot.bind(repository);
        repository.createContextSnapshot = (snapshot) => {
            if (snapshot.source_type === 'loop_intent') {
                throw new Error('context snapshot write failed');
            }
            return originalCreateContextSnapshot(snapshot);
        };

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: 'Eve session dispatched but Brainbase persistence failed',
            details: {
                state_transition: 'blocked_eve_dispatch_persistence_failed',
                loop_intent_id: loopIntent.id,
                eve_session_id: 'eve-session-service-recovery',
                continuation_token_present: true,
                recovery_recorded: true,
                persistence_error: 'context snapshot write failed'
            }
        });

        expect(eveSessionClient.calls).toHaveLength(1);
        const recoveryRun = repository.ledger.runs[0];
        expect(recoveryRun).toMatchObject({
            status: 'blocked',
            action_required: 'operator_reconcile_eve_session',
            metadata: {
                dispatch_persistence_failed: true,
                runner: {
                    type: 'eve',
                    session_id: 'eve-session-service-recovery',
                    continuation_token_present: true
                }
            }
        });
        expect(recoveryRun.metadata.runner.continuation_token).toBeUndefined();
        expect(repository.getLoopIntent(loopIntent.id).metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-service-recovery',
            continuation_token: 'cont-service-recovery',
            workflow_run_id: recoveryRun.id,
            persistence_recovery_required: true
        });
        const recoveryAudit = repository.listAuditLogs({ targetId: recoveryRun.id })[0];
        expect(recoveryAudit).toMatchObject({
            action: 'workflow.eve_session.dispatch_persistence_failed',
            after: {
                eve_session_id: 'eve-session-service-recovery',
                continuation_token_present: true,
                state_transition: 'blocked_eve_dispatch_persistence_failed'
            }
        });
        const replay = await service.dispatchLoopIntentToEve(loopIntent.id, {}, actor);
        expect(replay.eve_session_dispatch).toMatchObject({
            idempotent: true,
            run: expect.objectContaining({ id: recoveryRun.id }),
            eve_session: {
                session_id: 'eve-session-service-recovery',
                continuation_token_present: true
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
    });

    it('story-eve-runtime-session-connection-v0 S-004 blocks inconsistent Loop Control lineage before Eve dispatch', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const preMeetingIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        const taskIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'meeting-note-to-tasks',
            triggerType: 'event'
        });
        const loopIntent = repository.getLoopIntent(preMeetingIds.loopIntentId);

        repository.upsertLoopIntent({
            ...loopIntent,
            workflow_binding_id: taskIds.bindingId
        });

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: `loop_intent '${loopIntent.id}' references inconsistent control records`,
            details: {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: loopIntent.id,
                field: 'workflow_binding.workflow_template_id',
                expected: preMeetingIds.templateId,
                actual: taskIds.templateId
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-004 blocks binding workflow_id reuse across org/project before Eve dispatch', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const preMeetingIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        repository.upsertWorkflow({
            id: 'wf_unson_legacy_dispatch',
            workspace_id: 'default',
            org_id: 'unson',
            project_id: 'unson',
            name: 'Unson legacy workflow',
            owner_id: 'unson-owner',
            default_assignee_id: 'unson-owner',
            default_approver_id: 'unson-owner'
        });
        const binding = repository.getWorkflowBinding(preMeetingIds.bindingId);
        repository.upsertWorkflowBinding({
            ...binding,
            workflow_id: 'wf_unson_legacy_dispatch'
        });
        const loopIntent = repository.getLoopIntent(preMeetingIds.loopIntentId);

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: `workflow 'wf_unson_legacy_dispatch' cannot be reused for loop_intent '${loopIntent.id}'`,
            details: {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: loopIntent.id,
                workflow_id: 'wf_unson_legacy_dispatch',
                field: 'workflow.org_id',
                expected: 'salestailor',
                actual: 'unson'
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.getWorkflow('wf_unson_legacy_dispatch')).toMatchObject({
            org_id: 'unson',
            project_id: 'unson',
            name: 'Unson legacy workflow'
        });
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-004 blocks same-scope generic workflow_id reuse before Eve dispatch', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const preMeetingIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        repository.upsertWorkflow({
            id: 'wf_salestailor_generic_dispatch',
            workspace_id: 'default',
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: 'SalesTailor generic workflow',
            owner_id: 'salestailor-owner',
            default_assignee_id: 'salestailor-owner',
            default_approver_id: 'salestailor-owner',
            implementation_key: 'manual-placeholder'
        });
        const binding = repository.getWorkflowBinding(preMeetingIds.bindingId);
        repository.upsertWorkflowBinding({
            ...binding,
            workflow_id: 'wf_salestailor_generic_dispatch'
        });

        await expect(service.dispatchLoopIntentToEve(preMeetingIds.loopIntentId, {}, actor)).rejects.toMatchObject({
            message: `workflow 'wf_salestailor_generic_dispatch' cannot be reused for loop_intent '${preMeetingIds.loopIntentId}'`,
            details: {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: preMeetingIds.loopIntentId,
                workflow_id: 'wf_salestailor_generic_dispatch',
                field: 'workflow.implementation_key',
                expected: 'eve-session-dispatch',
                actual: 'manual-placeholder'
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.getWorkflow('wf_salestailor_generic_dispatch')).toMatchObject({
            implementation_key: 'manual-placeholder'
        });
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-014 blocks generated fallback workflow id collisions before Eve dispatch', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const preMeetingIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        const fallbackWorkflowId = 'wf_salestailor_salestailor_eve_session_dispatch';
        repository.upsertWorkflow({
            id: fallbackWorkflowId,
            workspace_id: 'default',
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: 'Existing generic workflow',
            owner_id: 'keigo',
            default_assignee_id: 'keigo',
            default_approver_id: 'keigo',
            implementation_key: 'manual-placeholder'
        });
        repository.upsertWorkflowBinding({
            ...repository.getWorkflowBinding(preMeetingIds.bindingId),
            workflow_id: null
        });

        await expect(service.dispatchLoopIntentToEve(preMeetingIds.loopIntentId, {}, actor)).rejects.toMatchObject({
            message: `workflow '${fallbackWorkflowId}' cannot be reused for loop_intent '${preMeetingIds.loopIntentId}'`,
            details: {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: preMeetingIds.loopIntentId,
                workflow_id: fallbackWorkflowId,
                field: 'workflow.implementation_key',
                expected: 'eve-session-dispatch',
                actual: 'manual-placeholder'
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.getWorkflow(fallbackWorkflowId)).toMatchObject({
            implementation_key: 'manual-placeholder'
        });
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-003 S-004 validates Loop Control lineage before idempotent Eve session replay', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const preMeetingIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        const taskIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'meeting-note-to-tasks',
            triggerType: 'event'
        });
        const loopIntent = repository.getLoopIntent(preMeetingIds.loopIntentId);

        repository.upsertLoopIntent({
            ...loopIntent,
            workflow_binding_id: taskIds.bindingId,
            metadata: {
                eve_session_ref: {
                    session_id: 'eve-existing-session',
                    workflow_run_id: 'run-existing',
                    expected_result_contract: 'external_runner.v0'
                }
            }
        });

        await expect(service.dispatchLoopIntentToEve(loopIntent.id, {}, actor)).rejects.toMatchObject({
            message: `loop_intent '${loopIntent.id}' references inconsistent control records`,
            details: {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: loopIntent.id,
                field: 'workflow_binding.workflow_template_id',
                expected: preMeetingIds.templateId,
                actual: taskIds.templateId
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-003 S-004 rejects idempotent Eve replay when persisted workflow_run belongs to another project', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessionId: 'eve-session-unson-001',
            continuationToken: 'cont-unson-001'
        });
        const { repository, service, actor } = makeService({ eveSessionClient });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'unson', project_id: 'unson' }, actor);
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const unsonIds = meetingPackIds({
            orgId: 'unson',
            projectId: 'unson',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        const salestailorIds = meetingPackIds({
            orgId: 'salestailor',
            projectId: 'salestailor',
            definitionId: 'pre-meeting-briefing',
            triggerType: 'schedule'
        });
        const unsonDispatch = await service.dispatchLoopIntentToEve(unsonIds.loopIntentId, {}, actor);
        const salestailorLoopIntent = repository.getLoopIntent(salestailorIds.loopIntentId);
        repository.upsertLoopIntent({
            ...salestailorLoopIntent,
            metadata: {
                eve_session_ref: {
                    session_id: 'eve-session-unson-001',
                    workflow_run_id: unsonDispatch.eve_session_dispatch.run.id,
                    expected_result_contract: 'external_runner.v0'
                }
            }
        });

        await expect(service.dispatchLoopIntentToEve(salestailorIds.loopIntentId, {}, actor)).rejects.toMatchObject({
            message: `eve_session_ref for loop_intent '${salestailorIds.loopIntentId}' cannot replay workflow_run '${unsonDispatch.eve_session_dispatch.run.id}'`,
            details: {
                state_transition: 'blocked_loop_control_ref_mismatch',
                loop_intent_id: salestailorIds.loopIntentId,
                workflow_run_id: unsonDispatch.eve_session_dispatch.run.id,
                field: 'workflow_run.org_id',
                expected: 'salestailor',
                actual: 'unson'
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(1);
    });

    it('story-loop-pack-design-gate-v0 S-003 blocks meeting pack bootstrap before writes when design review needs revision', async () => {
        const { repository, service, actor } = makeService();
        service.meetingAutomationService._preparePackRecords = async () => ({
            orgId: 'salestailor',
            projectId: 'salestailor',
            actorId: 'keigo',
            records: {
                pack_id: 'mana-meeting-workflow-pack-v1',
                role_agent_instance: {
                    id: 'rai_should_not_write',
                    workspace_id: 'default',
                    org_id: 'salestailor',
                    project_id: 'salestailor'
                },
                workflow_templates: [{
                    id: 'wft_should_not_write',
                    workspace_id: 'default',
                    org_id: 'salestailor',
                    project_id: 'salestailor',
                    workflow_kind: 'meeting'
                }],
                workflow_bindings: [],
                workflow_triggers: [],
                loop_intents: [],
                loop_pack_design_review: {
                    gate_id: 'loop_pack_design_gate.v0',
                    status: 'needs_revision',
                    manifest_digest: 'invalid',
                    issues: [{ code: 'missing_loop_closure_rubric' }],
                    rubric: []
                }
            }
        });

        await expect(service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor)).rejects.toThrow('loop pack design gate did not pass');

        expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })).toHaveLength(0);
    });

    it('story-mana-meeting-workflow-pack-data-v1 FM-002 persistence_failure rolls back partial meeting pack records', async () => {
        const repository = new TriggerPersistenceFailureRepository();
        const { service, actor } = makeService({ repository });

        await expect(service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor)).rejects.toThrow('persistence_failure');

        expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })).toHaveLength(0);
    });

    it('story-mana-meeting-workflow-pack-data-v1 FM-003 provider_failure is not invoked during bootstrap', async () => {
        const repository = new InMemoryWorkflowRepository();
        let providerCalls = 0;
        const { service, actor } = makeService({
            repository,
            handlers: {
                ...createDefaultWorkflowHandlers(),
                'manual-placeholder': async () => {
                    providerCalls += 1;
                    throw new Error('provider_failure should not be reachable from bootstrap');
                }
            }
        });

        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);

        expect(providerCalls).toBe(0);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
    });

    it('story-meeting-workflow-calendar-input-v1 S-001 INV-002 INV-004 creates pre-meeting loop intents from Google Calendar events', async () => {
        const googleCalendarService = {
            async getAuthStatus() {
                return {
                    connected: true,
                    defaultAccount: 'k.sato@sales-tailor.jp'
                };
            },
            async listEvents() {
                return [
                    {
                        id: 'gcal:primary:evt-1',
                        calendarEventId: 'evt-1',
                        iCalUID: 'uid-1@example.com',
                        calendarId: 'primary',
                        account: 'k.sato@sales-tailor.jp',
                        title: 'Mana定例',
                        startDateTime: '2026-06-22T10:00:00+09:00',
                        endDateTime: '2026-06-22T11:00:00+09:00',
                        allDay: false,
                        attendees: [{ email: 'sato@example.com', responseStatus: 'accepted' }],
                        organizer: { email: 'owner@example.com' },
                        conferenceUrl: 'https://meet.google.com/abc-defg-hij',
                        location: 'Google Meet',
                        htmlLink: 'https://calendar.google.com/event?eid=evt-1',
                        description: '週次の実会議'
                    }
                ];
            }
        };
        const { repository, service, actor } = makeService({ googleCalendarService });

        const result = await service.createMeetingPackCalendarLoopIntents({
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00',
            account: 'k.sato@sales-tailor.jp',
            calendar_ids: ['primary']
        }, actor);

        expect(result.meeting_calendar_inputs).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_definition_id: 'pre-meeting-briefing',
            events_considered: 1,
            state_transitions: [
                'requested',
                'calendar_fetching',
                'meeting_pack_ensured',
                'loop_intents_ready',
                'skipped_inputs_reported'
            ],
            skipped_events: []
        });
        expect(result.meeting_calendar_inputs.loop_intents).toHaveLength(1);
        expect(result.meeting_calendar_inputs.loop_intents[0]).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            trigger_type: 'schedule',
            input_ref: 'google-calendar:k.sato@sales-tailor.jp:primary:evt-1',
            input_payload: {
                meeting_identity: {
                    source: 'google_calendar',
                    account: 'k.sato@sales-tailor.jp',
                    calendar_id: 'primary',
                    event_id: 'evt-1',
                    title: 'Mana定例',
                    start: '2026-06-22T10:00:00+09:00',
                    end: '2026-06-22T11:00:00+09:00',
                    conference_url: 'https://meet.google.com/abc-defg-hij',
                    attendees: [{ email: 'sato@example.com', responseStatus: 'accepted' }]
                },
                workflow_definition_id: 'pre-meeting-briefing',
                requested_output: 'agenda / context brief',
                source: 'google_calendar'
            },
            eligibility: {
                status: 'needs_approval',
                autonomy_level: 'approval_required',
                requires_human_approval: true,
                reasons: ['autonomy_level_approval_required']
            }
        });
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(5);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(1);
        const calendarIngestAudit = repository
            .listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })
            .find((entry) => entry.action === 'workflow.meeting_pack.calendar_inputs.ingested');
        expect(calendarIngestAudit).toMatchObject({
            after: {
                state_transitions: [
                    'requested',
                    'calendar_fetching',
                    'meeting_pack_ensured',
                    'loop_intents_ready',
                    'skipped_inputs_reported'
                ],
                skipped_events: [],
                loop_intent_ids: [result.meeting_calendar_inputs.loop_intents[0].id]
            }
        });
    });

    it('story-meeting-workflow-calendar-input-v1 S-002 INV-005 skips all-day calendar events', async () => {
        const googleCalendarService = {
            async getAuthStatus() {
                return { connected: true, defaultAccount: 'k.sato@sales-tailor.jp' };
            },
            async listEvents() {
                return [
                    {
                        id: 'gcal:primary:holiday',
                        calendarEventId: 'holiday',
                        calendarId: 'primary',
                        title: '祝日',
                        startDate: '2026-06-22',
                        endDate: '2026-06-23',
                        allDay: true
                    }
                ];
            }
        };
        const { repository, service, actor } = makeService({ googleCalendarService });

        const result = await service.createMeetingPackCalendarLoopIntents({
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00'
        }, actor);

        expect(result.meeting_calendar_inputs.loop_intents).toHaveLength(0);
        expect(result.meeting_calendar_inputs.skipped_events).toEqual([
            {
                event_id: 'holiday',
                title: '祝日',
                reason: 'all_day_event'
            }
        ]);
        expect(result.meeting_calendar_inputs.state_transitions).toEqual([
            'requested',
            'calendar_fetching',
            'meeting_pack_ensured',
            'loop_intents_ready',
            'skipped_inputs_reported'
        ]);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
    });

    it('story-meeting-workflow-calendar-input-v1 FM-003 preserves successful calendars and reports failed calendars as skipped evidence', async () => {
        const googleCalendarService = {
            async getAuthStatus() {
                return { connected: true, defaultAccount: 'k.sato@sales-tailor.jp' };
            },
            async listEventsWithDiagnostics() {
                return {
                    events: [
                        {
                            id: 'gcal:primary:evt-ok',
                            calendarEventId: 'evt-ok',
                            calendarId: 'primary',
                            title: '取得できたMTG',
                            startDateTime: '2026-06-22T10:00:00+09:00',
                            endDateTime: '2026-06-22T11:00:00+09:00',
                            allDay: false
                        }
                    ],
                    skippedCalendars: [
                        {
                            calendar_id: 'team',
                            reason: 'calendar_fetch_failed',
                            message: 'calendar forbidden'
                        }
                    ]
                };
            }
        };
        const { repository, service, actor } = makeService({ googleCalendarService });

        const result = await service.createMeetingPackCalendarLoopIntents({
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00',
            account: 'k.sato@sales-tailor.jp',
            calendar_ids: ['primary', 'team']
        }, actor);

        expect(result.meeting_calendar_inputs.loop_intents).toHaveLength(1);
        expect(result.meeting_calendar_inputs.skipped_events).toEqual([
            {
                calendar_id: 'team',
                reason: 'calendar_fetch_failed',
                message: 'calendar forbidden'
            }
        ]);
        expect(result.meeting_calendar_inputs.state_transitions).toEqual([
            'requested',
            'calendar_fetching',
            'meeting_pack_ensured',
            'loop_intents_ready',
            'skipped_inputs_reported'
        ]);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(1);
    });

    it('story-meeting-workflow-calendar-input-v1 INV-006 keeps calendar re-ingestion idempotent', async () => {
        const googleCalendarService = {
            async getAuthStatus() {
                return { connected: true, defaultAccount: 'k.sato@sales-tailor.jp' };
            },
            async listEventsWithDiagnostics() {
                return {
                    events: [
                        {
                            id: 'gcal:primary:evt-stable',
                            calendarEventId: 'evt-stable',
                            calendarId: 'primary',
                            title: '再取り込みMTG',
                            startDateTime: '2026-06-22T13:00:00+09:00',
                            endDateTime: '2026-06-22T14:00:00+09:00',
                            allDay: false
                        }
                    ],
                    skippedCalendars: []
                };
            }
        };
        const { repository, service, actor } = makeService({ googleCalendarService });
        const input = {
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00',
            account: 'k.sato@sales-tailor.jp',
            calendar_ids: ['primary']
        };

        const first = await service.createMeetingPackCalendarLoopIntents(input, actor);
        const second = await service.createMeetingPackCalendarLoopIntents(input, actor);

        expect(first.meeting_calendar_inputs.loop_intents[0].id).toBe(second.meeting_calendar_inputs.loop_intents[0].id);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(1);
    });

    it('story-meeting-workflow-calendar-input-v1 FM-002 INV-007 rejects disconnected calendar before meeting pack writes', async () => {
        const googleCalendarService = {
            async getAuthStatus() {
                return { connected: false, reason: 'no_credentials' };
            },
            async listEvents() {
                throw new Error('listEvents should not be called');
            }
        };
        const { repository, service, actor } = makeService({ googleCalendarService });

        await expect(service.createMeetingPackCalendarLoopIntents({
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00'
        }, actor)).rejects.toMatchObject({
            message: 'google calendar is not connected: no_credentials',
            details: {
                skipped_events: [
                    {
                        calendar_id: null,
                        reason: 'no_credentials',
                        message: 'no_credentials'
                    }
                ],
                state_transitions: [
                    'requested',
                    'calendar_fetching',
                    'calendar_fetch_failed_all',
                    'failed_without_partial_write'
                ]
            }
        });

        expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
    });

    it('story-meeting-workflow-calendar-input-v1 FM-002 keeps account fetch failure from writing meeting pack records', async () => {
        const googleCalendarService = {
            async listEventsWithDiagnostics() {
                return {
                    events: [],
                    skippedCalendars: [
                        {
                            calendar_id: 'primary',
                            reason: 'calendar_fetch_failed',
                            message: 'missing account token'
                        }
                    ]
                };
            }
        };
        const { repository, service, actor } = makeService({ googleCalendarService });

        await expect(service.createMeetingPackCalendarLoopIntents({
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00',
            account: 'missing@example.com'
        }, actor)).rejects.toMatchObject({
            message: 'google calendar is not connected: calendar_fetch_failed',
            details: {
                state_transitions: [
                    'requested',
                    'calendar_fetching',
                    'calendar_fetch_failed_all',
                    'failed_without_partial_write'
                ]
            }
        });

        expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
    });

    it('story-meeting-workflow-calendar-input-v1 INV-007 rolls back meeting pack and partial loop intents when ingestion write fails', async () => {
        const repository = new LoopIntentSecondWriteFailureRepository();
        const googleCalendarService = {
            async getAuthStatus() {
                return { connected: true, defaultAccount: 'k.sato@sales-tailor.jp' };
            },
            async listEventsWithDiagnostics() {
                return {
                    events: [
                        {
                            id: 'gcal:primary:evt-1',
                            calendarEventId: 'evt-1',
                            calendarId: 'primary',
                            title: '1件目MTG',
                            startDateTime: '2026-06-22T10:00:00+09:00',
                            endDateTime: '2026-06-22T11:00:00+09:00',
                            allDay: false
                        },
                        {
                            id: 'gcal:primary:evt-2',
                            calendarEventId: 'evt-2',
                            calendarId: 'primary',
                            title: '2件目MTG',
                            startDateTime: '2026-06-22T12:00:00+09:00',
                            endDateTime: '2026-06-22T13:00:00+09:00',
                            allDay: false
                        }
                    ],
                    skippedCalendars: []
                };
            }
        };
        const { service, actor } = makeService({ repository, googleCalendarService });

        await expect(service.createMeetingPackCalendarLoopIntents({
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00',
            account: 'k.sato@sales-tailor.jp'
        }, actor)).rejects.toThrow('persistence_failure: loop_intents write failed');

        expect(repository.listRoleAgentInstances({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'salestailor', projectId: 'salestailor', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' })).toHaveLength(0);
        expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })).toHaveLength(0);
    });

    it('story-meeting-review-package-ingest-v1 S-008 resolves org and project scope from meeting_identity candidates', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);

        const result = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor);

        expect(result.meeting_review_ingest).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            case_scope: 'service-loop-test',
            idempotent: false,
            run: expect.objectContaining({
                status: 'waiting_human',
                metadata: expect.objectContaining({
                    runner: { type: 'codex_generated_package', eve_connected: false }
                })
            })
        });
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-task-owner-ssot-resolution resolves task owner hints from people SSOT before output storage', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person_yajima_tsuyoshi',
                entity_type: 'person',
                payload: {
                    name: '矢島剛',
                    display_name: '矢島剛',
                    aliases: ['矢島様', '矢島さん'],
                    status: 'active'
                }
            },
            {
                id: 'person_joe',
                entity_type: 'person',
                payload: {
                    name: 'ジョーさん',
                    aliases: ['ジョー'],
                    status: 'active'
                }
            }
        ]);
        const { repository, service, actor } = makeService({ infoSSOTService });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.task_candidates = [
            {
                title: 'Googleビジネスプロフィールの管理権限をジョーさんに付与する。',
                owner_hint: '@矢島様'
            },
            {
                title: '口コミ投稿QRと質問項目を確定する。',
                owner_hint: '@未登録さん'
            },
            {
                title: 'マリームーンのプレミアムコスプレを試験導入する。',
                owner_hint: '@Speaker 1'
            }
        ];

        const result = await service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor);

        const taskOutput = result.meeting_review_ingest.outputs.find((output) => output.type === 'task_candidates');
        expect(taskOutput.payload[0]).toMatchObject({
            owner_hint: '@矢島様',
            selected_owner_id: 'person_yajima_tsuyoshi',
            selected_owner: '矢島剛',
            owner_candidates: [
                expect.objectContaining({
                    person_id: 'person_yajima_tsuyoshi',
                    display_name: '矢島剛',
                    source: 'graph_ssot',
                    match: 'exact_name_or_alias'
                })
            ],
            owner_resolution: {
                source: 'graph_ssot',
                status: 'resolved',
                confidence: 1,
                reason: 'unique_exact_name_or_alias'
            }
        });
        expect(taskOutput.payload[1]).toMatchObject({
            owner_hint: '@未登録さん',
            owner_candidates: [],
            owner_resolution: {
                source: 'graph_ssot',
                status: 'unresolved',
                reason: 'no_people_ssot_candidate'
            }
        });
        expect(taskOutput.payload[1].selected_owner_id).toBeUndefined();
        expect(taskOutput.payload[2]).toMatchObject({
            owner_hint: '@Speaker 1',
            owner_resolution: {
                source: 'graph_ssot',
                status: 'ignored',
                reason: 'speaker_label_is_not_people_ssot'
            }
        });
        expect(taskOutput.payload[2].selected_owner_id).toBeUndefined();
        expect(infoSSOTService.calls[0]).toMatchObject({
            options: {
                projectCode: 'salestailor',
                entityType: 'person',
                query: '矢島様',
                limit: 20
            }
        });
        expect(repository.ledger.outputs.find((output) => output.type === 'task_candidates').payload[0].selected_owner_id).toBe('person_yajima_tsuyoshi');
    });

    it('story-meeting-task-owner-ssot-resolution keeps ambiguous people SSOT reason explicit', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person_yajima_tsuyoshi',
                payload: {
                    name: '矢島剛',
                    aliases: ['矢島様'],
                    status: 'active'
                }
            },
            {
                id: 'person_yajima_takeshi',
                payload: {
                    name: '矢島毅',
                    aliases: ['矢島様'],
                    status: 'active'
                }
            }
        ]);
        const { service, actor } = makeService({ infoSSOTService });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.package_id = 'meeting-review-package-ambiguous-owner-unit';
        reviewPackage.task_candidates = [
            {
                title: 'Googleビジネスプロフィールの管理権限を確認する。',
                owner_hint: '@矢島様'
            }
        ];

        const result = await service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor);

        const taskOutput = result.meeting_review_ingest.outputs.find((output) => output.type === 'task_candidates');
        expect(taskOutput.payload[0]).toMatchObject({
            owner_hint: '@矢島様',
            owner_resolution: {
                source: 'graph_ssot',
                status: 'ambiguous',
                reason: 'ambiguous_people_ssot_candidate'
            }
        });
        expect(taskOutput.payload[0].selected_owner_id).toBeUndefined();
    });

    it('story-meeting-task-owner-ssot-resolution does not auto-select when one exact match is mixed with partial SSOT candidates', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person_yajima_tsuyoshi',
                payload: {
                    name: '矢島剛',
                    aliases: ['矢島様'],
                    status: 'active'
                }
            },
            {
                id: 'person_yajima_related',
                payload: {
                    name: '矢島関連担当',
                    aliases: ['矢島様候補'],
                    status: 'active'
                }
            }
        ]);
        const { service, actor } = makeService({ infoSSOTService });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.package_id = 'meeting-review-package-mixed-exact-partial-owner-unit';
        reviewPackage.task_candidates = [
            {
                title: 'Googleビジネスプロフィールの管理権限を確認する。',
                owner_hint: '@矢島様'
            }
        ];

        const result = await service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor);

        const taskOutput = result.meeting_review_ingest.outputs.find((output) => output.type === 'task_candidates');
        expect(taskOutput.payload[0].owner_candidates).toHaveLength(2);
        expect(taskOutput.payload[0]).toMatchObject({
            owner_hint: '@矢島様',
            owner_resolution: {
                source: 'graph_ssot',
                status: 'ambiguous',
                reason: 'ambiguous_people_ssot_candidate'
            }
        });
        expect(taskOutput.payload[0].selected_owner_id).toBeUndefined();
    });

    it('story-meeting-task-owner-ssot-resolution ranks partial owner hints by project context', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person_sato_keigo',
                member_of_project_codes: ['brainbase', 'salestailor'],
                payload: {
                    name: '佐藤 圭吾',
                    display_name: '佐藤 圭吾',
                    aliases: ['佐藤圭吾', 'Keigo Sato', 'ksato', 'さとけい', 'King', 'キング'],
                    status: 'active'
                }
            },
            {
                id: 'person_sato_noriyuki',
                member_of_project_codes: ['garu-urawa'],
                payload: {
                    name: '佐藤 紀征',
                    display_name: '佐藤 紀征',
                    aliases: ['佐藤さん', 'ガル浦和代表'],
                    status: 'active'
                }
            },
            {
                id: 'person_hori_shiori',
                member_of_project_codes: ['brainbase', 'salestailor'],
                payload: {
                    name: '堀 汐里',
                    display_name: '堀 汐里',
                    aliases: ['堀汐里', '堀', 'Shiori Hori', 'hori_dom'],
                    status: 'active'
                }
            }
        ]);
        const { service, actor } = makeService({ infoSSOTService });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.package_id = 'meeting-review-package-context-ranked-owner-unit';
        reviewPackage.task_candidates = [
            {
                title: '佐藤さんにMeeting Packの再生成結果を確認してもらう。',
                owner_hint: '@佐藤さん'
            },
            {
                title: '汐里さんにSalesTailor向け確認事項を共有する。',
                owner_hint: '@汐里さん'
            },
            {
                title: 'キングに担当者SSOTの別名解決を確認してもらう。',
                owner_hint: '@キング'
            }
        ];

        const result = await service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor);

        const taskOutput = result.meeting_review_ingest.outputs.find((output) => output.type === 'task_candidates');
        expect(taskOutput.payload[0]).toMatchObject({
            owner_hint: '@佐藤さん',
            selected_owner_id: 'person_sato_keigo',
            selected_owner: '佐藤 圭吾',
            owner_candidates: [
                expect.objectContaining({
                    person_id: 'person_sato_keigo',
                    match: 'partial_name_or_alias',
                    context_match: true
                }),
                expect.objectContaining({
                    person_id: 'person_sato_noriyuki'
                })
            ],
            owner_resolution: {
                source: 'graph_ssot',
                status: 'resolved',
                confidence: 0.9,
                reason: 'context_ranked_owner_hint'
            }
        });
        expect(taskOutput.payload[1]).toMatchObject({
            owner_hint: '@汐里さん',
            selected_owner_id: 'person_hori_shiori',
            selected_owner: '堀 汐里',
            owner_candidates: [
                expect.objectContaining({
                    person_id: 'person_hori_shiori',
                    match: 'partial_name_or_alias',
                    context_match: true
                })
            ],
            owner_resolution: {
                source: 'graph_ssot',
                status: 'resolved',
                confidence: 0.9,
                reason: 'unique_partial_name_or_alias'
            }
        });
        expect(taskOutput.payload[2]).toMatchObject({
            owner_hint: '@キング',
            selected_owner_id: 'person_sato_keigo',
            selected_owner: '佐藤 圭吾',
            owner_candidates: [
                expect.objectContaining({
                    person_id: 'person_sato_keigo',
                    match: 'exact_name_or_alias',
                    context_match: true
                })
            ],
            owner_resolution: {
                source: 'graph_ssot',
                status: 'resolved',
                confidence: 1,
                reason: 'unique_exact_name_or_alias'
            }
        });
    });

    it('story-meeting-task-owner-ssot-resolution applies project variants to people SSOT access scope', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person_sato_keigo',
                member_of_project_codes: ['techknight'],
                payload: {
                    name: '佐藤 圭吾',
                    display_name: '佐藤 圭吾',
                    aliases: ['佐藤圭吾', 'Keigo Sato', 'King', 'キング'],
                    status: 'active'
                }
            }
        ]);
        const { service, actor } = makeService({ infoSSOTService });
        actor.projectCodes = ['tech-knight'];
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'tech-knight',
            project_id: 'tech-knight'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage({
            orgId: 'tech-knight',
            projectId: 'tech-knight',
            packageId: 'meeting-review-package-project-variant-owner-access-unit'
        });
        reviewPackage.task_candidates = [
            {
                title: 'King氏にCxO会議の決定事項をSlackへ投稿してもらう。',
                owner_hint: '@King氏'
            }
        ];

        const result = await service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor);

        const taskOutput = result.meeting_review_ingest.outputs.find((output) => output.type === 'task_candidates');
        expect(taskOutput.payload[0]).toMatchObject({
            owner_hint: '@King氏',
            selected_owner_id: 'person_sato_keigo',
            selected_owner: '佐藤 圭吾',
            owner_resolution: {
                source: 'graph_ssot',
                status: 'resolved',
                confidence: 1,
                reason: 'unique_exact_name_or_alias'
            }
        });
        expect(infoSSOTService.calls.some((call) => (
            call.options.projectCode === 'techknight'
            && call.options.query === 'king'
            && call.access.projectCodes.includes('techknight')
        ))).toBe(true);
    });

    it('story-meeting-task-owner-ssot-resolution keeps inactive context owner hints unselected', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person_sato_inactive',
                payload: {
                    name: '佐藤 旧担当',
                    display_name: '佐藤 旧担当',
                    aliases: ['佐藤さん'],
                    project_ids: ['salestailor'],
                    status: 'inactive'
                }
            },
            {
                id: 'person_sato_other',
                payload: {
                    name: '佐藤 他部署',
                    display_name: '佐藤 他部署',
                    aliases: ['佐藤'],
                    project_ids: ['other-project'],
                    status: 'active'
                }
            }
        ]);
        const { service, actor } = makeService({ infoSSOTService });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.package_id = 'meeting-review-package-inactive-context-owner-unit';
        reviewPackage.task_candidates = [
            {
                title: '佐藤さんにMeeting Packの再生成結果を確認してもらう。',
                owner_hint: '@佐藤さん'
            }
        ];

        const result = await service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor);

        const taskOutput = result.meeting_review_ingest.outputs.find((output) => output.type === 'task_candidates');
        expect(taskOutput.payload[0].owner_candidates).toEqual([
            expect.objectContaining({
                person_id: 'person_sato_inactive',
                context_match: true,
                status: 'inactive'
            }),
            expect.objectContaining({
                person_id: 'person_sato_other',
                status: 'active'
            })
        ]);
        expect(taskOutput.payload[0]).toMatchObject({
            owner_hint: '@佐藤さん',
            owner_resolution: {
                source: 'graph_ssot',
                status: 'ambiguous',
                reason: 'ambiguous_people_ssot_candidate'
            }
        });
        expect(taskOutput.payload[0].selected_owner_id).toBeUndefined();
    });

    it('story-meeting-task-owner-ssot-resolution preserves an existing selected owner only after people SSOT verification', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person_yajima_tsuyoshi',
                payload: {
                    name: '矢島剛',
                    display_name: '矢島剛',
                    aliases: ['矢島様'],
                    project_ids: ['salestailor'],
                    status: 'active'
                }
            }
        ]);
        const { service, actor } = makeService({ infoSSOTService });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.package_id = 'meeting-review-package-existing-selected-owner-unit';
        reviewPackage.task_candidates = [
            {
                title: '矢島さんに写真選定を依頼する。',
                owner_hint: '@矢島様',
                selected_owner_id: 'person_yajima_tsuyoshi',
                selected_owner: '矢島剛',
                owner_resolution: {
                    source: 'review_package',
                    status: 'resolved',
                    reason: 'untrusted_inbound_resolution'
                }
            },
            {
                title: '未検証担当者に確認する。',
                owner_hint: '@未検証さん',
                selected_owner_id: 'person_unknown_from_review_package',
                selected_owner: '未検証担当',
                owner_resolution: {
                    source: 'review_package',
                    status: 'resolved',
                    reason: 'stale_inbound_resolution'
                }
            }
        ];

        const result = await service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor);

        const taskOutput = result.meeting_review_ingest.outputs.find((output) => output.type === 'task_candidates');
        expect(taskOutput.payload[0]).toMatchObject({
            selected_owner_id: 'person_yajima_tsuyoshi',
            selected_owner: '矢島剛',
            owner_resolution: {
                source: 'graph_ssot',
                status: 'already_selected',
                reason: 'selected_owner_id_verified_in_people_ssot'
            }
        });
        expect(taskOutput.payload[1].selected_owner_id).toBeUndefined();
        expect(taskOutput.payload[1].selected_owner).toBeUndefined();
        expect(taskOutput.payload[1]).toMatchObject({
            owner_hint: '@未検証さん',
            owner_candidates: [],
            owner_resolution: {
                source: 'graph_ssot',
                status: 'unresolved',
                reason: 'selected_owner_id_not_found_in_people_ssot'
            }
        });
    });

    it('story-meeting-review-package-ingest-v1 preserves legacy stable ids for non-review workflow templates', async () => {
        const { service, actor } = makeService();
        const longTemplateName = `Sales renewal follow up ${'very long segment '.repeat(12)}`;

        const result = await service.createWorkflowTemplate({
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: longTemplateName,
            workflow_kind: 'sales'
        }, actor);

        expect(result.workflow_template.id).toBe(expectedLegacyStableId(
            'wft',
            'salestailor',
            'salestailor',
            longTemplateName
        ));
        expect(result.workflow_template.id).not.toMatch(/_[a-f0-9]{12}$/);
    });

    it('story-meeting-review-package-ingest-v1 keeps long review package ids idempotent without changing shared id semantics', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const longPackageId = `meeting-review-package-united-hotel-dx-${'decision-evidence-context-'.repeat(5)}`;

        const first = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage({ packageId: longPackageId })
        }, actor);
        const second = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage({ packageId: longPackageId })
        }, actor);
        const runId = first.meeting_review_ingest.run.id;
        const artifactIds = [
            ...repository.ledger.run_steps.map((step) => step.id),
            ...first.meeting_review_ingest.context_snapshots.map((snapshot) => snapshot.id),
            ...first.meeting_review_ingest.outputs.map((output) => output.id),
            ...first.meeting_review_ingest.human_steps.map((step) => step.id)
        ];

        expect(second.meeting_review_ingest).toMatchObject({
            idempotent: true,
            run: expect.objectContaining({ id: runId })
        });
        expect(runId).toMatch(/^run_salestailor_salestailor_meeting_review_package_united_hotel_dx_.*_[a-f0-9]{12}$/);
        expect(runId.length).toBeLessThanOrEqual(110);
        expect(repository.ledger.runs).toHaveLength(1);
        expect(new Set(artifactIds)).toHaveLength(artifactIds.length);
    });

    it('story-meeting-review-package-ingest-v1 S-007 rejects loop intent project mismatch before writes', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'unson',
            project_id: 'unson'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.loop_intent_ids.meeting_note_to_tasks = meetingPackIds({
            orgId: 'unson',
            projectId: 'unson',
            definitionId: 'meeting-note-to-tasks'
        }).loopIntentId;

        await expect(service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor)).rejects.toThrow("loop_intent 'loop_unson_unson_meeting_note_to_tasks_bootstrap' belongs to 'unson/unson'");

        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
    });

    it('story-meeting-review-package-ingest-v1 rejects missing required loop intent key before writes', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        delete reviewPackage.loop_intent_ids.meeting_note_to_tasks;

        await expect(service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor)).rejects.toThrow('review_package.loop_intent_ids is missing required meeting review key(s)');

        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
    });

    it('story-meeting-review-package-ingest-v1 rejects missing required output payload before writes', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const reviewPackage = sampleMeetingReviewPackage();
        delete reviewPackage.decision_candidates;

        await expect(service.ingestMeetingReviewPackage({
            review_package: reviewPackage
        }, actor)).rejects.toThrow('review_package is missing required output payload key(s)');

        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
    });

    it('story-meeting-review-package-ingest-v1 resolves one approval step while keeping remaining approvals visible', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const result = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor);
        const step = result.meeting_review_ingest.human_steps[0];

        const resolved = await service.resolveHumanStep(step.id, {
            run_id: result.meeting_review_ingest.run.id,
            resolution: 'approved'
        }, actor);

        expect(resolved.human_step).toMatchObject({
            id: step.id,
            status: 'approved'
        });
        expect(resolved.resumed_run).toMatchObject({
            id: result.meeting_review_ingest.run.id,
            status: 'waiting_human',
            closure_state: 'open',
            action_required: 'approve',
            human_waiting: true
        });
        expect(resolved.resumed_run.message).not.toContain('No workflow handler registered');
        expect(repository.listHumanSteps(result.meeting_review_ingest.run.id).filter((humanStep) => humanStep.status === 'pending')).toHaveLength(4);
        expect(repository.listRuns({ workflowId: result.meeting_review_ingest.run.workflow_id })).toHaveLength(1);
        expect(repository.listAuditLogs({ targetId: resolved.resumed_run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.run.meeting_review_approvals.progressed',
                after: expect.objectContaining({
                    status: 'waiting_human',
                    closure_state: 'open'
                })
            })
        ]));
    });

    it('story-meeting-review-package-ingest-v1 closes the review run only after all generated approvals are resolved', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const result = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor);

        let latestResolution = null;
        for (const step of result.meeting_review_ingest.human_steps) {
            latestResolution = await service.resolveHumanStep(step.id, {
                run_id: result.meeting_review_ingest.run.id,
                resolution: 'approved'
            }, actor);
        }

        expect(latestResolution.resumed_run).toMatchObject({
            id: result.meeting_review_ingest.run.id,
            status: 'success',
            closure_state: 'closed',
            action_required: 'none',
            human_waiting: false
        });
        expect(repository.listHumanSteps(result.meeting_review_ingest.run.id).filter((humanStep) => humanStep.status === 'pending')).toHaveLength(0);
        expect(repository.listRuns({ workflowId: result.meeting_review_ingest.run.workflow_id })).toHaveLength(1);
        expect(repository.listAuditLogs({ targetId: result.meeting_review_ingest.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.run.meeting_review_approvals.completed',
                after: expect.objectContaining({
                    status: 'success',
                    closure_state: 'closed'
                })
            })
        ]));
    });

    it('story-meeting-review-package-ingest-v1 cancels remaining review gates after one generated human rejection', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const result = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor);
        const [rejectedStep, staleApproveStep] = result.meeting_review_ingest.human_steps;

        const rejected = await service.resolveHumanStep(rejectedStep.id, {
            run_id: result.meeting_review_ingest.run.id,
            resolution: 'rejected'
        }, actor);

        expect(rejected.human_step).toMatchObject({
            id: rejectedStep.id,
            status: 'rejected'
        });
        expect(rejected.resumed_run).toMatchObject({
            id: result.meeting_review_ingest.run.id,
            status: 'cancelled',
            closure_state: 'closed',
            action_required: 'none',
            human_waiting: false
        });
        expect(repository.listHumanSteps(result.meeting_review_ingest.run.id).filter((humanStep) => humanStep.status === 'pending')).toHaveLength(0);
        expect(repository.listHumanSteps(result.meeting_review_ingest.run.id).filter((humanStep) => humanStep.status === 'cancelled')).toHaveLength(4);

        await expect(service.resolveHumanStep(staleApproveStep.id, {
            run_id: result.meeting_review_ingest.run.id,
            resolution: 'approved'
        }, actor)).rejects.toThrow(`human step '${staleApproveStep.id}' is already cancelled`);
        expect(repository.getRun(result.meeting_review_ingest.run.id)).toMatchObject({
            status: 'cancelled',
            closure_state: 'closed'
        });
        expect(repository.listAuditLogs({ targetId: result.meeting_review_ingest.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.run.human_step.cancelled',
                after: expect.objectContaining({
                    status: 'cancelled',
                    cancelled_human_step_ids: expect.arrayContaining([
                        staleApproveStep.id
                    ])
                })
            })
        ]));
    });

    it('story-meeting-review-package-ingest-v1 blocks Automation Run core and rerun before extra run writes', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const result = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor);
        const workflowId = result.meeting_review_ingest.run.workflow_id;
        const runId = result.meeting_review_ingest.run.id;

        await expect(service.automationRunService.runWorkflow(workflowId, {
            actorId: actor.person_id,
            projectCodes: actor.projectCodes,
            role: actor.role,
            triggerType: 'manual'
        })).rejects.toThrow('meeting-review-package-ingest workflows cannot be manually run');

        await expect(service.rerun(runId, {}, actor)).rejects.toThrow('meeting-review-package-ingest workflows cannot be manually run');

        expect(repository.listRuns({ workflowId })).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-review-package-ingest-v1 preserves project access denial before Automation Run guard', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const result = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor);
        const workflowId = result.meeting_review_ingest.run.workflow_id;
        const runId = result.meeting_review_ingest.run.id;
        const noAccessActor = {
            ...actor,
            role: 'member',
            projectCodes: []
        };

        await expect(service.automationRunService.runWorkflow(workflowId, {
            actorId: noAccessActor.person_id,
            projectCodes: noAccessActor.projectCodes,
            role: noAccessActor.role,
            triggerType: 'manual'
        })).rejects.toMatchObject({
            statusCode: 403,
            message: "project 'salestailor' is not accessible"
        });

        await expect(service.rerun(runId, {}, noAccessActor)).rejects.toMatchObject({
            statusCode: 403,
            message: "project 'salestailor' is not accessible"
        });

        expect(repository.listRuns({ workflowId })).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-review-package-ingest-v1 rolls back partial ingest writes when persistence fails mid-transaction', async () => {
        const repository = new MeetingReviewOutputFailureRepository();
        const { service, actor } = makeService({ repository });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);
        const beforeWorkflowCount = repository.ledger.workflows.length;
        const beforeAuditCount = repository.ledger.audit_logs.length;

        await expect(service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, actor)).rejects.toThrow('persistence_failure: workflow_outputs write failed');

        expect(repository.ledger.workflows).toHaveLength(beforeWorkflowCount);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs).toHaveLength(beforeAuditCount);
    });

    it('keeps Unson and SalesTailor role agent instances separate for the same archetype', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-sales',
            triggerId: 'trg-unson-human-sales'
        });
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-event-sales',
            triggerType: 'event'
        });

        expect(repository.listRoleAgentInstances({ roleArchetypeId: 'sales' })).toEqual([
            expect.objectContaining({
                id: 'rai-unson-sales',
                org_id: 'unson',
                context_policy: { graph_refs: ['org:unson'], customer_scope: 'unson:active_accounts' },
                tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
                workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
            }),
            expect.objectContaining({
                id: 'rai-salestailor-sales',
                org_id: 'salestailor',
                context_policy: { graph_refs: ['org:salestailor'], customer_scope: 'salestailor:active_accounts' },
                tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
                workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
            })
        ]);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor' })).toEqual([
            expect.objectContaining({
                id: 'bind-salestailor-sales',
                workflow_selection_reason: 'salestailorの営業接触期限を判断する'
            })
        ]);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor' })).toEqual([
            expect.objectContaining({ id: 'trg-salestailor-event-sales', trigger_type: 'event' })
        ]);
    });

    it('creates approval-required loop intents from trigger, binding, and org context', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-schedule-sales',
            triggerType: 'schedule'
        });

        const result = await service.createLoopIntent({
            id: 'loop-salestailor-scheduled-sales',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-schedule-sales',
            input_summary: '毎朝の営業フォロー候補抽出',
            input_payload: {
                source: 'schedule',
                candidate_filters: {
                    stale_days: 7,
                    stages: ['proposal', 'follow_up']
                }
            }
        }, actor);

        expect(result.loop_intent).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-salestailor-sales',
            workflow_template_id: 'tmpl-sales-followup',
            input_summary: '毎朝の営業フォロー候補抽出',
            input_payload: {
                source: 'schedule',
                candidate_filters: {
                    stale_days: 7,
                    stages: ['proposal', 'follow_up']
                }
            },
            selected_workflow_reason: 'salestailorの営業接触期限を判断する',
            trigger_type: 'schedule',
            eligibility: {
                status: 'needs_approval',
                autonomy_level: 'approval_required',
                requires_human_approval: true,
                reasons: ['autonomy_level_approval_required']
            }
        });
    });

    it('blocks loop intents for disabled triggers', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-sales',
            triggerId: 'trg-unson-disabled-sales',
            triggerEnabled: false
        });

        const result = await service.createLoopIntent({
            id: 'loop-unson-disabled',
            org_id: 'unson',
            project_id: 'unson',
            workflow_binding_id: 'bind-unson-sales',
            trigger_id: 'trg-unson-disabled-sales'
        }, actor);

        expect(result.loop_intent).toMatchObject({
            status: 'blocked',
            eligibility: {
                status: 'blocked',
                reasons: ['workflow_trigger_disabled']
            }
        });
    });

    it('records human-only loop intents without marking them ready for Eve execution', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-human-only-sales',
            triggerId: 'trg-unson-human-only-sales',
            autonomyLevel: 'human_only'
        });

        const result = await service.createLoopIntent({
            id: 'loop-unson-human-only',
            org_id: 'unson',
            project_id: 'unson',
            workflow_binding_id: 'bind-unson-human-only-sales',
            trigger_id: 'trg-unson-human-only-sales',
            input_summary: '人間だけで判断する営業相談'
        }, actor);

        expect(result.loop_intent).toMatchObject({
            id: 'loop-unson-human-only',
            status: 'human_only',
            input_summary: '人間だけで判断する営業相談',
            eligibility: {
                status: 'human_only',
                autonomy_level: 'human_only',
                requires_human_approval: true,
                reasons: ['autonomy_level_human_only']
            }
        });
        expect(repository.getLoopIntent('loop-unson-human-only')).toMatchObject({
            status: 'human_only',
            eligibility: expect.objectContaining({ status: 'human_only' })
        });
    });

    it('blocks loop intents for disabled bindings', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-disabled-sales',
            triggerId: 'trg-unson-sales',
            bindingEnabled: false
        });

        const result = await service.createLoopIntent({
            id: 'loop-unson-disabled-binding',
            org_id: 'unson',
            project_id: 'unson',
            workflow_binding_id: 'bind-unson-disabled-sales',
            trigger_id: 'trg-unson-sales'
        }, actor);

        expect(result.loop_intent).toMatchObject({
            status: 'blocked',
            eligibility: {
                status: 'blocked',
                reasons: ['workflow_binding_disabled']
            }
        });
    });

    it('rejects loop intents with invalid direct trigger types before persistence', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });

        await expect(service.createLoopIntent({
            id: 'loop-invalid-webhook',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_type: 'webhook'
        }, actor)).rejects.toMatchObject({
            message: 'trigger_type must be one of human, event, schedule'
        });
        expect(repository.listLoopIntents({ orgId: 'salestailor' })).toEqual([]);
    });

    it('rejects non-json loop intent input payloads before persistence', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });

        await expect(service.createLoopIntent({
            id: 'loop-invalid-input-payload',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-human-sales',
            input_payload: 'customer=salestailor'
        }, actor)).rejects.toMatchObject({
            message: 'input_payload must be a JSON object or array'
        });
        expect(repository.getLoopIntent('loop-invalid-input-payload')).toBeNull();
    });

    it('preserves null and array loop intent input payloads', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });

        const nullResult = await service.createLoopIntent({
            id: 'loop-null-input-payload',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-human-sales',
            input_payload: null
        }, actor);
        const arrayResult = await service.createLoopIntent({
            id: 'loop-array-input-payload',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-human-sales',
            input_payload: [
                { customer_id: 'cus_salestailor_001' },
                { customer_id: 'cus_salestailor_002' }
            ]
        }, actor);

        expect(nullResult.loop_intent).toMatchObject({ input_payload: null });
        expect(arrayResult.loop_intent.input_payload).toEqual([
            { customer_id: 'cus_salestailor_001' },
            { customer_id: 'cus_salestailor_002' }
        ]);
        expect(repository.getLoopIntent('loop-null-input-payload')).toMatchObject({ input_payload: null });
        expect(repository.getLoopIntent('loop-array-input-payload')).toMatchObject({
            input_payload: [
                { customer_id: 'cus_salestailor_001' },
                { customer_id: 'cus_salestailor_002' }
            ]
        });
    });

    it('rejects bindings when the agent belongs to a different org', async () => {
        const { service, actor } = makeService();
        await service.createRoleAgentInstance({
            id: 'rai-unson-sales',
            org_id: 'unson',
            project_id: 'unson',
            role_archetype_id: 'sales',
            name: 'Unson sales agent'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-sales-followup',
            name: 'Sales followup',
            workflow_kind: 'sales'
        }, actor);

        await expect(service.createWorkflowBinding({
            id: 'bind-cross-org',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-unson-sales',
            workflow_template_id: 'tmpl-sales-followup',
            autonomy_level: 'approval_required'
        }, actor)).rejects.toMatchObject({
            message: "role_agent_instance 'rai-unson-sales' belongs to org 'unson'"
        });
    });

    it('rejects unknown org references before WMC becomes an org source of truth', async () => {
        const { repository, service, actor } = makeService();

        await expect(service.createRoleAgentInstance({
            id: 'rai-unknown-sales',
            org_id: 'unknown-org',
            project_id: 'salestailor',
            role_archetype_id: 'sales',
            name: 'Unknown org sales agent'
        }, actor)).rejects.toMatchObject({
            message: "org 'unknown-org' is not a known Graph org reference"
        });

        await expect(service.createWorkflowTemplate({
            id: 'tmpl-unknown-org',
            org_id: 'unknown-org',
            project_id: 'salestailor',
            name: 'Unknown org template',
            workflow_kind: 'sales'
        }, actor)).rejects.toMatchObject({
            message: "org 'unknown-org' is not a known Graph org reference"
        });

        expect(repository.listRoleAgentInstances({ orgId: 'unknown-org' })).toEqual([]);
        expect(repository.listWorkflowTemplates({ orgId: 'unknown-org' })).toEqual([]);
    });

    it('rejects bindings when the agent belongs to a different project in the same org', async () => {
        const { service, actor } = makeService();
        await service.createRoleAgentInstance({
            id: 'rai-sales-unson-project',
            org_id: 'salestailor',
            project_id: 'unson',
            role_archetype_id: 'sales',
            name: 'SalesTailor agent in Unson project'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-salestailor-sales',
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: 'SalesTailor sales followup',
            workflow_kind: 'sales'
        }, actor);

        await expect(service.createWorkflowBinding({
            id: 'bind-cross-project',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-sales-unson-project',
            workflow_template_id: 'tmpl-salestailor-sales',
            autonomy_level: 'approval_required'
        }, actor)).rejects.toMatchObject({
            message: "role_agent_instance 'rai-sales-unson-project' belongs to project 'unson'"
        });
    });

    it('rejects triggers and loop intents when parent project or binding lineage does not match', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-salestailor-sales',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-salestailor-unson-project',
            templateId: 'tmpl-salestailor-unson-project',
            bindingId: 'bind-salestailor-unson-project',
            triggerId: 'trg-salestailor-unson-project'
        });

        await expect(service.createWorkflowTrigger({
            id: 'trg-cross-project',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-unson-project',
            trigger_type: 'human'
        }, actor)).rejects.toMatchObject({
            message: "workflow_binding 'bind-salestailor-unson-project' belongs to project 'unson'"
        });

        await expect(service.createLoopIntent({
            id: 'loop-cross-binding-trigger',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-unson-project'
        }, actor)).rejects.toMatchObject({
            message: "workflow_trigger 'trg-salestailor-unson-project' belongs to project 'unson'"
        });
    });

    it('enforces project access on workflow templates before binding selection', async () => {
        const { repository, service, actor } = makeService();
        const noAccessActor = {
            ...actor,
            role: 'member',
            projectCodes: []
        };

        await expect(service.createWorkflowTemplate({
            id: 'tmpl-denied-unson-sales',
            org_id: 'unson',
            project_id: 'unson',
            name: 'Denied Unson Sales',
            workflow_kind: 'sales'
        }, noAccessActor)).rejects.toMatchObject({
            message: "project 'unson' is not accessible"
        });

        await expect(service.createWorkflowTemplate({
            id: 'tmpl-denied-global',
            name: 'Denied Global',
            workflow_kind: 'sales'
        }, noAccessActor)).rejects.toMatchObject({
            message: 'project_id is required for workflow_template creation'
        });

        repository.upsertWorkflowTemplate({
            id: 'tmpl-hidden-unson-sales',
            workspace_id: 'default',
            org_id: 'unson',
            project_id: 'unson',
            name: 'Hidden Unson Sales',
            workflow_kind: 'sales'
        });

        const listResult = await service.listWorkflowTemplates({ orgId: 'unson' }, noAccessActor);
        expect(listResult.workflow_templates).toEqual([]);
    });

    it('includes global workflow templates in project-scoped selection lists', async () => {
        const { service, actor } = makeService();
        await service.createWorkflowTemplate({
            id: 'tmpl-global-sales',
            name: 'Global sales followup',
            workflow_kind: 'sales'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-salestailor-sales',
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: 'SalesTailor sales followup',
            workflow_kind: 'sales'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-unson-sales',
            org_id: 'unson',
            project_id: 'unson',
            name: 'Unson sales followup',
            workflow_kind: 'sales'
        }, actor);

        const result = await service.listWorkflowTemplates({
            orgId: 'salestailor',
            projectId: 'salestailor',
            workflowKind: 'sales'
        }, actor);

        expect(result.workflow_templates.map((template) => template.id)).toEqual([
            'tmpl-global-sales',
            'tmpl-salestailor-sales'
        ]);
    });
});
