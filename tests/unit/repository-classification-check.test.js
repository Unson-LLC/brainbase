import { describe, expect, it } from 'vitest';

import {
    findRetiredTrackedPaths,
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
