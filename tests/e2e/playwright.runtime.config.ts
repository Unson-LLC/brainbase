import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../..',
  testMatch: [
    'tests/e2e/story-ten-minute-world-onboarding-runtime-flow.spec.ts',
    'tests/e2e/story-ten-minute-world-onboarding-source-inventory-contract.spec.ts',
  ],
  outputDir: '../../var/test-results/onboarding-runtime',
  workers: 1,
  reporter: [['list']],
  webServer: undefined,
});
