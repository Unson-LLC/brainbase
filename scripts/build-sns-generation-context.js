#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

import { InMemoryCandidateRepository, PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { SnsGenerationContextService } from '../server/services/sns/sns-generation-context-service.js';
import { requirePersonalKgIdentity } from '../server/services/sns/personal-kg-identity.js';
import { PgSnsPostingLedgerRepository } from '../server/services/sns/posting-ledger-repository.js';
import { databaseConfig } from './migrate-m5a-production-schema.js';
import { resolveSnsRoot } from './workspace-paths.js';

const { Pool } = pg;

const SNS_ROOT = resolveSnsRoot();
const DEFAULT_OUT_DIR = path.join(SNS_ROOT, 'x/ops/generation-contexts');
const DEFAULT_STRATEGY_FILE = path.join(SNS_ROOT, 'sns_strategy_os.md');
const DEFAULT_CONTENT_PILLARS_FILE = path.join(SNS_ROOT, 'content_pillars.md');

function todayJst() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

export function parseArgs(argv) {
    const args = {
        date: todayJst(),
        out: null,
        strategyFile: DEFAULT_STRATEGY_FILE,
        contentPillarsFile: DEFAULT_CONTENT_PILLARS_FILE,
        lookbackDays: 30,
        json: false,
        dryRun: false,
        ownerPersonId: null,
        actorPersonId: null,
        organizationId: null,
        delegationId: null
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--date') args.date = argv[++i];
        if (arg === '--out') args.out = argv[++i];
        if (arg === '--strategy-file') args.strategyFile = argv[++i];
        if (arg === '--content-pillars-file') args.contentPillarsFile = argv[++i];
        if (arg === '--lookback-days') args.lookbackDays = Number(argv[++i]);
        if (arg === '--json') args.json = true;
        if (arg === '--dry-run') args.dryRun = true;
        if (arg === '--owner-person-id' || arg === '--owner') args.ownerPersonId = argv[++i];
        if (arg.startsWith('--owner-person-id=')) args.ownerPersonId = arg.slice('--owner-person-id='.length);
        if (arg.startsWith('--owner=')) args.ownerPersonId = arg.slice('--owner='.length);
        if (arg === '--actor-person-id' || arg === '--actor') args.actorPersonId = argv[++i];
        if (arg.startsWith('--actor-person-id=')) args.actorPersonId = arg.slice('--actor-person-id='.length);
        if (arg.startsWith('--actor=')) args.actorPersonId = arg.slice('--actor='.length);
        if (arg === '--organization-id' || arg === '--organization') args.organizationId = argv[++i];
        if (arg.startsWith('--organization-id=')) args.organizationId = arg.slice('--organization-id='.length);
        if (arg.startsWith('--organization=')) args.organizationId = arg.slice('--organization='.length);
        if (arg === '--delegation-id') args.delegationId = argv[++i];
        if (arg.startsWith('--delegation-id=')) args.delegationId = arg.slice('--delegation-id='.length);
    }
    return args;
}

function personalKgIdentity(args, env = process.env) {
    return requirePersonalKgIdentity({
        owner_person_id: args.ownerPersonId || env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID,
        actor_person_id: args.actorPersonId || env.BRAINBASE_PERSONAL_KG_ACTOR_PERSON_ID,
        organization_id: args.organizationId
            || env.BRAINBASE_PERSONAL_KG_ORGANIZATION_ID
            || env.BRAINBASE_ORGANIZATION_ID,
        delegation_id: args.delegationId || env.BRAINBASE_PERSONAL_KG_DELEGATION_ID
    }, env);
}

function readOptionalText(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
}

export function defaultOutForDate(date) {
    return path.join(DEFAULT_OUT_DIR, `${date}.json`);
}

async function buildWithPg(args) {
    const pool = new Pool(databaseConfig());
    try {
        const service = new SnsGenerationContextService({
            ledgerRepository: new PgSnsPostingLedgerRepository({ pool }),
            candidateRepository: new PgCandidateRepository({ pool }),
            strategyText: readOptionalText(args.strategyFile),
            contentPillarsText: readOptionalText(args.contentPillarsFile)
        });
        return await service.buildContext({
            date: args.date,
            lookbackDays: args.lookbackDays,
            viewer: personalKgIdentity(args)
        });
    } finally {
        await pool.end();
    }
}

async function buildEmptyDryRun(args) {
    const service = new SnsGenerationContextService({
        ledgerRepository: { listPosts: async () => [] },
        candidateRepository: new InMemoryCandidateRepository(),
        strategyText: readOptionalText(args.strategyFile),
        contentPillarsText: readOptionalText(args.contentPillarsFile)
    });
    return service.buildContext({
        date: args.date,
        lookbackDays: args.lookbackDays,
        viewer: personalKgIdentity(args)
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const out = args.out || defaultOutForDate(args.date);
    const context = args.dryRun ? await buildEmptyDryRun(args) : await buildWithPg(args);
    if (!args.dryRun) {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, `${JSON.stringify(context, null, 2)}\n`);
    }
    const summary = {
        out: args.dryRun ? null : out,
        date: context.date,
        recommended_lanes: context.generation_policy.recommended_lanes,
        avoid_patterns: context.generation_policy.avoid_patterns,
        generation_context_used: true
    };
    console.log(JSON.stringify(args.json ? context : summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
