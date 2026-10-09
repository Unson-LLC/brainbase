/**
 * Gemini embedding boundary for Graph vector indexing and query retrieval.
 *
 * This is an opt-in hosted adapter. Brainbase does not bundle a model and does
 * not call this provider unless a host constructs it with an API key. The model
 * id is part of the stored index identity: vectors written under
 * GRAPH_EMBEDDING_MODEL_ID must keep the same request shape, chunking and
 * pooling, so changing any of them requires a new model id.
 */
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents';
const GEMINI_MODEL = 'models/gemini-embedding-001';

// v2 includes UTF-8 chunking and mean-pooling for the provider input limit.
export const GRAPH_EMBEDDING_MODEL_ID = 'gemini-embedding-001:768:v2';
export const GRAPH_EMBEDDING_DIMENSIONS = 768;

const MAX_BATCH_SIZE = 16;
const MAX_TEXT_LENGTH = 6_000;
// Gemini embedding-001 accepts at most 2,048 input tokens. Keep each passage
// chunk below that limit without silently relying on provider truncation. A
// UTF-8 byte boundary is conservative for the multilingual corpus we index.
const MAX_CHUNK_UTF8_BYTES = 1_800;
const MAX_REQUEST_TIMEOUT_MS = 15_000;
const MAX_QUEUE_SIZE = 16;
const MAX_CACHE_ENTRIES = 256;
const DEFAULT_CACHE_TTL_MS = 60_000;

export type GraphEmbeddingKind = 'query' | 'passage';

export type GraphEmbeddingFetchResponse = {
  readonly ok?: boolean;
  readonly status?: number;
  json(): Promise<unknown>;
};

export type GraphEmbeddingFetch = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<GraphEmbeddingFetchResponse> | GraphEmbeddingFetchResponse;

export interface GraphEmbeddingProviderOptions {
  apiKey?: string;
  fetchImpl?: GraphEmbeddingFetch;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  queryCacheTtlMs?: number;
  queryCacheMaxEntries?: number;
}

export interface GraphEmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: string[], kind: GraphEmbeddingKind): Promise<number[][]>;
}

export class GraphEmbeddingProviderError extends Error {
  readonly code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'GraphEmbeddingProviderError';
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}

function providerError(code: string, message: string, status?: number): GraphEmbeddingProviderError {
  return new GraphEmbeddingProviderError(code, message, status);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, code: string): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw providerError(code, 'Embedding provider configuration is invalid');
  }
  return Math.min(number, maximum);
}

function copyVector(values: number[]): number[] {
  return values.slice();
}

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function splitPassage(text: string): string[] {
  if (text.length === 0) return [''];

  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of text) {
    const characterBytes = utf8ByteLength(character);
    if (chunk && chunkBytes + characterBytes > MAX_CHUNK_UTF8_BYTES) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks;
}

function meanPoolVectors(vectors: number[][]): number[] {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw providerError('embedding_provider_invalid_response', 'Embedding provider returned no vectors');
  }
  const pooled: number[] = Array(GRAPH_EMBEDDING_DIMENSIONS).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < pooled.length; index += 1) pooled[index] += vector[index];
  }
  return normalizeVector(pooled.map(value => value / vectors.length));
}

function normalizeVector(values: unknown): number[] {
  if (!Array.isArray(values) || values.length !== GRAPH_EMBEDDING_DIMENSIONS) {
    throw providerError('embedding_provider_invalid_response', 'Embedding provider returned an invalid vector');
  }

  let squaredNorm = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw providerError('embedding_provider_invalid_response', 'Embedding provider returned an invalid vector');
    }
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (!Number.isFinite(norm) || norm <= 0) {
    throw providerError('embedding_provider_invalid_response', 'Embedding provider returned an invalid vector');
  }
  return (values as number[]).map(value => value / norm);
}

function parseEmbeddings(payload: unknown, expectedCount: number): number[][] {
  const embeddings = (payload as { embeddings?: unknown } | null | undefined)?.embeddings;
  if (!payload || !Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw providerError('embedding_provider_invalid_response', 'Embedding provider returned an invalid response');
  }
  return embeddings.map(embedding => normalizeVector((embedding as { values?: unknown } | null | undefined)?.values));
}

function createAbortSignal(timeoutMs: number): { signal: AbortSignal; cleanup(): void } {
  if (typeof AbortSignal?.timeout === 'function') {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      cleanup() {},
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    },
  };
}

type QueueItem<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function createBoundedQueue({ concurrency, maxQueue, timeoutMs }: { concurrency: number; maxQueue: number; timeoutMs: number }) {
  let active = 0;
  const pending: QueueItem<any>[] = [];

  function start<T>(item: QueueItem<T>): void {
    active += 1;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }

  function pump(): void {
    while (active < concurrency && pending.length > 0) {
      const item = pending.shift()!;
      clearTimeout(item.timer);
      start(item);
    }
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (active < concurrency) {
      return new Promise<T>((resolve, reject) => start({ task, resolve, reject, timer: undefined }));
    }
    if (pending.length >= maxQueue) {
      return Promise.reject(providerError('embedding_provider_queue_full', 'Embedding provider queue is full'));
    }
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = { task, resolve, reject, timer: undefined };
      item.timer = setTimeout(() => {
        const index = pending.indexOf(item);
        if (index === -1) return;
        pending.splice(index, 1);
        reject(providerError('embedding_provider_queue_timeout', 'Embedding provider queue timed out'));
      }, timeoutMs);
      item.timer.unref?.();
      pending.push(item);
    });
  }

  return { enqueue };
}

type QueryFlight = {
  promise: Promise<number[]>;
  resolve: (values: number[]) => void;
  reject: (reason: unknown) => void;
};

/**
 * Create the server-side Gemini embedding boundary used by Graph vector
 * indexing and query retrieval. The queue and cache belong to this provider
 * instance, which should be shared by the server process.
 */
export function createGraphEmbeddingProvider({
  apiKey = process.env.BRAINBASE_EMBEDDING_API_KEY,
  fetchImpl = globalThis.fetch as unknown as GraphEmbeddingFetch,
  timeoutMs = MAX_REQUEST_TIMEOUT_MS,
  queueTimeoutMs = MAX_REQUEST_TIMEOUT_MS,
  queryCacheTtlMs = DEFAULT_CACHE_TTL_MS,
  queryCacheMaxEntries = MAX_CACHE_ENTRIES,
}: GraphEmbeddingProviderOptions = {}): GraphEmbeddingProvider {
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!normalizedApiKey) {
    throw providerError('embedding_provider_api_key_missing', 'Embedding provider API key is not configured');
  }
  if (typeof fetchImpl !== 'function') {
    throw providerError('embedding_provider_fetch_unavailable', 'Embedding provider fetch is unavailable');
  }

  const requestTimeoutMs = boundedInteger(
    timeoutMs,
    MAX_REQUEST_TIMEOUT_MS,
    1,
    MAX_REQUEST_TIMEOUT_MS,
    'embedding_provider_timeout_invalid',
  );
  const queueWaitTimeoutMs = boundedInteger(
    queueTimeoutMs,
    MAX_REQUEST_TIMEOUT_MS,
    1,
    MAX_REQUEST_TIMEOUT_MS,
    'embedding_provider_queue_timeout_invalid',
  );
  const cacheTtlMs = boundedInteger(
    queryCacheTtlMs,
    DEFAULT_CACHE_TTL_MS,
    1,
    24 * 60 * 60 * 1000,
    'embedding_provider_cache_ttl_invalid',
  );
  const cacheMaxEntries = boundedInteger(
    queryCacheMaxEntries,
    MAX_CACHE_ENTRIES,
    1,
    MAX_CACHE_ENTRIES,
    'embedding_provider_cache_size_invalid',
  );

  const queue = createBoundedQueue({
    concurrency: 2,
    maxQueue: MAX_QUEUE_SIZE,
    timeoutMs: queueWaitTimeoutMs,
  });
  const queryCache = new Map<string, { values: number[]; expiresAt: number }>();
  const queryFlights = new Map<string, QueryFlight>();

  function readQueryCache(text: string): number[] | undefined {
    const entry = queryCache.get(text);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      queryCache.delete(text);
      return undefined;
    }
    // Refresh insertion order for LRU behavior.
    queryCache.delete(text);
    queryCache.set(text, entry);
    return copyVector(entry.values);
  }

  function writeQueryCache(text: string, values: number[]): void {
    queryCache.delete(text);
    queryCache.set(text, { values: copyVector(values), expiresAt: Date.now() + cacheTtlMs });
    while (queryCache.size > cacheMaxEntries) {
      queryCache.delete(queryCache.keys().next().value as string);
    }
  }

  async function requestBatch(texts: string[], kind: GraphEmbeddingKind): Promise<number[][]> {
    const signalState = createAbortSignal(requestTimeoutMs);
    let aborted = signalState.signal.aborted;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener = () => {};
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        aborted = true;
        reject(providerError('embedding_provider_timeout', 'Embedding provider request timed out'));
      }, requestTimeoutMs);
      const onAbort = () => {
        aborted = true;
        reject(providerError('embedding_provider_timeout', 'Embedding provider request timed out'));
      };
      if (signalState.signal.aborted) {
        onAbort();
        return;
      }
      signalState.signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signalState.signal.removeEventListener('abort', onAbort);
    });

    const payload = {
      requests: texts.map(text => ({
        model: GEMINI_MODEL,
        content: { parts: [{ text }] },
        taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        outputDimensionality: GRAPH_EMBEDDING_DIMENSIONS,
      })),
    };

    let response: GraphEmbeddingFetchResponse | undefined;
    try {
      response = await Promise.race([
        Promise.resolve(fetchImpl(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': normalizedApiKey,
          },
          body: JSON.stringify(payload),
          signal: signalState.signal,
        })),
        timeoutPromise,
      ]);
    } catch (error) {
      if (aborted || signalState.signal.aborted) {
        throw providerError('embedding_provider_timeout', 'Embedding provider request timed out');
      }
      if (error instanceof GraphEmbeddingProviderError) throw error;
      throw providerError('embedding_provider_request_failed', 'Embedding provider request failed');
    } finally {
      removeAbortListener();
      clearTimeout(timeoutTimer);
      signalState.cleanup();
    }

    if (!response || response.ok !== true) {
      throw providerError(
        'embedding_provider_http_error',
        `Embedding provider request failed (HTTP ${Number.isInteger(response?.status) ? response?.status : 0})`,
        Number.isInteger(response?.status) ? response?.status : undefined,
      );
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw providerError('embedding_provider_invalid_response', 'Embedding provider returned an invalid response');
    }
    return parseEmbeddings(result, texts.length);
  }

  async function embedPassages(texts: string[]): Promise<number[][]> {
    const chunks = texts.flatMap((text, textIndex) =>
      splitPassage(text).map(chunk => ({ chunk, textIndex })));
    const chunkVectors: number[][][] = texts.map(() => []);
    for (let offset = 0; offset < chunks.length; offset += MAX_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + MAX_BATCH_SIZE);
      const result = await queue.enqueue(() => requestBatch(batch.map(item => item.chunk), 'passage'));
      result.forEach((values, index) => {
        chunkVectors[batch[index].textIndex].push(values);
      });
    }
    return chunkVectors.map(meanPoolVectors);
  }

  async function embedQueryBatch(texts: string[]): Promise<number[][]> {
    const promisesByText = new Map<string, Promise<number[]>>();
    const newFlights: { text: string; flight: QueryFlight }[] = [];

    for (const text of texts) {
      if (promisesByText.has(text)) continue;
      const chunkPromises: Promise<number[]>[] = [];
      for (const chunk of splitPassage(text)) {
        const cached = readQueryCache(chunk);
        if (cached) {
          chunkPromises.push(Promise.resolve(cached));
          continue;
        }
        const existing = queryFlights.get(chunk);
        if (existing) {
          chunkPromises.push(existing.promise);
          continue;
        }
        let resolveFlight!: (values: number[]) => void;
        let rejectFlight!: (reason: unknown) => void;
        const promise = new Promise<number[]>((resolve, reject) => {
          resolveFlight = resolve;
          rejectFlight = reject;
        });
        const flight: QueryFlight = { promise, resolve: resolveFlight, reject: rejectFlight };
        queryFlights.set(chunk, flight);
        chunkPromises.push(promise);
        newFlights.push({ text: chunk, flight });
      }
      promisesByText.set(text, Promise.all(chunkPromises).then(meanPoolVectors));
    }

    if (newFlights.length > 0) {
      for (let offset = 0; offset < newFlights.length; offset += MAX_BATCH_SIZE) {
        const batch = newFlights.slice(offset, offset + MAX_BATCH_SIZE);
        void queue.enqueue(() => requestBatch(batch.map(item => item.text), 'query')).then(vectors => {
          vectors.forEach((values, index) => {
            const { text, flight } = batch[index];
            writeQueryCache(text, values);
            if (queryFlights.get(text) === flight) queryFlights.delete(text);
            flight.resolve(copyVector(values));
          });
        }).catch(error => {
          const safeError = error instanceof GraphEmbeddingProviderError
            ? error
            : providerError('embedding_provider_request_failed', 'Embedding provider request failed');
          for (const { text, flight } of batch) {
            if (queryFlights.get(text) === flight) queryFlights.delete(text);
            flight.reject(safeError);
          }
        });
      }
    }

    const vectors = await Promise.all(texts.map(text => promisesByText.get(text)!));
    return vectors.map(copyVector);
  }

  async function embed(texts: string[], kind: GraphEmbeddingKind): Promise<number[][]> {
    if (kind !== 'query' && kind !== 'passage') {
      throw providerError('embedding_provider_invalid_kind', 'Embedding kind is invalid');
    }
    if (!Array.isArray(texts) || !texts.every(text => typeof text === 'string')) {
      throw providerError('embedding_provider_invalid_texts', 'Embedding texts are invalid');
    }
    if (texts.some(text => text.length > MAX_TEXT_LENGTH)) {
      throw providerError('embedding_provider_text_too_long', 'Embedding text exceeds the maximum length');
    }
    if (texts.length === 0) return [];
    if (kind === 'passage') return embedPassages(texts);
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH_SIZE) {
      vectors.push(...await embedQueryBatch(texts.slice(offset, offset + MAX_BATCH_SIZE)));
    }
    return vectors;
  }

  return {
    modelId: GRAPH_EMBEDDING_MODEL_ID,
    dimensions: GRAPH_EMBEDDING_DIMENSIONS,
    embed,
  };
}
