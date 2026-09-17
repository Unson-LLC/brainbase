import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    createOutcomeServiceContextIssuer,
    outcomeOperationId
} from '../../../../server/services/multitenant/outcome-service-context-issuer.js';
import { canonicalJson } from '../../../../server/services/multitenant/canonical-json.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const connectionId = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const runId = 'run-a';
const operationId = outcomeOperationId(runId);
const resourceRef = 'meeting-minutes:github';

const profile = Object.freeze({
    profile_id: 'meeting_minutes_github_v1',
    audience: 'mana-runtime',
    capability_id: 'outcome.generate',
    deployment_id: deploymentId,
    workspace_id: 'outcome-runtime',
    app_id: 'mana-outcome-generator',
    authenticated_subject_id: 'service-binding:outcome-generator',
    connection_id: connectionId,
    resource_ref: resourceRef,
    organization_ids: ['org-a'],
    data_scopes: ['meeting_minutes:read']
});

const snapshot = Object.freeze({
    connection_id: connectionId,
    connection_revision: '7',
    tenant_id: tenantId,
    installation_id: 'outcome-service-profile-v1',
    workspace_id: 'outcome-runtime',
    app_id: 'mana-outcome-generator',
    installer_id: 'brainbase',
    granted_scopes: ['outcome.generate'],
    status: 'active',
    deployment_id: deploymentId,
    profile: 'shared_cloud',
    credential_mode: 'cloud_standard',
    contract_revision: '11'
});

const request = (runMode = 'normal') => ({
    profile: 'meeting_minutes_github_v1',
    principal: {
        tenant_id: tenantId,
        project_id: 'project-a',
        actor_principal_id: 'svc-outcome-generator'
    },
    persisted: {
        contract_id: 'contract-a',
        contract_version: '4',
        run_id: runId,
        resource_ref: resourceRef
    },
    required: {
        audience: 'mana-runtime',
        capability_id: 'outcome.generate',
        deployment_id: deploymentId,
        workspace_id: 'outcome-runtime',
        app_id: 'mana-outcome-generator',
        operation_id: operationId,
        authenticated_subject_id: 'service-binding:outcome-generator',
        run_mode: runMode
    }
});

const serviceIdentity = Object.freeze({
    issuer: 'brainbase',
    subject: 'svc_mana_runtime',
    audience: ['brainbase-api'],
    deployment_id: deploymentId,
    expires_at: '2026-09-17T00:10:00.000Z',
    capabilities: ['tenant_context:resolve']
});

const credential = Object.freeze({
    mode: 'cloud_standard',
    credential_ref: 'credential-outcome-service',
    billing_principal_id: 'billing-a'
});

function authority(runMode = 'normal', contractStatus = 'active', overrides = {}) {
    return {
        principal: {
            tenant_id: tenantId,
            project_id: 'project-a',
            actor_principal_id: 'svc-outcome-generator'
        },
        persisted: {
            contract_id: 'contract-a',
            contract_version: '4',
            run_id: runId,
            resource_ref: resourceRef
        },
        authority_revision: '9',
        profile_id: 'meeting_minutes_github_v1',
        run_mode: runMode,
        contract_status: contractStatus,
        ...overrides
    };
}

function createFixture({ runMode = 'normal', contractStatus = 'active', profileOverrides = {}, tenantOverrides = {}, snapshotOverrides = {}, authorityOverrides = {}, authorize = true } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const resolvedProfile = { ...profile, ...profileOverrides };
    const resolvedSnapshot = { ...snapshot, ...snapshotOverrides };
    const calls = { authorize: [], profile: [], tenant: [], connection: [], readback: [] };
    const issuer = createOutcomeServiceContextIssuer({
        signingKey: { key_id: 'brainbase-outcome-1', private_key: privateKey },
        authorizeService: async (...args) => {
            calls.authorize.push(args);
            return authorize;
        },
        resolveProfile: async (...args) => {
            calls.profile.push(args);
            return resolvedProfile.profile_id === 'meeting_minutes_github_v1' ? resolvedProfile : null;
        },
        resolveTenant: async (...args) => {
            calls.tenant.push(args);
            return { tenant_id: tenantId, tenant_revision: '3', status: 'active', ...tenantOverrides };
        },
        resolveConnection: async (...args) => {
            calls.connection.push(args);
            return { snapshot: resolvedSnapshot, credential };
        },
        readback: async (...args) => {
            calls.readback.push(args);
            return authority(runMode, contractStatus, authorityOverrides);
        },
        now: () => new Date('2026-09-17T00:00:00.000Z')
    });
    return { issuer, privateKey, publicKey, calls, resolvedProfile, resolvedSnapshot };
}

function decodeProtectedHeader(value) {
    const [protectedHeader, detached, signature] = value.split('.');
    expect(detached).toBe('');
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    return {
        protectedHeader,
        signature,
        header: JSON.parse(Buffer.from(protectedHeader, 'base64url').toString('utf8'))
    };
}

function verifyNodeSignature(envelope, publicKey) {
    const unsigned = { ...envelope };
    delete unsigned.integrity;
    const { protectedHeader, signature, header } = decodeProtectedHeader(envelope.integrity.value);
    expect(Buffer.from(protectedHeader, 'base64url').toString('utf8')).toBe(canonicalJson(header));
    expect(header).toEqual({
        alg: 'EdDSA',
        b64: false,
        crit: ['b64'],
        kid: 'brainbase-outcome-1',
        typ: 'application/mana-brainbase-tenant-context+jws'
    });
    return verify(null,
        Buffer.from(`${protectedHeader}.${canonicalJson(unsigned)}`),
        publicKey,
        Buffer.from(signature, 'base64url'));
}

describe('Outcome service context issuer', () => {
    it('issues a real Ed25519 normal context with the expected envelope bindings', async () => {
        const fixture = createFixture();
        const result = await fixture.issuer.issue(request(), serviceIdentity);
        expect(result.authoritative_snapshot).toEqual(fixture.resolvedSnapshot);
        expect(result.tenant_context).not.toHaveProperty('slack');
        expect(result.tenant_context.context_kind).toBe('outcome_service_actor');
        expect(result.tenant_context.service_actor.run_mode).toBe('normal');
        expect(verifyNodeSignature(result.tenant_context, fixture.publicKey)).toBe(true);
        expect(fixture.calls.authorize[0][0]).toEqual(serviceIdentity);
        expect(fixture.calls.readback[0][0]).toEqual({
            tenant: tenantId,
            project: 'project-a',
            actor: 'svc-outcome-generator',
            contract: 'contract-a',
            version: '4',
            run: runId,
            resource: resourceRef,
            profile
        });

    });

    it('issues safe_test draft context and binds run mode into the signed payload', async () => {
        const fixture = createFixture({ runMode: 'safe_test', contractStatus: 'draft' });
        const result = await fixture.issuer.issue(request('safe_test'), serviceIdentity);
        expect(result.tenant_context.service_actor.run_mode).toBe('safe_test');
        expect(verifyNodeSignature(result.tenant_context, fixture.publicKey)).toBe(true);
    });

    it.each([
        ['missing service identity', {}, 'outcome_issuer_service_denied'],
        ['service authorization denied', { authorize: false }, 'outcome_issuer_service_denied'],
        ['profile mismatch', { profileOverrides: { profile_id: 'other_profile' } }, 'outcome_issuer_profile_missing'],
        ['principal mismatch', { authorityOverrides: { principal: { ...authority().principal, actor_principal_id: 'svc-other' } } }, 'outcome_issuer_authority_mismatch'],
        ['contract mismatch', { authorityOverrides: { persisted: { ...authority().persisted, contract_id: 'contract-other' } } }, 'outcome_issuer_authority_mismatch'],
        ['mode mismatch', { runMode: 'safe_test', requestRunMode: 'normal', contractStatus: 'active' }, 'outcome_issuer_authority_mismatch'],
        ['normal draft contract', { runMode: 'normal', contractStatus: 'draft' }, 'outcome_issuer_authority_mismatch']
    ])('rejects %s before issuing a context', async (_name, options, code) => {
        const fixture = createFixture(options);
        const identity = _name === 'missing service identity' ? undefined : serviceIdentity;
        await expect(fixture.issuer.issue(request(options.requestRunMode ?? options.runMode ?? 'normal'), identity))
            .rejects.toMatchObject({ code });
    });

    it('rejects a signed context after a service actor binding is tampered with', async () => {
        const fixture = createFixture();
        const result = await fixture.issuer.issue(request(), serviceIdentity);
        const tampered = {
            ...result.tenant_context,
            service_actor: { ...result.tenant_context.service_actor, run_id: 'run-other' }
        };
        expect(verifyNodeSignature(tampered, fixture.publicKey)).toBe(false);
    });

    it('fails closed when a tenant or connection snapshot is stale or inactive', async () => {
        await expect(createFixture({ tenantOverrides: { tenant_id: 'ten_other' } }).issuer.issue(request(), serviceIdentity))
            .rejects.toMatchObject({ code: 'outcome_issuer_connection_mismatch' });
        await expect(createFixture({ snapshotOverrides: { status: 'revoked' } }).issuer.issue(request(), serviceIdentity))
            .rejects.toMatchObject({ code: 'outcome_issuer_connection_mismatch' });
        await expect(createFixture({ snapshotOverrides: { connection_revision: '' } }).issuer.issue(request(), serviceIdentity))
            .rejects.toMatchObject({ code: 'outcome_issuer_connection_mismatch' });
    });
});
