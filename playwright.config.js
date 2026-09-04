import { defineConfig, devices } from '@playwright/test';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${PORT}`;
const REUSE_EXISTING_SERVER = process.env.BRAINBASE_E2E_REUSE_SERVER === 'true';
const CANONICAL_TASK_EVIDENCE_SPEC = 'story-companion-canonical-task-provider-contract.spec.ts';
const CANONICAL_TASK_EVIDENCE_TARGET = `tests/e2e/${CANONICAL_TASK_EVIDENCE_SPEC}`;
const canonicalTaskEvidenceRoot = realpathSync(dirname(fileURLToPath(import.meta.url)));
const CANONICAL_TASK_EVIDENCE_ABSOLUTE_TARGET = join(canonicalTaskEvidenceRoot, CANONICAL_TASK_EVIDENCE_TARGET);
const escapeRegularExpression = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const canonicalTaskEvidenceRegistry = JSON.parse(readFileSync(
    join(canonicalTaskEvidenceRoot, 'config/canonical-task-evidence-registry.json'),
    'utf8',
));
const normalWorktreeTestIgnore = [
    '**/.worktrees/**',
    '**/.codex-worktrees/**',
];
const hasRegisteredCanonicalTaskEvidenceId = canonicalTaskEvidenceRegistry.entries.some((entry) => (
    entry.id === process.env.VIBEPRO_EVIDENCE_ID
    && entry.test_command.includes(CANONICAL_TASK_EVIDENCE_TARGET)
));
const collectExplicitCanonicalTaskEvidence = hasRegisteredCanonicalTaskEvidenceId
    && typeof process.env.VIBEPRO_EVIDENCE_RESULT === 'string'
    && process.env.VIBEPRO_EVIDENCE_RESULT.length > 0
    && /^[a-f0-9]{64}$/.test(process.env.VIBEPRO_EVIDENCE_NONCE ?? '');

export default defineConfig({
    testDir: collectExplicitCanonicalTaskEvidence ? canonicalTaskEvidenceRoot : '.',
    // Playwright prefixes string testMatch values with **/, so a full-path
    // RegExp is required to keep nested same-name worktrees out of this mode.
    testMatch: collectExplicitCanonicalTaskEvidence
        ? [new RegExp(`^${escapeRegularExpression(CANONICAL_TASK_EVIDENCE_ABSOLUTE_TARGET)}$`)]
        : [
            'tests/e2e/**/*.spec.@(js|ts)',
            'tests/e2e/**/*.test.@(js|ts)',
            'e2e/**/*.spec.@(js|ts)'
        ],
    // Only the registered collector's fully-bound evidence mode may discover
    // this single target from a worktree. Normal discovery stays isolated.
    testIgnore: collectExplicitCanonicalTaskEvidence ? [] : normalWorktreeTestIgnore,
    outputDir: 'var/test-results',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [
        ['html', { outputFolder: 'var/playwright-report' }],
        ['list']
    ],
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: process.env.VIBEPRO_EVIDENCE_ID ? undefined : {
        command: 'npm run test:server',
        url: BASE_URL,
        reuseExistingServer: REUSE_EXISTING_SERVER,
        timeout: 120 * 1000,
    },
});
