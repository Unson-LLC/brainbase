import { describe, expect, it, vi } from 'vitest';

import { MeetingAutomationService } from '../../../server/services/meeting-automation/meeting-automation-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowService } from '../../../server/services/workflow/workflow-service.js';

function makeMeetingService({
    repository = new InMemoryWorkflowRepository(),
    googleCalendarService = null,
    eveSessionClient = null,
    infoSSOTService = null,
    resolveReviewTaskOwners = vi.fn(async (reviewPackage) => reviewPackage),
    dispatchLoopIntentToEve = vi.fn(),
    createLoopIntent = vi.fn(async (input) => ({ loop_intent: input }))
} = {}) {
    const prepareProjectAccess = vi.fn(async () => {});
    const assertProjectSelectable = vi.fn(async () => {});
    const assertOrgReferenceAllowed = vi.fn(() => {});
    const assertProjectAccess = vi.fn(() => {});
    const service = new MeetingAutomationService({
        repository,
        googleCalendarService,
        eveSessionClient,
        infoSSOTService,
        resolveReviewTaskOwners,
        dispatchLoopIntentToEve,
        prepareProjectAccess,
        assertProjectSelectable,
        assertOrgReferenceAllowed,
        assertProjectAccess,
        createLoopIntent
    });
    return {
        repository,
        service,
        createLoopIntent,
        dispatchLoopIntentToEve,
        prepareProjectAccess,
        assertProjectSelectable,
        assertOrgReferenceAllowed,
        assertProjectAccess,
        resolveReviewTaskOwners
    };
}

const actor = {
    sub: 'keigo',
    person_id: 'keigo',
    role: 'admin',
    projectCodes: ['salestailor']
};

describe('MeetingAutomationService', () => {
    it('WorkflowServiceの既存Meeting APIを専用Serviceへ委譲する', async () => {
        const meetingAutomationService = {
            reviewPackDesign: vi.fn(async () => ({ reviewed: true })),
            bootstrapPack: vi.fn(async () => ({ bootstrapped: true })),
            createCalendarLoopIntents: vi.fn(async () => ({ ingested: true }))
        };
        const service = new WorkflowService({
            repository: {},
            runner: {},
            configParser: {},
            meetingAutomationService
        });
        const input = { org_id: 'salestailor', project_id: 'salestailor' };

        await expect(service.reviewMeetingWorkflowPackDesign(input, actor)).resolves.toEqual({ reviewed: true });
        await expect(service.bootstrapMeetingWorkflowPack(input, actor)).resolves.toEqual({ bootstrapped: true });
        await expect(service.createMeetingPackCalendarLoopIntents(input, actor)).resolves.toEqual({ ingested: true });
        expect(meetingAutomationService.reviewPackDesign).toHaveBeenCalledWith(input, actor);
        expect(meetingAutomationService.bootstrapPack).toHaveBeenCalledWith(input, actor);
        expect(meetingAutomationService.createCalendarLoopIntents).toHaveBeenCalledWith(input, actor);
    });

    it('Pack設計レビュー前にprojectとorgのアクセス境界を検証する', async () => {
        const {
            service,
            prepareProjectAccess,
            assertProjectSelectable,
            assertOrgReferenceAllowed,
            assertProjectAccess
        } = makeMeetingService();

        const result = await service.reviewPackDesign({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor);

        expect(prepareProjectAccess).toHaveBeenCalledOnce();
        expect(assertProjectSelectable).toHaveBeenCalledWith('salestailor');
        expect(assertOrgReferenceAllowed).toHaveBeenCalledWith('salestailor');
        expect(assertProjectAccess).toHaveBeenCalledWith('salestailor', actor);
        expect(result.meeting_workflow_pack_design).toMatchObject({
            pack_id: 'mana-meeting-workflow-pack-v1',
            org_id: 'salestailor',
            project_id: 'salestailor',
            loop_pack_design_review: { status: 'pass' }
        });
    });

    it('設計Gateがpassでなければ永続化前にbootstrapを停止する', async () => {
        const { repository, service } = makeMeetingService();
        service._preparePackRecords = vi.fn(async () => ({
            orgId: 'salestailor',
            projectId: 'salestailor',
            actorId: 'keigo',
            records: {
                pack_id: 'mana-meeting-workflow-pack-v1',
                loop_pack_design_review: {
                    gate_id: 'loop_pack_design_gate.v0',
                    status: 'needs_revision',
                    issues: [{ code: 'missing_loop_closure_rubric' }]
                }
            }
        }));
        const transaction = vi.spyOn(repository, 'transaction');

        await expect(service.bootstrapPack({
            org_id: 'salestailor',
            project_id: 'salestailor'
        }, actor)).rejects.toThrow('loop pack design gate did not pass');
        expect(transaction).not.toHaveBeenCalled();
    });

    it('Calendarイベントを安定IDのloop intentへ変換し終日予定をskip証跡に残す', async () => {
        const googleCalendarService = {
            async getAuthStatus() {
                return { connected: true, defaultAccount: 'keigo@example.com' };
            },
            async listEventsWithDiagnostics() {
                return {
                    events: [
                        {
                            id: 'gcal:primary:evt-1',
                            calendarEventId: 'evt-1',
                            calendarId: 'primary',
                            title: 'Mana定例',
                            startDateTime: '2026-07-17T10:00:00+09:00',
                            endDateTime: '2026-07-17T11:00:00+09:00',
                            allDay: false
                        },
                        {
                            id: 'gcal:primary:holiday',
                            calendarEventId: 'holiday',
                            calendarId: 'primary',
                            title: '祝日',
                            allDay: true
                        }
                    ],
                    skippedCalendars: []
                };
            }
        };
        const { service, createLoopIntent } = makeMeetingService({ googleCalendarService });

        const result = await service.createCalendarLoopIntents({
            org_id: 'salestailor',
            project_id: 'salestailor',
            from: '2026-07-17T00:00:00+09:00',
            to: '2026-07-18T00:00:00+09:00'
        }, actor);

        expect(createLoopIntent).toHaveBeenCalledOnce();
        expect(createLoopIntent.mock.calls[0][0]).toMatchObject({
            id: 'loop_salestailor_salestailor_pre_meeting_briefing_gcal_primary_evt_1_2026_07_17t10_00_00_09_00',
            input_ref: 'google-calendar:keigo@example.com:primary:evt-1',
            input_payload: {
                meeting_identity: {
                    source: 'google_calendar',
                    account: 'keigo@example.com',
                    event_id: 'evt-1'
                }
            }
        });
        expect(result.meeting_calendar_inputs.loop_intents).toHaveLength(1);
        expect(result.meeting_calendar_inputs.skipped_events).toEqual([
            { event_id: 'holiday', title: '祝日', reason: 'all_day_event' }
        ]);
    });

    it('Eveが接続済みならMeeting note生成をhandoffして監査証跡を残す', async () => {
        const eveSessionClient = { isConfigured: vi.fn(() => true) };
        const dispatchLoopIntentToEve = vi.fn(async () => ({
            eve_session_dispatch: { run: { id: 'eve-run-1' } }
        }));
        const { service, repository } = makeMeetingService({
            eveSessionClient,
            dispatchLoopIntentToEve
        });

        const result = await service.dispatchNoteGeneration({
            loopIntent: { id: 'loop-note-1' },
            orgId: 'salestailor',
            projectId: 'salestailor',
            packageId: 'package-1',
            runId: 'review-run-1',
            actorId: 'keigo',
            actor
        });

        expect(dispatchLoopIntentToEve).toHaveBeenCalledWith('loop-note-1', {
            meeting_note_generation: { run_id: 'review-run-1', package_id: 'package-1' }
        }, actor);
        expect(result).toEqual({
            status: 'requested',
            loop_intent_id: 'loop-note-1',
            eve_session_run_id: 'eve-run-1'
        });
        expect(repository.listAuditLogs({ targetId: 'review-run-1' })[0]).toMatchObject({
            action: 'workflow.meeting_pack.note_generation.dispatch_requested',
            after: {
                package_id: 'package-1',
                runner_type: 'eve',
                external_run_id: 'eve-run-1'
            }
        });
    });

    it('Eve未接続ならhandoffをskipとして監査しReview Package取り込みを失敗させない', async () => {
        const { service, repository, dispatchLoopIntentToEve } = makeMeetingService({
            eveSessionClient: { isConfigured: vi.fn(() => false) }
        });

        const result = await service.dispatchNoteGeneration({
            loopIntent: { id: 'loop-note-1' },
            orgId: 'salestailor',
            projectId: 'salestailor',
            packageId: 'package-1',
            runId: 'review-run-1',
            actorId: 'keigo',
            actor
        });

        expect(dispatchLoopIntentToEve).not.toHaveBeenCalled();
        expect(result).toEqual({
            status: 'skipped',
            reason: 'eve_not_configured',
            loop_intent_id: 'loop-note-1'
        });
        expect(repository.listAuditLogs({ targetId: 'review-run-1' })[0].action)
            .toBe('workflow.meeting_pack.note_generation.dispatch_skipped');
    });

    it('Review Package契約とproject scopeに対するloop intent整合性を検証する', () => {
        const repository = {
            getLoopIntent: vi.fn((id) => ({
                id,
                org_id: 'salestailor',
                project_id: 'salestailor'
            }))
        };
        const { service } = makeMeetingService({ repository });
        const reviewPackage = {
            meeting_note_summary: { agreements: [] },
            task_candidates: [],
            decision_candidates: [],
            follow_up_draft: { body: '' },
            promotion_candidates: { graph: [], learning: [] },
            loop_intent_ids: {
                transcript_to_meeting_note: 'loop-note',
                meeting_note_to_tasks: 'loop-tasks',
                meeting_note_to_decisions: 'loop-decisions',
                post_meeting_follow_up_message: 'loop-follow-up'
            }
        };

        const result = service.verifyReviewPackage({
            reviewPackage,
            orgId: 'salestailor',
            projectId: 'salestailor'
        });

        expect(repository.getLoopIntent).toHaveBeenCalledTimes(4);
        expect(result.loopIntents.map((entry) => entry.key)).toEqual([
            'transcript_to_meeting_note',
            'meeting_note_to_tasks',
            'meeting_note_to_decisions',
            'post_meeting_follow_up_message'
        ]);
        expect(result.loopIntentByKey.get('meeting_note_to_tasks')).toMatchObject({ id: 'loop-tasks' });
    });

    it('Review Packageの必須outputが欠けていればloop intent参照前に停止する', () => {
        const repository = { getLoopIntent: vi.fn() };
        const { service } = makeMeetingService({ repository });

        expect(() => service.verifyReviewPackage({
            reviewPackage: {
                meeting_note_summary: {},
                task_candidates: [],
                decision_candidates: [],
                follow_up_draft: {},
                loop_intent_ids: {}
            },
            orgId: 'salestailor',
            projectId: 'salestailor'
        })).toThrow('review_package is missing required output payload key(s)');
        expect(repository.getLoopIntent).not.toHaveBeenCalled();
    });

    it('Review Packageのscopeを解決してproject scoped Graph contextを付与する', async () => {
        const infoSSOTService = {
            getContext: vi.fn(async () => ({
                entities: {
                    person: [{ id: 'person-keigo', entity_type: 'person' }],
                    glossary_term: [{ id: 'term-loop-intent', entity_type: 'glossary_term' }]
                }
            }))
        };
        const resolveReviewTaskOwners = vi.fn(async (reviewPackage) => ({
            ...reviewPackage,
            task_candidates: [{ title: '次アクション', selected_owner_id: 'person-keigo' }]
        }));
        const {
            repository,
            service,
            prepareProjectAccess,
            assertProjectSelectable,
            assertOrgReferenceAllowed,
            assertProjectAccess
        } = makeMeetingService({ infoSSOTService, resolveReviewTaskOwners });
        const loopIntentIds = {
            transcript_to_meeting_note: 'loop-note',
            meeting_note_to_tasks: 'loop-tasks',
            meeting_note_to_decisions: 'loop-decisions',
            post_meeting_follow_up_message: 'loop-follow-up'
        };
        Object.values(loopIntentIds).forEach((id) => repository.upsertLoopIntent({
            id,
            org_id: 'input-org',
            project_id: 'input-project'
        }));

        const result = await service.resolveReviewPackageContext({
            org_id: 'input-org',
            project_id: 'input-project',
            case_scope: 'case-1',
            review_package: {
                package_id: 'package-1',
                org_id: 'package-org',
                project_id: 'package-project',
                meeting_identity: {
                    title: '定例',
                    candidate_org_id: 'identity-org',
                    candidate_project_id: 'identity-project'
                },
                source_event: { source_system: 'tactiq', transcript_id: 'transcript-1' },
                evidence_refs: ['evidence-1'],
                meeting_note_summary: {},
                task_candidates: [{ title: '次アクション', owner_hint: '圭吾' }],
                decision_candidates: [],
                follow_up_draft: { body: '' },
                promotion_candidates: { graph: [], learning: [] },
                loop_intent_ids: loopIntentIds
            }
        }, actor);

        expect(prepareProjectAccess).toHaveBeenCalledOnce();
        expect(assertProjectSelectable).toHaveBeenCalledWith('input-project');
        expect(assertOrgReferenceAllowed).toHaveBeenCalledWith('input-org');
        expect(assertProjectAccess).toHaveBeenCalledWith('input-project', actor);
        expect(infoSSOTService.getContext).toHaveBeenCalledWith(expect.objectContaining({
            personId: 'keigo',
            projectCodes: expect.arrayContaining(['input-project'])
        }), expect.objectContaining({
            projectCode: 'input-project',
            scope: 'case-1',
            includeEdges: true
        }));
        expect(resolveReviewTaskOwners).toHaveBeenCalledWith(
            expect.objectContaining({
                meeting_note_summary: expect.objectContaining({
                    graph_context_status: expect.objectContaining({ status: 'resolved' })
                })
            }),
            expect.objectContaining({ projectId: 'input-project', actor })
        );
        expect(result).toMatchObject({
            packageId: 'package-1',
            orgId: 'input-org',
            projectId: 'input-project',
            caseScope: 'case-1',
            projectResolution: {
                source: 'explicit_input',
                status: 'single_high_confidence_project'
            },
            graphPlaybookContext: {
                graph_playbook: {
                    graph_context: { status: 'resolved', entity_count: 2 }
                },
                item_count: 2
            },
            resolvedReviewPackage: {
                task_candidates: [{ selected_owner_id: 'person-keigo' }]
            }
        });
    });

    it('project候補が複数ならGraph lookup前にblocked scopeとして停止する', async () => {
        const infoSSOTService = { getContext: vi.fn() };
        const { service, assertProjectSelectable } = makeMeetingService({ infoSSOTService });

        await expect(service.resolveReviewPackageContext({
            org_id: 'salestailor',
            review_package: {
                package_id: 'package-1',
                meeting_identity: {
                    candidate_project_ids: ['project-a', 'project-b']
                }
            }
        }, actor)).rejects.toMatchObject({
            details: {
                state_transition: 'blocked_invalid_scope',
                field: 'project_id',
                project_resolution: {
                    status: 'multiple_project_candidates'
                },
                graph_ssot_playbook: {
                    graph_context: { status: 'not_requested' }
                }
            }
        });
        expect(assertProjectSelectable).not.toHaveBeenCalled();
        expect(infoSSOTService.getContext).not.toHaveBeenCalled();
    });
});
