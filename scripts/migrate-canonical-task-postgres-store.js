#!/usr/bin/env node
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { CanonicalTaskNocoDBRepository } from '../server/services/companion/canonical-task-nocodb-repository.js';
import { createCanonicalTaskStoreConfig } from '../server/services/companion/canonical-task-store-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'server/sql/canonical-task-store-schema.sql');
const REQUIRED_COLUMNS = [
    'id', 'legacy_nocodb_id', 'title', 'description', 'status', 'priority',
    'assignee_person_id', 'assignee_display_name', 'due_at', 'waiting_on',
    'review_at', 'completed_at', 'source_refs', 'project_codes', 'version', 'idempotency_key',
    'payload_fingerprint', 'last_operation_key', 'last_operation_fingerprint',
    'created_at', 'updated_at'
];

function rawRecordId(record) {
    return record?.Id ?? record?.ID ?? record?.id ?? record?.RecordId ?? record?.recordId
        ?? record?.fields?.Id ?? record?.fields?.ID ?? record?.fields?.id;
}

function rawFields(record) {
    return record?.fields && typeof record.fields === 'object' ? record.fields : record;
}

export function parseCanonicalTaskPostgresMigrationArgs(argv) {
    const modes = ['dry-run', 'check', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) throw new Error('Specify exactly one of --dry-run, --check, or --apply');
    return { mode: modes[0] };
}

export async function checkCanonicalTaskPostgresSchema(pool) {
    const tableResult = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = 'canonical_tasks'`
    );
    if (!tableResult.rows.length) throw new Error('Canonical Task PostgreSQL schema is missing canonical_tasks');
    const columnResult = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'canonical_tasks'`
    );
    const present = new Set(columnResult.rows.map((row) => row.column_name));
    const missing = REQUIRED_COLUMNS.filter((column) => !present.has(column));
    if (missing.length) throw new Error(`Canonical Task PostgreSQL schema has missing columns: ${missing.join(', ')}`);
    const indexResult = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'canonical_tasks'`
    );
    const indexes = new Set(indexResult.rows.map((row) => row.indexname));
    for (const required of ['canonical_tasks_status_priority_idx', 'canonical_tasks_assignee_due_idx', 'canonical_tasks_project_codes_idx']) {
        if (!indexes.has(required)) throw new Error(`Canonical Task PostgreSQL schema is missing ${required}`);
    }
    return { ok: true, table: 'canonical_tasks', columns: REQUIRED_COLUMNS.length };
}

async function sourceRows(repository) {
    const records = await repository.allRecords();
    return records.map((record) => {
        const fields = rawFields(record);
        const task = repository.normalize(record);
        const legacyId = rawRecordId(record);
        const idempotencyKey = fields['冪等キー'] ?? fields.idempotency_key;
        if (legacyId == null || !task || !idempotencyKey) {
            throw new Error('NocoDB migration source contains a row without legacy ID or idempotency key');
        }
        return {
            id: crypto.randomUUID(),
            legacy_nocodb_id: String(legacyId),
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            assignee_person_id: task.assignee_person_id,
            assignee_display_name: task.assignee_display_name,
            due_at: task.due_at,
            waiting_on: task.waiting_on,
            review_at: task.review_at,
            completed_at: task.completed_at,
            source_refs: task.source_refs,
            project_codes: task.project_codes ?? [],
            version: task.version,
            idempotency_key: String(idempotencyKey),
            payload_fingerprint: task._payload_fingerprint,
            last_operation_key: task._last_operation_key,
            last_operation_fingerprint: task._last_operation_fingerprint,
            created_at: task.created_at,
            updated_at: task.updated_at
        };
    });
}

function duplicateValues(rows, field) {
    const seen = new Set();
    const duplicates = new Set();
    for (const row of rows) {
        if (seen.has(row[field])) duplicates.add(row[field]);
        seen.add(row[field]);
    }
    return duplicates.size;
}

async function inspectConflicts(pool, rows) {
    const duplicateLegacyIds = duplicateValues(rows, 'legacy_nocodb_id');
    const duplicateIdempotencyKeys = duplicateValues(rows, 'idempotency_key');
    const result = await pool.query(
        `SELECT legacy_nocodb_id, idempotency_key, payload_fingerprint, version,
                last_operation_key, last_operation_fingerprint
         FROM canonical_tasks`
    );
    const existingByLegacy = new Map(result.rows.map((row) => [row.legacy_nocodb_id, row]));
    const existingByIdempotency = new Map(result.rows.map((row) => [row.idempotency_key, row]));
    const sourceLegacyIds = new Set(rows.map((row) => row.legacy_nocodb_id));
    const sourceIdempotencyKeys = new Set(rows.map((row) => row.idempotency_key));
    const targetOnlyRows = result.rows.filter(
        (row) => !sourceLegacyIds.has(row.legacy_nocodb_id)
            && !sourceIdempotencyKeys.has(row.idempotency_key)
    ).length;
    let databaseConflicts = 0;
    let matchedRows = 0;
    const pendingRows = [];
    for (const row of rows) {
        const legacyMatch = existingByLegacy.get(row.legacy_nocodb_id);
        const idempotencyMatch = existingByIdempotency.get(row.idempotency_key);
        if (!legacyMatch && !idempotencyMatch) {
            pendingRows.push(row);
        } else if (
            legacyMatch?.legacy_nocodb_id === row.legacy_nocodb_id
            && legacyMatch?.idempotency_key === row.idempotency_key
            && idempotencyMatch?.legacy_nocodb_id === row.legacy_nocodb_id
            && idempotencyMatch?.idempotency_key === row.idempotency_key
            && legacyMatch?.payload_fingerprint === row.payload_fingerprint
            && Number(legacyMatch?.version) === Number(row.version)
            && (legacyMatch?.last_operation_key ?? null) === (row.last_operation_key ?? null)
            && (legacyMatch?.last_operation_fingerprint ?? null) === (row.last_operation_fingerprint ?? null)
        ) {
            matchedRows += 1;
        } else {
            databaseConflicts += 1;
        }
    }
    return {
        duplicateLegacyIds,
        duplicateIdempotencyKeys,
        databaseConflicts,
        targetOnlyRows,
        matchedRows,
        pendingRows
    };
}

async function insertRows(pool, rows) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const row of rows) {
            await client.query(
                `INSERT INTO canonical_tasks (
                    id, legacy_nocodb_id, title, description, status, priority,
                    assignee_person_id, assignee_display_name, due_at, waiting_on,
                    review_at, completed_at, source_refs, project_codes, version, idempotency_key,
                    payload_fingerprint, last_operation_key, last_operation_fingerprint,
                    created_at, updated_at
                 ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13::jsonb, $14::text[], $15, $16, $17, $18, $19, $20, $21
                 )`,
                [
                    row.id, row.legacy_nocodb_id, row.title, row.description, row.status, row.priority,
                    row.assignee_person_id, row.assignee_display_name, row.due_at, row.waiting_on,
                    row.review_at, row.completed_at, JSON.stringify(row.source_refs), row.project_codes, row.version,
                    row.idempotency_key, row.payload_fingerprint, row.last_operation_key,
                    row.last_operation_fingerprint, row.created_at, row.updated_at
                ]
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function runCanonicalTaskPostgresMigration({
    argv = process.argv.slice(2),
    pool = null,
    sourceRepository = null,
    workflowAuthorized = false
} = {}) {
    const { mode } = parseCanonicalTaskPostgresMigrationArgs(argv);
    if (mode === 'apply' && !workflowAuthorized) {
        throw new Error(
            'Direct --apply is disabled; run npm run migrate:canonical-task-postgres-workflow'
        );
    }
    const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new Error('INFO_SSOT_DATABASE_URL is required');
    try {
        if (mode === 'apply') {
            await activePool.query(await readFile(SCHEMA_PATH, 'utf8'));
        }
        await checkCanonicalTaskPostgresSchema(activePool);
        const repository = sourceRepository || new CanonicalTaskNocoDBRepository({
            storeConfig: createCanonicalTaskStoreConfig()
        });
        const rows = await sourceRows(repository);
        const conflicts = await inspectConflicts(activePool, rows);
        if (
            conflicts.duplicateLegacyIds
            || conflicts.duplicateIdempotencyKeys
            || conflicts.databaseConflicts
            || conflicts.targetOnlyRows
        ) {
            throw new Error(
                `Canonical Task migration conflict: legacy=${conflicts.duplicateLegacyIds}, `
                + `idempotency=${conflicts.duplicateIdempotencyKeys}, database=${conflicts.databaseConflicts}, `
                + `target_only=${conflicts.targetOnlyRows}`
            );
        }
        if (mode === 'apply') await insertRows(activePool, conflicts.pendingRows);
        const targetResult = await activePool.query('SELECT COUNT(*)::integer AS count FROM canonical_tasks');
        return {
            ok: true,
            mode,
            source_count: rows.length,
            target_count: Number(targetResult.rows[0]?.count || 0),
            matched_count: conflicts.matchedRows,
            pending_count: conflicts.pendingRows.length,
            inserted_count: mode === 'apply' ? conflicts.pendingRows.length : 0,
            conflict_count: 0
        };
    } finally {
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runCanonicalTaskPostgresMigration()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}
