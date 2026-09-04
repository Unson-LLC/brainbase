#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

import { PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import { PersonalKnowledgeGraphReader } from '../server/services/sns/personal-knowledge-graph-reader.js';
import { PersonalKgSnsWeeklyPlanner } from '../server/services/sns/personal-kg-sns-weekly-planner.js';
import { requirePersonalKgIdentity } from '../server/services/sns/personal-kg-identity.js';
import { resolvePersonalKgCliAuthority } from './lib/personal-kg-cli-authority.js';
import { throwRetiredSnsCli } from './lib/retired-sns-cli.js';

const { Pool } = pg;

function parseArgs(argv) {
    const args = {
        startDate: null,
        signalsFile: null,
        lookbackDays: 90,
        ownerPersonId: null,
        actorPersonId: null,
        organizationId: null,
        delegationId: null
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--start-date') args.startDate = argv[++i];
        else if (arg.startsWith('--start-date=')) args.startDate = arg.slice('--start-date='.length);
        if (arg === '--signals-file') args.signalsFile = argv[++i];
        else if (arg.startsWith('--signals-file=')) args.signalsFile = arg.slice('--signals-file='.length);
        if (arg === '--lookback-days') args.lookbackDays = Number(argv[++i]);
        else if (arg.startsWith('--lookback-days=')) args.lookbackDays = Number(arg.slice('--lookback-days='.length));
        if (arg === '--owner-person-id' || arg === '--owner') args.ownerPersonId = argv[++i];
        else if (arg.startsWith('--owner-person-id=')) args.ownerPersonId = arg.slice('--owner-person-id='.length);
        else if (arg.startsWith('--owner=')) args.ownerPersonId = arg.slice('--owner='.length);
        if (arg === '--actor-person-id' || arg === '--actor') args.actorPersonId = argv[++i];
        else if (arg.startsWith('--actor-person-id=')) args.actorPersonId = arg.slice('--actor-person-id='.length);
        else if (arg.startsWith('--actor=')) args.actorPersonId = arg.slice('--actor='.length);
        if (arg === '--organization-id' || arg === '--organization') args.organizationId = argv[++i];
        else if (arg.startsWith('--organization-id=')) args.organizationId = arg.slice('--organization-id='.length);
        else if (arg.startsWith('--organization=')) args.organizationId = arg.slice('--organization='.length);
        if (arg === '--delegation-id') args.delegationId = argv[++i];
        else if (arg.startsWith('--delegation-id=')) args.delegationId = arg.slice('--delegation-id='.length);
    }
    return args;
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

function nextMonday(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay();
    const offset = day === 0 ? 1 : 8 - day;
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
}

function loadSignals(filePath) {
    if (!filePath) return { peerSignals: [], newsSignals: [] };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
        peerSignals: Array.isArray(parsed.peerSignals) ? parsed.peerSignals : [],
        newsSignals: Array.isArray(parsed.newsSignals) ? parsed.newsSignals : []
    };
}

function viewer(args) {
    const identity = requirePersonalKgIdentity({
        owner_person_id: args.owner_person_id || args.ownerPersonId,
        actor_person_id: args.actor_person_id || args.actorPersonId,
        organization_id: args.organization_id || args.organizationId,
        org_ids: args.org_ids,
        project_code: args.project_code || args.projectCode,
        authority_resolution_receipt_id: args.authority_resolution_receipt_id,
        identity_resolution_receipt_id: args.identity_resolution_receipt_id
    });
    return {
        ...identity,
        sub: identity.owner_person_id,
        role: 'ceo',
        workspace: identity.organization_id,
        project_ids: ['brainbase', 'salestailor', 'techknight', 'zeims', 'ncom-catalyst', 'unson-board'],
        interests: ['Claude Code', 'AI PM', 'AI駆動経営', 'ナレッジグラフ', 'VibePro'],
        persona: 'AI導入を任された事業責任者 / PM / 経営者'
    };
}

async function main() {
    throwRetiredSnsCli('generate-personal-kg-sns-weekly-pack.js');
    const args = parseArgs(process.argv.slice(2));
    const identity = resolvePersonalKgCliAuthority({
        assertedIdentity: args,
        desiredEffect: 'read'
    });
    const config = databaseConfig();
    validateConfig(config);
    const pool = new Pool(config);
    try {
        const repository = new PgCandidateRepository({ pool });
        const service = new PromotionGateService({ repository });
        const reader = new PersonalKnowledgeGraphReader({ candidateService: service });
        const planner = new PersonalKgSnsWeeklyPlanner({ graphReader: reader });
        const signals = loadSignals(args.signalsFile);
        const pack = await planner.buildWeeklyDraftPack(viewer(identity), {
            startDate: args.startDate || nextMonday(),
            lookbackDays: args.lookbackDays,
            ...signals
        });
        console.log(JSON.stringify(pack, null, 2));
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

export { parseArgs, nextMonday, loadSignals, viewer };
