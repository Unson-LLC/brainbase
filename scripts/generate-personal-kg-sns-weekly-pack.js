#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

import { PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import { PersonalKnowledgeGraphReader } from '../server/services/sns/personal-knowledge-graph-reader.js';
import { PersonalKgSnsWeeklyPlanner } from '../server/services/sns/personal-kg-sns-weekly-planner.js';

const { Pool } = pg;

function parseArgs(argv) {
    const args = { startDate: null, signalsFile: null, lookbackDays: 90 };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--start-date') args.startDate = argv[++i];
        if (arg === '--signals-file') args.signalsFile = argv[++i];
        if (arg === '--lookback-days') args.lookbackDays = Number(argv[++i]);
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

function viewer() {
    return {
        sub: 'sato_keigo',
        role: 'ceo',
        workspace: 'unson',
        org_ids: ['unson', 'salestailor', 'techknight', 'zeims', 'ncom-catalyst'],
        project_ids: ['brainbase', 'salestailor', 'techknight', 'zeims', 'ncom-catalyst', 'unson-board'],
        interests: ['Claude Code', 'AI PM', 'AI駆動経営', 'ナレッジグラフ', 'VibePro'],
        persona: 'AI導入を任された事業責任者 / PM / 経営者'
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const config = databaseConfig();
    validateConfig(config);
    const pool = new Pool(config);
    try {
        const repository = new PgCandidateRepository({ pool });
        const service = new PromotionGateService({ repository });
        const reader = new PersonalKnowledgeGraphReader({ candidateService: service });
        const planner = new PersonalKgSnsWeeklyPlanner({ graphReader: reader });
        const signals = loadSignals(args.signalsFile);
        const pack = await planner.buildWeeklyDraftPack(viewer(), {
            startDate: args.startDate || nextMonday(),
            lookbackDays: args.lookbackDays,
            ...signals
        });
        console.log(JSON.stringify(pack, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

export { parseArgs, nextMonday, loadSignals };
