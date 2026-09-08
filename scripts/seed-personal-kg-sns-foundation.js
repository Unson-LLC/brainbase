#!/usr/bin/env node
// @ts-check
import process from 'node:process';
import pg from 'pg';

import {
    PgCandidateRepository,
    DuplicateCandidateError
} from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import {
    buildSatoKeigoSnsFoundationCandidates,
    SATO_KEIGO_SNS_FOUNDATION_SEED_VERSION
} from '../server/seeds/personal-kg/sato-keigo-sns-foundation-candidates.js';
import { throwRetiredSnsCli } from './lib/retired-sns-cli.js';

const { Pool } = pg;

function parseArgs(argv) {
    return {
        dryRun: argv.includes('--dry-run'),
        json: argv.includes('--json')
    };
}

function databaseConfig() {
    if (process.env.DATABASE_URL) {
        return { connectionString: process.env.DATABASE_URL };
    }
    return {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 25432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD
    };
}

function validateConfig(config) {
    if (config.connectionString) return;
    const missing = ['database', 'user'].filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing PostgreSQL config: ${missing.join(', ')}. Set DATABASE_URL or PGDATABASE/PGUSER.`);
    }
}

async function seedCandidates(service, candidates) {
    const summary = {
        version: SATO_KEIGO_SNS_FOUNDATION_SEED_VERSION,
        total: candidates.length,
        inserted: 0,
        skipped: 0,
        blocked: 0,
        ids: []
    };

    for (const candidate of candidates) {
        try {
            const result = await service.createCandidate(candidate);
            if (result.blocked) {
                summary.blocked += 1;
                continue;
            }
            summary.inserted += 1;
            summary.ids.push(result.candidate.id);
        } catch (error) {
            if (error instanceof DuplicateCandidateError) {
                summary.skipped += 1;
                continue;
            }
            throw error;
        }
    }
    return summary;
}

async function main() {
    throwRetiredSnsCli('seed-personal-kg-sns-foundation.js');
    const args = parseArgs(process.argv.slice(2));
    const candidates = buildSatoKeigoSnsFoundationCandidates();

    if (args.dryRun) {
        const summary = {
            version: SATO_KEIGO_SNS_FOUNDATION_SEED_VERSION,
            total: candidates.length,
            dryRun: true,
            ids: candidates.map((candidate) => candidate.id)
        };
        console.log(args.json ? JSON.stringify(summary, null, 2) : `dry-run: ${summary.total} candidates ready`);
        return;
    }

    const config = databaseConfig();
    validateConfig(config);
    const pool = new Pool(config);
    try {
        const repository = new PgCandidateRepository({ pool });
        const service = new PromotionGateService({ repository });
        const summary = await seedCandidates(service, candidates);
        console.log(args.json ? JSON.stringify(summary, null, 2) : `seeded ${summary.inserted}, skipped ${summary.skipped}, blocked ${summary.blocked}`);
    } finally {
        await pool.end();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export { seedCandidates };
