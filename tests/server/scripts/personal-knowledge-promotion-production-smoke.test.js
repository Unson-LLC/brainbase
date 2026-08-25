import { describe, expect, it } from 'vitest';

import {
    assertAcceptedState,
    assertSafeEvidence,
    assertSafeOrganizationResponse,
    assertGraphBodyAbsent,
    parseSmokeFixture,
    redactReceipt
} from '../../../scripts/personal-knowledge-promotion-production-smoke.mjs';

function signedContext(action, resourceRef, requestId = null, normalizedPayloadHash = null) {
    return {
        integrity: { method: 'jws_detached', algorithm: 'EdDSA', value: 'signed-fixture-value' },
        operation_id: `op_${action}`,
        idempotency_key: `idem_${action}`,
        issued_at: '2026-08-25T00:00:00.000Z',
        expires_at: '2026-08-25T00:05:00.000Z',
        authority: {
            action, resource_ref: resourceRef, request_id: requestId,
            normalized_payload_hash: normalizedPayloadHash
        }
    };
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
            normalizedPayload: { edges: [] }
        };
        const state = {
            db: {
                event: { event_id: parsed.eventId, body_present: true },
                promotion: {
                    request_id: parsed.requestId, status: 'org_accepted', graph_entity_id: parsed.entityId,
                    organization_event_id: 'kev_smoke'
                },
                organization_event: {
                    event_id: 'kev_smoke', graph_entity_id: parsed.entityId,
                    personal_body_found_in_payload: false
                },
                lineage: [{}], authority_uses: [{ count: 3 }], incident_graph_edge_count: 1
            },
            graph: [{ id: parsed.entityId }], receipt: {}
        };

        expect(() => assertAcceptedState(state, parsed)).toThrowError('db_graph_edge_count_mismatch');
        state.db.incident_graph_edge_count = 0;
        expect(() => assertAcceptedState(state, parsed)).not.toThrow();
    });
});
