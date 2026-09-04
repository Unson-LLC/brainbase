import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
    assertAcceptedState,
    assertSafeEvidence,
    assertSafeOrganizationResponse,
    assertGraphBodyAbsent,
    parseSmokeFixture,
    redactReceipt,
    readDbState,
    runSmoke,
    withReadOnlyAccessTransaction
} from '../../../scripts/personal-knowledge-promotion-production-smoke.mjs';
import { normalizePromotionPayload } from '../../../server/services/personal-knowledge/personal-knowledge-normalization.js';

function signedContext(action, resourceRef, requestId = null, normalizedPayloadHash = null, binding = null) {
    const context = {
        integrity: { method: 'jws_detached', algorithm: 'EdDSA', value: 'signed-fixture-value-123' },
        operation_id: `op_${action}`,
        idempotency_key: `idem_${action}`,
        issued_at: '2026-08-25T00:00:00.000Z',
        expires_at: '2026-08-25T00:05:00.000Z',
        authority: {
            action, resource_ref: resourceRef, request_id: requestId,
            normalized_payload_hash: normalizedPayloadHash
        }
    };
    if (binding) {
        context.actor = {
            principal_id: binding.personId,
            principal_type: 'person',
            authenticated_subject_id: binding.externalSubject
        };
        context.authorization = {
            organization_ids: [binding.organizationId],
            project_ids: [binding.projectId],
            data_scopes: [],
            capability_ids: [`personal_knowledge_promotion:${action}`]
        };
    }
    return context;
}

function fixture() {
    const runId = 'p0_smoke_20260825_001';
    const eventId = 'pke_smoke_20260825_001';
    const entityId = 'smoke_20260825_001';
    const normalizedPayload = {
        schema_version: 'personal_knowledge_normalized.v1',
        kind: 'decision',
        entity: { id: entityId, type: 'decision', payload: { statement: 'synthetic smoke decision' } },
        edges: [], context_entities: [], decision_domain: 'production_smoke',
        sensitivity: 'internal', role_min: 'member'
    };
    const normalizedPayloadHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const requestId = 'kpr_';
    // parseSmokeFixture computes the request ID from the normalized payload;
    // this helper only supplies valid signed-context shape for rejection tests.
    return {
        schema_version: 'personal_knowledge_promotion_production_smoke.v1',
        synthetic: true,
        data_class: 'synthetic',
        run_id: runId,
        event: {
            event_id: eventId,
            body: `synthetic production smoke ${runId}`,
            body_hash: 'sha256:bad',
            source: { type: 'production_smoke' },
            source_pointer: { run_id: runId }
        },
        request: {
            project_code: 'brainbase', summary: 'synthetic production smoke',
            subject: { type: 'decision', id: entityId }, normalized_payload: normalizedPayload,
            signed_context: signedContext('request', `personal-knowledge://events/${eventId}`)
        },
        owner: { signed_context: signedContext('owner_consent', `personal-knowledge://promotions/${requestId}`, requestId, normalizedPayloadHash) },
        organization: { signed_context: signedContext('organization_review', `personal-knowledge://promotions/${requestId}`, requestId, normalizedPayloadHash) }
    };
}

const READBACK = {
    eventId: 'pke_smoke_readback',
    requestId: 'kpr_smoke_readback',
    entityId: 'smoke_readback',
    organizationEventId: 'kev_smoke_readback',
    body: 'synthetic production smoke readback'
};

const READBACK_ACCESS = {
    personId: 'owner-person',
    actorPersonId: 'owner-person',
    organizationId: 'org-smoke',
    projectCodes: ['brainbase'],
    role: 'member',
    clearance: ['internal']
};

function fakeReadbackPool(promotionRequestId = READBACK.requestId, {
    graphRows = [{ count: '0' }], readbackRole = { rolsuper: false, rolbypassrls: false }
} = {}) {
    const query = async (sql) => {
        if (sql.includes('FROM pg_roles')) return { rows: [readbackRole] };
        if (sql.includes('FROM personal_knowledge_events')) {
            return {
                rows: [{
                    event_id: READBACK.eventId,
                    body_hash: 'sha256:synthetic',
                    body_present: true,
                    body_length: READBACK.body.length
                }]
            };
        }
        if (sql.includes('FROM knowledge_event_current event')) {
            return {
                rows: [{
                    event_id: READBACK.organizationEventId,
                    semantic_state: 'active',
                    graph_entity_id: READBACK.entityId,
                    personal_body_found_in_payload: false
                }]
            };
        }
        if (sql.includes('FROM knowledge_promotion_lineage')) {
            return {
                rows: [{
                    lineage_id: 'lineage_smoke_readback',
                    personal_event_id: READBACK.eventId,
                    organization_event_id: READBACK.organizationEventId,
                    promotion_request_id: READBACK.requestId,
                    normalized_payload_hash: 'sha256:normalized',
                    owner_consent_receipt_id: 'pkoc_smoke_readback',
                    organization_review_receipt_id: 'pkor_smoke_readback',
                    graph_entity_id: READBACK.entityId
                }]
            };
        }
        if (sql.includes('FROM knowledge_promotion_authority_uses')) {
            return { rows: [{ action: 'request', count: '1' }, { action: 'owner_consent', count: '1' }, { action: 'organization_review', count: '1' }] };
        }
        if (sql.includes('FROM graph_edges')) return { rows: graphRows };
        if (sql.includes('FROM knowledge_promotion_requests')) {
            return {
                rows: [{
                    request_id: promotionRequestId,
                    personal_event_id: READBACK.eventId,
                    organization_event_id: READBACK.organizationEventId,
                    graph_entity_id: READBACK.entityId,
                    status: 'org_accepted',
                    normalized_payload_hash: 'sha256:normalized',
                    owner_consent_receipt_id: 'pkoc_smoke_readback',
                    organization_review_receipt_id: 'pkor_smoke_readback'
                }]
            };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    };
    return {
        async connect() {
            return {
                async query(sql, params) {
                    if (/^BEGIN READ ONLY$/u.test(sql.trim()) || /^COMMIT$/u.test(sql.trim()) || /^ROLLBACK$/u.test(sql.trim())) {
                        return { rows: [] };
                    }
                    if (sql.includes('set_config')) return { rows: [{ set_config: params?.[1] ?? null }] };
                    return query(sql);
                },
                release() {}
            };
        },
        async end() {}
    };
}

async function readbackState(promotionRequestId = READBACK.requestId) {
    const db = await readDbState(fakeReadbackPool(promotionRequestId), {
        eventId: READBACK.eventId,
        requestId: READBACK.requestId,
        entityId: READBACK.entityId,
        body: READBACK.body,
        access: READBACK_ACCESS
    });
    return { db, graph: [{ id: READBACK.entityId }], receipt: {} };
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function runnerFixture() {
    const runId = 'p0_smoke_runner_001';
    const eventId = 'pke_smoke_runner_001';
    const entityId = 'smoke_runner';
    const projectCode = 'brainbase';
    const projectId = 'project-brainbase-id';
    const organizationId = 'org-smoke';
    const ownerPersonId = 'owner-person';
    const reviewerPersonId = 'reviewer-person';
    const ownerExternalSubject = 'oauth-owner-subject';
    const reviewerExternalSubject = 'oauth-reviewer-subject';
    const body = `synthetic production smoke ${runId}`;
    const normalizedPayload = {
        schema_version: 'personal_knowledge_normalized.v1',
        kind: 'decision',
        entity: { id: entityId, type: 'decision', payload: { statement: 'synthetic smoke decision' } },
        edges: [], context_entities: [], decision_domain: 'production_smoke',
        sensitivity: 'internal', role_min: 'member'
    };
    const normalizedPayloadHash = normalizePromotionPayload(normalizedPayload).normalized_payload_hash;
    const requestId = `kpr_${sha256(`${eventId}:${projectCode}:${normalizedPayloadHash}`).slice(0, 24)}`;
    return {
        schema_version: 'personal_knowledge_promotion_production_smoke.v1',
        synthetic: true,
        data_class: 'synthetic',
        run_id: runId,
        event: {
            event_id: eventId, body, body_hash: `sha256:${sha256(body)}`,
            source: { type: 'production_smoke' }, source_pointer: { run_id: runId }
        },
        request: {
            project_code: projectCode, summary: 'synthetic production smoke',
            subject: { type: 'decision', id: entityId }, normalized_payload: normalizedPayload,
            signed_context: signedContext('request', `personal-knowledge://events/${eventId}`, null, null, {
                personId: ownerPersonId, externalSubject: ownerExternalSubject, organizationId, projectId
            })
        },
        owner: {
            signed_context: signedContext(
                'owner_consent', `personal-knowledge://promotions/${requestId}`, requestId, normalizedPayloadHash, {
                    personId: ownerPersonId, externalSubject: ownerExternalSubject, organizationId, projectId
                }
            )
        },
        organization: {
            signed_context: signedContext(
                'organization_review', `personal-knowledge://promotions/${requestId}`, requestId, normalizedPayloadHash, {
                    personId: reviewerPersonId, externalSubject: reviewerExternalSubject, organizationId, projectId
                }
            )
        }
    };
}

function runnerReadbackPool(parsed, {
    dbReceiptMismatch = false, replayReceiptMutation = false, authorityUsesInvalid = false,
    readbackRoleInvalid = false, graphAggregate = '0'
} = {}) {
    const receipt = {
        request_id: parsed.requestId,
        organization_event_id: `kev_${parsed.runId}`,
        graph_entity_id: parsed.entityId,
        owner_consent_receipt_id: 'pkoc_runner',
        organization_review_receipt_id: 'pkor_runner'
    };
    const acceptedPromotion = {
        ...receipt,
        personal_event_id: parsed.eventId,
        status: 'org_accepted',
        normalized_payload_hash: parsed.normalizedPayloadHash
    };
    const authorities = authorityUsesInvalid
        ? [{ action: 'request', count: 2 }, { action: 'owner_consent', count: 1 }]
        : [
            { action: 'request', count: 1 },
            { action: 'owner_consent', count: 1 },
            { action: 'organization_review', count: 1 }
        ];
    const states = [
        {
            event: null,
            promotion: null,
            organizationEvent: null,
            lineage: [],
            authorities: [],
            graphEdges: graphAggregate
        },
        {
            event: {
                event_id: parsed.eventId,
                body_hash: parsed.event.body_hash,
                body_present: true,
                body_length: parsed.event.body.length
            },
            promotion: {
                ...acceptedPromotion,
                ...(dbReceiptMismatch ? { owner_consent_receipt_id: 'pkoc_other' } : {})
            },
            organizationEvent: {
                event_id: acceptedPromotion.organization_event_id,
                semantic_state: 'active',
                graph_entity_id: parsed.entityId,
                personal_body_found_in_payload: false
            },
            lineage: [{
                lineage_id: 'lineage_runner',
                personal_event_id: parsed.eventId,
                organization_event_id: acceptedPromotion.organization_event_id,
                promotion_request_id: parsed.requestId,
                normalized_payload_hash: parsed.normalizedPayloadHash,
                owner_consent_receipt_id: dbReceiptMismatch ? 'pkoc_other' : 'pkoc_runner',
                organization_review_receipt_id: 'pkor_runner',
                graph_entity_id: parsed.entityId
            }],
            authorities,
            graphEdges: graphAggregate
        },
        {
            event: {
                event_id: parsed.eventId,
                body_hash: parsed.event.body_hash,
                body_present: true,
                body_length: parsed.event.body.length
            },
            promotion: {
                ...acceptedPromotion,
                ...(dbReceiptMismatch ? { owner_consent_receipt_id: 'pkoc_other' } : {}),
                ...(replayReceiptMutation ? { organization_review_receipt_id: 'pkor_changed' } : {})
            },
            organizationEvent: {
                event_id: acceptedPromotion.organization_event_id,
                semantic_state: 'active',
                graph_entity_id: parsed.entityId,
                personal_body_found_in_payload: false
            },
            lineage: [{
                lineage_id: 'lineage_runner',
                personal_event_id: parsed.eventId,
                organization_event_id: acceptedPromotion.organization_event_id,
                promotion_request_id: parsed.requestId,
                normalized_payload_hash: parsed.normalizedPayloadHash,
                owner_consent_receipt_id: dbReceiptMismatch ? 'pkoc_other' : 'pkoc_runner',
                organization_review_receipt_id: replayReceiptMutation ? 'pkor_changed' : 'pkor_runner',
                graph_entity_id: parsed.entityId
            }],
            authorities,
            graphEdges: graphAggregate
        }
    ];
    let stateIndex = 0;
    const query = async (sql) => {
        if (sql.includes('FROM pg_roles')) {
            return { rows: [{ rolsuper: readbackRoleInvalid, rolbypassrls: false }] };
        }
        const state = states[stateIndex];
        if (sql.includes('FROM personal_knowledge_events')) return { rows: state.event ? [state.event] : [] };
        if (sql.includes('FROM knowledge_promotion_requests')) return { rows: state.promotion ? [state.promotion] : [] };
        if (sql.includes('FROM knowledge_promotion_lineage')) return { rows: state.lineage };
        if (sql.includes('FROM knowledge_promotion_authority_uses')) return { rows: state.authorities };
        if (sql.includes('FROM knowledge_event_current event')) return { rows: state.organizationEvent ? [state.organizationEvent] : [] };
        if (sql.includes('FROM graph_edges')) {
            const result = { rows: [{ count: String(state.graphEdges) }] };
            stateIndex += 1;
            return result;
        }
        throw new Error(`unexpected SQL: ${sql}`);
    };
    return {
        async connect() {
            return {
                async query(sql, params) {
                    if (/^BEGIN READ ONLY$/u.test(sql.trim()) || /^COMMIT$/u.test(sql.trim()) || /^ROLLBACK$/u.test(sql.trim())) {
                        return { rows: [] };
                    }
                    if (sql.includes('set_config')) return { rows: [{ set_config: params?.[1] ?? null }] };
                    return query(sql);
                },
                release() {}
            };
        },
        async end() {}
    };
}

function runnerFetch(parsed) {
    let graphReadCount = 0;
    let organizationDecisionCount = 0;
    return async (input, init = {}) => {
        const url = new URL(input);
        const authorization = init.headers?.authorization || init.headers?.Authorization || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
        if (url.pathname === '/api/auth/verify') {
            const access = token === 'owner-token'
                ? {
                    personId: 'owner-person', organizationId: 'org-smoke', projectCodes: ['brainbase'],
                    role: 'member', clearance: ['internal']
                }
                : token === 'reviewer-token'
                    ? {
                        personId: 'reviewer-person', organizationId: 'org-smoke', projectCodes: ['brainbase'],
                        role: 'gm', clearance: ['internal']
                    }
                    : null;
            return access
                ? { status: 200, async json() { return { ok: true, authMode: 'bearer', access }; } }
                : { status: 401, async json() { return { ok: false }; } };
        }
        if (url.pathname === '/api/csrf-token') return { status: 200, async json() { return { token: 'csrf-token' }; } };
        if (url.pathname === '/api/info/graph/entities') {
            graphReadCount += 1;
            return {
                status: 200,
                async json() {
                    return graphReadCount === 1 ? { records: [] } : { records: [{ id: parsed.entityId }] };
                }
            };
        }
        if (url.pathname === '/api/personal-knowledge/events') return { status: 201, async json() { return {}; } };
        if (url.pathname.endsWith(`/events/${parsed.eventId}/promotion-requests`)) {
            return { status: 202, async json() { return { request_id: parsed.requestId }; } };
        }
        if (url.pathname.endsWith(`/promotions/${parsed.requestId}/owner-decision`)) {
            return { status: 200, async json() { return { owner_consent_receipt_id: 'pkoc_runner' }; } };
        }
        if (url.pathname.endsWith(`/promotions/${parsed.requestId}/organization-decision`)) {
            organizationDecisionCount += 1;
            if (organizationDecisionCount === 1) {
                return {
                    status: 200,
                    async json() {
                        return {
                            request_id: parsed.requestId,
                            organization_event_id: `kev_${parsed.runId}`,
                            graph_entity_id: parsed.entityId,
                            owner_consent_receipt_id: 'pkoc_runner',
                            organization_review_receipt_id: 'pkor_runner'
                        };
                    }
                };
            }
            return {
                status: 409,
                async json() { return { error: 'personal_knowledge_promotion_authority_replayed' }; }
            };
        }
        throw new Error(`unexpected fetch: ${url.pathname}`);
    };
}

async function runSyntheticSmoke(options = {}) {
    const fixture = options.fixture || runnerFixture();
    const parsed = parseSmokeFixture(fixture);
    return runSmoke({
        fixture,
        baseUrl: 'https://brainbase.test',
        ownerToken: 'owner-token',
        reviewerToken: 'reviewer-token',
        csrfToken: 'csrf-token',
        databaseUrl: 'postgres://synthetic.invalid/brainbase',
        fetchImpl: options.fetchImpl || runnerFetch(parsed),
        poolFactory: () => runnerReadbackPool(parsed, options)
    });
}

function authVariantFetch(parsed, {
    ownerResponse,
    reviewerResponse,
    onRequest
} = {}) {
    const baseFetch = runnerFetch(parsed);
    return async (input, init = {}) => {
        const url = new URL(input);
        const authorization = init.headers?.authorization || init.headers?.Authorization || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
        onRequest?.(url, init);
        if (url.pathname === '/api/auth/verify') {
            if (token === 'owner-token' && ownerResponse) return ownerResponse;
            if (token === 'reviewer-token' && reviewerResponse) return reviewerResponse;
        }
        return baseFetch(input, init);
    };
}

function authResponse(access, { ok = true, authMode = 'bearer', status = 200 } = {}) {
    return {
        status,
        async json() { return { ok, authMode, ...(access ? { access } : {}) }; }
    };
}

describe('Personal KG production smoke evidence helpers', () => {
    it('rejects a fixture whose body hash is not the synthetic body hash', () => {
        expect(() => parseSmokeFixture(fixture())).toThrowError('fixture_body_hash_invalid');
    });

    it('redacts receipt fields to correlation-safe identifiers', () => {
        expect(redactReceipt({
            request_id: 'kpr_smoke', organization_event_id: 'evt_smoke', graph_entity_id: 'smoke_entity',
            owner_consent_receipt_id: 'pkoc_smoke', organization_review_receipt_id: 'pkor_smoke',
            body: 'must not be copied', normalized_payload: { statement: 'must not be copied' }
        })).toEqual({
            request_id: 'kpr_smoke', organization_event_id: 'evt_smoke', graph_entity_id: 'smoke_entity',
            owner_consent_receipt_id: 'pkoc_smoke', organization_review_receipt_id: 'pkor_smoke'
        });
    });

    it('fails evidence safety when a personal body or forbidden key is present', () => {
        expect(() => assertSafeEvidence({ body: 'personal text' }, { body: 'personal text' }))
            .toThrowError('personal_data_output_key_detected');
        expect(() => assertSafeEvidence({ value: 'personal text' }, { body: 'personal text' }))
            .toThrowError('personal_body_output_detected');
        for (const key of ['personal_event_id', 'sanitized_preview', 'body_hash']) {
            expect(() => assertSafeOrganizationResponse({ [key]: 'private' }))
                .toThrowError('personal_data_output_key_detected');
        }
        expect(assertSafeEvidence({
            correlation: { personal_event_id: 'pke_synthetic', normalized_payload_hash: 'sha256:synthetic' },
            db: { event: { body_hash: 'sha256:synthetic' } }
        })).toBe(true);
    });

    it('rejects a Graph readback that contains the Personal body', () => {
        expect(() => assertGraphBodyAbsent({ records: [{ id: 'smoke_entity', payload: { statement: 'personal text' } }] }, 'personal text'))
            .toThrowError('personal_body_copied_to_graph');
        expect(assertGraphBodyAbsent({ records: [{ id: 'smoke_entity', semantic_state: 'active' }] }, 'personal text'))
            .toBe(true);
    });

    it('rejects a production DB readback when incident Graph edge count differs from the normalized payload', () => {
        const parsed = {
            eventId: 'pke_smoke', requestId: 'kpr_smoke', entityId: 'decision_smoke',
            normalizedPayload: { edges: [] }, normalizedPayloadHash: 'sha256:normalized'
        };
        const state = {
            db: {
                event: { event_id: parsed.eventId, body_present: true },
                promotion: {
                    request_id: parsed.requestId, status: 'org_accepted', graph_entity_id: parsed.entityId,
                    organization_event_id: 'kev_smoke', personal_event_id: parsed.eventId,
                    normalized_payload_hash: parsed.normalizedPayloadHash,
                    owner_consent_receipt_id: 'pkoc_smoke', organization_review_receipt_id: 'pkor_smoke'
                },
                organization_event: {
                    event_id: 'kev_smoke', graph_entity_id: parsed.entityId,
                    personal_body_found_in_payload: false
                },
                lineage: [{
                    personal_event_id: parsed.eventId,
                    organization_event_id: 'kev_smoke', promotion_request_id: parsed.requestId,
                    normalized_payload_hash: parsed.normalizedPayloadHash,
                    owner_consent_receipt_id: 'pkoc_smoke',
                    organization_review_receipt_id: 'pkor_smoke', graph_entity_id: parsed.entityId
                }],
                authority_uses: [
                    { action: 'request', count: 1 },
                    { action: 'owner_consent', count: 1 },
                    { action: 'organization_review', count: 1 }
                ],
                incident_graph_edge_count: 1
            },
            graph: [{ id: parsed.entityId }], receipt: {}
        };

        expect(() => assertAcceptedState(state, parsed)).toThrowError('db_graph_edge_count_mismatch');
        state.db.incident_graph_edge_count = 0;
        expect(() => assertAcceptedState(state, parsed)).not.toThrow();
    });

    it('maps the production promotion request id through DB readback and rejects missing or mismatched ids', async () => {
        const parsed = {
            eventId: READBACK.eventId,
            requestId: READBACK.requestId,
            entityId: READBACK.entityId,
            normalizedPayload: { edges: [] }, normalizedPayloadHash: 'sha256:normalized'
        };
        const state = await readbackState();

        expect(state.db.promotion).toMatchObject({ request_id: READBACK.requestId });
        expect(state.db.event).not.toHaveProperty('body');
        expect(state.db.organization_event.personal_body_found_in_payload).toBe(false);
        expect(() => assertAcceptedState(state, parsed)).not.toThrow();

        for (const promotionRequestId of [null, 'kpr_other_readback']) {
            const invalidState = await readbackState(promotionRequestId);
            expect(() => assertAcceptedState(invalidState, parsed))
                .toThrowError('db_promotion_readback_mismatch');
        }
    });

    it('correlates the first API receipt with every DB receipt field before passing evidence', async () => {
        await expect(runSyntheticSmoke({ dbReceiptMismatch: true }))
            .rejects.toThrowError('organization_receipt_db_mismatch');
    });

    it('compares a fresh replay DB receipt instead of reusing the first API receipt', async () => {
        await expect(runSyntheticSmoke({ replayReceiptMutation: true }))
            .rejects.toThrowError('replay_mutation_diff_nonzero');
    });

    it('requires exactly one authority use for each promotion stage', async () => {
        await expect(runSyntheticSmoke({ authorityUsesInvalid: true }))
            .rejects.toThrowError('db_authority_use_count_mismatch');
    });

    it('verifies both bearer accesses before creating a pool or calling a business endpoint', async () => {
        const fixture = runnerFixture();
        const parsed = parseSmokeFixture(fixture);
        const calls = [];
        const fetchImpl = authVariantFetch(parsed, {
            ownerResponse: authResponse(null, { ok: false, status: 401 }),
            onRequest(url) { calls.push(url.pathname); }
        });
        await expect(runSmoke({
            fixture,
            baseUrl: 'https://brainbase.test',
            ownerToken: 'owner-token', reviewerToken: 'reviewer-token', csrfToken: 'csrf-token',
            databaseUrl: 'postgres://synthetic.invalid/brainbase', fetchImpl,
            poolFactory() { throw new Error('pool must not be created'); }
        })).rejects.toThrowError('owner_auth_verify_failed');
        expect(calls).toEqual(['/api/auth/verify']);
    });

    it('requires a distinct GM or CEO reviewer identity with complete verified access', async () => {
        const fixture = runnerFixture();
        const parsed = parseSmokeFixture(fixture);
        const ownerAccess = {
            personId: 'owner-person', organizationId: 'org-smoke', projectCodes: ['brainbase'],
            role: 'member', clearance: ['internal']
        };
        const samePersonReviewer = {
            personId: 'owner-person', organizationId: 'org-smoke', projectCodes: ['brainbase'],
            role: 'gm', clearance: ['internal']
        };
        const fetchImpl = authVariantFetch(parsed, {
            ownerResponse: authResponse(ownerAccess),
            reviewerResponse: authResponse(samePersonReviewer)
        });
        await expect(runSmoke({
            fixture,
            baseUrl: 'https://brainbase.test',
            ownerToken: 'owner-token', reviewerToken: 'reviewer-token', csrfToken: 'csrf-token',
            databaseUrl: 'postgres://synthetic.invalid/brainbase', fetchImpl,
            poolFactory() { throw new Error('pool must not be created'); }
        })).rejects.toThrowError('distinct_reviewer_required');

        const nonApproverReviewer = {
            personId: 'reviewer-person', organizationId: 'org-smoke', projectCodes: ['brainbase'],
            role: 'member', clearance: ['internal']
        };
        await expect(runSmoke({
            fixture,
            baseUrl: 'https://brainbase.test',
            ownerToken: 'owner-token', reviewerToken: 'reviewer-token', csrfToken: 'csrf-token',
            databaseUrl: 'postgres://synthetic.invalid/brainbase',
            fetchImpl: authVariantFetch(parsed, {
                ownerResponse: authResponse(ownerAccess), reviewerResponse: authResponse(nonApproverReviewer)
            }),
            poolFactory() { throw new Error('pool must not be created'); }
        })).rejects.toThrowError('reviewer_role_invalid');
    });

    it('rejects a signed context whose canonical actor does not match verified access before pool creation', async () => {
        const fixture = runnerFixture();
        fixture.owner.signed_context.actor.principal_id = 'reviewer-person';
        const parsed = parseSmokeFixture(fixture);
        await expect(runSmoke({
            fixture,
            baseUrl: 'https://brainbase.test',
            ownerToken: 'owner-token', reviewerToken: 'reviewer-token', csrfToken: 'csrf-token',
            databaseUrl: 'postgres://synthetic.invalid/brainbase', fetchImpl: runnerFetch(parsed),
            poolFactory() { throw new Error('pool must not be created'); }
        })).rejects.toThrowError('owner_context_person_mismatch');
    });

    it('uses a READ ONLY transaction and all six app access settings for every DB query', async () => {
        const operations = [];
        const pool = fakeReadbackPool();
        const originalConnect = pool.connect;
        pool.connect = async () => {
            const client = await originalConnect();
            const originalQuery = client.query.bind(client);
            client.query = async (sql, params) => {
                operations.push({ sql: sql.trim(), params });
                return originalQuery(sql, params);
            };
            return client;
        };
        await readDbState(pool, {
            eventId: READBACK.eventId,
            requestId: READBACK.requestId,
            entityId: READBACK.entityId,
            body: READBACK.body,
            access: READBACK_ACCESS
        });
        const begins = operations.filter(({ sql }) => sql === 'BEGIN READ ONLY');
        const commits = operations.filter(({ sql }) => sql === 'COMMIT');
        expect(begins).toHaveLength(6);
        expect(commits).toHaveLength(6);
        const settingKeys = operations
            .filter(({ sql }) => sql.includes('set_config'))
            .map(({ params }) => params?.[0]);
        expect(settingKeys).toHaveLength(36);
        for (const setting of [
            'app.person_id', 'app.actor_person_id', 'app.organization_id', 'app.project_codes',
            'app.role', 'app.clearance'
        ]) {
            expect(settingKeys.filter((key) => key === setting)).toHaveLength(6);
        }
    });

    it('destroys a readback connection when BEGIN or ROLLBACK fails', async () => {
        function transactionPool({ beginError = false, queryError = false, rollbackError = false } = {}) {
            const releases = [];
            return {
                releases,
                async connect() {
                    return {
                        async query(sql) {
                            const statement = sql.trim();
                            if (statement === 'BEGIN READ ONLY' && beginError) throw new Error('begin failed');
                            if (statement === 'ROLLBACK' && rollbackError) throw new Error('rollback failed');
                            if (queryError && statement === 'SELECT target') throw new Error('query failed');
                            return { rows: [] };
                        },
                        release(destroy) { releases.push(destroy); }
                    };
                }
            };
        }

        const successPool = transactionPool();
        await withReadOnlyAccessTransaction(successPool, READBACK_ACCESS, 'SELECT target');
        expect(successPool.releases).toEqual([false]);

        const rollbackPool = transactionPool({ queryError: true });
        await expect(withReadOnlyAccessTransaction(rollbackPool, READBACK_ACCESS, 'SELECT target'))
            .rejects.toThrowError('query failed');
        expect(rollbackPool.releases).toEqual([false]);

        const rollbackFailurePool = transactionPool({ queryError: true, rollbackError: true });
        await expect(withReadOnlyAccessTransaction(rollbackFailurePool, READBACK_ACCESS, 'SELECT target'))
            .rejects.toThrowError('query failed');
        expect(rollbackFailurePool.releases).toEqual([true]);

        const beginFailurePool = transactionPool({ beginError: true });
        await expect(withReadOnlyAccessTransaction(beginFailurePool, READBACK_ACCESS, 'SELECT target'))
            .rejects.toThrowError('begin failed');
        expect(beginFailurePool.releases).toEqual([true]);
    });

    it('fails closed when the Graph edge aggregate row or count is invalid', async () => {
        for (const graphRows of [[], [{ count: 'not-a-number' }], [{ count: '-1' }], [{ count: '0\n' }]]) {
            await expect(readDbState(fakeReadbackPool(READBACK.requestId, { graphRows }), {
                eventId: READBACK.eventId,
                requestId: READBACK.requestId,
                entityId: READBACK.entityId,
                body: READBACK.body,
                access: READBACK_ACCESS
            })).rejects.toThrowError('db_graph_edge_count_invalid');
        }
    });

    it('rejects a superuser or bypassrls readback role before any business mutation', async () => {
        await expect(runSyntheticSmoke({ readbackRoleInvalid: true }))
            .rejects.toThrowError('readback_role_invalid');
    });

    it('passes the synthetic runner when the fresh receipt is unchanged', async () => {
        const evidence = await runSyntheticSmoke();
        const parsed = parseSmokeFixture(runnerFixture());
        expect(evidence.replay.receipt_mutation_diff_zero).toBe(true);
        expect(evidence.after_first.receipt).toEqual({
            request_id: parsed.requestId,
            organization_event_id: 'kev_p0_smoke_runner_001',
            graph_entity_id: 'smoke_runner',
            owner_consent_receipt_id: 'pkoc_runner',
            organization_review_receipt_id: 'pkor_runner'
        });
    });
});
