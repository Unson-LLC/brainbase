// @ts-check
import { describe, expect, it } from 'vitest';

import { resolveSnsPostingLedgerDatabaseUrl } from '../../../server/bootstrap/register-api-routes.js';
import { databaseConfig, selectedMigrations } from '../../../scripts/migrate-m5a-production-schema.js';

describe('SNS posting ledger runtime database config', () => {
    it('prefers a dedicated SNS ledger database URL when configured', () => {
        expect(resolveSnsPostingLedgerDatabaseUrl({
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://sns-ledger',
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toBe('postgres://sns-ledger');
        expect(databaseConfig({
            DATABASE_URL: 'postgres://generic',
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://sns-ledger',
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toEqual({ connectionString: 'postgres://sns-ledger' });
    });

    it('falls back to the existing Info SSOT PostgreSQL URL for the shared Lightsail database', () => {
        expect(resolveSnsPostingLedgerDatabaseUrl({
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toBe('postgres://info-ssot');
        expect(databaseConfig({
            DATABASE_URL: 'postgres://generic',
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toEqual({ connectionString: 'postgres://info-ssot' });
    });

    it('keeps test server runs on the JSON ledger unless a dedicated SNS URL is configured', () => {
        expect(resolveSnsPostingLedgerDatabaseUrl({
            BRAINBASE_TEST_MODE: 'true',
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toBe('');
        expect(resolveSnsPostingLedgerDatabaseUrl({
            BRAINBASE_TEST_MODE: 'true',
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://sns-ledger',
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toBe('postgres://sns-ledger');
    });

    it('can scope M5 migration to the SNS posting ledger schema', () => {
        expect(selectedMigrations(['--only', 'sns-posting-ledger']).map((migration) => migration.path))
            .toEqual(['server/sql/sns-posting-ledger-schema.sql']);
    });
});
