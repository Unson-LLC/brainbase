import { defineConfig, devices } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${PORT}`;
const REUSE_EXISTING_SERVER = process.env.BRAINBASE_E2E_REUSE_SERVER === 'true';

export default defineConfig({
    testDir: './tests/e2e',
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
    webServer: {
        command: 'npm run test:server',
        url: BASE_URL,
        reuseExistingServer: REUSE_EXISTING_SERVER,
        timeout: 120 * 1000,
    },
});
