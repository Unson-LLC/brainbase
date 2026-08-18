import { deepFreeze } from './canonical-json.js';
import { generateCanonicalId } from './ids.js';
import { ContractError } from './errors.js';

function countsFor(rows) {
    const counts = { scanned: rows.length, eligible: 0, migrated: 0, unchanged: 0, ambiguous: 0, unowned: 0, failed: 0 };
    for (const row of rows) {
        if (row.candidates.length === 1) counts.eligible += 1;
        else if (row.candidates.length === 0) counts.unowned += 1;
        else counts.ambiguous += 1;
    }
    return counts;
}

export class TenantMigrationPlanner {
    dryRun({ target_tenant_id, source_snapshot, mapping_rule_revision, rows }) {
        if (!source_snapshot || !target_tenant_id || !Number.isInteger(mapping_rule_revision) || !Array.isArray(rows)) {
            throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
        }
        const counts = countsFor(rows);
        if (counts.scanned !== counts.eligible + counts.ambiguous + counts.unowned) {
            throw new ContractError('MIGRATION_COUNT_MISMATCH', { status: 409 });
        }
        return deepFreeze({
            migration_id: generateCanonicalId('mig'),
            source_snapshot,
            target_tenant_id,
            mapping_rule_revision,
            mode: 'dry_run',
            counts,
            collection_state: 'collected',
            write_count: 0,
            candidates: rows.filter((row) => row.candidates.length === 1).map((row) => ({
                id: row.id, source_revision: row.revision ?? 1, recommended_tenant_id: row.candidates[0]
            })),
            quarantine: rows.filter((row) => row.candidates.length !== 1).map((row) => ({
                id: row.id, reason: row.candidates.length === 0 ? 'unowned' : 'ambiguous'
            }))
        });
    }

    apply(plan, currentRows) {
        if (plan.mode !== 'dry_run') throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
        let migrated = 0;
        let unchanged = 0;
        let failed = 0;
        const appliedRows = [];
        const quarantine = [...plan.quarantine];
        for (const candidate of plan.candidates) {
            const current = currentRows.find((row) => row.id === candidate.id);
            if (!current || current.revision !== candidate.source_revision) {
                failed += 1;
                quarantine.push({ id: candidate.id, reason: 'apply_conflict' });
            } else if (current.tenant_id === plan.target_tenant_id) {
                unchanged += 1;
            } else {
                migrated += 1;
                appliedRows.push({ id: candidate.id, source_revision: current.revision, applied_revision: current.revision + 1 });
            }
        }
        if (plan.counts.eligible !== migrated + unchanged + failed) {
            throw new ContractError('MIGRATION_COUNT_MISMATCH', { status: 409 });
        }
        return deepFreeze({ ...plan, mode: 'apply', counts: { ...plan.counts, migrated, unchanged, failed }, write_count: migrated, applied_rows: appliedRows, quarantine });
    }

    rollback(plan, currentRows) {
        if (plan.mode !== 'apply') throw new ContractError('MIGRATION_PLAN_INVALID', { status: 400 });
        const quarantine = [...plan.quarantine];
        let writeCount = 0;
        for (const applied of plan.applied_rows) {
            const current = currentRows.find((row) => row.id === applied.id);
            if (!current || current.revision !== applied.applied_revision) {
                quarantine.push({ id: applied.id, reason: 'rollback_conflict' });
            } else {
                writeCount += 1;
            }
        }
        return deepFreeze({ ...plan, mode: 'rollback', write_count: writeCount, quarantine });
    }
}
