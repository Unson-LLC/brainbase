import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalTaskBackendIdentityHash,
  canonicalTaskStoreManifestJson,
  createCanonicalTaskStoreConfig,
  resolveCanonicalTaskBackend,
} from '../src/canonical-task-store-config.js';

function manifestFile(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'canonical-task-store-'));
  const path = join(directory, 'manifest.json');
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

describe('Canonical Task store config', () => {
  it('binds readiness identity to a committed, frozen manifest', () => {
    const path = manifestFile({
      store: 'oss-brainbase',
      schema_version: '1.0.0',
      source: 'canonical-task',
    });
    const config = createCanonicalTaskStoreConfig({
      manifestPath: path,
      requiredKeys: ['store', 'source'],
      expectedIdentity: { store: 'oss-brainbase' },
      env: {},
    });

    expect(config.schemaVersion).toBe('1.0.0');
    expect(config.manifest).toEqual({ schema_version: '1.0.0', source: 'canonical-task', store: 'oss-brainbase' });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.manifest)).toBe(true);
    expect(config.identityHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(canonicalTaskStoreManifestJson({ b: '2', a: '1' })).toBe('{"a":"1","b":"2"}');
    expect(canonicalTaskBackendIdentityHash(config, 'postgres')).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects identity overrides, missing keys, and non-string manifest values', () => {
    const path = manifestFile({ schema_version: '1.0.0', store: 'oss-brainbase', revision: 1 });
    expect(() => createCanonicalTaskStoreConfig({ manifestPath: path })).toThrow(/revision/u);

    const valid = manifestFile({ schema_version: '1.0.0', store: 'oss-brainbase' });
    expect(() => createCanonicalTaskStoreConfig({
      manifestPath: valid,
      expectedIdentity: { store: 'other-store' },
    })).toThrow(/fixed canonical identity/u);
    expect(() => createCanonicalTaskStoreConfig({
      manifestPath: valid,
      forbiddenEnvOverrides: ['CANONICAL_TASK_STORE'],
      env: { CANONICAL_TASK_STORE: 'override' },
    })).toThrow(/overrides are forbidden/u);
  });

  it('only resolves the explicitly supported backend values', () => {
    expect(resolveCanonicalTaskBackend()).toBe('disabled');
    expect(resolveCanonicalTaskBackend('postgres')).toBe('postgres');
    expect(resolveCanonicalTaskBackend('disabled')).toBe('disabled');
    expect(() => resolveCanonicalTaskBackend('memory')).toThrow(/disabled or postgres/u);
  });
});
