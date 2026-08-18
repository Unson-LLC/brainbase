// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
    buildMetricsPollingDisabledResult,
    formatSummary,
    parseArgs,
    resolveMetricsPollingEnabled,
    resolveSnsPostingLedgerDatabaseUrl,
    shouldUseJsonLedgerForTest,
    validateArgs
} from '../../../scripts/poll-sns-feedback-metrics.js';

const execFileAsync = promisify(execFile);

describe('poll-sns-feedback-metrics', () => {
    it('parses metrics poller runner arguments', () => {
        expect(parseArgs([
            '--limit', '5',
            '--date', '2026-05-24',
            '--mark-learning-ready',
            '--dry-run',
            '--json'
        ])).toMatchObject({
            limit: 5,
            date: '2026-05-24',
            markLearningReady: true,
            dryRun: true,
            json: true
        });
    });

    it('rejects invalid limit values', () => {
        expect(() => validateArgs(parseArgs(['--limit', '0']))).toThrow('--limit must be a positive integer');
    });

    it('rejects invalid date values', () => {
        expect(() => validateArgs(parseArgs(['--date', '2026/05/24']))).toThrow('--date must be YYYY-MM-DD');
        expect(() => validateArgs(parseArgs(['--date']))).toThrow('--date requires YYYY-MM-DD');
        expect(() => validateArgs(parseArgs(['--date', '--mark-learning-ready']))).toThrow('--date requires YYYY-MM-DD');
        expect(() => validateArgs(parseArgs([]))).toThrow('--date is required for non-dry-run metrics polling');
        expect(() => validateArgs(parseArgs(['--dry-run']))).not.toThrow();
    });

    it('formats the operator summary with separate learning_ready count', () => {
        expect(formatSummary({
            date: '2026-05-24',
            scanned: 3,
            polled: 0,
            failed: 3,
            skipped: 0,
            learning_ready: { before: 0, promoted: 0, after: 0 },
            anomalies: [],
            mark_learning_ready: true,
            dry_run: true
        })).toContain('scanned=3 polled=0 failed=3 skipped=0 learning_ready=0');
    });

    it('requires explicit SNS_METRICS_POLLING_ENABLED=true outside dry-run', () => {
        expect(resolveMetricsPollingEnabled({ SNS_METRICS_POLLING_ENABLED: 'true' })).toBe(true);
        expect(resolveMetricsPollingEnabled({ SNS_METRICS_POLLING_ENABLED: '1' })).toBe(true);
        expect(resolveMetricsPollingEnabled({ SNS_METRICS_POLLING_ENABLED: 'false' })).toBe(false);
        expect(resolveMetricsPollingEnabled({})).toBe(false);
        expect(buildMetricsPollingDisabledResult()).toMatchObject({
            skipped: true,
            reason: 'metrics_polling_disabled'
        });
    });

    it('exits nonzero when metrics polling is disabled so oyasumi cannot treat it as success', async () => {
        await expect(execFileAsync('node', [
            'scripts/poll-sns-feedback-metrics.js',
            '--date', '2026-05-24',
            '--json'
        ], {
            env: {
                ...process.env,
                BRAINBASE_TEST_MODE: 'true',
                SNS_METRICS_POLLING_ENABLED: ''
            }
        })).rejects.toMatchObject({
            code: 1,
            stdout: expect.stringContaining('"reason": "metrics_polling_disabled"')
        });
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
        expect(shouldUseJsonLedgerForTest({
            BRAINBASE_TEST_MODE: 'true',
            SNS_POSTING_LEDGER_MODE: 'json_test'
        })).toBe(true);
        expect(shouldUseJsonLedgerForTest({ BRAINBASE_TEST_MODE: 'true' })).toBe(false);
    });
});
