import { describe, expect, it, vi } from 'vitest';

import {
    InMemoryKnowledgeEventRepository,
    KnowledgeEventConflictError,
    KnowledgeEventService,
    KnowledgeEventValidationError
} from '../../server/services/knowledge-event-service.js';
import { InfoSSOTKnowledgeGraphRepository } from '../../server/services/knowledge-event/info-ssot-knowledge-graph-repository.js';

const REQUIRED_FIELDS = [
    'schema_version',
    'event_id',
    'occurred_at',
    'captured_at',
    'source',
    'subject',
    'decision_authority',
    'applicability_scope',
    'permission_snapshot',
    'source_pointer',
    'body_hash',
    'parent_episode_id'
];

function decisionEvent(overrides = {}) {
    return {
        schema_version: 'knowledge_event.v1',
        event_id: 'kev_decision_1',
        occurred_at: '2026-08-13T01:00:00.000Z',
        captured_at: '2026-08-13T01:01:00.000Z',
        source: { type: 'meeting_review_package', id: 'meeting_1' },
        subject: { type: 'decision', id: 'decision_pricing_2026' },
        decision: { statement: '法人プランの最低価格を月額10万円にする' },
        decision_authority: { authorized: true, decider_id: 'person_ceo', domain: 'pricing' },
        applicability_scope: { project_code: 'brainbase', scope: 'organization' },
        permission_snapshot: { visibility: 'org', contains_pii: false },
        source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_1#decision-1' },
        body_hash: 'sha256:decision-body-v1',
        parent_episode_id: 'episode_meeting_1',
        unresolved_conflict: false,
        ...overrides
    };
}

function createHarness({ existing = null, authorityVerified = true, existingGraph = null } = {}) {
    const eventRepository = {
        findById: vi.fn(async () => existing),
        create: vi.fn(async (event) => ({ ...event, candidate_id: 'cand_decision_1' })),
        appendStage: vi.fn(async () => undefined)
    };
    const candidateRepository = {
        create: vi.fn(async (candidate) => ({ id: 'cand_decision_1', ...candidate })),
        transitionProcessingStage: vi.fn(async (_id, stage) => ({ processing_stage: stage })),
        updateSemanticState: vi.fn(async (_id, state) => ({ semantic_state: state })),
        transitionWithAudit: vi.fn(async (_id, status) => ({ candidate: { promotion_status: status } }))
    };
    const graphRepository = {
        verifyDecisionAuthority: vi.fn(async () => authorityVerified),
        findDecisionById: vi.fn(async () => existingGraph),
        upsertDecision: vi.fn(async ({ id, payload }) => ({ id, entity_type: 'decision', payload }))
    };
    const externalActions = { execute: vi.fn() };
    return {
        eventRepository,
        candidateRepository,
        graphRepository,
        externalActions,
        service: new KnowledgeEventService({
            eventRepository,
            candidateRepository,
            graphRepository,
            externalActions
        })
    };
}

describe('KnowledgeEventService knowledge_event.v1 contract', () => {
    it.each(REQUIRED_FIELDS)('必須項目 %s の欠落を拒否する', async (field) => {
        const { service } = createHarness();
        const event = decisionEvent();
        delete event[field];

        await expect(service.ingest(event)).rejects.toMatchObject({
            name: KnowledgeEventValidationError.name,
            field
        });
    });

    it('同じevent_idとbody_hashの再送は保存せず同じ結果を返す', async () => {
        const priorResult = {
            event_id: 'kev_decision_1',
            candidate_id: 'cand_decision_1',
            processing_stage: 'retrievable'
        };
        const { service, eventRepository, candidateRepository, graphRepository } = createHarness({
            existing: { body_hash: 'sha256:decision-body-v1', result: priorResult }
        });

        await expect(service.ingest(decisionEvent())).resolves.toEqual({
            ...priorResult,
            idempotent: true
        });
        expect(eventRepository.create).not.toHaveBeenCalled();
        expect(candidateRepository.create).not.toHaveBeenCalled();
        expect(graphRepository.upsertDecision).not.toHaveBeenCalled();
    });

    it('同じevent_idでbody_hashが異なる再送はidentity conflictにする', async () => {
        const { service } = createHarness({
            existing: { body_hash: 'sha256:original' }
        });

        await expect(service.ingest(decisionEvent({ body_hash: 'sha256:changed' })))
            .rejects.toBeInstanceOf(KnowledgeEventConflictError);
    });

    it.each([
        ['subject', { subject: { type: 'decision', id: 'decision_other' } }],
        ['authority', { decision_authority: { authorized: true, decider_id: 'person_other', domain: 'pricing' } }],
        ['scope', { applicability_scope: { project_code: 'other', scope: 'organization' } }],
        ['parent episode', { parent_episode_id: 'episode_other' }]
    ])('同じevent_id/body_hashでも%sが異なればidentity conflictにする', async (_label, overrides) => {
        const original = decisionEvent();
        const { service } = createHarness({ existing: { ...original, result: { event_id: original.event_id } } });

        await expect(service.ingest(decisionEvent(overrides)))
            .rejects.toBeInstanceOf(KnowledgeEventConflictError);
    });

    it('同じevent_id/body_hashの並行登録は単一candidate/Graphになり両方idempotent成功する', async () => {
        const eventRepository = new InMemoryKnowledgeEventRepository();
        const candidateRepository = {
            create: vi.fn(async (input) => ({ id: 'cand_concurrent_1', ...input })),
            transitionProcessingStage: vi.fn(async () => undefined),
            updateSemanticState: vi.fn(async () => undefined),
            transitionWithAudit: vi.fn(async () => undefined)
        };
        const graphRepository = {
            verifyDecisionAuthority: vi.fn(async () => true),
            findDecisionById: vi.fn(async () => null),
            upsertDecision: vi.fn(async ({ id }) => ({ id }))
        };
        const service = new KnowledgeEventService({ eventRepository, candidateRepository, graphRepository });

        const results = await Promise.all([
            service.ingest(decisionEvent()),
            service.ingest(decisionEvent())
        ]);

        expect(results).toEqual([
            expect.objectContaining({ candidate_id: 'cand_concurrent_1', graph_entity_id: 'decision_pricing_2026' }),
            expect.objectContaining({ candidate_id: 'cand_concurrent_1', graph_entity_id: 'decision_pricing_2026', idempotent: true })
        ]);
        expect(candidateRepository.create).toHaveBeenCalledOnce();
        expect(graphRepository.upsertDecision).toHaveBeenCalledOnce();
    });

    it('根拠あるDecisionをstable Graph IDで反映しprovenance付きでretrievableにする', async () => {
        const { service, candidateRepository, graphRepository, eventRepository, externalActions } = createHarness();

        const result = await service.ingest(decisionEvent());

        expect(candidateRepository.create).toHaveBeenCalledWith(expect.objectContaining({
            target_tier: 'graph',
            recommended_subject_id: 'decision_pricing_2026',
            semantic_state: 'active',
            requires_approval: false
        }));
        expect(graphRepository.upsertDecision).toHaveBeenCalledWith(expect.objectContaining({
            id: 'decision_pricing_2026',
            payload: expect.objectContaining({
                derived_from_event_id: 'kev_decision_1',
                derived_from_candidate_id: 'cand_decision_1',
                source_pointer: decisionEvent().source_pointer
            })
        }));
        expect(graphRepository.upsertDecision.mock.calls[0][0].payload).not.toHaveProperty('raw_transcript');
        expect(result).toMatchObject({
            event_id: 'kev_decision_1',
            candidate_id: 'cand_decision_1',
            graph_entity_id: 'decision_pricing_2026',
            processing_stage: 'retrievable',
            semantic_state: 'active'
        });
        expect(eventRepository.appendStage).toHaveBeenLastCalledWith(
            'kev_decision_1',
            expect.objectContaining({ stage: 'retrievable' })
        );
        expect(candidateRepository.transitionWithAudit).toHaveBeenCalledWith(
            'cand_decision_1',
            'promoted_to_graph',
            expect.objectContaining({ evidence_ids: ['kev_decision_1'] }),
            expect.objectContaining({ requires_approval: false, promoted_graph_entity_id: 'decision_pricing_2026' })
        );
        expect(externalActions.execute).not.toHaveBeenCalled();
    });

    it('既存active Graphのstatementと異なりcorrects_event_idがなければunresolved conflictへ隔離する', async () => {
        const { service, graphRepository, candidateRepository } = createHarness({
            existingGraph: {
                id: 'decision_pricing_2026',
                semantic_state: 'active',
                payload: { statement: '法人プランの最低価格は月額8万円にする' }
            }
        });

        const result = await service.ingest(decisionEvent());

        expect(graphRepository.findDecisionById).toHaveBeenCalledWith('decision_pricing_2026', expect.any(Object));
        expect(result).toMatchObject({
            semantic_state: 'quarantined',
            quarantine_reason: 'unresolved_conflict'
        });
        expect(candidateRepository.updateSemanticState).toHaveBeenCalledWith(
            'cand_decision_1',
            'quarantined',
            expect.objectContaining({ reason: 'unresolved_conflict' })
        );
        expect(graphRepository.upsertDecision).not.toHaveBeenCalled();
    });

    it('同一Decision subjectへの並行した異内容は一方だけactiveにして他方を原子的に隔離する', async () => {
        const eventRepository = new InMemoryKnowledgeEventRepository();
        const candidateRepository = {
            create: vi.fn(async (input) => ({ id: `cand_${input.source_event_ids[0]}`, ...input })),
            transitionProcessingStage: vi.fn(async () => undefined),
            updateSemanticState: vi.fn(async () => undefined),
            transitionWithAudit: vi.fn(async () => undefined)
        };
        let findCount = 0;
        let releaseFinds;
        const bothFinds = new Promise((resolve) => { releaseFinds = resolve; });
        let current = null;
        const graphRepository = {
            verifyDecisionAuthority: vi.fn(async () => true),
            findDecisionById: vi.fn(async () => {
                findCount += 1;
                if (findCount === 2) releaseFinds();
                await bothFinds;
                return null;
            }),
            upsertDecision: vi.fn(async ({ id, payload }) => {
                if (!current) {
                    current = { id, payload };
                    return current;
                }
                const error = new Error('decision subject conflict');
                error.code = 'knowledge_graph_subject_conflict';
                throw error;
            })
        };
        const service = new KnowledgeEventService({ eventRepository, candidateRepository, graphRepository });

        const results = await Promise.all([
            service.ingest(decisionEvent()),
            service.ingest(decisionEvent({
                event_id: 'kev_decision_2',
                body_hash: 'sha256:decision-body-v2',
                decision: { statement: '法人プランの最低価格を月額12万円にする' }
            }))
        ]);

        expect(results.map((result) => result.semantic_state).sort()).toEqual(['active', 'quarantined']);
        expect(results.find((result) => result.semantic_state === 'quarantined')).toMatchObject({
            quarantine_reason: 'unresolved_conflict'
        });
        expect(candidateRepository.updateSemanticState).toHaveBeenCalledTimes(1);
    });

    it('自己申告のdecision_authorityではなくGraph/RACIの検証結果で隔離する', async () => {
        const { service, graphRepository, candidateRepository } = createHarness({ authorityVerified: false });
        const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

        const result = await service.ingest(decisionEvent(), { access });

        expect(graphRepository.verifyDecisionAuthority).toHaveBeenCalledWith(expect.objectContaining({
            project_code: 'brainbase',
            decider_id: 'person_ceo',
            decision_domain: 'pricing'
        }), expect.objectContaining({ access }));
        expect(result).toMatchObject({
            semantic_state: 'quarantined',
            quarantine_reason: 'decision_authority_unverified'
        });
        expect(candidateRepository.updateSemanticState).toHaveBeenCalledWith(
            'cand_decision_1',
            'quarantined',
            expect.objectContaining({ reason: 'decision_authority_unverified' })
        );
        expect(graphRepository.upsertDecision).not.toHaveBeenCalled();
    });

    it('Graph adapterはaccess不在時にdeciderをCEOへ合成しない', async () => {
        const infoSSOTService = {
            commitOntologyGraph: vi.fn(async (_access, input) => ({ entity_id: input.entity.id }))
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await expect(repository.upsertDecision({
            id: 'decision_pricing_2026',
            payload: {
                applicability_scope: { project_code: 'brainbase' },
                decision_authority: { decider_id: 'person_ceo' }
            }
        })).rejects.toMatchObject({ code: 'knowledge_access_required' });
        expect(infoSSOTService.commitOntologyGraph).not.toHaveBeenCalled();
    });

    it('Graph adapterはexternal clientでもaccess context内でRACI確認してから書き込む', async () => {
        const client = { query: vi.fn() };
        const access = {
            actor_person_id: 'person_operator',
            role: 'member',
            projectCodes: ['brainbase'],
            clearance: ['internal']
        };
        let contextApplied = false;
        const infoSSOTService = {
            withAccessContext: vi.fn(async (receivedAccess, work, options) => {
                expect(receivedAccess).toEqual(access);
                expect(options).toEqual({ client });
                contextApplied = true;
                return work(client);
            }),
            assertDecisionAuthority: vi.fn(async () => {
                expect(contextApplied).toBe(true);
            }),
            commitOntologyGraph: vi.fn(async (_receivedAccess, input) => ({ entity_id: input.entity.id }))
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository.upsertDecision({
            id: 'decision_pricing_2026',
            payload: {
                statement: '法人プランの最低価格を月額10万円にする',
                applicability_scope: { project_code: 'brainbase' },
                decision_authority: { decider_id: 'person_ceo', domain: 'pricing' }
            }
        }, { client, access });

        expect(infoSSOTService.withAccessContext).toHaveBeenCalledOnce();
        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledWith(client, expect.objectContaining({
            personId: 'person_ceo',
            decisionDomain: 'pricing'
        }));
        expect(infoSSOTService.commitOntologyGraph).toHaveBeenCalledWith(
            access,
            expect.any(Object),
            { client, access_context_applied: true }
        );
    });

    it('Graph adapterは同じclient/accessでproject_codeをprojects.idへ解決してからRACIを確認する', async () => {
        const client = {
            query: vi.fn(async (sql, params) => {
                expect(String(sql)).toContain('FROM projects');
                expect(params).toEqual(['brainbase']);
                return { rows: [{ id: 'project_uuid_brainbase' }], rowCount: 1 };
            })
        };
        const access = { role: 'member', projectCodes: ['brainbase'] };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (receivedAccess, work, options) => {
                expect(receivedAccess).toEqual(access);
                expect(options).toEqual({ client });
                return work(client);
            }),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository.verifyDecisionAuthority({
            project_code: 'brainbase',
            decider_id: 'person_ceo',
            decision_domain: 'pricing'
        }, { client, access });

        expect(client.query).toHaveBeenCalledOnce();
        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledWith(client, expect.objectContaining({
            projectId: 'project_uuid_brainbase',
            projectCode: 'brainbase'
        }));
    });

    it.each([
        ['decision_authority_missing', { decision_authority: { authorized: false } }],
        ['applicability_scope_missing', { applicability_scope: { project_code: 'brainbase' } }],
        ['unresolved_conflict', { unresolved_conflict: true }],
        ['personal_data_detected', { permission_snapshot: { visibility: 'org', contains_pii: true } }]
    ])('%sのDecisionを隔離しGraphにも外部作用にも出さない', async (reason, overrides) => {
        const { service, candidateRepository, graphRepository, externalActions } = createHarness();

        const result = await service.ingest(decisionEvent(overrides));

        expect(candidateRepository.updateSemanticState).toHaveBeenCalledWith(
            'cand_decision_1',
            'quarantined',
            expect.objectContaining({ reason })
        );
        expect(result).toMatchObject({
            processing_stage: 'resolved',
            semantic_state: 'quarantined',
            quarantine_reason: reason
        });
        expect(graphRepository.upsertDecision).not.toHaveBeenCalled();
        expect(externalActions.execute).not.toHaveBeenCalled();
    });
});
