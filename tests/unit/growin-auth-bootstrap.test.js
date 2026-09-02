// @ts-check
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    GROWIN_INITIAL_USERS,
    buildGrowinAuthBootstrapPlan
} from '../../scripts/growin/provision-auth-identities.mjs';

describe('Growin auth bootstrap', () => {
    it('keeps the shared auth schema applicable to an isolated tenant database', () => {
        const schema = fs.readFileSync(path.resolve('server/sql/info-ssot-schema.sql'), 'utf8');
        const authGrantBackfill = schema.slice(
            schema.indexOf('ALTER TABLE auth_grants ADD COLUMN IF NOT EXISTS organization_id text;'),
            schema.indexOf('CREATE TABLE IF NOT EXISTS auth_identities')
        );

        expect(authGrantBackfill).toContain("IF to_regclass('organizations') IS NOT NULL THEN");
    });

    it('does not move an existing Workspace identity to another person', () => {
        const source = fs.readFileSync(
            path.resolve('scripts/growin/provision-auth-identities.mjs'),
            'utf8'
        );

        expect(source).toContain('WHERE auth_identities.person_id = EXCLUDED.person_id');
        expect(source).toContain('if (identityResult.rowCount !== 1)');
    });

    it('fails the remote verifier on JSON-RPC errors instead of treating them as empty data', () => {
        const source = fs.readFileSync(
            path.resolve('scripts/growin/verify-remote-e2e.sh'),
            'utf8'
        );

        expect(source).toContain('if .error then error(.error.message // "JSON-RPC error")');
        expect(source).toContain('else error("JSON-RPC result missing") end');
    });

    it('binds only confirmed Workspace addresses to canonical people', () => {
        expect(GROWIN_INITIAL_USERS).toEqual([
            {
                personId: 'person_kato_shintaro',
                personName: '加藤 真太郎',
                email: 's.kato@growin.jp',
                role: 'member'
            },
            {
                personId: 'person_kawamura_tatsumi',
                personName: '川村 達見',
                email: 't.kawamura@growin.jp',
                role: 'member'
            }
        ]);
    });

    it('creates an idempotent, Growin-only grant and identity plan', () => {
        const plan = buildGrowinAuthBootstrapPlan(GROWIN_INITIAL_USERS);

        expect(plan).toHaveLength(2);
        expect(plan.every((entry) => entry.organizationId === 'org_growin')).toBe(true);
        expect(plan.every((entry) => entry.provider === 'google-workspace')).toBe(true);
        expect(plan.every((entry) => entry.providerTenant === 'growin.jp')).toBe(true);
        expect(plan.every((entry) => entry.projectCodes.join(',') === 'growin')).toBe(true);
        expect(new Set(plan.map((entry) => entry.identityId)).size).toBe(2);
    });
});
