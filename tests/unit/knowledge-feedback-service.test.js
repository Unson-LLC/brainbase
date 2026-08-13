import { describe, expect, it, vi } from 'vitest';

import { KnowledgeFeedbackService } from '../../server/services/knowledge-feedback-service.js';

function correctionEvent() {
    return {
        schema_version: 'knowledge_event.v1',
        event_id: 'kev_decision_2',
        body_hash: 'sha256:corrected',
        corrects_event_id: 'kev_decision_1',
        subject: { type: 'decision', id: 'decision_pricing_2026' },
        applicability_scope: { project_code: 'brainbase', scope: 'organization' },
        source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_2#decision-1-corrected' }
    };
}

function createTransactionalStore({ failIndex = false } = {}) {
    const state = {
        events: new Map([['kev_decision_1', { event_id: 'kev_decision_1', semantic_state: 'active' }]]),
        search: new Map([['kev_decision_1', { current: true }]]),
        feedback: []
    };
    const repository = {
        transaction: vi.fn(async (work) => {
            const snapshot = structuredClone(state);
            const tx = {
                getEvent: vi.fn(async (id) => state.events.get(id) || null),
                findFeedbackById: vi.fn(async (id) => state.feedback.find((entry) => entry.feedback_id === id) || null),
                insertEvent: vi.fn(async (event) => {
                    state.events.set(event.event_id, { ...event, semantic_state: 'active' });
                    return state.events.get(event.event_id);
                }),
                updateSemanticState: vi.fn(async (id, semanticState) => {
                    state.events.set(id, { ...state.events.get(id), semantic_state: semanticState });
                }),
                replaceSearchDocument: vi.fn(async (oldId, newId) => {
                    if (failIndex) throw new Error('index unavailable');
                    state.search.delete(oldId);
                    state.search.set(newId, { current: true });
                }),
                removeSearchDocument: vi.fn(async (id) => state.search.delete(id)),
                appendFeedback: vi.fn(async (feedback) => state.feedback.push(feedback))
            };
            try {
                return await work(tx);
            } catch (error) {
                state.events = snapshot.events;
                state.search = snapshot.search;
                state.feedback = snapshot.feedback;
                throw error;
            }
        })
    };
    return { state, repository, service: new KnowledgeFeedbackService({ repository }) };
}

function createConcurrentFeedbackStore() {
    let persisted = null;
    let initialReads = 0;
    let releaseInitialReads;
    const initialReadBarrier = new Promise((resolve) => { releaseInitialReads = resolve; });
    const tx = {
        findFeedbackById: vi.fn(async () => {
            initialReads += 1;
            if (initialReads <= 2) {
                if (initialReads === 2) releaseInitialReads();
                await initialReadBarrier;
                return null;
            }
            return persisted;
        }),
        getEvent: vi.fn(async (eventId) => ({
            event_id: eventId,
            semantic_state: 'active',
            project_code: 'brainbase'
        })),
        appendFeedback: vi.fn(async (feedback) => {
            if (!persisted) {
                persisted = structuredClone(feedback);
                return persisted;
            }
            const error = new Error('duplicate knowledge_feedback.feedback_id');
            error.code = '23505';
            error.constraint = 'knowledge_feedback_feedback_id_key';
            throw error;
        })
    };
    const repository = {
        transaction: vi.fn(async (work) => work(tx))
    };
    return {
        tx,
        repository,
        getPersisted: () => persisted,
        service: new KnowledgeFeedbackService({ repository })
    };
}

function createCycleTransitionHarness() {
    const client = { id: 'knowledge-feedback-tx' };
    const currentEvent = {
        event_id: 'kev_decision_1',
        candidate_id: 'cand_decision_1',
        graph_entity_id: 'decision_pricing_2026',
        semantic_state: 'active',
        project_code: 'brainbase',
        source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_1#decision-1' }
    };
    const state = {
        candidateSemantic: 'active',
        graphSemantic: 'active',
        graphSearchable: true
    };
    let insideTransaction = false;
    const tx = {
        client,
        getEvent: vi.fn(async () => currentEvent),
        insertEvent: vi.fn(async (event) => event),
        updateSemanticState: vi.fn(async () => undefined),
        replaceSearchDocument: vi.fn(async () => undefined),
        removeSearchDocument: vi.fn(async () => undefined),
        appendFeedback: vi.fn(async () => undefined)
    };
    const repository = {
        transaction: vi.fn(async (work) => {
            insideTransaction = true;
            try {
                return await work(tx);
            } finally {
                insideTransaction = false;
            }
        })
    };
    const knowledgeEventService = {
        ingest: vi.fn(async (_event, context) => {
            expect(insideTransaction).toBe(true);
            expect(context).toMatchObject({ transaction: tx });
            return {
                event_id: 'kev_decision_2',
                candidate_id: 'cand_decision_2',
                graph_entity_id: 'decision_pricing_2026',
                processing_stage: 'retrievable'
            };
        })
    };
    const candidateRepository = {
        updateSemanticState: vi.fn(async (_candidateId, semanticState, options) => {
            expect(insideTransaction).toBe(true);
            expect(options).toMatchObject({ client });
            state.candidateSemantic = semanticState;
        })
    };
    const graphRepository = {
        supersedeDecision: vi.fn(async (_input, options) => {
            expect(insideTransaction).toBe(true);
            expect(options).toMatchObject({ client });
            state.graphSemantic = 'active';
            state.graphSearchable = true;
            return { id: currentEvent.graph_entity_id };
        }),
        retractDecision: vi.fn(async (_input, options) => {
            expect(insideTransaction).toBe(true);
            expect(options).toMatchObject({ client });
            state.graphSemantic = 'retracted';
            state.graphSearchable = false;
            return { id: currentEvent.graph_entity_id };
        })
    };
    return {
        client,
        currentEvent,
        state,
        tx,
        repository,
        knowledgeEventService,
        candidateRepository,
        graphRepository,
        service: new KnowledgeFeedbackService({
            repository,
            knowledgeEventService,
            candidateRepository,
            graphRepository
        })
    };
}

describe('KnowledgeFeedbackService', () => {
    it('correctは新knowledge_eventを追加して旧情報をsupersededにする', async () => {
        const { service, state } = createTransactionalStore();

        const result = await service.recordFeedback({
            action: 'correct',
            event_id: 'kev_decision_1',
            correction_event: correctionEvent()
        });

        expect(state.events.get('kev_decision_1').semantic_state).toBe('superseded');
        expect(state.events.get('kev_decision_2')).toMatchObject({
            corrects_event_id: 'kev_decision_1',
            semantic_state: 'active'
        });
        expect(state.search.has('kev_decision_1')).toBe(false);
        expect(state.search.has('kev_decision_2')).toBe(true);
        expect(result).toMatchObject({ action: 'correct', semantic_state: 'superseded', replacement_event_id: 'kev_decision_2' });
    });

    it('rejectは旧情報をretractedにして検索対象から外す', async () => {
        const { service, state } = createTransactionalStore();

        const result = await service.recordFeedback({
            action: 'reject',
            event_id: 'kev_decision_1',
            reason: '決定ではなく提案だった'
        });

        expect(state.events.get('kev_decision_1').semantic_state).toBe('retracted');
        expect(state.search.has('kev_decision_1')).toBe(false);
        expect(result).toMatchObject({ action: 'reject', semantic_state: 'retracted' });
    });

    it('同じfeedback_idの再送は監査追加と状態遷移を一度だけ行い同じ結果を返す', async () => {
        const { service, state, repository } = createTransactionalStore();
        const feedback = {
            feedback_id: 'kfb_reject_1',
            action: 'reject',
            event_id: 'kev_decision_1',
            reason: '決定ではなく提案だった'
        };

        const first = await service.recordFeedback(feedback);
        const second = await service.recordFeedback(feedback);

        expect(first).toMatchObject({ action: 'reject', semantic_state: 'retracted' });
        expect(second).toEqual({ ...first, idempotent: true });
        expect(state.feedback).toHaveLength(1);
        expect(repository.transaction).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['event_id', {
            feedback_id: 'kfb_shared_identity',
            action: 'not_useful',
            event_id: 'kev_decision_2'
        }],
        ['action', {
            feedback_id: 'kfb_shared_identity',
            action: 'adopt',
            event_id: 'kev_decision_1'
        }]
    ])('同じfeedback_idを%sが異なるfeedbackに再利用するとtyped conflictにする', async (_field, second) => {
        const { service, state } = createTransactionalStore();
        state.events.set('kev_decision_2', { event_id: 'kev_decision_2', semantic_state: 'active' });
        await service.recordFeedback({
            feedback_id: 'kfb_shared_identity',
            action: 'not_useful',
            event_id: 'kev_decision_1'
        });

        await expect(service.recordFeedback(second)).rejects.toMatchObject({
            code: 'knowledge_feedback_identity_conflict'
        });
        expect(state.feedback).toHaveLength(1);
    });

    it('同じfeedback_idのcorrection identityが異なる場合は冪等再送にしない', async () => {
        const { service, state } = createTransactionalStore();
        await service.recordFeedback({
            feedback_id: 'kfb_correction_identity',
            action: 'correct',
            event_id: 'kev_decision_1',
            correction_event: correctionEvent()
        });

        await expect(service.recordFeedback({
            feedback_id: 'kfb_correction_identity',
            action: 'correct',
            event_id: 'kev_decision_1',
            correction_event: {
                ...correctionEvent(),
                body_hash: 'sha256:different',
                source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_3#different' }
            }
        })).rejects.toMatchObject({ code: 'knowledge_feedback_identity_conflict' });
        expect(state.feedback).toHaveLength(1);
    });

    it('自動feedback IDは訂正eventのbody hash・subject・source pointerを不変identityに含める', async () => {
        const variants = [
            correctionEvent(),
            { ...correctionEvent(), body_hash: 'sha256:different-body' },
            { ...correctionEvent(), subject: { type: 'decision', id: 'decision_enterprise_pricing' } },
            {
                ...correctionEvent(),
                source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_3#different-source' }
            }
        ];
        const feedbackIds = [];

        for (const correction of variants) {
            const { service, state } = createTransactionalStore();
            await service.recordFeedback({
                action: 'correct',
                event_id: 'kev_decision_1',
                correction_event: correction
            });
            feedbackIds.push(state.feedback[0].feedback_id);
        }

        expect(new Set(feedbackIds).size).toBe(variants.length);
    });

    it('並行した同一feedbackのunique競合は再読取して同一identityなら冪等成功にする', async () => {
        const harness = createConcurrentFeedbackStore();
        const feedback = {
            feedback_id: 'kfb_concurrent_same',
            action: 'not_useful',
            event_id: 'kev_decision_1',
            reason: '利用されなかった'
        };

        const results = await Promise.all([
            harness.service.recordFeedback(feedback),
            harness.service.recordFeedback(feedback)
        ]);

        expect(results).toEqual(expect.arrayContaining([
            expect.objectContaining({ idempotent: true }),
            expect.objectContaining({ action: 'not_useful', event_id: 'kev_decision_1' })
        ]));
        expect(harness.getPersisted()).toMatchObject(feedback);
    });

    it('並行unique競合の再読取identityが異なればtyped conflictにする', async () => {
        const harness = createConcurrentFeedbackStore();
        const results = await Promise.allSettled([
            harness.service.recordFeedback({
                feedback_id: 'kfb_concurrent_conflict',
                action: 'not_useful',
                event_id: 'kev_decision_1'
            }),
            harness.service.recordFeedback({
                feedback_id: 'kfb_concurrent_conflict',
                action: 'adopt',
                event_id: 'kev_decision_1'
            })
        ]);

        expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(({ status }) => status === 'rejected')).toEqual([
            expect.objectContaining({
                reason: expect.objectContaining({ code: 'knowledge_feedback_identity_conflict' })
            })
        ]);
    });

    it('correctのindex更新失敗時は新event・旧状態・検索対象を原子的にrollbackする', async () => {
        const { service, state, repository } = createTransactionalStore({ failIndex: true });

        await expect(service.recordFeedback({
            action: 'correct',
            event_id: 'kev_decision_1',
            correction_event: correctionEvent()
        })).rejects.toThrow('index unavailable');

        expect(repository.transaction).toHaveBeenCalledOnce();
        expect(state.events.get('kev_decision_1').semantic_state).toBe('active');
        expect(state.events.has('kev_decision_2')).toBe(false);
        expect([...state.search.keys()]).toEqual(['kev_decision_1']);
        expect(state.feedback).toEqual([]);
    });

    it('correctは同一transactionでreplacementを通常ingestし旧event/candidateをsupersededにしてstable Graph currentを差し替える', async () => {
        const harness = createCycleTransitionHarness();
        const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };
        const replacement = correctionEvent();

        await harness.service.recordFeedback({
            action: 'correct',
            event_id: 'kev_decision_1',
            correction_event: replacement,
            reason: '価格決定を訂正'
        }, { access });

        expect(harness.knowledgeEventService.ingest).toHaveBeenCalledWith(
            replacement,
            expect.objectContaining({ access, transaction: harness.tx })
        );
        expect(harness.candidateRepository.updateSemanticState).toHaveBeenCalledWith(
            'cand_decision_1',
            'superseded',
            expect.objectContaining({ client: harness.client })
        );
        expect(harness.graphRepository.supersedeDecision).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'decision_pricing_2026',
                replacement_event_id: 'kev_decision_2',
                replacement_candidate_id: 'cand_decision_2',
                source_pointer: replacement.source_pointer
            }),
            expect.objectContaining({ client: harness.client, access })
        );
        expect(harness.tx.appendFeedback).toHaveBeenCalledWith(expect.objectContaining({
            source_pointer: harness.currentEvent.source_pointer
        }));
        expect(harness.state).toMatchObject({
            candidateSemantic: 'superseded',
            graphSemantic: 'active',
            graphSearchable: true
        });
    });

    it('correction replacementのsubject.idが旧Graph IDと違えばtransaction開始後も更新せず拒否する', async () => {
        const harness = createCycleTransitionHarness();
        const replacement = {
            ...correctionEvent(),
            subject: { type: 'decision', id: 'decision_other' }
        };

        await expect(harness.service.recordFeedback({
            action: 'correct',
            event_id: 'kev_decision_1',
            correction_event: replacement
        })).rejects.toMatchObject({ code: 'knowledge_feedback_invalid' });

        expect(harness.knowledgeEventService.ingest).not.toHaveBeenCalled();
        expect(harness.tx.updateSemanticState).not.toHaveBeenCalled();
    });

    it('supersede対象Graphが0件ならtransaction全体を失敗にする', async () => {
        const harness = createCycleTransitionHarness();
        harness.graphRepository.supersedeDecision.mockResolvedValueOnce(null);

        await expect(harness.service.recordFeedback({
            action: 'correct',
            event_id: 'kev_decision_1',
            correction_event: correctionEvent()
        })).rejects.toMatchObject({ code: 'knowledge_graph_update_missing' });

        expect(harness.tx.appendFeedback).not.toHaveBeenCalled();
    });

    it('rejectは同一transactionで旧event/candidate/Graphをretractedにして通常検索から外し出典を監査に残す', async () => {
        const harness = createCycleTransitionHarness();
        const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

        await harness.service.recordFeedback({
            action: 'reject',
            event_id: 'kev_decision_1',
            reason: '決定ではなく提案だった'
        }, { access });

        expect(harness.candidateRepository.updateSemanticState).toHaveBeenCalledWith(
            'cand_decision_1',
            'retracted',
            expect.objectContaining({ client: harness.client })
        );
        expect(harness.graphRepository.retractDecision).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'decision_pricing_2026', event_id: 'kev_decision_1' }),
            expect.objectContaining({ client: harness.client, access })
        );
        expect(harness.tx.appendFeedback).toHaveBeenCalledWith(expect.objectContaining({
            source_pointer: harness.currentEvent.source_pointer
        }));
        expect(harness.state).toEqual({
            candidateSemantic: 'retracted',
            graphSemantic: 'retracted',
            graphSearchable: false
        });
    });

    it('retract対象Graphが0件ならtransaction全体を失敗にする', async () => {
        const harness = createCycleTransitionHarness();
        harness.graphRepository.retractDecision.mockResolvedValueOnce(null);

        await expect(harness.service.recordFeedback({
            action: 'reject',
            event_id: 'kev_decision_1',
            reason: '誤登録'
        })).rejects.toMatchObject({ code: 'knowledge_graph_update_missing' });

        expect(harness.tx.appendFeedback).not.toHaveBeenCalled();
    });
});
