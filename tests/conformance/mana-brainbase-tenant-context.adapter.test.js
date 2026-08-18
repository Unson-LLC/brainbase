// @vitest-environment node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../server/services/multitenant/canonical-json.js';
import {
    createSignedTenantContext,
    verifyTenantContext
} from '../../server/services/multitenant/tenant-context.js';
import {
    REQUIRED_CAPABILITIES,
    negotiateProtocol
} from '../../server/services/multitenant/protocol-contract.js';
import {
    CredentialBroker,
    validateCredentialLease
} from '../../server/services/multitenant/credential-broker.js';
import {
    computeBusinessIdempotencyKey,
    normalizeUsageEvent,
    validateIdempotencyClaim,
    validateOperationReceipt,
    validateQuotaDecision
} from '../../server/services/multitenant/contract-usage-ledger.js';

const sourceLockUrl = new URL('./mana-brainbase-tenant-context.source-lock.json', import.meta.url);
const sourceLock = JSON.parse(await readFile(sourceLockUrl, 'utf8'));
const configuredRoot = process.env.MANA_BRAINBASE_CONFORMANCE_KIT_ROOT;
const configuredCommit = process.env.MANA_BRAINBASE_CONFORMANCE_KIT_COMMIT;

if (!configuredRoot) {
    throw new Error('MANA_BRAINBASE_CONFORMANCE_KIT_ROOT must point to the shared PR #292 contract root');
}

const contractRoot = resolve(configuredRoot);
const fixtureRoot = resolve(contractRoot, 'fixtures');

async function readJson(path, root = contractRoot) {
    return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

function resolvePointer(object, pointer) {
    return pointer.split('/').filter(Boolean).reduce((value, key) => value[key], object);
}

function parentForPointer(object, pointer) {
    const parts = pointer.split('/').filter(Boolean);
    const key = parts.pop();
    const parent = parts.reduce((value, part) => value[part], object);
    return { parent, key };
}

function applyMutations(value, mutations) {
    const result = structuredClone(value);
    for (const mutation of mutations) {
        if (mutation.operation === 'replace_protected_header') {
            const [, empty, signature] = result.integrity.value.split('.');
            assert.equal(empty, '');
            result.integrity.value = `${Buffer.from(canonicalJson(mutation.value)).toString('base64url')}..${signature}`;
            continue;
        }
        const { parent, key } = parentForPointer(result, mutation.path);
        if (mutation.operation === 'set') parent[key] = mutation.value;
        else if (mutation.operation === 'delete') delete parent[key];
        else if (mutation.operation === 'rename') {
            parent[mutation.to] = parent[key];
            delete parent[key];
        } else assert.fail(`Unknown fixture mutation: ${mutation.operation}`);
    }
    return result;
}

async function fixtureSetDigest(manifest) {
    const files = [
        manifest.test_key,
        ...manifest.positive,
        ...manifest.negative,
        ...manifest.non_applicable
    ];
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(file);
        hash.update(Buffer.from([0]));
        hash.update(await readFile(resolve(fixtureRoot, file)));
    }
    return hash.digest('hex');
}

async function validateNegative(fixture, base, key) {
    const original = resolvePointer(base, fixture.target);
    const mutated = applyMutations(original, fixture.mutations);
    if (fixture.target === 'tenant_context_envelope') {
        return verifyTenantContext(mutated, {
            keys: [{ key_id: key.key_id, status: 'current', public_key: key.public_jwk }],
            audience: 'mana-runtime',
            deployment_id: base.tenant_context_envelope.placement.deployment_id,
            now: new Date(base.evaluation_time)
        });
    }
    if (fixture.target === 'protocol_request') return negotiateProtocol(mutated);
    if (fixture.target === 'credential_lease_response') {
        return validateCredentialLease(base.credential_lease_request, mutated, { now: new Date(base.evaluation_time) });
    }
    if (fixture.target === 'quota_decision') return validateQuotaDecision(mutated);
    if (fixture.target.startsWith('usage_events/')) return normalizeUsageEvent(mutated);
    if (fixture.target.startsWith('idempotency_claims/')) return validateIdempotencyClaim(mutated);
    if (fixture.target === 'operation_receipt') return validateOperationReceipt(mutated);
    assert.fail(`Unknown fixture target: ${fixture.target}`);
}

const manifest = await readJson('fixtures/manifest.json');
const positive = await readJson(manifest.positive[0], fixtureRoot);
const testKey = await readJson(manifest.test_key, fixtureRoot);
const fixtureCases = [
    ...manifest.positive.map((file) => ({ kind: 'positive', file })),
    ...manifest.negative.map((file) => ({ kind: 'negative', file })),
    ...manifest.non_applicable.map((file) => ({ kind: 'non_applicable', file }))
];

describe('Brainbase producer adapter reads the canonical PR #292 manifest', () => {
    it('locks the fixed commit, manifest digest, and all 23 shared fixtures', async () => {
        expect(configuredCommit).toBe(sourceLock.commit);
        expect(manifest.fixture_set_sha256).toBe(sourceLock.fixture_set_sha256);
        expect(await fixtureSetDigest(manifest)).toBe(sourceLock.fixture_set_sha256);
        expect(fixtureCases).toHaveLength(sourceLock.fixture_count);
        expect(manifest.positive).toHaveLength(1);
        expect(manifest.negative).toHaveLength(21);
        expect(manifest.non_applicable).toHaveLength(1);
        expect(sourceLock.evidence_boundary).toBe('shared_contract_fixture_not_production_readback');
    });

    it.each(fixtureCases)('$kind $file', async ({ kind, file }) => {
        const fixture = await readJson(file, fixtureRoot);
        expect(fixture.fixture_kind).toBe(kind);

        if (kind === 'positive') {
            const negotiated = negotiateProtocol(fixture.protocol_request);
            expect(negotiated).toEqual(fixture.protocol_response);
            expect(REQUIRED_CAPABILITIES).toEqual(fixture.protocol_request.required_capabilities);
            const unsigned = structuredClone(fixture.tenant_context_envelope);
            delete unsigned.integrity;
            const signed = createSignedTenantContext(unsigned, {
                key_id: testKey.key_id,
                private_key: testKey.private_jwk
            });
            expect(signed.integrity.value).toBe(fixture.tenant_context_envelope.integrity.value);
            expect(verifyTenantContext(fixture.tenant_context_envelope, {
                keys: [{ key_id: testKey.key_id, status: 'current', public_key: testKey.public_jwk }],
                audience: 'mana-runtime',
                deployment_id: fixture.tenant_context_envelope.placement.deployment_id,
                now: new Date(fixture.evaluation_time)
            })).toEqual(fixture.tenant_context_envelope);
            expect(validateCredentialLease(
                fixture.credential_lease_request,
                fixture.credential_lease_response,
                { now: new Date(fixture.evaluation_time) }
            )).toBe(true);
            expect(validateQuotaDecision(fixture.quota_decision)).toBe(true);
            for (const usage of fixture.usage_events) expect(normalizeUsageEvent(usage)).toEqual(usage);
            expect(validateOperationReceipt(fixture.operation_receipt)).toBe(true);
            for (const claim of fixture.idempotency_claims) expect(validateIdempotencyClaim(claim)).toBe(true);

            const broker = new CredentialBroker({
                now: () => new Date(fixture.credential_lease_response.issued_at),
                leaseId: () => fixture.credential_lease_response.lease_id,
                leaseToken: () => fixture.credential_lease_response.lease_token
            });
            broker.register(fixture.credential_lease_request.binding);
            expect(broker.issueLease(fixture.credential_lease_request)).toEqual(fixture.credential_lease_response);
            return;
        }

        if (kind === 'negative') {
            expect(fixture.business_api_called).toBe(false);
            await expect(Promise.resolve().then(() => validateNegative(fixture, positive, testKey)))
                .rejects.toMatchObject({ code: fixture.expected_code });
            return;
        }

        const response = negotiateProtocol({
            ...positive.protocol_request,
            deployment_profile: fixture.deployment_profile,
            optional_capabilities: fixture.optional_capabilities.map(({ capability }) => capability)
        });
        expect(response.required_capabilities).toEqual(fixture.still_required);
        expect(response.optional_capabilities).toEqual(fixture.optional_capabilities);
        expect(fixture.expected).toMatchObject({
            mandatory_capability_waiver_count: 0,
            silent_downgrade: false,
            tenant_or_credential_fallback: false
        });
    });

    it('derives the canonical idempotency key without recording secret material', () => {
        const claim = positive.idempotency_claims[0];
        expect(computeBusinessIdempotencyKey({
            protocol_id: positive.protocol_request.protocol_id,
            protocol_major: positive.protocol_response.selected_version.split('.')[0],
            tenant_id: claim.tenant_id,
            connection_id: claim.connection_id,
            slack_event_id: claim.slack_event_id,
            operation_id: claim.operation_id
        })).toBe(claim.idempotency_key);
    });
});
