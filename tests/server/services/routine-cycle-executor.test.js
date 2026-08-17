import { describe, expect, it, vi } from 'vitest';

import { RoutineCycleExecutor } from '../../../server/services/routine-runtime/cycle-executor.js';

describe('RoutineCycleExecutor', () => {
    it.each([
        ['completed', []],
        ['partial', [{ code: 'knowledge_retrievability_unconfirmed' }]]
    ])('共通結果は%sのsummary・coverage・成果物内異常をaccepted spec形式で返す', async (status, anomalies) => {
        const retrievable = status === 'completed' ? true : undefined;
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: {
                reconcile: vi.fn(async () => ({
                    unprocessed_count: 0,
                    contradiction_count: 0,
                    expired_count: 0,
                    outbox_count: 0
                }))
            },
            episodeCompressor: { compress: vi.fn(async () => ({ episode_ids: [], confirmed: true })) },
            retrievabilityVerifier: { verify: vi.fn(async () => ({ retrievable })) }
        });

        const result = await executor.execute({ routine: 'oyasumi' });

        expect(result).toMatchObject({
            status,
            coverage: 'partial',
            summary: {
                routine: 'oyasumi',
                status,
                anomaly_count: anomalies.length
            },
            artifacts: {
                routine_summary: {
                    routine: 'oyasumi',
                    status,
                    anomaly_count: anomalies.length
                },
                anomalies
            }
        });
        expect(result.artifacts).not.toBeInstanceOf(Array);
    });

    it('認証contextをoyasumiの全portへ伝播する', async () => {
        const context = {
            access: { personId: 'routine-worker', projectCodes: ['brainbase'], role: 'member' },
            actor: { person_id: 'routine-worker', role: 'member' },
            external_run_id: 'thread-context-oyasumi'
        };
        const oyasumiReconciler = {
            reconcile: vi.fn(async () => ({
                unprocessed_count: 0,
                contradiction_count: 0,
                expired_count: 0,
                outbox_count: 0
            }))
        };
        const episodeCompressor = { compress: vi.fn(async () => ({ episode_ids: [], confirmed: true })) };
        const retrievabilityVerifier = { verify: vi.fn(async () => ({ retrievable: true })) };
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler,
            episodeCompressor,
            retrievabilityVerifier
        });

        await executor.execute({ routine: 'oyasumi', input: { project_id: 'brainbase' } }, context);

        expect(oyasumiReconciler.reconcile).toHaveBeenCalledWith(
            { input: { project_id: 'brainbase' } },
            context
        );
        expect(episodeCompressor.compress).toHaveBeenCalledWith(
            expect.objectContaining({ reconciliation: expect.any(Object) }),
            context
        );
        expect(retrievabilityVerifier.verify).toHaveBeenCalledWith(
            expect.objectContaining({ reconciliation: expect.any(Object), compression: expect.any(Object) }),
            context
        );
    });

    it('認証contextをohayoの想起・生成・feedbackを含む全portへ伝播する', async () => {
        const context = {
            access: { personId: 'routine-worker', projectCodes: ['brainbase'], role: 'member' },
            actor: { person_id: 'routine-worker', role: 'member' },
            external_run_id: 'thread-context-ohayo'
        };
        const livenessService = { listExceptions: vi.fn(async () => []) };
        const recallService = {
            recallGraph: vi.fn(async () => [{ id: 'event-graph-1' }]),
            recallPersonalKg: vi.fn(async () => [{ id: 'event-personal-1' }])
        };
        const ohayoGenerator = {
            generate: vi.fn(async () => ({ used_knowledge_ids: ['event-graph-1'] }))
        };
        const feedbackService = { recordUsage: vi.fn(async () => ({})) };
        const executor = new RoutineCycleExecutor({
            livenessService,
            recallService,
            ohayoGenerator,
            feedbackService
        });

        await executor.execute({ routine: 'ohayo', input: { project_id: 'brainbase' } }, context);

        expect(livenessService.listExceptions).toHaveBeenCalledWith({ limit: 3 }, context);
        expect(recallService.recallGraph).toHaveBeenCalledWith(
            { input: { project_id: 'brainbase' } },
            context
        );
        expect(recallService.recallPersonalKg).toHaveBeenCalledWith(
            { input: { project_id: 'brainbase' } },
            context
        );
        expect(ohayoGenerator.generate).toHaveBeenCalledWith(expect.any(Object), context);
        expect(feedbackService.recordUsage).toHaveBeenCalledWith(
            { knowledge_id: 'event-graph-1', outcome: 'used', routine: 'ohayo' },
            context
        );
    });

    it('認証contextをretroの評価・候補作成portへ伝播する', async () => {
        const context = {
            access: { personId: 'routine-worker', projectCodes: ['brainbase'], role: 'member' },
            actor: { person_id: 'routine-worker', role: 'member' },
            external_run_id: 'thread-context-retro'
        };
        const metrics = {
            misregistration_rate: 0,
            correction_rate: 0,
            open_contradictions: 0,
            processing_time_ms: 0,
            stoppage_count: 0
        };
        const retroService = {
            evaluateMetrics: vi.fn(async () => metrics),
            createImprovementCandidates: vi.fn(async () => [])
        };
        const executor = new RoutineCycleExecutor({ retroService });

        await executor.execute({ routine: 'retro', input: { project_id: 'brainbase' } }, context);

        expect(retroService.evaluateMetrics).toHaveBeenCalledWith(
            { metrics: expect.any(Array), input: { project_id: 'brainbase' } },
            context
        );
        expect(retroService.createImprovementCandidates).toHaveBeenCalledWith(
            { metrics, limit: 3, output: 'story_pr' },
            context
        );
    });

    it('oyasumiは照合→Episode圧縮→検索可能性確認の順に実行し、検索不能をpartialにする', async () => {
        const callOrder = [];
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: { reconcile: vi.fn(async () => { callOrder.push('reconcile'); return { pending: 0 }; }) },
            episodeCompressor: { compress: vi.fn(async () => { callOrder.push('compress'); return { episode_ids: ['ep-1'], confirmed: true }; }) },
            retrievabilityVerifier: {
                verify: vi.fn(async () => {
                    callOrder.push('verifyRetrievability');
                    return { retrievable: false, missing_ids: ['ep-1'] };
                })
            }
        });

        const result = await executor.execute({ routine: 'oyasumi' });

        expect(callOrder).toEqual(['reconcile', 'compress', 'verifyRetrievability']);
        expect(result).toMatchObject({
            status: 'partial',
            anomalies: [{ code: 'knowledge_not_retrievable', knowledge_ids: ['ep-1'] }]
        });
    });

    it.each([
        ['unprocessed_count', undefined],
        ['unprocessed_count', null],
        ['contradiction_count', undefined],
        ['contradiction_count', null],
        ['expired_count', undefined],
        ['expired_count', null],
        ['outbox_count', undefined],
        ['outbox_count', null]
    ])('oyasumiの照合結果 %s=%s は未確認としてpartialにする', async (field, value) => {
        const reconciliation = {
            unprocessed_count: 0,
            contradiction_count: 0,
            expired_count: 0,
            outbox_count: 0,
            [field]: value
        };
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: { reconcile: vi.fn(async () => reconciliation) },
            episodeCompressor: { compress: vi.fn(async () => ({ episode_ids: [], confirmed: true })) },
            retrievabilityVerifier: { verify: vi.fn(async () => ({ retrievable: true })) }
        });

        const result = await executor.execute({ routine: 'oyasumi' });

        expect(result).toMatchObject({
            status: 'partial',
            anomalies: [expect.objectContaining({ code: 'routine_metric_unconfirmed', field })]
        });
    });

    it('oyasumiの照合件数がすべて0でも確認済みならcompletedにする', async () => {
        const episodeCompressor = { compress: vi.fn(async () => ({ episode_ids: [], confirmed: true })) };
        const retrievabilityVerifier = { verify: vi.fn(async () => ({ retrievable: true })) };
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: {
                reconcile: vi.fn(async () => ({
                    unprocessed_count: 0,
                    contradiction_count: 0,
                    expired_count: 0,
                    outbox_count: 0
                }))
            },
            episodeCompressor,
            retrievabilityVerifier
        });

        const result = await executor.execute({ routine: 'oyasumi' });

        expect(result.status).toBe('completed');
        expect(episodeCompressor.compress).toHaveBeenCalledOnce();
        expect(retrievabilityVerifier.verify).toHaveBeenCalledOnce();
    });

    it('oyasumiは未配信Outboxが残っていればpartialにする', async () => {
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: {
                reconcile: vi.fn(async () => ({
                    unprocessed_count: 0,
                    contradiction_count: 0,
                    expired_count: 0,
                    outbox_count: 2
                })),
                buildNightOutput: vi.fn(async () => ({
                    headline: '残件を確認してから今日を閉じる',
                    carryovers: [{ summary: '未配信が2件あります' }]
                }))
            },
            episodeCompressor: { compress: vi.fn(async () => ({ episode_ids: [], confirmed: true })) },
            retrievabilityVerifier: { verify: vi.fn(async () => ({ retrievable: true })) }
        });

        const result = await executor.execute({ routine: 'oyasumi' });

        expect(result).toMatchObject({
            status: 'partial',
            coverage: 'partial',
            anomalies: [{ code: 'routine_outbox_carryover', count: 2 }],
            routine_summary: {
                coverage: 'partial',
                routine_output: {
                    headline: '残件を確認してから今日を閉じる',
                    carryovers: [{ summary: '未配信が2件あります' }]
                }
            }
        });
    });

    it('oyasumiの照合結果が全欠落なら未確認としてpartialにする', async () => {
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: { reconcile: vi.fn(async () => ({})) },
            episodeCompressor: { compress: vi.fn(async () => ({ episode_ids: [], confirmed: true })) },
            retrievabilityVerifier: { verify: vi.fn(async () => ({ retrievable: true })) }
        });

        const result = await executor.execute({ routine: 'oyasumi' });

        expect(result).toMatchObject({
            status: 'partial',
            routine_summary: { status: 'partial' },
            coverage: 'partial',
            anomalies: expect.arrayContaining([
                expect.objectContaining({ code: 'routine_metric_unconfirmed', field: 'unprocessed_count' })
            ])
        });
    });

    it('oyasumiの検索可能性確認結果がundefinedなら成功へ潰さない', async () => {
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: {
                reconcile: vi.fn(async () => ({
                    unprocessed_count: 0,
                    contradiction_count: 0,
                    expired_count: 0,
                    outbox_count: 0
                }))
            },
            episodeCompressor: { compress: vi.fn(async () => ({ episode_ids: [], confirmed: true })) },
            retrievabilityVerifier: { verify: vi.fn(async () => undefined) }
        });

        await expect(executor.execute({ routine: 'oyasumi' })).resolves.toMatchObject({
            status: 'partial',
            anomalies: [{ code: 'knowledge_retrievability_unconfirmed' }]
        });
    });

    it('oyasumiのEpisode圧縮が未実装・未確定なら検索可能でもpartialにする', async () => {
        const retrievabilityVerifier = { verify: vi.fn(async () => ({ retrievable: true })) };
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: {
                reconcile: vi.fn(async () => ({
                    unprocessed_count: 0,
                    contradiction_count: 0,
                    expired_count: 0,
                    outbox_count: 0
                }))
            },
            episodeCompressor: {
                compress: vi.fn(async () => ({
                    episode_ids: ['episode-1'],
                    confirmed: false,
                    reason: 'episode_compressor_unavailable'
                }))
            },
            retrievabilityVerifier
        });

        await expect(executor.execute({ routine: 'oyasumi' })).resolves.toMatchObject({
            status: 'partial',
            anomalies: [{ code: 'episode_compression_unconfirmed' }]
        });
        expect(retrievabilityVerifier.verify).not.toHaveBeenCalled();
    });

    it('ohayoは例外を最大3件取得しGraphとPersonal KGを想起して、使用した知識だけを再固定する', async () => {
        const livenessService = { listExceptions: vi.fn(async () => []) };
        const recallService = {
            recallGraph: vi.fn(async () => [
                { id: 'graph-1', payload: { derived_from_event_id: 'kev_graph_1' } },
                { id: 'graph-unused', payload: { derived_from_event_id: 'kev_graph_unused' } }
            ]),
            recallPersonalKg: vi.fn(async () => [{ id: 'personal-1', source_event_ids: ['kev_personal_1'] }])
        };
        const feedbackService = { recordUsage: vi.fn(async () => {}) };
        const ohayoGenerator = {
            generate: vi.fn(async () => ({
                used_knowledge_ids: ['kev_graph_1', 'kev_personal_1', 'kev_not_recalled']
            }))
        };
        const executor = new RoutineCycleExecutor({ livenessService, recallService, feedbackService, ohayoGenerator });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(livenessService.listExceptions).toHaveBeenCalledWith({ limit: 3 });
        expect(recallService.recallGraph).toHaveBeenCalledOnce();
        expect(recallService.recallPersonalKg).toHaveBeenCalledOnce();
        expect(ohayoGenerator.generate).toHaveBeenCalledWith(expect.objectContaining({
            exceptions: [],
            graph_memories: [
                { id: 'graph-1', payload: { derived_from_event_id: 'kev_graph_1' } },
                { id: 'graph-unused', payload: { derived_from_event_id: 'kev_graph_unused' } }
            ],
            personal_memories: [{ id: 'personal-1', source_event_ids: ['kev_personal_1'] }]
        }));
        expect(feedbackService.recordUsage.mock.calls.map(([input]) => input.knowledge_id)).toEqual([
            'kev_graph_1',
            'kev_personal_1'
        ]);
        expect(result.status).toBe('completed');
    });

    it('ohayoはcallerのdisplayed申告をgeneratorへ渡さず、生成器が選んだ朝出力だけを返す', async () => {
        const feedbackService = { recordUsage: vi.fn(async () => {}) };
        const ohayoGenerator = {
            generate: vi.fn(async () => ({
                displayed_memory_ids: ['graph-selected'],
                used_knowledge_ids: ['kev_graph_selected'],
                morning_output: {
                    exceptions: [{ code: 'routine_stopped' }],
                    memories: [{ summary: '今日使う判断' }]
                }
            }))
        };
        const executor = new RoutineCycleExecutor({
            livenessService: {
                listExceptions: vi.fn(async () => [
                    { code: 'routine_stopped' }, { code: 'two' }, { code: 'three' }, { code: 'four' }
                ])
            },
            recallService: {
                recallGraph: vi.fn(async () => [{
                    id: 'graph-selected', payload: { derived_from_event_id: 'kev_graph_selected' }
                }, {
                    id: 'graph-unused', payload: { derived_from_event_id: 'kev_graph_unused' }
                }]),
                recallPersonalKg: vi.fn(async () => [])
            },
            ohayoGenerator,
            feedbackService
        });

        const result = await executor.execute({
            routine: 'ohayo',
            input: { displayed_memory_ids: ['graph-unused'] }
        });

        expect(ohayoGenerator.generate).toHaveBeenCalledWith(expect.not.objectContaining({
            displayed_memory_ids: expect.anything()
        }));
        expect(feedbackService.recordUsage).toHaveBeenCalledTimes(1);
        expect(feedbackService.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
            knowledge_id: 'kev_graph_selected'
        }));
        expect(result).toMatchObject({
            status: 'completed',
            used_knowledge_ids: ['kev_graph_selected'],
            morning_output: {
                exceptions: [{ code: 'routine_stopped' }],
                memories: [{ summary: '今日使う判断' }]
            }
        });
        expect(result.used_knowledge_ids).not.toContain('kev_graph_unused');
    });

    it('ohayoの使用結果記録失敗は成功へ潰さずpartialにする', async () => {
        const executor = new RoutineCycleExecutor({
            livenessService: { listExceptions: vi.fn(async () => []) },
            recallService: {
                recallGraph: vi.fn(async () => [{
                    id: 'graph-1', payload: { derived_from_event_id: 'kev_graph_1' }
                }]),
                recallPersonalKg: vi.fn(async () => [])
            },
            ohayoGenerator: { generate: vi.fn(async () => ({ used_knowledge_ids: ['kev_graph_1'] })) },
            feedbackService: { recordUsage: vi.fn(async () => { throw new Error('feedback unavailable'); }) }
        });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(result).toMatchObject({
            status: 'partial',
            anomalies: [{ code: 'knowledge_feedback_failed', knowledge_id: 'kev_graph_1' }]
        });
    });

    it('ohayoは表示済み正式source eventだけをfeedbackし、記録不能をpartialにする', async () => {
        const feedbackService = {
            recordUsage: vi.fn(async ({ knowledge_id: knowledgeId }) => {
                if (knowledgeId === 'kev_personal_formal') throw new Error('feedback unavailable');
            })
        };
        const executor = new RoutineCycleExecutor({
            livenessService: { listExceptions: vi.fn(async () => []) },
            recallService: {
                recallGraph: vi.fn(async () => [{
                    id: 'graph-entity-1',
                    payload: { derived_from_event_id: 'kev_graph_formal' }
                }]),
                recallPersonalKg: vi.fn(async () => [{
                    id: 'candidate-1',
                    source_event_ids: ['kev_personal_formal', 'legacy-row-1']
                }])
            },
            ohayoGenerator: {
                generate: vi.fn(async () => ({
                    used_knowledge_ids: [
                        'kev_graph_formal',
                        'kev_personal_formal',
                        'legacy-row-1',
                        'kev_not_displayed'
                    ]
                }))
            },
            feedbackService
        });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(feedbackService.recordUsage.mock.calls.map(([input]) => input.knowledge_id)).toEqual([
            'kev_graph_formal',
            'kev_personal_formal'
        ]);
        expect(result).toMatchObject({
            status: 'partial',
            used_knowledge_ids: ['kev_graph_formal', 'kev_personal_formal'],
            anomalies: [{ code: 'knowledge_feedback_failed', knowledge_id: 'kev_personal_formal' }]
        });
    });

    it('ohayoはgraph/candidateのitem IDをfeedbackへ渡さずformal kev_* source event IDだけを許可する', async () => {
        const feedbackService = { recordUsage: vi.fn(async () => {}) };
        const executor = new RoutineCycleExecutor({
            livenessService: { listExceptions: vi.fn(async () => []) },
            recallService: {
                recallGraph: vi.fn(async () => [{
                    id: 'graph-entity-1', payload: { derived_from_event_id: 'kev_graph_formal' }
                }]),
                recallPersonalKg: vi.fn(async () => [{
                    id: 'candidate-1', source_event_ids: ['legacy-event-1', 'kev_personal_formal']
                }])
            },
            ohayoGenerator: {
                generate: vi.fn(async () => ({
                    used_knowledge_ids: [
                        'graph-entity-1',
                        'candidate-1',
                        'legacy-event-1',
                        'kev_graph_formal',
                        'kev_personal_formal'
                    ],
                    morning_output: { exceptions: [], memories: [] }
                }))
            },
            feedbackService
        });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(feedbackService.recordUsage.mock.calls.map(([input]) => input.knowledge_id)).toEqual([
            'kev_graph_formal',
            'kev_personal_formal'
        ]);
        expect(result.used_knowledge_ids).toEqual(['kev_graph_formal', 'kev_personal_formal']);
        expect(JSON.stringify(feedbackService.recordUsage.mock.calls)).not.toContain('graph-entity-1');
        expect(JSON.stringify(feedbackService.recordUsage.mock.calls)).not.toContain('candidate-1');
        expect(JSON.stringify(feedbackService.recordUsage.mock.calls)).not.toContain('legacy-event-1');
    });

    it('ohayo結果は表示最大3件の安全なsummaryだけでrecall全件とgenerator内部配列を返さない', async () => {
        const executor = new RoutineCycleExecutor({
            livenessService: { listExceptions: vi.fn(async () => [
                { code: 'one', summary: '例外1', absolute_path: '/secret/one.json' },
                { code: 'two', summary: '例外2' },
                { code: 'three', summary: '例外3' },
                { code: 'four', summary: '例外4' }
            ]) },
            recallService: {
                recallGraph: vi.fn(async () => [{
                    id: 'graph-1', payload: { derived_from_event_id: 'kev_graph_1', secret: 'raw-recall-secret' }
                }]),
                recallPersonalKg: vi.fn(async () => [])
            },
            ohayoGenerator: {
                generate: vi.fn(async () => ({
                    used_knowledge_ids: ['kev_graph_1'],
                    recalled_memory_ids: ['graph-1', 'graph-2', 'graph-3', 'graph-4'],
                    graph_memories: [{ id: 'graph-1', body: 'raw-generated-secret' }],
                    morning_output: {
                        exceptions: [
                            { code: 'one', summary: '例外1', absolute_path: '/secret/one.json' },
                            { code: 'two', summary: '例外2' },
                            { code: 'three', summary: '例外3' },
                            { code: 'four', summary: '例外4' }
                        ],
                        memories: [
                            { id: 'graph-1', summary: '判断1', payload: { secret: 'raw-memory-1' } },
                            { id: 'graph-2', summary: '判断2' },
                            { id: 'graph-3', summary: '判断3' },
                            { id: 'graph-4', summary: '判断4' }
                        ]
                    }
                }))
            },
            feedbackService: { recordUsage: vi.fn(async () => {}) }
        });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(result).not.toHaveProperty('recalled');
        expect(result).not.toHaveProperty('generated');
        expect(result.morning_output).toEqual({
            exceptions: [
                { code: 'one', summary: '例外1' },
                { code: 'two', summary: '例外2' },
                { code: 'three', summary: '例外3' }
            ],
            memories: [{ summary: '判断1' }, { summary: '判断2' }, { summary: '判断3' }]
        });
        expect(JSON.stringify(result)).not.toContain('raw-recall-secret');
        expect(JSON.stringify(result)).not.toContain('raw-generated-secret');
        expect(JSON.stringify(result)).not.toContain('raw-memory-1');
        expect(JSON.stringify(result)).not.toContain('/secret/one.json');
        expect(JSON.stringify(result)).not.toContain('判断4');
    });

    it('ohayoはjudgment knowledge event Outboxをproduction deliveryへ接続する', async () => {
        const context = {
            access: { personId: 'routine-worker', projectCodes: ['brainbase'], role: 'member' },
            actor: { person_id: 'routine-worker' },
            external_run_id: 'thread-delivery'
        };
        const judgmentOutboxDeliveryService = {
            deliverPending: vi.fn(async () => ({ status: 'processed', delivered: 1, pending: 0 }))
        };
        const executor = new RoutineCycleExecutor({
            judgmentOutboxDeliveryService,
            livenessService: { listExceptions: vi.fn(async () => []) },
            recallService: {
                recallGraph: vi.fn(async () => []),
                recallPersonalKg: vi.fn(async () => [])
            },
            ohayoGenerator: { generate: vi.fn(async () => ({ used_knowledge_ids: [] })) },
            feedbackService: { recordUsage: vi.fn(async () => {}) }
        });

        const result = await executor.execute({ routine: 'ohayo', input: { project_id: 'brainbase' } }, context);

        expect(judgmentOutboxDeliveryService.deliverPending).toHaveBeenCalledWith(context);
        expect(result).toMatchObject({
            status: 'completed',
            judgment_outbox_delivery: { status: 'processed', delivered: 1, pending: 0 }
        });
    });

    it('ohayoは隔離済みknowledge eventを警告表示しpartialにする', async () => {
        const executor = new RoutineCycleExecutor({
            livenessService: {
                listExceptions: vi.fn(async () => [{ code: 'knowledge_event_dead_letter' }])
            },
            recallService: {
                recallGraph: vi.fn(async () => []),
                recallPersonalKg: vi.fn(async () => [])
            },
            ohayoGenerator: {
                generate: vi.fn(async () => ({
                    used_knowledge_ids: [],
                    morning_output: { routine_output: { warnings: [] } }
                }))
            },
            feedbackService: { recordUsage: vi.fn(async () => {}) }
        });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(result).toMatchObject({
            status: 'partial',
            coverage: 'partial',
            anomalies: [{ code: 'routine_liveness_exception', source_code: 'knowledge_event_dead_letter' }],
            routine_summary: {
                routine_output: {
                    warnings: [{ summary: '判断の知識化に失敗し、隔離された項目があります' }]
                }
            }
        });
    });

    it.each([
        [
            'unavailable',
            { status: 'unavailable', delivered: 0, failed: 0, retryable: 0, dead_lettered: 0, pending: 0 },
            'judgment_outbox_delivery_unavailable'
        ],
        [
            'failed',
            { status: 'processed', delivered: 0, failed: 1, retryable: 0, dead_lettered: 0, pending: 0 },
            'judgment_outbox_delivery_failed'
        ],
        [
            'retryable',
            { status: 'processed', delivered: 0, failed: 0, retryable: 1, dead_lettered: 0, pending: 0 },
            'judgment_outbox_delivery_retryable'
        ],
        [
            'pending',
            { status: 'processed', delivered: 0, failed: 0, retryable: 0, dead_lettered: 0, pending: 1 },
            'judgment_outbox_delivery_pending'
        ],
        [
            'dead-letter priority',
            { status: 'unavailable', delivered: 0, failed: 2, retryable: 1, dead_lettered: 1, pending: 3 },
            'judgment_outbox_dead_lettered'
        ]
    ])('ohayoはjudgment outbox %sをpartialにして警告を表示する', async (_case, delivery, anomalyCode) => {
        const executor = new RoutineCycleExecutor({
            judgmentOutboxDeliveryService: { deliverPending: vi.fn(async () => delivery) },
            livenessService: { listExceptions: vi.fn(async () => []) },
            recallService: {
                recallGraph: vi.fn(async () => []),
                recallPersonalKg: vi.fn(async () => [])
            },
            ohayoGenerator: { generate: vi.fn(async () => ({ used_knowledge_ids: [], morning_output: {} })) },
            feedbackService: { recordUsage: vi.fn(async () => {}) }
        });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(result).toMatchObject({
            status: 'partial',
            coverage: 'partial',
            anomalies: [expect.objectContaining({ code: anomalyCode })],
            routine_summary: {
                coverage: 'partial',
                routine_output: {
                    warnings: [expect.objectContaining({ summary: expect.any(String) })]
                }
            }
        });
    });

    it.each([
        ['misregistration_rate', undefined],
        ['misregistration_rate', null],
        ['correction_rate', undefined],
        ['correction_rate', null],
        ['open_contradictions', undefined],
        ['open_contradictions', null],
        ['processing_time_ms', undefined],
        ['processing_time_ms', null],
        ['stoppage_count', undefined],
        ['stoppage_count', null]
    ])('retroの指標 %s=%s は未確認としてpartialにする', async (field, value) => {
        const metrics = {
            misregistration_rate: 0,
            correction_rate: 0,
            open_contradictions: 0,
            processing_time_ms: 0,
            stoppage_count: 0,
            [field]: value
        };
        const retroService = {
            evaluateMetrics: vi.fn(async () => metrics),
            createImprovementCandidates: vi.fn(async () => [])
        };
        const executor = new RoutineCycleExecutor({ retroService });

        const result = await executor.execute({ routine: 'retro' });

        expect(result).toMatchObject({
            status: 'partial',
            anomalies: [expect.objectContaining({ code: 'routine_metric_unconfirmed', field })]
        });
        expect(retroService.createImprovementCandidates).not.toHaveBeenCalled();
    });

    it('retroの5指標がすべて0でも確認済みならcompletedにする', async () => {
        const metrics = {
            misregistration_rate: 0,
            correction_rate: 0,
            open_contradictions: 0,
            processing_time_ms: 0,
            stoppage_count: 0
        };
        const executor = new RoutineCycleExecutor({
            retroService: {
                evaluateMetrics: vi.fn(async () => metrics),
                createImprovementCandidates: vi.fn(async () => [])
            }
        });

        await expect(executor.execute({ routine: 'retro' })).resolves.toMatchObject({ status: 'completed' });
    });

    it('retroは5指標を評価しStory/PR候補を最大3件返すだけで本番状態を直接変更しない', async () => {
        const metrics = {
            misregistration_rate: 0.02,
            correction_rate: 0.1,
            open_contradictions: 2,
            processing_time_ms: 1200,
            stoppage_count: 1
        };
        const retroService = {
            evaluateMetrics: vi.fn(async () => metrics),
            createImprovementCandidates: vi.fn(async () => ['story-1', 'story-2', 'story-3', 'story-4']),
            applyPolicy: vi.fn(),
            updateSkill: vi.fn(),
            writeGraph: vi.fn()
        };
        const executor = new RoutineCycleExecutor({ retroService });

        const result = await executor.execute({ routine: 'retro' });

        expect(retroService.evaluateMetrics).toHaveBeenCalledWith({
            metrics: ['misregistration_rate', 'correction_rate', 'open_contradictions', 'processing_time_ms', 'stoppage_count']
        });
        expect(retroService.createImprovementCandidates).toHaveBeenCalledWith({ metrics, limit: 3, output: 'story_pr' });
        expect(result.improvement_candidates).toEqual(['story-1', 'story-2', 'story-3']);
        expect(retroService.applyPolicy).not.toHaveBeenCalled();
        expect(retroService.updateSkill).not.toHaveBeenCalled();
        expect(retroService.writeGraph).not.toHaveBeenCalled();
    });

    it('ohayoは今日の焦点を先頭にした密度差のあるroutine_outputを成果物へ残す', async () => {
        const executor = new RoutineCycleExecutor({
            livenessService: { listExceptions: vi.fn(async () => [{ code: 'carryover', summary: '昨日の持越し' }]) },
            recallService: {
                recallGraph: vi.fn(async () => [{ id: 'graph-1', source_event_id: 'kev_graph_1', name: '顧客Aの合意' }]),
                recallPersonalKg: vi.fn(async () => [{ id: 'personal-1', source_event_id: 'pke_personal_1', body: '午前は設計を優先する' }])
            },
            feedbackService: { recordUsage: vi.fn(async () => {}) },
            ohayoGenerator: {
                generate: vi.fn(async () => ({
                    used_knowledge_ids: ['kev_graph_1', 'pke_personal_1'],
                    morning_output: {
                        exceptions: [{ code: 'carryover', summary: '昨日の持越し' }],
                        memories: [{ summary: '顧客Aの合意' }],
                        routine_output: {
                            headline: '今日は顧客Aの設計判断を進める',
                            today_focus: [{ summary: '設計判断を確定する' }],
                            immediate_decisions: [{ summary: '午前中に論点を絞る' }],
                            warnings: [{ summary: '昨日の持越し' }],
                            carryovers: [],
                            references: [{ source: 'graph_ssot', summary: '顧客Aの合意' }]
                        }
                    }
                }))
            }
        });

        const result = await executor.execute({ routine: 'ohayo' });

        expect(result.routine_output).toMatchObject({
            headline: '今日は顧客Aの設計判断を進める',
            today_focus: [{ summary: '設計判断を確定する' }],
            warnings: [{ summary: '昨日の持越し' }]
        });
        expect(result.routine_summary.routine_output).toEqual(result.routine_output);
    });

    it('oyasumiはPersonal KG登録候補とGraph昇格レビュー待ちを混ぜない', async () => {
        const routineOutput = {
            headline: '今日は閉じてよい',
            tomorrow_focus: [{ summary: '朝一で提案を確定する' }],
            closed: [{ summary: '設計方針を決定した' }],
            carryovers: [],
            personal_kg_registration_candidates: [{ id: 'personal-draft-1', summary: '午前は設計を優先する' }],
            graph_promotion_reviews: [{ id: 'candidate-1', summary: '顧客Aの正式方針' }]
        };
        const executor = new RoutineCycleExecutor({
            oyasumiReconciler: {
                reconcile: vi.fn(async () => ({ unprocessed_count: 0, contradiction_count: 0, expired_count: 0, outbox_count: 0 })),
                buildNightOutput: vi.fn(async () => routineOutput)
            },
            episodeCompressor: { compress: vi.fn(async () => ({ confirmed: true, episode_ids: [] })) },
            retrievabilityVerifier: { verify: vi.fn(async () => ({ retrievable: true })) }
        });

        const result = await executor.execute({ routine: 'oyasumi' });

        expect(result.routine_output.personal_kg_registration_candidates).toEqual([
            { id: 'personal-draft-1', summary: '午前は設計を優先する' }
        ]);
        expect(result.routine_output.graph_promotion_reviews).toEqual([
            { id: 'candidate-1', summary: '顧客Aの正式方針' }
        ]);
    });

    it('retroは登録レビューとGraph昇格レビューを表示するだけで状態を変更しない', async () => {
        const metrics = {
            misregistration_rate: 0,
            correction_rate: 0,
            open_contradictions: 0,
            processing_time_ms: 0,
            stoppage_count: 0
        };
        const retroService = {
            evaluateMetrics: vi.fn(async () => metrics),
            createImprovementCandidates: vi.fn(async () => [{ kind: 'story_pr_candidate', metric: 'stoppage_count', applies_changes: false }]),
            listKnowledgeReviews: vi.fn(async () => ({
                personal_kg_registration_reviews: [{ id: 'personal-draft-1', summary: '個人の判断基準' }],
                graph_promotion_reviews: [{ id: 'candidate-1', summary: '組織の正式方針', status: 'pending_approval' }]
            })),
            approveCandidate: vi.fn(),
            promoteToGraph: vi.fn()
        };
        const executor = new RoutineCycleExecutor({ retroService });

        const result = await executor.execute({ routine: 'retro' });

        expect(result.routine_output).toMatchObject({
            personal_kg_registration_reviews: [{ id: 'personal-draft-1', summary: '個人の判断基準' }],
            graph_promotion_reviews: [{ id: 'candidate-1', summary: '組織の正式方針', status: 'pending_approval' }]
        });
        expect(result.routine_output.system_changes[0]).toMatchObject({ applies_changes: false });
        expect(retroService.approveCandidate).not.toHaveBeenCalled();
        expect(retroService.promoteToGraph).not.toHaveBeenCalled();
    });
});
