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

describe('verified legacy residue', () => {
    it('removes retired MCP Wiki handlers while retaining the rejection guard and Graph search', () => {
        const serverSource = readFileSync(
            path.join(repositoryRoot, 'mcp/brainbase/src/server.ts'),
            'utf8'
        );

        expect(serverSource).not.toMatch(/case 'get_context'\s*:/);
        expect(serverSource).not.toMatch(/case 'search_wiki'\s*:/);
        expect(serverSource).not.toContain('getContextForTopic');
        expect(serverSource).not.toContain('filterWikiPages');
        expect(serverSource).not.toMatch(/'list_extension_entities', 'get_context', 'get_entity'/);
        expect(serverSource).toContain('export function rejectLegacySearchSurface');
        expect(serverSource).toContain("if (name === 'get_context')");
        expect(serverSource).toContain("if (name === 'search_wiki' || name === 'get_wiki_page')");
        expect(serverSource).not.toContain('async function fetchWikiPage');
        expect(serverSource).not.toMatch(/case 'get_wiki_page'\s*:/);
        expect(serverSource).toContain('searchEntities(entityIndex, query)');
    });

    it('removes the retired cleanup LaunchAgent template', () => {
        expect(existsSync(path.join(repositoryRoot, 'config/com.brainbase.cleanup.plist'))).toBe(false);
    });

    it('removes only the obsolete cleanup-script scanner exclusion', () => {
        const checker = readFileSync(path.join(repositoryRoot, 'scripts/check-secrets.sh'), 'utf8');

        expect(checker).not.toContain('--exclude="auto-cleanup-cron.sh"');
        expect(checker).toContain('--exclude="check-secrets.sh"');
    });
});
