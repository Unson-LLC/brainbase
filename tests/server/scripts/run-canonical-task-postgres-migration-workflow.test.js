import { describe, expect, it, vi } from 'vitest';

import {
    runCanonicalTaskPostgresMigrationWorkflow
} from '../../../scripts/run-canonical-task-postgres-migration-workflow.js';

function result(overrides = {}) {
    return {
        ok: true,
        source_count: 2,
        target_count: 0,
        matched_count: 0,
        pending_count: 2,
        inserted_count: 0,
        conflict_count: 0,
        ...overrides
    };
}

function successfulMigration() {
    return vi.fn()
        .mockResolvedValueOnce(result())
        .mockResolvedValueOnce(result())
        .mockResolvedValueOnce(result({ target_count: 2, inserted_count: 2 }))
        .mockResolvedValueOnce(result({
            target_count: 2,
            matched_count: 2,
            pending_count: 0
        }));
}

describe('Canonical Task PostgreSQL migration workflow', () => {
    it('enforces dry-run, check, apply, then final check', async () => {
        const runMigration = successfulMigration();
        const output = await runCanonicalTaskPostgresMigrationWorkflow({ runMigration });

        expect(runMigration.mock.calls.map(([input]) => ({
            argv: input.argv,
            workflowAuthorized: input.workflowAuthorized
        }))).toEqual([
            { argv: ['--dry-run'], workflowAuthorized: false },
            { argv: ['--check'], workflowAuthorized: false },
            { argv: ['--apply'], workflowAuthorized: true },
            { argv: ['--check'], workflowAuthorized: false }
        ]);
        expect(output).toMatchObject({
            ok: true,
            workflow: 'dry-run -> check -> apply -> final-check',
            final_check_passed: true
        });
        expect(JSON.stringify(output)).not.toContain('title');
        expect(JSON.stringify(output)).not.toContain('description');
    });

    it.each([
        ['dry-run', 0],
        ['check', 1],
        ['apply', 2]
    ])('stops after a failed %s phase', async (_phase, failureIndex) => {
        const runMigration = vi.fn();
        for (let index = 0; index < failureIndex; index += 1) {
            runMigration.mockResolvedValueOnce(result());
        }
        runMigration.mockRejectedValueOnce(new Error('phase failed'));

        await expect(
            runCanonicalTaskPostgresMigrationWorkflow({ runMigration })
        ).rejects.toThrow('phase failed');
        expect(runMigration).toHaveBeenCalledTimes(failureIndex + 1);
    });

    it('rejects readiness evidence when final check still has pending rows', async () => {
        const runMigration = vi.fn()
            .mockResolvedValueOnce(result())
            .mockResolvedValueOnce(result())
            .mockResolvedValueOnce(result({ target_count: 2, inserted_count: 2 }))
            .mockResolvedValueOnce(result({ target_count: 1, pending_count: 1 }));

        await expect(
            runCanonicalTaskPostgresMigrationWorkflow({ runMigration })
        ).rejects.toThrow('final check failed');
    });
});
