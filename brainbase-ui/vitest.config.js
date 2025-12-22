import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/core/**/*.test.js', 'tests/domain/**/*.test.js'],
    environmentMatchGlobs: [
      // フロントエンドのテストはjsdom環境
      ['tests/unit/!(config-parser)*.test.js', 'jsdom'],
      ['tests/core/**/*.test.js', 'jsdom'],
      ['tests/domain/**/*.test.js', 'jsdom'],
      // config-parser等のサーバーサイドテストはnode環境
      ['tests/unit/config-parser.test.js', 'node'],
    ],
    coverage: {
      provider: 'v8',
      include: ['public/modules/**/*.js', 'lib/**/*.js'],
    },
  },
});
