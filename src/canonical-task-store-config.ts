import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Manifest = Record<string, string>;

export interface CanonicalTaskStoreConfig {
  schemaVersion: string;
  /** The committed manifest, frozen. Tenant-specific keys stay as the tenant named them. */
  manifest: Readonly<Manifest>;
  identityHash: string;
  manifestPath: string;
}

export interface CanonicalTaskStoreConfigOptions {
  /** The tenant's committed store manifest (JSON object of non-empty strings). */
  manifestPath: string;
  /** Keys the tenant requires. `schema_version` is always required. */
  requiredKeys?: string[];
  /** Values the manifest must keep. A tenant pins its store identity here. */
  expectedIdentity?: Record<string, string>;
  /** Environment variables that must not be set, so the identity cannot be overridden at runtime. */
  forbiddenEnvOverrides?: string[];
  env?: Record<string, string | undefined>;
}

export function canonicalTaskStoreManifestJson(manifest: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.keys(manifest).sort().map((key) => [key, manifest[key]])));
}

/**
 * Loads the store manifest that names one Canonical Task store. Its hash
 * binds persisted readiness to this exact store identity.
 */
export function createCanonicalTaskStoreConfig({
  manifestPath,
  requiredKeys = [],
  expectedIdentity = {},
  forbiddenEnvOverrides = [],
  env = process.env,
}: CanonicalTaskStoreConfigOptions): CanonicalTaskStoreConfig {
  if (typeof manifestPath !== 'string' || !manifestPath) throw new Error('Canonical Task store manifest path is required');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Canonical Task store manifest must be a JSON object');
  }
  for (const [key, value] of Object.entries(manifest)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Canonical Task store manifest value ${key} must be a non-empty string`);
    }
  }
  for (const key of new Set(['schema_version', ...requiredKeys])) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) {
      throw new Error(`Canonical Task store manifest requires ${key}`);
    }
  }
  for (const [key, expected] of Object.entries(expectedIdentity)) {
    if (manifest[key] !== expected) {
      throw new Error(`Canonical Task manifest ${key} does not match the fixed canonical identity`);
    }
  }
  if (forbiddenEnvOverrides.some((key) => env[key] !== undefined)) {
    throw new Error('Canonical Task identity overrides are forbidden; use the committed manifest');
  }
  return Object.freeze({
    schemaVersion: manifest.schema_version,
    manifest: Object.freeze({ ...manifest }),
    identityHash: createHash('sha256').update(canonicalTaskStoreManifestJson(manifest)).digest('hex'),
    manifestPath: resolve(manifestPath),
  });
}

export type CanonicalTaskBackend = 'disabled' | 'postgres';

export function resolveCanonicalTaskBackend(value: unknown = process.env.CANONICAL_TASK_BACKEND): CanonicalTaskBackend {
  const backend = typeof value === 'string' && value.trim() ? value.trim() : 'disabled';
  if (backend !== 'disabled' && backend !== 'postgres') {
    throw new Error('CANONICAL_TASK_BACKEND must be disabled or postgres');
  }
  return backend;
}

export function canonicalTaskBackendIdentityHash(
  storeConfig: { identityHash: string },
  backend: unknown = resolveCanonicalTaskBackend(),
): string {
  const resolved = resolveCanonicalTaskBackend(backend);
  return createHash('sha256').update(`${storeConfig.identityHash}:backend:${resolved}`).digest('hex');
}
