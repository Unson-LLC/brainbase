import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { generateCanonicalId } from './ids.js';
import {
    assertMigrationCandidateTargets,
    assertMigrationRowCandidates,
    TenantMigrationPlanner
} from './migration-planner.js';

const REQUIRED_MIGRATION_LEDGER_COLUMNS = Object.freeze([
    'plan_digest',
    'plan_payload',
    'approved_by',
    'approval_id',
    'approval_reason',
    'approved_at'
]);

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

function assertApproval(actor, approval) {
    if (typeof actor !== 'string' || actor.trim().length === 0) {
        throw new ContractError('MIGRATION_ACTOR_REQUIRED', { status: 400 });
    }
    if (!approval || typeof approval !== 'object' || Array.isArray(approval)
        || approval.approved !== true
        || typeof approval.reason !== 'string' || approval.reason.trim().length === 0
        || typeof approval.approval_id !== 'string' || approval.approval_id.trim().length === 0) {
        throw new ContractError('MIGRATION_APPROVAL_REQUIRED', { status: 400 });
    }
    if (Object.keys(approval).some((field) => !['approved', 'reason', 'approval_id'].includes(field))) {
        throw new ContractError('MIGRATION_APPROVAL_INVALID', { status: 400 });
    }
    return {
        actor: actor.trim(),
        reason: approval.reason.trim(),
        approval_id: approval.approval_id.trim()
    };
}

function assertMigrationId(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
    }
    return value;
}

function migrationLedgerNotReady() {
    throw new ContractError('MIGRATION_LEDGER_NOT_READY', {
        status: 503,
        fault_domain: 'brainbase_cloud',
        details: { required_action: 'migrate_tenant_migrations_ledger' }
    });
}

async function assertMigrationLedgerReady(client) {
    const columns = await client.query(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'tenant_migrations'
            AND column_name = ANY($1::text[])`,
        [REQUIRED_MIGRATION_LEDGER_COLUMNS]
    );
    const present = new Map(columns.rows.map((row) => [row.column_name, row.is_nullable]));
    if (REQUIRED_MIGRATION_LEDGER_COLUMNS.some((column) => present.get(column) !== 'NO')) {
        migrationLedgerNotReady();
    }
    const legacyRows = await client.query(
        `SELECT 1
           FROM tenant_migrations
          WHERE plan_digest IS NULL
             OR plan_payload IS NULL
             OR approved_by IS NULL
             OR approval_id IS NULL
             OR approval_reason IS NULL
             OR approved_at IS NULL
          LIMIT 1`
    );
    if (legacyRows.rowCount > 0) migrationLedgerNotReady();
}

export class PostgresTenantMigrationAdapter {
    constructor({ pool, now = () => new Date(), planner = new TenantMigrationPlanner(), attestor } = {}) {
        if (!pool) throw new Error('Multitenant PostgreSQL pool is required');
        if (!attestor || typeof attestor.attest !== 'function' || typeof attestor.verify !== 'function') {
            throw new Error('Migration plan attestor is required');
        }
        this.pool = pool;
        this.now = now;
        this.planner = planner;
        this.attestor = attestor;
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
        assertMigrationRowCandidates(input?.target_tenant_id, input?.rows);
        const plan = this.planner.dryRun(input);
        assertMigrationCandidateTargets(plan.target_tenant_id, plan.candidates);
        return this.attestor.attest(plan);
    }

    async apply(plan, {
        fail_on_conflict: failOnConflict = false,
        actor,
        approval
    } = {}) {
        if (plan?.mode !== 'dry_run') throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
        assertMigrationCandidateTargets(plan.target_tenant_id, plan.candidates);
        this.attestor.verify(plan);
        const audit = assertApproval(actor, approval);
        return this.#transaction(plan.target_tenant_id, async (client) => {
            await assertMigrationLedgerReady(client);
            const createdAt = this.now().toISOString();
            await client.query(
                `INSERT INTO tenant_migrations (
                    migration_id, tenant_id, source_snapshot, mapping_rule_revision,
                    mode, counts, collection_state, plan_digest, plan_payload,
                    approved_by, approval_id, approval_reason, approved_at, created_at
                 ) VALUES ($1,$2,$3,$4,'apply',$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
                [
                    plan.migration_id, plan.target_tenant_id, plan.source_snapshot,
                    plan.mapping_rule_revision, canonicalJson(plan.counts),
                    collectionStateFor(plan.quarantine), plan.attestation.digest,
                    canonicalJson({}), audit.actor, audit.approval_id, audit.reason,
                    createdAt, createdAt
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
            const result = deepFreeze({
                ...plan,
                mode: 'apply',
                counts,
                collection_state: collectionState,
                write_count: migrated,
                applied_rows: appliedRows,
                quarantine
            });
            await client.query(
                `UPDATE tenant_migrations
                    SET plan_payload = $3::jsonb
                  WHERE tenant_id = $1 AND migration_id = $2`,
                [plan.target_tenant_id, plan.migration_id, canonicalJson(result)]
            );
            return result;
        });
    }

    async rollback(input, { actor, approval } = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some((field) => !['migration_id', 'target_tenant_id'].includes(field))) {
            throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
        }
        const migrationId = assertMigrationId(input.migration_id);
        const targetTenantId = assertMigrationId(input.target_tenant_id);
        const audit = assertApproval(actor, approval);
        return this.#transaction(targetTenantId, async (client) => {
            await assertMigrationLedgerReady(client);
            const appliedResult = await client.query(
                `SELECT migration_id, tenant_id, source_snapshot, mapping_rule_revision,
                        counts, plan_digest, plan_payload
                   FROM tenant_migrations
                  WHERE tenant_id = $1 AND migration_id = $2 AND mode = 'apply'
                  FOR UPDATE`,
                [targetTenantId, migrationId]
            );
            const appliedLedger = appliedResult.rows[0];
            if (!appliedLedger || !appliedLedger.plan_payload
                || typeof appliedLedger.plan_payload !== 'object'
                || !Array.isArray(appliedLedger.plan_payload.applied_rows)) {
                throw new ContractError('MIGRATION_APPLY_NOT_FOUND', { status: 409 });
            }
            const authoritativePlan = appliedLedger.plan_payload;
            if (authoritativePlan.migration_id !== migrationId
                || authoritativePlan.target_tenant_id !== targetTenantId
                || authoritativePlan.mode !== 'apply') {
                throw new ContractError('MIGRATION_PLAN_INVALID', { status: 409 });
            }
            const rollbackId = generateCanonicalId('mig');
            const createdAt = this.now().toISOString();
            await client.query(
                `INSERT INTO tenant_migrations (
                    migration_id, tenant_id, source_snapshot, mapping_rule_revision,
                    mode, counts, collection_state, plan_digest, plan_payload,
                    approved_by, approval_id, approval_reason, approved_at,
                    rollback_of_migration_id, created_at
                 ) VALUES ($1,$2,$3,$4,'rollback',$5::jsonb,'collected',$6,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
                [
                    rollbackId, targetTenantId, appliedLedger.source_snapshot,
                    appliedLedger.mapping_rule_revision, canonicalJson(appliedLedger.counts),
                    appliedLedger.plan_digest, canonicalJson({}), audit.actor,
                    audit.approval_id, audit.reason, createdAt, migrationId, createdAt
                ]
            );
            const quarantine = [];
            let writeCount = 0;
            for (const applied of authoritativePlan.applied_rows) {
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
                        applied.id, targetTenantId, migrationId,
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
                        rollbackId, targetTenantId, item.id, item.reason,
                        canonicalJson({ source_id: item.id }), createdAt
                    ]
                );
            }
            const collectionState = collectionStateFor(quarantine);
            const counts = {
                ...authoritativePlan.counts,
                rolled_back: writeCount,
                failed: quarantine.length
            };
            const { attestation: _attestation, ...unsignedPlan } = authoritativePlan;
            const rollbackResult = deepFreeze({
                ...unsignedPlan,
                migration_id: rollbackId,
                rollback_of_migration_id: migrationId,
                mode: 'rollback',
                counts,
                collection_state: collectionState,
                write_count: writeCount,
                quarantine
            });
            await client.query(
                `UPDATE tenant_migrations
                    SET counts = $3::jsonb, collection_state = $4, plan_payload = $5::jsonb
                  WHERE tenant_id = $1 AND migration_id = $2`,
                [
                    targetTenantId, rollbackId, canonicalJson(counts), collectionState,
                    canonicalJson(rollbackResult)
                ]
            );
            return rollbackResult;
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
