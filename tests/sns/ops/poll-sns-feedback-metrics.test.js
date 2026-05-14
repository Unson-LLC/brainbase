// @ts-check
import { describe, expect, it } from 'vitest';

import {
    parseArgs,
    resolveMetricsPollingEnabled,
    resolveSnsPostingLedgerDatabaseUrl,
    validateArgs
} from '../../../scripts/poll-sns-feedback-metrics.js';

describe('poll-sns-feedback-metrics', () => {
    it('parses metrics poller runner arguments', () => {
        expect(parseArgs([
            '--limit', '5',
            '--dry-run',
            '--json'
        ])).toMatchObject({
            limit: 5,
            dryRun: true,
            json: true
        });
    });

    it('rejects invalid limit values', () => {
        expect(() => validateArgs(parseArgs(['--limit', '0']))).toThrow('--limit must be a positive integer');
    });

    it('requires explicit SNS_METRICS_POLLING_ENABLED=true outside dry-run', () => {
        expect(resolveMetricsPollingEnabled({ SNS_METRICS_POLLING_ENABLED: 'true' })).toBe(true);
        expect(resolveMetricsPollingEnabled({ SNS_METRICS_POLLING_ENABLED: '1' })).toBe(true);
        expect(resolveMetricsPollingEnabled({ SNS_METRICS_POLLING_ENABLED: 'false' })).toBe(false);
        expect(resolveMetricsPollingEnabled({})).toBe(false);
    });

    it('uses the same production database selection precedence as SNS Ledger operations', () => {
        expect(resolveSnsPostingLedgerDatabaseUrl({
            BRAINBASE_TEST_MODE: 'true',
            INFO_SSOT_DATABASE_URL: 'postgres://info'
        })).toBe('');
        expect(resolveSnsPostingLedgerDatabaseUrl({
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://sns',
            BRAINBASE_TEST_MODE: 'true'
        })).toBe('postgres://sns');
        expect(resolveSnsPostingLedgerDatabaseUrl({
            INFO_SSOT_DATABASE_URL: 'postgres://info'
        })).toBe('postgres://info');
    });
});
