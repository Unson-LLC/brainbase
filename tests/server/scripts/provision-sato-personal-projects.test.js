import { describe, expect, it } from 'vitest';

import {
    PERSONAL_PROJECTS_TARGET,
    parseProvisionSatoPersonalArgs
} from '../../../scripts/provision-sato-personal-projects.js';

describe('provision-sato-personal-projects CLI', () => {
    it('accepts one read-only mode without an actor', () => {
        expect(parseProvisionSatoPersonalArgs(['--check'], {})).toEqual({ mode: 'check', actorId: 'check' });
        expect(parseProvisionSatoPersonalArgs(['--dry-run'], {})).toEqual({ mode: 'dry-run', actorId: 'dry-run' });
    });

    it('requires explicit approval and actor for apply', () => {
        expect(() => parseProvisionSatoPersonalArgs(['--apply'], {})).toThrow(/approve-apply/);
        expect(() => parseProvisionSatoPersonalArgs(['--apply', '--approve-apply'], {})).toThrow(/ACTOR_REQUIRED/);
        expect(parseProvisionSatoPersonalArgs(
            ['--apply', '--approve-apply'],
            { BRAINBASE_PROVISIONING_ACTOR: 'codex:sato-personal-v1' }
        )).toEqual({ mode: 'apply', actorId: 'codex:sato-personal-v1' });
    });

    it('has no caller-configurable target and keeps the personal boundary fixed', () => {
        expect(() => parseProvisionSatoPersonalArgs(['--check', '--organization', 'unson'], {})).toThrow(/Unsupported/);
        expect(PERSONAL_PROJECTS_TARGET).toMatchObject({
            tenant_key: 'sato-personal',
            organization_id: 'sato-personal',
            project_codes: ['fx', 'keiba']
        });
    });
});
