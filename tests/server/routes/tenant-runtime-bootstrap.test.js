import { generateKeyPairSync, randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerTenantRuntimeApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { CredentialBroker } from '../../../server/services/multitenant/credential-broker.js';
import { ContractUsageLedger } from '../../../server/services/multitenant/contract-usage-ledger.js';
import { computeBusinessIdempotencyKey } from '../../../server/services/multitenant/contract-usage-ledger.js';
import { TenantAuthority } from '../../../server/services/multitenant/tenant-authority.js';
import { createTenantRuntimeServices } from '../../../server/services/multitenant/tenant-runtime-services.js';
import { WorkspaceConnectionRegistry } from '../../../server/services/multitenant/workspace-connection-registry.js';

const now = new Date('2026-08-16T13:00:30Z');
const serviceToken = 'runtime-test-token-not-a-production-secret';

function createRuntime({
    credentialBrokerOptions = {},
    migrationAdapter = undefined,
    serviceAuth = undefined
} = {}) {
    const tenantAuthority = new TenantAuthority({ now: () => now });
    const created = tenantAuthority.createTenant({ displayName: 'Tenant A' });
    const tenant = tenantAuthority.transitionTenant(created.tenant_id, '1', 'active');
    const connectionRegistry = new WorkspaceConnectionRegistry({ now: () => now });
    const connection = connectionRegistry.register({
        tenant_id: tenant.tenant_id,
        provider: 'slack',
        installation_id: 'installation-a',
        workspace_id: 'workspace-a',
        app_id: 'app-a',
        granted_scopes: ['task.read'],
        credential_ref: 'credential-ref-a',
        credential_mode: 'customer_oauth'
    });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const credentialBroker = new CredentialBroker({
        now: () => now,
        leaseId: () => 'lease_01ARZ3NDEKTSV4RRFFQ69G5FB1',
        leaseToken: () => 'opaque-test-lease-handle-not-credential-material',
        ...credentialBrokerOptions
    });
    credentialBroker.register(connection);
    const usageLedger = new ContractUsageLedger({ now: () => now });
    usageLedger.registerContract({
        tenant_id: tenant.tenant_id,
        contract_id: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FB0',
        contract_revision: '11',
        quota_revision: '19',
        allowances: { model_tokens: 1000 },
        thresholds_basis_points: [8000],
        overage_policy: 'deny',
        hard_stop_basis_points: 10000,
        quota_window_policy: { kind: 'calendar_month', timezone: 'UTC' },
        rate_card_revision: 1,
        fx_table_revision: 1
    });
    // The route contract carries only requested_quantity.  This in-memory
    // fixture supplies the authoritative prior use explicitly, matching the
    // production repository boundary without allowing it from the caller.
    const decideQuotaWithAuthority = usageLedger.decideQuota.bind(usageLedger);
    usageLedger.decideQuota = (input) => decideQuotaWithAuthority({ ...input, used_quantity: 0 });
    const services = createTenantRuntimeServices({
        serviceToken,
        serviceAuth,
        tenantAuthority,
        connectionRegistry,
        credentialBroker,
        usageLedger,
        migrationAdapter,
        tenantBoundaryGateway: {
            authorize: async ({ tenant_context, entry_point, resource_ref }) => ({
                authorized: true,
                entry_point,
                resource_ref,
                tenant_id: tenant_context.tenant.tenant_id,
                tenant_revision_at_write: tenant_context.tenant.tenant_revision
            })
        },
        resolveContractRevision: async () => '11',
        signingKey: {
            key_id: 'brainbase-test-key-1',
            private_key: privateKey,
            public_key: publicKey,
            status: 'current',
            not_before: '2026-08-16T00:00:00Z',
            expires_at: '2027-08-16T00:00:00Z'
        },
        audience: 'mana-runtime',
        deploymentId: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
        deploymentProfile: 'shared_cloud',
        now: () => now
    });
    return { services, tenant, connection };
}

describe('tenant runtime production wiring', () => {
    it('service bootstrapからsigned producer routeとsingle-use credential leaseへ到達する', async () => {
        const { services, tenant, connection } = createRuntime();
        const app = express();
        app.use(express.json());
        registerTenantRuntimeApiRoute(app, services);

        const operationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
        const correlationId = 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY';
        const contextResponse = await request(app)
            .post('/api/v1/runtime/tenant-context:resolve')
            .set('authorization', `Bearer ${serviceToken}`)
            .send({
                tenant_id: tenant.tenant_id,
                expected_tenant_revision: tenant.tenant_revision,
                connection_id: connection.connection_id,
                expected_connection_revision: connection.connection_revision,
                actor: { principal_id: 'person-a', principal_type: 'person', authenticated_subject_id: 'subject-a' },
                authorization: { organization_ids: ['org-a'], project_ids: ['project-a'], data_scopes: ['task'], capability_ids: ['task.read'] },
                slack: { event_id: 'Ev-A-001', channel_id: 'C-A', thread_ts: '1.0', requester_id: 'person-a' },
                correlation_id: correlationId,
                operation_id: operationId
            });

        expect(contextResponse.status).toBe(200);
        expect(contextResponse.body).toMatchObject({
            protocol_id: 'mana-brainbase-tenant-context',
            tenant: { tenant_id: tenant.tenant_id, tenant_revision: tenant.tenant_revision },
            workspace_connection: { connection_id: connection.connection_id, connection_revision: connection.connection_revision },
            contract_revision: '11',
            integrity: { method: 'jws_detached', algorithm: 'EdDSA', key_id: 'brainbase-test-key-1' }
        });
        expect(contextResponse.body.idempotency_key).toBe(computeBusinessIdempotencyKey({
            protocol_id: 'mana-brainbase-tenant-context',
            protocol_major: '1',
            tenant_id: tenant.tenant_id,
            connection_id: connection.connection_id,
            slack_event_id: 'Ev-A-001',
            operation_id: operationId
        }));

        const leaseResponse = await request(app)
            .post('/api/v1/runtime/credential-leases')
            .set({
                authorization: `Bearer ${serviceToken}`,
                'Brainbase-Protocol-Version': '1.0',
                'Brainbase-Deployment-Id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX'
            })
            .send({
                tenant_context: contextResponse.body,
                message_type: 'credential_lease_request',
                protocol_version: '1.0',
                binding: {
                    tenant_id: tenant.tenant_id,
                    connection_id: connection.connection_id,
                    connection_revision: connection.connection_revision,
                    contract_revision: '11',
                    operation_id: operationId,
                    audience: 'api.openai.com',
                    credential_mode: 'customer_oauth',
                    credential_ref: 'credential-ref-a'
                },
                requested_ttl_seconds: 60
            });

        expect(leaseResponse.status).toBe(201);
        expect(leaseResponse.body).toMatchObject({
            message_type: 'credential_lease_response',
            contract_revision: '11',
            max_uses: 1
        });
        expect(leaseResponse.body).not.toHaveProperty('credential');
        expect(leaseResponse.body).not.toHaveProperty('secret');
    });

    it('P0-1: mana service bindingからtrusted provider-forward routeへ到達し生credentialを返さない', async () => {
        const credentialMaterial = randomBytes(32);
        const materialize = async () => Buffer.from(credentialMaterial);
        const forward = async ({ credential, operation, request: providerRequest }) => {
            expect(Buffer.compare(credential, credentialMaterial)).toBe(0);
            expect(providerRequest).toEqual({
                body: { input: 'hello' },
                idempotency_key: 'slack:request-123:0'
            });
            return {
                status: 202,
                response_encoding: 'json',
                content_type: 'application/json',
                body: { provider_request_id: 'provider-request-a', operation }
            };
        };
        const { services, tenant, connection } = createRuntime({
            credentialBrokerOptions: {
                credentialMaterializer: { materialize },
                providerForwarders: { 'api.openai.com': { provider: 'slack', forward } }
            }
        });
        const app = express();
        app.use(express.json());
        registerTenantRuntimeApiRoute(app, services);
        const operationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
        const headers = {
            authorization: `Bearer ${serviceToken}`,
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX'
        };
        const contextResponse = await request(app)
            .post('/api/v1/runtime/tenant-context:resolve')
            .set('authorization', `Bearer ${serviceToken}`)
            .send({
                tenant_id: tenant.tenant_id,
                expected_tenant_revision: tenant.tenant_revision,
                connection_id: connection.connection_id,
                expected_connection_revision: connection.connection_revision,
                actor: { principal_id: 'person-a', principal_type: 'person', authenticated_subject_id: 'subject-a' },
                authorization: { organization_ids: ['org-a'], project_ids: ['project-a'], data_scopes: ['task'], capability_ids: ['task.read'] },
                slack: { event_id: 'Ev-A-002', channel_id: 'C-A', thread_ts: '1.0', requester_id: 'person-a' },
                correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
                operation_id: operationId
            });
        const tenant_context = contextResponse.body;
        const leaseResponse = await request(app).post('/api/v1/runtime/credential-leases').set(headers).send({
            tenant_context,
            message_type: 'credential_lease_request',
            protocol_version: '1.0',
            binding: {
                tenant_id: tenant.tenant_id,
                connection_id: connection.connection_id,
                connection_revision: connection.connection_revision,
                contract_revision: '11',
                operation_id: operationId,
                audience: 'api.openai.com',
                credential_mode: 'customer_oauth',
                credential_ref: 'credential-ref-a'
            },
            requested_ttl_seconds: 60
        });

        const forwarded = await request(app)
            .post('/api/v1/runtime/provider-requests:forward')
            .set(headers)
            .send({
                tenant_context,
                lease_id: leaseResponse.body.lease_id,
                lease_token: leaseResponse.body.lease_token,
                audience: 'api.openai.com',
                provider_operation: 'responses.create',
                request: {
                    body: { input: 'hello' },
                    idempotency_key: 'slack:request-123:0'
                }
            });
        expect(forwarded.status).toBe(202);
        expect(forwarded.body).toEqual({
            provider: 'slack',
            operation_id: operationId,
            provider_operation: 'responses.create',
            status: 202,
            response_encoding: 'json',
            content_type: 'application/json',
            body: { provider_request_id: 'provider-request-a', operation: 'responses.create' }
        });
        expect(JSON.stringify(forwarded.body)).not.toContain(leaseResponse.body.lease_token);
        expect(JSON.stringify(forwarded.body)).not.toContain(credentialMaterial.toString('base64'));

        const replay = await request(app)
            .post('/api/v1/runtime/provider-requests:forward')
            .set(headers)
            .send({
                tenant_context,
                lease_id: leaseResponse.body.lease_id,
                lease_token: leaseResponse.body.lease_token,
                audience: 'api.openai.com',
                provider_operation: 'responses.create',
                request: {
                    body: { input: 'hello' },
                    idempotency_key: 'slack:request-123:0'
                }
            });
        expect(replay.status).toBe(409);
        expect(replay.body.code).toBe('CREDENTIAL_LEASE_ALREADY_USED');
    });

    it('P0-2/AC-006: signed migration routeをbootstrapされたadapterへ配線しtenantを上書きできない', async () => {
        const migrationAdapter = {
            dryRun: async (input) => ({
                migration_id: 'mig_01ARZ3NDEKTSV4RRFFQ69G5FB4',
                target_tenant_id: input.target_tenant_id,
                source_snapshot: input.source_snapshot,
                mapping_rule_revision: input.mapping_rule_revision,
                mode: 'dry_run',
                counts: { scanned: 1, eligible: 1, ambiguous: 0, unowned: 0 },
                collection_state: 'collected',
                write_count: 0,
                candidates: input.rows.map((row) => ({
                    id: row.id,
                    source_revision: row.revision ?? 1,
                    recommended_tenant_id: row.candidates[0]
                })),
                quarantine: []
            }),
            apply: async (plan) => ({ ...plan, mode: 'apply', write_count: 1, applied_rows: [], quarantine: [] }),
            rollback: async (plan) => ({ ...plan, mode: 'rollback', write_count: 1, quarantine: [] }),
            readback: async ({ tenant_id }) => [{ source_id: 'source-a', tenant_id }]
        };
        const { services, tenant, connection } = createRuntime({ migrationAdapter });
        const app = express();
        app.use(express.json());
        registerTenantRuntimeApiRoute(app, services);
        const headers = {
            authorization: `Bearer ${serviceToken}`,
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX'
        };
        const contextResponse = await request(app)
            .post('/api/v1/runtime/tenant-context:resolve')
            .set('authorization', `Bearer ${serviceToken}`)
            .send({
                tenant_id: tenant.tenant_id,
                expected_tenant_revision: tenant.tenant_revision,
                connection_id: connection.connection_id,
                expected_connection_revision: connection.connection_revision,
                actor: { principal_id: 'person-a', principal_type: 'person', authenticated_subject_id: 'subject-a' },
                authorization: { organization_ids: ['org-a'], project_ids: ['project-a'], data_scopes: ['task'], capability_ids: ['task.read'] },
                slack: { event_id: 'Ev-A-003', channel_id: 'C-A', thread_ts: '1.0', requester_id: 'person-a' },
                correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
                operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ'
            });
        const tenant_context = contextResponse.body;
        const dryRun = await request(app).post('/api/v1/runtime/migrations:dry-run').set(headers).send({
            tenant_context,
            source_snapshot: 'sha256:snapshot-a',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenant.tenant_id] }]
        });
        expect(dryRun.status).toBe(200);
        expect(dryRun.body).toMatchObject({ target_tenant_id: tenant.tenant_id, write_count: 0 });

        const missingApproval = await request(app).post('/api/v1/runtime/migrations:apply').set(headers).send({
            tenant_context,
            plan: dryRun.body
        });
        expect(missingApproval.status).toBe(400);
        expect(missingApproval.body.code).toBe('MIGRATION_APPROVAL_REQUIRED');

        const bodyActor = await request(app).post('/api/v1/runtime/migrations:apply').set(headers).send({
            tenant_context,
            plan: dryRun.body,
            actor: 'caller-controlled-actor',
            approval: {
                approved: true,
                reason: 'route schema test',
                approval_id: 'approval-route-actor'
            }
        });
        expect(bodyActor.status).toBe(400);
        expect(bodyActor.body.code).toBe('SCHEMA_INVALID');

        const applied = await request(app).post('/api/v1/runtime/migrations:apply').set(headers).send({
            tenant_context,
            plan: dryRun.body,
            approval: {
                approved: true,
                reason: 'route apply approval',
                approval_id: 'approval-route-apply'
            }
        });
        expect(applied.status).toBe(200);
        expect(applied.body).toMatchObject({ mode: 'apply', write_count: 1 });

        const restrictedApp = express();
        restrictedApp.use(express.json());
        registerTenantRuntimeApiRoute(restrictedApp, {
            ...services,
            serviceAuth: (req, _res, next) => {
                req.serviceIdentity = {
                    subject: 'restricted-service',
                    capabilities: ['tenant_context:resolve']
                };
                next();
            }
        });
        const missingCapability = await request(restrictedApp)
            .post('/api/v1/runtime/migrations:apply')
            .set(headers)
            .send({
                tenant_context,
                plan: dryRun.body,
                approval: {
                    approved: true,
                    reason: 'capability test',
                    approval_id: 'approval-route-capability'
                }
            });
        expect(missingCapability.status).toBe(403);
        expect(missingCapability.body.code).toBe('SERVICE_CAPABILITY_REQUIRED');

        const rollbackMissingApproval = await request(app).post('/api/v1/runtime/migrations:rollback').set(headers).send({
            tenant_context,
            migration_id: dryRun.body.migration_id
        });
        expect(rollbackMissingApproval.status).toBe(400);
        expect(rollbackMissingApproval.body.code).toBe('MIGRATION_APPROVAL_REQUIRED');

        const crossTenant = await request(app).post('/api/v1/runtime/migrations:dry-run').set(headers).send({
            tenant_context,
            target_tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW',
            source_snapshot: 'sha256:snapshot-a',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenant.tenant_id] }]
        });
        expect(crossTenant.status).toBe(403);
        expect(crossTenant.body.code).toBe('CROSS_TENANT_CANDIDATE');

        const crossTenantCandidate = await request(app).post('/api/v1/runtime/migrations:dry-run').set(headers).send({
            tenant_context,
            source_snapshot: 'sha256:snapshot-a',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: ['ten_01ARZ3NDEKTSV4RRFFQ69G5FAW'] }]
        });
        expect(crossTenantCandidate.status).toBe(403);
        expect(crossTenantCandidate.body).toMatchObject({
            code: 'CROSS_TENANT_CANDIDATE',
            details: {
                audit_event: 'cross_tenant_candidate_denied'
            }
        });
        expect(JSON.stringify(crossTenantCandidate.body)).not.toContain('ten_01ARZ3NDEKTSV4RRFFQ69G5FAW');
        expect(JSON.stringify(crossTenantCandidate.body)).not.toContain(tenant.tenant_id);
    });

    it('service bootstrapからquota・UsageEvent・OperationReceipt・idempotency claimへ到達する', async () => {
        const { services, tenant, connection } = createRuntime();
        const app = express();
        app.use(express.json());
        registerTenantRuntimeApiRoute(app, services);
        const operationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
        const correlationId = 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY';
        const headers = {
            authorization: `Bearer ${serviceToken}`,
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX'
        };
        const contextResponse = await request(app)
            .post('/api/v1/runtime/tenant-context:resolve')
            .set('authorization', `Bearer ${serviceToken}`)
            .send({
                tenant_id: tenant.tenant_id,
                expected_tenant_revision: tenant.tenant_revision,
                connection_id: connection.connection_id,
                expected_connection_revision: connection.connection_revision,
                actor: { principal_id: 'person-a', principal_type: 'person', authenticated_subject_id: 'subject-a' },
                authorization: { organization_ids: ['org-a'], project_ids: ['project-a'], data_scopes: ['task'], capability_ids: ['task.read'] },
                slack: { event_id: 'Ev-A-001', channel_id: 'C-A', thread_ts: '1.0', requester_id: 'person-a' },
                correlation_id: correlationId,
                operation_id: operationId
            });
        expect(contextResponse.status).toBe(200);
        const tenant_context = contextResponse.body;

        const quota = await request(app).post('/api/v1/runtime/quota:decide').set(headers).send({
            tenant_context,
            metric: 'model_tokens',
            requested_quantity: 5
        });
        expect(quota.status).toBe(200);
        expect(quota.body).toMatchObject({ message_type: 'quota_decision', decision: 'allowed' });

        const usage = await request(app).post('/api/v1/runtime/usage-events').set(headers).send({
            tenant_context,
            message_type: 'usage_event',
            usage_event_id: 'usage_01ARZ3NDEKTSV4RRFFQ69G5FB2',
            protocol_version: '1.0',
            kind: 'model_tokens',
            quantity: 15,
            unit: 'tokens',
            collection_state: 'collected',
            outcome: 'succeeded',
            failure_code: null,
            unknown_fields: [],
            observed_at: '2026-08-16T13:00:31Z'
        });
        expect(usage.status).toBe(202);
        expect(usage.body).toMatchObject({ collection_state: 'collected', outcome: 'succeeded' });

        const receipt = await request(app).post('/api/v1/runtime/operation-receipts:finalize').set(headers).send({
            tenant_context,
            message_type: 'operation_receipt',
            receipt_id: 'receipt_01ARZ3NDEKTSV4RRFFQ69G5FB3',
            protocol_version: '1.0',
            operation_ids: [operationId],
            idempotency_keys: [tenant_context.idempotency_key],
            actor_principal_id: 'person-a',
            project_id: null,
            capability_id: 'task.read',
            quota_decision: 'allowed',
            credential_mode: 'customer_oauth',
            collection_state: 'collected',
            outcome: 'succeeded',
            failure_code: null,
            usage_event_ids: [usage.body.usage_event_id],
            reply: { state: 'delivered', reply_count: 1, legacy_reply_count: 0, slack_reply_ts: '2.0' },
            completed_at: '2026-08-16T13:00:32Z'
        });
        expect(receipt.status).toBe(201);
        expect(receipt.body).toMatchObject({ collection_state: 'collected', outcome: 'succeeded' });

        const claim = await request(app).post('/api/v1/runtime/idempotency-claims').set(headers).send({
            tenant_context,
            message_type: 'idempotency_claim',
            owner: 'brainbase',
            scope: 'business_effect',
            slack_event_id: 'Ev-A-001',
            context_hash: `sha256:${'a'.repeat(64)}`,
            payload_hash: `sha256:${'b'.repeat(64)}`,
            state: 'claimed',
            retention_until: '2026-09-16T13:00:30Z'
        });
        expect(claim.status).toBe(201);
    });
});
