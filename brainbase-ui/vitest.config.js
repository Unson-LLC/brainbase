import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    environmentMatchGlobs: [
      // フロントエンドのテストはjsdom環境
      ['tests/unit/!(config-parser)*.test.js', 'jsdom'],
      // config-parser等のサーバーサイドテストはnode環境
      ['tests/unit/config-parser.test.js', 'node'],
    ],
    coverage: {
      provider: 'v8',
      include: ['public/modules/**/*.js', 'lib/**/*.js'],
    },
  },
});
