import { describe, expect, it } from 'vitest';

import {
    findRetiredTrackedPaths,
    validateOwnershipContract,
    validateRepositoryClassification
} from '../../scripts/check-repository-classification.mjs';

const policy = 'brainbase-unson brainbase-organization growin-project';
const instruction = 'docs/policies/repository-classification.md';

describe('repository classification check', () => {
    it('accepts the canonical policy and distribution boundaries', () => {
        expect(validateRepositoryClassification({
            trackedPaths: ['AGENTS.md', 'examples/codex/README.md'],
            claude: instruction,
            agents: instruction,
            policyExists: true,
            policy
        })).toEqual([]);
    });

    it.each(['shared/file.md', '_codex/project.md', 'settings/nocodb/config.json', 'common/frameworks/x.md'])(
        'rejects retired canonical root %s',
        (trackedPath) => {
            expect(findRetiredTrackedPaths([trackedPath])).toEqual([trackedPath]);
        }
    );

    it('does not confuse the examples directory with the retired _codex root', () => {
        expect(findRetiredTrackedPaths(['examples/codex/README.md'])).toEqual([]);
    });

    it('reports a missing boundary instead of treating partial documentation as complete', () => {
        const errors = validateRepositoryClassification({
            trackedPaths: [],
            claude: instruction,
            agents: instruction,
            policyExists: true,
            policy: 'brainbase-unson brainbase-organization'
        });
        expect(errors).toContain('分類方針に growin-project の境界がありません');
    });
});

describe('repository ownership contract', () => {
    const validContract = {
        version: 1,
        components: [
            {
                id: 'organization-connections',
                current_repository: 'brainbase-unson',
                final_repository: 'brainbase-organization',
                product_scope: 'organization_product',
                lifecycle: 'migration_pending',
                current_paths: ['server/routes/organization-connections.js'],
                migration_condition: 'tenant and credential ports are extracted with contract tests'
            },
            {
                id: 'provider-deployment',
                current_repository: 'brainbase-unson',
                final_repository: 'brainbase-unson',
                product_scope: 'provider_operations',
                lifecycle: 'canonical',
                current_paths: ['scripts/check-repository-classification.mjs']
            }
        ]
    };

    it('accepts explicit current and final ownership', () => {
        expect(validateOwnershipContract(validContract, new Set([
            'server/routes/organization-connections.js',
            'scripts/check-repository-classification.mjs'
        ]))).toEqual([]);
    });

    it('rejects ambiguous lifecycle and duplicate component ids', () => {
        const errors = validateOwnershipContract({
            ...validContract,
            components: [validContract.components[0], { ...validContract.components[0], lifecycle: 'partial' }]
        }, new Set(['server/routes/organization-connections.js']));
        expect(errors).toContain('所有台帳の component id が重複しています: organization-connections');
        expect(errors).toContain('organization-connections の lifecycle が不正です: partial');
    });

    it('requires a migration condition and a different final repository for pending moves', () => {
        const errors = validateOwnershipContract({
            version: 1,
            components: [{
                ...validContract.components[0],
                final_repository: 'brainbase-unson',
                migration_condition: ''
            }]
        }, new Set(['server/routes/organization-connections.js']));
        expect(errors).toContain('organization-connections の移管先が現所在地と同じです');
        expect(errors).toContain('organization-connections に migration_condition がありません');
    });

    it('requires tracked evidence for components physically located in this repository', () => {
        const errors = validateOwnershipContract(validContract, new Set([
            'scripts/check-repository-classification.mjs'
        ]));
        expect(errors).toContain('organization-connections の現物が追跡されていません: server/routes/organization-connections.js');
    });
});
