import { describe, expect, test } from 'vitest';

import { spawnSync } from 'node:child_process';

const scriptPath = 'script/backfill-eve-meeting-note-dispatch.mjs';

describe('backfill Eve meeting-note dispatch CLI', () => {
    test.each([
        ['no run ID', []],
        ['multiple run IDs', ['run_1', 'run_2']]
    ])('rejects --execute with %s before reading the ledger', (_label, runIds) => {
        const result = spawnSync('node', [
            scriptPath,
            '--ledger', '/path/that/must/not/be/read.json',
            ...runIds.flatMap((runId) => ['--run-id', runId]),
            '--execute'
        ], { encoding: 'utf8' });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('--execute requires exactly one --run-id');
        expect(result.stderr).not.toContain('ENOENT');
    });
});
