import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { generateCanonicalId } from './ids.js';
import { TenantMigrationPlanner } from './migration-planner.js';

function asMigrationError(error) {
    if (error instanceof ContractError) return error;
    return new ContractError('UPSTREAM_UNAVAILABLE', {
        status: 503,
        retryable: true,
        fault_domain: 'brainbase_cloud',
        message: 'PostgreSQL migration adapter is unavailable'
    });
}

function collectionStateFor(quarantine) {
    return quarantine.length === 0 ? 'collected' : 'partial';
}

export class PostgresTenantMigrationAdapter {
    constructor({ pool, now = () => new Date(), planner = new TenantMigrationPlanner() } = {}) {
        if (!pool) throw new Error('Multitenant PostgreSQL pool is required');
        this.pool = pool;
        this.now = now;
        this.planner = planner;
    }

    async #transaction(tenantId, operation) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantId]);
            await client.query("SELECT set_config('brainbase.migration_mode', 'on', true)");
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Preserve the failure that made the transaction unsafe.
            }
            throw asMigrationError(error);
        } finally {
            client.release();
        }
    }

    async dryRun(input) {
        return this.planner.dryRun(input);
    }

    async apply(plan, { fail_on_conflict: failOnConflict = false } = {}) {
        if (plan?.mode !== 'dry_run') throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
        return this.#transaction(plan.target_tenant_id, async (client) => {
            const createdAt = this.now().toISOString();
            await client.query(
                `INSERT INTO tenant_migrations (
                    migration_id, tenant_id, source_snapshot, mapping_rule_revision,
                    mode, counts, collection_state, created_at
                 ) VALUES ($1,$2,$3,$4,'apply',$5::jsonb,$6,$7)`,
                [
                    plan.migration_id, plan.target_tenant_id, plan.source_snapshot,
                    plan.mapping_rule_revision, canonicalJson(plan.counts),
                    collectionStateFor(plan.quarantine), createdAt
                ]
            );

            const appliedRows = [];
            const quarantine = [...plan.quarantine];
            let migrated = 0;
            let unchanged = 0;
            let failed = 0;

            for (const candidate of plan.candidates) {
                const currentResult = await client.query(
                    `SELECT source_id, source_revision, tenant_id, source_payload
                       FROM tenant_migration_source_rows
                      WHERE source_id = $1 AND (tenant_id IS NULL OR tenant_id = $2)
                      FOR UPDATE`,
                    [candidate.id, plan.target_tenant_id]
                );
                const current = currentResult.rows[0];
                if (!current || Number(current.source_revision) !== candidate.source_revision) {
                    failed += 1;
                    if (failOnConflict) {
                        throw new ContractError('MIGRATION_APPLY_CONFLICT', { status: 409 });
                    }
                    quarantine.push({ id: candidate.id, reason: 'apply_conflict' });
                    continue;
                }
                if (current.tenant_id === plan.target_tenant_id) {
                    unchanged += 1;
                    continue;
                }
                const appliedRevision = candidate.source_revision + 1;
                const updated = await client.query(
                    `UPDATE tenant_migration_source_rows AS source
                        SET tenant_id = $2,
                            tenant_revision_at_write = tenant.tenant_revision,
                            source_revision = $3,
                            applied_migration_id = $4,
                            updated_at = $5
                       FROM brainbase_tenants AS tenant
                      WHERE source.source_id = $1
                        AND source.source_revision = $6
                        AND source.tenant_id IS NULL
                        AND tenant.tenant_id = $2
                      RETURNING source.source_id`,
                    [
                        candidate.id, plan.target_tenant_id, appliedRevision,
                        plan.migration_id, createdAt, candidate.source_revision
                    ]
                );
                if (updated.rowCount !== 1) {
                    failed += 1;
                    if (failOnConflict) {
                        throw new ContractError('MIGRATION_APPLY_CONFLICT', { status: 409 });
                    }
                    quarantine.push({ id: candidate.id, reason: 'apply_conflict' });
                    continue;
                }
                migrated += 1;
                appliedRows.push({
                    id: candidate.id,
                    source_revision: candidate.source_revision,
                    applied_revision: appliedRevision
                });
            }

            for (const item of quarantine) {
                await client.query(
                    `INSERT INTO tenant_migration_quarantine (
                        migration_id, tenant_id, source_id, reason, source_snapshot, quarantined_at
                     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
                     ON CONFLICT (migration_id, source_id) DO NOTHING`,
                    [
                        plan.migration_id, plan.target_tenant_id, item.id, item.reason,
                        canonicalJson({ source_id: item.id }), createdAt
                    ]
                );
            }

            if (plan.counts.eligible !== migrated + unchanged + failed) {
                throw new ContractError('MIGRATION_COUNT_MISMATCH', { status: 409 });
            }
            const counts = { ...plan.counts, migrated, unchanged, failed };
            const collectionState = collectionStateFor(quarantine);
            await client.query(
                `UPDATE tenant_migrations
                    SET counts = $3::jsonb, collection_state = $4
                  WHERE tenant_id = $1 AND migration_id = $2`,
                [plan.target_tenant_id, plan.migration_id, canonicalJson(counts), collectionState]
            );
            return deepFreeze({
                ...plan,
                mode: 'apply',
                counts,
                collection_state: collectionState,
                write_count: migrated,
                applied_rows: appliedRows,
                quarantine
            });
        });
    }

    async rollback(plan) {
        if (plan?.mode !== 'apply') throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
        return this.#transaction(plan.target_tenant_id, async (client) => {
            const rollbackId = generateCanonicalId('mig');
            const createdAt = this.now().toISOString();
            await client.query(
                `INSERT INTO tenant_migrations (
                    migration_id, tenant_id, source_snapshot, mapping_rule_revision,
                    mode, counts, collection_state, created_at
                 ) VALUES ($1,$2,$3,$4,'rollback',$5::jsonb,'collected',$6)`,
                [
                    rollbackId, plan.target_tenant_id, plan.source_snapshot,
                    plan.mapping_rule_revision, canonicalJson(plan.counts), createdAt
                ]
            );
            const quarantine = [];
            let writeCount = 0;
            for (const applied of plan.applied_rows) {
                const result = await client.query(
                    `UPDATE tenant_migration_source_rows
                        SET tenant_id = NULL,
                            tenant_revision_at_write = NULL,
                            source_revision = $4,
                            applied_migration_id = NULL,
                            updated_at = $5
                      WHERE source_id = $1
                        AND tenant_id = $2
                        AND applied_migration_id = $3
                        AND source_revision = $6
                      RETURNING source_id`,
                    [
                        applied.id, plan.target_tenant_id, plan.migration_id,
                        applied.source_revision, createdAt, applied.applied_revision
                    ]
                );
                if (result.rowCount === 1) {
                    writeCount += 1;
                } else {
                    quarantine.push({ id: applied.id, reason: 'rollback_conflict' });
                }
            }
            for (const item of quarantine) {
                await client.query(
                    `INSERT INTO tenant_migration_quarantine (
                        migration_id, tenant_id, source_id, reason, source_snapshot, quarantined_at
                     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
                    [
                        rollbackId, plan.target_tenant_id, item.id, item.reason,
                        canonicalJson({ source_id: item.id }), createdAt
                    ]
                );
            }
            const collectionState = collectionStateFor(quarantine);
            await client.query(
                `UPDATE tenant_migrations
                    SET counts = $3::jsonb, collection_state = $4
                  WHERE tenant_id = $1 AND migration_id = $2`,
                [
                    plan.target_tenant_id, rollbackId,
                    canonicalJson({ ...plan.counts, rolled_back: writeCount, failed: quarantine.length }),
                    collectionState
                ]
            );
            return deepFreeze({
                ...plan,
                migration_id: rollbackId,
                rollback_of_migration_id: plan.migration_id,
                mode: 'rollback',
                collection_state: collectionState,
                write_count: writeCount,
                quarantine
            });
        });
    }

    async readback({ tenant_id: tenantId, migration_id: migrationId }) {
        return this.#transaction(tenantId, async (client) => {
            const result = await client.query(
                `SELECT source_id, source_revision, tenant_id, tenant_revision_at_write,
                        applied_migration_id
                   FROM tenant_migration_source_rows
                  WHERE tenant_id = $1 AND applied_migration_id = $2
                  ORDER BY source_id`,
                [tenantId, migrationId]
            );
            return result.rows.map((row) => ({
                ...row,
                source_revision: Number(row.source_revision),
                tenant_revision_at_write: String(row.tenant_revision_at_write)
            }));
        });
    }
}
