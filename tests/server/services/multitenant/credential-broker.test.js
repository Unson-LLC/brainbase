import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CredentialBroker } from '../../../../server/services/multitenant/credential-broker.js';
import { expectContractError, expectContractErrorAsync } from './test-helpers.js';

const binding = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_revision: '2',
    credential_ref: 'credref:opaque',
    credential_mode: 'customer_oauth',
    contract_revision: '1'
};

function leaseRequest(overrides = {}) {
    const { binding: bindingOverride, ...requestOverrides } = overrides;
    return {
        message_type: 'credential_lease_request',
        protocol_version: '1.0',
        binding: {
            ...binding,
            operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            audience: 'mana-runtime',
            ...bindingOverride
        },
        requested_ttl_seconds: 60,
        ...requestOverrides
    };
}

describe('CredentialBroker', () => {
    it('D-005/AC-104/AC-305: 最大60秒、single-use、operation/audience/mode束縛のopaque leaseを発行する', () => {
        let nowMs = Date.parse('2026-08-16T00:00:00Z');
        const broker = new CredentialBroker({ now: () => new Date(nowMs) });
        broker.register(binding);

        expectContractError(
            () => broker.issueLease(leaseRequest({ requested_ttl_seconds: 61 })),
            { code: 'CREDENTIAL_LEASE_TTL_INVALID' }
        );
        const lease = broker.issueLease(leaseRequest());
        expect(lease).not.toHaveProperty('credential');
        expect(lease).not.toHaveProperty('credential_value');
        expect(lease).toMatchObject({ lease_id: expect.any(String), contract_revision: '1', max_uses: 1 });
        expectContractError(
            () => broker.consumeLease({ lease_id: lease.lease_id, lease_token: lease.lease_token, operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV', audience: 'other' }),
            { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH' }
        );
        const volatile = broker.consumeLease({
            lease_id: lease.lease_id,
            lease_token: lease.lease_token,
            operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            audience: 'mana-runtime',
            materialize: () => randomBytes(32)
        });
        expect(Buffer.isBuffer(volatile)).toBe(true);
        expectContractError(
            () => broker.consumeLease({ lease_id: lease.lease_id, lease_token: lease.lease_token, operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV', audience: 'mana-runtime' }),
            { code: 'CREDENTIAL_LEASE_ALREADY_USED' }
        );
    });

    it('D-005: OAuth refreshをexpected revisionのCASで更新し競合を監査する', () => {
        const broker = new CredentialBroker();
        broker.register({ ...binding, refresh_revision: '4' });
        expect(broker.compareAndSwapRefresh({
            credential_ref: binding.credential_ref,
            expected_refresh_revision: '4',
            new_credential_ref: 'credref:rotated'
        })).toMatchObject({ credential_ref: 'credref:rotated', refresh_revision: '5' });
        expectContractError(() => broker.compareAndSwapRefresh({
            credential_ref: 'credref:rotated', expected_refresh_revision: '4', new_credential_ref: 'credref:stale'
        }), { code: 'OAUTH_REFRESH_CONFLICT' });
        expect(broker.auditEvents.every((event) => !JSON.stringify(event).includes('token'))).toBe(true);
    });

    it('D-005/AC-105/AC-305: refresh・reinstall後の旧leaseを拒否し新しいbindingだけを許可する', () => {
        const broker = new CredentialBroker();
        broker.register({ ...binding, refresh_revision: '1' });
        const oldOperationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FB0';
        const newOperationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FB1';
        const reinstallOperationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FB2';
        const oldLease = broker.issueLease(leaseRequest({ binding: { operation_id: oldOperationId } }));
        const rotated = broker.compareAndSwapRefresh({ credential_ref: binding.credential_ref, expected_refresh_revision: '1', new_credential_ref: 'credref:rotated' });
        expectContractError(() => broker.consumeLease({ lease_id: oldLease.lease_id, lease_token: oldLease.lease_token, operation_id: oldOperationId, audience: 'mana-runtime' }), { code: 'CREDENTIAL_BINDING_STALE' });
        expect(broker.issueLease(leaseRequest({ binding: { credential_ref: rotated.credential_ref, operation_id: newOperationId } }))).toHaveProperty('lease_id');

        const revisionTwo = { ...binding, connection_revision: '3', credential_ref: 'credref:revision-3' };
        broker.register(revisionTwo);
        const staleRevisionLease = broker.issueLease(leaseRequest({ binding: { ...revisionTwo, operation_id: reinstallOperationId } }));
        broker.register({ ...revisionTwo, connection_revision: '4', credential_ref: 'credref:revision-4' });
        expectContractError(() => broker.consumeLease({ lease_id: staleRevisionLease.lease_id, lease_token: staleRevisionLease.lease_token, operation_id: reinstallOperationId, audience: 'mana-runtime' }), { code: 'CREDENTIAL_BINDING_STALE' });
    });
});

describe('CredentialBroker PostgreSQL ownership', () => {
    it('D-005: production OAuth refresh CASをBrainbase repositoryへ委譲する', async () => {
        const repository = {
            compareAndSwapRefresh: vi.fn(async () => ({ credential_ref: 'credref:new', refresh_revision: '8' }))
        };
        const broker = new CredentialBroker({ repository });
        const input = {
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref:old',
            expected_refresh_revision: '7',
            new_credential_ref: 'credref:new'
        };

        await expect(broker.compareAndSwapRefresh(input)).resolves.toEqual({ credential_ref: 'credref:new', refresh_revision: '8' });
        expect(repository.compareAndSwapRefresh).toHaveBeenCalledWith(input);
    });

    it('P0-1/AC-104: trusted provider-forwarderだけがopaque refをmaterializeしleaseをglobal single-useにする', async () => {
        const credentialMaterial = randomBytes(32);
        const repository = {
            issueCredentialLease: vi.fn(async () => undefined),
            consumeCredentialLease: vi.fn(async () => ({
                ...binding,
                operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                audience: 'api.openai.com',
                provider: 'openai'
            }))
        };
        const materialize = vi.fn(async (credentialRef) => {
            expect(credentialRef).toBe(binding.credential_ref);
            return Buffer.from(credentialMaterial);
        });
        const forward = vi.fn(async ({ credential, operation, request }) => {
            expect(Buffer.compare(credential, credentialMaterial)).toBe(0);
            return {
                status: 200,
                response_encoding: 'json',
                content_type: 'application/json',
                body: { id: 'provider-result', operation, accepted: request.body.input === 'hello' }
            };
        });
        const broker = new CredentialBroker({
            repository,
            credentialMaterializer: { materialize },
            providerForwarders: { 'api.openai.com': { provider: 'openai', forward } },
            leaseId: () => 'lease_01ARZ3NDEKTSV4RRFFQ69G5FB1',
            leaseToken: () => 'opaque-test-capability'
        });
        broker.register({ ...binding, provider: 'openai' });
        const lease = await broker.issueLease(leaseRequest({ binding: { audience: 'api.openai.com' } }));

        const result = await broker.forwardProviderRequest({
            tenant_id: binding.tenant_id,
            connection_id: binding.connection_id,
            connection_revision: binding.connection_revision,
            credential_ref: binding.credential_ref,
            credential_mode: binding.credential_mode,
            contract_revision: binding.contract_revision,
            operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            audience: 'api.openai.com',
            lease_id: lease.lease_id,
            lease_token: lease.lease_token,
            provider_operation: 'responses.create',
            request: { body: { input: 'hello' } }
        });

        expect(result).toEqual({
            provider: 'openai',
            operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            provider_operation: 'responses.create',
            status: 200,
            response_encoding: 'json',
            content_type: 'application/json',
            body: { id: 'provider-result', operation: 'responses.create', accepted: true }
        });
        expect(repository.issueCredentialLease).toHaveBeenCalledWith(expect.objectContaining({
            lease_token_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            max_uses: 1
        }));
        expect(repository.consumeCredentialLease).toHaveBeenCalledWith(expect.objectContaining({
            lease_token_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            tenant_id: binding.tenant_id,
            audience: 'api.openai.com'
        }));
        expect(materialize).toHaveBeenCalledOnce();
        expect(forward).toHaveBeenCalledOnce();
        expect(JSON.stringify(result)).not.toContain(lease.lease_token);
        expect(JSON.stringify(result)).not.toContain(credentialMaterial.toString('base64'));
    });

    it('authority MCPはcanonical project bindingをtrusted forwarderへimmutableに渡す', async () => {
        const operationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FB3';
        const projectBinding = Object.freeze({ project_id: 'project_unson', project_code: 'unson' });
        const repository = {
            issueCredentialLease: vi.fn(async () => undefined),
            resolveProjectBindingById: vi.fn(async ({ tenant_id, project_id }) => ({
                tenant_id,
                project_id,
                project_code: 'unson',
                project_payload: { status: 'active' }
            })),
            consumeCredentialLease: vi.fn(async () => ({
                ...binding,
                operation_id: operationId,
                audience: 'bb.unson.jp',
                provider: 'slack',
                project_id: projectBinding.project_id,
                project_code: projectBinding.project_code
            }))
        };
        const forward = vi.fn(async ({ binding: forwardedBinding }) => {
            expect(Object.isFrozen(forwardedBinding)).toBe(true);
            expect(Object.isFrozen(forwardedBinding.authority_project_binding)).toBe(true);
            expect(forwardedBinding.authority_project_binding).toEqual(projectBinding);
            return {
                status: 200,
                response_encoding: 'json',
                content_type: 'application/json',
                body: { ok: true }
            };
        });
        const broker = new CredentialBroker({
            repository,
            providerForwarders: {
                'bb.unson.jp': {
                    provider: 'brainbase',
                    requiresCredential: () => false,
                    allowsBindingProviderMismatch: () => true,
                    forward
                }
            }
        });
        broker.register({ ...binding, provider: 'slack' });
        const lease = await broker.issueLease(leaseRequest({
            binding: { operation_id: operationId, audience: 'bb.unson.jp' }
        }));

        await expect(broker.forwardProviderRequest({
            ...lease.binding,
            lease_id: lease.lease_id,
            lease_token: lease.lease_token,
            provider_operation: 'brainbase.authority_mcp.post',
            authority_project_binding: projectBinding,
            request: { body: { project_id: 'caller-project', project_code: 'caller-code' } }
        })).resolves.toMatchObject({ provider: 'brainbase', status: 200 });
        expect(forward).toHaveBeenCalledOnce();
        expect(repository.resolveProjectBindingById).toHaveBeenCalledWith({
            tenant_id: binding.tenant_id,
            project_id: projectBinding.project_id
        });
        expect(repository.consumeCredentialLease).toHaveBeenCalledWith(expect.objectContaining({
            project_id: projectBinding.project_id,
            project_code: projectBinding.project_code
        }));
    });

    it.each([
        ['missing project_id', { project_code: 'unson' }],
        ['missing project_code', { project_id: 'project_unson' }],
        ['cross-tenant project id', { project_id: 'project-other', project_code: 'unson' }],
        ['forged project code', { project_id: 'project_unson', project_code: 'other' }]
    ])('authority MCPはlease consume結果の%sをremote call前に拒否する', async (_name, consumedProject) => {
        const operationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FC5';
        const consumeCredentialLease = vi.fn(async () => ({
            ...binding,
            operation_id: operationId,
            audience: 'bb.unson.jp',
            provider: 'slack',
            ...consumedProject
        }));
        const forward = vi.fn();
        const repository = {
            resolveProjectBindingById: vi.fn(async ({ tenant_id, project_id }) => ({
                tenant_id,
                project_id,
                project_code: 'unson',
                project_payload: { status: 'active' }
            })),
            consumeCredentialLease
        };
        const broker = new CredentialBroker({
            repository,
            providerForwarders: {
                'bb.unson.jp': {
                    provider: 'brainbase',
                    requiresCredential: () => false,
                    allowsBindingProviderMismatch: () => true,
                    forward
                }
            }
        });
        const lease = {
            lease_id: 'lease_01ARZ3NDEKTSV4RRFFQ69G5FC6',
            lease_token: 'opaque-test-capability'
        };

        await expectContractErrorAsync(() => broker.forwardProviderRequest({
            ...binding,
            operation_id: operationId,
            audience: 'bb.unson.jp',
            ...lease,
            provider_operation: 'brainbase.authority_mcp.post',
            authority_project_binding: { project_id: 'project_unson', project_code: 'unson' },
            request: { body: { jsonrpc: '2.0', method: 'tools/call', params: {
                name: 'brainbase_knowledge_resolve', arguments: {}
            } } }
        }), { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH', status: 403 });
        expect(forward).not.toHaveBeenCalled();
    });

    it.each([
        ['resolver unavailable', null, 'unson'],
        ['cross-tenant project', {
            tenant_id: 'ten_other', project_id: 'project_unson', project_code: 'unson',
            project_payload: { status: 'active' }
        }, 'unson'],
        ['project code mismatch', {
            tenant_id: binding.tenant_id, project_id: 'project_unson', project_code: 'other',
            project_payload: { status: 'active' }
        }, 'unson'],
        ['project without active status', {
            tenant_id: binding.tenant_id, project_id: 'project_unson', project_code: 'unson',
            project_payload: {}
        }, 'unson']
    ])('authority MCPは%sをlease消費前に拒否する', async (_name, canonicalProject, claimedCode) => {
        const consumeCredentialLease = vi.fn();
        const forward = vi.fn();
        const repository = canonicalProject === null
            ? { consumeCredentialLease }
            : {
                consumeCredentialLease,
                resolveProjectBindingById: vi.fn(async () => canonicalProject)
            };
        const broker = new CredentialBroker({
            repository,
            providerForwarders: { 'bb.unson.jp': { provider: 'brainbase', forward } }
        });

        await expectContractErrorAsync(() => broker.forwardProviderRequest({
            ...binding,
            operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FD0',
            audience: 'bb.unson.jp',
            lease_id: 'lease_01ARZ3NDEKTSV4RRFFQ69G5FD1',
            lease_token: 'opaque-test-capability',
            provider_operation: 'brainbase.authority_mcp.post',
            authority_project_binding: { project_id: 'project_unson', project_code: claimedCode },
            request: { body: {} }
        }), { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH', status: 403 });
        expect(consumeCredentialLease).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
    });

    it.each([
        ['brainbase.authority_mcp.post', 'CREDENTIAL_LEASE_SCOPE_MISMATCH', 403],
        ['brainbase.authority_judgment_hook.post', 'COMPANY_AUTHORITY_HOOK_SCOPE_UNAVAILABLE', 503]
    ])('authority operation %sはcanonical project bindingなしでlease消費前にfail-closedする', async (providerOperation, code, status) => {
        const repository = { consumeCredentialLease: vi.fn() };
        const forward = vi.fn();
        const broker = new CredentialBroker({
            repository,
            providerForwarders: { 'bb.unson.jp': { provider: 'brainbase', forward } }
        });

        await expectContractErrorAsync(() => broker.forwardProviderRequest({
            ...binding,
            operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FB4',
            audience: 'bb.unson.jp',
            lease_id: 'lease_01ARZ3NDEKTSV4RRFFQ69G5FB5',
            lease_token: 'opaque-test-capability',
            provider_operation: providerOperation,
            request: { body: {} }
        }), { code, status });
        expect(repository.consumeCredentialLease).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
    });

    it('明示許可されたcredentialless operationだけproviderが異なるleaseでもempty credentialでforwardする', async () => {
        const materialize = vi.fn(async () => Buffer.from('should-not-materialize'));
        const forward = vi.fn(async ({ credential }) => {
            expect(Buffer.isBuffer(credential)).toBe(true);
            expect(credential.length).toBe(0);
            return {
                status: 200,
                response_encoding: 'json',
                content_type: 'application/json',
                body: { ok: true }
            };
        });
        const broker = new CredentialBroker({
            credentialMaterializer: { materialize },
            providerForwarders: {
                'brainbase.tasks': {
                    provider: 'brainbase',
                    requiresCredential: () => false,
                    allowsBindingProviderMismatch: (operation) => operation === 'tasks.create',
                    forward
                }
            },
            leaseId: () => 'lease_01ARZ3NDEKTSV4RRFFQ69G5FC0',
            leaseToken: () => 'credentialless-forward-token'
        });
        broker.register({ ...binding, provider: 'slack' });
        const lease = broker.issueLease(leaseRequest({ binding: { audience: 'brainbase.tasks' } }));

        await expect(broker.forwardProviderRequest({
            ...lease.binding,
            lease_id: lease.lease_id,
            lease_token: lease.lease_token,
            provider_operation: 'tasks.create',
            request: { body: { title: 'credentialless' } }
        })).resolves.toMatchObject({
            provider: 'brainbase',
            status: 200,
            body: { ok: true }
        });
        expect(materialize).not.toHaveBeenCalled();
        expect(forward).toHaveBeenCalledOnce();
    });

    it('明示許可のないcredentialless operationはprovider mismatchを拒否する', async () => {
        const materialize = vi.fn();
        const forward = vi.fn();
        const broker = new CredentialBroker({
            credentialMaterializer: { materialize },
            providerForwarders: {
                'files.slack.com': {
                    provider: 'slack',
                    requiresCredential: () => false,
                    allowsBindingProviderMismatch: () => false,
                    forward
                }
            }
        });
        broker.register({ ...binding, provider: 'brainbase' });
        const lease = broker.issueLease(leaseRequest({ binding: { audience: 'files.slack.com' } }));

        await expectContractErrorAsync(() => broker.forwardProviderRequest({
            ...lease.binding,
            lease_id: lease.lease_id,
            lease_token: lease.lease_token,
            provider_operation: 'slack.files.upload_binary',
            request: { body: 'payload' }
        }), { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH', status: 403 });
        expect(materialize).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
    });

    it('未知のcredentialless operationはprovider mismatchを拒否する', async () => {
        const forward = vi.fn();
        const broker = new CredentialBroker({
            providerForwarders: {
                'brainbase.tasks': {
                    provider: 'brainbase',
                    requiresCredential: () => false,
                    allowsBindingProviderMismatch: (operation) => operation === 'tasks.create',
                    forward
                }
            }
        });
        broker.register({ ...binding, provider: 'slack' });
        const lease = broker.issueLease(leaseRequest({ binding: { audience: 'brainbase.tasks' } }));

        await expectContractErrorAsync(() => broker.forwardProviderRequest({
            ...lease.binding,
            lease_id: lease.lease_id,
            lease_token: lease.lease_token,
            provider_operation: 'tasks.unknown',
            request: { body: {} }
        }), { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH', status: 403 });
        expect(forward).not.toHaveBeenCalled();
    });

    it('credential-required operationはprovider mismatchを403で拒否しmaterializer/forwarderを呼ばない', async () => {
        const materialize = vi.fn(async () => Buffer.from('should-not-materialize'));
        const forward = vi.fn();
        const broker = new CredentialBroker({
            credentialMaterializer: { materialize },
            providerForwarders: {
                'api.openai.com': {
                    provider: 'openai',
                    requiresCredential: () => true,
                    forward
                }
            },
            leaseId: () => 'lease_01ARZ3NDEKTSV4RRFFQ69G5FC1',
            leaseToken: () => 'credential-required-mismatch-token'
        });
        broker.register({ ...binding, provider: 'slack' });
        const lease = broker.issueLease(leaseRequest({ binding: { audience: 'api.openai.com' } }));

        await expectContractErrorAsync(() => broker.forwardProviderRequest({
            ...lease.binding,
            lease_id: lease.lease_id,
            lease_token: lease.lease_token,
            provider_operation: 'responses.create',
            request: { body: { input: 'should reject' } }
        }), { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH', status: 403 });
        expect(materialize).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
    });
});
