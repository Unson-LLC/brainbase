import { describe, expect, it, vi } from 'vitest';

import { ProjectAccessPolicy } from '../../../server/services/project-access/project-access-policy.js';

describe('ProjectAccessPolicy', () => {
    it('project設定のaliasとapp parentを使ってmember accessを判定する', async () => {
        const configParser = {
            getProjects: vi.fn(async () => ({
                projects: [{
                    id: 'tech-knight-app',
                    aliases: ['tech_knight_ui'],
                    github: { repo: 'tech-knight-platform' },
                    session_select: true
                }]
            }))
        };
        const policy = new ProjectAccessPolicy({ configParser });

        await policy.prepare();

        expect(policy.canAccessProject('tech-knight-app', {
            role: 'member',
            projectCodes: ['tech-knight']
        })).toBe(true);
        expect(policy.canAccessProject('tech-knight-app', {
            role: 'member',
            projectCodes: ['unrelated-project']
        })).toBe(false);
    });

    it('selectableでないprojectと未知のorg参照を拒否する', async () => {
        const policy = new ProjectAccessPolicy({
            configParser: {
                getProjects: vi.fn(async () => ({
                    projects: [{ id: 'archived-project', archived: true }]
                }))
            }
        });

        await expect(policy.assertProjectSelectable('archived-project'))
            .rejects.toThrow("project 'archived-project' is not selectable");
        expect(() => policy.assertOrgReferenceAllowed('unknown-org'))
            .toThrow("org 'unknown-org' is not a known Graph org reference");
    });
});
