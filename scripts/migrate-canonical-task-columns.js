#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { createCanonicalTaskStoreConfig } from '../server/services/companion/canonical-task-store-config.js';

export const REQUIRED_CANONICAL_TASK_COLUMNS = Object.freeze([
    { title: 'タイトル', uidt: 'SingleLineText' },
    { title: '説明', uidt: 'LongText' },
    { title: 'ステータス', uidt: 'SingleSelect' },
    { title: '優先度', uidt: 'SingleSelect' },
    { title: '担当者PersonID', uidt: 'SingleLineText' },
    { title: '担当者', uidt: 'SingleLineText' },
    { title: '期限', uidt: 'DateTime' },
    { title: '待ち理由', uidt: 'LongText' },
    { title: 'レビュー日時', uidt: 'DateTime' },
    { title: '完了日時', uidt: 'DateTime' },
    { title: 'ソース参照', uidt: 'LongText' },
    { title: 'バージョン', uidt: 'Number' },
    { title: '冪等キー', uidt: 'SingleLineText', unique: true },
    { title: 'Payload Fingerprint', uidt: 'LongText' },
    { title: '最終操作キー', uidt: 'SingleLineText' },
    { title: '最終操作Fingerprint', uidt: 'LongText' }
]);

export function parseCanonicalTaskColumnMigrationArgs(argv) {
    const apply = argv.includes('--apply');
    const check = argv.includes('--check');
    if (apply === check) throw new Error('Specify exactly one of --apply or --check');
    return { apply, check };
}

function columnTitle(column) {
    return column.title || column.column_name || column.name;
}

function isUnique(column) {
    return column.unique === true || column.is_unique === true || column.meta?.unique === true || column.meta?.is_unique === true;
}

export function checkCanonicalTaskColumns(metadata) {
    const columns = metadata?.columns || metadata?.columnList || [];
    const byTitle = new Map(columns.map(column => [columnTitle(column), column]));
    const missing = REQUIRED_CANONICAL_TASK_COLUMNS.filter(required => !byTitle.has(required.title));
    if (missing.length) throw new Error(`Canonical Task store has missing columns: ${missing.map(column => column.title).join(', ')}`);
    const wrongTypes = REQUIRED_CANONICAL_TASK_COLUMNS.filter(required => byTitle.get(required.title)?.uidt !== required.uidt);
    if (wrongTypes.length) {
        throw new Error(`Canonical Task store has invalid column types: ${wrongTypes.map(column => `${column.title} requires ${column.uidt}`).join(', ')}`);
    }
    if (!isUnique(byTitle.get('冪等キー'))) {
        throw new Error('Canonical Task store requires a DB unique constraint on 冪等キー');
    }
    return { ok: true, columns: REQUIRED_CANONICAL_TASK_COLUMNS.map(column => column.title) };
}

async function nocoRequest({ fetchImpl, baseUrl, apiToken, path: requestPath, method = 'GET', body }) {
    if (!apiToken) throw new Error('NOCODB_TOKEN or NOCODB_API_TOKEN is required');
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${requestPath}`, {
        method,
        headers: { 'xc-token': apiToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(`NocoDB metadata API failed: ${response.status}`);
    return response.json();
}

export async function migrateCanonicalTaskColumns({
    apply,
    fetchImpl = fetch,
    baseUrl = process.env.NOCODB_URL || 'https://noco.unson.jp',
    apiToken = process.env.NOCODB_TOKEN || process.env.NOCODB_API_TOKEN,
    tableId
}) {
    const readMetadata = () => nocoRequest({ fetchImpl, baseUrl, apiToken, path: `/api/v2/meta/tables/${tableId}` });
    let metadata = await readMetadata();
    if (apply) {
        const columns = metadata?.columns || metadata?.columnList || [];
        const byTitle = new Map(columns.map(column => [columnTitle(column), column]));
        for (const required of REQUIRED_CANONICAL_TASK_COLUMNS) {
            const existing = byTitle.get(required.title);
            if (!existing) {
                await nocoRequest({ fetchImpl, baseUrl, apiToken, path: `/api/v2/meta/tables/${tableId}/columns`, method: 'POST', body: required });
            } else if (required.unique && !isUnique(existing)) {
                if (!existing.id) throw new Error('Cannot create DB unique constraint for 冪等キー without a column id');
                await nocoRequest({ fetchImpl, baseUrl, apiToken, path: `/api/v2/meta/columns/${existing.id}`, method: 'PATCH', body: { unique: true } });
            }
        }
        metadata = await readMetadata();
    }
    return checkCanonicalTaskColumns(metadata);
}

export async function runCanonicalTaskColumnMigration(argv = process.argv.slice(2)) {
    const args = parseCanonicalTaskColumnMigrationArgs(argv);
    const storeConfig = createCanonicalTaskStoreConfig();
    return migrateCanonicalTaskColumns({ ...args, tableId: storeConfig.tableId });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runCanonicalTaskColumnMigration()
        .then(result => console.log(JSON.stringify(result)))
        .catch(error => {
            console.error(error.message);
            process.exitCode = 1;
        });
}
