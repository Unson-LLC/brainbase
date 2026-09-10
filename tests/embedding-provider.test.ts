import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDING_MAX_INPUTS,
  EMBEDDING_MAX_TOTAL_INPUTS,
  EMBEDDING_MAX_RESPONSE_BYTES,
  EMBEDDING_MAX_TEXT_LENGTH,
  type EmbeddingFetch,
  type EmbeddingFetchResponse,
  createEmbeddingProviderFromEnv,
  createHttpEmbeddingProvider
} from '../src/embedding-provider.js';

function jsonResponse(value: unknown, status = 200): EmbeddingFetchResponse {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  }) as unknown as EmbeddingFetchResponse;
}

function embeddingResponse(vectors: number[][], indexes = vectors.map((_, index) => index)): EmbeddingFetchResponse {
  return jsonResponse({ data: vectors.map((embedding, position) => ({ embedding, index: indexes[position] })) });
}

function provider(fetchImpl: EmbeddingFetch, overrides: Record<string, unknown> = {}) {
  return createHttpEmbeddingProvider({
    url: 'http://127.0.0.1:11434/v1/embeddings',
    model: 'nomic-embed-text',
    fetch: fetchImpl,
    ...overrides
  });
}

describe('embedding provider', () => {
  it('does not create a network provider when embedding is not configured', () => {
    expect(createEmbeddingProviderFromEnv({})).toBeUndefined();
  });

  it('rejects partial configuration without exposing configured secrets', () => {
    const secretUrl = 'https://embedding.example.test/v1/embeddings?token=do-not-leak';
    let error: unknown;
    try {
      createEmbeddingProviderFromEnv({ BRAINBASE_EMBEDDING_URL: secretUrl });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('BRAINBASE_EMBEDDING_MODEL');
    expect((error as Error).message).not.toContain(secretUrl);
    expect((error as Error).message).not.toContain('do-not-leak');
  });

  it('allows HTTPS endpoints and loopback HTTP only', () => {
    const fetchImpl: EmbeddingFetch = vi.fn(async () => embeddingResponse([[1, 2]]));
    expect(createHttpEmbeddingProvider({ url: 'https://embedding.example.test/v1/embeddings', model: 'm', fetch: fetchImpl })).toBeDefined();
    expect(createHttpEmbeddingProvider({ url: 'http://localhost:11434/v1/embeddings', model: 'm', fetch: fetchImpl })).toBeDefined();
    expect(() => createHttpEmbeddingProvider({ url: 'http://embedding.example.test/v1/embeddings', model: 'm', fetch: fetchImpl }))
      .toThrow(/HTTPS/);
    expect(() => createHttpEmbeddingProvider({ url: 'https://embedding.example.test/v1/embeddings?key=secret', model: 'm', fetch: fetchImpl }))
      .toThrow(/must not contain credentials, query parameters, or a fragment/);
    expect(() => createHttpEmbeddingProvider({ url: 'https://embedding.example.test/v1/embed', model: 'm', fetch: fetchImpl }))
      .toThrow(/\/embeddings endpoint/);
  });

  it('posts an OpenAI-compatible request and orders vectors by response index', async () => {
    const calls: Array<{ input: string; init: Parameters<EmbeddingFetch>[1] }> = [];
    const fetchImpl: EmbeddingFetch = vi.fn(async (input, init) => {
      calls.push({ input, init });
      return embeddingResponse([[2, 3], [1, 2]], [1, 0]);
    });
    const result = await provider(fetchImpl).embed(['alpha', 'beta']);

    expect(result).toEqual([[1, 2], [2, 3]]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toBe('http://127.0.0.1:11434/v1/embeddings');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(calls[0]!.init.headers).toEqual({ 'content-type': 'application/json', accept: 'application/json' });
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ input: ['alpha', 'beta'], model: 'nomic-embed-text' });
  });

  it('uses an optional API key without including it in provider identity', async () => {
    const secret = 'super-secret-key';
    let request: Parameters<EmbeddingFetch>[1] | undefined;
    const fetchImpl: EmbeddingFetch = vi.fn(async (_input, init) => {
      request = init;
      return embeddingResponse([[1, 2]]);
    });
    const result = await createEmbeddingProviderFromEnv({
      BRAINBASE_EMBEDDING_URL: 'http://127.0.0.1:11434/v1/embeddings',
      BRAINBASE_EMBEDDING_MODEL: 'm',
      BRAINBASE_EMBEDDING_API_KEY: secret
    }) as ReturnType<typeof createHttpEmbeddingProvider>;
    // The environment factory uses the host fetch, so use the direct factory for a local request assertion.
    const local = createHttpEmbeddingProvider({ url: 'http://127.0.0.1:11434/v1/embeddings', model: 'm', apiKey: secret, fetch: fetchImpl });
    await local.embed(['alpha']);
    expect(request?.headers.authorization).toBe(`Bearer ${secret}`);
    expect(local.id).not.toContain(secret);
    expect(result.id).not.toContain(secret);
  });

  it('shares a bounded text cache and only requests misses', async () => {
    const calls: string[][] = [];
    const fetchImpl: EmbeddingFetch = vi.fn(async (_input, init) => {
      const payload = JSON.parse(init.body) as { input: string[] };
      calls.push(payload.input);
      return embeddingResponse(payload.input.map((text) => [text.length, 1]));
    });
    const value = provider(fetchImpl);
    await expect(value.embed(['alpha', 'beta'])).resolves.toEqual([[5, 1], [4, 1]]);
    await expect(value.embed(['beta', 'gamma', 'alpha', 'gamma'])).resolves.toEqual([[4, 1], [5, 1], [5, 1], [5, 1]]);
    expect(calls).toEqual([['alpha', 'beta'], ['gamma']]);
  });

  it('splits larger calls into bounded batches while preserving result order', async () => {
    const calls: string[][] = [];
    const fetchImpl: EmbeddingFetch = vi.fn(async (_input, init) => {
      const payload = JSON.parse(init.body) as { input: string[] };
      calls.push(payload.input);
      return embeddingResponse(payload.input.map((text) => [text.length, 1]));
    });
    const value = provider(fetchImpl);
    const texts = Array.from({ length: EMBEDDING_MAX_INPUTS + 1 }, (_, index) => `text-${index}`);
    const result = await value.embed(texts);
    expect(result).toHaveLength(texts.length);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveLength(EMBEDDING_MAX_INPUTS);
    expect(calls[1]).toHaveLength(1);
    expect(result[0]).toEqual([texts[0]!.length, 1]);
    expect(result.at(-1)).toEqual([texts.at(-1)!.length, 1]);
  });

  it('does not cache a failed request', async () => {
    let attempt = 0;
    const fetchImpl: EmbeddingFetch = vi.fn(async () => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({ error: 'provider details stay private' }, 500) : embeddingResponse([[1, 2]]);
    });
    const value = provider(fetchImpl);
    await expect(value.embed(['alpha'])).rejects.toThrow(/HTTP 500/);
    await expect(value.embed(['alpha'])).resolves.toEqual([[1, 2]]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed, zero, duplicate-index, and different-dimension vectors', async () => {
    const responses = [
      embeddingResponse([[0, 0]]),
      embeddingResponse([[1, 2], [3, 4]], [0, 0]),
      embeddingResponse([[1, 2], [3]], [0, 1])
    ];
    const fetchImpl: EmbeddingFetch = vi.fn(async () => responses.shift()!);
    const value = provider(fetchImpl);
    await expect(value.embed(['alpha'])).rejects.toThrow(/zero vector/);
    await expect(value.embed(['alpha', 'beta'])).rejects.toThrow(/invalid vector indexes/);
    await expect(value.embed(['alpha', 'beta'])).rejects.toThrow(/different dimensions/);
  });

  it('enforces input and response bounds', async () => {
    const fetchImpl: EmbeddingFetch = vi.fn(async () => embeddingResponse([[1, 2]]));
    const value = provider(fetchImpl);
    await expect(value.embed(Array.from({ length: EMBEDDING_MAX_TOTAL_INPUTS + 1 }, () => 'x'))).rejects.toThrow(/at most/);
    await expect(value.embed(['x'.repeat(EMBEDDING_MAX_TEXT_LENGTH + 1)])).rejects.toThrow(/characters/);

    const tooLarge: EmbeddingFetchResponse = {
      status: 200,
      headers: { get: () => String(EMBEDDING_MAX_RESPONSE_BYTES + 1) },
      text: vi.fn(async () => 'should not be read')
    };
    await expect(provider(vi.fn(async () => tooLarge)).embed(['alpha'])).rejects.toThrow(/response exceeds/);
    expect(tooLarge.text).not.toHaveBeenCalled();
  });

  it('times out without returning provider response details', async () => {
    const fetchImpl: EmbeddingFetch = vi.fn(async () => await new Promise<EmbeddingFetchResponse>(() => undefined));
    await expect(provider(fetchImpl, { timeoutMs: 5 }).embed(['alpha'])).rejects.toThrow(/timed out after 5ms/);

    const bodyNeverResolves: EmbeddingFetchResponse = {
      status: 200,
      body: { getReader: () => ({ read: async () => await new Promise<{ done: boolean }>(() => undefined) }) },
      text: async () => await new Promise<string>(() => undefined)
    };
    const bodyFetch: EmbeddingFetch = vi.fn(async () => bodyNeverResolves);
    await expect(provider(bodyFetch, { timeoutMs: 5 }).embed(['beta'])).rejects.toThrow(/timed out after 5ms/);
  });
});
