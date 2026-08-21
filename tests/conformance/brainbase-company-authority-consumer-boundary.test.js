// @vitest-environment node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
    CONTRACT_ID,
    acceptCompanyAuthorityResponse,
    validateWireResponseStructure
} from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { verifyTenantContext } from '../../server/services/multitenant/tenant-context.js';

const contractRoot = resolve('contracts/mana-brainbase-company-authority/v1');

async function readJson(relativePath) {
    return JSON.parse(await readFile(resolve(contractRoot, relativePath), 'utf8'));
}

async function fixtureSetDigest(manifest) {
    const hash = createHash('sha256');
    for (const relativePath of manifest.fixture_files) {
        hash.update(relativePath);
        hash.update(Buffer.from([0]));
        hash.update(await readFile(resolve(contractRoot, relativePath)));
    }
    return hash.digest('hex');
}

const contract = await readJson('producer.contract.json');
const sourceLock = await readJson('source-lock.json');
const manifest = await readJson('fixtures/manifest.json');
const fixtures = await readJson(manifest.cases);
const testKey = await readJson(manifest.test_key);
const fixtureSchema = await readJson(manifest.fixture_schema);
const requestSchema = await readJson(contract.schemas.observed_execution_request_v1);
const contextSchema = await readJson(contract.schemas.canonical_execution_context_v1);
const responseSchema = await readJson(sourceLock.producer.wire_response_schema);
const schemaValidators = (() => {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    ajv.addSchema(requestSchema, requestSchema.$id);
    ajv.addSchema(contextSchema, contextSchema.$id);
    ajv.addSchema(responseSchema, responseSchema.$id);
    ajv.addSchema(fixtureSchema, fixtureSchema.$id);
    return {
        fixture: ajv.getSchema(fixtureSchema.$id),
        response: ajv.getSchema(responseSchema.$id)
    };
})();

function signedResponse(fixture) {
    return {
        schema_version: '1.0',
        contract_id: CONTRACT_ID,
        correlation_id: fixture.request.correlation_id,
        context: fixture.context,
        error: null
    };
}

describe('Brainbase company authority A0 consumer boundary', () => {
    it('reads the producer source lock, manifest, schemas, and reference wire module', async () => {
        expect(sourceLock.contract_id).toBe(CONTRACT_ID);
        expect(sourceLock.producer.fixture_set_sha256).toBe(manifest.fixture_set_sha256);
        expect(await fixtureSetDigest(manifest)).toBe(manifest.fixture_set_sha256);
        expect(manifest.fixture_schema).toBe('fixtures/fixture.schema.json');
        expect(manifest.cases).toBe('fixtures/cases.json');
        expect(sourceLock.producer.wire_response_schema)
            .toBe('schema/company-authority-resolution-response.schema.json');
        expect(schemaValidators.fixture(fixtures), JSON.stringify(schemaValidators.fixture.errors)).toBe(true);
    });

    it.each(fixtures.positive.filter(({ context }) => context))(
        'accepts the embedded tenant context for %s through the canonical consumer verifier',
        (fixture) => {
            const tenantContext = fixture.context.tenant_context;
            expect(() => verifyTenantContext(tenantContext, {
                keys: [{
                    key_id: testKey.key_id,
                    status: 'current',
                    public_key: testKey.public_jwk
                }],
                audience: 'mana-runtime',
                deployment_id: fixture.context.scope.placement_id,
                now: new Date(fixture.evaluation_time)
            })).not.toThrow();
        }
    );

    it.each([
        'POS-DENY-COMPANY-WRITE',
        'POS-AUTHORITY-UNAVAILABLE-CONNECTION-DIAGNOSTIC'
    ])('accepts the complete external wire envelope for %s case-by-case', (caseId) => {
        const fixture = fixtures.positive.find(({ id }) => id === caseId);
        assert.ok(fixture, `positive fixture not found: ${caseId}`);
        expect(fixture.wire_response).toBeDefined();
        expect(schemaValidators.response(fixture.wire_response), JSON.stringify(schemaValidators.response.errors))
            .toBe(true);
        expect(() => validateWireResponseStructure(fixture.wire_response)).not.toThrow();

        const accepted = acceptCompanyAuthorityResponse(fixture.wire_response, {
            expectedAudience: contract.signature.audience,
            now: fixture.evaluation_time,
            publicJwk: testKey.public_jwk,
            request: fixture.request
        });
        expect(accepted).toEqual(fixture.wire_response);
        expect(accepted.contract_id).toBe(CONTRACT_ID);
        expect(accepted.correlation_id).toBe(fixture.request.correlation_id);
        expect(accepted.context).toBeNull();
        expect(accepted.error).toMatchObject({
            code: caseId === 'POS-DENY-COMPANY-WRITE' ? 'COMPANY_AUTHORITY_DENIED' : 'AUTHORITY_UNAVAILABLE',
            phase: 'authority',
            business_effect: false
        });
    });

    it('accepts a signed success context only after detached JWS verification', () => {
        const fixture = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        assert.ok(fixture);
        const response = signedResponse(fixture);
        expect(() => acceptCompanyAuthorityResponse(response, {
            expectedAudience: contract.signature.audience,
            now: fixture.evaluation_time,
            publicJwk: testKey.public_jwk,
            request: fixture.request
        })).not.toThrow();
    });

    it('fails closed when caller evaluation time is omitted', () => {
        const fixture = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        assert.ok(fixture);
        expect(() => acceptCompanyAuthorityResponse(signedResponse(fixture), {
            expectedAudience: contract.signature.audience,
            publicJwk: testKey.public_jwk,
            request: fixture.request
        })).toThrow(expect.objectContaining({
            code: 'AUTHORITY_CONTEXT_INVALID_SIGNATURE'
        }));
    });

    it('rejects a tampered signed context before consumer acceptance', () => {
        const fixture = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        assert.ok(fixture);
        const tampered = signedResponse(fixture);
        tampered.context = structuredClone(tampered.context);
        tampered.context.scope.resource_ref = 'company://tenant-b/other';
        expect(() => acceptCompanyAuthorityResponse(tampered, {
            expectedAudience: contract.signature.audience,
            now: fixture.evaluation_time,
            publicJwk: testKey.public_jwk,
            request: fixture.request
        })).toThrow(expect.objectContaining({
            code: 'AUTHORITY_CONTEXT_INVALID_SIGNATURE'
        }));
    });

    it('evaluates expiry against caller-supplied now rather than issued_at', () => {
        const fixture = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        assert.ok(fixture);
        expect(() => acceptCompanyAuthorityResponse(signedResponse(fixture), {
            expectedAudience: contract.signature.audience,
            now: '2026-08-21T00:06:00Z',
            publicJwk: testKey.public_jwk,
            request: fixture.request
        })).toThrow(expect.objectContaining({
            code: 'AUTHORITY_CONTEXT_EXPIRED'
        }));
    });
});
