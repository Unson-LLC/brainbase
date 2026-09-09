import type { FeatureExtractionPipelineType } from '@huggingface/transformers';

/**
 * The ONNX model is pinned so a changed model revision cannot silently change
 * retrieval scores or invalidate an existing embedding index.
 *
 * The revision is the commit currently published by the model repository. The
 * model card documents this repository as the Transformers.js-compatible ONNX
 * export of intfloat/multilingual-e5-small.
 */
export const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';
export const EMBEDDING_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';

const DEFAULT_BATCH_SIZE = 16;
const MAX_BATCH_SIZE = 64;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export type EmbeddingKind = 'query' | 'passage';

let extractorPromise: Promise<FeatureExtractionPipelineType> | undefined;

function readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function embeddingBatchSize(): number {
  return readBoundedInteger(
    'BRAINBASE_EMBEDDING_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
    1,
    MAX_BATCH_SIZE,
  );
}

function embeddingTimeoutMs(): number {
  return readBoundedInteger(
    'BRAINBASE_EMBEDDING_TIMEOUT_MS',
    DEFAULT_TIMEOUT_MS,
    1_000,
    MAX_TIMEOUT_MS,
  );
}

function embeddingCacheDir(): string | undefined {
  const raw = process.env.BRAINBASE_EMBEDDING_CACHE_DIR;
  if (raw === undefined) return undefined;

  const value = raw.trim();
  if (!value) {
    throw new Error('BRAINBASE_EMBEDDING_CACHE_DIR must not be empty');
  }
  return value;
}

async function createExtractor(): Promise<FeatureExtractionPipelineType> {
  const { env, pipeline } = await import('@huggingface/transformers');
  const cacheDir = embeddingCacheDir();
  if (cacheDir !== undefined) {
    env.cacheDir = cacheDir;
  }

  // The package's generated `pipeline` overload is a large task union. Keep
  // this boundary typed to the one pipeline this module actually supports.
  const loadFeatureExtractor = pipeline as unknown as (
    task: 'feature-extraction',
    model: string,
    options: { revision: string; dtype: 'fp32' },
  ) => Promise<FeatureExtractionPipelineType>;
  return loadFeatureExtractor('feature-extraction', EMBEDDING_MODEL_ID, {
    revision: EMBEDDING_MODEL_REVISION,
    // Use the full precision ONNX graph for stable scores across environments.
    dtype: 'fp32',
  });
}

/**
 * Return the single shared model load. Only the model is cached here: no
 * caller text or Graph result is retained by this module.
 */
async function getExtractor(): Promise<FeatureExtractionPipelineType> {
  if (extractorPromise !== undefined) return extractorPromise;

  const loading = createExtractor();
  let guarded: Promise<FeatureExtractionPipelineType>;
  guarded = loading.catch(error => {
    // A failed load must not be reported as a successful lexical fallback.
    // Clear only this failed flight so a later explicit call can retry.
    if (extractorPromise === guarded) extractorPromise = undefined;
    throw error;
  });
  extractorPromise = guarded;
  return guarded;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function normalizedRows(data: unknown, dims: unknown, expectedRows: number): number[][] {
  if (!Array.isArray(dims) || dims.length !== 2 || dims.some(dimension => !Number.isInteger(dimension))) {
    throw new Error('Embedding model returned an invalid tensor shape');
  }
  const [rows, columns] = dims;
  if (rows !== expectedRows || columns <= 0 || !ArrayBuffer.isView(data)) {
    throw new Error('Embedding model returned an invalid tensor payload');
  }

  const flat = data as unknown as ArrayLike<number>;
  if (flat.length !== rows * columns) {
    throw new Error('Embedding model returned a tensor with an unexpected size');
  }

  const result: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const values = new Array<number>(columns);
    let squaredNorm = 0;
    for (let column = 0; column < columns; column += 1) {
      const value = Number(flat[row * columns + column]);
      if (!Number.isFinite(value)) {
        throw new Error('Embedding model returned a non-finite value');
      }
      values[column] = value;
      squaredNorm += value * value;
    }

    const norm = Math.sqrt(squaredNorm);
    if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
      throw new Error('Embedding model returned a zero vector');
    }
    // The pipeline requests mean pooling and normalization. Re-normalizing
    // defensively keeps the exported contract true if a backend changes its
    // output representation or rounding behavior.
    for (let column = 0; column < columns; column += 1) {
      values[column] /= norm;
    }
    result.push(values);
  }
  return result;
}

/**
 * Embed query or Graph passage text with multilingual-e5-small.
 *
 * E5 requires the task prefix to be part of the model input. Calls are
 * processed in bounded batches and model/network/runtime errors are allowed to
 * reject the promise; callers must decide how to represent unavailable search.
 */
export async function embedTexts(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
  if (!Array.isArray(texts)) {
    throw new TypeError('texts must be an array of strings');
  }
  if (kind !== 'query' && kind !== 'passage') {
    throw new TypeError('kind must be query or passage');
  }
  if (!texts.every(text => typeof text === 'string')) {
    throw new TypeError('texts must be an array of strings');
  }
  if (texts.length === 0) return [];

  const batchSize = embeddingBatchSize();
  const timeoutMs = embeddingTimeoutMs();
  const extractor = await withTimeout(getExtractor(), timeoutMs, 'embedding model load');
  const prefixedTexts = texts.map(text => `${kind}: ${text}`);
  const embeddings: number[][] = [];

  for (let offset = 0; offset < prefixedTexts.length; offset += batchSize) {
    const batch = prefixedTexts.slice(offset, offset + batchSize);
    const tensor = await withTimeout(
      extractor(batch, { pooling: 'mean', normalize: true }),
      timeoutMs,
      `embedding batch ${Math.floor(offset / batchSize) + 1}`,
    );
    embeddings.push(...normalizedRows(tensor.data, tensor.dims, batch.length));
  }

  return embeddings;
}
