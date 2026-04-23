#!/usr/bin/env node
// Upsert app entities (brainbase, salestailor, mana) with `environments` payload
// via the Graph SSOT write API (POST /api/info/graph/entities).
//
// Usage:
//   node scripts/upsert-app-environments.mjs                # targets https://bb.unson.jp
//   BB_BASE_URL=http://localhost:31013 node scripts/upsert-app-environments.mjs
//
// Auth: Bearer token from ~/.brainbase/tokens.json (access_token).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE_URL = process.env.BB_BASE_URL || 'https://bb.unson.jp';
const TOKENS_PATH = path.join(os.homedir(), '.brainbase', 'tokens.json');

function loadToken() {
    const raw = fs.readFileSync(TOKENS_PATH, 'utf-8');
    const json = JSON.parse(raw);
    if (!json.access_token) throw new Error('access_token missing in ~/.brainbase/tokens.json');
    return json.access_token;
}

async function graphGet(token, entityId) {
    const url = `${BASE_URL}/api/info/graph/entities?type=app&limit=500`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return json.records.find((r) => r.id === entityId) || null;
}

async function upsertEntity(token, body) {
    const res = await fetch(`${BASE_URL}/api/info/graph/entities`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST ${body.id} failed: ${res.status} ${await res.text()}`);
    return res.json();
}

const BRAINBASE_ENV = {
    local: {
        mode: 'primary',
        ui_url: 'http://localhost:31013',
        worktree_ui_url: 'http://localhost:31014',
        host: 'local'
    },
    production: {
        host: 'aws.lightsail',
        region: 'ap-northeast-1',
        instance: 'brainbase-nocodb',
        endpoints: {
            ssot_graph: 'https://bb.unson.jp',
            nocodb: 'https://noco.unson.jp',
            graph_api: 'https://graph.brain-base.work'
        }
    }
};

const SALESTAILOR_ENV = {
    production: { url: 'https://ai.sales-tailor.jp', host: 'vercel' },
    staging: { url: 'https://salestailor.vercel.app', host: 'vercel' }
};

const MANA_ENV = {
    realtime: {
        host: 'aws.lambda',
        region: 'us-east-1',
        functions: ['mana', 'mana-salestailor', 'mana-techknight'],
        purpose: 'Slack Webhook リアルタイム処理'
    },
    scheduled: {
        host: 'github-actions-self-hosted',
        runner: 'ksato-mac',
        runner_path: '/Users/ksato/actions-runner/',
        purpose: '日次・週次定期処理'
    }
};

async function main() {
    const token = loadToken();
    console.log(`[upsert-app-envs] target = ${BASE_URL}`);

    const existingSt = await graphGet(token, 'app_salestailor');
    if (!existingSt) throw new Error('app_salestailor not found — aborting to avoid wiping existing data');
    console.log('[salestailor] existing payload keys:', Object.keys(existingSt.payload));

    await upsertEntity(token, {
        id: 'app_salestailor',
        entityType: 'app',
        projectCode: 'salestailor',
        projectName: 'SalesTailor',
        roleMin: 'gm',
        sensitivity: 'internal',
        payload: { ...existingSt.payload, environments: SALESTAILOR_ENV }
    });
    console.log('[salestailor] upserted');

    await upsertEntity(token, {
        id: 'app_brainbase',
        entityType: 'app',
        projectCode: 'brainbase',
        projectName: 'brainbase',
        roleMin: 'gm',
        sensitivity: 'internal',
        payload: {
            name: 'brainbase',
            app_id: 'brainbase',
            projects: ['brainbase'],
            orgs: ['雲孫'],
            status: '運用中',
            summary: '社内SSOT/Graph運用のエージェント基盤。ローカル中心、Lightsailに本番エンドポイント',
            environments: BRAINBASE_ENV
        }
    });
    console.log('[brainbase] upserted');

    await upsertEntity(token, {
        id: 'app_mana',
        entityType: 'app',
        projectCode: 'mana',
        projectName: 'mana',
        roleMin: 'gm',
        sensitivity: 'internal',
        payload: {
            name: 'mana',
            app_id: 'mana',
            projects: ['mana'],
            orgs: ['雲孫'],
            status: '運用中',
            summary: 'Slackイベントのリアルタイム処理と定期バッチを担うAIエージェント基盤',
            environments: MANA_ENV
        }
    });
    console.log('[mana] upserted');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
