import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { createReleaseArtifact } from '../scripts/npm-release.mjs';
import { QUEUE_TASK_CONTRACT_SCENARIO_NAMES } from '../src/testing/queue-task-tools-contract.js';
it('AC-12 imports public queue tools and reuses the contract suite from a consumer', async () => {
    const root = process.cwd();
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'queue-artifact-'));
    try {
        for (const f of ['user-npmrc', 'global-npmrc'])
            await writeFile(path.join(artifactRoot, f), '');
        const env = { ...process.env, TMPDIR: artifactRoot, NPM_TOKEN: undefined, NODE_AUTH_TOKEN: undefined, NPM_CONFIG_USERCONFIG: path.join(artifactRoot, 'user-npmrc'), NPM_CONFIG_GLOBALCONFIG: path.join(artifactRoot, 'global-npmrc'), NPM_CONFIG_CACHE: path.join(artifactRoot, 'cache') };
        const execute = (command: string, args: string[], cwd = root) => execFileSync(command, args, { cwd, env: command === process.execPath ? { ...env, TMPDIR: undefined, TEMP: undefined, TMP: undefined } : env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        execute('npm', ['run', 'build']);
        const version = JSON.parse(await readFile('package.json', 'utf8')).version;
        const artifact = await createReleaseArtifact(root, artifactRoot, version, execute('git', ['rev-parse', 'HEAD']).trim(), execute);
        const output = JSON.parse(execute(process.execPath, ['scripts/queue-task-tools-consumer-smoke.mjs', artifact.tarballPath]));
        expect(output.scenarios).toEqual(QUEUE_TASK_CONTRACT_SCENARIO_NAMES.map(name => ({ name, status: 'passed' })));
        expect(output.moduleResolution).toEqual({ 'queue-task-tools': 'dist/queue-task-tools.js', 'testing/queue-task-tools-contract': 'dist/testing/queue-task-tools-contract.js' });
        expect(output.vitestAbsent).toBe('passed');
    }
    finally {
        await rm(artifactRoot, { recursive: true, force: true });
    }
}, 180000);
