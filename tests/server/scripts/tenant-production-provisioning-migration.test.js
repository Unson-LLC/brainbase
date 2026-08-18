import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    parseTenantProvisioningMigrationArgs,
    REQUIRED_EXISTING_COLUMN_DEFINITIONS,
    REQUIRED_INDEX_DEFINITIONS,
    REQUIRED_VIEW_DEFINITIONS,
    runTenantProvisioningMigration,
    schemaContract as migrationSchemaContract
} from '../../../scripts/migrate-tenant-production-provisioning.js';

const schemaPath = resolve(process.cwd(), 'server/sql/tenant-production-provisioning-schema.sql');

async function readSchemaContract() {
    const sql = await readFile(schemaPath, 'utf8');
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gi)].map((match) => match[1]);
    const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+([a-z0-9_]+)/gi)].map((match) => match[1]);
    const columns = [];
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)\s*\(([^;]+);/gis)) {
        for (const line of match[2].split('\n')) {
            const column = line.trim().match(/^([a-z][a-z0-9_]*)\s+/i)?.[1];
            if (column && !['primary', 'unique', 'foreign', 'references', 'check', 'constraint', 'and', 'or'].includes(column.toLowerCase())) {
                columns.push({ table_name: match[1], column_name: column });
            }
        }
    }
    return { sql, tables, indexes, columns, sha256: createHash('sha256').update(sql).digest('hex') };
}

async function createPool({
    missingIndex = null,
    missingPrerequisite = null,
    indexOverride = {},
    viewDefinition = null,
    columnOverride = {},
    constraintOverride = {},
    missingConstraint = null
} = {}) {
    const contract = await readSchemaContract();
    const migrationContract = migrationSchemaContract(contract.sql);
    const prerequisiteTables = [
        'brainbase_schema_migrations', 'brainbase_tenants', 'tenant_projects',
        'workspace_connections', 'workspace_connection_revisions',
        'credential_broker_refs', 'tenant_contract_revisions'
    ];
    const queries = [];
    const query = vi.fn(async (text, values = []) => {
        const sql = String(text);
        queries.push({ text: sql, values });
        if (sql.includes('FROM information_schema.tables')) {
            return { rows: [...new Set([...contract.tables, ...prerequisiteTables])]
                .filter((table_name) => table_name !== missingPrerequisite)
                .map((table_name) => ({ table_name })) };
        }
        if (sql.includes('FROM information_schema.columns')) {
            const requiredExistingColumns = Object.entries(REQUIRED_EXISTING_COLUMN_DEFINITIONS).flatMap(([table_name, definitions]) => Object.entries(definitions).map(([column_name, definition]) => ({
                table_name,
                column_name,
                data_type: definition.data_type,
                udt_name: definition.udt_name,
                is_nullable: definition.nullable ? 'YES' : 'NO',
                column_default: definition.default
            })));
            const provisioningColumns = [...migrationContract.columnDefinitions.entries()].flatMap(([table_name, definitions]) => [...definitions.entries()].map(([column_name, definition]) => ({
                table_name,
                column_name,
                data_type: definition.data_type,
                udt_name: definition.udt_name,
                is_nullable: definition.nullable ? 'YES' : 'NO',
                column_default: definition.default
            })));
            return {
                rows: [...provisioningColumns, ...requiredExistingColumns]
                    .map((row) => ({
                        ...row,
                        ...(columnOverride[`${row.table_name}.${row.column_name}`] ?? {})
                    }))
            };
        }
        if (sql.includes('FROM pg_indexes')) return {
            rows: contract.indexes
                .filter((indexname) => indexname !== missingIndex)
                .map((indexname) => {
                    const expected = REQUIRED_INDEX_DEFINITIONS[indexname];
                    const override = indexOverride[indexname] ?? {};
                    return {
                        indexname,
                        indexdef: `CREATE ${expected.unique ? 'UNIQUE ' : ''}INDEX ${indexname} ON public.${expected.table_name} USING ${expected.access_method} (${expected.columns.map((column, index) => `${column}${expected.column_orders[index] === 'desc' ? ' DESC' : ''}`).join(', ')})${expected.predicate ? ` WHERE ${expected.predicate}` : ''}`,
                        ...expected,
                        ...override,
                        columns: override.columns ?? expected.columns,
                        column_orders: override.column_orders ?? expected.column_orders,
                        table_name: override.table_name ?? expected.table_name,
                        access_method: override.access_method ?? expected.access_method,
                        is_unique: override.is_unique ?? expected.unique,
                        predicate: Object.prototype.hasOwnProperty.call(override, 'predicate') ? override.predicate : expected.predicate
                    };
                })
        };
        if (sql.includes('FROM pg_constraint')) {
            const constraintRows = migrationContract.constraints.map((expected, index) => ({
                table_name: expected.table_name,
                conname: expected.constraint_name ?? `fixture_constraint_${index}`,
                contype: expected.contype,
                definition: expected.definition,
                on_update: expected.on_update,
                on_delete: expected.on_delete
            }));
            return {
                rows: constraintRows
                    .filter((row) => {
                        if (!missingConstraint) return true;
                        return !(
                            row.table_name === missingConstraint.table_name
                            && row.contype === missingConstraint.contype
                            && row.definition.replaceAll(/\s+/gu, ' ').toLowerCase() === missingConstraint.definition.replaceAll(/\s+/gu, ' ').toLowerCase()
                        );
                    })
                    .map((row) => ({ ...row, ...(constraintOverride[row.conname] ?? {}) }))
            };
        }
        if (sql.includes('FROM pg_views')) return {
            rows: [{
                table_name: 'brainbase_service_actor_jwks',
                definition: viewDefinition ?? REQUIRED_VIEW_DEFINITIONS.brainbase_service_actor_jwks
            }]
        };
        if (sql.includes('FROM brainbase_schema_migrations')) return { rows: [{ schema_sha256: contract.sha256 }] };
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

describe('tenant production provisioning migration runner', () => {
    it('requires one mode and explicit approval plus actor for apply', () => {
        expect(parseTenantProvisioningMigrationArgs(['--check'])).toEqual({ mode: 'check', approved: false });
        expect(() => parseTenantProvisioningMigrationArgs(['--check', '--dry-run'])).toThrow(/exactly one/u);
        expect(() => parseTenantProvisioningMigrationArgs(['--apply'])).toThrow(/approve-apply/u);
        expect(() => parseTenantProvisioningMigrationArgs(['--apply', '--approve-apply'], {})).toThrow(/ACTOR/u);
        expect(parseTenantProvisioningMigrationArgs(
            ['--apply', '--approve-apply'],
            { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' }
        )).toEqual({ mode: 'apply', approved: true });
    });

    it('check reads table, column, index, and ledger state without DDL', async () => {
        const { pool, queries, contract } = await createPool();
        const result = await runTenantProvisioningMigration({ argv: ['--check'], pool });
        expect(result).toMatchObject({ ok: true, mode: 'check', schema_sha256: contract.sha256, persisted: true });
        expect(queries.some(({ text }) => text.includes('CREATE TABLE'))).toBe(false);
        expect(queries.some(({ text }) => text === 'COMMIT')).toBe(false);
    });

    it('dry-run rolls back the complete schema transaction', async () => {
        const { pool, queries } = await createPool();
        const result = await runTenantProvisioningMigration({ argv: ['--dry-run'], pool });
        expect(result).toMatchObject({ ok: true, mode: 'dry-run', persisted: false });
        expect(queries.map(({ text }) => text)).toContain('BEGIN');
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
        expect(queries.map(({ text }) => text)).not.toContain('COMMIT');
    });

    it('apply records a version and commits only after readback', async () => {
        const { pool, queries, contract } = await createPool();
        const result = await runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        });
        expect(result).toMatchObject({ ok: true, mode: 'apply', persisted: true, schema_sha256: contract.sha256 });
        expect(queries.some(({ text }) => text.includes('pg_advisory_xact_lock'))).toBe(true);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(true);
        expect(queries.map(({ text }) => text)).toContain('COMMIT');
        expect(JSON.stringify(result)).not.toContain('operator@example.test');
    });

    it('missing index rolls back and does not report success', async () => {
        const { pool, queries, contract } = await createPool({ missingIndex: 'workspace_connections_tenant_provider_workspace_app_uq' });
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/missing indexes/u);
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
        expect(queries.map(({ text }) => text)).not.toContain('COMMIT');
    });

    it('rejects a same-name workspace index with the wrong uniqueness, columns, or predicate before ledger write', async () => {
        const { pool, queries } = await createPool({
            indexOverride: {
                workspace_connections_tenant_provider_workspace_app_uq: {
                    is_unique: false,
                    columns: ['tenant_id', 'workspace_id', 'provider', 'app_id'],
                    predicate: "status IN ('active')"
                }
            }
        });
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/index definitions are missing or incorrect/u);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(false);
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('rejects a same-name non-unique index with the wrong column definition', async () => {
        const { pool, queries } = await createPool({
            indexOverride: {
                tenant_provisioning_operations_claim_idx: {
                    columns: ['tenant_key', 'status', 'idempotency_key', 'claimed_at']
                }
            }
        });
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/index definitions are missing or incorrect/u);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(false);
    });

    it('rejects a same-name column with the wrong type, nullability, or default before ledger write', async () => {
        const { pool, queries } = await createPool({
            columnOverride: {
                'tenant_provisioning_operations.attempt': {
                    data_type: 'text',
                    udt_name: 'text',
                    is_nullable: 'YES',
                    column_default: '0'
                }
            }
        });
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/column definitions are missing or incorrect/u);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(false);
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('rejects a same-name foreign key with a wrong action or definition before ledger write', async () => {
        const { pool, queries } = await createPool({
            constraintOverride: {
                workspace_connection_revisions_current_identity_fk: {
                    on_delete: 'c'
                }
            }
        });
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/constraints are missing or incorrect/u);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(false);
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('rejects a table with a missing inline primary key before ledger write', async () => {
        const { pool, queries } = await createPool({
            missingConstraint: {
                table_name: 'brainbase_tenant_revisions',
                contype: 'p',
                definition: 'PRIMARY KEY (tenant_id, tenant_revision)'
            }
        });
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/constraints are missing or incorrect/u);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(false);
        expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('rejects a same-name view with a different normalized definition before ledger write', async () => {
        const { pool, queries } = await createPool({
            viewDefinition: "SELECT actor_id, jsonb_build_object('keys', jsonb_agg(kid)) AS jwks FROM brainbase_service_actor_keys WHERE status = 'active' GROUP BY actor_id"
        });
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' },
            pool
        })).rejects.toThrow(/view definitions are missing or incorrect/u);
        expect(queries.some(({ text }) => text.includes('INSERT INTO brainbase_schema_migrations'))).toBe(false);
    });

    it('blocks when the base multitenant schema is not present', async () => {
        const { pool, queries } = await createPool({ missingPrerequisite: 'tenant_projects' });
        await expect(runTenantProvisioningMigration({ argv: ['--check'], pool }))
            .rejects.toThrow(/missing tables: tenant_projects/u);
        expect(queries.some(({ text }) => text.includes('CREATE TABLE'))).toBe(false);
    });
});
