import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CredentialBroker } from '../../../../server/services/multitenant/credential-broker.js';
import { MigrationPlanAttestor } from '../../../../server/services/multitenant/migration-plan-attestor.js';
import { PostgresTenantMigrationAdapter } from '../../../../server/services/multitenant/postgres-migration-adapter.js';
import { MultitenantPostgresRepository } from '../../../../server/services/multitenant/postgres-repository.js';
import { createTrustedHttpProviderForwarder } from '../../../../server/services/multitenant/trusted-provider-forwarder.js';
import { PgSnsPostingLedgerRepository } from '../../../../server/services/sns/posting-ledger-repository.js';
import { SnsLedgerPublishService } from '../../../../server/services/sns/sns-ledger-publish-service.js';
import { SnsScheduledPublisher } from '../../../../server/services/sns/sns-scheduled-publisher.js';
import { runScheduledPosts } from '../../../../scripts/run-sns-scheduled-posts.js';

const { Pool } = pg;
const tenantA = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantB = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const connectionA = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const credentialRefA = 'credential-ref-a';
const operationA = 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const audienceA = 'provider.internal.test';

describe.sequential('AC-006 PostgreSQL migration adapter', () => {
    let container;
    let pool;
    let adapter;
    let attestor;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        const schema = await readFile(resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql'), 'utf8');
        await pool.query(schema);
        await pool.query(`INSERT INTO brainbase_tenants (tenant_id, tenant_revision, status, display_name, created_at, updated_at)
            VALUES ($1, 3, 'active', 'A', now(), now()), ($2, 2, 'active', 'B', now(), now())`, [tenantA, tenantB]);
        await pool.query(`INSERT INTO workspace_connections (
                connection_id, connection_revision, tenant_id, tenant_revision_at_write,
                provider, installation_id, workspace_id, app_id, granted_scopes,
                status, credential_ref, installed_at
            ) VALUES ($1, 7, $2, 3, 'openai', 'installation-a', 'workspace-a',
                      'app-a', ARRAY['responses.create'], 'active', $3, now())`,
        [connectionA, tenantA, credentialRefA]);
        await pool.query(`INSERT INTO workspace_connection_revisions (
                tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
            ) VALUES ($1, $2, 7, $3::jsonb, now())`, [
            tenantA,
            connectionA,
            JSON.stringify({
                provider: 'openai',
                installation_id: 'installation-a',
                workspace_id: 'workspace-a',
                app_id: 'app-a',
                granted_scopes: ['responses.create'],
                status: 'active',
                credential_ref: credentialRefA
            })
        ]);
        await pool.query(`INSERT INTO credential_broker_refs (
                credential_ref, tenant_id, connection_id, connection_revision,
                credential_mode, refresh_revision, created_at, updated_at
            ) VALUES ($1, $2, $3, 7, 'customer_oauth', 1, now(), now())`,
        [credentialRefA, tenantA, connectionA]);
        await pool.query(`INSERT INTO tenant_migration_source_rows (source_id, source_revision, source_payload)
            VALUES ('source-a', 1, '{"name":"A"}'), ('source-b', 1, '{"name":"B"}')`);
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        attestor = new MigrationPlanAttestor({
            key_id: 'migration-test-key',
            private_key: privateKey,
            public_key: publicKey
        });
        adapter = new PostgresTenantMigrationAdapter({
            pool,
            now: () => new Date('2026-08-17T00:00:00Z'),
            attestor
        });
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('dry-runはwrite_count=0でDBを変更しない', async () => {
        const plan = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-a',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenantA] }]
        });
        expect(plan).toMatchObject({ mode: 'dry_run', write_count: 0 });
        const result = await pool.query('SELECT tenant_id FROM tenant_migration_source_rows WHERE source_id = $1', ['source-a']);
        expect(result.rows[0].tenant_id).toBeNull();
    });

    it('cross-tenant signed candidateはapply adapter境界でDB変更前にdeny_and_auditする', async () => {
        const plan = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-cross-tenant',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenantA] }]
        });
        const mismatched = structuredClone(plan);
        mismatched.candidates[0].recommended_tenant_id = tenantB;

        await expect(adapter.apply(mismatched, {
            actor: 'svc_mana_runtime',
            approval: {
                approved: true,
                reason: 'cross-tenant candidate must be denied',
                approval_id: 'approval-cross-tenant-candidate'
            }
        })).rejects.toMatchObject({
            code: 'CROSS_TENANT_CANDIDATE',
            status: 403,
            details: expect.objectContaining({
                required_action: 'none',
                audit_event: 'cross_tenant_candidate_denied'
            })
        });
        expect((await pool.query(
            'SELECT COUNT(*)::int AS count FROM tenant_migrations WHERE plan_digest = $1',
            [plan.attestation.digest]
        )).rows[0].count).toBe(0);
        expect((await pool.query(
            'SELECT tenant_id FROM tenant_migration_source_rows WHERE source_id = $1',
            ['source-a']
        )).rows[0].tenant_id).toBeNull();
    });

    it('legacy tenant_migrations audit columns欠損時はapplyをroute限定停止する', async () => {
        const plan = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-ledger-readiness',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenantA] }]
        });
        await pool.query('ALTER TABLE tenant_migrations DROP COLUMN plan_digest');
        try {
            await expect(adapter.apply(plan, {
                actor: 'svc_mana_runtime',
                approval: {
                    approved: true,
                    reason: 'ledger readiness must be verified',
                    approval_id: 'approval-ledger-readiness'
                }
            })).rejects.toMatchObject({
                code: 'MIGRATION_LEDGER_NOT_READY',
                status: 503,
                details: { required_action: 'migrate_tenant_migrations_ledger' }
            });
            expect((await pool.query(
                'SELECT tenant_id FROM tenant_migration_source_rows WHERE source_id = $1',
                ['source-a']
            )).rows[0].tenant_id).toBeNull();
        } finally {
            await pool.query(`ALTER TABLE tenant_migrations
                ADD COLUMN plan_digest TEXT NOT NULL,
                ADD CONSTRAINT tenant_migrations_plan_digest_check
                    CHECK (plan_digest ~ '^sha256:[a-f0-9]{64}$')`);
        }
    });

    it('apply・tenant isolation readback・rollbackを各transactionで完結させる', async () => {
        const dryRun = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-a',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenantA] }]
        });
        const applied = await adapter.apply(dryRun, {
            actor: 'svc_mana_runtime',
            approval: {
                approved: true,
                reason: 'integration migration approval',
                approval_id: 'approval-apply-source-a'
            }
        });
        expect(applied).toMatchObject({ mode: 'apply', write_count: 1 });
        const applyLedger = await pool.query(
            `SELECT plan_digest, plan_payload, approved_by, approval_id,
                    approval_reason, approved_at, rollback_of_migration_id
               FROM tenant_migrations
              WHERE tenant_id = $1 AND migration_id = $2 AND mode = 'apply'`,
            [tenantA, applied.migration_id]
        );
        expect(applyLedger.rows[0]).toMatchObject({
            plan_digest: applied.attestation.digest,
            approved_by: 'svc_mana_runtime',
            approval_id: 'approval-apply-source-a',
            approval_reason: 'integration migration approval',
            rollback_of_migration_id: null
        });
        expect(applyLedger.rows[0].plan_payload).toMatchObject({
            migration_id: applied.migration_id,
            mode: 'apply',
            applied_rows: [{ id: 'source-a', source_revision: 1, applied_revision: 2 }]
        });
        expect(await adapter.readback({ tenant_id: tenantA, migration_id: applied.migration_id }))
            .toMatchObject([{ source_id: 'source-a', tenant_id: tenantA }]);
        expect(await adapter.readback({ tenant_id: tenantB, migration_id: applied.migration_id })).toEqual([]);

        await expect(adapter.rollback({
            migration_id: applied.migration_id,
            target_tenant_id: tenantA,
            applied_rows: [{ id: 'caller-controlled-row', source_revision: 1, applied_revision: 2 }]
        }, {
            actor: 'svc_mana_runtime',
            approval: {
                approved: true,
                reason: 'caller rows must be rejected',
                approval_id: 'approval-rollback-rejected-input'
            }
        })).rejects.toMatchObject({ code: 'MIGRATION_PLAN_INVALID' });

        await pool.query('ALTER TABLE tenant_migrations DROP COLUMN approved_at');
        try {
            await expect(adapter.rollback({
                migration_id: applied.migration_id,
                target_tenant_id: tenantA
            }, {
                actor: 'svc_mana_runtime',
                approval: {
                    approved: true,
                    reason: 'rollback readiness must be verified',
                    approval_id: 'approval-rollback-readiness'
                }
            })).rejects.toMatchObject({
                code: 'MIGRATION_LEDGER_NOT_READY',
                status: 503,
                details: { required_action: 'migrate_tenant_migrations_ledger' }
            });
            expect(await adapter.readback({ tenant_id: tenantA, migration_id: applied.migration_id }))
                .toMatchObject([{ source_id: 'source-a', tenant_id: tenantA }]);
        } finally {
            await pool.query('ALTER TABLE tenant_migrations ADD COLUMN approved_at TIMESTAMPTZ');
            await pool.query('UPDATE tenant_migrations SET approved_at = created_at WHERE approved_at IS NULL');
            await pool.query('ALTER TABLE tenant_migrations ALTER COLUMN approved_at SET NOT NULL');
        }

        const rolledBack = await adapter.rollback({
            migration_id: applied.migration_id,
            target_tenant_id: tenantA
        }, {
            actor: 'svc_mana_runtime',
            approval: {
                approved: true,
                reason: 'integration rollback approval',
                approval_id: 'approval-rollback-source-a'
            }
        });
        expect(rolledBack).toMatchObject({ mode: 'rollback', write_count: 1 });
        expect(rolledBack).not.toHaveProperty('attestation');
        const rollbackLedger = await pool.query(
            `SELECT plan_digest, plan_payload, approved_by, approval_id,
                    approval_reason, approved_at, rollback_of_migration_id
               FROM tenant_migrations
              WHERE tenant_id = $1 AND migration_id = $2 AND mode = 'rollback'`,
            [tenantA, rolledBack.migration_id]
        );
        expect(rollbackLedger.rows[0]).toMatchObject({
            plan_digest: applied.attestation.digest,
            approved_by: 'svc_mana_runtime',
            approval_id: 'approval-rollback-source-a',
            approval_reason: 'integration rollback approval',
            rollback_of_migration_id: applied.migration_id
        });
        expect(await adapter.readback({ tenant_id: tenantA, migration_id: applied.migration_id })).toEqual([]);
    });

    it('apply途中のDB失敗は全変更をrollbackする', async () => {
        const plan = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-failure',
            mapping_rule_revision: 1,
            rows: [
                { id: 'source-a', revision: 1, candidates: [tenantA] },
                { id: 'missing', revision: 1, candidates: [tenantA] }
            ]
        });
        await expect(adapter.apply(plan, {
            fail_on_conflict: true,
            actor: 'svc_mana_runtime',
            approval: {
                approved: true,
                reason: 'integration conflict approval',
                approval_id: 'approval-apply-conflict'
            }
        })).rejects.toMatchObject({ code: 'MIGRATION_APPLY_CONFLICT' });
        const result = await pool.query('SELECT tenant_id FROM tenant_migration_source_rows WHERE source_id = $1', ['source-a']);
        expect(result.rows[0].tenant_id).toBeNull();
    });

    it('P0-1: opaque leaseをDBでglobal single-use消費しcredentialをtrusted providerへだけ送る', async () => {
        const providerCredential = randomBytes(32).toString('base64url');
        const leaseToken = randomBytes(32).toString('base64url');
        let observedAuthorization;
        let observedBody = '';
        const provider = createServer((request, response) => {
            observedAuthorization = request.headers.authorization;
            request.setEncoding('utf8');
            request.on('data', (chunk) => { observedBody += chunk; });
            request.on('end', () => {
                response.writeHead(202, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ provider_request_id: 'provider-request-a' }));
            });
        });
        await new Promise((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
        const address = provider.address();
        if (!address || typeof address === 'string') throw new Error('provider test server did not bind');

        let brokerNow = new Date('2026-08-18T00:00:00Z');
        const repository = new MultitenantPostgresRepository({ pool, now: () => brokerNow });
        const broker = new CredentialBroker({
            repository,
            now: () => brokerNow,
            leaseId: () => 'lease_01ARZ3NDEKTSV4RRFFQ69G5FB1',
            leaseToken: () => leaseToken,
            credentialMaterializer: async (credentialRef) => (
                credentialRef === credentialRefA ? Buffer.from(providerCredential, 'utf8') : undefined
            ),
            providerForwarders: {
                [audienceA]: createTrustedHttpProviderForwarder({
                    provider: 'openai',
                    baseUrl: `http://127.0.0.1:${address.port}`,
                    operations: {
                        'responses.create': {
                            method: 'POST',
                            path: '/v1/responses',
                            body_encoding: 'json',
                            response_encoding: 'json',
                            credential_placement: 'bearer'
                        }
                    },
                    allowInsecureLocalhost: true
                })
            }
        });
        broker.register({
            tenant_id: tenantA,
            connection_id: connectionA,
            connection_revision: '7',
            credential_ref: credentialRefA,
            credential_mode: 'customer_oauth',
            provider: 'openai',
            refresh_revision: '1'
        });
        const request = {
            message_type: 'credential_lease_request',
            protocol_version: '1.0',
            binding: {
                tenant_id: tenantA,
                connection_id: connectionA,
                connection_revision: '7',
                contract_revision: '11',
                operation_id: operationA,
                audience: audienceA,
                credential_mode: 'customer_oauth',
                credential_ref: credentialRefA
            },
            requested_ttl_seconds: 60
        };

        try {
            const lease = await broker.issueLease(request);
            brokerNow = new Date('2026-08-18T00:00:30Z');
            const forwarded = await broker.forwardProviderRequest({
                ...request.binding,
                lease_id: lease.lease_id,
                lease_token: lease.lease_token,
                provider_operation: 'responses.create',
                request: { body: { input: 'hello' } }
            });
            expect(forwarded).toEqual({
                provider: 'openai',
                operation_id: operationA,
                provider_operation: 'responses.create',
                status: 202,
                response_encoding: 'json',
                content_type: 'application/json',
                body: { provider_request_id: 'provider-request-a' }
            });
            expect(observedAuthorization).toBe(`Bearer ${providerCredential}`);
            expect(observedBody).not.toContain(providerCredential);
            expect(observedBody).not.toContain(leaseToken);
            expect(JSON.stringify(forwarded)).not.toContain(providerCredential);
            expect(JSON.stringify(forwarded)).not.toContain(leaseToken);

            await expect(broker.forwardProviderRequest({
                ...request.binding,
                lease_id: lease.lease_id,
                lease_token: lease.lease_token,
                provider_operation: 'responses.create',
                request: { body: { input: 'replay' } }
            })).rejects.toMatchObject({ code: 'CREDENTIAL_LEASE_ALREADY_USED' });

            const stored = await pool.query(
                `SELECT lease_token_digest, consumed_at, max_uses,
                        EXTRACT(EPOCH FROM (expires_at - issued_at)) AS ttl_seconds
                   FROM tenant_credential_leases
                  WHERE tenant_id = $1 AND lease_id = $2`,
                [tenantA, lease.lease_id]
            );
            expect(stored.rows[0]).toMatchObject({
                lease_token_digest: `sha256:${createHash('sha256').update(leaseToken).digest('hex')}`,
                max_uses: 1
            });
            expect(stored.rows[0].consumed_at).not.toBeNull();
            expect(Number(stored.rows[0].ttl_seconds)).toBeLessThanOrEqual(60);
            expect(JSON.stringify(stored.rows[0])).not.toContain(leaseToken);
            expect(observedBody).toBe(JSON.stringify({ input: 'hello' }));
        } finally {
            await new Promise((resolveClose, rejectClose) => provider.close((error) => (
                error ? rejectClose(error) : resolveClose()
            )));
        }
    });

    it('AC-005/AC-006: production roleのRLSは別tenantからconnectionとleaseをreadbackできない', async () => {
        await pool.query('CREATE ROLE brainbase_multitenant_test_app NOLOGIN');
        await pool.query('GRANT USAGE ON SCHEMA public TO brainbase_multitenant_test_app');
        await pool.query('GRANT SELECT ON workspace_connections, tenant_credential_leases TO brainbase_multitenant_test_app');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE brainbase_multitenant_test_app');
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantB]);
            const connections = await client.query(
                'SELECT connection_id FROM workspace_connections WHERE connection_id = $1',
                [connectionA]
            );
            const leases = await client.query(
                'SELECT lease_id FROM tenant_credential_leases WHERE tenant_id = $1',
                [tenantA]
            );
            expect(connections.rows).toEqual([]);
            expect(leases.rows).toEqual([]);
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });

    it('AC-205: canonical Receiptとprice/rate/FX revisionを同一transactionで保存しtenant限定readbackする', async () => {
        const repository = new MultitenantPostgresRepository({ pool });
        const receipt = {
            message_type: 'operation_receipt',
            receipt_id: 'receipt_01ARZ3NDEKTSV4RRFFQ69G5FB6',
            protocol_version: '1.0',
            tenant_id: tenantA,
            connection_id: connectionA,
            connection_revision: '7',
            contract_revision: '11',
            deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
            operation_ids: [operationA],
            idempotency_keys: ['ik1_SMJlU0vl95PXZjE3Cs0smROt0-VqWWO1D83Nl7IkSTE'],
            actor_principal_id: 'person-a',
            project_id: 'project-a',
            capability_id: 'task.read',
            quota_decision: 'allowed',
            credential_mode: 'customer_oauth',
            collection_state: 'partial',
            outcome: 'failed',
            failure_code: 'UPSTREAM_PARTIAL',
            usage_event_ids: [],
            reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 },
            completed_at: '2026-08-18T00:01:35Z'
        };
        const pricingSnapshot = {
            rate_card_revision: '8',
            fx_table_revision: '5',
            sales_price_revision: '3',
            purchase_currency: 'USD',
            purchase_minor_units: 125,
            billing_currency: 'JPY',
            billing_minor_units: 18_769,
            fx_rate_decimal: '150.152',
            effective_at: receipt.completed_at
        };

        await expect(repository.finalizeReceiptWithPricing({
            receipt,
            pricing_snapshot: pricingSnapshot
        })).resolves.toEqual({ receipt, pricing_snapshot: pricingSnapshot });
        await expect(repository.readReceiptHistory({
            tenant_id: tenantA,
            receipt_id: receipt.receipt_id
        })).resolves.toEqual([{ receipt, pricing_snapshot: pricingSnapshot }]);
        await expect(repository.readReceiptHistory({
            tenant_id: tenantB,
            receipt_id: receipt.receipt_id
        })).resolves.toEqual([]);

        const persisted = await pool.query(
            `SELECT rate_card_revision, fx_table_revision, sales_price_revision
               FROM tenant_receipt_pricing_snapshots
              WHERE tenant_id = $1 AND receipt_id = $2`,
            [tenantA, receipt.receipt_id]
        );
        expect(persisted.rows[0]).toEqual({
            rate_card_revision: '8',
            fx_table_revision: '5',
            sales_price_revision: '3'
        });
    });

    it('AC-005: review-packのtenant bindingを実PostgreSQLから認可してclaim後にだけpublishする', async () => {
        const schema = await readFile(resolve(process.cwd(), 'server/sql/sns-posting-ledger-schema.sql'), 'utf8');
        await pool.query(schema);
        const repository = new PgSnsPostingLedgerRepository({ pool });
        const tenantBoundary = {
            tenant_context: {
                tenant: {
                    tenant_id: tenantA,
                    tenant_revision: '3'
                }
            },
            resource_ref: {
                object_type: 'project',
                resource_id: 'project_sns'
            }
        };
        const imported = await repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            drafts: [{
                id: 'week_2026-08-18_1_tenant_boundary',
                date: '2026-08-18',
                slot_index: 1,
                time: '09:00',
                body: 'tenant boundary integration proof',
                tenant_boundary: tenantBoundary
            }]
        });
        const postId = imported.created[0].id;
        await repository.updatePost(postId, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
        await repository.updatePost(postId, {
            status: 'scheduled',
            scheduled_at: '2026-08-18T00:00:00.000Z'
        }, { actor_person_id: 'sato_keigo' });

        const authorizationCalls = [];
        const publishCalls = [];
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            tenantBoundaryAuthorizer: async (binding) => {
                authorizationCalls.push(binding);
                return { authorized: true, entry_point: 'background_job' };
            },
            publishService: {
                async publishPost(id) {
                    publishCalls.push(id);
                    const post = await repository.updatePost(id, {
                        status: 'posted',
                        posted_at: '2026-08-18T00:01:00.000Z',
                        posted_url: `https://x.example.test/status/${id}`
                    }, { actor_person_id: 'sns_scheduler' });
                    return { post };
                }
            },
            now: () => new Date('2026-08-18T00:01:00.000Z')
        });

        await expect(publisher.run({ auto_publish_enabled: true })).resolves.toMatchObject({
            scanned: 1,
            due: 1,
            posted: 1,
            failed: 0
        });
        expect(authorizationCalls).toEqual([tenantBoundary]);
        expect(publishCalls).toEqual([postId]);
        await expect(repository.findById(postId)).resolves.toMatchObject({
            status: 'posted',
            evidence: { tenant_boundary: tenantBoundary }
        });
    });

    it('AC-005: production scheduler entrypointが実PostgreSQL接続・background_job認可・claim後にproviderを呼ぶ', async () => {
        const schema = await readFile(resolve(process.cwd(), 'server/sql/sns-posting-ledger-schema.sql'), 'utf8');
        await pool.query(schema);
        const repository = new PgSnsPostingLedgerRepository({ pool });
        const tenantBoundary = {
            tenant_context: {
                tenant: {
                    tenant_id: tenantA,
                    tenant_revision: '3'
                }
            },
            resource_ref: {
                object_type: 'project',
                resource_id: 'project_sns'
            }
        };
        const imported = await repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            drafts: [{
                id: 'week_2026-08-18_2_scheduler_entrypoint',
                date: '2026-08-18',
                slot_index: 2,
                time: '10:00',
                body: 'production scheduler entrypoint proof',
                tenant_boundary: tenantBoundary
            }]
        });
        const postId = imported.created[0].id;
        await repository.updatePost(postId, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
        await repository.updatePost(postId, {
            status: 'scheduled',
            scheduled_at: '2026-08-18T00:00:00.000Z'
        }, { actor_person_id: 'sato_keigo' });

        const authorize = vi.fn(async () => ({ authorized: true, entry_point: 'background_job' }));
        const createServices = vi.fn(() => ({ tenantBoundaryGateway: { authorize } }));
        const providerExecutor = vi.fn(async () => ({
            id: 'provider-entrypoint-proof',
            url: 'https://x.example.test/status/provider-entrypoint-proof'
        }));
        const createPostExecutor = vi.fn(() => providerExecutor);
        const output = { log: vi.fn() };

        await expect(runScheduledPosts({
            argv: ['--now', '2026-08-18T00:01:00.000Z', '--json'],
            env: {
                SNS_POSTING_LEDGER_DATABASE_URL: container.getConnectionUri(),
                SNS_AUTO_PUBLISH_ENABLED: 'true',
                BRAINBASE_TENANT_RUNTIME_ENABLED: '1'
            },
            createServices,
            createPostExecutor,
            output
        })).resolves.toMatchObject({
            due: 1,
            posted: 1,
            failed: 0
        });

        expect(createServices).toHaveBeenCalledOnce();
        expect(authorize).toHaveBeenCalledWith({
            tenant_context: tenantBoundary.tenant_context,
            entry_point: 'background_job',
            resource_ref: tenantBoundary.resource_ref
        });
        expect(providerExecutor).toHaveBeenCalledOnce();
        await expect(repository.findById(postId)).resolves.toMatchObject({
            status: 'posted',
            posted_url: 'https://x.example.test/status/provider-entrypoint-proof'
        });
    });

    it('AC-005: 実PostgreSQL claim競合は2 runnerの片方だけがproviderを呼ぶ', async () => {
        const schema = await readFile(resolve(process.cwd(), 'server/sql/sns-posting-ledger-schema.sql'), 'utf8');
        await pool.query(schema);
        const repository = new PgSnsPostingLedgerRepository({ pool });
        const tenantBoundary = {
            tenant_context: {
                tenant: {
                    tenant_id: tenantA,
                    tenant_revision: '3'
                }
            },
            resource_ref: {
                object_type: 'project',
                resource_id: 'project_sns'
            }
        };
        const imported = await repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            drafts: [{
                id: 'week_2026-08-18_3_claim_conflict',
                date: '2026-08-18',
                slot_index: 3,
                time: '11:00',
                body: 'postgres claim conflict proof',
                tenant_boundary: tenantBoundary
            }]
        });
        const postId = imported.created[0].id;
        await repository.updatePost(postId, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
        await repository.updatePost(postId, {
            status: 'scheduled',
            scheduled_at: '2026-08-18T00:00:00.000Z'
        }, { actor_person_id: 'sato_keigo' });

        let listedRunners = 0;
        let releaseLists;
        const bothListed = new Promise((resolveBoth) => { releaseLists = resolveBoth; });
        const repositoryForRunner = () => ({
            async listPosts(filters) {
                const posts = await repository.listPosts(filters);
                listedRunners += 1;
                if (listedRunners === 2) releaseLists();
                await bothListed;
                return posts;
            },
            claimScheduledPost: (...args) => repository.claimScheduledPost(...args),
            findById: (...args) => repository.findById(...args),
            updatePost: (...args) => repository.updatePost(...args)
        });
        const providerExecutor = vi.fn(async () => ({
            id: 'provider-claim-winner',
            url: 'https://x.example.test/status/provider-claim-winner'
        }));
        const publishService = new SnsLedgerPublishService({
            ledgerRepository: repository,
            postExecutor: providerExecutor,
            now: () => new Date('2026-08-18T00:01:00.000Z')
        });
        const createPublisher = () => new SnsScheduledPublisher({
            ledgerRepository: repositoryForRunner(),
            tenantBoundaryAuthorizer: async () => ({ authorized: true }),
            publishService,
            now: () => new Date('2026-08-18T00:01:00.000Z')
        });

        const results = await Promise.all([
            createPublisher().run({ auto_publish_enabled: true }),
            createPublisher().run({ auto_publish_enabled: true })
        ]);

        expect(results.reduce((sum, result) => sum + result.posted, 0)).toBe(1);
        expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(1);
        expect(results.flatMap((result) => result.skipped_posts)).toEqual([
            { post_id: postId, reason: 'claim_lost' }
        ]);
        expect(providerExecutor).toHaveBeenCalledOnce();
        await expect(repository.findById(postId)).resolves.toMatchObject({
            status: 'posted',
            posted_url: 'https://x.example.test/status/provider-claim-winner'
        });
    });
});
