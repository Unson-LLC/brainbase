#!/usr/bin/env node

/**
 * Issue a customer-data-free Personal KG production smoke fixture.
 *
 * Signing is intentionally delegated to the deployed tenant runtime. The
 * runtime's /tenant-context:resolve route uses TenantContextProducer and the
 * canonical company-authority repository. This command only keeps the three
 * returned signed envelopes in memory long enough to write the synthetic
 * fixture. It never accepts, persists, or prints a private signing key.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { generateCanonicalId, isCanonicalId } from '../server/services/multitenant/ids.js';
import { validateCanonicalWire } from '../server/services/multitenant/canonical-wire-validator.js';
import {
    buildPersonalKnowledgePromotionAuthority,
    assertPersonalKnowledgePromotionAuthority
} from '../server/services/personal-knowledge/promotion-authority-contract.js';
import { normalizePromotionPayload } from '../server/services/personal-knowledge/personal-knowledge-normalization.js';
import { parseSmokeFixture } from './personal-knowledge-promotion-production-smoke.mjs';

const FIXTURE_SCHEMA = 'personal_knowledge_promotion_production_smoke.v1';
const RECEIPT_SCHEMA = 'personal_knowledge_promotion_smoke_fixture_issuance.v1';
const RUN_ID = /^p0_smoke_[a-z0-9][a-z0-9_-]{5,127}$/iu;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const SERVICE_TOKEN = /^bbsvc_[A-Za-z0-9._-]+$/u;

class FixtureIssuerFailure extends Error {
    constructor(code) {
        super(code);
        this.name = 'FixtureIssuerFailure';
        this.code = /^[a-z][a-z0-9_]{2,80}$/u.test(code) ? code : 'fixture_issuer_failed';
    }
}

function fail(code) {
    throw new FixtureIssuerFailure(code);
}

function assert(condition, code) {
    if (!condition) fail(code);
}

function requiredString(value, code) {
    assert(typeof value === 'string' && value.trim().length > 0, code);
    return value.trim();
}

function revision(value, code) {
    const normalized = requiredString(value, code);
    assert(/^(0|[1-9][0-9]*)$/u.test(normalized), code);
    return normalized;
}

function sha256(value) {
    return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function resolveRuntimeBaseUrl(env = process.env) {
    let raw = env.BRAINBASE_TENANT_RUNTIME_URL;
    if (!raw) {
        const host = env.BRAINBASE_TENANT_RUNTIME_HOST || '127.0.0.1';
        const port = env.BRAINBASE_TENANT_RUNTIME_PORT;
        assert(/^\d{1,5}$/u.test(port ?? '') && Number(port) >= 1 && Number(port) <= 65535, 'runtime_url_missing');
        raw = `http://${host}:${port}`;
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        fail('runtime_url_invalid');
    }
    assert(['http:', 'https:'].includes(parsed.protocol), 'runtime_url_invalid');
    assert(!parsed.username && !parsed.password && !parsed.search && !parsed.hash,
        'runtime_url_invalid');
    assert(parsed.pathname === '/' || parsed.pathname === '', 'runtime_url_invalid');
    return parsed.origin;
}

function resolveServiceToken(env = process.env) {
    const value = requiredString(env.BRAINBASE_PERSONAL_KG_FIXTURE_SERVICE_TOKEN, 'service_token_missing');
    assert(SERVICE_TOKEN.test(value), 'service_token_invalid');
    return value;
}

function resolveOutputPath(value, env = process.env) {
    const output = value || env.BRAINBASE_PERSONAL_KG_FIXTURE_OUTPUT;
    assert(typeof output === 'string' && output.trim().length > 0 && output !== '-', 'output_path_missing');
    return path.resolve(output);
}

function resolveRunId(value, env = process.env) {
    const runId = value || env.BRAINBASE_PERSONAL_KG_FIXTURE_RUN_ID;
    assert(typeof runId === 'string' && RUN_ID.test(runId), 'run_id_invalid');
    return runId;
}

function resolveCanonicalBinding(env = process.env) {
    const tenantId = requiredString(env.BRAINBASE_PERSONAL_KG_FIXTURE_TENANT_ID, 'tenant_id_missing');
    const connectionId = requiredString(env.BRAINBASE_PERSONAL_KG_FIXTURE_CONNECTION_ID, 'connection_id_missing');
    assert(isCanonicalId(tenantId, 'ten'), 'tenant_id_invalid');
    assert(isCanonicalId(connectionId, 'wsc'), 'connection_id_invalid');
    return {
        tenant_id: tenantId,
        expected_tenant_revision: revision(env.BRAINBASE_PERSONAL_KG_FIXTURE_TENANT_REVISION, 'tenant_revision_invalid'),
        connection_id: connectionId,
        expected_connection_revision: revision(
            env.BRAINBASE_PERSONAL_KG_FIXTURE_CONNECTION_REVISION,
            'connection_revision_invalid'
        ),
        workspace_id: requiredString(env.BRAINBASE_PERSONAL_KG_FIXTURE_WORKSPACE_ID, 'workspace_id_missing'),
        app_id: requiredString(env.BRAINBASE_PERSONAL_KG_FIXTURE_APP_ID, 'app_id_missing'),
        project_code: requiredString(env.BRAINBASE_PERSONAL_KG_FIXTURE_PROJECT_CODE, 'project_code_missing'),
        channel_id: requiredString(env.BRAINBASE_PERSONAL_KG_FIXTURE_CHANNEL_ID, 'channel_id_missing'),
        owner_subject_id: requiredString(
            env.BRAINBASE_PERSONAL_KG_FIXTURE_OWNER_SUBJECT_ID,
            'owner_subject_id_missing'
        ),
        reviewer_subject_id: requiredString(
            env.BRAINBASE_PERSONAL_KG_FIXTURE_REVIEWER_SUBJECT_ID,
            'reviewer_subject_id_missing'
        )
    };
}

function syntheticPayload(entityId) {
    return normalizePromotionPayload({
        schema_version: 'personal_knowledge_normalized.v1',
        kind: 'entity',
        entity: {
            id: entityId,
            type: 'glossary_term',
            payload: { label: 'synthetic production smoke term' }
        },
        edges: [],
        context_entities: [],
        sensitivity: 'internal',
        role_min: 'member'
    });
}

function operationIds() {
    return {
        correlation_id: generateCanonicalId('cor'),
        operation_id: generateCanonicalId('op')
    };
}

function contextRequest({ binding, subjectId, eventId, requestId, normalizedPayloadHash, action, index }) {
    const isRequest = action === 'request';
    const resourceRef = isRequest
        ? `personal-knowledge://events/${eventId}`
        : `personal-knowledge://promotions/${requestId}`;
    const authority = buildPersonalKnowledgePromotionAuthority({
        action,
        personalEventId: isRequest ? eventId : null,
        requestId: isRequest ? null : requestId,
        normalizedPayloadHash: isRequest ? null : normalizedPayloadHash
    });
    const ids = operationIds();
    return {
        ...binding,
        provider_identity: {
            provider: 'slack',
            authenticated_subject_id: subjectId,
            workspace_id: binding.workspace_id,
            app_id: binding.app_id
        },
        requested_action: {
            capability_id: `personal_knowledge_promotion:${action}`,
            resource_ref: resourceRef,
            project_hint: binding.project_code,
            desired_effect: 'write'
        },
        promotion_authority: authority,
        slack: {
            event_id: `${eventId}:authority:${index}`,
            channel_id: binding.channel_id,
            requester_id: subjectId
        },
        ...ids
    };
}

export function buildSmokeFixtureInput({ runId, binding, now = new Date() }) {
    const normalizedRunId = resolveRunId(runId);
    const suffix = normalizedRunId.slice('p0_smoke_'.length);
    assert(SAFE_ID.test(suffix), 'run_id_suffix_invalid');
    const eventId = `pke_smoke_${suffix}`;
    const entityId = `smoke_${suffix}`;
    assert(SAFE_ID.test(eventId) && SAFE_ID.test(entityId), 'synthetic_id_invalid');
    const body = `synthetic production smoke ${normalizedRunId}`;
    const normalized = syntheticPayload(entityId);
    const requestId = `kpr_${sha256(`${eventId}:${binding.project_code}:${normalized.normalized_payload_hash}`).slice(0, 24)}`;
    const issuedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    assert(Number.isFinite(Date.parse(issuedAt)), 'fixture_timestamp_invalid');
    return {
        schema_version: FIXTURE_SCHEMA,
        synthetic: true,
        data_class: 'synthetic',
        run_id: normalizedRunId,
        event: {
            event_id: eventId,
            body,
            body_hash: `sha256:${sha256(body)}`,
            source: { type: 'production_smoke', issued_at: issuedAt },
            source_pointer: { run_id: normalizedRunId, purpose: 'ac008' }
        },
        request: {
            project_code: binding.project_code,
            summary: 'synthetic production smoke',
            subject: { type: 'glossary_term', id: entityId },
            normalized_payload: normalized.normalized,
            producer_request: contextRequest({
                binding,
                subjectId: binding.owner_subject_id,
                eventId,
                requestId: null,
                normalizedPayloadHash: null,
                action: 'request',
                index: 1
            })
        },
        owner: {
            producer_request: contextRequest({
                binding,
                subjectId: binding.owner_subject_id,
                eventId,
                requestId,
                normalizedPayloadHash: normalized.normalized_payload_hash,
                action: 'owner_consent',
                index: 2
            })
        },
        organization: {
            producer_request: contextRequest({
                binding,
                subjectId: binding.reviewer_subject_id,
                eventId,
                requestId,
                normalizedPayloadHash: normalized.normalized_payload_hash,
                action: 'organization_review',
                index: 3
            })
        }
    };
}

function safeResponseBody(response) {
    try {
        return response.json();
    } catch {
        return Promise.resolve(null);
    }
}

async function resolveSignedContext({ runtimeBaseUrl, serviceToken, request, fetchImpl, validateContext }) {
    let response;
    try {
        response = await fetchImpl(`${runtimeBaseUrl}/api/v1/runtime/tenant-context:resolve`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Bearer ${serviceToken}`
            },
            body: JSON.stringify(request)
        });
    } catch {
        fail('runtime_unreachable');
    }
    const payload = await safeResponseBody(response);
    assert(response?.status === 200, 'context_issue_failed');
    try {
        validateContext('TenantContextEnvelope', payload);
    } catch {
        fail('context_wire_invalid');
    }
    return payload;
}

function assertContextBinding(context, request, { action, requestId, normalizedPayloadHash }) {
    assert(context?.actor?.principal_type === 'person', 'context_actor_invalid');
    const capabilityId = `personal_knowledge_promotion:${action}`;
    assert(Array.isArray(context.authorization?.capability_ids)
        && context.authorization.capability_ids.includes(capabilityId), 'context_capability_invalid');
    assert(context.authority?.action === action, 'context_action_mismatch');
    assertPersonalKnowledgePromotionAuthority(context.authority);
    const expectedResource = action === 'request'
        ? request.promotion_authority.resource_ref
        : `personal-knowledge://promotions/${requestId}`;
    assert(context.authority.resource_ref === expectedResource, 'context_resource_mismatch');
    assert((context.authority.request_id ?? null) === (requestId ?? null), 'context_request_mismatch');
    assert((context.authority.normalized_payload_hash ?? null) === (normalizedPayloadHash ?? null),
        'context_payload_hash_mismatch');
    assert(context.operation_id === request.operation_id, 'context_operation_mismatch');
    assert(typeof context.integrity?.value === 'string' && context.integrity.value.length > 20,
        'context_unsigned');
    return true;
}

function stripProducerRequests(fixture, contexts) {
    return {
        schema_version: fixture.schema_version,
        synthetic: fixture.synthetic,
        data_class: fixture.data_class,
        run_id: fixture.run_id,
        event: fixture.event,
        request: {
            project_code: fixture.request.project_code,
            summary: fixture.request.summary,
            subject: fixture.request.subject,
            normalized_payload: fixture.request.normalized_payload,
            signed_context: contexts.request
        },
        owner: { signed_context: contexts.owner },
        organization: { signed_context: contexts.organization }
    };
}

function assertNoSecretMaterial(value, { serviceToken }) {
    const serialized = JSON.stringify(value);
    assert(!serialized.includes(serviceToken), 'service_token_persisted');
    assert(!serialized.includes('private_key'), 'private_key_persisted');
    assert(!serialized.includes('BEGIN PRIVATE KEY'), 'private_key_persisted');
    return true;
}

async function writeFixtureExclusive(outputPath, fixture) {
    let handle;
    try {
        handle = await fs.open(outputPath, 'wx', 0o600);
    } catch (error) {
        if (error?.code === 'EEXIST') fail('fixture_output_exists');
        if (error?.code === 'ENOENT') fail('fixture_output_directory_missing');
        fail('fixture_output_unavailable');
    }
    try {
        await handle.writeFile(`${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
        await handle.chmod(0o600);
    } finally {
        await handle.close();
    }
}

async function readbackFixture(outputPath, expected, { serviceToken }) {
    let raw;
    try {
        raw = await fs.readFile(outputPath, 'utf8');
    } catch {
        fail('fixture_readback_missing');
    }
    let fixture;
    try {
        fixture = JSON.parse(raw);
    } catch {
        fail('fixture_readback_invalid');
    }
    assert(fixture.run_id === expected.run_id, 'fixture_readback_run_mismatch');
    parseSmokeFixture(fixture);
    assertNoSecretMaterial(fixture, { serviceToken });
    const metadata = await fs.stat(outputPath);
    assert((metadata.mode & 0o777) === 0o600, 'fixture_permissions_invalid');
    return {
        status: 'passed',
        mode: '0600',
        sha256: sha256(raw),
        bytes: Buffer.byteLength(raw, 'utf8')
    };
}

export async function issueSmokeFixture({
    outputPath,
    runId,
    binding,
    runtimeBaseUrl,
    serviceToken,
    fetchImpl = globalThis.fetch,
    validateContext = validateCanonicalWire,
    now = new Date()
} = {}) {
    assert(typeof fetchImpl === 'function', 'fetch_unavailable');
    assert(typeof validateContext === 'function', 'context_validator_unavailable');
    const fixturePath = path.resolve(requiredString(outputPath, 'output_path_missing'));
    const fixtureInput = buildSmokeFixtureInput({ runId, binding, now });
    const contexts = {};
    const contextDefinitions = [
        ['request', fixtureInput.request.producer_request, null, null],
        ['owner', fixtureInput.owner.producer_request, fixtureInput.request.producer_request.promotion_authority.request_id, null],
        ['organization', fixtureInput.organization.producer_request, fixtureInput.owner.producer_request.promotion_authority.request_id, normalizePromotionPayload(fixtureInput.request.normalized_payload).normalized_payload_hash]
    ];
    const normalizedResult = normalizePromotionPayload(fixtureInput.request.normalized_payload);
    for (const [label, request, requestId, _unusedHash] of contextDefinitions) {
        const action = request.promotion_authority.action;
        const normalizedPayloadHash = action === 'request' ? null : normalizedResult.normalized_payload_hash;
        contexts[label] = await resolveSignedContext({
            runtimeBaseUrl,
            serviceToken,
            request,
            fetchImpl,
            validateContext
        });
        assertContextBinding(contexts[label], request, {
            action,
            requestId: action === 'request' ? null : requestId || fixtureInput.owner.producer_request.promotion_authority.request_id,
            normalizedPayloadHash
        });
    }
    const fixture = stripProducerRequests(fixtureInput, contexts);
    assertNoSecretMaterial(fixture, { serviceToken });
    await writeFixtureExclusive(fixturePath, fixture);
    const readback = await readbackFixture(fixturePath, fixture, { serviceToken });
    const parsed = parseSmokeFixture(fixture);
    return {
        schema_version: RECEIPT_SCHEMA,
        status: 'passed',
        run_id: parsed.runId,
        fixture_path: fixturePath,
        correlation: {
            personal_event_id: parsed.eventId,
            promotion_request_id: parsed.requestId,
            graph_entity_id: parsed.entityId,
            context_count: 3
        },
        readback,
        assertions: {
            issued_by_tenant_context_producer: true,
            synthetic_only: true,
            private_key_persisted: false,
            service_token_persisted: false,
            fixture_readback_verified: true
        }
    };
}

export function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--output') options.outputPath = argv[++index];
        else if (argument === '--run-id') options.runId = argv[++index];
        else fail('cli_argument_invalid');
    }
    return options;
}

async function main() {
    let runId = null;
    try {
        const options = parseArgs(process.argv.slice(2));
        runId = resolveRunId(options.runId);
        const receipt = await issueSmokeFixture({
            outputPath: resolveOutputPath(options.outputPath),
            runId,
            binding: resolveCanonicalBinding(),
            runtimeBaseUrl: resolveRuntimeBaseUrl(),
            serviceToken: resolveServiceToken()
        });
        process.stdout.write(`${JSON.stringify(receipt)}\n`);
    } catch (error) {
        process.stdout.write(`${JSON.stringify({
            schema_version: RECEIPT_SCHEMA,
            status: 'failed',
            ...(runId ? { run_id: runId } : {}),
            failure: { code: error instanceof FixtureIssuerFailure ? error.code : 'fixture_issuer_failed' }
        })}\n`);
        process.exitCode = 1;
    }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) main();
