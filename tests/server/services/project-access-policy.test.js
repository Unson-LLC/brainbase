import { describe, expect, it, vi } from 'vitest';

import { ProjectAccessPolicy } from '../../../server/services/project-access/project-access-policy.js';
import { isProjectAllowed } from '../../../server/services/project-access/project-code-matcher.js';

describe('ProjectAccessPolicy', () => {
    it('共有matcherもID・明示alias・repository名以外の暗黙一致を許可しない', () => {
        expect(isProjectAllowed({ id: 'growin-app' }, ['growin'])).toBe(false);
        expect(isProjectAllowed({ id: 'grow-in' }, ['growin'])).toBe(false);
        expect(isProjectAllowed({ id: 'growin-app', aliases: ['growin'] }, ['growin'])).toBe(true);
        expect(isProjectAllowed({ id: 'growin-app', github: { repo: 'growin' } }, ['growin'])).toBe(true);
    });

    it('project設定の明示aliasとrepository名だけでmember accessを判定する', async () => {
        const configParser = {
            runForOrganization: vi.fn(async (_organizationId, callback) => callback()),
            getProjects: vi.fn(async () => ({
                source: { status: 'loaded', mode: 'registry_scoped' },
                projects: [{
                    id: 'tech-knight-app',
                    aliases: ['tech_knight_ui'],
                    github: { repo: 'tech-knight-platform' },
                    session_select: true
                }]
            }))
        };
        const policy = new ProjectAccessPolicy({ configParser });
        const actor = { organizationId: 'org-tech-knight', role: 'member' };

        await policy.prepare(actor);

        expect(policy.canAccessProject('tech-knight-app', {
            ...actor,
            role: 'member',
            projectCodes: ['tech-knight']
        })).toBe(false);
        expect(policy.canAccessProject('tech-knight-app', {
            ...actor,
            role: 'member',
            projectCodes: ['tech-knight-platform']
        })).toBe(true);
        expect(policy.canAccessProject('tech-knight-app', {
            ...actor,
            role: 'member',
            projectCodes: ['tech-knight-ui']
        })).toBe(true);
        expect(policy.canAccessProject('tech-knight-app', {
            ...actor,
            role: 'member',
            projectCodes: ['techknightapp']
        })).toBe(false);
        expect(policy.canAccessProject('tech-knight-app', {
            ...actor,
            role: 'member',
            projectCodes: ['unrelated-project']
        })).toBe(false);
    });

    it('member/admin/ceoは同じ明示project grant契約で判定する', async () => {
        const configParser = {
            runForOrganization: vi.fn(async (_organizationId, callback) => callback()),
            getProjects: vi.fn(async () => ({
                source: { status: 'loaded', mode: 'registry_scoped' },
                projects: [
                    { id: 'registry-only', github: { repo: 'growin-project' } },
                    { id: 'ungranted-project' }
                ]
            }))
        };
        const policy = new ProjectAccessPolicy({ configParser });

        for (const role of ['member', 'admin', 'ceo']) {
            const actor = {
                organizationId: 'org-growin',
                projectCodes: ['growin-project'],
                role
            };
            await policy.prepare(actor);

            expect(policy.canAccessProject('registry-only', actor)).toBe(true);
            expect(policy.canAccessProject('ungranted-project', actor)).toBe(false);
        }
    });

    it('selectableでないprojectと未知のorg参照を拒否する', async () => {
        const policy = new ProjectAccessPolicy({
            configParser: {
                runForOrganization: vi.fn(async (_organizationId, callback) => callback()),
                getProjects: vi.fn(async () => ({
                    source: { status: 'loaded', mode: 'registry_scoped' },
                    projects: [{ id: 'archived-project', archived: true }]
                }))
            }
        });
        const actor = { organizationId: 'org-archive', role: 'member' };

        await expect(policy.assertProjectSelectable('archived-project', actor))
            .rejects.toThrow("project 'archived-project' is not selectable");
        expect(() => policy.assertOrgReferenceAllowed('unknown-org', actor))
            .toThrow("org 'unknown-org' is not a known Graph org reference");
    });

    it('認証済みorganization contextでruntime registryを読み新規projectを選択可能にする', async () => {
        const configParser = {
            runForOrganization: vi.fn(async (_organizationId, callback) => callback()),
            getProjects: vi.fn(async () => ({
                source: { status: 'loaded', mode: 'registry_scoped' },
                projects: [{ id: 'growin-ai', archived: false, session_select: true }]
            }))
        };
        const policy = new ProjectAccessPolicy({ configParser });
        const actor = { organizationId: 'org_growin', projectCodes: ['growin-ai'], role: 'member' };

        await expect(policy.assertProjectSelectable('growin-ai', actor)).resolves.toBeUndefined();
        expect(configParser.runForOrganization).toHaveBeenCalledWith('org_growin', expect.any(Function));
        expect(policy.canAccessProject('growin-ai', actor)).toBe(true);
    });

    it('Registry unavailable時はfallback projectをmember accessや選択の根拠にしない', async () => {
        const configParser = {
            runForOrganization: vi.fn(async (_organizationId, callback) => callback()),
            getProjects: vi.fn(async () => ({
                source: { status: 'unavailable', mode: 'registry_unavailable' },
                // Simulates a stale/unsafe caller that still includes legacy rows.
                projects: [{ id: 'growin-ai', archived: false, session_select: true }]
            }))
        };
        const policy = new ProjectAccessPolicy({ configParser });
        const actor = { organizationId: 'org_growin', projectCodes: ['growin-ai'], role: 'member' };

        await policy.prepare(actor);

        expect(policy.canAccessProject('growin-ai', actor)).toBe(false);
        expect(policy.canAccessProject('growin-ai', { ...actor, role: 'ceo' })).toBe(false);
        await expect(policy.assertProjectSelectable('growin-ai', actor))
            .rejects.toThrow("project 'growin-ai' is not selectable");
        expect(() => policy.assertProjectAccess('growin-ai', actor))
            .toThrow("project 'growin-ai' is not accessible");
        expect(() => policy.assertOrgReferenceAllowed('growin-ai', actor))
            .toThrow("org 'growin-ai' is not a known Graph org reference");
    });

    it('personとGrantがあってもorganization contextなしではlegacy catalogを権威にせずaccess不可にする', async () => {
        const configParser = {
            getProjects: vi.fn(async () => ({
                projects: [{ id: 'legacy-project', archived: false, session_select: true }]
            }))
        };
        const policy = new ProjectAccessPolicy({ configParser });
        const actor = {
            personId: 'person-1',
            role: 'member',
            projectCodes: ['legacy-project']
        };

        await expect(policy.prepare(actor)).resolves.toMatchObject({
            projects: [],
            source: { status: 'organization_context_required', mode: 'registry_scope_required' }
        });
        expect(configParser.getProjects).not.toHaveBeenCalled();
        expect(policy.canAccessProject('legacy-project', actor)).toBe(false);
        await expect(policy.assertProjectSelectable('legacy-project', actor))
            .rejects.toThrow("project 'legacy-project' is not selectable");
        expect(() => policy.assertProjectAccess('legacy-project', actor))
            .toThrow("project 'legacy-project' is not accessible");
    });

    it('organization別catalogを並行準備しても相互に上書きしない', async () => {
        let currentOrganization = null;
        const configParser = {
            runForOrganization: vi.fn(async (organizationId, callback) => {
                currentOrganization = organizationId;
                return callback();
            }),
            getProjects: vi.fn(async () => ({
                source: { status: 'loaded', mode: 'registry_scoped' },
                projects: [{ id: currentOrganization === 'org-a' ? 'project-a' : 'project-b' }]
            }))
        };
        const policy = new ProjectAccessPolicy({ configParser });
        const actorA = { organizationId: 'org-a', role: 'member', projectCodes: ['project-a'] };
        const actorB = { organizationId: 'org-b', role: 'member', projectCodes: ['project-b'] };

        await policy.prepare(actorA);
        await policy.prepare(actorB);

        expect(policy.canAccessProject('project-a', actorA)).toBe(true);
        expect(policy.canAccessProject('project-b', actorA)).toBe(false);
        expect(policy.canAccessProject('project-b', actorB)).toBe(true);
        expect(() => policy.assertOrgReferenceAllowed('project-a', actorA)).not.toThrow();
        expect(() => policy.assertOrgReferenceAllowed('project-a', actorB)).toThrow();
    });
});
