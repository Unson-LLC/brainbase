import { describe, expect, it, vi } from 'vitest';

import { MeetingAutomationService } from '../../../server/services/meeting-automation/meeting-automation-service.js';
import { MeetingKnowledgeEventBridge } from '../../../server/services/meeting-automation/meeting-knowledge-event-bridge.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function makeMeetingService({
    repository = new InMemoryWorkflowRepository(),
    googleCalendarService = null,
    infoSSOTService = null,
    meetingKnowledgeEventBridge = null,
    resolveReviewTaskOwners = vi.fn(async (reviewPackage) => reviewPackage),
    createLoopIntent = vi.fn(async (input) => ({ loop_intent: input }))
} = {}) {
    const prepareProjectAccess = vi.fn(async () => {});
    const assertProjectSelectable = vi.fn(async () => {});
    const assertOrgReferenceAllowed = vi.fn(() => {});
    const assertProjectAccess = vi.fn(() => {});
    const service = new MeetingAutomationService({
        repository,
        googleCalendarService,
        infoSSOTService,
        meetingKnowledgeEventBridge,
        resolveReviewTaskOwners,
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

    it('Cloudflare/computer向けMeeting note生成handoffと監査証跡を返す', async () => {
        const { service, repository } = makeMeetingService();
        const result = await service.prepareNoteGenerationHandoff({
            loopIntent: { id: 'loop-note-1' },
            orgId: 'salestailor',
            projectId: 'salestailor',
            packageId: 'package-1',
            runId: 'review-run-1',
            actorId: 'keigo'
        });
        expect(result).toEqual({
            status: 'ready',
            runtime_type: 'cloudflare_computer',
            loop_intent_id: 'loop-note-1',
            run_id: 'review-run-1',
            package_id: 'package-1',
            output_key: 'meeting_note_draft',
            write_back_path: '/api/workflows/control/meeting-pack/note-generation'
        });
        expect(repository.listAuditLogs({ targetId: 'review-run-1' })[0]).toMatchObject({
            action: 'workflow.meeting_pack.note_generation.handoff_ready',
            after: {
                package_id: 'package-1',
                runtime_type: 'cloudflare_computer'
            }
        });
    });

    it('対象loop intentがなければhandoffをblockedとして監査する', async () => {
        const { service, repository } = makeMeetingService();
        const result = await service.prepareNoteGenerationHandoff({
            loopIntent: null,
            orgId: 'salestailor',
            projectId: 'salestailor',
            packageId: 'package-1',
            runId: 'review-run-1',
            actorId: 'keigo'
        });
        expect(result).toEqual({
            status: 'blocked',
            reason: 'loop_intent_missing',
            loop_intent_id: null
        });
        expect(repository.listAuditLogs({ targetId: 'review-run-1' })[0].action)
            .toBe('workflow.meeting_pack.note_generation.handoff_blocked');
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

    it('解決済みReview Packageをrun/output/human-stepへ一度だけ記録する', async () => {
        const { repository, service } = makeMeetingService();
        const loopIntents = [
            ['transcript_to_meeting_note', 'loop-note'],
            ['meeting_note_to_tasks', 'loop-tasks'],
            ['meeting_note_to_decisions', 'loop-decisions'],
            ['post_meeting_follow_up_message', 'loop-follow-up']
        ].map(([key, id]) => ({
            key,
            loop_intent: {
                id,
                org_id: 'salestailor',
                project_id: 'salestailor',
                workflow_template_id: `template-${key}`,
                workflow_binding_id: `binding-${key}`
            }
        }));
        const loopIntentByKey = new Map(loopIntents.map((entry) => [entry.key, entry.loop_intent]));
        const reviewPackage = {
            package_id: 'package-ledger-1',
            schema_version: 'meeting_review_package.v1',
            status: 'ready_for_review',
            seed_id: 'seed-1',
            stop_conditions: ['privacy_scope_leak'],
            loop_intent_ids: Object.fromEntries(loopIntents.map((entry) => [entry.key, entry.loop_intent.id])),
            meeting_note_summary: { title: '議事録' },
            task_candidates: [{ title: '次アクション' }],
            decision_candidates: [{ title: '方針決定' }],
            follow_up_draft: { body: '共有します' },
            promotion_candidates: { graph: [], learning: [] }
        };
        const context = {
            reviewPackage,
            resolvedReviewPackage: reviewPackage,
            packageId: reviewPackage.package_id,
            meetingIdentity: { title: '定例', event_id: 'event-1', start: '2026-07-17T10:00:00+09:00' },
            sourceEvent: { source_system: 'tactiq', transcript_id: 'transcript-1', transcript_sha256: 'sha256-1' },
            evidenceRefs: ['evidence-1'],
            orgId: 'salestailor',
            projectId: 'salestailor',
            caseScope: 'case-1',
            projectResolution: { status: 'single_high_confidence_project', project_id: 'salestailor' },
            graphPlaybookContext: {
                snapshot_data: { verification_status: 'verified_from_graph_ssot' },
                graph_playbook: { graph_context: { status: 'resolved' } },
                item_count: 2
            },
            loopIntents,
            loopIntentByKey
        };

        const first = await service.persistReviewPackage(context, actor);
        const second = await service.persistReviewPackage(context, actor);

        expect(first.meeting_review_ingest).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            package_id: 'package-ledger-1',
            idempotent: false,
            run: { status: 'waiting_human' }
        });
        expect(first.meeting_review_ingest.outputs).toHaveLength(5);
        expect(first.meeting_review_ingest.human_steps).toHaveLength(5);
        expect(first.meeting_review_ingest.context_snapshots).toHaveLength(4);
        expect(second.meeting_review_ingest).toMatchObject({
            package_id: 'package-ledger-1',
            idempotent: true,
            note_generation_handoff: { status: 'ready', reason: 'idempotent_replay' }
        });
        expect(repository.listRuns()).toHaveLength(1);
    });

    it('Review Package取り込みをscope解決からnote生成handoffまで統括する', async () => {
        const { service } = makeMeetingService();
        const reviewScope = {
            orgId: 'salestailor',
            projectId: 'salestailor',
            packageId: 'package-orchestration-1',
            loopIntentByKey: new Map([['transcript_to_meeting_note', { id: 'loop-note-1' }]])
        };
        const resolvedContext = { ...reviewScope, graphPlaybookContext: { item_count: 1 } };
        const ingestResult = {
            meeting_review_ingest: {
                idempotent: false,
                run: { id: 'review-run-1' }
            }
        };
        vi.spyOn(service, 'resolveReviewPackageScope').mockResolvedValue(reviewScope);
        vi.spyOn(service, 'findReviewPackageReplay').mockReturnValue(null);
        vi.spyOn(service, 'resolveReviewPackageGraphContext').mockResolvedValue(resolvedContext);
        vi.spyOn(service, 'persistReviewPackage').mockResolvedValue(ingestResult);
        vi.spyOn(service, 'prepareNoteGenerationHandoff').mockResolvedValue({
            status: 'ready',
            runtime_type: 'cloudflare_computer',
            loop_intent_id: 'loop-note-1'
        });

        const result = await service.ingestReviewPackage({ review_package: { package_id: 'package-orchestration-1' } }, actor);

        expect(service.resolveReviewPackageScope).toHaveBeenCalledWith(
            { review_package: { package_id: 'package-orchestration-1' } },
            actor
        );
        expect(service.resolveReviewPackageGraphContext).toHaveBeenCalledWith(reviewScope, actor);
        expect(service.persistReviewPackage).toHaveBeenCalledWith(resolvedContext, actor);
        expect(service.prepareNoteGenerationHandoff).toHaveBeenCalledWith({
            loopIntent: { id: 'loop-note-1' },
            orgId: 'salestailor',
            projectId: 'salestailor',
            packageId: 'package-orchestration-1',
            runId: 'review-run-1',
            actorId: 'keigo'
        });
        expect(result.meeting_review_ingest.note_generation_handoff).toEqual({
            status: 'ready',
            runtime_type: 'cloudflare_computer',
            loop_intent_id: 'loop-note-1'
        });
    });

    it('recordCandidatesはledger記録後にMeetingKnowledgeEventBridgeへ同じreview/runner候補を渡す', async () => {
        const bridgeResult = { status: 'completed', decision_count: 1 };
        const meetingKnowledgeEventBridge = { ingest: vi.fn(async () => bridgeResult) };
        const { service } = makeMeetingService({ meetingKnowledgeEventBridge });
        const input = {
            org_id: 'salestailor',
            project_id: 'salestailor',
            package_id: 'package-knowledge-1',
            run_id: 'run-knowledge-1',
            source_text_hash: 'sha256-meeting-note-1',
            task_candidates: [{ id: 'task_1', title: '料金ページを更新する' }],
            decision_candidates: [{ id: 'decision_1', title: '最低価格を決定する' }],
            follow_up_draft: { id: 'followup_1', body: '決定事項を共有します' },
            runner: {
                status: 'completed',
                decision_candidates: ['decision_1'],
                task_candidates: ['task_1'],
                follow_up_draft: ['followup_1']
            }
        };
        const sourceEvent = {
            event_id: 'meeting_source_1',
            occurred_at: '2026-08-13T01:00:00.000Z',
            source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_1' }
        };
        vi.spyOn(service.reviewLedgerService, 'resolveCandidateContext').mockReturnValue({
            run: { id: 'run-knowledge-1', metadata: { graph_context: null, source_event: sourceEvent } },
            outputs: []
        });
        vi.spyOn(service.reviewLedgerService, 'recordCandidates').mockReturnValue({
            meeting_candidate_ingest: { status: 'recorded' }
        });

        const result = await service.recordCandidates(input, actor);

        expect(result.status).toBe('completed');

        expect(meetingKnowledgeEventBridge.ingest).toHaveBeenCalledWith(expect.objectContaining({
            packageId: 'package-knowledge-1',
            runId: 'run-knowledge-1',
            projectCode: 'salestailor',
            sourceEvent,
            reviewPackage: expect.objectContaining({
                decision_candidates: input.decision_candidates,
                task_candidates: input.task_candidates,
                follow_up_draft: input.follow_up_draft
            }),
            runnerResult: input.runner,
            access: actor
        }));
    });

    it('candidate集合不一致は全候補preflightでpartialにしledger/Graph/candidateへ一件も書かない', async () => {
        const knowledgeEventService = { ingest: vi.fn() };
        const candidateRepository = { create: vi.fn(), findByEventId: vi.fn() };
        const meetingKnowledgeEventBridge = new MeetingKnowledgeEventBridge({
            knowledgeEventService,
            candidateRepository
        });
        const { service } = makeMeetingService({ meetingKnowledgeEventBridge });
        const sourceEvent = {
            event_id: 'meeting_source_preflight_1',
            occurred_at: '2026-08-13T01:00:00.000Z',
            source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_preflight_1' }
        };
        vi.spyOn(service.reviewLedgerService, 'resolveCandidateContext').mockReturnValue({
            run: { id: 'run-preflight-1', metadata: { graph_context: null, source_event: sourceEvent } },
            outputs: []
        });
        const ledgerWrite = vi.spyOn(service.reviewLedgerService, 'recordCandidates').mockReturnValue({
            meeting_candidate_ingest: { status: 'recorded' }
        });

        const result = await service.recordCandidates({
            org_id: 'salestailor',
            project_id: 'salestailor',
            package_id: 'package-preflight-1',
            run_id: 'run-preflight-1',
            source_text_hash: 'sha256-meeting-preflight-1',
            decision_candidates: [{
                id: 'decision_1',
                title: '最低価格を決定する',
                statement: '価格を決定する'
            }],
            task_candidates: [{ id: 'task_1', title: '料金ページを更新する' }],
            follow_up_draft: { id: 'followup_1', body: '決定事項を共有します' },
            runner: {
                status: 'completed',
                decision_candidates: ['decision_other'],
                task_candidates: ['task_1'],
                follow_up_draft: ['followup_1']
            }
        }, actor);

        expect(result).toMatchObject({ status: 'partial', failure_reason: 'candidate_id_set_mismatch' });
        expect(ledgerWrite).not.toHaveBeenCalled();
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
        expect(candidateRepository.create).not.toHaveBeenCalled();
    });
});
