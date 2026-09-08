import { beforeEach, vi } from 'vitest';

const originalFetch = globalThis.fetch;

function createMemoryStorage() {
    const values = new Map();

    return {
        get length() {
            return values.size;
        },
        clear() {
            values.clear();
        },
        getItem(key) {
            const normalizedKey = String(key);
            return values.has(normalizedKey) ? values.get(normalizedKey) : null;
        },
        key(index) {
            return Array.from(values.keys())[index] ?? null;
        },
        removeItem(key) {
            values.delete(String(key));
        },
        setItem(key, value) {
            values.set(String(key), String(value));
        }
    };
}

// Node 26 exposes an experimental global localStorage whose value is undefined
// unless --localstorage-file is supplied. Vitest then preserves that value while
// populating jsdom globals, so browser tests lose jsdom's in-memory Storage.
if (typeof window !== 'undefined' && !window.localStorage) {
    const storage = createMemoryStorage();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

const TEST_PROJECTS = [
    { id: 'unson', name: 'unson' },
    { id: 'tech-knight', name: 'tech-knight' },
    { id: 'brainbase', name: 'brainbase', emoji: 'BB' },
    { id: 'salestailor', name: 'salestailor', emoji: 'ST' },
    { id: 'zeims', name: 'zeims', emoji: 'ZE' },
    { id: 'baao', name: 'baao' },
    { id: 'ncom', name: 'ncom' },
    { id: 'senrigan', name: 'senrigan' },
    { id: 'aitle', name: 'aitle' },
    { id: 'mana', name: 'mana' },
    { id: 'back-office', name: 'back-office' }
].map((project) => ({
    ...project,
    local: { path: `projects/${project.id}` }
}));

const buildConfigResponse = () => ({
    ok: true,
    json: async () => ({
        projects: {
            root: '/tmp/brainbase-test-workspace',
            projects: TEST_PROJECTS
        },
        plugins: {
            enabled: [],
            disabled: []
        }
    })
});

const fetchMock = vi.fn((input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url === '/api/config') {
        return Promise.resolve(buildConfigResponse());
    }
    if (url === '/api/csrf-token') {
        return Promise.resolve({
            ok: true,
            json: async () => ({ csrfToken: 'test-csrf-token' })
        });
    }
    if (url === '/api/config/slack/members') {
        return Promise.resolve({
            ok: true,
            json: async () => ({ members: [] })
        });
    }
    if (url === '/api/schedule/google/auth-status') {
        return Promise.resolve({
            ok: true,
            json: async () => ({ authenticated: false })
        });
    }
    if (url === '/api/active-port') {
        return Promise.resolve({
            ok: true,
            json: async () => ({ success: true })
        });
    }
    if (url === '/api/sessions/status') {
        return Promise.resolve({
            ok: true,
            json: async () => ({})
        });
    }
    if (typeof url === 'string' && url.startsWith('/api/config/env?')) {
        return Promise.resolve({
            ok: true,
            json: async () => ({ keys: {} })
        });
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
