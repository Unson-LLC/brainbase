import { afterEach, describe, expect, it, vi } from 'vitest';

describe('project mapping runtime catalog', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('Session Launch Pickerはruntime catalogとWorkspace pathが揃ったprojectだけを選択可能にする', async () => {
        const calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            calls.push(url);
            if (url === '/api/config') {
                return {
                    ok: true,
                    json: async () => ({
                        projects: {
                            root: '/workspace',
                            projects: [{ id: 'legacy-only', local: { path: 'projects/legacy-only' } }]
                        }
                    })
                };
            }
            if (url === '/api/config/projects') {
                return {
                    ok: true,
                    json: async () => ({
                        source: { status: 'loaded', mode: 'registry_merged' },
                        projects: [
                            { id: 'legacy-only', session_select: true },
                            { id: 'registry-only', session_select: true }
                        ]
                    })
                };
            }
            throw new Error(`unexpected URL: ${url}`);
        }));

        const mapping = await import('../../public/modules/project-mapping.js');
        await mapping.projectMappingReady;

        expect(calls).toEqual(['/api/config', '/api/config/projects']);
        expect(mapping.getSessionSelectableProjects()).toEqual(['legacy-only']);
        expect(mapping.getProjectsRequiringWorkspaceSetup()).toEqual(['registry-only']);
        expect(() => mapping.getProjectPath('registry-only')).toThrow(/Workspace setup is required/);
        expect(mapping.getProjectPath('legacy-only')).toBe('/workspace/projects/legacy-only');
    });

    it('同じprojectがWorkspace設定にあってもlocal.path未設定なら推測pathで起動しない', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (url === '/api/config') {
                return {
                    ok: true,
                    json: async () => ({
                        projects: {
                            root: '/workspace',
                            projects: [{ id: 'registry-same-id' }]
                        }
                    })
                };
            }
            if (url === '/api/config/projects') {
                return {
                    ok: true,
                    json: async () => ({
                        source: { status: 'loaded', mode: 'registry_scoped' },
                        projects: [{ id: 'registry-same-id', session_select: true }]
                    })
                };
            }
            throw new Error(`unexpected URL: ${url}`);
        }));

        const mapping = await import('../../public/modules/project-mapping.js');
        await mapping.projectMappingReady;

        expect(mapping.getSessionSelectableProjects()).toEqual([]);
        expect(mapping.getProjectsRequiringWorkspaceSetup()).toEqual(['registry-same-id']);
        expect(() => mapping.getProjectPath('registry-same-id')).toThrow(/Workspace setup is required/);
    });

    it('runtime catalogが認証失敗した場合はlegacy projectを選択可能にしない', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (url === '/api/config') {
                return {
                    ok: true,
                    json: async () => ({
                        projects: {
                            root: '/workspace',
                            projects: [{ id: 'legacy-ungranted', local: { path: 'projects/legacy-ungranted' } }]
                        }
                    })
                };
            }
            return { ok: false, status: 401 };
        }));

        const mapping = await import('../../public/modules/project-mapping.js');
        await mapping.projectMappingReady;

        expect(mapping.getSessionSelectableProjects()).toEqual([]);
        expect(mapping.getRuntimeProjectCatalogSource()).toEqual({
            status: 'authentication_required', http_status: 401
        });
    });

    it('runtime catalogが401以外で失敗した場合はlegacy projectを選択可能にしない', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (url === '/api/config') {
                return {
                    ok: true,
                    json: async () => ({
                        projects: {
                            root: '/workspace',
                            projects: [{ id: 'legacy-request-failed', local: { path: 'projects/legacy-request-failed' } }]
                        }
                    })
                };
            }
            if (url === '/api/config/projects') return { ok: false, status: 503 };
            throw new Error(`unexpected URL: ${url}`);
        }));

        const mapping = await import('../../public/modules/project-mapping.js');
        await mapping.projectMappingReady;

        expect(mapping.getSessionSelectableProjects()).toEqual([]);
        expect(mapping.getRuntimeProjectCatalogSource()).toEqual({
            status: 'request_failed', http_status: 503
        });
    });

    it('runtime catalogのfetchが例外になった場合はlegacy projectを選択可能にしない', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (url === '/api/config') {
                return {
                    ok: true,
                    json: async () => ({
                        projects: {
                            root: '/workspace',
                            projects: [{ id: 'legacy-fetch-error', local: { path: 'projects/legacy-fetch-error' } }]
                        }
                    })
                };
            }
            if (url === '/api/config/projects') throw new Error('catalog fetch failed');
            throw new Error(`unexpected URL: ${url}`);
        }));

        const mapping = await import('../../public/modules/project-mapping.js');
        await mapping.projectMappingReady;

        expect(mapping.getSessionSelectableProjects()).toEqual([]);
        expect(mapping.getRuntimeProjectCatalogSource()).toEqual({ status: 'unavailable' });
    });

    it('runtime catalogのsource.statusがunavailableの場合はlegacy projectを選択可能にしない', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (url === '/api/config') {
                return {
                    ok: true,
                    json: async () => ({
                        projects: {
                            root: '/workspace',
                            projects: [{ id: 'legacy-source-unavailable', local: { path: 'projects/legacy-source-unavailable' } }]
                        }
                    })
                };
            }
            if (url === '/api/config/projects') {
                return {
                    ok: true,
                    json: async () => ({
                        source: { status: 'unavailable', code: 'registry_unavailable' },
                        projects: [{ id: 'legacy-source-unavailable', session_select: true }]
                    })
                };
            }
            throw new Error(`unexpected URL: ${url}`);
        }));

        const mapping = await import('../../public/modules/project-mapping.js');
        await mapping.projectMappingReady;

        expect(mapping.getSessionSelectableProjects()).toEqual([]);
        expect(mapping.getRuntimeProjectCatalogSource()).toEqual({
            status: 'unavailable', code: 'registry_unavailable'
        });
    });
});
