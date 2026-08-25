import { describe, expect, it, vi } from 'vitest';

import {
    KnowledgeEventService
} from '../../../server/services/knowledge-event-service.js';
import { InfoSSOTKnowledgeGraphRepository } from '../../../server/services/knowledge-event/info-ssot-knowledge-graph-repository.js';
import {
    normalizePromotionPayload,
    ownerConsentReceipt
} from '../../../server/services/personal-knowledge/personal-knowledge-normalization.js';
import { PersonalKnowledgePromotionService } from '../../../server/services/personal-knowledge/personal-knowledge-promotion-service.js';
import { buildPersonalKnowledgePromotionAuthority } from '../../../server/services/personal-knowledge/promotion-authority-contract.js';

const ACCESS = {
    personId: 'person_reviewer',
    actorPersonId: 'person_reviewer',
    organizationId: 'org_a',
    role: 'gm',
    projectCodes: ['brainbase'],
    clearance: ['internal']
};

function normalizedDecision() {
    return normalizePromotionPayload({
        schema_version: 'personal_knowledge_normalized.v1',
        kind: 'decision',
        entity: {
            id: 'decision_graph_boundary_1',
            type: 'decision',
            payload: { statement: '明示的な正規化結果だけをGraphへ公開する' }
        },
        edges: [],
        context_entities: [],
        decision_domain: 'brainbase_architecture',
        sensitivity: 'internal',
        role_min: 'member'
    });
}

function buildRequest(normalization) {
    const request = {
        request_id: 'kpr_graph_boundary_1',
        personal_event_id: 'pke_graph_boundary_1',
        owner_person_id: 'person_owner',
        organization_id: 'org_a',
        project_code: 'brainbase',
        status: 'pending_org_review',
        sanitized_preview: '正規化された共有判断',
        subject: { type: 'decision', id: normalization.normalized.entity.id },
        body_hash: 'sha256:source-evidence-graph-boundary',
        owner_decided_by: 'person_owner',
        owner_decided_at: '2026-08-25T00:00:00.000Z',
        normalized_payload: normalization.normalized,
        normalized_payload_hash: normalization.normalized_payload_hash,
        owner_consent_receipt_id: null
    };
    request.owner_consent_receipt_id = ownerConsentReceipt(request);
    return request;
}

function createEventRepository() {
    const events = new Map();
    return {
        events,
        ensureSchema: vi.fn(async () => undefined),
        findById: vi.fn(async (eventId) => events.get(eventId) || null),
        create: vi.fn(async (event) => {
            const record = { ...structuredClone(event), stage_history: [] };
            events.set(event.event_id, record);
            return record;
        }),
        appendStage: vi.fn(async (eventId, stage) => {
            events.get(eventId)?.stage_history.push(structuredClone(stage));
        }),
        saveResult: vi.fn(async (eventId, result) => {
            const event = events.get(eventId);
            if (event) event.result = structuredClone(result);
        })
    };
}

function createCandidateRepository() {
    return {
        create: vi.fn(async (input) => ({ id: 'candidate_graph_boundary_1', ...input })),
        transitionProcessingStage: vi.fn(async () => undefined),
        transitionWithAudit: vi.fn(async () => undefined),
        updateSemanticState: vi.fn(async () => undefined)
    };
}

function createPromotionRepository(request, client) {
    const authorityUses = new Set();
    return {
        transaction: vi.fn(async (work) => work({ client })),
        findPromotionRequest: vi.fn(async () => structuredClone(request)),
        claimPromotionAuthorityUse: vi.fn(async (use) => {
            if (authorityUses.has(use.operation_id)) {
                throw Object.assign(new Error('personal_knowledge_promotion_authority_replayed'), {
                    status: 409
                });
            }
            authorityUses.add(use.operation_id);
        }),
        reviewOrganizationPromotionRequest: vi.fn(async (_requestId, decision) => {
            Object.assign(request, {
                status: decision.status,
                organization_event_id: decision.organization_event_id,
                graph_entity_id: decision.graph_entity_id,
                organization_review_receipt_id: decision.organization_review_receipt_id
            });
            return structuredClone(request);
        }),
        createLineage: vi.fn(async (lineage) => lineage)
    };
}

function createInfoSSOTBoundary(client) {
    let graphVersion = 0;
    const infoSSOTService = {
        withAccessContext: vi.fn(async (_access, work, options = {}) => work(options.client || client)),
        assertDecisionAuthority: vi.fn(async () => undefined),
        commitOntologyGraph: vi.fn(async (_access, input, options = {}) => {
            expect(options.client).toBe(client);
            graphVersion += 1;
            return {
                entity_id: input.entity.id,
                edge_count: input.edges?.length || 0,
                ontology_version: '1.1.0',
                version: graphVersion
            };
        })
    };
    client.query.mockImplementation(async (sql) => {
        if (String(sql).includes('FROM projects')) return { rows: [{ id: 'project_uuid_brainbase' }] };
        if (String(sql).includes('FROM graph_entities')) return { rows: [] };
        return { rows: [] };
    });
    return { infoSSOTService, getGraphVersion: () => graphVersion };
}

describe('personal knowledge promotion Graph write boundary', () => {
    it('persists the organization event and performs one Graph version increment; replay performs zero', async () => {
        const normalization = normalizedDecision();
        const request = buildRequest(normalization);
        const client = { query: vi.fn() };
        const eventRepository = createEventRepository();
        const candidateRepository = createCandidateRepository();
        const { infoSSOTService, getGraphVersion } = createInfoSSOTBoundary(client);
        const graphRepository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const autoProjection = vi.spyOn(graphRepository, 'upsertDecision');
        const knowledgeEventService = new KnowledgeEventService({
            eventRepository,
            candidateRepository,
            graphRepository
        });
        const repository = createPromotionRepository(request, client);
        const service = new PersonalKnowledgePromotionService({
            repository,
            knowledgeEventService,
            knowledgeGraphRepository: graphRepository,
            now: () => new Date('2026-08-25T00:10:00.000Z')
        });
        const promotionAuthority = {
            capabilityId: 'personal_knowledge_promotion:organization_review',
            actorPersonId: ACCESS.actorPersonId,
            organizationIds: [ACCESS.organizationId],
            projectIds: ['brainbase'],
            operationId: 'op_graph_boundary_1',
            idempotencyKey: 'ik_graph_boundary_1',
            ...buildPersonalKnowledgePromotionAuthority({
                action: 'organization_review',
                requestId: request.request_id,
                normalizedPayloadHash: request.normalized_payload_hash
            })
        };

        const result = await service.reviewOrganizationPromotion(
            request.request_id,
            { decision: 'approve' },
            { access: ACCESS, promotionAuthority }
        );

        expect(result).toMatchObject({
            status: 'org_accepted',
            graph_entity_id: normalization.normalized.entity.id
        });
        expect(eventRepository.events.size).toBe(1);
        expect(autoProjection).not.toHaveBeenCalled();
        expect(infoSSOTService.commitOntologyGraph).toHaveBeenCalledOnce();
        expect(getGraphVersion()).toBe(1);
        expect(eventRepository.create.mock.calls[0][1]).toEqual({ client });
        expect(repository.reviewOrganizationPromotionRequest.mock.calls[0][2]).toEqual(expect.objectContaining({
            client,
            access: ACCESS
        }));
        expect(repository.transaction.mock.calls[0][0]).toEqual(expect.any(Function));

        await expect(service.reviewOrganizationPromotion(
            request.request_id,
            { decision: 'approve' },
            { access: ACCESS, promotionAuthority }
        )).rejects.toThrow('personal_knowledge_promotion_authority_replayed');

        expect(infoSSOTService.commitOntologyGraph).toHaveBeenCalledOnce();
        expect(getGraphVersion()).toBe(1);
        expect(eventRepository.events.size).toBe(1);
    });
});
