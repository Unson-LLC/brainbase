import { beforeEach, vi } from 'vitest';

const originalFetch = globalThis.fetch;

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
