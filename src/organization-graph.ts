import { portableGraphDigest, validatePortableGraph, type PortableGraphBundle } from './portable-graph.js';
import type { GraphRetrievalInput, GraphRetrievalResponse } from './graph-retrieval.js';

/** The organization adapter is opt-in and never falls back after configuration. */
export const ORGANIZATION_GRAPH_DEFAULT_TIMEOUT_MS = 10_000;
export const ORGANIZATION_GRAPH_MAX_RESPONSE_BYTES = 9_000_000;

const MAX_URL_LENGTH = 2_048;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_PROJECT_CODE_LENGTH = 256;
const MAX_GRAPH_ID_LENGTH = 128;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export interface OrganizationGraphConfig {
  /** Organization service base URL, without credentials or query parameters. */
  readonly url: string;
  /** Bearer token. Never include this value in a returned error or receipt. */
  readonly token: string;
  readonly projectCode: string;
  readonly graphId: string;
  readonly fetch?: OrganizationGraphFetch;
  readonly timeoutMs?: number;
}

export interface OrganizationGraphFetchResponse {
  readonly status: number;
  readonly headers?: {
    get(name: string): string | null;
  } | Map<string, string> | Record<string, string | undefined>;
  readonly body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel?(reason?: unknown): Promise<void>;
    };
  } | null;
  text?(): Promise<string>;
  json?(): Promise<unknown>;
}

export type OrganizationGraphFetch = (
  input: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
    redirect: 'error';
    signal: AbortSignal;
  }
) => Promise<OrganizationGraphFetchResponse>;

export interface PortableGraphReadback {
  readonly bundle: unknown;
  readonly digest: string;
}

export interface PortableGraphImportResult {
  readonly status: 'imported' | 'unchanged';
  readonly digest: string;
}

export class OrganizationGraphConfigError extends Error {
  readonly code = 'organization_config_invalid';

  constructor(message: string) {
    super(`${'organization_config_invalid'}: ${message}`);
    this.name = 'OrganizationGraphConfigError';
  }
}

export class OrganizationGraphError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'OrganizationGraphError';
    this.code = code;
  }
}

/**
 * Read the four organization settings as one all-or-nothing configuration.
 * With no settings, OSS keeps its existing local-first behavior. A partial
 * configuration is an error so a typo cannot silently select another store.
 */
export function createOrganizationGraphConfig(
  env: Record<string, string | undefined> = process.env
): OrganizationGraphConfig | undefined {
  const rawUrl = env.BRAINBASE_ORGANIZATION_URL;
  const rawToken = env.BRAINBASE_ORGANIZATION_TOKEN;
  const rawProjectCode = env.BRAINBASE_ORGANIZATION_PROJECT;
  const rawGraphId = env.BRAINBASE_ORGANIZATION_GRAPH_ID;
  const configured = [rawUrl, rawToken, rawProjectCode, rawGraphId].some((value) => value !== undefined);
  if (!configured) return undefined;

  const missing = [
    ['BRAINBASE_ORGANIZATION_URL', rawUrl],
    ['BRAINBASE_ORGANIZATION_TOKEN', rawToken],
    ['BRAINBASE_ORGANIZATION_PROJECT', rawProjectCode],
    ['BRAINBASE_ORGANIZATION_GRAPH_ID', rawGraphId]
  ].filter(([, value]) => typeof value !== 'string' || value.trim() === '').map(([name]) => name);
  if (missing.length > 0) {
    throw new OrganizationGraphConfigError(`all organization settings must be set together; missing ${missing.join(', ')}`);
  }

  return {
    url: validateOrganizationUrl(rawUrl!),
    token: validateToken(rawToken!),
    projectCode: validateProjectCode(rawProjectCode!),
    graphId: validateGraphId(rawGraphId!)
  };
}

/** Create a client without making a network request. */
export function createOrganizationGraphClient(config: OrganizationGraphConfig): OrganizationGraphClient {
  // Validate injected configurations as well as environment-derived ones.
  const normalized: OrganizationGraphConfig = {
    ...config,
    url: validateOrganizationUrl(config.url),
    token: validateToken(config.token),
    projectCode: validateProjectCode(config.projectCode),
    graphId: validateGraphId(config.graphId)
  };

  return {
    search: (input) => searchOrganizationGraph(normalized, input),
    importPortableGraph: (bundle) => importPortableGraph(normalized, bundle),
    readPortableGraph: () => readPortableGraph(normalized)
  };
}

export interface OrganizationGraphClient {
  search(input: GraphRetrievalInput): Promise<GraphRetrievalResponse>;
  importPortableGraph(bundle: unknown): Promise<PortableGraphImportResult>;
  readPortableGraph(): Promise<PortableGraphReadback>;
}

/** Forward the existing Graph retrieval input unchanged inside the request envelope. */
export async function searchOrganizationGraph(
  config: OrganizationGraphConfig,
  input: GraphRetrievalInput
): Promise<GraphRetrievalResponse> {
  const payload = await requestJson(config, 'POST', route(config, 'search'), {
    project_code: config.projectCode,
    input
  });
  return parseGraphRetrievalResponse(payload);
}

/** Import is explicit; merely configuring the remote backend never uploads data. */
export async function importPortableGraph(
  config: OrganizationGraphConfig,
  bundle: unknown
): Promise<PortableGraphImportResult> {
  assertPortableGraphBundle(bundle);
  const expectedDigest = await portableGraphDigest(bundle);
  const payload = await requestJson(config, 'POST', route(config, 'import'), {
    project_code: config.projectCode,
    bundle
  });
  const result = parseImportResult(payload);
  if (result.digest !== expectedDigest) {
    throw new OrganizationGraphError('organization_graph_digest_mismatch', 'organization service returned an import digest that does not match the uploaded bundle');
  }
  return result;
}

/** Read and verify the complete organization-side bundle and its digest. */
export async function readPortableGraph(
  config: OrganizationGraphConfig
): Promise<PortableGraphReadback> {
  const payload = await requestJson(config, 'GET', route(config, undefined, { project_code: config.projectCode }));
  const readback = parsePortableGraphReadback(payload);
  assertPortableGraphBundle(readback.bundle);
  const computedDigest = await portableGraphDigest(readback.bundle);
  if (computedDigest !== readback.digest) {
    throw new OrganizationGraphError('organization_graph_readback_mismatch', 'organization service returned a bundle whose digest does not match its contents');
  }
  return readback;
}

/** Validate the privacy boundary before any upload leaves the local process. */
export function assertPortableGraphBundle(bundle: unknown): asserts bundle is PortableGraphBundle {
  validatePortableGraph(bundle);
}

function parseGraphRetrievalResponse(value: unknown): GraphRetrievalResponse {
  if (!isRecord(value)
    || (value.graphVersion !== 1 && value.graphVersion !== 2)
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    || (value.status !== 'ok' && value.status !== 'migration_required')
    || typeof value.migrationRequired !== 'boolean'
    || value.authority !== 'organization_graph'
    || typeof value.query !== 'string'
    || typeof value.asOf !== 'string'
    || !['semantic', 'lexical', 'seed'].includes(String(value.method))
    || !isRecord(value.semantic)
    || typeof value.semantic.available !== 'boolean'
    || !['semantic', 'lexical', 'seed'].includes(String(value.semantic.method))
    || !Array.isArray(value.candidates)
    || !Array.isArray(value.results)
    || !Array.isArray(value.observedRelations)
    || !Array.isArray(value.observedRelationCatalog)
    || !isRecord(value.traversal)
    || !Array.isArray(value.traversal.seedIds)
    || !Array.isArray(value.traversal.steps)
    || !Number.isInteger(value.traversal.maxSeeds)
    || !Number.isInteger(value.traversal.maxSteps)
    || !Number.isInteger(value.traversal.maxLimit)
    || !['complete', 'partial', 'unknown'].includes(String(value.coverage))
    || !Array.isArray(value.partialReasons)
    || !Array.isArray(value.missingEvidence)
    || !Array.isArray(value.evidence)
    || !['needs_model_verification', 'insufficient'].includes(String(value.sufficiency))
    || value.absenceConfirmed !== false) {
    throw new OrganizationGraphError('organization_graph_response_invalid', 'organization service returned a response outside the OSS GraphRetrievalResponse contract');
  }
  return value as unknown as GraphRetrievalResponse;
}

function parseImportResult(value: unknown): PortableGraphImportResult {
  if (!isRecord(value)
    || (value.status !== 'imported' && value.status !== 'unchanged')
    || typeof value.digest !== 'string'
    || value.digest.trim() === '') {
    throw new OrganizationGraphError('organization_graph_response_invalid', 'organization service returned an invalid import response');
  }
  return { status: value.status, digest: value.digest };
}

function parsePortableGraphReadback(value: unknown): PortableGraphReadback {
  if (!isRecord(value) || !('bundle' in value) || typeof value.digest !== 'string' || value.digest.trim() === '') {
    throw new OrganizationGraphError('organization_graph_response_invalid', 'organization service returned an invalid Graph readback');
  }
  return { bundle: value.bundle, digest: value.digest };
}

async function requestJson(
  config: OrganizationGraphConfig,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown
): Promise<unknown> {
  const fetchImpl = config.fetch ?? defaultFetch;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutMs = validateTimeout(config.timeoutMs ?? ORGANIZATION_GRAPH_DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') timer.unref();
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${config.token}`
  };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: OrganizationGraphFetchResponse;
  try {
    response = await withTimeout(fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: controller.signal
    }), controller, timeoutMs);
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof OrganizationGraphError) throw error;
    if (controller.signal.aborted) {
      throw new OrganizationGraphError('organization_graph_timeout', `organization service did not respond within ${timeoutMs}ms`);
    }
    throw new OrganizationGraphError('organization_graph_unavailable', 'organization service request failed');
  }
  clearTimeout(timer);

  if (!Number.isInteger(response.status)) {
    throw new OrganizationGraphError('organization_graph_unavailable', 'organization service returned an invalid HTTP status');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new OrganizationGraphError('organization_graph_redirect_rejected', 'organization service redirects are not accepted');
  }
  if (response.status === 401 || response.status === 403) {
    throw new OrganizationGraphError('organization_graph_unauthorized', 'organization service rejected the configured credentials');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new OrganizationGraphError('organization_graph_request_failed', `organization service returned HTTP ${response.status}`);
  }

  let raw: string;
  try {
    raw = await withTimeout(readResponseText(response, controller, timeoutMs), controller, Math.max(1, timeoutMs - (Date.now() - startedAt)));
  } catch (error) {
    if (error instanceof OrganizationGraphError) throw error;
    throw new OrganizationGraphError('organization_graph_response_invalid', 'organization service response could not be read');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new OrganizationGraphError('organization_graph_response_invalid', 'organization service returned invalid JSON');
  }
}

async function readResponseText(
  response: OrganizationGraphFetchResponse,
  controller: AbortController,
  timeoutMs: number
): Promise<string> {
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const part = await withTimeout(reader.read(), controller, timeoutMs);
      if (part.done) break;
      const chunk = Buffer.from(part.value ?? new Uint8Array());
      bytes += chunk.byteLength;
      if (bytes > ORGANIZATION_GRAPH_MAX_RESPONSE_BYTES) {
        await reader.cancel?.('response too large');
        throw new OrganizationGraphError('organization_graph_response_too_large', 'organization service response exceeds the maximum size');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (response.text) {
    const raw = await withTimeout(response.text(), controller, timeoutMs);
    if (Buffer.byteLength(raw, 'utf8') > ORGANIZATION_GRAPH_MAX_RESPONSE_BYTES) {
      throw new OrganizationGraphError('organization_graph_response_too_large', 'organization service response exceeds the maximum size');
    }
    return raw;
  }
  if (response.json) {
    const value = await withTimeout(response.json(), controller, timeoutMs);
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw, 'utf8') > ORGANIZATION_GRAPH_MAX_RESPONSE_BYTES) {
      throw new OrganizationGraphError('organization_graph_response_too_large', 'organization service response exceeds the maximum size');
    }
    return raw;
  }
  throw new OrganizationGraphError('organization_graph_response_invalid', 'organization service response has no readable body');
}

async function withTimeout<T>(operation: Promise<T>, controller: AbortController, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OrganizationGraphError('organization_graph_timeout', `organization service did not respond within ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function route(
  config: OrganizationGraphConfig,
  suffix: 'search' | 'import' | undefined,
  query?: Record<string, string>
): string {
  const base = new URL(config.url);
  const prefix = base.pathname.replace(/\/+$/u, '');
  const routePath = `${prefix}/api/info/graph/portable/${encodeURIComponent(config.graphId)}${suffix ? `/${suffix}` : ''}`;
  const endpoint = new URL(routePath || '/', base.origin);
  for (const [key, value] of Object.entries(query ?? {})) endpoint.searchParams.set(key, value);
  return endpoint.href;
}

function validateOrganizationUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_URL_LENGTH) {
    throw new OrganizationGraphConfigError('BRAINBASE_ORGANIZATION_URL must be a valid base URL');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw.trim());
  } catch {
    throw new OrganizationGraphConfigError('BRAINBASE_ORGANIZATION_URL must be a valid base URL');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new OrganizationGraphConfigError('BRAINBASE_ORGANIZATION_URL must not contain credentials, query parameters, or a fragment');
  }
  const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new OrganizationGraphConfigError('BRAINBASE_ORGANIZATION_URL must use HTTPS; HTTP is allowed only for loopback services');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/u, '') || '/';
  return endpoint.href;
}

function validateToken(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_TOKEN_LENGTH || CONTROL_CHARACTER.test(raw)) {
    throw new OrganizationGraphConfigError('BRAINBASE_ORGANIZATION_TOKEN is invalid');
  }
  return raw;
}

function validateProjectCode(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_PROJECT_CODE_LENGTH || CONTROL_CHARACTER.test(raw)) {
    throw new OrganizationGraphConfigError('BRAINBASE_ORGANIZATION_PROJECT is invalid');
  }
  return raw.trim();
}

function validateGraphId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_GRAPH_ID_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(raw)) {
    throw new OrganizationGraphConfigError('BRAINBASE_ORGANIZATION_GRAPH_ID must be an opaque path-safe ID');
  }
  return raw;
}

function validateTimeout(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 60_000) {
    throw new OrganizationGraphConfigError('organization graph timeout must be an integer between 1 and 60000 milliseconds');
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function defaultFetch(
  input: string,
  init: Parameters<typeof fetch>[1]
): Promise<Response> {
  return fetch(input, init);
}
