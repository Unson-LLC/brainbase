import { describe, expect, it } from 'vitest';

import {
    PERSONAL_PROJECTS_TARGET,
    parseProvisionSatoPersonalArgs,
    runProvisionSatoPersonal
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

    it('sets tenant and Graph authorization context before a production check', async () => {
        const observed = [];
        const client = {
            async query(sql, values = []) {
                observed.push({ sql, values });
                if (sql.includes('FROM people')) return { rows: [{ id: PERSONAL_PROJECTS_TARGET.person_id, name: '佐藤', status: 'active' }] };
                if (sql.includes('FROM auth_grants') && sql.includes('organization_id=$1') && sql.includes('active=true')) {
                    return { rows: [{ id: 'grant_unson', person_id: PERSONAL_PROJECTS_TARGET.person_id,
                        slack_user_id: PERSONAL_PROJECTS_TARGET.slack_user_id,
                        slack_workspace_id: PERSONAL_PROJECTS_TARGET.slack_workspace_id, project_codes: ['brainbase'] }] };
                }
                return { rows: [] };
            },
            release() {}
        };
        const pool = { async connect() { return client; } };

        await expect(runProvisionSatoPersonal({ argv: ['--check'], env: {}, pool })).resolves.toMatchObject({
            ok: true, mode: 'check', persisted: false, preflight: 'passed'
        });
        expect(observed.slice(1, 5)).toEqual([
            { sql: "SELECT set_config('brainbase.tenant_id', $1, true)", values: [PERSONAL_PROJECTS_TARGET.tenant_id] },
            { sql: "SELECT set_config('app.role', 'ceo', true)", values: [] },
            { sql: "SELECT set_config('app.project_codes', $1, true)", values: ['fx,keiba'] },
            { sql: "SELECT set_config('app.clearance', 'internal,restricted', true)", values: [] }
        ]);
    });
});
