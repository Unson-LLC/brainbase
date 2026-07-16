import { describe, expect, it, vi } from 'vitest';

import { MeetingAutomationService } from '../../../server/services/meeting-automation/meeting-automation-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowService } from '../../../server/services/workflow/workflow-service.js';

function makeMeetingService({
    repository = new InMemoryWorkflowRepository(),
    googleCalendarService = null,
    createLoopIntent = vi.fn(async (input) => ({ loop_intent: input }))
} = {}) {
    const prepareProjectAccess = vi.fn(async () => {});
    const assertProjectSelectable = vi.fn(async () => {});
    const assertOrgReferenceAllowed = vi.fn(() => {});
    const assertProjectAccess = vi.fn(() => {});
    const service = new MeetingAutomationService({
        repository,
        googleCalendarService,
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
        prepareProjectAccess,
        assertProjectSelectable,
        assertOrgReferenceAllowed,
        assertProjectAccess
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
});
