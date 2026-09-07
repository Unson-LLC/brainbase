import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { supportedNodeVersion, vitestExecArguments } from '../../scripts/run-vitest.mjs';

describe('run-vitest', () => {
    it('accepts the Node versions used by CI and rejects unverified newer versions', () => {
        expect(supportedNodeVersion('20.20.0')).toBe(true);
        expect(supportedNodeVersion('22.23.2')).toBe(true);
        expect(supportedNodeVersion('19.9.0')).toBe(false);
        expect(supportedNodeVersion('23.0.0')).toBe(false);
        expect(supportedNodeVersion('26.3.1')).toBe(false);
    });

    it('starts the local Vitest executable with the caller arguments', () => {
        expect(vitestExecArguments('/repo/node_modules/vitest/vitest.mjs', ['run'])).toEqual([
            '/repo/node_modules/vitest/vitest.mjs',
            'run'
        ]);
    });

    it('routes every root Vitest package script through the version guard', () => {
        const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'));
        const directVitestScripts = Object.entries(packageJson.scripts)
            .filter(([, command]) => /(^|&&\s+)vitest\s/.test(command))
            .map(([name]) => name);

        expect(directVitestScripts).toEqual([]);
    });
});
