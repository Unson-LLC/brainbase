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
export const REQUIRED_INDEX_DEFINITIONS = Object.freeze({
    brainbase_tenants_tenant_key_uq: Object.freeze({
        table_name: 'brainbase_tenants',
        access_method: 'btree',
        unique: true,
        columns: Object.freeze(['tenant_key']),
        column_orders: Object.freeze(['asc']),
        predicate: null
    }),
    tenant_contract_revision_runtime_bindings_deployment_idx: Object.freeze({
        table_name: 'tenant_contract_revision_runtime_bindings',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_id', 'deployment_id', 'profile']),
        column_orders: Object.freeze(['asc', 'asc', 'asc']),
        predicate: null
    }),
    workspace_connections_tenant_provider_workspace_app_uq: Object.freeze({
        table_name: 'workspace_connections',
        access_method: 'btree',
        unique: true,
        columns: Object.freeze(['tenant_id', 'provider', 'workspace_id', 'app_id']),
        column_orders: Object.freeze(['asc', 'asc', 'asc', 'asc']),
        predicate: "status IN ('pending', 'active')"
    }),
    slack_installation_intents_tenant_idx: Object.freeze({
        table_name: 'slack_installation_intents',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_id', 'expires_at', 'consumed_at']),
        column_orders: Object.freeze(['asc', 'asc', 'asc']),
        predicate: null
    }),
    slack_installation_exchange_ledger_tenant_idx: Object.freeze({
        table_name: 'slack_installation_exchange_ledger',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_id', 'created_at']),
        column_orders: Object.freeze(['asc', 'desc']),
        predicate: null
    }),
    slack_installation_exchange_ledger_claim_idx: Object.freeze({
        table_name: 'slack_installation_exchange_ledger',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_id', 'status', 'claimed_at']),
        column_orders: Object.freeze(['asc', 'asc', 'asc']),
        predicate: null
    }),
    tenant_provisioning_operations_tenant_status_idx: Object.freeze({
        table_name: 'tenant_provisioning_operations',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_key', 'status', 'updated_at']),
        column_orders: Object.freeze(['asc', 'asc', 'desc']),
        predicate: null
    }),
    tenant_provisioning_operations_claim_idx: Object.freeze({
        table_name: 'tenant_provisioning_operations',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_key', 'idempotency_key', 'status', 'claimed_at']),
        column_orders: Object.freeze(['asc', 'asc', 'asc', 'asc']),
        predicate: null
    }),
    brainbase_service_actors_tenant_idx: Object.freeze({
        table_name: 'brainbase_service_actors',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_key', 'canonical_project_id']),
        column_orders: Object.freeze(['asc', 'asc']),
        predicate: null
    }),
    brainbase_service_actor_capabilities_tenant_idx: Object.freeze({
        table_name: 'brainbase_service_actor_capabilities',
        access_method: 'btree',
        unique: false,
        columns: Object.freeze(['tenant_key', 'actor_id']),
        column_orders: Object.freeze(['asc', 'asc']),
        predicate: null
    })
});
const REQUIRED_INDEXES = Object.freeze(Object.keys(REQUIRED_INDEX_DEFINITIONS));
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
export const REQUIRED_VIEW_DEFINITIONS = Object.freeze({
    brainbase_service_actor_jwks: `SELECT actor_id,
       jsonb_build_object(
           'keys', jsonb_agg(public_jwk ORDER BY kid)
       ) AS jwks
  FROM brainbase_service_actor_keys
 WHERE status = 'active'
 GROUP BY actor_id`
});
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

function stripOuterParentheses(value) {
    let current = value.trim();
    while (current.startsWith('(') && current.endsWith(')')) {
        let depth = 0;
        let wrapsWholeExpression = true;
        for (let index = 0; index < current.length; index += 1) {
            if (current[index] === '(') depth += 1;
            if (current[index] === ')') depth -= 1;
            if (depth === 0 && index < current.length - 1) {
                wrapsWholeExpression = false;
                break;
            }
        }
        if (!wrapsWholeExpression) break;
        current = current.slice(1, -1).trim();
    }
    return current;
}

function normalizePredicate(value) {
    if (value === null || value === undefined || normalizeSql(value) === '') return null;
    const normalized = stripOuterParentheses(normalizeSql(value).replace(/;$/u, '').trim());
    const inMatch = normalized.match(/^status\s+in\s*\((.*)\)$/iu);
    const anyMatch = normalized.match(/^status\s*=\s*any\s*\(\s*array\s*\[(.*)\]\s*\)$/iu);
    const valuesSource = inMatch?.[1] ?? anyMatch?.[1];
    if (valuesSource !== undefined) {
        const values = [...valuesSource.matchAll(/'([^']*)'/gu)]
            .map(([, value]) => value)
            .sort();
        if (values.length > 0) return `status in (${values.join(',')})`;
    }
    return normalized;
}

function normalizeViewDefinition(value) {
    return normalizeSql(value)
        .replace(/;$/u, '')
        .replaceAll(/::[a-z_][a-z0-9_.]*/gu, '')
        .replaceAll(/\(status\s*=\s*'active'\)/gu, "status = 'active'")
        .replaceAll(/\bpublic\./gu, '')
        .replaceAll(/\s*([(),])\s*/gu, '$1')
        .trim();
}

function parseIndexDefinition(indexdef) {
    const normalized = normalizeSql(indexdef);
    const match = normalized.match(
        /^create\s+(unique\s+)?index\s+[^\s]+\s+on\s+(?:[^\s.]+\.)?([^\s]+)(?:\s+using\s+([^\s(]+))?\s*\(([^)]*)\)(?:\s+where\s+(.+))?$/iu
    );
    if (!match) return null;
    return {
        table_name: match[2],
        access_method: match[3] ?? 'btree',
        unique: Boolean(match[1]),
        columns: match[4].split(',').map((column) => column.trim()).filter(Boolean).map((column) => column.replace(/\s+(?:asc|desc)(?:\s+nulls\s+(?:first|last))?$/iu, '').trim()),
        column_orders: match[4].split(',').map((column) => /\s+desc(?:\s+nulls\s+(?:first|last))?$/iu.test(column.trim()) ? 'desc' : 'asc'),
        predicate: match[5] ?? null
    };
}

function readCatalogColumns(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        return value.slice(1, -1).split(',').map((column) => column.trim()).filter(Boolean);
    }
    return fallback;
}

function readCatalogColumnOrders(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        return value.slice(1, -1).split(',').map((order) => order.trim()).filter(Boolean);
    }
    return fallback;
}

function catalogIndexDefinition(row) {
    const parsed = parseIndexDefinition(row.indexdef);
    return {
        table_name: normalizeSql(row.table_name ?? parsed?.table_name),
        access_method: normalizeSql(row.access_method ?? parsed?.access_method),
        unique: typeof row.is_unique === 'boolean' ? row.is_unique : (parsed?.unique ?? false),
        columns: readCatalogColumns(row.columns, parsed?.columns ?? [])
            .map((column) => normalizeSql(column)),
        column_orders: readCatalogColumnOrders(row.column_orders, parsed?.column_orders ?? [])
            .map((order) => normalizeSql(order)),
        predicate: row.predicate ?? parsed?.predicate ?? null
    };
}

function indexDefinitionMismatch(indexname, row) {
    const expected = REQUIRED_INDEX_DEFINITIONS[indexname];
    const actual = catalogIndexDefinition(row);
    if (!expected) return 'not declared in the migration contract';
    if (actual.table_name !== expected.table_name) return `table=${actual.table_name || 'unknown'}`;
    if (actual.access_method !== expected.access_method) return `access_method=${actual.access_method || 'unknown'}`;
    if (actual.unique !== expected.unique) return `unique=${String(actual.unique)}`;
    if (actual.columns.join(',') !== expected.columns.join(',')) return `columns=${actual.columns.join(',') || 'none'}`;
    if (actual.column_orders.join(',') !== expected.column_orders.join(',')) return `column_orders=${actual.column_orders.join(',') || 'none'}`;
    if (normalizePredicate(actual.predicate) !== normalizePredicate(expected.predicate)) {
        return `predicate=${normalizePredicate(actual.predicate) ?? 'none'}`;
    }
    return null;
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

async function readbackSchema(client, contract, { verifyLedger = true } = {}) {
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
        `SELECT indexes.indexname,
                indexes.indexdef,
                table_class.relname AS table_name,
                access_method.amname AS access_method,
                index_catalog.indisunique AS is_unique,
                COALESCE(
                    (
                        SELECT array_agg(attribute.attname ORDER BY key_position.ordinality)
                          FROM unnest(index_catalog.indkey::smallint[]) WITH ORDINALITY AS key_position(attnum, ordinality)
                          LEFT JOIN pg_attribute attribute
                            ON attribute.attrelid = index_catalog.indrelid
                           AND attribute.attnum = key_position.attnum
                         WHERE key_position.ordinality <= index_catalog.indnkeyatts
                    ),
                    ARRAY[]::text[]
                ) AS columns,
                COALESCE(
                    (
                        SELECT array_agg(
                            CASE WHEN (key_option.option & 1) = 1 THEN 'desc' ELSE 'asc' END
                            ORDER BY key_option.ordinality
                        )
                          FROM unnest(index_catalog.indoption::smallint[]) WITH ORDINALITY AS key_option(option, ordinality)
                         WHERE key_option.ordinality <= index_catalog.indnkeyatts
                    ),
                    ARRAY[]::text[]
                ) AS column_orders,
                pg_get_expr(index_catalog.indpred, index_catalog.indrelid) AS predicate
           FROM pg_indexes indexes
           JOIN pg_class index_class
             ON index_class.relname = indexes.indexname
           JOIN pg_namespace index_namespace
             ON index_namespace.oid = index_class.relnamespace
            AND index_namespace.nspname = current_schema()
           JOIN pg_index index_catalog
             ON index_catalog.indexrelid = index_class.oid
           JOIN pg_class table_class
             ON table_class.oid = index_catalog.indrelid
           JOIN pg_am access_method
             ON access_method.oid = index_class.relam
          WHERE indexes.schemaname = current_schema()
            AND indexes.indexname = ANY($1::text[])`,
        [contract.indexes]
    );
    const missingIndexes = missing(contract.indexes, indexResult.rows.map((row) => row.indexname));
    if (missingIndexes.length) throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', `Provisioning schema has missing indexes: ${missingIndexes.join(', ')}`);
    const incorrectIndexes = indexResult.rows
        .map((row) => ({ indexname: row.indexname, reason: indexDefinitionMismatch(row.indexname, row) }))
        .filter(({ reason }) => reason)
        .map(({ indexname, reason }) => `${indexname} (${reason})`);
    if (incorrectIndexes.length) {
        throw new TenantProvisioningMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Provisioning schema index definitions are missing or incorrect: ${incorrectIndexes.join(', ')}`
        );
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
        `SELECT viewname AS table_name, definition FROM pg_views
          WHERE schemaname = current_schema() AND viewname = ANY($1::text[])`,
        [REQUIRED_VIEWS]
    );
    const missingViews = missing(REQUIRED_VIEWS, viewResult.rows.map((row) => row.table_name));
    if (missingViews.length) throw new TenantProvisioningMigrationError('SCHEMA_READBACK_FAILED', `Provisioning schema has missing views: ${missingViews.join(', ')}`);
    const incorrectViews = viewResult.rows
        .filter((row) => normalizeViewDefinition(row.definition) !== normalizeViewDefinition(REQUIRED_VIEW_DEFINITIONS[row.table_name]))
        .map((row) => row.table_name);
    if (incorrectViews.length) {
        throw new TenantProvisioningMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Provisioning schema view definitions are missing or incorrect: ${incorrectViews.join(', ')}`
        );
    }

    let ledgerMatches = true;
    if (verifyLedger) {
        const ledgerResult = await client.query(
            `SELECT schema_sha256 FROM brainbase_schema_migrations WHERE migration_id = $1`,
            [MIGRATION_ID]
        );
        ledgerMatches = ledgerResult.rows[0]?.schema_sha256 === contract.sha256;
        if (!ledgerMatches) {
            throw new TenantProvisioningMigrationError('SCHEMA_VERSION_MISMATCH', 'Provisioning schema ledger does not match repository schema hash');
        }
    }
    return {
        table_count: tables.length,
        prerequisite_table_count: REQUIRED_EXISTING_TABLES.length,
        column_count: [...contract.tableColumns.values()].reduce((sum, columns) => sum + columns.length, 0),
        existing_column_count: Object.values(REQUIRED_EXISTING_COLUMNS).flat().length,
        index_count: contract.indexes.length,
        constraint_count: REQUIRED_CONSTRAINTS.length,
        view_count: REQUIRED_VIEWS.length,
        ledger_matches: ledgerMatches
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
        // Validate every catalog definition before recording the repository
        // hash.  A same-name object with a different definition must never
        // become a successful migration ledger entry.
        const structuralReadback = await readbackSchema(client, contract, { verifyLedger: false });
        await recordSchemaVersion(client, {
            sha256: contract.sha256,
            actor: mode === 'apply' ? String(env.BRAINBASE_MIGRATION_ACTOR).trim() : 'dry-run'
        });
        const ledgerReadback = await readbackSchema(client, contract);
        const readback = { ...structuralReadback, ledger_matches: ledgerReadback.ledger_matches };
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
