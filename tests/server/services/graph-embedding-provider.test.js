import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGraphEmbeddingProvider,
  GraphEmbeddingProviderError,
} from '../../../server/services/graph-embedding-provider.js';

const DIMENSIONS = 768;

function vector(seed = 1) {
  return Array.from({ length: DIMENSIONS }, (_, index) => seed + (index % 3));
}

function responseForBody(body) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      embeddings: body.requests.map((_request, index) => ({ values: vector(index + 1) })),
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createGraphEmbeddingProvider', () => {
  it('calls Gemini with query/document task types and returns normalized vectors', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents');
      expect(options.headers).toEqual({
        'content-type': 'application/json',
        'x-goog-api-key': 'test-secret',
      });
      const body = JSON.parse(options.body);
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0]).toMatchObject({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: expect.any(String) }] },
        outputDimensionality: DIMENSIONS,
      });
      return responseForBody(body);
    });
    const provider = createGraphEmbeddingProvider({ apiKey: 'test-secret', fetchImpl });

    const [queryVector] = await provider.embed(['質問'], 'query');
    const [passageVector] = await provider.embed(['本文'], 'passage');

    expect(provider).toMatchObject({ modelId: 'gemini-embedding-001:768:v2', dimensions: DIMENSIONS });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).requests[0].taskType).toBe('RETRIEVAL_QUERY');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).requests[0].taskType).toBe('RETRIEVAL_DOCUMENT');
    for (const values of [queryVector, passageVector]) {
      expect(values).toHaveLength(DIMENSIONS);
      expect(values.every(value => Number.isFinite(value))).toBe(true);
      expect(Math.hypot(...values)).toBeCloseTo(1, 10);
    }
  });

  it('splits passage requests into batches of at most 16 and preserves order', async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      return responseForBody(body);
    });
    const provider = createGraphEmbeddingProvider({ apiKey: 'key', fetchImpl });
    const texts = Array.from({ length: 17 }, (_, index) => `passage-${index}`);

    const vectors = await provider.embed(texts, 'passage');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).requests).toHaveLength(16);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).requests).toHaveLength(1);
    expect(vectors).toHaveLength(texts.length);
  });

  it('splits UTF-8 passages and queries at the provider boundary, keeps the tail, and mean-pools chunks', async () => {
    const original = 'あ'.repeat(601);
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      const chunkTexts = body.requests.map(request => request.content.parts[0].text);
      expect(chunkTexts).toHaveLength(2);
      expect(chunkTexts.every(text => Buffer.byteLength(text, 'utf8') <= 1800)).toBe(true);
      expect(chunkTexts.join('')).toBe(original);
      return responseForBody(body);
    });
    const provider = createGraphEmbeddingProvider({ apiKey: 'key', fetchImpl });

    const [values] = await provider.embed([original], 'passage');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(values).toHaveLength(DIMENSIONS);
    expect(values.every(value => Number.isFinite(value))).toBe(true);
    expect(Math.hypot(...values)).toBeCloseTo(1, 10);

    const [queryValues] = await provider.embed([original], 'query');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(queryValues).toHaveLength(DIMENSIONS);
    expect(queryValues.every(value => Number.isFinite(value))).toBe(true);
    expect(Math.hypot(...queryValues)).toBeCloseTo(1, 10);
  });

  it('rejects invalid input and never includes caller text in validation errors', async () => {
    const fetchImpl = vi.fn();
    const provider = createGraphEmbeddingProvider({ apiKey: 'key', fetchImpl });
    const secretText = 'caller-secret-should-not-be-in-error';

    await expect(provider.embed([secretText], 'unknown')).rejects.toMatchObject({
      code: 'embedding_provider_invalid_kind',
    });
    await expect(provider.embed(['x'.repeat(6001)], 'query')).rejects.toMatchObject({
      code: 'embedding_provider_text_too_long',
    });
    await expect(provider.embed([secretText, 1], 'query')).rejects.toMatchObject({
      code: 'embedding_provider_invalid_texts',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(provider.embed([], 'query')).resolves.toEqual([]);
  });

  it('fails safely for HTTP and malformed responses without exposing body, key, or text', async () => {
    const apiKey = 'api-key-that-must-not-escape';
    const callerText = 'sensitive caller text';
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => `${apiKey} ${callerText}` })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ embeddings: [{ values: [1] }] }) });
    const provider = createGraphEmbeddingProvider({ apiKey, fetchImpl });

    const httpError = await provider.embed([callerText], 'query').catch(error => error);
    expect(httpError).toBeInstanceOf(GraphEmbeddingProviderError);
    expect(httpError.code).toBe('embedding_provider_http_error');
    expect(httpError.message).not.toContain(apiKey);
    expect(httpError.message).not.toContain(callerText);

    const malformedError = await provider.embed(['another text'], 'passage').catch(error => error);
    expect(malformedError.code).toBe('embedding_provider_invalid_response');
    expect(malformedError.message).not.toContain(apiKey);
    expect(malformedError.message).not.toContain('another text');
  });

  it('normalizes and rejects non-finite, wrong-dimension, and zero vectors', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ embeddings: [{ values: [Number.NaN] }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ embeddings: [{ values: Array(DIMENSIONS).fill(0) }] }) });
    const provider = createGraphEmbeddingProvider({ apiKey: 'key', fetchImpl });

    await expect(provider.embed(['non-finite'], 'passage')).rejects.toMatchObject({
      code: 'embedding_provider_invalid_response',
    });
    await expect(provider.embed(['zero'], 'passage')).rejects.toMatchObject({
      code: 'embedding_provider_invalid_response',
    });
  });

  it('deduplicates in-flight queries and keeps a bounded TTL LRU cache', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const fetchImpl = vi.fn(async (_url, options) => {
      await gate;
      return responseForBody(JSON.parse(options.body));
    });
    const provider = createGraphEmbeddingProvider({
      apiKey: 'key',
      fetchImpl,
      queryCacheTtlMs: 20,
      queryCacheMaxEntries: 2,
    });

    const first = provider.embed(['same query'], 'query');
    const second = provider.embed(['same query'], 'query');
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await provider.embed(['same query'], 'query');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await new Promise(resolve => setTimeout(resolve, 25));
    await provider.embed(['same query'], 'query');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await provider.embed(['q1'], 'query');
    await provider.embed(['q2'], 'query');
    await provider.embed(['q3'], 'query');
    await provider.embed(['q1'], 'query');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('limits shared API concurrency to two and rejects work beyond the queue bound', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async (_url, options) => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
      return responseForBody(JSON.parse(options.body));
    });
    const provider = createGraphEmbeddingProvider({ apiKey: 'key', fetchImpl });
    const calls = Array.from({ length: 19 }, (_, index) => provider.embed([`p-${index}`], 'passage'));

    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
    await expect(calls[18]).rejects.toMatchObject({ code: 'embedding_provider_queue_full' });

    release();
    const results = await Promise.allSettled(calls);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(18);
    expect(peak).toBe(2);
  });

  it('uses a bounded abort timeout and hides lower-level error details', async () => {
    let signal;
    const fetchImpl = vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('api-key leaked by backend')), { once: true });
      });
    });
    const provider = createGraphEmbeddingProvider({ apiKey: 'secret-key', fetchImpl, timeoutMs: 10 });

    const error = await provider.embed(['timeout text'], 'query').catch(value => value);

    expect(error).toMatchObject({ code: 'embedding_provider_timeout' });
    expect(error.message).not.toContain('secret-key');
    expect(error.message).not.toContain('timeout text');
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(true);
  });

  it('requires an API key without exposing its value', () => {
    expect(() => createGraphEmbeddingProvider({ apiKey: '   ' })).toThrowError(
      expect.objectContaining({ code: 'embedding_provider_api_key_missing' }),
    );
  });
});
