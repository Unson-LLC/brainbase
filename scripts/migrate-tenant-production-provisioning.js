#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'server/sql/tenant-production-provisioning-schema.sql');
const MIGRATION_ID = 'tenant-production-provisioning.v1';
const ADVISORY_LOCK_NAME = 'brainbase:tenant-production-provisioning:v1';
const REQUIRED_INDEXES = [
    'brainbase_tenants_tenant_key_uq',
    'workspace_connections_tenant_provider_workspace_app_uq',
    'tenant_provisioning_operations_tenant_status_idx',
    'brainbase_service_actors_tenant_idx',
    'brainbase_service_actor_capabilities_tenant_idx',
    'tenant_contract_revision_runtime_bindings_deployment_idx',
    'slack_installation_intents_tenant_idx',
    'slack_installation_exchange_ledger_tenant_idx',
    'slack_installation_exchange_ledger_claim_idx'
];
const REQUIRED_EXISTING_TABLES = [
    'brainbase_schema_migrations',
    'brainbase_tenants',
    'tenant_projects',
    'workspace_connections',
    'workspace_connection_revisions',
    'credential_broker_refs',
    'tenant_contract_revisions'
];
const REQUIRED_EXISTING_COLUMNS = Object.freeze({
    brainbase_tenants: [
        'tenant_key'
    ],
    workspace_connections: [
        'enterprise_id',
        'installer_id',
        'deployment_id',
        'profile',
        'contract_revision'
    ]
});
const REQUIRED_VIEWS = ['brainbase_service_actor_jwks'];
const REQUIRED_CONSTRAINTS = Object.freeze([
    ['workspace_connections', 'status', /check .*status.*pending.*active.*revoked.*reauth_required.*uninstalled.*expired/iu],
    ['workspace_connections', 'profile', /check .*profile.*shared_cloud.*dedicated_cloud.*customer_managed_oss/iu],
    ['workspace_connection_revisions', 'current_identity_fk', /foreign key \(tenant_id, connection_id\) references workspace_connections/iu],
    ['credential_broker_refs', 'connection_revision_fk', /foreign key \(tenant_id, connection_id, connection_revision\) references workspace_connection_revisions/iu],
    ['tenant_credential_leases', 'connection_revision_fk', /foreign key \(tenant_id, connection_id, connection_revision\) references workspace_connection_revisions/iu],
    ['tenant_usage_events', 'connection_revision_fk', /foreign key \(tenant_id, connection_id, connection_revision\) references workspace_connection_revisions/iu],
    ['tenant_operation_receipts', 'connection_revision_fk', /foreign key \(tenant_id, connection_id, connection_revision\) references workspace_connection_revisions/iu],
    ['tenant_business_effect_claims', 'connection_revision_fk', /foreign key \(tenant_id, connection_id, connection_revision\) references workspace_connection_revisions/iu],
    ['tenant_organizations', 'tenant_revision_history_fk', /foreign key \(tenant_id, tenant_revision_at_write\) references brainbase_tenant_revisions/iu],
    ['tenant_memberships', 'tenant_revision_history_fk', /foreign key \(tenant_id, tenant_revision_at_write\) references brainbase_tenant_revisions/iu],
    ['tenant_projects', 'tenant_revision_history_fk', /foreign key \(tenant_id, tenant_revision_at_write\) references brainbase_tenant_revisions/iu],
    ['workspace_connections', 'tenant_revision_history_fk', /foreign key \(tenant_id, tenant_revision_at_write\) references brainbase_tenant_revisions/iu],
    ['tenant_contract_revisions', 'tenant_revision_history_fk', /foreign key \(tenant_id, tenant_revision_at_write\) references brainbase_tenant_revisions/iu],
    ['slack_installation_intents', 'tenant_revision_history_fk', /foreign key \(tenant_id, tenant_revision_at_write\) references brainbase_tenant_revisions/iu],
    ['tenant_provisioning_operations', 'claim_token_hash', /check .*claim_token_hash.*sha256/iu],
    ['tenant_provisioning_operations', 'attempt', /check .*attempt.*[>] 0/iu],
    ['slack_installation_exchange_ledger', 'status', /check .*status.*processing.*completed.*failed/iu],
    ['brainbase_service_actor_capabilities', 'status', /check .*status.*active.*revoked/iu],
    ['brainbase_service_actor_keys', 'status', /check .*status.*active.*revoked/iu],
    ['tenant_contract_revision_runtime_bindings', 'contract_fk', /foreign key \(tenant_id, contract_id, contract_revision\) references tenant_contract_revisions/iu]
]);

export class TenantProvisioningMigrationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'TenantProvisioningMigrationError';
        this.code = code;
    }
}

function schemaContract(sql) {
    const tableColumns = new Map();
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)\s*\(([^;]+)\);/gis)) {
        const columns = [];
        for (const line of match[2].split('\n')) {
            const column = line.trim().match(/^([a-z][a-z0-9_]*)\s+/i)?.[1];
            if (column && !['primary', 'unique', 'foreign', 'references', 'check', 'constraint', 'and', 'or'].includes(column.toLowerCase())) {
                columns.push(column);
            }
        }
        tableColumns.set(match[1], columns);
    }
    return {
        sha256: createHash('sha256').update(sql).digest('hex'),
        tableColumns,
        indexes: REQUIRED_INDEXES
    };
}

function missing(expected, actual) {
    const actualSet = new Set(actual);
    return expected.filter((value) => !actualSet.has(value)).sort();
}

function normalizeSql(value) {
    return String(value ?? '').toLowerCase().replaceAll('"', '').replaceAll(/\s+/gu, ' ').trim();
}

export function parseTenantProvisioningMigrationArgs(argv = [], env = process.env) {
    const modes = ['dry-run', 'check', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) throw new TenantProvisioningMigrationError('ARGUMENT_INVALID', 'Specify exactly one migration mode');
    const allowed = new Set([`--${modes[0]}`]);
    if (modes[0] === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument) => !allowed.has(argument))) {
        throw new TenantProvisioningMigrationError('ARGUMENT_INVALID', 'Unsupported tenant provisioning migration argument');
    }
    const approved = argv.includes('--approve-apply');
    if (modes[0] === 'apply' && !approved) {
        throw new TenantProvisioningMigrationError('APPLY_APPROVAL_REQUIRED', 'Schema apply requires --approve-apply');
    }
    if (modes[0] === 'apply' && !String(env.BRAINBASE_MIGRATION_ACTOR ?? '').trim()) {
        throw new TenantProvisioningMigrationError('MIGRATION_ACTOR_REQUIRED', 'BRAINBASE_MIGRATION_ACTOR is required for schema apply');
    }
    return { mode: modes[0], approved };
}

async function readbackSchema(client, contract) {
    const tables = [...contract.tableColumns.keys()];
    const prerequisiteResult = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = ANY($1::text[])
          ORDER BY table_name`,
        [REQUIRED_EXISTING_TABLES]
    );
    const missingPrerequisites = missing(REQUIRED_EXISTING_TABLES, prerequisiteResult.rows.map((row) => row.table_name));
    if (missingPrerequisites.length) {
        throw new TenantProvisioningMigrationError(
            'SCHEMA_PREREQUISITE_FAILED',
            `Base multitenant schema has missing tables: ${missingPrerequisites.join(', ')}`
        );
    }
    const tableResult = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = ANY($1::text[])
          ORDER BY table_name`,
        [tables]
    );
    const missingTables = missing(tables, tableResult.rows.map((row) => row.table_name));
    if (missingTables.length) throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', `Provisioning schema has missing tables: ${missingTables.join(', ')}`);

    const columnTables = [...new Set([...tables, ...Object.keys(REQUIRED_EXISTING_COLUMNS)])];
    const columnResult = await client.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ANY($1::text[])
          ORDER BY table_name, ordinal_position`,
        [columnTables]
    );
    const actualColumns = new Map(columnTables.map((table) => [table, []]));
    for (const row of columnResult.rows) actualColumns.get(row.table_name)?.push(row.column_name);
    const missingColumns = [];
    for (const [table, columns] of contract.tableColumns) {
        for (const column of missing(columns, actualColumns.get(table) ?? [])) missingColumns.push(`${table}.${column}`);
    }
    for (const [table, columns] of Object.entries(REQUIRED_EXISTING_COLUMNS)) {
        for (const column of missing(columns, actualColumns.get(table) ?? [])) missingColumns.push(`${table}.${column}`);
    }
    if (missingColumns.length) throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', `Provisioning schema has missing columns: ${missingColumns.join(', ')}`);

    const indexResult = await client.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`,
        [contract.indexes]
    );
    const missingIndexes = missing(contract.indexes, indexResult.rows.map((row) => row.indexname));
    if (missingIndexes.length) throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', `Provisioning schema has missing indexes: ${missingIndexes.join(', ')}`);
    const uniqueWorkspaceIndex = indexResult.rows.find(({ indexname }) => indexname === 'workspace_connections_tenant_provider_workspace_app_uq');
    if (!uniqueWorkspaceIndex || !/where .*status.*pending.*active/iu.test(normalizeSql(uniqueWorkspaceIndex.indexdef))) {
        throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', 'workspace connection uniqueness predicate is missing or incorrect');
    }

    const constraintResult = await client.query(
        `SELECT conrelid::regclass::text AS table_name, conname, contype,
                pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE connamespace = current_schema()::regnamespace
          ORDER BY table_name, conname`
    );
    const normalizedConstraints = constraintResult.rows.map((row) => ({
        table_name: normalizeSql(row.table_name),
        definition: normalizeSql(row.definition)
    }));
    const missingConstraints = REQUIRED_CONSTRAINTS.filter(([table, , fragment]) => {
        return !normalizedConstraints.some(({ table_name: actualTable, definition }) => {
            if (actualTable !== normalizeSql(table)) return false;
            return fragment instanceof RegExp ? fragment.test(definition) : definition.includes(normalizeSql(fragment));
        });
    }).map(([table, name]) => `${table}.${name}`);
    if (missingConstraints.length) throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', `Provisioning schema constraints are missing: ${missingConstraints.join(', ')}`);

    const viewResult = await client.query(
        `SELECT table_name FROM information_schema.views
          WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
        [REQUIRED_VIEWS]
    );
    const missingViews = missing(REQUIRED_VIEWS, viewResult.rows.map((row) => row.table_name));
    if (missingViews.length) throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', `Provisioning schema has missing views: ${missingViews.join(', ')}`);

    const ledgerResult = await client.query(
        `SELECT schema_sha256 FROM brainbase_schema_migrations WHERE migration_id = $1`,
        [MIGRATION_ID]
    );
    if (ledgerResult.rows[0]?.schema_sha256 !== contract.sha256) {
        throw new TenantProvisioningMigrationError('SCHEMA_VERSION_MISMATCH', 'Provisioning schema ledger does not match repository schema hash');
    }
    return {
        table_count: tables.length,
        prerequisite_table_count: REQUIRED_EXISTING_TABLES.length,
        column_count: [...contract.tableColumns.values()].reduce((sum, columns) => sum + columns.length, 0),
        existing_column_count: Object.values(REQUIRED_EXISTING_COLUMNS).flat().length,
        index_count: contract.indexes.length,
        constraint_count: REQUIRED_CONSTRAINTS.length,
        view_count: REQUIRED_VIEWS.length,
        ledger_matches: true
    };
}

async function recordSchemaVersion(client, { sha256, actor }) {
    await client.query(
        `INSERT INTO brainbase_schema_migrations (migration_id, schema_sha256, applied_at, applied_by)
         VALUES ($1, $2, now(), $3)
         ON CONFLICT (migration_id) DO UPDATE SET
            schema_sha256 = EXCLUDED.schema_sha256,
            applied_at = EXCLUDED.applied_at,
            applied_by = EXCLUDED.applied_by`,
        [MIGRATION_ID, sha256, actor]
    );
}

export async function runTenantProvisioningMigration({ argv = process.argv.slice(2), env = process.env, pool = null } = {}) {
    const { mode } = parseTenantProvisioningMigrationArgs(argv, env);
    const sql = await readFile(SCHEMA_PATH, 'utf8');
    const contract = schemaContract(sql);
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new TenantProvisioningMigrationError('DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required');
    let client;
    let transactionStarted = false;
    try {
        client = await activePool.connect();
        if (mode === 'check') {
            return {
                ok: true,
                mode,
                migration_id: MIGRATION_ID,
                schema_sha256: contract.sha256,
                persisted: true,
                readback: await readbackSchema(client, contract)
            };
        }
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '120s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ADVISORY_LOCK_NAME]);
        await client.query(sql);
        await recordSchemaVersion(client, {
            sha256: contract.sha256,
            actor: mode === 'apply' ? String(env.BRAINBASE_MIGRATION_ACTOR).trim() : 'dry-run'
        });
        const readback = await readbackSchema(client, contract);
        if (mode === 'dry-run') {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return { ok: true, mode, migration_id: MIGRATION_ID, schema_sha256: contract.sha256, persisted: false, readback };
        }
        await client.query('COMMIT');
        transactionStarted = false;
        return { ok: true, mode, migration_id: MIGRATION_ID, schema_sha256: contract.sha256, persisted: true, readback };
    } catch (error) {
        if (transactionStarted && client) {
            try { await client.query('ROLLBACK'); } catch { /* preserve safe original error */ }
        }
        if (error instanceof TenantProvisioningMigrationError) throw error;
        throw new TenantProvisioningMigrationError('UPSTREAM_UNAVAILABLE', 'Tenant provisioning schema migration failed; inspect PostgreSQL logs');
    } finally {
        client?.release();
        if (!pool) {
            try { await activePool.end(); } catch { /* do not expose driver details */ }
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runTenantProvisioningMigration()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'MIGRATION_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
