// @ts-check
import { describe, expect, it } from 'vitest';

import {
    parseArgs,
    resolveAutoPublishEnabled,
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
});
