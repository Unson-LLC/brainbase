import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    fingerprintProjectProvisioningManifest,
    normalizeProjectProvisioningManifest
} from '../../../server/services/project-provisioning/project-provisioning-manifest.js';

const valid = {
    schema_version: 'project-provisioning.v1',
    project_code: 'growin-ai',
    display_name: 'Growin AI',
    kind: 'client',
    catalog_version: 1,
    session_select: true,
    organization_entity_id: 'org_unson',
    owner_person_id: 'person_owner',
    initial_grants: [{ person_id: 'person_owner', role: 'gm' }],
    repository: { mode: 'link_existing', owner: 'Unson-LLC', repo: 'growin-project' }
};

describe('Project Provisioning Manifest', () => {
    it('canonical v1 manifestを正規化する', () => {
        expect(normalizeProjectProvisioningManifest(valid)).toMatchObject({
            project_code: 'growin-ai',
            repository: { mode: 'link_existing', visibility: 'private' }
        });
    });

    it('local_pathと未知フィールドをfail-closedで拒否する', () => {
        expect(() => normalizeProjectProvisioningManifest({ ...valid, local_path: '/tmp/growin' }))
            .toThrow(/Unknown manifest fields: local_path/);
        expect(() => normalizeProjectProvisioningManifest({ ...valid, surprise: true }))
            .toThrow(/Unknown manifest fields: surprise/);
        expect(() => normalizeProjectProvisioningManifest({
            ...valid, repository: { ...valid.repository, template: 'secret-template' }
        })).toThrow(/repository has unknown fields: template/);
        expect(() => normalizeProjectProvisioningManifest({
            ...valid, initial_grants: [{ ...valid.initial_grants[0], project_codes: ['other'] }]
        })).toThrow(/initial_grants\[0\] has unknown fields: project_codes/);
    });

    it('Project Provisioningの実行経路はConnected-world Onboardingを起動しない', () => {
        const executionSurfaces = [
            'server/services/project-provisioning/project-provisioning-service.js',
            'server/routes/project-provisioning.js',
            'cli/project-provisioning.js'
        ];

        for (const file of executionSurfaces) {
            const source = fs.readFileSync(file, 'utf8');
            expect(source, `${file} must not depend on onboarding runtime`)
                .not.toMatch(/onboardingRuntimeService|services\/onboarding|\/api\/onboarding/);
        }
    });

    it('キー順に依存しないfingerprintを作る', () => {
        const normalized = normalizeProjectProvisioningManifest(valid);
        expect(fingerprintProjectProvisioningManifest(normalized))
            .toBe(fingerprintProjectProvisioningManifest({ ...normalized }));
    });
});
