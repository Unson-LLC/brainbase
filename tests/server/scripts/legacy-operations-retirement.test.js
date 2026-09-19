// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const temporaryRoots = [];

const retiredEntrypoints = [
    {
        name: 'cleanup-old-sessions',
        file: 'scripts/cleanup-old-sessions.sh',
        invocations: [
            { args: [], env: { AUTO_CONFIRM: 'yes' } },
            { args: ['1', '--force'], env: { AUTO_CONFIRM: 'yes' } }
        ]
    },
    {
        name: 'auto-cleanup-cron',
        file: 'scripts/auto-cleanup-cron.sh',
        invocations: [
            { args: [], env: { AUTO_CONFIRM: 'yes' } },
            { args: ['--force', '30'], env: { AUTO_CONFIRM: 'yes' } }
        ]
    },
    {
        name: 'dev-server-worktree',
        file: '.claude/scripts/dev-server-worktree.sh',
        invocations: [
            { args: [], env: { AUTO_CONFIRM: 'yes' } },
            { args: ['--force', '31014'], env: { AUTO_CONFIRM: 'yes' } }
        ]
    },
    {
        name: 'stop-dev-server',
        file: '.claude/scripts/stop-dev-server.sh',
        invocations: [
            { args: [], env: { AUTO_CONFIRM: 'yes' } },
            { args: ['31014', '--force'], env: { AUTO_CONFIRM: 'yes' } }
        ]
    }
];

const retirementCommandDocs = [
    { name: 'merge', file: '.claude/commands/merge.md' },
    { name: 'create-pr', file: '.claude/commands/create-pr.md' }
];

const executableRetiredApiCallPatterns = [
    /\b(?:curl|wget)\b[^\n]*\/api\/(?:sessions|state)\b/i,
    /^\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\/api\/(?:sessions|state)\b/im,
    /\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*['"`][^'"`]*\/api\/(?:sessions|state)\b/i
];

const trappedCommands = [
    'awk', 'cat', 'cp', 'date', 'dirname', 'find', 'grep', 'kill', 'lsof',
    'mkdir', 'npm', 'open', 'ps', 'rm', 'sleep', 'tmux', 'tr', 'xargs', 'xdg-open'
];

function createFixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'brainbase-retired-lifecycle-'));
    temporaryRoots.push(root);
    const bin = path.join(root, 'bin');
    const dataRoot = path.join(root, 'data');
    const effectLog = path.join(root, 'effects.log');
    const varDir = path.join(root, 'var');
    mkdirSync(bin);
    mkdirSync(dataRoot);

    for (const command of trappedCommands) {
        const commandPath = path.join(bin, command);
        writeFileSync(
            commandPath,
            `#!/bin/bash\nprintf '%s\\n' '${command}' >> "$RETIREMENT_EFFECT_LOG"\nexit 97\n`
        );
        chmodSync(commandPath, 0o755);
    }

    return { root, bin, dataRoot, effectLog, varDir };
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('retired Brainbase lifecycle entrypoints', () => {
    for (const entrypoint of retiredEntrypoints) {
        describe(entrypoint.name, () => {
            it('retains an executable path tombstone', () => {
                const mode = statSync(path.join(repositoryRoot, entrypoint.file)).mode;

                expect(mode & 0o111).not.toBe(0);
            });

            for (const invocation of entrypoint.invocations) {
                it(`fails closed with args ${JSON.stringify(invocation.args)} and AUTO_CONFIRM`, () => {
                    const fixture = createFixture();
                    const result = spawnSync(
                        '/bin/bash',
                        [path.join(repositoryRoot, entrypoint.file), ...invocation.args],
                        {
                            cwd: fixture.root,
                            encoding: 'utf8',
                            env: {
                                ...process.env,
                                PATH: `${fixture.bin}${path.delimiter}${process.env.PATH ?? ''}`,
                                AUTO_CONFIRM: invocation.env.AUTO_CONFIRM,
                                BRAINBASE_ROOT: fixture.dataRoot,
                                BRAINBASE_VAR_DIR: fixture.varDir,
                                RETIREMENT_EFFECT_LOG: fixture.effectLog,
                                TMPDIR: fixture.root
                            }
                        }
                    );

                    expect(result.error).toBeUndefined();
                    expect(result.signal).toBeNull();
                    expect(result.status).toBe(1);
                    expect(result.stdout).toBe('');
                    expect(result.stderr).toContain('ADR-019-codex-owns-development-runtime.md');
                    expect(result.stderr).toContain('Codex');
                    expect(existsSync(fixture.effectLog)).toBe(false);
                    expect(existsSync(fixture.varDir)).toBe(false);
                    expect(readdirSync(fixture.dataRoot)).toEqual([]);
                });
            }
        });
    }
});

describe('PR command docs after lifecycle retirement', () => {
    for (const commandDoc of retirementCommandDocs) {
        it(`${commandDoc.name} names ADR-019 and does not execute retired session/state APIs`, () => {
            const contents = readFileSync(path.join(repositoryRoot, commandDoc.file), 'utf8');

            expect(contents).toContain('ADR-019-codex-owns-development-runtime.md');
            expect(contents).toMatch(/Codex/);

            for (const pattern of executableRetiredApiCallPatterns) {
                expect(contents).not.toMatch(pattern);
            }
        });
    }
});
