// @vitest-environment node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
    CANONICAL_ERROR_CODES,
    COMPANY_AUTHORITY_CAPABILITY,
    CONTRACT_ID,
    applyFixtureMutations,
    canonicalJson,
    createDetachedJws,
    validateCanonicalExecutionContext,
    validateObservedExecutionRequest,
    validateWireResponseStructure,
    verifyDetachedJws
} from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';

const contractRoot = resolve('contracts/mana-brainbase-company-authority/v1');
const fixtureRoot = resolve(contractRoot, 'fixtures');

async function readJson(relativePath, root = contractRoot) {
    return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
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

function pointerValue(value, pointer) {
    return pointer.split('/').filter(Boolean).reduce((current, token) => current[token], value);
}

const contract = await readJson('producer.contract.json');
const sourceLock = await readJson('source-lock.json');
const manifest = await readJson('fixtures/manifest.json');
const fixtures = await readJson(manifest.cases);
const testKey = await readJson('fixtures/test-key.json');
const fixtureSchema = await readJson('fixtures/fixture.schema.json');
const observedRequestSchema = await readJson('schema/observed-execution-request.schema.json');
const canonicalContextSchema = await readJson('schema/canonical-execution-context.schema.json');
const responseSchema = await readJson('schema/company-authority-resolution-response.schema.json');
const schemaValidators = (() => {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    ajv.addSchema(observedRequestSchema, observedRequestSchema.$id);
    ajv.addSchema(canonicalContextSchema, canonicalContextSchema.$id);
    ajv.addSchema(responseSchema, responseSchema.$id);
    ajv.addSchema(fixtureSchema, fixtureSchema.$id);
    return {
        observed: ajv.getSchema(observedRequestSchema.$id),
        fixture: ajv.getSchema(fixtureSchema.$id),
        response: ajv.getSchema(responseSchema.$id)
    };
})();

describe('Brainbase company authority producer contract v1', () => {
    it('keeps delivery optional at the observed boundary for fail-closed diagnostics', () => {
        const fixture = fixtures.positive[0];
        const withoutDelivery = structuredClone(fixture.request);
        delete withoutDelivery.delivery;
        expect(() => validateObservedExecutionRequest(withoutDelivery)).not.toThrow();
    });

    it('fixes the request/context wire path and company_authority_v1 capability path', () => {
        expect(contract.contract_id).toBe(CONTRACT_ID);
        expect(contract.contract_status).toBe('contract_ready');
        expect(contract.wire.request).toBe('$');
        expect(contract.wire.success_response).toBe('$');
        expect(contract.wire.success_context).toBe('$.context');
        expect(contract.wire.error).toBe('$.error');
        expect(contract.wire.response_context).toBe('$.context');
        expect(contract.wire.response_error).toBe('$.error');
        expect(contract.required_capability).toBe(COMPANY_AUTHORITY_CAPABILITY);
        expect(contract.required_capability_role).toBe('protocol_marker');
        expect(contract.required_capability_path).toBe('$.context.tenant_context.authorization.capability_ids');
        expect(contract.requested_operation_capability_path).toBe('$.context.authority.capability_id');
        expect(contract.canonical_context.required_capability_path)
            .toBe('$.context.tenant_context.authorization.capability_ids');
        expect(contract.canonical_context.requested_operation_capability_path)
            .toBe('$.context.authority.capability_id');
        expect(contract.wire.requested_operation_capability_path).toBe('$.context.authority.capability_id');
        expect(contract.wire.company_authority_capability_path)
            .toBe('$.context.tenant_context.authorization.capability_ids');
        expect(contract.wire.error_correlation_path).toBe('$.error.correlation_id');
        expect(observedRequestSchema['x-requested-operation-capability-path'])
            .toBe('$.requested_action.capability_id');
        expect(canonicalContextSchema['x-requested-operation-capability-path'])
            .toBe('$.authority.capability_id');
        expect(canonicalContextSchema['x-protocol-capability-marker']).toEqual({
            path: '$.tenant_context.authorization.capability_ids',
            value: COMPANY_AUTHORITY_CAPABILITY,
            role: 'protocol_marker'
        });
        expect(responseSchema['x-error-correlation-path']).toBe('$.error.correlation_id');
        expect(contract.canonical_json.profile).toBe('RFC8785_JCS');
        expect(contract.signature.profile).toBe('detached-jws-ed25519');
        expect(contract.canonical_error_codes).toEqual(CANONICAL_ERROR_CODES);
        expect(contract.observed_request_boundary.provider_scope).toEqual({
            allowed: ['slack'],
            nested_tenant_context_provider: 'slack',
            non_slack_behavior: 'reject_until_a_provider_specific_nested_envelope_is_contractual'
        });
        expect(observedRequestSchema['x-supported-providers']).toEqual(['slack']);
        expect(contract.canonical_context.cross_layer_bindings).toEqual([
            'request.provider_identity.authenticated_subject_id == actor.external_subject_id',
            'actor.external_subject_id == tenant_context.actor.authenticated_subject_id',
            'actor.canonical_person_id == tenant_context.actor.principal_id',
            'scope.organization_id in tenant_context.authorization.organization_ids',
            'scope.project_id in tenant_context.authorization.project_ids',
            'scope.placement_id == tenant_context.placement.deployment_id',
            'request.provider_identity.workspace_id == tenant_context.workspace_connection.workspace_id',
            'request.provider_identity.app_id == tenant_context.workspace_connection.app_id',
            'request.provider_identity.enterprise_id == tenant_context.slack.enterprise_id',
            'request.delivery.channel_id == tenant_context.slack.channel_id',
            'request.delivery.thread_ts == tenant_context.slack.thread_ts',
            'request.delivery.event_id == tenant_context.slack.event_id'
        ]);
        expect(canonicalContextSchema['x-cross-layer-bindings']).toHaveLength(12);
    });

    it('pins a manifest digest without producer commit self-reference', async () => {
        expect(manifest.fixture_set_status).toBe('materialized');
        expect(manifest.hash_algorithm).toBe('sha256(relative_path + NUL + file_bytes)');
        expect(await fixtureSetDigest(manifest)).toBe(manifest.fixture_set_sha256);
        expect(sourceLock.fixture_set_sha256).toBe(manifest.fixture_set_sha256);
        expect(sourceLock.manifest_version).toBe(manifest.manifest_version);
        expect(sourceLock).not.toHaveProperty('commit');
        expect(sourceLock).not.toHaveProperty('head');
        expect(sourceLock).not.toHaveProperty('producer_merge_sha');
    });

    it('validates cases through the manifest-referenced fixture schema and exact manifest coverage', () => {
        expect(manifest.fixture_schema).toBe('fixtures/fixture.schema.json');
        expect(manifest.cases).toBe('fixtures/cases.json');
        expect(schemaValidators.fixture(fixtures), JSON.stringify(schemaValidators.fixture.errors)).toBe(true);

        const positiveIds = fixtures.positive.map(({ id }) => id);
        const negativeIds = fixtures.negative.map(({ id }) => id);
        expect(positiveIds).toHaveLength(manifest.positive_case_count);
        expect(negativeIds).toHaveLength(manifest.negative_case_count);
        expect(new Set(positiveIds).size).toBe(positiveIds.length);
        expect(new Set(negativeIds).size).toBe(negativeIds.length);
        expect(new Set(manifest.positive_case_ids).size).toBe(manifest.positive_case_ids.length);
        expect(new Set(manifest.negative_case_ids).size).toBe(manifest.negative_case_ids.length);
        expect(manifest.positive_case_ids).toEqual(positiveIds);
        expect(manifest.negative_case_ids).toEqual(negativeIds);
        expect(manifest.required_case_categories).toEqual(fixtures.required_case_categories);
        expect(fixtures.positive).toHaveLength(9);
        expect(fixtures.negative).toHaveLength(52);
    });

    it('rejects every resolved authority field injected into ObservedExecutionRequestV1 at both boundaries', () => {
        const forbidden = fixtures.negative.filter(({ category }) => category === 'request_authority_field_forbidden');
        expect(forbidden.map(({ forbidden_field: field }) => field))
            .toEqual(contract.observed_request_boundary.authority_fields_forbidden);
        for (const fixture of forbidden) {
            const base = fixtures.positive.find(({ id }) => id === fixture.base_fixture);
            assert.ok(base, `base fixture not found: ${fixture.base_fixture}`);
            const mutated = applyFixtureMutations({ request: base.request, context: base.context }, fixture.mutations);
            expect(schemaValidators.observed(mutated.request)).toBe(false);
            expect(schemaValidators.observed.errors?.some(({ keyword }) => keyword === 'not')).toBe(true);
            let thrown;
            try {
                validateObservedExecutionRequest(mutated.request);
            } catch (error) {
                thrown = error;
            }
            expect(thrown?.code).toBe('AUTHORITY_CONTEXT_INVALID_SIGNATURE');
            expect(thrown?.details).toMatchObject({
                field: fixture.forbidden_field,
                reason: 'forbidden_authority_field'
            });
            expect(fixture.expected.business_effects).toEqual({
                business_api_called: false,
                llm_called: false,
                credential_lease_issued: false,
                external_side_effect: false
            });
        }
    });

    it('validates deterministic synthetic positive payloads and all four decisions', () => {
        expect(fixtures.synthetic_data_only).toBe(true);
        const decisions = new Set();
        for (const fixture of fixtures.positive) {
            validateObservedExecutionRequest(fixture.request);
            if (fixture.context) {
                validateCanonicalExecutionContext(fixture.context, {
                    expectedAudience: contract.signature.audience,
                    now: fixture.evaluation_time,
                    request: fixture.request
                });
                verifyDetachedJws(fixture.context, testKey.public_jwk);
                expect(fixture.context.tenant_context.authorization.capability_ids)
                    .toContain(COMPANY_AUTHORITY_CAPABILITY);
                expect(fixture.context.authority.capability_id)
                    .toBe(fixture.request.requested_action.capability_id);
                expect(fixture.context.authority.capability_id)
                    .not.toBe(COMPANY_AUTHORITY_CAPABILITY);
                decisions.add(fixture.context.authority.decision);
                if (fixture.context.authority.decision === 'deny') {
                    expect(fixture.expected.code).toBe('COMPANY_AUTHORITY_DENIED');
                    expect(fixture.expected.outcome).toBe('deny_without_effect');
                }
                if (fixture.context.authority.decision === 'approval') {
                    expect(fixture.context.authority.approver_person_id).toBe('person-umeda');
                }
                if (fixture.context.authority.decision === 'human_action') {
                    expect(fixture.context.authority.responsible_person_id).toBe(fixture.context.actor.canonical_person_id);
                }
                if (fixture.operation === 'personal') {
                    expect(fixture.context.scope.owner_person_id).toBe(fixture.context.actor.canonical_person_id);
                }
            }
        }
        expect([...decisions].sort()).toEqual(['approval', 'auto', 'deny', 'human_action']);
    });

    it('separates the requested operation capability from the protocol marker', () => {
        const base = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        assert.ok(base?.context);
        const request = structuredClone(base.request);
        const context = structuredClone(base.context);
        request.requested_action.capability_id = 'company_read';
        context.authority.capability_id = 'company_read';
        expect(context.tenant_context.authorization.capability_ids)
            .toContain(COMPANY_AUTHORITY_CAPABILITY);
        expect(context.authority.capability_id).not.toBe(COMPANY_AUTHORITY_CAPABILITY);
        expect(schemaValidators.observed(request), JSON.stringify(schemaValidators.observed.errors)).toBe(true);
        expect(schemaValidators.response({
            schema_version: '1.0',
            contract_id: CONTRACT_ID,
            correlation_id: request.correlation_id,
            context,
            error: null
        }), JSON.stringify(schemaValidators.response.errors)).toBe(true);
        expect(() => validateCanonicalExecutionContext(context, {
            expectedAudience: contract.signature.audience,
            now: base.evaluation_time,
            request
        })).not.toThrow();
    });

    it('rejects cross-layer identity and scope mismatches and non-Slack providers', () => {
        const base = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        assert.ok(base?.context);
        const mismatches = [
            {
                name: 'request subject to outer actor',
                mutate: ({ request }) => { request.provider_identity.authenticated_subject_id = 'person-umeda'; },
                expected: 'AUTHORITY_SCOPE_MISMATCH'
            },
            {
                name: 'outer subject to nested authenticated actor',
                mutate: ({ context }) => { context.tenant_context.actor.authenticated_subject_id = 'person-umeda'; },
                expected: 'AUTHORITY_SCOPE_MISMATCH'
            },
            {
                name: 'outer person to nested principal actor',
                mutate: ({ context }) => { context.tenant_context.actor.principal_id = 'person-umeda'; },
                expected: 'AUTHORITY_SCOPE_MISMATCH'
            },
            {
                name: 'outer organization to nested authorization',
                mutate: ({ context }) => { context.tenant_context.authorization.organization_ids = ['organization-tenant-b']; },
                expected: 'AUTHORITY_CROSS_ORG'
            },
            {
                name: 'outer project to nested authorization',
                mutate: ({ context }) => { context.tenant_context.authorization.project_ids = ['project-b']; },
                expected: 'AUTHORITY_SCOPE_MISMATCH'
            },
            {
                name: 'outer placement to nested placement',
                mutate: ({ context }) => { context.tenant_context.placement.deployment_id = 'deployment-tenant-b'; },
                expected: 'AUTHORITY_SCOPE_MISMATCH'
            }
        ];
        for (const mismatch of mismatches) {
            const candidate = { request: structuredClone(base.request), context: structuredClone(base.context) };
            mismatch.mutate(candidate);
            let thrown;
            try {
                validateCanonicalExecutionContext(candidate.context, {
                    expectedAudience: contract.signature.audience,
                    now: base.evaluation_time,
                    request: candidate.request
                });
            } catch (error) {
                thrown = error;
            }
            expect(thrown?.code, mismatch.name).toBe(mismatch.expected);
        }

        const nonSlack = structuredClone(base.request);
        nonSlack.provider_identity.provider = 'codex';
        expect(schemaValidators.observed(nonSlack)).toBe(false);
        expect(() => validateObservedExecutionRequest(nonSlack)).toThrow('invalid value');
    });

    it('locks Slack request-to-nested binding negatives to exact fixture paths and category', () => {
        const expectedBindings = [
            ['NEG-REQUEST-WORKSPACE-ID-NESTED-MISMATCH', '/request/provider_identity/workspace_id'],
            ['NEG-REQUEST-APP-ID-NESTED-MISMATCH', '/request/provider_identity/app_id'],
            ['NEG-REQUEST-ENTERPRISE-ID-NESTED-MISMATCH', '/request/provider_identity/enterprise_id'],
            ['NEG-REQUEST-CHANNEL-ID-NESTED-MISMATCH', '/request/delivery/channel_id'],
            ['NEG-REQUEST-THREAD-TS-NESTED-MISMATCH', '/request/delivery/thread_ts'],
            ['NEG-REQUEST-EVENT-ID-NESTED-MISMATCH', '/request/delivery/event_id']
        ];
        const fixtureById = new Map(fixtures.negative.map((fixture) => [fixture.id, fixture]));
        for (const [id, requestPath] of expectedBindings) {
            const fixture = fixtureById.get(id);
            expect(fixture, `missing Slack binding fixture ${id}`).toBeDefined();
            expect(fixture.category).toBe('cross_layer_binding');
            expect(fixture.target).toBe('binding');
            expect(fixture.mutations).toHaveLength(1);
            expect(fixture.mutations[0].operation).toBe('set');
            expect(fixture.mutations[0].path).toBe(requestPath);
            expect(fixture.expected.code).toBe('AUTHORITY_SCOPE_MISMATCH');
            expect(fixture.expected.business_effects).toEqual({
                business_api_called: false,
                llm_called: false,
                credential_lease_issued: false,
                external_side_effect: false
            });
        }
    });

    it('fixes human_action as pending completion and deny as zero-effect machine outcomes', () => {
        const humanAction = fixtures.positive.find(({ id }) => id === 'POS-HUMAN-ACTION-COMPANY-WRITE');
        expect(humanAction?.expected.machine_action).toEqual({
            kind: 'human_action',
            notification_required: true,
            completion_required: true,
            completion_status: 'pending_human_action'
        });
        expect(humanAction?.expected.machine_action.completion_status).not.toBe('completed');

        const deny = fixtures.positive.find(({ id }) => id === 'POS-DENY-COMPANY-WRITE');
        expect(deny?.expected.business_effects).toEqual({
            business_api_called: false,
            llm_called: false,
            credential_lease_issued: false,
            external_side_effect: false
        });
    });

    it('binds all four tenant/person matrix entries to concrete positive fixtures', () => {
        expect(fixtures.tenant_person_matrix).toHaveLength(4);
        const positiveById = new Map(fixtures.positive.map((fixture) => [fixture.id, fixture]));
        for (const entry of fixtures.tenant_person_matrix) {
            expect(entry.positive_case_id).toEqual(expect.any(String));
            const fixture = positiveById.get(entry.positive_case_id);
            expect(fixture?.context).toBeTruthy();
            expect(fixture.context.tenant_context.tenant.tenant_id).toBe(entry.canonical_tenant_id);
            expect(fixture.context.actor.canonical_person_id).toBe(entry.person_id);
            expect(fixture.request.provider_identity.authenticated_subject_id).toBe(entry.person_id);
        }
    });

    it('keeps Personal cross-person negatives independent and directionally distinct', () => {
        const positiveById = new Map(fixtures.positive.map((fixture) => [fixture.id, fixture]));
        const satoToUmeda = fixtures.negative.find(({ id }) => id === 'NEG-PERSONAL-CROSS-PERSON-SATO-TO-UMEDA');
        const umedaToSato = fixtures.negative.find(({ id }) => id === 'NEG-PERSONAL-CROSS-PERSON-UMEDA-TO-SATO');
        assert.ok(satoToUmeda);
        assert.ok(umedaToSato);
        const satoBase = positiveById.get(satoToUmeda.base_fixture);
        const umedaBase = positiveById.get(umedaToSato.base_fixture);
        assert.ok(satoBase?.context);
        assert.ok(umedaBase?.context);

        expect(satoBase.context.actor.canonical_person_id).toBe('person-sato');
        expect(satoBase.context.scope.owner_person_id).toBe('person-sato');
        expect(satoToUmeda.personal_target_person_id).toBe('person-umeda');
        expect(umedaToSato.base_fixture).not.toBe(satoToUmeda.base_fixture);
        expect(umedaBase.context.actor.canonical_person_id).toBe('person-umeda');
        expect(umedaBase.context.scope.owner_person_id).toBe('person-umeda');
        expect(umedaToSato.personal_target_person_id).toBe('person-sato');
    });

    it.each(fixtures.negative)('$id fails closed with $expected.code', (fixture) => {
        const base = fixtures.positive.find(({ id }) => id === fixture.base_fixture);
        assert.ok(base, `base fixture not found: ${fixture.base_fixture}`);
        const mutated = applyFixtureMutations({ request: base.request, context: base.context }, fixture.mutations);
        let thrown;
        try {
            if (fixture.target === 'request') validateObservedExecutionRequest(mutated.request);
            else if (fixture.target === 'context') {
                validateCanonicalExecutionContext(mutated.context, {
                    expectedAudience: contract.signature.audience,
                    now: fixture.evaluation_time ?? base.evaluation_time
                });
                verifyDetachedJws(mutated.context, testKey.public_jwk);
            } else if (fixture.target === 'binding') {
                validateCanonicalExecutionContext(mutated.context, {
                    expectedAudience: contract.signature.audience,
                    now: fixture.evaluation_time ?? base.evaluation_time,
                    request: mutated.request,
                    expectedRevisions: fixture.expected_revisions,
                    identityStatus: fixture.identity_status,
                    crossOrg: fixture.cross_org,
                    scopeMismatch: fixture.scope_mismatch,
                    membershipStatus: fixture.membership_status,
                    authorityUnavailable: fixture.authority_unavailable,
                    approvalSubjectId: fixture.approval_subject_id,
                    personalTargetPersonId: fixture.personal_target_person_id,
                    replayConflict: fixture.replay_conflict
                });
            } else {
                throw new Error(`unknown fixture target: ${fixture.target}`);
            }
        } catch (error) {
            thrown = error;
        }
        expect(thrown?.code).toBe(fixture.expected.code);
        expect(fixture.expected.business_effects).toEqual({
            business_api_called: false,
            llm_called: false,
            credential_lease_issued: false,
            external_side_effect: false
        });
    });

    it('keeps canonical JSON stable for signature input and rejects tampering', () => {
        const fixture = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        const unsigned = structuredClone(fixture.context);
        delete unsigned.integrity;
        expect(canonicalJson(unsigned)).toBe(fixture.unsigned_context_canonical_json);
        expect(createDetachedJws(unsigned, testKey.private_jwk, testKey.key_id))
            .toBe(fixture.context.integrity.value);
        const tampered = structuredClone(fixture.context);
        tampered.scope.resource_ref = 'company://tenant-a/other';
        let thrown;
        try {
            verifyDetachedJws(tampered, testKey.public_jwk);
        } catch (error) {
            thrown = error;
        }
        expect(thrown?.code).toBe('AUTHORITY_CONTEXT_INVALID_SIGNATURE');
    });

    it('accepts valid Unicode pairs and rejects only lone UTF-16 surrogates', () => {
        expect(canonicalJson({ emoji: '😀', han: '𠮷' })).toBe('{"emoji":"😀","han":"𠮷"}');
        expect(() => canonicalJson('\ud83d')).toThrow(/surrogates/);
        expect(() => canonicalJson('\ude00')).toThrow(/surrogates/);
    });

    it('rejects RFC3339 offset timestamps because the shared verifier is Z-only', () => {
        const base = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        const offsetContext = structuredClone(base.context);
        offsetContext.issued_at = '2026-08-21T09:00:00+09:00';
        offsetContext.expires_at = '2026-08-21T09:05:00+09:00';
        offsetContext.tenant_context.issued_at = '2026-08-21T09:00:00+09:00';
        offsetContext.tenant_context.expires_at = '2026-08-21T09:05:00+09:00';
        const response = {
            schema_version: '1.0',
            contract_id: CONTRACT_ID,
            correlation_id: base.request.correlation_id,
            context: offsetContext,
            error: null
        };
        expect(schemaValidators.response(response)).toBe(false);
        expect(() => validateCanonicalExecutionContext(offsetContext, {
            expectedAudience: contract.signature.audience,
            now: '2026-08-21T09:01:00+09:00',
            request: base.request
        })).toThrow(/date-time|invalid|TIME/);
    });

    it('validates response schema and enforces exactly one context or error', () => {
        const normal = fixtures.positive.find(({ id }) => id === 'POS-AUTO-COMPANY-READ');
        const diagnostic = fixtures.positive.find(({ id }) => id === 'POS-AUTHORITY-UNAVAILABLE-CONNECTION-DIAGNOSTIC');
        const success = {
            schema_version: '1.0',
            contract_id: CONTRACT_ID,
            correlation_id: normal.request.correlation_id,
            context: normal.context,
            error: null
        };
        const diagnosticError = {
            schema_version: '1.0',
            contract_id: CONTRACT_ID,
            correlation_id: diagnostic.request.correlation_id,
            context: null,
            error: {
                correlation_id: diagnostic.request.correlation_id,
                code: 'AUTHORITY_UNAVAILABLE',
                phase: 'authority',
                retryable: true,
                business_effect: false
            }
        };
        expect(schemaValidators.response(success)).toBe(true);
        expect(schemaValidators.response(diagnosticError)).toBe(true);
        expect(() => validateWireResponseStructure(success)).not.toThrow();
        expect(() => validateWireResponseStructure(diagnosticError)).not.toThrow();

        const mismatchedErrorCorrelation = structuredClone(diagnosticError);
        mismatchedErrorCorrelation.error.correlation_id = 'corr-other';
        expect(() => validateWireResponseStructure(mismatchedErrorCorrelation))
            .toThrow(/correlation/);

        const neither = { ...success, context: null };
        const both = { ...diagnosticError, context: normal.context, error: diagnosticError.error };
        expect(schemaValidators.response(neither)).toBe(false);
        expect(schemaValidators.response(both)).toBe(false);
        expect(() => validateWireResponseStructure(neither)).toThrow(/exactly one/);
        expect(() => validateWireResponseStructure(both)).toThrow(/exactly one/);
    });

    it('pins diagnostic allowlist, diagnostic outcome, and response context/error paths', () => {
        const diagnostic = fixtures.positive.find(({ id }) => id === 'POS-AUTHORITY-UNAVAILABLE-CONNECTION-DIAGNOSTIC');
        expect(diagnostic).toBeDefined();
        expect(diagnostic.expected.outcome).toBe('diagnostic_allowed');
        expect(diagnostic.operation).toBe('connection_diagnostic');
        expect(diagnostic.request.requested_action.capability_id).toBe('connection_diagnostic');
        expect(diagnostic.context).toBeNull();
        expect(contract.fixture_coverage.diagnostic_allowlist).toContain(diagnostic.operation);
        expect(contract.wire.success_response).toBe('$');
        expect(contract.wire.success_context).toBe('$.context');
        expect(contract.wire.response_context).toBe('$.context');
        expect(contract.wire.error).toBe('$.error');
        expect(contract.wire.response_error).toBe('$.error');

        const diagnosticError = {
            schema_version: '1.0',
            contract_id: CONTRACT_ID,
            correlation_id: diagnostic.request.correlation_id,
            context: null,
            error: {
                correlation_id: diagnostic.request.correlation_id,
                code: 'AUTHORITY_UNAVAILABLE',
                phase: 'authority',
                retryable: true,
                business_effect: false
            }
        };
        expect(schemaValidators.response(diagnosticError)).toBe(true);
        expect(() => validateWireResponseStructure(diagnosticError)).not.toThrow();
    });

    it('pins the contract-only trust boundary and non-authoritative reference validator', () => {
        expect(contract.execution_boundary.runtime_changes).toBe('none');
        expect(contract.execution_boundary.production_action).toBe('not_performed');
        expect(contract.execution_boundary.trusted_kid_key_resolution).toMatch(/runtime_non_goal/);
        expect(contract.execution_boundary.reference_validator_authority).toBe('non_authoritative_conformance_only');
        expect(contract.execution_boundary.production_cutover).toMatch(/blocked_until_runtime_trust_store/);
        expect(sourceLock.execution_boundary.reference_validator_authority).toBe('non_authoritative_conformance_only');
        expect(sourceLock.execution_boundary.production_cutover).toMatch(/blocked_until_runtime_trust_store/);
    });

    it('records the expected negative matrix categories and exact error vocabulary', () => {
        expect(fixtures.required_case_categories).toEqual(expect.arrayContaining([
            'desired_effect_explicit',
            'company_authority_required',
            'decision_modes',
            'unknown_person',
            'cross_org',
            'stale_revision',
            'wrong_approver',
            'personal_no_fallback',
            'context_integrity'
        ]));
        expect(fixtures.required_case_categories).toEqual(expect.arrayContaining([
            'cross_layer_binding',
            'provider_scope_v1'
        ]));
        for (const fixture of fixtures.negative) {
            expect(CANONICAL_ERROR_CODES).toContain(fixture.expected.code);
            expect(pointerValue(fixture, '/expected/business_effects/external_side_effect')).toBe(false);
        }
    });
});
