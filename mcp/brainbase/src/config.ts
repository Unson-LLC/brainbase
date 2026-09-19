/**
 * Configuration Loader
 * Loads environment variables for brainbase MCP
 */

const DEFAULT_GRAPH_API_URL = 'https://bb.unson.jp';

export type PersonalKgStorageMode = 'local' | 'managed_cloud';

const LOCAL_PERSONAL_KG_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveBrainbaseApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.BRAINBASE_RESOLVED_API_URL
    || env.BRAINBASE_GRAPH_API_URL
    || env.BRAINBASE_API_URL
    || env.BRAINBASE_API_BASE_URL
    || DEFAULT_GRAPH_API_URL
  ).trim().replace(/\/+$/, '');
}

/**
 * Normalize and constrain the endpoint selected for the canonical Personal
 * Vault API. The storage mode is part of the endpoint contract: a local
 * endpoint must be loopback, while a managed cloud endpoint must be HTTPS.
 */
export function normalizePersonalKgApiUrl(value: string, mode: PersonalKgStorageMode): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Personal KG API URL is required for the selected storage mode.');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Personal KG API URL must be an absolute URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Personal KG API URL must use http or https.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Personal KG API URL must not contain credentials, query, or hash components.');
  }
  if (mode === 'managed_cloud' && url.protocol !== 'https:') {
    throw new Error('managed_cloud Personal KG API URL must use HTTPS.');
  }
  if (mode === 'managed_cloud' && LOCAL_PERSONAL_KG_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('managed_cloud Personal KG API URL must not use a loopback host.');
  }
  if (mode === 'local' && !LOCAL_PERSONAL_KG_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('local Personal KG API URL must use a loopback host.');
  }

  return url.toString().replace(/\/+$/, '');
}

export function resolvePersonalKgStorageMode(
  env: NodeJS.ProcessEnv = process.env,
): PersonalKgStorageMode | undefined {
  const value = env.BRAINBASE_PERSONAL_KG_STORAGE_MODE?.trim().toLowerCase();
  if (!value) return undefined;
  if (value !== 'local' && value !== 'managed_cloud') {
    throw new Error('BRAINBASE_PERSONAL_KG_STORAGE_MODE must be local or managed_cloud.');
  }
  return value;
}

export function resolvePersonalKgApiUrl(
  mode: PersonalKgStorageMode,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = mode === 'local'
    ? 'BRAINBASE_PERSONAL_KG_LOCAL_API_URL'
    : 'BRAINBASE_PERSONAL_KG_MANAGED_CLOUD_API_URL';
  const value = env[variable];
  if (!value?.trim()) {
    throw new Error(`${variable} must be set when BRAINBASE_PERSONAL_KG_STORAGE_MODE=${mode}.`);
  }
  return normalizePersonalKgApiUrl(value, mode);
}

export type EntitySourceMode = 'graphapi';

export interface BrainbaseConfig {
  /**
   * Entity source mode (graphapi only)
   */
  sourceMode: EntitySourceMode;

  /**
   * Graph SSOT API URL
   */
  graphApiUrl: string;

  /**
   * Project codes to filter (comma-separated)
   */
  projectCodes?: string[];

  /**
   * Explicit canonical Personal Vault storage mode. When omitted, the
   * legacy personal search route remains available for compatibility.
   */
  personalKgStorageMode?: PersonalKgStorageMode;

  /**
   * Endpoint for the explicitly selected Personal Vault storage mode.
   */
  personalKgApiUrl?: string;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): BrainbaseConfig {
  const requestedSourceMode = (process.env.BRAINBASE_ENTITY_SOURCE || 'graphapi').trim().toLowerCase();
  const graphApiUrl = resolveBrainbaseApiUrl();
  const projectCodesStr = process.env.BRAINBASE_PROJECT_CODES;
  const personalKgStorageMode = resolvePersonalKgStorageMode();
  const personalKgApiUrl = personalKgStorageMode
    ? resolvePersonalKgApiUrl(personalKgStorageMode)
    : undefined;

  // Parse project codes
  const projectCodes = projectCodesStr
    ? projectCodesStr.split(',').map(code => code.trim())
    : undefined;

  if (requestedSourceMode !== 'graphapi') {
    throw new Error('BRAINBASE_ENTITY_SOURCE must be graphapi');
  }

  return {
    sourceMode: 'graphapi',
    graphApiUrl,
    projectCodes,
    personalKgStorageMode,
    personalKgApiUrl,
  };
}
