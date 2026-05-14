#!/usr/bin/env node
// @ts-check
import process from 'node:process';
import path from 'node:path';
import pg from 'pg';

import { PgAccountRepository } from '../server/services/account/account-repository.js';
import { XApiClient } from '../server/services/sns/providers/x-client.js';
import {
    JsonFileSnsPostingLedgerRepository,
    PgSnsPostingLedgerRepository
} from '../server/services/sns/posting-ledger-repository.js';
import { SnsMetricsPoller } from '../server/services/sns/sns-metrics-poller.js';
import { databaseConfig } from './migrate-m5a-production-schema.js';

const { Pool } = pg;

export function parseArgs(argv) {
    const args = {
        limit: 20,
        dryRun: false,
        json: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--limit') args.limit = Number(argv[++i]);
        if (arg === '--dry-run') args.dryRun = true;
        if (arg === '--json') args.json = true;
    }
    return args;
}

export function validateArgs(args) {
    if (!Number.isInteger(args.limit) || args.limit < 1) {
        throw new Error('--limit must be a positive integer');
    }
}

export function resolveMetricsPollingEnabled(env = process.env) {
    return ['true', '1', 'yes'].includes(String(env.SNS_METRICS_POLLING_ENABLED || '').toLowerCase());
}

export function resolveSnsPostingLedgerDatabaseUrl(env = process.env) {
    if (env.SNS_POSTING_LEDGER_DATABASE_URL) return env.SNS_POSTING_LEDGER_DATABASE_URL;
    if (env.BRAINBASE_TEST_MODE === 'true') return '';
    return env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL || env.DATABASE_URL || '';
}

export function resolveSnsPostingLedgerFile(env = process.env, cwd = process.cwd()) {
    return env.SNS_POSTING_LEDGER_FILE || path.join(cwd, 'var', 'sns-posting-ledger.json');
}

function consoleAnomalyNotifier(info) {
    console.error(JSON.stringify({
        level: 'warn',
        event: 'sns_metrics_anomaly',
        ...info
    }));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    validateArgs(args);
    const enabled = resolveMetricsPollingEnabled();
    if (!enabled && !args.dryRun) {
        console.log(JSON.stringify({
            skipped: true,
            reason: 'metrics_polling_disabled',
            hint: 'Set SNS_METRICS_POLLING_ENABLED=true or run with --dry-run.'
        }, null, 2));
        return;
    }

    const databaseUrl = resolveSnsPostingLedgerDatabaseUrl();
    const pool = databaseUrl ? new Pool(databaseConfig({
        ...process.env,
        SNS_POSTING_LEDGER_DATABASE_URL: databaseUrl
    })) : null;
    try {
        const ledgerRepository = pool
            ? new PgSnsPostingLedgerRepository({ pool })
            : new JsonFileSnsPostingLedgerRepository({ filePath: resolveSnsPostingLedgerFile() });
        const accountRepository = pool
            ? new PgAccountRepository({ pool })
            : {
                async findById(id) {
                    return {
                        id,
                        credential_ref: {
                            provider: 'env',
                            path: 'SNS_X_ACCESS_TOKEN',
                            env: 'SNS_X_ACCESS_TOKEN'
                        }
                    };
                }
            };
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository,
            xClient: new XApiClient(),
            anomalyNotifier: consoleAnomalyNotifier
        });
        const result = await poller.run({ limit: args.limit, dry_run: args.dryRun });
        const output = JSON.stringify(result, null, 2);
        if (args.json) {
            console.log(output);
        } else {
            console.log(`SNS metrics poller: scanned=${result.scanned} polled=${result.polled} failed=${result.failed} anomalies=${result.anomalies.length} dry_run=${result.dry_run}`);
            console.log(output);
        }
        if (result.failed > 0) process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
