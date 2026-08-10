import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCanonicalTaskColumnMigrationArgs } from '../../../scripts/migrate-canonical-task-columns.js';
import { parseCanonicalTaskOperationMigrationArgs } from '../../../scripts/migrate-canonical-task-operations.js';
import { parseCanonicalTaskReadinessArgs } from '../../../scripts/set-canonical-task-readiness.js';
import { parseCanonicalTaskWriterRecoveryArgs } from '../../../scripts/recover-canonical-task-writer.js';

const OPERATIONAL_TASK_SCRIPTS = [
    'scripts/add-frame-story-tasks.js',
    'scripts/add-framework-operation-tasks.js',
    'scripts/complete-doc-tasks.js',
    'scripts/list-high-priority-tasks.js',
    'scripts/update-task-status.js'
];

describe('Canonical Task writer policy commands', () => {
    it('requires an explicit migration mode', () => {
        expect(parseCanonicalTaskOperationMigrationArgs(['--check'])).toEqual({ apply: false, check: true });
        expect(parseCanonicalTaskColumnMigrationArgs(['--apply'])).toEqual({ apply: true, check: false });
        expect(() => parseCanonicalTaskOperationMigrationArgs([])).toThrow('exactly one');
        expect(() => parseCanonicalTaskColumnMigrationArgs([])).toThrow('exactly one');
    });

    it('requires evidence to enable and a reason to disable', () => {
        expect(parseCanonicalTaskReadinessArgs(['--enable', '--evidence', 'evidence.json']))
            .toMatchObject({ enable: true, evidencePath: 'evidence.json' });
        expect(() => parseCanonicalTaskReadinessArgs(['--enable'])).toThrow('--evidence');
        expect(() => parseCanonicalTaskReadinessArgs(['--disable'])).toThrow('--reason');
    });

    it('requires expected and replacement tokens for manual recovery', () => {
        expect(parseCanonicalTaskWriterRecoveryArgs(['--expected-token', 'old', '--new-token', 'new']))
            .toEqual({ expectedToken: 'old', newToken: 'new' });
        expect(() => parseCanonicalTaskWriterRecoveryArgs(['--new-token', 'new'])).toThrow('--expected-token');
    });

    it('keeps operational scripts behind the Companion Canonical Task API', async () => {
        for (const relativePath of OPERATIONAL_TASK_SCRIPTS) {
            const source = await readFile(path.resolve(relativePath), 'utf8');
            expect(source, relativePath).toContain('./lib/canonical-task-api-client.js');
            expect(source, relativePath).not.toMatch(/api\/v2\/tables|m7iys8m7o1abr3f|xc-(?:auth|token)/);
        }
    });
});
