import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // デフォルトはjsdom（フロントエンド）
    include: ['tests/unit/**/*.test.js', 'tests/core/**/*.test.js', 'tests/domain/**/*.test.js', 'tests/ui/**/*.test.js'],
    environmentMatchGlobs: [
      // config-parser等のサーバーサイドテストのみnode環境
      ['tests/unit/config-parser.test.js', 'node'],
    ],
    coverage: {
      provider: 'v8',
      include: ['public/modules/**/*.js', 'lib/**/*.js'],
    },
  },
});
