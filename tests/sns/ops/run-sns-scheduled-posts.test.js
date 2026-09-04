// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
    parseArgs,
    resolveAutoPublishEnabled,
    resolveSnsScheduledPublisherActor,
    resolveTenantJobBoundary,
    resolveSnsPostingLedgerDatabaseUrl,
    resolveSnsPostingLedgerFile,
    runScheduledPosts,
    shouldUseJsonLedgerForTest,
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

    it('builds a canonical actor from explicit deployment-local identity settings', () => {
        expect(resolveSnsScheduledPublisherActor({
            SNS_ACTOR_PERSON_ID: 'person_scheduler',
            SNS_ORGANIZATION_ID: 'org_scheduler',
            SNS_ACTOR_ROLE: 'gm',
            SNS_ACTOR_PROJECT_CODES: 'brainbase, sns, brainbase'
        })).toEqual({
            sub: 'person_scheduler',
            actor_person_id: 'person_scheduler',
            organization_id: 'org_scheduler',
            org_ids: ['org_scheduler'],
            role: 'gm',
            projectCodes: ['brainbase', 'sns']
        });
    });

    it.each([
        ['SNS_ACTOR_PERSON_ID', { SNS_ORGANIZATION_ID: 'org_scheduler' }],
        ['SNS_ORGANIZATION_ID', { SNS_ACTOR_PERSON_ID: 'person_scheduler' }]
    ])('requires %s even when the runner is only dry-running', async (missingName, env) => {
        expect(() => resolveSnsScheduledPublisherActor(env)).toThrow(`${missingName} is required for scheduled SNS publishing`);
        await expect(runScheduledPosts({
            argv: ['--dry-run'],
            env: { ...env, BRAINBASE_TEST_MODE: 'true', SNS_POSTING_LEDGER_MODE: 'json_test' },
            PoolClass: vi.fn(),
            output: { log: vi.fn() }
        })).rejects.toThrow(`${missingName} is required for scheduled SNS publishing`);
    });

    it('uses least privilege defaults and rejects malformed optional actor settings', () => {
        expect(resolveSnsScheduledPublisherActor({
            SNS_ACTOR_PERSON_ID: 'person_scheduler',
            SNS_ORGANIZATION_ID: 'org_scheduler'
        })).toMatchObject({ role: 'member', projectCodes: [] });
        expect(() => resolveSnsScheduledPublisherActor({
            SNS_ACTOR_PERSON_ID: 'person_scheduler',
            SNS_ORGANIZATION_ID: 'org_scheduler',
            SNS_ACTOR_ROLE: ' '
        })).toThrow('SNS_ACTOR_ROLE must not be empty when provided');
        expect(() => resolveSnsScheduledPublisherActor({
            SNS_ACTOR_PERSON_ID: 'person_scheduler',
            SNS_ORGANIZATION_ID: 'org_scheduler',
            SNS_ACTOR_PROJECT_CODES: ' , '
        })).toThrow('SNS_ACTOR_PROJECT_CODES must contain at least one project code');
    });

    it('uses JSON only with the same explicit two-flag test mode as the SNS Growth route', () => {
        expect(resolveSnsPostingLedgerDatabaseUrl({
            BRAINBASE_TEST_MODE: 'true',
            INFO_SSOT_DATABASE_URL: 'postgres://info'
        })).toBe('');
        expect(resolveSnsPostingLedgerDatabaseUrl({
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://sns',
            BRAINBASE_TEST_MODE: 'true'
        })).toBe('postgres://sns');
        expect(resolveSnsPostingLedgerFile({}, '/repo')).toBe('/repo/var/sns-posting-ledger.json');
        expect(shouldUseJsonLedgerForTest({
            BRAINBASE_TEST_MODE: 'true',
            SNS_POSTING_LEDGER_MODE: 'json_test'
        })).toBe(true);
        expect(shouldUseJsonLedgerForTest({ BRAINBASE_TEST_MODE: 'true' })).toBe(false);
        expect(shouldUseJsonLedgerForTest({ SNS_POSTING_LEDGER_MODE: 'json_test' })).toBe(false);
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
