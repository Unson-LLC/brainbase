// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const retiredSetup = path.join(repositoryRoot, 'setup.sh');
const temporaryRoots = [];

function temporaryRoot() {
    const root = mkdtempSync(path.join(tmpdir(), 'brainbase-retired-setup-'));
    temporaryRoots.push(root);
    return root;
}

function runRetiredSetup(root) {
    const dataDir = path.join(root, 'data');
    const varDir = path.join(root, 'var');
    return {
        dataDir,
        varDir,
        result: spawnSync('bash', [retiredSetup], {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env,
                BRAINBASE_ROOT: dataDir,
                BRAINBASE_VAR_DIR: varDir
            }
        })
    };
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('retired root setup entrypoint', () => {
    it('既存stateを変更せず、npm run setupを案内して終了する', () => {
        const root = temporaryRoot();
        const varDir = path.join(root, 'var');
        const statePath = path.join(varDir, 'state.json');
        const originalState = '{"schemaVersion":3,"sessions":[]}\n';
        mkdirSync(varDir, { recursive: true });
        writeFileSync(statePath, originalState);
        const beforeEntries = readdirSync(root);

        const { dataDir, result } = runRetiredSetup(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('npm run setup');
        expect(result.stderr).toContain('変更しません');
        expect(readFileSync(statePath, 'utf8')).toBe(originalState);
        expect(readdirSync(root)).toEqual(beforeEntries);
        expect(existsSync(dataDir)).toBe(false);
    });

    it('stateがない場合もstateやデータディレクトリを作成しない', () => {
        const root = temporaryRoot();

        const { dataDir, varDir, result } = runRetiredSetup(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('npm run setup');
        expect(existsSync(path.join(varDir, 'state.json'))).toBe(false);
        expect(existsSync(varDir)).toBe(false);
        expect(existsSync(dataDir)).toBe(false);
        expect(readdirSync(root)).toEqual([]);
    });
});
