// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
    parseArgs,
    resolveAutoPublishEnabled,
    resolveTenantJobBoundary,
    resolveSnsPostingLedgerDatabaseUrl,
    resolveSnsPostingLedgerFile,
    validateArgs
} from '../../../scripts/run-sns-scheduled-posts.js';

describe('run-sns-scheduled-posts', () => {
    it('parses scheduler runner arguments', () => {
        expect(parseArgs([
            '--now', '2026-05-14T12:00:00.000Z',
            '--limit', '5',
            '--dry-run',
            '--json'
        ])).toMatchObject({
            now: '2026-05-14T12:00:00.000Z',
            limit: 5,
            dryRun: true,
            json: true
        });
    });

    it('rejects invalid now and limit values', () => {
        expect(() => validateArgs(parseArgs(['--now', 'invalid']))).toThrow('--now must be an ISO datetime');
        expect(() => validateArgs(parseArgs(['--limit', '0']))).toThrow('--limit must be a positive integer');
    });

    it('requires explicit SNS_AUTO_PUBLISH_ENABLED=true for public publishing', () => {
        expect(resolveAutoPublishEnabled({ SNS_AUTO_PUBLISH_ENABLED: 'true' })).toBe(true);
        expect(resolveAutoPublishEnabled({ SNS_AUTO_PUBLISH_ENABLED: '1' })).toBe(true);
        expect(resolveAutoPublishEnabled({ SNS_AUTO_PUBLISH_ENABLED: 'false' })).toBe(false);
        expect(resolveAutoPublishEnabled({})).toBe(false);
    });

    it('uses the same JSON ledger fallback as the SNS Growth route in test mode', () => {
        expect(resolveSnsPostingLedgerDatabaseUrl({
            BRAINBASE_TEST_MODE: 'true',
            INFO_SSOT_DATABASE_URL: 'postgres://info'
        })).toBe('');
        expect(resolveSnsPostingLedgerDatabaseUrl({
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://sns',
            BRAINBASE_TEST_MODE: 'true'
        })).toBe('postgres://sns');
        expect(resolveSnsPostingLedgerFile({}, '/repo')).toBe('/repo/var/sns-posting-ledger.json');
    });

    it.each([
        ['unset', {}],
        ['disabled', { BRAINBASE_TENANT_RUNTIME_ENABLED: '0' }]
    ])('AC-005 fails closed before public publishing when tenant runtime is %s', (_label, env) => {
        const createServices = vi.fn();

        expect(() => resolveTenantJobBoundary({
            env,
            pool: null,
            requireTenantBoundary: true,
            createServices
        })).toThrow('Tenant runtime is required for public scheduled publishing');
        expect(createServices).not.toHaveBeenCalled();
    });

    it('AC-005 injects the production background_job gateway into the scheduler publisher', async () => {
        const authorize = vi.fn(async () => ({ authorized: true }));
        const pool = { query: vi.fn() };
        const boundary = resolveTenantJobBoundary({
            env: { BRAINBASE_TENANT_RUNTIME_ENABLED: '1' },
            pool,
            requireTenantBoundary: true,
            createServices: vi.fn(() => ({ tenantBoundaryGateway: { authorize } }))
        });
        const tenantContext = { tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '7' } };
        const resourceRef = { object_type: 'project', resource_id: 'project_sns' };

        await boundary.tenantBoundaryAuthorizer({ tenant_context: tenantContext, resource_ref: resourceRef });

        expect(authorize).toHaveBeenCalledWith({
            tenant_context: tenantContext,
            entry_point: 'background_job',
            resource_ref: resourceRef
        });
        expect(boundary.tenantIsolationRequired).toBe(true);
    });
});
