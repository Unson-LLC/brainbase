import { describe, expect, it } from 'vitest';
import config from '../../playwright.config.js';

describe('Playwright test discovery boundary', () => {
    it('keeps both canonical E2E locations discoverable', () => {
        expect(config.testDir).toBe('.');
        expect(config.testMatch).toEqual([
            'tests/e2e/**/*.spec.@(js|ts)',
            'tests/e2e/**/*.test.@(js|ts)',
            'e2e/**/*.spec.@(js|ts)',
        ]);
    });

    it('excludes nested repository workspaces from collection', () => {
        expect(config.testIgnore).toEqual(expect.arrayContaining([
            '**/.worktrees/**',
            '**/.codex-worktrees/**',
        ]));
    });

    it('preserves the existing runtime and reporting contract', () => {
        expect(config.outputDir).toBe('var/test-results');
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
