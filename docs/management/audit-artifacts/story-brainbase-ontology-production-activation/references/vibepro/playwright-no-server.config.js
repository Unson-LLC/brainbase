import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '..',
  outputDir: '../var/test-results-vibepro-closure',
  workers: 1,
  reporter: [['list']],
});
