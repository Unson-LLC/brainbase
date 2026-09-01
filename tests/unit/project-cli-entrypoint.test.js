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

        expect(output).toContain('brainbase project create <project.yml>');
        expect(output).toContain('enabled     利用する');
        expect(output).toContain('unspecified 方針が未指定');
        expect(output).toContain('安全上の不整合だけを拒否します');
    });
});
