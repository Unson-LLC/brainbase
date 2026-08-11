import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import config from '../../playwright.config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test.describe('story-playwright-worktree-discovery-boundary', () => {
    test('ac-1 keeps both canonical E2E locations discoverable', async () => {
        expect(config.testDir, 'ac-1 keeps repository-root discovery').toBe('.');
        expect(config.testMatch, 'ac-1 keeps both canonical E2E roots').toEqual([
            'tests/e2e/**/*.spec.@(js|ts)',
            'tests/e2e/**/*.test.@(js|ts)',
            'e2e/**/*.spec.@(js|ts)',
        ]);
    });

    test('ac-2 ac-3 excludes both nested worktree roots', async () => {
        expect(config.testIgnore, 'ac-2 excludes .worktrees').toContain('**/.worktrees/**');
        expect(config.testIgnore, 'ac-3 excludes .codex-worktrees').toContain('**/.codex-worktrees/**');

        const fixtureRoot = mkdtempSync(join(tmpdir(), 'brainbase-playwright-boundary-'));

        try {
            const canonicalDir = join(fixtureRoot, 'tests/e2e');
            const worktreeDir = join(fixtureRoot, '.worktrees/nested/tests/e2e');
            const codexWorktreeDir = join(fixtureRoot, '.codex-worktrees/nested/tests/e2e');
            mkdirSync(canonicalDir, { recursive: true });
            mkdirSync(worktreeDir, { recursive: true });
            mkdirSync(codexWorktreeDir, { recursive: true });

            const playwrightModule = resolve(repoRoot, 'node_modules/@playwright/test/index.js');
            writeFileSync(
                join(canonicalDir, 'canonical.spec.js'),
                `import { test } from ${JSON.stringify(playwrightModule)};\n`
                    + "test('canonical fixture', async () => {});\n",
            );
            writeFileSync(
                join(worktreeDir, 'must-not-load.spec.js'),
                "throw new Error('WORKTREES_FIXTURE_WAS_IMPORTED');\n",
            );
            writeFileSync(
                join(codexWorktreeDir, 'must-not-load.spec.js'),
                "throw new Error('CODEX_WORKTREES_FIXTURE_WAS_IMPORTED');\n",
            );

            const configPath = join(fixtureRoot, 'playwright.config.mjs');
            const baseConfigModule = pathToFileURL(resolve(repoRoot, 'playwright.config.js')).href;
            writeFileSync(
                configPath,
                `import baseConfig from ${JSON.stringify(baseConfigModule)};\n`
                    + 'export default {\n'
                    + '  ...baseConfig,\n'
                    + `  testDir: ${JSON.stringify(fixtureRoot)},\n`
                    + `  outputDir: ${JSON.stringify(join(fixtureRoot, 'results'))},\n`
                    + "  reporter: 'list',\n"
                    + '  webServer: undefined,\n'
                    + '};\n',
            );

            const output = execFileSync(
                process.execPath,
                [
                    resolve(repoRoot, 'node_modules/@playwright/test/cli.js'),
                    'test',
                    '--list',
                    `--config=${configPath}`,
                ],
                {
                    cwd: repoRoot,
                    encoding: 'utf8',
                    env: { ...process.env, FORCE_COLOR: '0' },
                },
            );

            expect(output, 'ac-4 keeps the canonical fixture discoverable').toContain('canonical fixture');
            expect(output, 'ac-4 collects exactly one canonical fixture').toContain('Total: 1 test in 1 file');
            expect(output).not.toContain('WORKTREES_FIXTURE_WAS_IMPORTED');
            expect(output).not.toContain('CODEX_WORKTREES_FIXTURE_WAS_IMPORTED');
            expect(output).not.toContain('/.worktrees/');
            expect(output).not.toContain('/.codex-worktrees/');
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    test('ac-4 ac-5 preserves the collector runtime contract', async () => {
        expect(config.outputDir, 'ac-5 preserves collector output').toBe('var/test-results');
        expect(config.workers).toBe(1);
        expect(config.reporter).toEqual([
            ['html', { outputFolder: 'var/playwright-report' }],
            ['list'],
        ]);
        expect(config.projects).toHaveLength(1);
        expect(config.projects[0].name).toBe('chromium');
        expect(config.webServer.command).toBe('npm run test:server');
    });
});
