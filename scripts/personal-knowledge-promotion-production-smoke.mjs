#!/usr/bin/env node

/**
 * Customer-data-free production smoke for the Personal KG promotion boundary.
 *
 * The fixture is minted by the authority producer. This script deliberately
 * never prints the fixture body, normalized payload, signed context, tokens, or
 * raw API responses. A successful report is therefore safe to attach to a
 * deployment receipt while still correlating the database, Graph, and receipt
 * projections for one synthetic run.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { normalizePromotionPayload } from '../server/services/personal-knowledge/personal-knowledge-normalization.js';

const { Pool } = pg;
const SYNTHETIC_RUN_ID = /^p0_smoke_[a-z0-9][a-z0-9_-]{5,127}$/iu;
const SYNTHETIC_EVENT_ID = /^pke_smoke_[a-z0-9][a-z0-9_-]{5,127}$/iu;
const SYNTHETIC_ENTITY_ID = /^smoke_[a-z0-9][a-z0-9_-]{2,127}$/iu;
const SAFE_FAILURE_CODE = /^[a-z][a-z0-9_]{2,80}$/u;
const FORBIDDEN_ORGANIZATION_RESPONSE_KEY = /^(?:body|body_hash|raw|transcript|conversation|message|prompt|private|personal|personal_event_id|excerpt|preview|sanitized_preview|content|note|token|authorization|signed_context|subject|reason)$/iu;
const FORBIDDEN_EVIDENCE_KEY = /^(?:body|raw|transcript|conversation|message|prompt|private|personal|excerpt|preview|sanitized_preview|content|note|token|authorization|signed_context|normalized_payload|subject|reason)$/iu;

class SmokeFailure extends Error {
    constructor(code) {
        super(code);
        this.name = 'SmokeFailure';
        this.code = SAFE_FAILURE_CODE.test(code) ? code : 'production_smoke_failed';
    }
}

function fail(code) {
    throw new SmokeFailure(code);
}

function assert(condition, code) {
    if (!condition) fail(code);
}

function sha256(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    }
    return value;
}

function stableJson(value) {
    return JSON.stringify(stable(value));
}

function equalStable(left, right) {
    return stableJson(left) === stableJson(right);
}

function assertSignedContext(value, label) {
    assert(value && typeof value === 'object' && !Array.isArray(value), `${label}_context_invalid`);
    assert(value.integrity?.method === 'jws_detached', `${label}_context_unsigned`);
    assert(value.integrity?.algorithm === 'EdDSA', `${label}_context_unsigned`);
    assert(typeof value.integrity?.value === 'string' && value.integrity.value.length > 20, `${label}_context_unsigned`);
    assert(value.authority && typeof value.authority === 'object', `${label}_authority_missing`);
    assert(typeof value.operation_id === 'string' && value.operation_id, `${label}_operation_id_missing`);
    assert(typeof value.idempotency_key === 'string' && value.idempotency_key, `${label}_idempotency_key_missing`);
    assert(typeof value.issued_at === 'string' && typeof value.expires_at === 'string', `${label}_context_window_missing`);
}

function assertAuthority(value, { label, action, resourceRef, requestId, normalizedPayloadHash }) {
    assertSignedContext(value, label);
    const authority = value.authority;
    assert(authority.action === action, `${label}_authority_action_mismatch`);
    assert(authority.resource_ref === resourceRef, `${label}_authority_target_mismatch`);
    assert((authority.request_id ?? null) === (requestId ?? null), `${label}_authority_request_mismatch`);
    assert((authority.normalized_payload_hash ?? null) === (normalizedPayloadHash ?? null), `${label}_authority_hash_mismatch`);
}

const REVIEWER_ROLES = new Set(['gm', 'ceo']);
const READBACK_SETTINGS = Object.freeze([
    'app.person_id',
    'app.actor_person_id',
    'app.organization_id',
    'app.project_codes',
    'app.role',
    'app.clearance'
]);

function strictAccessString(value, code) {
    assert(typeof value === 'string' && value.length > 0 && value.trim() === value, code);
    assert(!value.includes(',') && !/\s/u.test(value), code);
    return value;
}

function strictAccessList(value, code) {
    assert(Array.isArray(value) && value.length > 0, code);
    assert(value.every((item) => typeof item === 'string'
        && item.length > 0
        && item.trim() === item
        && !item.includes(',')
        && !/\s/u.test(item)), code);
    assert(new Set(value).size === value.length, code);
    return [...value];
}

function assertAccessShape(access, label) {
    assert(access && typeof access === 'object' && !Array.isArray(access), `${label}_access_missing`);
    const personId = strictAccessString(access.personId, `${label}_person_missing`);
    const organizationId = strictAccessString(access.organizationId, `${label}_organization_missing`);
    const projectCodes = strictAccessList(access.projectCodes, `${label}_project_access_missing`);
    const role = strictAccessString(access.role, `${label}_role_missing`);
    const clearance = strictAccessList(access.clearance, `${label}_clearance_missing`);
    return {
        personId,
        actorPersonId: personId,
        organizationId,
        projectCodes,
        role,
        clearance
    };
}

/**
 * Verify the access the production API derives from a real Bearer token.
 * The returned actor ID is intentionally derived only from access.personId.
 */
export async function verifySmokeAccess(fetchImpl, baseUrl, token, {
    label, projectCode, reviewer = false, sessionId
} = {}) {
    assert(typeof label === 'string' && label, 'auth_label_invalid');
    assert(typeof token === 'string' && token, `${label}_token_missing`);
    const response = await requestJson(fetchImpl, baseUrl, {
        path: '/api/auth/verify', token, sessionId
    });
    const payload = expectStatus(response, 200, `${label}_auth_verify_failed`);
    assert(payload.ok === true, `${label}_auth_verify_failed`);
    assert(payload.authMode === 'bearer', `${label}_auth_mode_invalid`);
    const access = assertAccessShape(payload.access, label);
    assert(typeof projectCode === 'string' && projectCode.length > 0, 'fixture_project_code_missing');
    assert(access.projectCodes.includes(projectCode), `${label}_project_access_missing`);
    if (reviewer) assert(REVIEWER_ROLES.has(access.role), `${label}_reviewer_role_invalid`);
    return access;
}

/**
 * Bind a producer-issued TenantContext (the direct issuer wire shape) to the
 * verified API access. authenticated_subject_id remains an external subject;
 * canonical person identity is always actor.principal_id.
 */
export function assertSignedContextAccessBinding(context, access, {
    label, expectedProjectId
} = {}) {
    assert(typeof label === 'string' && label, 'context_label_invalid');
    const verifiedAccess = assertAccessShape(access, label);
    assertSignedContext(context, label);
    const actor = context.actor;
    const authorization = context.authorization;
    assert(actor && typeof actor === 'object' && !Array.isArray(actor), `${label}_context_actor_missing`);
    assert(actor.principal_type === 'person', `${label}_context_actor_invalid`);
    const principalId = strictAccessString(actor.principal_id, `${label}_context_person_missing`);
    strictAccessString(actor.authenticated_subject_id, `${label}_context_subject_missing`);
    assert(principalId === verifiedAccess.personId, `${label}_context_person_mismatch`);
    assert(authorization && typeof authorization === 'object' && !Array.isArray(authorization),
        `${label}_context_authorization_missing`);
    const organizationIds = strictAccessList(authorization.organization_ids, `${label}_context_organization_missing`);
    const projectIds = strictAccessList(authorization.project_ids, `${label}_context_project_missing`);
    strictAccessList(authorization.capability_ids, `${label}_context_capability_missing`);
    assert(organizationIds.includes(verifiedAccess.organizationId), `${label}_context_organization_mismatch`);
    if (expectedProjectId !== undefined) {
        const canonicalProjectId = strictAccessString(expectedProjectId, `${label}_context_project_missing`);
        assert(projectIds.includes(canonicalProjectId), `${label}_context_project_mismatch`);
    }
    return projectIds;
}

function normalizeReadbackAccess(access) {
    const verifiedAccess = assertAccessShape(access, 'readback');
    assert(access.actorPersonId === verifiedAccess.personId, 'readback_actor_person_mismatch');
    return verifiedAccess;
}

export async function withReadOnlyAccessTransaction(pool, access, text, params = []) {
    const normalizedAccess = normalizeReadbackAccess(access);
    assert(pool && typeof pool.connect === 'function', 'readback_pool_invalid');
    const client = await pool.connect();
    let destroy = true;
    let began = false;
    try {
        assert(client && typeof client.query === 'function' && typeof client.release === 'function', 'readback_pool_invalid');
        destroy = false;
        await client.query('BEGIN READ ONLY');
        began = true;
        const values = [
            normalizedAccess.personId,
            normalizedAccess.actorPersonId,
            normalizedAccess.organizationId,
            normalizedAccess.projectCodes.join(','),
            normalizedAccess.role,
            normalizedAccess.clearance.join(',')
        ];
        for (const [index, setting] of READBACK_SETTINGS.entries()) {
            await client.query('SELECT set_config($1, $2, true)', [setting, values[index]]);
        }
        const result = await client.query(text, params);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        if (began) {
            try {
                await client.query('ROLLBACK');
            } catch {
                destroy = true;
            }
        } else {
            // A failed BEGIN leaves the transaction state unknown.
            destroy = true;
        }
        throw error;
    } finally {
        if (client && typeof client.release === 'function') client.release(destroy);
    }
}

/**
 * Reject administrative readback roles so RLS evidence cannot be bypassed.
 */
export async function assertReadbackRole(pool) {
    assert(pool && typeof pool.connect === 'function', 'readback_pool_invalid');
    const client = await pool.connect();
    let destroy = true;
    let began = false;
    try {
        assert(client && typeof client.query === 'function' && typeof client.release === 'function', 'readback_pool_invalid');
        destroy = false;
        await client.query('BEGIN READ ONLY');
        began = true;
        const result = await client.query(`
          SELECT rolsuper, rolbypassrls
          FROM pg_roles
          WHERE rolname = current_user`);
        assert(Array.isArray(result?.rows) && result.rows.length === 1, 'readback_role_invalid');
        const [row] = result.rows;
        assert(row.rolsuper === false && row.rolbypassrls === false, 'readback_role_invalid');
        await client.query('COMMIT');
    } catch (error) {
        if (began) {
            try {
                await client.query('ROLLBACK');
            } catch {
                destroy = true;
            }
        } else {
            // A failed BEGIN leaves the transaction state unknown.
            destroy = true;
        }
        if (error instanceof SmokeFailure) throw error;
        fail('readback_role_invalid');
    } finally {
        if (client && typeof client.release === 'function') client.release(destroy);
    }
    return true;
}

/**
 * Validate a producer-issued smoke fixture and derive identifiers without
 * making any network or database call.
 */
export function parseSmokeFixture(fixture) {
    assert(fixture?.schema_version === 'personal_knowledge_promotion_production_smoke.v1', 'fixture_schema_invalid');
    assert(fixture.synthetic === true && fixture.data_class === 'synthetic', 'fixture_not_synthetic');
    assert(typeof fixture.run_id === 'string' && SYNTHETIC_RUN_ID.test(fixture.run_id), 'fixture_run_id_invalid');
    const event = fixture.event;
    assert(event && typeof event === 'object', 'fixture_event_missing');
    assert(typeof event.event_id === 'string' && SYNTHETIC_EVENT_ID.test(event.event_id), 'fixture_event_id_invalid');
    assert(typeof event.body === 'string' && event.body.length > 0, 'fixture_body_missing');
    assert(event.body.includes(fixture.run_id), 'fixture_body_run_id_missing');
    assert(typeof event.body_hash === 'string' && event.body_hash === `sha256:${sha256(event.body)}`, 'fixture_body_hash_invalid');
    assert(event.source && typeof event.source === 'object' && !Array.isArray(event.source), 'fixture_source_invalid');
    assert(event.source_pointer && typeof event.source_pointer === 'object' && !Array.isArray(event.source_pointer), 'fixture_source_pointer_invalid');

    const request = fixture.request;
    assert(request && typeof request === 'object', 'fixture_request_missing');
    assert(typeof request.project_code === 'string' && request.project_code, 'fixture_project_code_missing');
    assert(typeof request.summary === 'string' && request.summary, 'fixture_summary_missing');
    assert(request.subject && typeof request.subject === 'object', 'fixture_subject_missing');
    const normalizedResult = normalizePromotionPayload(request.normalized_payload);
    const requestId = `kpr_${sha256(`${event.event_id}:${request.project_code}:${normalizedResult.normalized_payload_hash}`).slice(0, 24)}`;
    const entityId = normalizedResult.normalized.entity.id;
    assert(SYNTHETIC_ENTITY_ID.test(entityId), 'fixture_entity_id_invalid');
    const eventRef = `personal-knowledge://events/${event.event_id}`;
    const requestRef = `personal-knowledge://promotions/${requestId}`;
    assertAuthority(request.signed_context, {
        label: 'request', action: 'request', resourceRef: eventRef,
        requestId: null, normalizedPayloadHash: null
    });
    assertAuthority(fixture.owner?.signed_context, {
        label: 'owner', action: 'owner_consent', resourceRef: requestRef,
        requestId, normalizedPayloadHash: normalizedResult.normalized_payload_hash
    });
    assertAuthority(fixture.organization?.signed_context, {
        label: 'organization', action: 'organization_review', resourceRef: requestRef,
        requestId, normalizedPayloadHash: normalizedResult.normalized_payload_hash
    });
    const operations = [
        request.signed_context.operation_id,
        fixture.owner.signed_context.operation_id,
        fixture.organization.signed_context.operation_id
    ];
    assert(new Set(operations).size === operations.length, 'fixture_operation_id_reused');
    assert(fixture.owner.signed_context.operation_id !== fixture.organization.signed_context.operation_id, 'fixture_reviewer_operation_reused');
    return {
        runId: fixture.run_id,
        eventId: event.event_id,
        event,
        projectCode: request.project_code,
        summary: request.summary,
        subject: request.subject,
        normalizedPayload: normalizedResult.normalized,
        normalizedPayloadHash: normalizedResult.normalized_payload_hash,
        requestId,
        entityId,
        requestContext: request.signed_context,
        ownerContext: fixture.owner.signed_context,
        organizationContext: fixture.organization.signed_context
    };
}

function encodeContext(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function safeGraphProjection(response) {
    const records = Array.isArray(response?.records) ? response.records : [];
    return records.map((record) => ({
        id: record.id ?? null,
        entity_type: record.entity_type ?? null,
        project_code: record.project_code ?? null,
        lifecycle_state: record.lifecycle_state ?? null,
        semantic_state: record.semantic_state ?? null,
        version: record.version ?? null,
        status: record.status ?? null
    }));
}

export function assertGraphBodyAbsent(response, body) {
    const serialized = JSON.stringify(response ?? {});
    assert(!body || !serialized.includes(body), 'personal_body_copied_to_graph');
    return true;
}

export function redactReceipt(response) {
    const value = response && typeof response === 'object' ? response : {};
    return {
        request_id: value.request_id ?? null,
        organization_event_id: value.organization_event_id ?? null,
        graph_entity_id: value.graph_entity_id ?? null,
        owner_consent_receipt_id: value.owner_consent_receipt_id ?? null,
        organization_review_receipt_id: value.organization_review_receipt_id ?? null
    };
}

const RECEIPT_FIELDS = Object.freeze([
    'request_id',
    'organization_event_id',
    'graph_entity_id',
    'owner_consent_receipt_id',
    'organization_review_receipt_id'
]);

function assertReceiptComplete(receipt, code) {
    assert(
        RECEIPT_FIELDS.every((field) => typeof receipt?.[field] === 'string' && receipt[field]),
        code
    );
    return true;
}

export function assertReceiptMatchesDb(receipt, promotion) {
    assertReceiptComplete(receipt, 'organization_receipt_incomplete');
    const dbReceipt = redactReceipt(promotion);
    assertReceiptComplete(dbReceipt, 'db_receipt_incomplete');
    assert(equalStable(receipt, dbReceipt), 'organization_receipt_db_mismatch');
    return dbReceipt;
}

function safeDbRow(row) {
    if (!row) return null;
    return {
        event_id: row.event_id ?? null,
        request_id: row.request_id ?? null,
        body_hash: row.body_hash ?? null,
        body_present: Boolean(row.body_present),
        body_length: row.body_length === null || row.body_length === undefined ? null : Number(row.body_length),
        status: row.status ?? null,
        personal_event_id: row.personal_event_id ?? null,
        organization_event_id: row.organization_event_id ?? null,
        graph_entity_id: row.graph_entity_id ?? null,
        normalized_payload_hash: row.normalized_payload_hash ?? null,
        owner_consent_receipt_id: row.owner_consent_receipt_id ?? null,
        organization_review_receipt_id: row.organization_review_receipt_id ?? null
    };
}

function safeOrganizationEventRow(row) {
    if (!row) return null;
    return {
        event_id: row.event_id ?? null,
        semantic_state: row.semantic_state ?? null,
        graph_entity_id: row.graph_entity_id ?? null,
        personal_body_found_in_payload: Boolean(row.personal_body_found_in_payload)
    };
}

export async function readDbState(pool, { eventId, requestId, entityId, body, access }) {
    normalizeReadbackAccess(access);
    const readQuery = (text, params) => withReadOnlyAccessTransaction(pool, access, text, params);
    const [events, requests, lineage, authorities, organizationEvents, graphEdges] = await Promise.all([
        readQuery(`
          SELECT event_id, body_hash, body IS NOT NULL AS body_present, length(body) AS body_length
          FROM personal_knowledge_events WHERE event_id = $1`, [eventId]),
        readQuery(`
          SELECT request_id, personal_event_id, organization_event_id, graph_entity_id, status,
                 normalized_payload_hash, owner_consent_receipt_id, organization_review_receipt_id
          FROM knowledge_promotion_requests WHERE request_id = $1`, [requestId]),
        readQuery(`
          SELECT lineage_id, personal_event_id, organization_event_id, promotion_request_id,
                 sanitization->>'normalized_payload_hash' AS normalized_payload_hash,
                 sanitization->>'owner_consent_receipt_id' AS owner_consent_receipt_id,
                 sanitization->>'organization_review_receipt_id' AS organization_review_receipt_id,
                 sanitization->>'graph_entity_id' AS graph_entity_id
          FROM knowledge_promotion_lineage WHERE promotion_request_id = $1`, [requestId]),
        readQuery(`
          SELECT action, count(*)::int AS count
          FROM knowledge_promotion_authority_uses WHERE request_id = $1
          GROUP BY action ORDER BY action`, [requestId]),
        readQuery(`
          SELECT event.event_id, event.semantic_state,
                 event.current_result->>'graph_entity_id' AS graph_entity_id,
                 position($2 in COALESCE(event.payload::text, '')) > 0 AS personal_body_found_in_payload
          FROM knowledge_event_current event
          JOIN knowledge_promotion_requests request
            ON request.organization_event_id = event.event_id
          WHERE request.request_id = $1`, [requestId, body]),
        readQuery(`
          SELECT count(*)::int AS count
          FROM graph_edges
          WHERE from_id = $1 OR to_id = $1`, [entityId])
    ]);
    assert(Array.isArray(graphEdges?.rows) && graphEdges.rows.length === 1, 'db_graph_edge_count_invalid');
    const rawGraphEdgeCount = graphEdges.rows[0]?.count;
    const graphEdgeCount = typeof rawGraphEdgeCount === 'number'
        ? rawGraphEdgeCount
        : typeof rawGraphEdgeCount === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(rawGraphEdgeCount)
            ? Number(rawGraphEdgeCount)
            : Number.NaN;
    assert(Number.isSafeInteger(graphEdgeCount) && graphEdgeCount >= 0, 'db_graph_edge_count_invalid');
    return {
        event: safeDbRow(events.rows[0]),
        promotion: safeDbRow(requests.rows[0]),
        organization_event: safeOrganizationEventRow(organizationEvents.rows[0]),
        lineage: lineage.rows.map((row) => ({
            lineage_id: row.lineage_id,
            personal_event_id: row.personal_event_id,
            organization_event_id: row.organization_event_id,
            promotion_request_id: row.promotion_request_id,
            normalized_payload_hash: row.normalized_payload_hash,
            owner_consent_receipt_id: row.owner_consent_receipt_id,
            organization_review_receipt_id: row.organization_review_receipt_id,
            graph_entity_id: row.graph_entity_id
        })),
        authority_uses: authorities.rows.map((row) => ({ action: row.action, count: Number(row.count) })),
        incident_graph_edge_count: graphEdgeCount
    };
}

function assertNoForbiddenOutputKeys(value, forbiddenKey) {
    if (Array.isArray(value)) {
        value.forEach((item) => assertNoForbiddenOutputKeys(item, forbiddenKey));
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
        assert(!forbiddenKey.test(key), 'personal_data_output_key_detected');
        assertNoForbiddenOutputKeys(nested, forbiddenKey);
    }
}

export function assertSafeEvidence(evidence, { body, ownerToken, reviewerToken } = {}) {
    assertNoForbiddenOutputKeys(evidence, FORBIDDEN_EVIDENCE_KEY);
    const serialized = JSON.stringify(evidence);
    assert(!body || !serialized.includes(body), 'personal_body_output_detected');
    assert(!ownerToken || !serialized.includes(ownerToken), 'owner_token_output_detected');
    assert(!reviewerToken || !serialized.includes(reviewerToken), 'reviewer_token_output_detected');
    return true;
}

export function assertSafeOrganizationResponse(response, secrets = {}) {
    assertNoForbiddenOutputKeys(response, FORBIDDEN_ORGANIZATION_RESPONSE_KEY);
    return assertSafeEvidence(response, secrets);
}

async function requestJson(fetchImpl, baseUrl, {
    method = 'GET', path: requestPath, token, context, csrfToken, sessionId, body
}) {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (context) headers['Brainbase-Tenant-Context'] = encodeContext(context);
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    if (sessionId) headers['x-session-id'] = sessionId;
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    let response;
    try {
        response = await fetchImpl(new URL(requestPath, baseUrl), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch {
        fail('runtime_unreachable');
    }
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    return { status: response.status, payload };
}

function expectStatus(result, status, code) {
    assert(result?.status === status, code);
    return result.payload || {};
}

async function loadCsrfToken(fetchImpl, baseUrl, sessionId) {
    const response = await requestJson(fetchImpl, baseUrl, {
        path: '/api/csrf-token', sessionId
    });
    const payload = expectStatus(response, 200, 'csrf_token_unavailable');
    assert(typeof payload.token === 'string' && payload.token, 'csrf_token_unavailable');
    return payload.token;
}

function projectBeforeAfter({ db, graph, receipt }) {
    return { db, graph, receipt };
}

export function assertInitialState(state) {
    assert(state.db.event === null, 'synthetic_event_already_exists');
    assert(state.db.promotion === null, 'synthetic_promotion_already_exists');
    assert(state.db.lineage.length === 0, 'synthetic_lineage_already_exists');
    assert(state.db.authority_uses.length === 0, 'synthetic_authority_already_used');
    assert(state.db.incident_graph_edge_count === 0, 'synthetic_graph_edge_already_exists');
    assert(state.graph.length === 0, 'synthetic_graph_entity_already_exists');
}

export function assertAcceptedState(state, parsed) {
    assert(state.db.event?.event_id === parsed.eventId, 'db_event_readback_mismatch');
    assert(state.db.event.body_present === true, 'db_event_missing_body');
    assert(state.db.event.body_hash === parsed.event.body_hash, 'db_event_body_hash_mismatch');
    assert(state.db.event.body_length === Array.from(parsed.event.body).length, 'db_event_body_length_mismatch');
    assert(state.db.promotion?.request_id === parsed.requestId, 'db_promotion_readback_mismatch');
    assert(state.db.promotion.status === 'org_accepted', 'db_promotion_not_accepted');
    assert(state.db.promotion.personal_event_id === parsed.eventId, 'db_promotion_personal_event_mismatch');
    assert(state.db.promotion.graph_entity_id === parsed.entityId, 'db_graph_id_readback_mismatch');
    assert(state.db.promotion.normalized_payload_hash === parsed.normalizedPayloadHash, 'db_normalized_payload_hash_mismatch');
    assertReceiptComplete(redactReceipt(state.db.promotion), 'db_receipt_incomplete');
    assert(state.db.organization_event?.event_id === state.db.promotion.organization_event_id, 'db_organization_event_readback_mismatch');
    assert(state.db.organization_event.graph_entity_id === parsed.entityId, 'db_organization_event_graph_id_mismatch');
    assert(state.db.organization_event.personal_body_found_in_payload === false, 'personal_body_copied_to_organization_event');
    assert(state.db.lineage.length === 1, 'db_lineage_readback_mismatch');
    const expectedAuthorityActions = ['request', 'owner_consent', 'organization_review'];
    assert(
        state.db.authority_uses.length === expectedAuthorityActions.length
        && state.db.authority_uses.every((row) => expectedAuthorityActions.includes(row.action) && row.count === 1)
        && new Set(state.db.authority_uses.map((row) => row.action)).size === expectedAuthorityActions.length,
        'db_authority_use_count_mismatch'
    );
    const [lineage] = state.db.lineage;
    assert(lineage.personal_event_id === parsed.eventId, 'db_lineage_personal_event_mismatch');
    assert(lineage.organization_event_id === state.db.promotion.organization_event_id, 'db_lineage_organization_event_mismatch');
    assert(lineage.promotion_request_id === parsed.requestId, 'db_lineage_promotion_request_mismatch');
    assert(lineage.normalized_payload_hash === parsed.normalizedPayloadHash, 'db_lineage_normalized_hash_mismatch');
    assert(lineage.owner_consent_receipt_id === state.db.promotion.owner_consent_receipt_id, 'db_lineage_owner_receipt_mismatch');
    assert(lineage.organization_review_receipt_id === state.db.promotion.organization_review_receipt_id, 'db_lineage_organization_receipt_mismatch');
    assert(lineage.graph_entity_id === parsed.entityId, 'db_lineage_graph_id_mismatch');
    assert(state.db.incident_graph_edge_count === parsed.normalizedPayload.edges.length, 'db_graph_edge_count_mismatch');
    assert(state.graph.length === 1 && state.graph[0].id === parsed.entityId, 'graph_readback_mismatch');
}

/**
 * Execute one full synthetic promotion, then replay the organization review
 * authority and prove that DB/Graph/Receipt projections did not change.
 */
export async function runSmoke({
    fixture,
    baseUrl,
    ownerToken,
    reviewerToken,
    csrfToken: suppliedCsrfToken,
    sessionId = 'p0-personal-knowledge-production-smoke',
    databaseUrl,
    fetchImpl = globalThis.fetch,
    poolFactory = (url) => new Pool({ connectionString: url })
} = {}) {
    const parsed = parseSmokeFixture(fixture);
    assert(typeof baseUrl === 'string' && /^https?:\/\//iu.test(baseUrl), 'runtime_url_invalid');
    assert(typeof ownerToken === 'string' && ownerToken, 'owner_token_missing');
    assert(typeof reviewerToken === 'string' && reviewerToken, 'reviewer_token_missing');
    assert(ownerToken !== reviewerToken, 'distinct_reviewer_required');
    assert(typeof databaseUrl === 'string' && databaseUrl, 'database_url_missing');
    assert(typeof fetchImpl === 'function', 'fetch_unavailable');

    const ownerAccess = await verifySmokeAccess(fetchImpl, baseUrl, ownerToken, {
        label: 'owner', projectCode: parsed.projectCode, sessionId
    });
    const reviewerAccess = await verifySmokeAccess(fetchImpl, baseUrl, reviewerToken, {
        label: 'reviewer', projectCode: parsed.projectCode, reviewer: true, sessionId
    });
    assert(ownerAccess.personId !== reviewerAccess.personId, 'distinct_reviewer_required');
    assert(ownerAccess.organizationId === reviewerAccess.organizationId, 'organization_access_mismatch');
    const [requestProjectId] = assertSignedContextAccessBinding(parsed.requestContext, ownerAccess, {
        label: 'request'
    });
    assertSignedContextAccessBinding(parsed.ownerContext, ownerAccess, {
        label: 'owner', expectedProjectId: requestProjectId
    });
    assertSignedContextAccessBinding(parsed.organizationContext, reviewerAccess, {
        label: 'organization', expectedProjectId: requestProjectId
    });

    let pool = null;
    let csrfToken = suppliedCsrfToken;
    try {
        pool = poolFactory(databaseUrl);
        await assertReadbackRole(pool);
        if (!csrfToken) csrfToken = await loadCsrfToken(fetchImpl, baseUrl, sessionId);
        const graphBeforeResponse = await requestJson(fetchImpl, baseUrl, {
            path: `/api/info/graph/entities?id=${encodeURIComponent(parsed.entityId)}&project=${encodeURIComponent(parsed.projectCode)}`,
            token: ownerToken
        });
        expectStatus(graphBeforeResponse, 200, 'graph_before_read_failed');
        assertGraphBodyAbsent(graphBeforeResponse.payload, parsed.event.body);
        const before = projectBeforeAfter({
            db: await readDbState(pool, { ...parsed, body: parsed.event.body, access: ownerAccess }),
            graph: safeGraphProjection(graphBeforeResponse.payload),
            receipt: null
        });
        assertInitialState(before);

        const eventResponse = await requestJson(fetchImpl, baseUrl, {
            method: 'POST', path: '/api/personal-knowledge/events', token: ownerToken,
            csrfToken, sessionId,
            body: {
                event_id: parsed.eventId,
                occurred_at: new Date().toISOString(),
                captured_at: new Date().toISOString(),
                source: { ...parsed.event.source, smoke_run_id: parsed.runId },
                source_pointer: { ...parsed.event.source_pointer, smoke_run_id: parsed.runId },
                body: parsed.event.body,
                body_hash: parsed.event.body_hash,
                sensitivity: 'personal'
            }
        });
        expectStatus(eventResponse, 201, 'event_ingest_failed');

        const requestResponse = await requestJson(fetchImpl, baseUrl, {
            method: 'POST', path: `/api/personal-knowledge/events/${encodeURIComponent(parsed.eventId)}/promotion-requests`,
            token: ownerToken, context: parsed.requestContext, csrfToken, sessionId,
            body: {
                project_code: parsed.projectCode,
                summary: parsed.summary,
                subject: parsed.subject,
                normalized_payload: parsed.normalizedPayload
            }
        });
        const requestPayload = expectStatus(requestResponse, 202, 'promotion_request_failed');
        assert(requestPayload.request_id === parsed.requestId, 'promotion_request_id_mismatch');

        const ownerResponse = await requestJson(fetchImpl, baseUrl, {
            method: 'POST', path: `/api/personal-knowledge/promotions/${encodeURIComponent(parsed.requestId)}/owner-decision`,
            token: ownerToken, context: parsed.ownerContext, csrfToken, sessionId,
            body: { decision: 'approve', normalized_payload_hash: parsed.normalizedPayloadHash }
        });
        const ownerPayload = expectStatus(ownerResponse, 200, 'owner_consent_failed');
        assert(ownerPayload.owner_consent_receipt_id, 'owner_consent_receipt_missing');

        const organizationResponse = await requestJson(fetchImpl, baseUrl, {
            method: 'POST', path: `/api/personal-knowledge/promotions/${encodeURIComponent(parsed.requestId)}/organization-decision`,
            token: reviewerToken, context: parsed.organizationContext, csrfToken, sessionId,
            body: { decision: 'approve', reason: `synthetic smoke ${parsed.runId}` }
        });
        const organizationPayload = expectStatus(organizationResponse, 200, 'organization_review_failed');
        assertSafeOrganizationResponse(organizationPayload, { body: parsed.event.body, ownerToken, reviewerToken });
        const firstReceipt = redactReceipt(organizationPayload);
        assert(firstReceipt.graph_entity_id === parsed.entityId, 'organization_receipt_graph_id_missing');
        assert(firstReceipt.organization_review_receipt_id, 'organization_receipt_missing');
        assertReceiptComplete(firstReceipt, 'organization_receipt_incomplete');
        assert(ownerPayload.owner_consent_receipt_id === firstReceipt.owner_consent_receipt_id, 'owner_consent_receipt_mismatch');

        const graphAfterFirstResponse = await requestJson(fetchImpl, baseUrl, {
            path: `/api/info/graph/entities?id=${encodeURIComponent(parsed.entityId)}&project=${encodeURIComponent(parsed.projectCode)}`,
            token: reviewerToken
        });
        expectStatus(graphAfterFirstResponse, 200, 'graph_after_read_failed');
        assertGraphBodyAbsent(graphAfterFirstResponse.payload, parsed.event.body);
        const afterFirstDb = await readDbState(pool, { ...parsed, body: parsed.event.body, access: ownerAccess });
        const afterFirstReceipt = assertReceiptMatchesDb(firstReceipt, afterFirstDb.promotion);
        const afterFirst = projectBeforeAfter({
            db: afterFirstDb,
            graph: safeGraphProjection(graphAfterFirstResponse.payload),
            receipt: afterFirstReceipt
        });
        assertAcceptedState(afterFirst, parsed);

        const replayResponse = await requestJson(fetchImpl, baseUrl, {
            method: 'POST', path: `/api/personal-knowledge/promotions/${encodeURIComponent(parsed.requestId)}/organization-decision`,
            token: reviewerToken, context: parsed.organizationContext, csrfToken, sessionId,
            body: { decision: 'approve', reason: `synthetic smoke ${parsed.runId}` }
        });
        assert(replayResponse.status === 409, 'replay_not_rejected');
        assert(replayResponse.payload?.error === 'personal_knowledge_promotion_authority_replayed', 'replay_error_mismatch');

        const graphAfterReplayResponse = await requestJson(fetchImpl, baseUrl, {
            path: `/api/info/graph/entities?id=${encodeURIComponent(parsed.entityId)}&project=${encodeURIComponent(parsed.projectCode)}`,
            token: reviewerToken
        });
        expectStatus(graphAfterReplayResponse, 200, 'graph_replay_read_failed');
        assertGraphBodyAbsent(graphAfterReplayResponse.payload, parsed.event.body);
        const replayDb = await readDbState(pool, { ...parsed, body: parsed.event.body, access: ownerAccess });
        const replayReceipt = redactReceipt(replayDb.promotion);
        assertReceiptComplete(replayReceipt, 'db_receipt_incomplete');
        const replayState = projectBeforeAfter({
            db: replayDb,
            graph: safeGraphProjection(graphAfterReplayResponse.payload),
            receipt: replayReceipt
        });
        assertAcceptedState(replayState, parsed);
        const dbMutationDiffZero = equalStable(afterFirst.db, replayState.db);
        const graphMutationDiffZero = equalStable(afterFirst.graph, replayState.graph);
        const receiptMutationDiffZero = equalStable(afterFirst.receipt, replayState.receipt);
        assert(dbMutationDiffZero && graphMutationDiffZero && receiptMutationDiffZero, 'replay_mutation_diff_nonzero');

        const evidence = {
            schema_version: 'personal_knowledge_promotion_production_smoke_evidence.v1',
            status: 'passed',
            run_id: parsed.runId,
            synthetic: true,
            correlation: {
                personal_event_id: parsed.eventId,
                promotion_request_id: parsed.requestId,
                graph_entity_id: parsed.entityId,
                normalized_payload_hash: parsed.normalizedPayloadHash
            },
            before,
            after_first: afterFirst,
            replay: {
                http_status: replayResponse.status,
                error: replayResponse.payload.error,
                after: replayState,
                mutation_diff_zero: true,
                db_mutation_diff_zero: dbMutationDiffZero,
                graph_mutation_diff_zero: graphMutationDiffZero,
                receipt_mutation_diff_zero: receiptMutationDiffZero
            },
            assertions: {
                personal_body_absent_from_evidence: true,
                personal_body_absent_from_graph_projection: true,
                receipt_db_graph_correlated: true,
                replay_rejected_before_second_mutation: true,
                no_secret_output: true
            }
        };
        assertSafeEvidence(evidence, { body: parsed.event.body, ownerToken, reviewerToken });
        return evidence;
    } finally {
        if (pool && typeof pool.end === 'function') await pool.end();
    }
}

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--fixture') options.fixture = argv[++index];
        else if (argument === '--base-url') options.baseUrl = argv[++index];
        else if (argument === '--session-id') options.sessionId = argv[++index];
        else fail('cli_argument_invalid');
    }
    assert(options.fixture, 'fixture_path_missing');
    return options;
}

async function main() {
    let runId = null;
    try {
        const options = parseArgs(process.argv.slice(2));
        const fixture = JSON.parse(await fs.readFile(path.resolve(options.fixture), 'utf8'));
        runId = fixture?.run_id || null;
        const evidence = await runSmoke({
            fixture,
            baseUrl: options.baseUrl || process.env.BRAINBASE_PERSONAL_KG_SMOKE_BASE_URL,
            ownerToken: process.env.BRAINBASE_PERSONAL_KG_SMOKE_OWNER_TOKEN,
            reviewerToken: process.env.BRAINBASE_PERSONAL_KG_SMOKE_REVIEWER_TOKEN,
            csrfToken: process.env.BRAINBASE_PERSONAL_KG_SMOKE_CSRF_TOKEN,
            sessionId: options.sessionId || process.env.BRAINBASE_PERSONAL_KG_SMOKE_SESSION_ID || 'p0-personal-knowledge-production-smoke',
            databaseUrl: process.env.BRAINBASE_PERSONAL_KG_SMOKE_DATABASE_URL
                || process.env.INFO_SSOT_DATABASE_URL
                || process.env.DATABASE_URL
        });
        process.stdout.write(`${JSON.stringify(evidence)}\n`);
    } catch (error) {
        const code = error instanceof SmokeFailure ? error.code : 'production_smoke_failed';
        process.stdout.write(`${JSON.stringify({
            schema_version: 'personal_knowledge_promotion_production_smoke_evidence.v1',
            status: 'failed',
            ...(runId ? { run_id: runId } : {}),
            failure: { code }
        })}\n`);
        process.exitCode = 1;
    }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) main();
