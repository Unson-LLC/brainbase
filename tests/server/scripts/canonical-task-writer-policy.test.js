import { describe, expect, it } from 'vitest';

import { parseCanonicalTaskOperationMigrationArgs } from '../../../scripts/migrate-canonical-task-operations.js';
import { parseCanonicalTaskReadinessArgs } from '../../../scripts/set-canonical-task-readiness.js';
import { parseCanonicalTaskWriterRecoveryArgs } from '../../../scripts/recover-canonical-task-writer.js';

describe('Canonical Task writer policy commands', () => {
    it('requires an explicit migration mode', () => {
        expect(parseCanonicalTaskOperationMigrationArgs(['--check'])).toEqual({ apply: false, check: true });
        expect(() => parseCanonicalTaskOperationMigrationArgs([])).toThrow('exactly one');
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
});
