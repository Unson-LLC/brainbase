// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('project CLI entrypoint', () => {
    it('dispatches project help through the real Node process', () => {
        const cliPath = path.resolve(process.cwd(), 'cli/index.js');
        const output = execFileSync(process.execPath, [cliPath, 'project', '--help'], {
            encoding: 'utf8'
        });

        expect(output).toContain('brainbase project provision check --manifest FILE');
        expect(output).toContain('brainbase project provision plan --manifest FILE --idempotency-key KEY');
        expect(output).not.toContain('brainbase project create');
        expect(output).not.toContain('brainbase project configure');
        expect(output).not.toContain('brainbase project inspect');
        expect(output).not.toContain('brainbase project reconcile');
    });
});
