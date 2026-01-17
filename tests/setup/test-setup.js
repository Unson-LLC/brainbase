import { beforeEach, vi } from 'vitest';

const originalFetch = globalThis.fetch;

const buildConfigResponse = () => ({
    ok: true,
    json: async () => ({
        projects: {}
    })
});

const fetchMock = vi.fn((input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url === '/api/config') {
        return Promise.resolve(buildConfigResponse());
    }
    if (typeof originalFetch === 'function') {
        return originalFetch(input, init);
    }
    return Promise.reject(new Error('Fetch not mocked'));
});

globalThis.fetch = fetchMock;

beforeEach(() => {
    if (globalThis.fetch === fetchMock) {
        fetchMock.mockClear();
    }
});
