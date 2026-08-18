import { describe, expect, it } from 'vitest';
import { TenantMigrationPlanner } from '../../../../server/services/multitenant/migration-planner.js';

describe('TenantMigrationPlanner', () => {
    it('AC-006: dry-runは書込0で件数を照合し曖昧・未帰属を隔離候補にする', () => {
        const planner = new TenantMigrationPlanner();
        const plan = planner.dryRun({
            target_tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            source_snapshot: 'snapshot:immutable', mapping_rule_revision: 1,
            rows: [
                { id: '1', candidates: ['ten_01ARZ3NDEKTSV4RRFFQ69G5FAV'] },
                { id: '2', candidates: ['ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW'] },
                { id: '3', candidates: [] }
            ]
        });
        expect(plan.counts).toMatchObject({ scanned: 3, eligible: 1, ambiguous: 1, unowned: 1, migrated: 0 });
        expect(plan.write_count).toBe(0);
        expect(plan.quarantine.map((item) => item.reason)).toEqual(['ambiguous', 'unowned']);
    });

    it('AC-006: applyをmigration ID単位でrollbackし新規更新との競合を隔離する', () => {
        const planner = new TenantMigrationPlanner();
        const plan = planner.dryRun({ target_tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', source_snapshot: 'snapshot:immutable', mapping_rule_revision: 1, rows: [{ id: '1', revision: 2, candidates: ['ten_01ARZ3NDEKTSV4RRFFQ69G5FAV'] }] });
        const applied = planner.apply(plan, [{ id: '1', revision: 2 }]);
        expect(applied.counts).toMatchObject({ eligible: 1, migrated: 1, failed: 0 });
        const rolledBack = planner.rollback(applied, [{ id: '1', revision: 4 }]);
        expect(rolledBack.quarantine[0]).toMatchObject({ id: '1', reason: 'rollback_conflict' });
    });
});
