import { describe, expect, it, vi } from 'vitest';

import { DuplicateCandidateError } from '../../../server/services/candidate-store/candidate-repository.js';
import { MeetingKnowledgeEventBridge } from '../../../server/services/meeting-automation/meeting-knowledge-event-bridge.js';

function bridgeInput(overrides = {}) {
    const base = {
        packageId: 'meeting_pack_20260813_1',
        runId: 'thread_019ff918',
        projectCode: 'brainbase',
        sourceEvent: {
            event_id: 'meeting_source_1',
            occurred_at: '2026-08-13T01:00:00.000Z',
            source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_1' }
        },
        reviewPackage: {
            package_id: 'meeting_pack_20260813_1',
            meeting_identity: { organizer_person_id: 'person_ceo' },
            decision_candidates: [
                {
                    id: 'decision_pricing_2026',
                    title: '法人プランの最低価格を決める',
                    statement: '法人プランの最低価格を月額10万円にする',
                    source_excerpt: '最低価格は10万円で決定します',
                    decision_authority: { authorized: true, decider_id: 'person_ceo', domain: 'pricing' },
                    applicability_scope: { project_code: 'brainbase', scope: 'organization' }
                },
                {
                    id: 'decision_receipt_required',
                    title: 'Receiptを必須にする',
                    statement: '自動処理はReceiptがない限り成功にしない',
                    source_excerpt: 'Receipt必須でいきます',
                    decision_authority: { authorized: true, decider_id: 'person_ceo', domain: 'operations' },
                    applicability_scope: { project_code: 'brainbase', scope: 'project' }
                }
            ],
            task_candidates: [{ id: 'task_1', title: '料金ページを更新する' }],
            follow_up_draft: { id: 'followup_1', body: '本日の決定事項を共有します。' }
        },
        runnerResult: {
            status: 'completed',
            decision_candidates: ['decision_pricing_2026', 'decision_receipt_required'],
            task_candidates: [{ id: 'task_1', title: '料金ページを更新する' }],
            follow_up_draft: { id: 'followup_1', body: '本日の決定事項を共有します。' }
        },
        access: { role: 'ceo', projectCodes: ['brainbase'], actor_person_id: 'person_ceo' }
    };
    return { ...base, ...overrides };
}

function createHarness() {
    const seen = new Set();
    const knowledgeEventService = {
        ingest: vi.fn(async (event) => {
            const idempotent = seen.has(event.event_id);
            seen.add(event.event_id);
            return {
                event_id: event.event_id,
                graph_entity_id: event.subject.id,
                processing_stage: 'retrievable',
                idempotent
            };
        })
    };
    const candidateRepository = {
        create: vi.fn(async (candidate) => ({ ...candidate }))
    };
    const externalActions = { execute: vi.fn() };
    return {
        knowledgeEventService,
        candidateRepository,
        externalActions,
        bridge: new MeetingKnowledgeEventBridge({ knowledgeEventService, candidateRepository, externalActions })
    };
}

function taskOnlyInput() {
    return bridgeInput({
        reviewPackage: {
            ...bridgeInput().reviewPackage,
            decision_candidates: [],
            task_candidates: [{ id: 'task_1', title: '料金ページを更新する' }],
            follow_up_draft: { body: '' }
        },
        runnerResult: {
            status: 'completed',
            decision_candidates: [],
            task_candidates: [{ id: 'task_1', title: '料金ページを更新する' }],
            follow_up_draft: { body: '' }
        }
    });
}

function concurrentCandidateRepository({ mismatchOnReread = false } = {}) {
    let stored = null;
    let initialReads = 0;
    let releaseInitialReads;
    const initialReadBarrier = new Promise((resolve) => { releaseInitialReads = resolve; });
    return {
        findByEventId: vi.fn(async () => {
            initialReads += 1;
            if (initialReads <= 2) {
                if (initialReads === 2) releaseInitialReads();
                await initialReadBarrier;
                return null;
            }
            return mismatchOnReread && stored ? { ...stored, body: `${stored.body}（別内容）` } : stored;
        }),
        create: vi.fn(async (candidate) => {
            if (!stored) {
                stored = structuredClone(candidate);
                return candidate;
            }
            throw new DuplicateCandidateError(candidate.source_event_ids[0]);
        })
    };
}

describe('MeetingKnowledgeEventBridge', () => {
    it('同一Episodeの根拠あるDecisionをhuman approvalなしでKnowledgeEventServiceへ渡す', async () => {
        const { bridge, knowledgeEventService, candidateRepository, externalActions } = createHarness();

        const result = await bridge.ingest(bridgeInput());

        expect(knowledgeEventService.ingest).toHaveBeenCalledTimes(2);
        const events = knowledgeEventService.ingest.mock.calls.map(([event]) => event);
        expect(new Set(events.map((event) => event.parent_episode_id)).size).toBe(1);
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                schema_version: 'knowledge_event.v1',
                subject: { type: 'decision', id: 'decision_pricing_2026' },
                decision_authority: expect.objectContaining({ authorized: true, decider_id: 'person_ceo' }),
                applicability_scope: expect.objectContaining({ project_code: 'brainbase' }),
                parent_episode_id: expect.stringMatching(/^episode_/),
                source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_1' }
            })
        ]));
        expect(events.every((event) => !Object.hasOwn(event, 'requires_human_approval'))).toBe(true);
        expect(result).toMatchObject({ status: 'completed', decision_count: 2 });

        const candidateWrites = candidateRepository.create.mock.calls.map(([candidate]) => candidate);
        expect(candidateWrites).toEqual(expect.arrayContaining([
            expect.objectContaining({
                recommended_subject_type: 'task',
                requires_approval: true
            }),
            expect.objectContaining({
                recommended_subject_type: 'follow_up',
                requires_approval: true
            })
        ]));
        expect(result.task_candidates).toEqual([
            expect.objectContaining({ id: 'task_1', status: 'approval_required' })
        ]);
        expect(result.follow_up_draft).toMatchObject({
            status: 'draft_only',
            external_send_required_approval: true
        });
        expect(externalActions.execute).not.toHaveBeenCalled();
    });

    it.each([
        ['decision', { decision_candidates: ['decision_pricing_2026'] }],
        ['task', { task_candidates: [{ id: 'task_other', title: '別タスク' }] }],
        ['followup', { follow_up_draft: { id: 'followup_other', body: '別の共有文' } }]
    ])('%sのrunner結果とReview PackageのID集合が不一致ならpartialで何も登録しない', async (_kind, runnerOverride) => {
        const { bridge, knowledgeEventService, candidateRepository } = createHarness();
        const input = bridgeInput({
            runnerResult: { ...bridgeInput().runnerResult, ...runnerOverride }
        });

        const result = await bridge.ingest(input);

        expect(result).toMatchObject({ status: 'partial', failure_reason: 'candidate_id_set_mismatch' });
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
        expect(candidateRepository.create).not.toHaveBeenCalled();
    });

    it.each([
        ['empty decision id', {
            reviewPackage: { ...bridgeInput().reviewPackage, decision_candidates: [{ ...bridgeInput().reviewPackage.decision_candidates[0], id: '' }] },
            runnerResult: { ...bridgeInput().runnerResult, decision_candidates: [''] }
        }],
        ['duplicate task id', {
            reviewPackage: { ...bridgeInput().reviewPackage, task_candidates: [{ id: 'task_1', title: 'A' }, { id: 'task_1', title: 'B' }] },
            runnerResult: { ...bridgeInput().runnerResult, task_candidates: [{ id: 'task_1' }, { id: 'task_1' }] }
        }],
        ['empty followup id', {
            reviewPackage: { ...bridgeInput().reviewPackage, follow_up_draft: { id: '', body: '共有します' } },
            runnerResult: { ...bridgeInput().runnerResult, follow_up_draft: { id: '', body: '共有します' } }
        }]
    ])('%sは全候補のpreflightでpartialにしDecision/候補を一件も書かない', async (_label, overrides) => {
        const { bridge, knowledgeEventService, candidateRepository } = createHarness();

        const result = await bridge.ingest(bridgeInput(overrides));

        expect(result).toMatchObject({ status: 'partial', failure_reason: 'candidate_id_invalid' });
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
        expect(candidateRepository.create).not.toHaveBeenCalled();
    });

    it('runner status未指定は候補集合が完全ならcompletedとして扱う', async () => {
        const { bridge } = createHarness();
        const input = bridgeInput();
        delete input.runnerResult.status;

        await expect(bridge.ingest(input)).resolves.toMatchObject({ status: 'completed' });
    });

    it('runner completedでもdecision_candidates欠落時はpartialまたはblockedでGraph ingestしない', async () => {
        const { bridge, knowledgeEventService } = createHarness();
        const input = bridgeInput();
        delete input.reviewPackage.decision_candidates;
        delete input.runnerResult.decision_candidates;

        const result = await bridge.ingest(input);

        expect(['partial', 'blocked']).toContain(result.status);
        expect(result).toMatchObject({ failure_reason: 'decision_candidates_missing' });
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('同じpackage/runの再送ではstable event IDとparent Episodeを再利用する', async () => {
        const { bridge, knowledgeEventService } = createHarness();
        const input = bridgeInput({
            reviewPackage: {
                ...bridgeInput().reviewPackage,
                decision_candidates: [bridgeInput().reviewPackage.decision_candidates[0]],
                task_candidates: [],
                follow_up_draft: { body: '' }
            },
            runnerResult: {
                status: 'completed',
                decision_candidates: ['decision_pricing_2026'],
                task_candidates: [],
                follow_up_draft: { body: '' }
            }
        });

        const first = await bridge.ingest(input);
        const second = await bridge.ingest(input);

        const [firstEvent, secondEvent] = knowledgeEventService.ingest.mock.calls.map(([event]) => event);
        expect(secondEvent.event_id).toBe(firstEvent.event_id);
        expect(secondEvent.parent_episode_id).toBe(firstEvent.parent_episode_id);
        expect(first.decision_results[0]).toMatchObject({ idempotent: false });
        expect(second.decision_results[0]).toMatchObject({ idempotent: true });
    });

    it('同じpackage/runのtask/followup再送は候補を重複作成しない', async () => {
        const { bridge, candidateRepository } = createHarness();
        const input = bridgeInput({
            reviewPackage: {
                ...bridgeInput().reviewPackage,
                decision_candidates: []
            },
            runnerResult: {
                ...bridgeInput().runnerResult,
                decision_candidates: []
            }
        });

        const first = await bridge.ingest(input);
        const second = await bridge.ingest(input);

        expect(first).toMatchObject({ status: 'completed' });
        expect(second).toMatchObject({ status: 'completed' });
        expect(candidateRepository.create).toHaveBeenCalledTimes(2);
        expect(new Set(candidateRepository.create.mock.calls.map(([candidate]) => candidate.recommended_subject_id)).size).toBe(2);
    });

    it('同一Bridge内でsource event IDが同じでも候補の不変identityが変わった再送は競合として拒否する', async () => {
        const { bridge, candidateRepository } = createHarness();
        const firstInput = taskOnlyInput();
        const changedInput = taskOnlyInput();
        changedInput.reviewPackage.task_candidates[0].title = '料金ページを全面的に作り直す';
        changedInput.runnerResult.task_candidates[0].title = '料金ページを全面的に作り直す';

        await expect(bridge.ingest(firstInput)).resolves.toMatchObject({ status: 'completed' });
        await expect(bridge.ingest(changedInput)).rejects.toMatchObject({
            code: 'meeting_candidate_identity_conflict'
        });

        expect(candidateRepository.create).toHaveBeenCalledOnce();
    });

    it('別Bridge instanceの並行DuplicateCandidateErrorは再読取内容が一致する場合だけ冪等成功にする', async () => {
        const candidateRepository = concurrentCandidateRepository();
        const knowledgeEventService = { ingest: vi.fn() };
        const bridges = [
            new MeetingKnowledgeEventBridge({ knowledgeEventService, candidateRepository }),
            new MeetingKnowledgeEventBridge({ knowledgeEventService, candidateRepository })
        ];

        const results = await Promise.all(bridges.map((bridge) => bridge.ingest(taskOnlyInput())));

        expect(results).toEqual([
            expect.objectContaining({ status: 'completed' }),
            expect.objectContaining({ status: 'completed' })
        ]);
        expect(candidateRepository.create).toHaveBeenCalledTimes(2);
        expect(candidateRepository.findByEventId).toHaveBeenCalledTimes(3);
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('別Bridge instanceの並行DuplicateCandidateError後の再読取内容が違えばidentity conflictにする', async () => {
        const candidateRepository = concurrentCandidateRepository({ mismatchOnReread: true });
        const knowledgeEventService = { ingest: vi.fn() };
        const bridges = [
            new MeetingKnowledgeEventBridge({ knowledgeEventService, candidateRepository }),
            new MeetingKnowledgeEventBridge({ knowledgeEventService, candidateRepository })
        ];

        const results = await Promise.allSettled(bridges.map((bridge) => bridge.ingest(taskOnlyInput())));

        expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(({ status }) => status === 'rejected')).toEqual([
            expect.objectContaining({ reason: expect.objectContaining({ code: 'meeting_candidate_identity_conflict' }) })
        ]);
    });
});
