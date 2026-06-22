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
    googleCalendarService = null
} = {}) {
    const runner = new WorkflowRunner({ repository, handlers });
    const configParser = {
        async getProjects() {
            return {
                root: '/workspace',
                projects: [
                    { id: 'unson', session_select: true, aliases: ['unson-os'] },
                    { id: 'salestailor', session_select: true, aliases: ['sales-tailor'] }
                ]
            };
        }
    };
    const service = new WorkflowService({ repository, runner, configParser, googleCalendarService });
    const actor = {
        sub: 'keigo',
        person_id: 'keigo',
        role: 'admin',
        projectCodes: ['unson', 'salestailor']
    };
    return { repository, service, actor };
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
    it('story-mana-meeting-workflow-pack-data-v1 S-001 bootstraps meeting pack records into Workflow Control data', async () => {
        const { repository, service, actor } = makeService();

        const result = await service.bootstrapMeetingWorkflowPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);

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
        expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })).toEqual([
            expect.objectContaining({ action: 'workflow.meeting_pack.bootstrapped', target_type: 'meeting_workflow_pack' })
        ]);
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
