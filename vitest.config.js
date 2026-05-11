import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '/modules': path.resolve(__dirname, 'public/modules'),
    },
  },
  test: {
    environment: 'jsdom', // デフォルトはjsdom（フロントエンド）
    include: ['tests/unit/**/*.test.js', 'tests/core/**/*.test.js', 'tests/domain/**/*.test.js', 'tests/ui/**/*.test.js', 'tests/api/**/*.test.js', 'tests/integration/**/*.test.js', 'tests/server/**/*.test.js', 'tests/public/**/*.test.js', 'tests/mesh/**/*.test.js', 'tests/security/**/*.test.js', 'tests/access-contracts/**/*.test.js', 'tests/candidate-store/**/*.test.js', 'tests/account/**/*.test.js', 'tests/sns/**/*.test.js', 'tests/settings/phase0/**/*.test.js'],
    setupFiles: ['tests/setup/test-setup.js'],
    environmentMatchGlobs: [
      // config-parser等のサーバーサイドテストのみnode環境
      ['tests/unit/config-parser.test.js', 'node'],
      // APIテストはnode環境
      ['tests/api/**/*.test.js', 'node'],
      // 統合テストはnode環境（JSDOMを使用）
      ['tests/integration/**/*.test.js', 'node'],
      // サーバーサイドテストはnode環境
      ['tests/server/**/*.test.js', 'node'],
      // Meshテストはnode環境（libsodium-wrappers要件）
      ['tests/mesh/**/*.test.js', 'node'],
      // Security guard tests are pure logic, node環境
      ['tests/security/**/*.test.js', 'node'],
      // Access contract tests are pure logic + fixtures, node環境
      ['tests/access-contracts/**/*.test.js', 'node'],
      // Candidate store tests are pure logic + in-memory repo, node環境
      ['tests/candidate-store/**/*.test.js', 'node'],
      // Account / SNS curator / Settings phase0 tests are pure logic, node環境
      ['tests/account/**/*.test.js', 'node'],
      ['tests/sns/**/*.test.js', 'node'],
      ['tests/settings/**/*.test.js', 'node'],
    ],
    coverage: {
      provider: 'v8',
      include: ['public/modules/**/*.js', 'lib/**/*.js', 'scripts/vibepro-score-run.mjs'],
    },
  },
});
