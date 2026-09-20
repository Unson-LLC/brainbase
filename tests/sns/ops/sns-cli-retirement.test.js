// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const retiredCliScripts = [
    'scripts/build-sns-generation-context.js',
    'scripts/generate-sns-ohayo-brief.js',
    'scripts/generate-personal-kg-sns-weekly-pack.js',
    'scripts/import-sns-review-pack-to-ledger.js',
    'scripts/run-sns-scheduled-posts.js',
    'scripts/process-sns-feedback-to-learning.js',
    'scripts/poll-sns-feedback-metrics.js',
    'scripts/project-oyasumi-sns-ready.js',
    'scripts/seed-personal-kg-sns-foundation.js'
];
const retiredLaunchdTemplates = [
    'config/com.brainbase.sns-scheduled-publisher.plist',
    'config/com.brainbase.sns-feedback-metrics-poller.plist'
];
const retiredLegacyModules = [
    'server/services/sns/feedback-service.js',
    'server/services/sns/posting-service.js',
    'server/services/sns/scheduler-service.js',
    'server/services/sns/providers/x-provider.js',
    'tests/sns/_m4-helpers.js'
];
const generationContextCli = 'scripts/build-sns-generation-context.js';
const generationContextCliFiles = [
    generationContextCli,
    'scripts/lib/retired-sns-cli.js'
];
const generationContextFixtureFiles = [
    'package.json',
    ...generationContextCliFiles
].sort();

function withGenerationContextFixture(assertions) {
    const fixtureParent = process.env.CODEX_WORKTREE_ROOT || os.tmpdir();
    const fixtureRoot = fs.mkdtempSync(path.join(fixtureParent, 'sns-context-cli-fixture-'));

    try {
        fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ type: 'module' }));
        for (const relativePath of generationContextCliFiles) {
            const fixturePath = path.join(fixtureRoot, relativePath);
            fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
            fs.copyFileSync(path.join(root, relativePath), fixturePath);
        }

        assertions(fixtureRoot);
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function listFixtureFiles(directory, parent = '') {
    return fs.readdirSync(path.join(directory, parent), { withFileTypes: true })
        .flatMap((entry) => {
            const relativePath = path.join(parent, entry.name);
            return entry.isDirectory() ? listFixtureFiles(directory, relativePath) : [relativePath];
        })
        .sort();
}

const isolatedCliEnv = {
    NODE_ENV: 'test',
    FORCE_COLOR: '0',
    BRAINBASE_SNS_SERVICE_TOKEN: 'bbsvc_should_not_be_used',
    DATABASE_URL: 'postgres://should-not-be-read'
};

describe('retired SNS CLI entry points', () => {
    it('retires the generation-context command with only Node and its retired-CLI helper available', () => {
        withGenerationContextFixture((fixtureRoot) => {
            expect(listFixtureFiles(fixtureRoot)).toEqual(generationContextFixtureFiles);

            for (const flags of [[], ['--dry-run', '--json'], ['--confirm-public-post']]) {
                const result = spawnSync(process.execPath, [path.join(fixtureRoot, generationContextCli), ...flags], {
                    cwd: fixtureRoot,
                    encoding: 'utf8',
                    timeout: 10000,
                    env: isolatedCliEnv
                });

                expect(result.error).toBeUndefined();
                expect(result.status).toBe(1);
                expect(result.stdout).toBe('');
                expect(result.stderr).toContain('SNS_CLI_RETIRED');
                expect(result.stderr).toContain('SNS操作は実行していません');
                expect(listFixtureFiles(fixtureRoot)).toEqual(generationContextFixtureFiles);
            }
        });
    });

    it('can be imported without output or process-exit side effects', () => {
        withGenerationContextFixture((fixtureRoot) => {
            const cliUrl = pathToFileURL(path.join(fixtureRoot, generationContextCli)).href;
            const result = spawnSync(process.execPath, [
                '--input-type=module',
                '-e',
                `await import(${JSON.stringify(cliUrl)})`
            ], {
                cwd: fixtureRoot,
                encoding: 'utf8',
                timeout: 10000,
                env: isolatedCliEnv
            });

            expect(result.error).toBeUndefined();
            expect(result.status).toBe(0);
            expect(result.stdout).toBe('');
            expect(result.stderr).toBe('');
            expect(listFixtureFiles(fixtureRoot)).toEqual(generationContextFixtureFiles);
        });
    });

    it.each(retiredCliScripts)('%s fails before performing an SNS operation', (script) => {
        for (const flags of [[], ['--dry-run', '--json'], ['--confirm-public-post']]) {
            const result = spawnSync(process.execPath, [path.join(root, script), ...flags], {
                cwd: root,
                encoding: 'utf8',
                timeout: 10000,
                env: {
                    NODE_ENV: 'test',
                    FORCE_COLOR: '0',
                    BRAINBASE_SNS_SERVICE_TOKEN: 'bbsvc_should_not_be_used',
                    DATABASE_URL: 'postgres://should-not-be-read'
                }
            });

            expect(result.error).toBeUndefined();
            expect(result.status).toBe(1);
            expect(result.stdout).toBe('');
            expect(result.stderr).toContain('SNS_CLI_RETIRED');
            expect(result.stderr).toContain('SNS操作は実行していません');
        }
    });

    it('removes SNS npm commands and launchd templates from active distribution', () => {
        const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        expect(Object.keys(packageJson.scripts ?? {}).filter((name) => /sns/i.test(name))).toEqual([]);

        for (const template of retiredLaunchdTemplates) {
            expect(fs.existsSync(path.join(root, template))).toBe(false);
        }
    });

    it('keeps the retired SNS implementation cluster absent from the active tree', () => {
        for (const relativePath of retiredLegacyModules) {
            expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
        }
    });
});
