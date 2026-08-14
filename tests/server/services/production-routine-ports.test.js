import { describe, expect, it, vi } from 'vitest';

import { ProductionRoutinePorts } from '../../../server/services/routine-runtime/production-routine-ports.js';

const context = {
    access: {
        personId: 'routine-worker',
        organizationId: 'org:unson',
        projectCodes: ['brainbase'],
        role: 'member',
        clearance: ['internal']
    },
    actor: { person_id: 'routine-worker', role: 'member' },
    external_run_id: 'thread-production-ports'
};

function createPorts(overrides = {}) {
    const knowledgeEventRepository = {
        summarizeRoutineState: vi.fn(async () => ({
            unprocessed_count: 2,
            contradiction_count: 1,
            expired_count: 1,
            misregistration_rate: 0.1,
            correction_rate: 0.2,
            open_contradictions: 1,
            processing_time_ms: 900
        }))
    };
    const candidateRepository = {
        listPersonalKg: vi.fn(async () => [{ id: 'event-personal-1', body: 'personal memory' }]),
        list: vi.fn(async (filter) => filter.promotion_status === 'candidate' ? [{
            id: 'candidate-personal-1',
            body: '午前は設計を優先する',
            promotion_status: 'candidate'
        }] : [{
            id: 'candidate-graph-1',
            body: '顧客Aの正式方針',
            promotion_status: 'pending_approval'
        }])
    };
    const personalKnowledgeService = {
        summarizeRoutineState: vi.fn(async () => ({
            unprocessed_count: 0,
            contradiction_count: 0,
            expired_count: 0,
            episode_ids: ['personal-episode-1']
        })),
        compressRoutineEpisodes: vi.fn(async () => ({
            episode_ids: ['personal-episode-1'], confirmed: true
        })),
        verifyRoutineRetrievability: vi.fn(async () => ({ retrievable: true })),
        search: vi.fn(async () => [{
            event_id: 'pke_personal_1',
            body: 'personal memory'
        }]),
        recordUsage: vi.fn(async () => ({ event_id: 'pke_personal_1', outcome: 'used' }))
    };
    const infoSSOTService = {
        listGraphEntities: vi.fn(async () => [{ id: 'event-graph-1', name: 'graph memory' }])
    };
    const runReceiptQueryService = {
        summarizeRoutineState: vi.fn(async () => ({ outbox_count: 2, stoppage_count: 3 }))
    };
    const listJudgmentOutboxExceptions = vi.fn(async () => [{
        code: 'knowledge_event_outbox',
        event_id: 'event-outbox-1'
    }]);
    const knowledgeFeedbackService = { recordFeedback: vi.fn(async () => ({ action: 'adopt' })) };
    const dependencies = {
        knowledgeEventRepository,
        candidateRepository,
        personalKnowledgeService,
        infoSSOTService,
        runReceiptQueryService,
        listJudgmentOutboxExceptions,
        knowledgeFeedbackService,
        ...overrides
    };
    return { dependencies, ports: new ProductionRoutinePorts(dependencies) };
}

describe('ProductionRoutinePorts', () => {
    it('依存未設定でserver起動を止めず、実行時に利用不能を明示する', async () => {
        const { knowledgeFeedbackService: _omitted, ...dependencies } = createPorts().dependencies;

        const ports = new ProductionRoutinePorts({
            ...dependencies,
            knowledgeEventRepository: null,
            candidateRepository: null,
            infoSSOTService: null
        });

        await expect(ports.recordUsage({ knowledge_id: 'kev_unavailable' }, context))
            .rejects.toMatchObject({ code: 'routine_dependency_unavailable' });
        await expect(ports.recallGraph({ input: { project_id: 'brainbase' } }, context))
            .rejects.toMatchObject({ code: 'routine_dependency_unavailable' });
    });

    it('oyasumiは組織イベントとPersonal Vaultを別々に照合し、集計値だけを合算する', async () => {
        const { dependencies, ports } = createPorts();

        await expect(ports.reconcile({ input: { project_id: 'brainbase' } }, context)).resolves.toEqual({
            unprocessed_count: 2,
            contradiction_count: 1,
            expired_count: 1,
            outbox_count: 3,
            organization_episode_ids: [],
            personal_episode_ids: ['personal-episode-1']
        });
        expect(dependencies.knowledgeEventRepository.summarizeRoutineState).toHaveBeenCalledWith(
            { project_id: 'brainbase' },
            context
        );
        expect(dependencies.personalKnowledgeService.summarizeRoutineState).toHaveBeenCalledWith(
            { project_id: 'brainbase' },
            { access: context.access }
        );
        expect(dependencies.runReceiptQueryService.summarizeRoutineState).toHaveBeenCalledWith(
            { project_id: 'brainbase' },
            context
        );
        expect(dependencies.listJudgmentOutboxExceptions).toHaveBeenCalledWith(context);
    });

    it('oyasumiの取得不能を0件へ潰さずpartial用の未確認値として返す', async () => {
        const { ports } = createPorts({
            knowledgeEventRepository: {
                summarizeRoutineState: vi.fn(async () => { throw new Error('knowledge repository unavailable'); })
            }
        });

        await expect(ports.reconcile({ input: { project_id: 'brainbase' } }, context)).resolves.toMatchObject({
            unprocessed_count: null,
            contradiction_count: null,
            expired_count: null,
            anomalies: [expect.objectContaining({ code: 'routine_source_unavailable' })]
        });
    });

    it('oyasumiは実queryが空を返した場合だけ確認済み0件を返す', async () => {
        const { ports } = createPorts({
            knowledgeEventRepository: {
                summarizeRoutineState: vi.fn(async () => ({
                    unprocessed_count: 0,
                    contradiction_count: 0,
                    expired_count: 0
                }))
            },
            runReceiptQueryService: {
                summarizeRoutineState: vi.fn(async () => ({ outbox_count: 0, stoppage_count: 0 }))
            },
            listJudgmentOutboxExceptions: vi.fn(async () => [])
        });

        await expect(ports.reconcile({ input: { project_id: 'brainbase' } }, context)).resolves.toMatchObject({
            unprocessed_count: 0,
            contradiction_count: 0,
            expired_count: 0,
            outbox_count: 0
        });
    });

    it('oyasumiは残件と登録先を分けた夜の結論を作る', async () => {
        const { ports } = createPorts();

        await expect(ports.buildNightOutput({
            input: {
                tomorrow_focus: [{ summary: '朝一で提案を確定する' }],
                personal_kg_registration_candidates: [{ id: 'personal-1', summary: '午前は設計を優先する' }],
                graph_promotion_reviews: [{ id: 'graph-1', summary: '顧客Aの正式方針' }]
            },
            reconciliation: { unprocessed_count: 1, contradiction_count: 0, expired_count: 0, outbox_count: 0 }
        }, context)).resolves.toMatchObject({
            headline: '残件を確認してから今日を閉じる',
            carryovers: [{ summary: '未処理が1件あります' }],
            personal_kg_registration_candidates: [
                { id: 'personal-1', summary: '午前は設計を優先する' },
                { id: 'candidate-personal-1', status: 'candidate', summary: '午前は設計を優先する' }
            ],
            graph_promotion_reviews: [
                { id: 'graph-1', summary: '顧客Aの正式方針' },
                { id: 'candidate-graph-1', status: 'pending_approval', summary: '顧客Aの正式方針' }
            ]
        });
    });

    it('ohayoはInfoSSOT Graphと認証本人のPersonal Vaultだけを想起する', async () => {
        const { dependencies, ports } = createPorts();

        await expect(ports.recallGraph({ input: { project_id: 'brainbase', query: 'today' } }, context))
            .resolves.toEqual([{ id: 'event-graph-1', name: 'graph memory' }]);
        await expect(ports.recallPersonalKg({ input: { project_id: 'brainbase', query: 'today' } }, context))
            .resolves.toEqual([{
                id: 'pke_personal_1',
                event_id: 'pke_personal_1',
                source_knowledge_event_id: 'pke_personal_1',
                body: 'personal memory'
            }]);
        expect(dependencies.infoSSOTService.listGraphEntities).toHaveBeenCalledWith(
            context.access,
            expect.objectContaining({ projectCode: 'brainbase', query: 'today' })
        );
        expect(dependencies.personalKnowledgeService.search).toHaveBeenCalledWith(
            { query: 'today', limit: 50 },
            { access: context.access }
        );
        expect(dependencies.candidateRepository.listPersonalKg).not.toHaveBeenCalled();
    });

    it('ohayoは固定owner設定を使わず、認証された本人・組織をPersonal Vaultへ渡す', async () => {
        const { dependencies } = createPorts();
        const ports = new ProductionRoutinePorts({
            ...dependencies,
            personalKgOwnerPersonId: 'per_canonical_sato'
        });
        const restrictedContext = {
            ...context,
            access: { ...context.access, role: 'gm', clearance: ['internal', 'restricted'] }
        };

        await ports.recallPersonalKg({ input: { project_id: 'brainbase' } }, restrictedContext);

        expect(dependencies.personalKnowledgeService.search).toHaveBeenCalledWith(
            { query: undefined, limit: 50 },
            { access: restrictedContext.access }
        );
        expect(dependencies.candidateRepository.listPersonalKg).not.toHaveBeenCalled();
    });

    it('Personal Vault読取りフラグを無効化した場合だけ旧Candidate投影へ戻す', async () => {
        const { dependencies } = createPorts();
        const ports = new ProductionRoutinePorts({
            ...dependencies,
            personalVaultReadEnabled: false
        });

        await expect(ports.recallPersonalKg({
            input: { project_id: 'brainbase', query: 'legacy fallback' }
        }, context)).resolves.toEqual([{ id: 'event-personal-1', body: 'personal memory' }]);
        expect(dependencies.candidateRepository.listPersonalKg).toHaveBeenCalledWith({
            project_code: 'brainbase',
            owner_person_id: 'routine-worker',
            role: 'member',
            clearance: ['internal'],
            query: 'legacy fallback',
            limit: 50
        }, context);
        expect(dependencies.personalKnowledgeService.search).not.toHaveBeenCalled();

        await ports.reconcile({ input: { project_id: 'brainbase' } }, context);
        expect(dependencies.personalKnowledgeService.summarizeRoutineState).not.toHaveBeenCalled();
    });

    it('ohayoで出力に使ったevent IDをKnowledgeFeedbackServiceへ記録する', async () => {
        const { dependencies, ports } = createPorts();

        await ports.recordUsage({ knowledge_id: 'event-graph-1' }, context);

        expect(dependencies.knowledgeFeedbackService.recordFeedback).toHaveBeenCalledWith({
            event_id: 'event-graph-1',
            action: 'adopt',
            reason: 'used_by_ohayo'
        }, { access: context.access });
    });

    it('ohayoで使ったPersonal Vault event IDは個人履歴へ記録し組織feedbackへ送らない', async () => {
        const { dependencies, ports } = createPorts();

        await ports.recordUsage({ knowledge_id: 'pke_personal_1' }, context);

        expect(dependencies.personalKnowledgeService.recordUsage).toHaveBeenCalledWith(
            'pke_personal_1',
            { access: context.access }
        );
        expect(dependencies.knowledgeFeedbackService.recordFeedback).not.toHaveBeenCalled();
    });

    it('ohayo generator自身が朝出力へ含める最大3記憶を選びsource event IDへ写像する', async () => {
        const { ports } = createPorts();
        const graphMemories = [
            { id: 'graph-entity-1', source_event_id: 'kev_graph_selected', name: '表示対象' },
            { id: 'graph-entity-2', source_event_id: 'kev_graph_selected_2', name: '表示対象2' },
            { id: 'graph-entity-3', source_event_id: 'kev_graph_selected_3', name: '表示対象3' },
            { id: 'graph-entity-4', source_event_id: 'kev_graph_recalled_only', name: '想起のみ' }
        ];
        const personalMemories = [
            {
                id: 'candidate-1',
                source_event_ids: ['meeting-raw-1', 'kev_personal_recalled_only'],
                body: '想起のみ'
            }
        ];

        await expect(ports.generate({
            exceptions: [{ code: 'first' }, { code: 'second' }, { code: 'third' }, { code: 'fourth' }],
            graph_memories: graphMemories,
            personal_memories: personalMemories,
            displayed_memory_ids: ['graph-entity-4', 'candidate-1']
        }, context)).resolves.toMatchObject({
            recalled_memory_ids: [
                'graph-entity-1', 'graph-entity-2', 'graph-entity-3', 'graph-entity-4', 'candidate-1'
            ],
            displayed_memory_ids: ['graph-entity-1', 'graph-entity-2', 'graph-entity-3'],
            used_knowledge_ids: ['kev_graph_selected', 'kev_graph_selected_2', 'kev_graph_selected_3'],
            morning_output: {
                exceptions: [{ code: 'first' }, { code: 'second' }, { code: 'third' }],
                memories: [
                    { summary: '表示対象' },
                    { summary: '表示対象2' },
                    { summary: '表示対象3' }
                ]
            }
        });
    });

    it('ohayoの人間向け出力は最大3件の安全なsummaryだけでrecall recordを複製しない', async () => {
        const { ports } = createPorts();
        const result = await ports.generate({
            exceptions: [
                { code: 'one', summary: '例外1', absolute_path: '/secret/one.json' },
                { code: 'two', summary: '例外2' },
                { code: 'three', summary: '例外3' },
                { code: 'four', summary: '例外4' }
            ],
            graph_memories: [
                { id: 'graph-1', source_event_id: 'kev_graph_1', name: '判断1', payload: { secret: 'raw-graph-1' } },
                { id: 'graph-2', source_event_id: 'kev_graph_2', name: '判断2', payload: { secret: 'raw-graph-2' } },
                { id: 'graph-3', source_event_id: 'kev_graph_3', name: '判断3', payload: { secret: 'raw-graph-3' } },
                { id: 'graph-4', source_event_id: 'kev_graph_4', name: '判断4', payload: { secret: 'raw-graph-4' } }
            ],
            personal_memories: []
        }, context);

        expect(result.morning_output).toMatchObject({
            exceptions: [
                { code: 'one', summary: '例外1' },
                { code: 'two', summary: '例外2' },
                { code: 'three', summary: '例外3' }
            ],
            memories: [{ summary: '判断1' }, { summary: '判断2' }, { summary: '判断3' }]
        });
        expect(result.morning_output.routine_output).toMatchObject({
            headline: '今日は「判断1」を判断軸に進める',
            today_focus: [{ summary: '判断1' }],
            immediate_decisions: [{ summary: '判断2' }, { summary: '判断3' }]
        });
        expect(JSON.stringify(result.morning_output)).not.toContain('raw-graph');
        expect(JSON.stringify(result.morning_output)).not.toContain('/secret/one.json');
        expect(JSON.stringify(result.morning_output)).not.toContain('判断4');
    });

    it('ohayoはGraph実返却payloadとPersonal KGから正式knowledge event IDだけを解決する', async () => {
        const { ports } = createPorts();
        const graphMemories = [
            {
                id: 'graph-entity-selected',
                payload: { derived_from_event_id: 'kev_graph_payload_selected' }
            },
            {
                id: 'graph-entity-recalled-only',
                payload: { derived_from_event_id: 'kev_graph_payload_unused' }
            }
        ];
        const personalMemories = [
            {
                id: 'candidate-selected',
                source_event_ids: ['kev_personal_formal', 'legacy-import-row-42']
            },
            {
                id: 'candidate-generic-only',
                source_event_ids: ['meeting-pack-raw-9', 'legacy-candidate-9']
            }
        ];

        await expect(ports.generate({
            graph_memories: graphMemories,
            personal_memories: personalMemories,
            displayed_memory_ids: ['graph-entity-recalled-only']
        }, context)).resolves.toMatchObject({
            displayed_memory_ids: [
                'graph-entity-selected',
                'graph-entity-recalled-only',
                'candidate-selected',
            ],
            used_knowledge_ids: [
                'kev_graph_payload_selected',
                'kev_graph_payload_unused',
                'kev_personal_formal'
            ]
        });
    });

    it('ohayoはcaller申告displayed_memory_idsを使用証拠にせず生成結果を返す', async () => {
        const { ports } = createPorts();

        await expect(ports.generate({
            graph_memories: [{ id: 'graph-entity-1', source_event_id: 'kev_graph_1' }],
            personal_memories: [{ id: 'candidate-1', source_event_id: 'kev_personal_1' }],
            displayed_memory_ids: ['forged-caller-id']
        }, context)).resolves.toMatchObject({
            displayed_memory_ids: ['graph-entity-1', 'candidate-1'],
            used_knowledge_ids: ['kev_graph_1', 'kev_personal_1'],
            morning_output: { memories: expect.any(Array) }
        });
    });

    it('retroはknowledge repositoryとReceiptから5指標を算出する', async () => {
        const { dependencies, ports } = createPorts();

        await expect(ports.evaluateMetrics({
            metrics: [
                'misregistration_rate',
                'correction_rate',
                'open_contradictions',
                'processing_time_ms',
                'stoppage_count'
            ],
            input: { project_id: 'brainbase' }
        }, context)).resolves.toEqual({
            misregistration_rate: 0.1,
            correction_rate: 0.2,
            open_contradictions: 1,
            processing_time_ms: 900,
            stoppage_count: 3
        });
        expect(dependencies.knowledgeEventRepository.summarizeRoutineState).toHaveBeenCalled();
        expect(dependencies.runReceiptQueryService.summarizeRoutineState).toHaveBeenCalled();
    });

    it('retroはpending_approvalのGraph昇格候補を読むだけで状態を変更しない', async () => {
        const { dependencies, ports } = createPorts();

        await expect(ports.listKnowledgeReviews({
            input: {
                project_id: 'brainbase',
                personal_kg_registration_reviews: [{ id: 'personal-1', body: '個人の判断基準' }]
            },
            limit: 10
        }, context)).resolves.toEqual({
            personal_kg_registration_reviews: [
                { id: 'personal-1', summary: '個人の判断基準' },
                { id: 'candidate-personal-1', status: 'candidate', summary: '午前は設計を優先する' }
            ],
            graph_promotion_reviews: [{ id: 'candidate-graph-1', status: 'pending_approval', summary: '顧客Aの正式方針' }]
        });
        expect(dependencies.candidateRepository.list).toHaveBeenCalledWith(expect.objectContaining({
            project_code: 'brainbase',
            promotion_status: 'pending_approval'
        }), context);
    });

    it('retroの集計期間と3ルーティンIDをknowledgeとReceiptの両方へ伝播する', async () => {
        const { dependencies, ports } = createPorts();
        const input = {
            project_id: 'brainbase',
            since: '2026-08-06T00:00:00Z',
            until: '2026-08-13T00:00:00Z'
        };

        await ports.evaluateMetrics({ input }, context);

        const expectedScope = {
            ...input,
            routine_automation_ids: ['brainbase-ohayo', 'brainbase-oyasumi', 'brainbase-retro']
        };
        expect(dependencies.knowledgeEventRepository.summarizeRoutineState)
            .toHaveBeenCalledWith(expectedScope, context);
        expect(dependencies.runReceiptQueryService.summarizeRoutineState)
            .toHaveBeenCalledWith(expectedScope, context);
    });

    it('retro入力に期間がなくても既定7日窓をknowledgeとReceiptへ渡す', async () => {
        const { dependencies, ports } = createPorts({
            now: () => new Date('2026-08-13T12:00:00.000Z')
        });

        await ports.evaluateMetrics({ input: { project_id: 'brainbase' } }, context);

        const expectedScope = {
            project_id: 'brainbase',
            since: '2026-08-06T12:00:00.000Z',
            until: '2026-08-13T12:00:00.000Z',
            routine_automation_ids: ['brainbase-ohayo', 'brainbase-oyasumi', 'brainbase-retro']
        };
        expect(dependencies.knowledgeEventRepository.summarizeRoutineState)
            .toHaveBeenCalledWith(expectedScope, context);
        expect(dependencies.runReceiptQueryService.summarizeRoutineState)
            .toHaveBeenCalledWith(expectedScope, context);
    });

    it('retroの取得不能を0へ潰さずpartial用の未確認指標として返す', async () => {
        const { ports } = createPorts({
            runReceiptQueryService: {
                summarizeRoutineState: vi.fn(async () => { throw new Error('receipt unavailable'); })
            }
        });

        await expect(ports.evaluateMetrics({ metrics: [], input: { project_id: 'brainbase' } }, context))
            .resolves.toMatchObject({
                stoppage_count: null,
                anomalies: [expect.objectContaining({ code: 'routine_source_unavailable' })]
            });
    });
});
