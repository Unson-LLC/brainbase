import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    parseMultitenantSchemaMigrationArgs,
    runMultitenantSchemaMigration
} from '../../../scripts/migrate-multitenant-platform-schema.js';

const schemaPath = resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql');

async function schemaContract() {
    const sql = await readFile(schemaPath, 'utf8');
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gi)]
        .map((match) => match[1]);
    const rlsTables = [...sql.matchAll(/ALTER TABLE\s+([a-z0-9_]+)\s+ENABLE ROW LEVEL SECURITY/gi)]
        .map((match) => match[1]);
    return {
        sql,
        sha256: createHash('sha256').update(sql).digest('hex'),
        tables,
        rlsTables
    };
}

async function createPool({ missingTable = null, ledgerHash = null } = {}) {
    const contract = await schemaContract();
    const queries = [];
    const query = vi.fn(async (text, values = []) => {
        queries.push({ text: String(text), values });
        if (String(text).includes('FROM information_schema.tables')) {
            return { rows: contract.tables.filter((name) => name !== missingTable).map((table_name) => ({ table_name })) };
        }
        if (String(text).includes('FROM information_schema.columns')) {
            const rows = [];
            for (const match of contract.sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)\s*\(([^;]+)\);/gis)) {
                for (const line of match[2].split('\n')) {
                    const columnMatch = line.trim().match(/^([a-z][a-z0-9_]*)\s+([a-z][a-z0-9_]*(?:\s*\(\s*\d+\s*\))?)/i);
                    const column = columnMatch?.[1];
                    if (column && !['primary', 'unique', 'foreign', 'references', 'check', 'constraint', 'and', 'or'].includes(column.toLowerCase())) {
                        const declaredType = columnMatch[2].toLowerCase().replace(/\s+/gu, '');
                        const type = declaredType.startsWith('jsonb')
                            ? { data_type: 'jsonb', udt_name: 'jsonb' }
                            : declaredType.startsWith('numeric')
                                ? { data_type: 'numeric', udt_name: 'numeric' }
                                : declaredType.startsWith('text')
                                    ? { data_type: 'text', udt_name: 'text' }
                                    : { data_type: declaredType, udt_name: declaredType };
                        rows.push({ table_name: match[1], column_name: column, ...type });
                    }
                }
            }
            return { rows };
        }
        if (String(text).includes('FROM pg_class')) {
            return {
                rows: contract.rlsTables.map((table_name) => ({
                    table_name,
                    relrowsecurity: true,
                    relforcerowsecurity: true
                }))
            };
        }
        if (String(text).includes('FROM pg_policies')) {
            return { rows: contract.rlsTables.map((table_name) => ({ table_name })) };
        }
        if (String(text).includes('FROM brainbase_schema_migrations')) {
            return { rows: [{ schema_sha256: ledgerHash ?? contract.sha256 }] };
        }
        return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    return {
        pool: { connect: vi.fn(async () => client), end: vi.fn() },
        client,
        queries,
        contract
    };
}

describe('multitenant platform schema migration runner', () => {
    it('modeを1つだけ受理しapplyには明示承認とactorを要求する', () => {
        expect(parseMultitenantSchemaMigrationArgs(['--check'])).toEqual({ mode: 'check', approved: false });
        expect(() => parseMultitenantSchemaMigrationArgs(['--check', '--dry-run'])).toThrow(/exactly one/u);
        expect(() => parseMultitenantSchemaMigrationArgs(['--apply'])).toThrow(/approve-apply/u);
        expect(() => parseMultitenantSchemaMigrationArgs(['--apply', '--approve-apply'], {})).toThrow(/BRAINBASE_MIGRATION_ACTOR/u);
        expect(parseMultitenantSchemaMigrationArgs(
            ['--apply', '--approve-apply'],
            { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' }
        )).toEqual({ mode: 'apply', approved: true });
    });

    it('checkはDDLを書かずschema hash・table・column・RLS・policyをreadbackする', async () => {
        const { pool, queries, contract } = await createPool();
        const result = await runMultitenantSchemaMigration({ argv: ['--check'], pool });

        expect(result).toMatchObject({
            ok: true,
            mode: 'check',
            schema_sha256: contract.sha256,
            readback: {
                table_count: contract.tables.length,
                rls_table_count: contract.rlsTables.length,
                ledger_matches: true
            }
        });
        expect(queries.some(({ text }) => text.includes('CREATE TABLE'))).toBe(false);
        expect(queries.some(({ text }) => text === 'COMMIT')).toBe(false);
    });

    it('dry-runはtransaction内でschemaを適用・検査して必ずROLLBACKする', async () => {
        const { pool, queries, contract } = await createPool();
        const result = await runMultitenantSchemaMigration({ argv: ['--dry-run'], pool });

        expect(result).toMatchObject({ ok: true, mode: 'dry-run', persisted: false });
        expect(queries.map(({ text }) => text)).toContain('BEGIN');
        expect(queries.some(({ text }) => text === contract.sql)).toBe(true);
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
        expect(queries.map(({ text }) => text)).not.toContain('COMMIT');
    });

    it('applyはadvisory lock下で冪等DDLとledgerを同一transactionに保存してreadbackする', async () => {
        const { pool, queries, contract } = await createPool();
        const result = await runMultitenantSchemaMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        });

        expect(result).toMatchObject({ ok: true, mode: 'apply', persisted: true, schema_sha256: contract.sha256 });
        expect(queries.some(({ text }) => text.includes('pg_advisory_xact_lock'))).toBe(true);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(true);
        expect(queries.find(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))?.values[0])
            .toBe('multitenant-platform-schema.v2');
        expect(queries.map(({ text }) => text)).toContain('COMMIT');
        expect(JSON.stringify(result)).not.toContain('operator@example.test');
    });

    it('schema readback不一致はCOMMITせずfail closedにする', async () => {
        const { pool, queries } = await createPool({ missingTable: 'tenant_projects' });
        await expect(runMultitenantSchemaMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/missing tables.*tenant_projects/u);
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
        expect(queries.map(({ text }) => text)).not.toContain('COMMIT');
    });

    it('接続情報がなくても秘密値を含めずに停止する', async () => {
        const secretUrl = 'postgres://user:super-secret@example.test/brainbase';
        await expect(runMultitenantSchemaMigration({
            argv: ['--check'],
            env: { DATABASE_URL: secretUrl }
        })).rejects.not.toThrow(secretUrl);
        await expect(runMultitenantSchemaMigration({
            argv: ['--check'],
            env: { DATABASE_URL: secretUrl }
        })).rejects.toThrow(/INFO_SSOT_DATABASE_URL/u);
    });

    it('PostgreSQL driverが秘密値を含むerrorを返しても標準化して外へ出さない', async () => {
        const secretUrl = 'postgres://user:super-secret@example.test/brainbase';
        const pool = {
            connect: vi.fn(async () => { throw new Error(`connection failed: ${secretUrl}`); })
        };
        const error = await runMultitenantSchemaMigration({ argv: ['--check'], pool })
            .then(() => null, (caught) => caught);
        expect(error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
        expect(error.message).not.toContain(secretUrl);
        expect(error.message).not.toContain('super-secret');
    });
});
