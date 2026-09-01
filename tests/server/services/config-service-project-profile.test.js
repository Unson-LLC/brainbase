import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../../../server/services/config-service.js';

describe('ConfigService Project Profile lifecycle', () => {
    let directory;
    let configPath;
    let service;
    const ceoAccess = { organizationId: 'unson', role: 'ceo', projectCodes: [] };
    const gmAccess = { organizationId: 'unson', role: 'gm', projectCodes: ['growin'] };

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-project-profile-'));
        configPath = path.join(directory, 'config.yml');
        await fs.writeFile(configPath, 'projects: []\norganizations:\n  - id: unson\n    name: 合同会社雲孫\n');
        service = new ConfigService(configPath);
    });

    afterEach(async () => {
        await fs.rm(directory, { recursive: true, force: true });
    });

    it('creates a minimal project without local_path and persists intent', async () => {
        const project = await service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo',
            capabilities: { mana: { desired_state: 'disabled', reason: '人間が対応する' } }
        }, ceoAccess);

        expect(project).toMatchObject({ id: 'growin', project_code: 'growin' });
        const persisted = yaml.load(await fs.readFile(configPath, 'utf8'));
        expect(persisted.projects[0].local).toBeUndefined();
        expect(persisted.projects[0].capabilities.mana.desired_state).toBe('disabled');
    });

    it('blocks duplicate project_code', async () => {
        const input = {
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        };
        await service.createProjectProfile(input, ceoAccess);
        await expect(service.createProjectProfile(input, ceoAccess)).rejects.toMatchObject({
            code: 'CONFLICT',
            statusCode: 409
        });
    });

    it('treats project_code as globally unique without disclosing existing project metadata', async () => {
        await fs.writeFile(configPath, yaml.dump({
            organizations: [{ id: 'unson' }, { id: 'other-company' }],
            projects: [{
                id: 'growin', project_code: 'growin', name: '非公開名称',
                organization: 'unson', created_by: 'keigo'
            }]
        }));

        let failure;
        try {
            await service.createProjectProfile({
                project_code: 'growin',
                name: '別組織のGrowin',
                organization: 'other-company',
                created_by: 'other-user'
            }, { organizationId: 'other-company', role: 'ceo', projectCodes: [] });
        } catch (error) {
            failure = error;
        }
        expect(failure).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
        expect(failure.message).toBe("Projectコード 'growin' は既に利用されています");
        expect(JSON.stringify(failure)).not.toContain('非公開名称');
        expect(JSON.stringify(failure)).not.toContain('unson');
    });

    it('checks tenant scope before revealing that a project_code exists', async () => {
        const input = {
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        };
        await service.createProjectProfile(input, ceoAccess);

        await expect(service.createProjectProfile(input, {
            organizationId: 'other-company', role: 'ceo', projectCodes: []
        })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });

    it('blocks an unknown organization when an organization catalog is configured', async () => {
        await expect(service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'other-company',
            created_by: 'keigo'
        }, { ...ceoAccess, organizationId: 'other-company' })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR', statusCode: 400
        });
    });

    it('configures capabilities independently and keeps project registered', async () => {
        await service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, ceoAccess);
        await service.configureProjectProfile('growin', {
            capabilities: {
                slack: { desired_state: 'enabled' },
                mana: { desired_state: 'disabled' },
                github: { desired_state: 'deferred' }
            }
        }, gmAccess);

        const inspection = await service.inspectProjectProfile('growin', gmAccess);
        expect(inspection.project).toBe('registered');
        expect(inspection.capabilities).toMatchObject({
            slack: 'unconfigured',
            mana: 'disabled',
            github: 'deferred'
        });

        await service.configureProjectProfile('growin', {
            capabilities: { slack: { primary_channel_id: 'C123456' } }
        }, gmAccess);
        const configured = await service.inspectProjectProfile('growin', gmAccess);
        expect(configured.capabilities.slack).toBe('unverified');
    });

    it('does not allow configure to move a project to another organization', async () => {
        await service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, ceoAccess);

        await expect(service.configureProjectProfile('growin', { organization: 'other' }, gmAccess))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    });

    it('blocks a reference explicitly declared as belonging to another organization', async () => {
        await service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, ceoAccess);

        await expect(service.configureProjectProfile('growin', {
            capabilities: {
                slack: {
                    desired_state: 'enabled',
                    primary_channel_id: 'C-OTHER',
                    organization: 'other-company'
                }
            }
        }, gmAccess)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    });

    it('denies a cross-organization people candidate with an auditable error', async () => {
        await service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, ceoAccess);

        await expect(service.reconcileProjectProfile('growin', [{
            person_id: 'other-person',
            organization: 'other-company',
            evidence: ['slack']
        }], gmAccess)).rejects.toMatchObject({
            message: '別組織に属する関係者候補は追加できません',
            code: 'CROSS_TENANT_CANDIDATE',
            statusCode: 403,
            details: {
                required_action: 'none',
                audit_event: 'cross_tenant_candidate_denied'
            }
        });
    });

    it('returns a Project-specific Japanese error when the profile does not exist', async () => {
        await expect(service.getProjectProfile('aitel', gmAccess)).rejects.toMatchObject({
            message: 'Project「aitel」が見つかりません',
            code: 'PROJECT_NOT_FOUND',
            statusCode: 404
        });
    });

    it('returns the same Japanese Project error when configuring a missing profile', async () => {
        await expect(service.configureProjectProfile('aitel', { name: '更新' }, gmAccess))
            .rejects.toMatchObject({
                message: 'Project「aitel」が見つかりません',
                code: 'PROJECT_NOT_FOUND',
                statusCode: 404
            });
    });

    it('requires signed tenant scope for create and blocks cross-tenant creation', async () => {
        const input = {
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        };
        await expect(service.createProjectProfile(input)).rejects.toMatchObject({
            code: 'FORBIDDEN', statusCode: 403
        });
        await expect(service.createProjectProfile(input, {
            organizationId: 'other-company', role: 'ceo'
        })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });

    it('blocks GM and admin outside the project scope and a CEO outside the tenant', async () => {
        await service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, ceoAccess);
        await expect(service.inspectProjectProfile('growin', {
            organizationId: 'unson', role: 'gm', projectCodes: ['another-project']
        })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        await expect(service.inspectProjectProfile('growin', {
            organizationId: 'unson', role: 'admin', projectCodes: ['another-project']
        })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        await expect(service.inspectProjectProfile('growin', {
            organizationId: 'other-company', role: 'ceo'
        })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });

    it('blocks registration when the organization catalog is missing', async () => {
        await fs.writeFile(configPath, 'projects: []\n');
        await expect(service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, ceoAccess)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    });

    it('invalidates an old verification receipt when connection settings change', async () => {
        await fs.writeFile(configPath, yaml.dump({
            organizations: [{ id: 'unson' }],
            projects: [{
                id: 'growin',
                project_code: 'growin',
                name: 'Growin向けBrainbase',
                organization: 'unson',
                created_by: 'keigo',
                capabilities: {
                    slack: {
                        desired_state: 'enabled',
                        primary_channel_id: 'C-OLD',
                        verification: {
                            status: 'verified',
                            evidence_id: 'receipt-old',
                            verified_at: '2026-09-01T00:00:00.000Z'
                        }
                    }
                }
            }]
        }));

        expect((await service.inspectProjectProfile('growin', gmAccess)).capabilities.slack).toBe('ready');
        await service.configureProjectProfile('growin', {
            capabilities: { slack: { primary_channel_id: 'C-NEW' } }
        }, gmAccess);

        const stored = await service.getProjectProfile('growin', gmAccess);
        expect(stored.capabilities.slack.verification).toBeUndefined();
        expect((await service.inspectProjectProfile('growin', gmAccess)).capabilities.slack).toBe('unverified');
    });

    it('rejects inconsistent signed tenant claims', async () => {
        await expect(service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, { ...ceoAccess, tenantId: 'other-company' })).rejects.toMatchObject({
            code: 'FORBIDDEN', statusCode: 403
        });
    });

    it('applies tenant and project scope before deleting a Project Profile', async () => {
        await service.createProjectProfile({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        }, ceoAccess);

        await expect(service.deleteProject('growin', {
            organizationId: 'other-company', role: 'ceo'
        })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        expect((await service.getProjectProfile('growin', gmAccess)).project_code).toBe('growin');
    });

    it('applies tenant and project scope to legacy writes targeting a Project Profile', async () => {
        await fs.writeFile(configPath, yaml.dump({
            organizations: [{ id: 'unson' }],
            projects: [{
                id: 'growin',
                project_code: 'growin',
                name: 'Growin向けBrainbase',
                organization: 'unson',
                created_by: 'keigo',
                github: { owner: 'Unson-LLC', repo: 'growin', branch: 'main' },
                nocodb: { base_id: 'base-old', project_id: 'nocodb-growin' }
            }]
        }));

        const otherTenant = { organizationId: 'other-company', role: 'ceo' };
        const otherProject = { organizationId: 'unson', role: 'gm', projectCodes: ['other-project'] };

        await expect(service.upsertProject({
            id: 'growin', local_path: '/tmp/growin', glob_include: []
        }, otherTenant)).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        await expect(service.upsertGitHubMapping({
            project_id: 'growin', owner: 'Unson-LLC', repo: 'other-repo'
        }, otherProject)).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        await expect(service.upsertNocoDBMapping({
            project_id: 'growin', nocodb_project_id: 'other-project'
        }, otherTenant)).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        await expect(service.deleteGitHubMapping('growin', otherTenant))
            .rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        await expect(service.deleteNocoDBMapping('growin', otherProject))
            .rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

        const stored = await service.getProjectProfile('growin', gmAccess);
        expect(stored.github).toEqual({ owner: 'Unson-LLC', repo: 'growin', branch: 'main' });
        expect(stored.nocodb).toMatchObject({ project_id: 'nocodb-growin' });
    });

    it('invalidates trusted GitHub verification when a legacy mapping changes', async () => {
        await fs.writeFile(configPath, yaml.dump({
            organizations: [{ id: 'unson' }],
            projects: [{
                id: 'growin',
                project_code: 'growin',
                name: 'Growin向けBrainbase',
                organization: 'unson',
                created_by: 'keigo',
                github: { owner: 'Unson-LLC', repo: 'growin', branch: 'main' },
                capabilities: {
                    github: {
                        desired_state: 'enabled',
                        owner: 'Unson-LLC',
                        repo: 'growin',
                        verification: {
                            status: 'verified',
                            evidence_id: 'github-receipt-old',
                            verified_at: '2026-09-01T00:00:00.000Z'
                        }
                    }
                }
            }]
        }));

        expect((await service.inspectProjectProfile('growin', gmAccess)).capabilities.github).toBe('ready');
        await service.upsertGitHubMapping({
            project_id: 'growin', owner: 'Unson-LLC', repo: 'growin-next', branch: 'main'
        }, gmAccess);

        const stored = await service.getProjectProfile('growin', gmAccess);
        expect(stored.capabilities.github.verification).toBeUndefined();
        expect((await service.inspectProjectProfile('growin', gmAccess)).capabilities.github).toBe('unverified');
    });
});
