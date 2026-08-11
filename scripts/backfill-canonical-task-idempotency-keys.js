#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { createCanonicalTaskStoreConfig } from '../server/services/companion/canonical-task-store-config.js';

export const LEGACY_IDEMPOTENCY_KEY_PREFIX = 'legacy:nocodb:';

const IDEMPOTENCY_FIELD = '冪等キー';

function recordId(record) {
    return record?.Id ?? record?.ID ?? record?.id ?? record?.RecordId ?? record?.recordId
        ?? record?.fields?.Id ?? record?.fields?.ID ?? record?.fields?.id;
}

function fieldsOf(record) {
    return record?.fields && typeof record.fields === 'object' ? record.fields : record;
}

function idempotencyKeyOf(record) {
    const fields = fieldsOf(record);
    const value = fields?.[IDEMPOTENCY_FIELD] ?? fields?.idempotency_key;
    return value === undefined || value === null || value === '' ? null : String(value);
}

export function buildLegacyIdempotencyKey(id) {
    return `${LEGACY_IDEMPOTENCY_KEY_PREFIX}${id}`;
}

export function parseIdempotencyKeyBackfillArgs(argv) {
    const apply = argv.includes('--apply');
    const dryRun = argv.includes('--dry-run');
    if (apply === dryRun) throw new Error('Specify exactly one of --dry-run or --apply');
    return { apply };
}

export function planIdempotencyKeyBackfill(records) {
    const seenIds = new Set();
    const usedKeys = new Set();
    let existing = 0;
    for (const record of records) {
        const id = recordId(record);
        if (id == null) throw new Error('Canonical Task backfill source contains a row without a record ID');
        const stringId = String(id);
        if (seenIds.has(stringId)) throw new Error('Canonical Task backfill source contains duplicate record IDs');
        seenIds.add(stringId);
        const key = idempotencyKeyOf(record);
        if (key !== null) {
            existing += 1;
            usedKeys.add(key);
        }
    }

    const plan = [];
    const conflicts = [];
    for (const record of records) {
        if (idempotencyKeyOf(record) !== null) continue;
        const id = String(recordId(record));
        const key = buildLegacyIdempotencyKey(id);
        if (usedKeys.has(key)) {
            conflicts.push({ record_id: id, idempotency_key: key });
            continue;
        }
        usedKeys.add(key);
        plan.push({ record_id: id, idempotency_key: key });
    }

    return {
        total: records.length,
        existing,
        missing: plan.length + conflicts.length,
        plan,
        conflicts
    };
}

async function nocoRequest({ fetchImpl, baseUrl, apiToken, path: requestPath, method = 'GET', body }) {
    if (!apiToken) throw new Error('NOCODB_TOKEN or NOCODB_API_TOKEN is required');
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${requestPath}`, {
        method,
        headers: { 'xc-token': apiToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(`NocoDB records API failed: ${response.status}`);
    return response.json();
}

async function fetchAllRecords({ fetchImpl, baseUrl, apiToken, tableId, pageSize }) {
    const records = [];
    let offset = 0;
    while (true) {
        const data = await nocoRequest({
            fetchImpl,
            baseUrl,
            apiToken,
            path: `/api/v2/tables/${tableId}/records?limit=${pageSize}&offset=${offset}`
        });
        const page = Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : []);
        records.push(...page);
        const expectedTotal = Number(data?.pageInfo?.totalRows);
        const isLastPage = data?.pageInfo?.isLastPage === true;
        const reachedTotal = Number.isInteger(expectedTotal) && expectedTotal >= 0 && records.length >= expectedTotal;
        if (isLastPage || reachedTotal || page.length < pageSize) {
            if (Number.isInteger(expectedTotal) && expectedTotal >= 0 && records.length < expectedTotal) {
                throw new Error('NocoDB Task pagination ended before all rows were read');
            }
            return records;
        }
        if (!page.length) throw new Error('NocoDB Task pagination did not advance');
        offset += page.length;
    }
}

export async function backfillCanonicalTaskIdempotencyKeys({
    apply,
    fetchImpl = fetch,
    baseUrl = process.env.NOCODB_URL || 'https://noco.unson.jp',
    apiToken = process.env.NOCODB_TOKEN || process.env.NOCODB_API_TOKEN,
    tableId,
    pageSize = 1000
}) {
    if (!tableId) throw new Error('Canonical Task store table ID is required');
    const records = await fetchAllRecords({ fetchImpl, baseUrl, apiToken, tableId, pageSize });
    const summary = planIdempotencyKeyBackfill(records);
    if (summary.conflicts.length) {
        throw new Error(
            `Canonical Task backfill has idempotency key conflicts: ${summary.conflicts.length}`
        );
    }
    if (!apply) {
        return { mode: 'dry-run', ...summary, updated: 0 };
    }

    for (const entry of summary.plan) {
        await nocoRequest({
            fetchImpl,
            baseUrl,
            apiToken,
            path: `/api/v2/tables/${tableId}/records`,
            method: 'PATCH',
            body: {
                Id: /^\d+$/.test(entry.record_id) ? Number(entry.record_id) : entry.record_id,
                [IDEMPOTENCY_FIELD]: entry.idempotency_key
            }
        });
    }

    const verification = planIdempotencyKeyBackfill(
        await fetchAllRecords({ fetchImpl, baseUrl, apiToken, tableId, pageSize })
    );
    if (verification.missing !== 0) {
        throw new Error(
            `Canonical Task backfill verification failed: ${verification.missing} rows still lack an idempotency key`
        );
    }
    return { mode: 'apply', ...summary, updated: summary.plan.length, verified_missing: 0 };
}

export async function runCanonicalTaskIdempotencyKeyBackfill(argv = process.argv.slice(2)) {
    const args = parseIdempotencyKeyBackfillArgs(argv);
    const storeConfig = createCanonicalTaskStoreConfig();
    const result = await backfillCanonicalTaskIdempotencyKeys({ ...args, tableId: storeConfig.tableId });
    return {
        mode: result.mode,
        total: result.total,
        existing: result.existing,
        missing: result.missing,
        planned: result.plan.length,
        updated: result.updated,
        conflict_count: result.conflicts.length
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runCanonicalTaskIdempotencyKeyBackfill()
        .then(result => console.log(JSON.stringify(result)))
        .catch(error => {
            console.error(error.message);
            process.exitCode = 1;
        });
}
