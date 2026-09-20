import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runAuthenticatedTenantAccessResolverMigration } from '../../../scripts/migrate-authenticated-tenant-access-resolver.js';

describe('authenticated tenant access resolver migration', () => {
    it('keeps RLS bypass inside a dedicated non-login function owner', async () => {
        const sql = await readFile(path.join(process.cwd(), 'server/sql/authenticated-tenant-access-resolver.sql'), 'utf8');

        expect(sql).toContain('CREATE ROLE brainbase_authenticated_tenant_resolver NOLOGIN NOSUPERUSER BYPASSRLS');
        expect(sql).toContain('SET row_security = off');
        expect(sql).toContain('OWNER TO brainbase_authenticated_tenant_resolver');
        expect(sql).toContain('REVOKE ALL ON FUNCTION public.resolve_active_tenant_for_authenticated_access');
        expect(sql).not.toMatch(/ALTER ROLE brainbase_app[^;]*BYPASSRLS/i);
    });

    it('rejects check when the resolver owner cannot bypass forced RLS', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce({ rows: [{
                prosecdef: true,
                proconfig: ['search_path=pg_catalog', 'row_security=off'],
                owner_name: 'brainbase_authenticated_tenant_resolver',
                owner_is_superuser: false,
                owner_bypasses_rls: false,
                owner_can_login: false,
                app_role_exists: true,
                app_can_execute: true,
                public_execute_revoked: true
            }] });
        const client = { query, release: vi.fn() };
        const pool = { connect: vi.fn().mockResolvedValue(client) };

        await expect(runAuthenticatedTenantAccessResolverMigration({ argv: ['--check'], pool }))
            .rejects.toThrow('security contract readback failed');
    });
});
