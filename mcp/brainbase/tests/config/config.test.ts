/**
 * config Test
 * graphapi-only configuration validation
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.BRAINBASE_ENTITY_SOURCE;
    delete process.env.BRAINBASE_GRAPH_API_URL;
    delete process.env.BRAINBASE_API_BASE_URL;
    delete process.env.BRAINBASE_PROJECT_CODES;
    delete process.env.CODEX_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('source未指定時_graphapiをデフォルトにする', () => {
    const config = loadConfig();

    assert.strictEqual(config.sourceMode, 'graphapi');
    assert.strictEqual(config.graphApiUrl, 'https://graph.brain-base.work');
  });

  it('BRAINBASE_API_BASE_URLからgraphApiUrlを解決する', () => {
    process.env.BRAINBASE_API_BASE_URL = 'https://graph.example.com/';
    process.env.BRAINBASE_PROJECT_CODES = 'brainbase, zeims';

    const config = loadConfig();

    assert.strictEqual(config.graphApiUrl, 'https://graph.example.com');
    assert.deepStrictEqual(config.projectCodes, ['brainbase', 'zeims']);
  });

  it('filesystem指定時_エラーを投げる', () => {
    process.env.BRAINBASE_ENTITY_SOURCE = 'filesystem';

    assert.throws(
      () => loadConfig(),
      /BRAINBASE_ENTITY_SOURCE must be graphapi/
    );
  });

  it('hybrid指定時_エラーを投げる', () => {
    process.env.BRAINBASE_ENTITY_SOURCE = 'hybrid';

    assert.throws(
      () => loadConfig(),
      /BRAINBASE_ENTITY_SOURCE must be graphapi/
    );
  });
});
