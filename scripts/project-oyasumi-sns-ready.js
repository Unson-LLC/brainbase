#!/usr/bin/env node
// @ts-check
import process from 'node:process';
import pg from 'pg';

import { PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import {
    SOURCE_SYSTEM,
    projectSnsReadyCandidatesFromCoreCandidates,
    writeMeetingPersonalKgCandidates
} from '../server/services/sns/oyasumi-meeting-personal-kg-service.js';
import { requirePersonalKgIdentity } from '../server/services/sns/personal-kg-identity.js';
import { resolvePersonalKgCliAuthority } from './lib/personal-kg-cli-authority.js';
import { throwRetiredSnsCli } from './lib/retired-sns-cli.js';

const { Pool } = pg;

function parseArgs(argv) {
    const args = {
        date: null,
        write: false,
        json: false,
        ownerPersonId: null,
        actorPersonId: null,
        organizationId: null,
        delegationId: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--date') args.date = argv[++index];
        else if (arg.startsWith('--date=')) args.date = arg.slice('--date='.length);
        else if (arg === '--write') args.write = true;
        else if (arg === '--dry-run') args.write = false;
        else if (arg === '--json') args.json = true;
        else if (arg === '--owner' || arg === '--owner-person-id') args.ownerPersonId = argv[++index];
        else if (arg.startsWith('--owner=')) args.ownerPersonId = arg.slice('--owner='.length);
        else if (arg.startsWith('--owner-person-id=')) args.ownerPersonId = arg.slice('--owner-person-id='.length);
        else if (arg === '--actor' || arg === '--actor-person-id') args.actorPersonId = argv[++index];
        else if (arg.startsWith('--actor=')) args.actorPersonId = arg.slice('--actor='.length);
        else if (arg.startsWith('--actor-person-id=')) args.actorPersonId = arg.slice('--actor-person-id='.length);
        else if (arg === '--organization' || arg === '--organization-id') args.organizationId = argv[++index];
        else if (arg.startsWith('--organization=')) args.organizationId = arg.slice('--organization='.length);
        else if (arg.startsWith('--organization-id=')) args.organizationId = arg.slice('--organization-id='.length);
        else if (arg === '--delegation-id') args.delegationId = argv[++index];
        else if (arg.startsWith('--delegation-id=')) args.delegationId = arg.slice('--delegation-id='.length);
    }
    if (!args.date || !/^\d{4}-\d{2}-\d{2}$/u.test(args.date)) {
        throw new Error('--date YYYY-MM-DD required');
    }
    return args;
}

function personalKgIdentity(options, env = process.env) {
    return resolvePersonalKgCliAuthority({
        assertedIdentity: options,
        desiredEffect: options?.write ? 'write' : 'read',
        env
    });
}

function databaseConfig() {
    if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
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

async function loadCoreCandidates(pool, date, identity) {
    const access = requirePersonalKgIdentity(identity);
    const { rows } = await pool.query(
        `SELECT *
         FROM memory_candidates
         WHERE source_system = $1
           AND permission_snapshot->'oyasumi_meeting_personal_kg'->>'meeting_date' = $2
           AND permission_snapshot->'oyasumi_meeting_personal_kg'->>'memory_layer' = 'personal_kg_core'
           AND owner_person_id = $3
           AND organization_id = $4
         ORDER BY created_at ASC, id ASC`,
        [SOURCE_SYSTEM, date, access.owner_person_id, access.organization_id]
    );
    return rows;
}

function outputText({ date, coreCandidates, projected, writeSummary, write }) {
    const lines = [
        `${SOURCE_SYSTEM} sns_ready projection: ${date}`,
        `mode: ${write ? 'write' : 'dry-run'}`,
        `core_candidates: ${coreCandidates.length}`,
        `projected: ${projected.length}`
    ];
    if (writeSummary) {
        lines.push(`inserted: ${writeSummary.inserted}`);
        lines.push(`skipped: ${writeSummary.skipped}`);
        lines.push(`blocked: ${writeSummary.blocked}`);
    }
    if (projected.length > 0) {
        lines.push('');
        lines.push('projected bodies:');
        for (const candidate of projected) {
            const kg = candidate.permission_snapshot.oyasumi_meeting_personal_kg;
            lines.push(`- [${kg.category}] ${candidate.body}`);
        }
    }
    return lines.join('\n');
}

async function main() {
    throwRetiredSnsCli('project-oyasumi-sns-ready.js');
    const args = parseArgs(process.argv.slice(2));
    const identity = personalKgIdentity(args);
    const config = databaseConfig();
    validateConfig(config);
    const pool = new Pool(config);
    try {
        const coreCandidates = await loadCoreCandidates(pool, args.date, identity);
        const projected = projectSnsReadyCandidatesFromCoreCandidates(coreCandidates, identity);
        let writeSummary = null;
        if (args.write) {
            const repository = new PgCandidateRepository({ pool });
            const candidateService = new PromotionGateService({ repository });
            writeSummary = await writeMeetingPersonalKgCandidates({
                candidateService,
                extracted: {
                    date: args.date,
                    adopted: projected,
                    rejected: [],
                    needs_review: []
                },
                identity
            });
        }
        const payload = {
            mode: args.write ? 'write' : 'dry-run',
            date: args.date,
            core_count: coreCandidates.length,
            projected_count: projected.length,
            projected,
            write_summary: writeSummary
        };
        console.log(args.json ? JSON.stringify(payload, null, 2) : outputText({
            date: args.date,
            coreCandidates,
            projected,
            writeSummary,
            write: args.write
        }));
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

export {
    loadCoreCandidates,
    parseArgs
};
