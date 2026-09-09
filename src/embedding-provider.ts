import { createHash } from 'node:crypto';

/**
 * A provider is deliberately small so the retrieval layer does not need to
 * know whether embeddings are produced by a local service or a hosted one.
 * Brainbase does not bundle a model; the HTTP adapter below is opt-in.
 */
export interface EmbeddingProvider {
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
}

export type EmbeddingFetchResponse = {
  readonly status: number;
  readonly ok?: boolean;
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
};

export type EmbeddingFetch = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    redirect: 'error';
    signal: AbortSignal;
  }
) => Promise<EmbeddingFetchResponse>;

export interface HttpEmbeddingProviderConfig {
  /** Full OpenAI-compatible /embeddings endpoint. */
  url: string;
  model: string;
  apiKey?: string;
  /** Test injection point. The default is the host's global fetch. */
  fetch?: EmbeddingFetch;
  /** Alias accepted for callers that avoid shadowing the global fetch name. */
  fetchImpl?: EmbeddingFetch;
  timeoutMs?: number;
  cacheSize?: number;
}

export const EMBEDDING_MAX_INPUTS = 64;
/** Maximum number of texts accepted by one embed() call across all batches. */
export const EMBEDDING_MAX_TOTAL_INPUTS = 2_048;
export const EMBEDDING_MAX_TEXT_LENGTH = 16_000;
export const EMBEDDING_MAX_BATCH_BYTES = 1_000_000;
export const EMBEDDING_MAX_RESPONSE_BYTES = 4_000_000;
export const EMBEDDING_DEFAULT_TIMEOUT_MS = 10_000;
export const EMBEDDING_DEFAULT_CACHE_SIZE = EMBEDDING_MAX_TOTAL_INPUTS;

const MAX_URL_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 256;
const MAX_API_KEY_LENGTH = 4_096;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export class EmbeddingProviderConfigError extends Error {
  readonly code = 'embedding_config_invalid';

  constructor(message: string) {
    super(`${'embedding_config_invalid'}: ${message}`);
    this.name = 'EmbeddingProviderConfigError';
  }
}

export class EmbeddingProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'EmbeddingProviderError';
    this.code = code;
  }
}

/**
 * Build an opt-in provider from environment variables.
 *
 * With no embedding variables configured this returns undefined and performs
 * no network setup. A partial or invalid configuration throws instead of
 * silently falling back to lexical search or another provider.
 */
export function createEmbeddingProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): EmbeddingProvider | undefined {
  const rawUrl = env.BRAINBASE_EMBEDDING_URL;
  const rawModel = env.BRAINBASE_EMBEDDING_MODEL;
  const rawApiKey = env.BRAINBASE_EMBEDDING_API_KEY;
  const configured = rawUrl !== undefined || rawModel !== undefined || rawApiKey !== undefined;
  if (!configured) return undefined;

  const url = requireString(rawUrl, 'BRAINBASE_EMBEDDING_URL');
  const model = requireString(rawModel, 'BRAINBASE_EMBEDDING_MODEL');
  const apiKey = rawApiKey === undefined || (typeof rawApiKey === 'string' && rawApiKey.trim() === '')
    ? undefined
    : validateApiKey(rawApiKey);
  return createHttpEmbeddingProvider({ url, model, ...(apiKey === undefined ? {} : { apiKey }) });
}

/** Create the HTTP adapter. No request is made until embed() is called. */
export function createHttpEmbeddingProvider(config: HttpEmbeddingProviderConfig): EmbeddingProvider {
  const endpoint = validateEndpoint(config.url);
  const model = validateModel(config.model);
  const apiKey = validateApiKey(config.apiKey);
  const fetchImpl = config.fetch ?? config.fetchImpl ?? defaultFetch;
  const timeoutMs = validatePositiveInteger(config.timeoutMs ?? EMBEDDING_DEFAULT_TIMEOUT_MS, 'timeoutMs', 60_000);
  const cacheSize = validatePositiveInteger(config.cacheSize ?? EMBEDDING_DEFAULT_CACHE_SIZE, 'cacheSize', EMBEDDING_MAX_TOTAL_INPUTS);
  const configFingerprint = sha256(`${endpoint.href}\u0000${model}`);
  const cache = new LruEmbeddingCache(cacheSize);

  return {
    id: `http-embedding:${configFingerprint.slice(0, 16)}`,
    async embed(texts: string[]): Promise<number[][]> {
      validateInputs(texts, model);
      if (texts.length === 0) return [];

      const results: Array<number[] | undefined> = new Array(texts.length);
      const misses = new Map<string, { text: string; indexes: number[] }>();
      for (const [index, text] of texts.entries()) {
        const key = cacheKey(configFingerprint, text);
        const cached = cache.get(key);
        if (cached !== undefined) {
          results[index] = cached;
          continue;
        }
        const existing = misses.get(key);
        if (existing) existing.indexes.push(index);
        else misses.set(key, { text, indexes: [index] });
      }

      if (misses.size > 0) {
        const missing = [...misses.values()];
        const deadline = createDeadline(timeoutMs);
        try {
          let offset = 0;
          for (const batch of splitBatches(missing.map((entry) => entry.text), model)) {
            const vectors = await requestEmbeddings({ endpoint, model, apiKey, fetchImpl }, batch, deadline);
            for (const [batchIndex, vector] of vectors.entries()) {
              const entry = missing[offset + batchIndex]!;
              const key = cacheKey(configFingerprint, entry.text);
              cache.set(key, vector);
              for (const index of entry.indexes) results[index] = [...vector];
            }
            offset += batch.length;
          }
        } finally {
          deadline.controller.abort();
        }
      }

      return results.map((vector, index) => {
        if (vector === undefined) throw new EmbeddingProviderError('embedding_response_invalid', `missing vector at input index ${index}`);
        return [...vector];
      });
    }
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EmbeddingProviderConfigError(`${name} must be set when embedding is configured`);
  }
  return value.trim();
}

function validateEndpoint(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_URL_LENGTH) {
    throw new EmbeddingProviderConfigError('BRAINBASE_EMBEDDING_URL must be a valid full embeddings endpoint');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw.trim());
  } catch {
    throw new EmbeddingProviderConfigError('BRAINBASE_EMBEDDING_URL must be a valid full embeddings endpoint');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new EmbeddingProviderConfigError('BRAINBASE_EMBEDDING_URL must not contain credentials, query parameters, or a fragment');
  }
  const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new EmbeddingProviderConfigError('BRAINBASE_EMBEDDING_URL must use HTTPS; HTTP is allowed only for loopback services');
  }
  if (!/(?:^|\/)embeddings\/?$/u.test(endpoint.pathname)) {
    throw new EmbeddingProviderConfigError('BRAINBASE_EMBEDDING_URL must point to an /embeddings endpoint');
  }
  return endpoint;
}

function validateModel(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_MODEL_LENGTH || CONTROL_CHARACTER.test(raw)) {
    throw new EmbeddingProviderConfigError('BRAINBASE_EMBEDDING_MODEL must be a valid non-empty model name');
  }
  return raw.trim();
}

function validateApiKey(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length > MAX_API_KEY_LENGTH || CONTROL_CHARACTER.test(raw)) {
    throw new EmbeddingProviderConfigError('BRAINBASE_EMBEDDING_API_KEY is invalid');
  }
  if (raw.trim() === '') return undefined;
  return raw;
}

function validatePositiveInteger(value: unknown, name: string, max: number): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new EmbeddingProviderConfigError(`${name} must be an integer between 1 and ${max}`);
  }
  return value as number;
}

function validateInputs(texts: string[], model: string): void {
  if (!Array.isArray(texts)) throw new EmbeddingProviderError('embedding_input_invalid', 'texts must be an array');
  if (texts.length > EMBEDDING_MAX_TOTAL_INPUTS) {
    throw new EmbeddingProviderError('embedding_input_invalid', `at most ${EMBEDDING_MAX_TOTAL_INPUTS} texts may be embedded per request`);
  }
  for (const text of texts) {
    if (typeof text !== 'string') throw new EmbeddingProviderError('embedding_input_invalid', 'each text must be a string');
    if (text.length > EMBEDDING_MAX_TEXT_LENGTH) {
      throw new EmbeddingProviderError('embedding_input_invalid', `each text may contain at most ${EMBEDDING_MAX_TEXT_LENGTH} characters`);
    }
  }
  if (Buffer.byteLength(JSON.stringify({ input: ['x'.repeat(0)], model }), 'utf8') > EMBEDDING_MAX_BATCH_BYTES) {
    throw new EmbeddingProviderError('embedding_input_invalid', 'embedding model metadata exceeds the batch byte limit');
  }
}

async function requestEmbeddings(
  config: { endpoint: URL; model: string; apiKey?: string; fetchImpl: EmbeddingFetch },
  texts: string[],
  deadline: EmbeddingDeadline
): Promise<number[][]> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (config.apiKey !== undefined) headers.authorization = `Bearer ${config.apiKey}`;
  const body = JSON.stringify({ input: texts, model: config.model });
  let response: EmbeddingFetchResponse;
  try {
    response = await withDeadline(config.fetchImpl(config.endpoint.href, {
      method: 'POST', headers, body, redirect: 'error', signal: deadline.controller.signal
    }), deadline);
  } catch (error) {
    if (error instanceof EmbeddingProviderError) throw error;
    throw new EmbeddingProviderError('embedding_request_failed', 'embedding service request failed');
  }

  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    throw new EmbeddingProviderError('embedding_request_failed', `embedding service returned HTTP ${Number.isInteger(response.status) ? response.status : 'an invalid status'}`);
  }
  let raw: string;
  try {
    raw = await withDeadline(readResponseText(response), deadline);
  } catch (error) {
    if (error instanceof EmbeddingProviderError) throw error;
    throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service response could not be read');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service returned invalid JSON');
  }
  return validateEmbeddingResponse(parsed, texts.length);
}

interface EmbeddingDeadline {
  controller: AbortController;
  expiresAt: number;
  timeoutMs: number;
}

function createDeadline(timeoutMs: number): EmbeddingDeadline {
  return { controller: new AbortController(), expiresAt: Date.now() + timeoutMs, timeoutMs };
}

async function withDeadline<T>(operation: Promise<T>, deadline: EmbeddingDeadline): Promise<T> {
  const remaining = deadline.expiresAt - Date.now();
  if (remaining <= 0) {
    deadline.controller.abort();
    throw new EmbeddingProviderError('embedding_request_timeout', `embedding service timed out after ${deadline.timeoutMs}ms`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      deadline.controller.abort();
      reject(new EmbeddingProviderError('embedding_request_timeout', `embedding service timed out after ${deadline.timeoutMs}ms`));
    }, remaining);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function splitBatches(texts: string[], model: string): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  for (const text of texts) {
    const candidate = [...current, text];
    const bytes = Buffer.byteLength(JSON.stringify({ input: candidate, model }), 'utf8');
    if (current.length > 0 && (candidate.length > EMBEDDING_MAX_INPUTS || bytes > EMBEDDING_MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [text];
      if (Buffer.byteLength(JSON.stringify({ input: current, model }), 'utf8') > EMBEDDING_MAX_BATCH_BYTES) {
        throw new EmbeddingProviderError('embedding_input_invalid', `embedding batch exceeds ${EMBEDDING_MAX_BATCH_BYTES} bytes`);
      }
    } else if (candidate.length > EMBEDDING_MAX_INPUTS || bytes > EMBEDDING_MAX_BATCH_BYTES) {
      throw new EmbeddingProviderError('embedding_input_invalid', `embedding batch exceeds ${EMBEDDING_MAX_BATCH_BYTES} bytes`);
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function readResponseText(response: EmbeddingFetchResponse): Promise<string> {
  const contentLength = headerValue(response.headers, 'content-length');
  if (contentLength !== undefined) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > EMBEDDING_MAX_RESPONSE_BYTES) {
      throw new EmbeddingProviderError('embedding_response_too_large', `embedding service response exceeds ${EMBEDDING_MAX_RESPONSE_BYTES} bytes`);
    }
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    let text: string;
    if (response.text) text = await response.text();
    else if (response.json) text = JSON.stringify(await response.json());
    else throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service response could not be read');
    if (Buffer.byteLength(text, 'utf8') > EMBEDDING_MAX_RESPONSE_BYTES) {
      throw new EmbeddingProviderError('embedding_response_too_large', `embedding service response exceeds ${EMBEDDING_MAX_RESPONSE_BYTES} bytes`);
    }
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (!value) continue;
      total += value.byteLength;
      if (total > EMBEDDING_MAX_RESPONSE_BYTES) {
        await reader.cancel?.('response too large');
        throw new EmbeddingProviderError('embedding_response_too_large', `embedding service response exceeds ${EMBEDDING_MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof EmbeddingProviderError) throw error;
    throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service response could not be read');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function headerValue(headers: EmbeddingFetchResponse['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  if (headers instanceof Map) return headers.get(name) ?? headers.get(name.toLowerCase());
  const record = headers as Record<string, string | undefined>;
  return record[name] ?? record[name.toLowerCase()];
}

function validateEmbeddingResponse(value: unknown, count: number): number[][] {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length !== count) {
    throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service returned the wrong number of vectors');
  }
  const ordered: Array<number[] | undefined> = new Array(count);
  for (const item of value.data) {
    if (!isRecord(item) || !Number.isInteger(item.index) || item.index < 0 || item.index >= count || ordered[item.index] !== undefined) {
      throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service returned invalid vector indexes');
    }
    if (!Array.isArray(item.embedding) || item.embedding.length === 0 || item.embedding.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
      throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service returned an invalid vector');
    }
    if (item.embedding.every((entry) => entry === 0)) {
      throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service returned a zero vector');
    }
    ordered[item.index] = [...item.embedding];
  }
  if (ordered.some((vector) => vector === undefined)) {
    throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service omitted a vector index');
  }
  const dimension = ordered[0]!.length;
  if (ordered.some((vector) => vector!.length !== dimension)) {
    throw new EmbeddingProviderError('embedding_response_invalid', 'embedding service returned vectors with different dimensions');
  }
  return ordered as number[][];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function cacheKey(configFingerprint: string, text: string): string {
  return sha256(`${configFingerprint}\u0000${text}`);
}

class LruEmbeddingCache {
  private readonly values = new Map<string, number[]>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): number[] | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return [...value];
  }

  set(key: string, vector: number[]): void {
    this.values.delete(key);
    this.values.set(key, [...vector]);
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
}

async function defaultFetch(input: string, init: Parameters<EmbeddingFetch>[1]): Promise<EmbeddingFetchResponse> {
  return fetch(input, init as RequestInit) as unknown as EmbeddingFetchResponse;
}
