/**
 * config Test
 * graphapi-only configuration validation
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { loadConfig, resolveBrainbaseApiUrl } from '../../src/config.js';

describe('loadConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.BRAINBASE_ENTITY_SOURCE;
    delete process.env.BRAINBASE_GRAPH_API_URL;
    delete process.env.BRAINBASE_API_URL;
    delete process.env.BRAINBASE_API_BASE_URL;
    delete process.env.BRAINBASE_RESOLVED_API_URL;
    delete process.env.BRAINBASE_PROJECT_CODES;
    delete process.env.CODEX_PATH;
    delete process.env.BRAINBASE_PERSONAL_KG_STORAGE_MODE;
    delete process.env.BRAINBASE_PERSONAL_KG_LOCAL_API_URL;
    delete process.env.BRAINBASE_PERSONAL_KG_MANAGED_CLOUD_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('source未指定時_graphapiをデフォルトにする', () => {
    const config = loadConfig();

    assert.strictEqual(config.sourceMode, 'graphapi');
    assert.strictEqual(config.graphApiUrl, 'https://bb.unson.jp');
  });

  it('BRAINBASE_API_URLからgraphApiUrlを解決する', () => {
    process.env.BRAINBASE_API_URL = 'https://bb.unson.jp/';

    const config = loadConfig();

    assert.strictEqual(config.graphApiUrl, 'https://bb.unson.jp');
  });

  it('BRAINBASE_API_BASE_URLからgraphApiUrlを解決する', () => {
    process.env.BRAINBASE_API_BASE_URL = 'https://graph.example.com/';
    process.env.BRAINBASE_PROJECT_CODES = 'brainbase, zeims';

    const config = loadConfig();

    assert.strictEqual(config.graphApiUrl, 'https://graph.example.com');
    assert.deepStrictEqual(config.projectCodes, ['brainbase', 'zeims']);
  });

  it('優先順位_BRAINBASE_GRAPH_API_URLが最優先', () => {
    process.env.BRAINBASE_GRAPH_API_URL = 'https://explicit-graph.example.com';
    process.env.BRAINBASE_API_URL = 'https://api.example.com';
    process.env.BRAINBASE_API_BASE_URL = 'https://base.example.com';

    const config = loadConfig();

    assert.strictEqual(config.graphApiUrl, 'https://explicit-graph.example.com');
  });

  it('launcherが固定したresolved URLを全API用途の最優先にする', () => {
    process.env.BRAINBASE_RESOLVED_API_URL = 'https://resolved.example.com/';
    process.env.BRAINBASE_GRAPH_API_URL = 'https://graph.example.com';
    process.env.BRAINBASE_API_URL = 'https://api.example.com';

    assert.strictEqual(resolveBrainbaseApiUrl(), 'https://resolved.example.com');
    assert.strictEqual(loadConfig().graphApiUrl, 'https://resolved.example.com');
  });

  it('優先順位_GRAPH_API_URLが無いときBRAINBASE_API_URLが次点', () => {
    process.env.BRAINBASE_API_URL = 'https://api.example.com';
    process.env.BRAINBASE_API_BASE_URL = 'https://base.example.com';

    const config = loadConfig();

    assert.strictEqual(config.graphApiUrl, 'https://api.example.com');
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

  it('personal KG未指定時は既存候補検索互換のためcanonical設定を持たない', () => {
    const config = loadConfig();

    assert.strictEqual(config.personalKgStorageMode, undefined);
    assert.strictEqual(config.personalKgApiUrl, undefined);
  });

  it('personal KG local mode requires and normalizes its explicit loopback URL', () => {
    process.env.BRAINBASE_PERSONAL_KG_STORAGE_MODE = 'local';
    process.env.BRAINBASE_PERSONAL_KG_LOCAL_API_URL = 'http://127.0.0.1:31013/';

    const config = loadConfig();

    assert.strictEqual(config.personalKgStorageMode, 'local');
    assert.strictEqual(config.personalKgApiUrl, 'http://127.0.0.1:31013');
  });

  it('personal KG managed cloud mode requires its explicit HTTPS URL', () => {
    process.env.BRAINBASE_PERSONAL_KG_STORAGE_MODE = 'managed_cloud';
    process.env.BRAINBASE_PERSONAL_KG_MANAGED_CLOUD_API_URL = 'https://bb.unson.jp/';

    const config = loadConfig();

    assert.strictEqual(config.personalKgStorageMode, 'managed_cloud');
    assert.strictEqual(config.personalKgApiUrl, 'https://bb.unson.jp');
  });

  it('personal KG mode without its matching URL fails closed', () => {
    process.env.BRAINBASE_PERSONAL_KG_STORAGE_MODE = 'local';

    assert.throws(
      () => loadConfig(),
      /BRAINBASE_PERSONAL_KG_LOCAL_API_URL must be set/,
    );
  });
});
