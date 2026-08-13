import { describe, expect, it, vi } from 'vitest';

import { ProductionRoutinePorts } from '../../../server/services/routine-runtime/production-routine-ports.js';

const context = {
    access: { personId: 'routine-worker', projectCodes: ['brainbase'], role: 'member' },
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
        listPersonalKg: vi.fn(async () => [{ id: 'event-personal-1', body: 'personal memory' }])
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

    it('oyasumiはknowledge event/candidate状態とRun Receipt・judgment outboxを実照合する', async () => {
        const { dependencies, ports } = createPorts();

        await expect(ports.reconcile({ input: { project_id: 'brainbase' } }, context)).resolves.toEqual({
            unprocessed_count: 2,
            contradiction_count: 1,
            expired_count: 1,
            outbox_count: 3
        });
        expect(dependencies.knowledgeEventRepository.summarizeRoutineState).toHaveBeenCalledWith(
            { project_id: 'brainbase' },
            context
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

    it('ohayoはInfoSSOT GraphとCandidateRepository Personal KGを想起する', async () => {
        const { dependencies, ports } = createPorts();

        await expect(ports.recallGraph({ input: { project_id: 'brainbase', query: 'today' } }, context))
            .resolves.toEqual([{ id: 'event-graph-1', name: 'graph memory' }]);
        await expect(ports.recallPersonalKg({ input: { project_id: 'brainbase', query: 'today' } }, context))
            .resolves.toEqual([{ id: 'event-personal-1', body: 'personal memory' }]);
        expect(dependencies.infoSSOTService.listGraphEntities).toHaveBeenCalledWith(
            context.access,
            expect.objectContaining({ projectCode: 'brainbase', query: 'today' })
        );
        expect(dependencies.candidateRepository.listPersonalKg).toHaveBeenCalledWith(
            expect.objectContaining({
                project_code: 'brainbase',
                owner_person_id: 'sato_keigo',
                role: 'member'
            }),
            context
        );
    });

    it('ohayoは設定された正規Personal KG ownerと呼出者clearanceをCandidate Repositoryへ渡す', async () => {
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

        expect(dependencies.candidateRepository.listPersonalKg).toHaveBeenCalledWith(
            expect.objectContaining({
                owner_person_id: 'per_canonical_sato',
                role: 'gm',
                clearance: ['internal', 'restricted']
            }),
            restrictedContext
        );
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

        expect(result.morning_output).toEqual({
            exceptions: [
                { code: 'one', summary: '例外1' },
                { code: 'two', summary: '例外2' },
                { code: 'three', summary: '例外3' }
            ],
            memories: [{ summary: '判断1' }, { summary: '判断2' }, { summary: '判断3' }]
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
