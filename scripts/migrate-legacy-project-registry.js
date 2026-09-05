#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

const MIGRATION_ID = 'legacy-project-registry.v1';
const ADVISORY_LOCK_NAME = `brainbase:${MIGRATION_ID}`;
const CATALOG_VERSION = 1;
const ALLOWED_KINDS = new Set(['client', 'internal', 'product', 'research', 'other']);
const REGISTRY_COLUMNS = [
    'project_code',
    'organization_id',
    'display_name',
    'kind',
    'catalog_version',
    'lifecycle_status',
    'session_select',
    'organization_entity_id',
    'owner_person_id',
    'repository'
];

export class LegacyProjectRegistryMigrationError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = 'LegacyProjectRegistryMigrationError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function nonEmptyString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', `${field} must be a non-empty string`);
    }
    return value.trim();
}

function optionalString(value, field) {
    if (value === undefined || value === null) return null;
    return nonEmptyString(value, field);
}

function normalizeOrganization(value) {
    const normalized = typeof value === 'string' ? value.trim() : value;
    return normalized || null;
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
}

function equalJson(left, right) {
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function assertProjectCode(value) {
    const projectCode = nonEmptyString(value, 'project_code');
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(projectCode)) {
        throw new LegacyProjectRegistryMigrationError(
            'INPUT_INVALID',
            `project_code must use lowercase letters, numbers, and hyphens: ${projectCode}`
        );
    }
    return projectCode;
}

function normalizeRepository(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', 'repository must be an object');
    }
    return canonicalize(value);
}

export function normalizeLegacyProjectRegistryEntry(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', 'Each migration entry must be an object');
    }
    const organizationId = nonEmptyString(input.organization_id, 'organization_id');
    if (organizationId === '__unassigned__') {
        throw new LegacyProjectRegistryMigrationError(
            'INPUT_INVALID',
            'organization_id cannot be __unassigned__'
        );
    }
    const kind = nonEmptyString(input.kind, 'kind');
    if (!ALLOWED_KINDS.has(kind)) {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', `Unsupported project kind: ${kind}`);
    }
    if (typeof input.session_select !== 'boolean') {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', 'session_select must be boolean');
    }
    return {
        project_code: assertProjectCode(input.project_code),
        organization_id: organizationId,
        display_name: optionalString(input.display_name, 'display_name'),
        kind,
        catalog_version: CATALOG_VERSION,
        lifecycle_status: 'active',
        session_select: input.session_select,
        organization_entity_id: nonEmptyString(input.organization_entity_id, 'organization_entity_id'),
        owner_person_id: nonEmptyString(input.owner_person_id, 'owner_person_id'),
        repository: normalizeRepository(input.repository)
    };
}

export function parseLegacyProjectRegistryArgs(argv = [], env = process.env) {
    let mode = 'dry-run';
    let inputPath = null;
    let actor = String(env.BRAINBASE_MIGRATION_ACTOR || '').trim() || null;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--execute') {
            if (mode === 'execute') throw new LegacyProjectRegistryMigrationError('ARGUMENT_INVALID', 'Duplicate --execute');
            mode = 'execute';
            continue;
        }
        if (argument === '--dry-run') {
            if (mode === 'execute') throw new LegacyProjectRegistryMigrationError('ARGUMENT_INVALID', 'Use only one of --execute or --dry-run');
            continue;
        }
        if (argument === '--input') {
            inputPath = argv[index + 1];
            index += 1;
            continue;
        }
        if (argument.startsWith('--input=')) {
            inputPath = argument.slice('--input='.length);
            continue;
        }
        if (argument === '--actor') {
            actor = argv[index + 1];
            index += 1;
            continue;
        }
        if (argument.startsWith('--actor=')) {
            actor = argument.slice('--actor='.length);
            continue;
        }
        throw new LegacyProjectRegistryMigrationError('ARGUMENT_INVALID', `Unsupported migration argument: ${argument}`);
    }
    if (!String(inputPath || '').trim()) {
        throw new LegacyProjectRegistryMigrationError('ARGUMENT_INVALID', '--input is required');
    }
    if (mode === 'execute' && !String(actor || '').trim()) {
        throw new LegacyProjectRegistryMigrationError(
            'MIGRATION_ACTOR_REQUIRED',
            'BRAINBASE_MIGRATION_ACTOR or --actor is required for --execute'
        );
    }
    return { mode, inputPath: path.resolve(inputPath), actor: mode === 'execute' ? String(actor).trim() : null };
}

export async function readLegacyProjectRegistryInput(inputPath) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(inputPath, 'utf8'));
    } catch (cause) {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', `Could not read migration input: ${cause.message}`);
    }
    const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', 'Migration input must contain a non-empty entries array');
    }
    const normalized = entries.map(normalizeLegacyProjectRegistryEntry);
    const seen = new Set();
    for (const entry of normalized) {
        if (seen.has(entry.project_code)) {
            throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', `Duplicate project_code: ${entry.project_code}`);
        }
        seen.add(entry.project_code);
    }
    return normalized;
}

function registryProjection(row) {
    if (!row) return null;
    return Object.fromEntries(REGISTRY_COLUMNS.map((column) => [column, row[column]]));
}

function desiredRegistry(entry, project) {
    return {
        ...entry,
        display_name: entry.display_name || nonEmptyString(project.name, `projects.name for ${entry.project_code}`)
    };
}

function assertRegistryCompatible(existing, desired) {
    if (!existing) return;
    const current = registryProjection(existing);
    if (!equalJson(current, desired)) {
        throw new LegacyProjectRegistryMigrationError(
            'REGISTRY_CONFLICT',
            `Existing project_registry row differs: ${desired.project_code}`,
            { project_code: desired.project_code, existing: current, requested: desired }
        );
    }
}

function validateProjectOwnership(entry, project, claim) {
    if (!project) {
        throw new LegacyProjectRegistryMigrationError(
            'PROJECT_NOT_FOUND',
            `Existing projects row was not found: ${entry.project_code}`,
            { project_code: entry.project_code }
        );
    }
    const projectOrganization = normalizeOrganization(project.organization_id);
    const claimOrganization = normalizeOrganization(claim?.organization_id);
    if (!claim) {
        throw new LegacyProjectRegistryMigrationError(
            'PROJECT_CODE_CLAIM_MISSING',
            `project_code_claims row was not found: ${entry.project_code}`,
            { project_code: entry.project_code }
        );
    }
    if (projectOrganization && projectOrganization !== entry.organization_id) {
        throw new LegacyProjectRegistryMigrationError(
            'PROJECT_ORGANIZATION_MISMATCH',
            `Existing projects organization differs: ${entry.project_code}`,
            { project_code: entry.project_code, existing_organization_id: projectOrganization, requested_organization_id: entry.organization_id }
        );
    }
    if (claimOrganization !== entry.organization_id && claimOrganization !== '__unassigned__') {
        throw new LegacyProjectRegistryMigrationError(
            'PROJECT_CODE_CLAIM_CONFLICT',
            `Existing project code claim belongs to another organization: ${entry.project_code}`,
            { project_code: entry.project_code, existing_organization_id: claimOrganization, requested_organization_id: entry.organization_id }
        );
    }
    if (!projectOrganization && claimOrganization !== entry.organization_id && claimOrganization !== '__unassigned__') {
        throw new LegacyProjectRegistryMigrationError(
            'PROJECT_ORGANIZATION_UNASSIGNED_CONFLICT',
            `Unassigned project has a cross-organization code claim: ${entry.project_code}`,
            { project_code: entry.project_code, claim_organization_id: claimOrganization }
        );
    }
    return {
        project_organization_id: projectOrganization,
        claim_organization_id: claimOrganization,
        assign_project_organization: !projectOrganization && claimOrganization === '__unassigned__',
        reassign_claim: claimOrganization === '__unassigned__'
    };
}

function emptyCounters() {
    return {
        project_organization_assignments: 0,
        claim_reassignments: 0,
        registry_inserts: 0
    };
}

function rowValues(row) {
    return {
        project_code: row.project_code,
        organization_id: row.organization_id,
        display_name: row.display_name,
        kind: row.kind,
        catalog_version: Number(row.catalog_version),
        lifecycle_status: row.lifecycle_status,
        session_select: row.session_select,
        organization_entity_id: row.organization_entity_id,
        owner_person_id: row.owner_person_id,
        repository: typeof row.repository === 'string' ? JSON.parse(row.repository) : row.repository
    };
}

async function setTransactionOrganizationContext(client, organizationId, projectCodes = []) {
    await client.query("SELECT set_config('app.role',$1,true)", ['ceo']);
    await client.query("SELECT set_config('app.project_codes',$1,true)", [projectCodes.join(',')]);
    await client.query("SELECT set_config('app.clearance',$1,true)", ['internal,restricted,finance,hr,contract']);
    await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
}

async function readAuthorityState(client, entry, project) {
    const organizationResult = await client.query(
        'SELECT id FROM organizations WHERE id=$1',
        [entry.organization_id]
    );
    const ownerResult = await client.query(
        "SELECT id FROM people WHERE id=$1 AND COALESCE(status,'active')='active'",
        [entry.owner_person_id]
    );
    // Legacy projects can have a NULL organization_id. In that case the
    // migration has already validated the claim and will adopt the row into
    // entry.organization_id, so the authority check uses that planned scope.
    const graphOrganizationResult = await client.query(
        `SELECT ge.id
           FROM graph_entities ge
           JOIN projects p ON p.id=ge.project_id
           JOIN organizations o ON o.id=$2
          WHERE ge.id=$1
            AND ge.entity_type='org'
            AND ge.lifecycle_status='active'
            AND (p.organization_id=$2
              OR (p.id=$3 AND COALESCE(BTRIM(p.organization_id),'')=''))
            AND o.id=$2`,
        [entry.organization_entity_id, entry.organization_id, project.id]
    );
    const grantResult = await client.query(
        `SELECT ag.id FROM auth_grants ag JOIN organizations o ON o.workspace_id=ag.slack_workspace_id
         WHERE ag.person_id=$1 AND o.id=$2 AND ag.active=true LIMIT 1`,
        [entry.owner_person_id, entry.organization_id]
    );
    return {
        organization_exists: Boolean(organizationResult.rows[0]),
        owner_person_exists: Boolean(ownerResult.rows[0]),
        organization_entity_exists: Boolean(graphOrganizationResult.rows[0]),
        owner_has_organization_grant: Boolean(grantResult.rows[0])
    };
}

function assertAuthorityState(entry, authority) {
    const missing = Object.entries(authority)
        .filter(([, present]) => !present)
        .map(([field]) => field);
    if (missing.length) {
        throw new LegacyProjectRegistryMigrationError(
            'AUTHORITY_INVALID',
            `Existing authority rows are incomplete: ${entry.project_code}`,
            {
                project_code: entry.project_code,
                organization_id: entry.organization_id,
                organization_entity_id: entry.organization_entity_id,
                owner_person_id: entry.owner_person_id,
                missing_fields: missing
            }
        );
    }
}

async function readEntryState(client, entry) {
    const projectResult = await client.query(
        'SELECT id, code, name, organization_id FROM projects WHERE code=$1 FOR UPDATE',
        [entry.project_code]
    );
    const claimResult = await client.query(
        'SELECT project_code, organization_id FROM project_code_claims WHERE project_code=$1 FOR UPDATE',
        [entry.project_code]
    );
    const registryResult = await client.query(
        'SELECT project_code, organization_id, display_name, kind, catalog_version, lifecycle_status, session_select, organization_entity_id, owner_person_id, repository FROM project_registry WHERE project_code=$1 FOR UPDATE',
        [entry.project_code]
    );
    return {
        project: projectResult.rows[0] || null,
        claim: claimResult.rows[0] || null,
        registry: registryResult.rows[0] || null
    };
}

async function readbackEntry(client, entry, desired, expectedAssignment, expectedClaim, mode) {
    const result = await client.query(
        `SELECT p.code, p.organization_id AS project_organization_id,
                c.organization_id AS claim_organization_id,
                pr.project_code, pr.organization_id, pr.display_name, pr.kind,
                pr.catalog_version, pr.lifecycle_status, pr.session_select,
                pr.organization_entity_id, pr.owner_person_id, pr.repository
           FROM projects p
      LEFT JOIN project_code_claims c ON c.project_code = p.code
      LEFT JOIN project_registry pr ON pr.project_code = p.code
          WHERE p.code=$1`,
        [entry.project_code]
    );
    const row = result.rows[0];
    if (!row || row.code !== entry.project_code) {
        throw new LegacyProjectRegistryMigrationError('READBACK_FAILED', `Project readback missing: ${entry.project_code}`);
    }
    const actual = row.project_code ? rowValues(row) : null;
    if (mode === 'execute' && !actual) {
        throw new LegacyProjectRegistryMigrationError('READBACK_FAILED', `Project registry row missing: ${entry.project_code}`);
    }
    if (actual && !equalJson(actual, desired)) {
        throw new LegacyProjectRegistryMigrationError(
            'READBACK_FAILED',
            `Project registry readback differs: ${entry.project_code}`,
            { project_code: entry.project_code, requested: desired, actual }
        );
    }
    if (mode === 'execute' && expectedAssignment && normalizeOrganization(row.project_organization_id) !== desired.organization_id) {
        throw new LegacyProjectRegistryMigrationError(
            'READBACK_FAILED',
            `Project organization assignment was not read back: ${entry.project_code}`
        );
    }
    if (mode === 'execute' && expectedClaim && normalizeOrganization(row.claim_organization_id) !== desired.organization_id) {
        throw new LegacyProjectRegistryMigrationError(
            'READBACK_FAILED',
            `Project code claim reassignment was not read back: ${entry.project_code}`
        );
    }
    return {
        project_code: entry.project_code,
        project_organization_id: normalizeOrganization(row.project_organization_id),
        claim_organization_id: normalizeOrganization(row.claim_organization_id),
        registry: actual ? 'verified' : 'planned'
    };
}

function codeStatus(entry, existing, plan, mode) {
    if (existing && !plan.assign_project_organization && !plan.reassign_claim) return 'already_registered';
    return mode === 'execute' ? 'applied' : 'planned';
}

export async function runLegacyProjectRegistryMigration({
    entries,
    mode = 'dry-run',
    actor = null,
    env = process.env,
    pool = null
} = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', 'entries must be a non-empty array');
    }
    const normalizedEntries = entries.map(normalizeLegacyProjectRegistryEntry);
    const seen = new Set();
    for (const entry of normalizedEntries) {
        if (seen.has(entry.project_code)) {
            throw new LegacyProjectRegistryMigrationError('INPUT_INVALID', `Duplicate project_code: ${entry.project_code}`);
        }
        seen.add(entry.project_code);
    }
    const projectCodesByOrganization = new Map();
    for (const entry of normalizedEntries) {
        const codes = projectCodesByOrganization.get(entry.organization_id) || [];
        codes.push(entry.project_code);
        projectCodesByOrganization.set(entry.organization_id, codes);
    }
    if (!['dry-run', 'execute'].includes(mode)) {
        throw new LegacyProjectRegistryMigrationError('ARGUMENT_INVALID', `Unsupported mode: ${mode}`);
    }
    if (mode === 'execute' && !String(actor || '').trim()) {
        throw new LegacyProjectRegistryMigrationError('MIGRATION_ACTOR_REQUIRED', 'actor is required for execute mode');
    }
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new LegacyProjectRegistryMigrationError(
            'DATABASE_CONFIG_REQUIRED',
            'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }
    const client = await activePool.connect();
    let transactionStarted = false;
    try {
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))',
            [ADVISORY_LOCK_NAME]
        );
        const plans = [];
        const plannedCounters = emptyCounters();
        for (const entry of normalizedEntries) {
            await setTransactionOrganizationContext(
                client,
                entry.organization_id,
                projectCodesByOrganization.get(entry.organization_id)
            );
            const state = await readEntryState(client, entry);
            const ownership = validateProjectOwnership(entry, state.project, state.claim);
            const authority = await readAuthorityState(client, entry, state.project);
            assertAuthorityState(entry, authority);
            const desired = desiredRegistry(entry, state.project);
            assertRegistryCompatible(state.registry, desired);
            if (ownership.assign_project_organization) plannedCounters.project_organization_assignments += 1;
            if (ownership.reassign_claim) plannedCounters.claim_reassignments += 1;
            if (!state.registry) plannedCounters.registry_inserts += 1;
            plans.push({ entry, desired, state, ownership, authority });
        }

        const perCode = [];
        const appliedCounters = emptyCounters();
        for (const plan of plans) {
            const { entry, desired, state, ownership } = plan;
            await setTransactionOrganizationContext(
                client,
                entry.organization_id,
                projectCodesByOrganization.get(entry.organization_id)
            );
            const status = codeStatus(entry, state.registry, ownership, mode);
            if (mode === 'execute') {
                if (ownership.assign_project_organization) {
                    const result = await client.query(
                        `UPDATE projects SET organization_id=$2
                          WHERE code=$1 AND (organization_id IS NULL OR btrim(organization_id)='')
                      RETURNING code, organization_id`,
                        [entry.project_code, entry.organization_id]
                    );
                    if (result.rowCount !== 1) {
                        throw new LegacyProjectRegistryMigrationError(
                            'APPLY_FAILED',
                            `Project organization assignment did not affect one row: ${entry.project_code}`
                        );
                    }
                    appliedCounters.project_organization_assignments += 1;
                }
                if (ownership.reassign_claim) {
                    const result = await client.query(
                        `UPDATE project_code_claims SET organization_id=$2
                          WHERE project_code=$1 AND organization_id='__unassigned__'
                      RETURNING project_code, organization_id`,
                        [entry.project_code, entry.organization_id]
                    );
                    if (result.rowCount !== 1) {
                        throw new LegacyProjectRegistryMigrationError(
                            'APPLY_FAILED',
                            `Project code claim reassignment did not affect one row: ${entry.project_code}`
                        );
                    }
                    appliedCounters.claim_reassignments += 1;
                }
                if (!state.registry) {
                    await client.query(
                        `INSERT INTO project_registry
                         (project_code, organization_id, display_name, kind, catalog_version,
                          lifecycle_status, session_select, organization_entity_id, owner_person_id, repository)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
                        [entry.project_code, desired.organization_id, desired.display_name, desired.kind,
                            desired.catalog_version, desired.lifecycle_status, desired.session_select,
                            desired.organization_entity_id, desired.owner_person_id, JSON.stringify(desired.repository)]
                    );
                    appliedCounters.registry_inserts += 1;
                }
            }
            perCode.push({
                project_code: entry.project_code,
                status,
                registry: state.registry ? 'already_registered' : mode === 'execute' ? 'inserted' : 'planned',
                project_organization_assignment: ownership.assign_project_organization
                    ? mode === 'execute' ? 'applied' : 'planned'
                    : 'none',
                claim_reassignment: ownership.reassign_claim
                    ? mode === 'execute' ? 'applied' : 'planned'
                    : 'none'
            });
        }

        const readback = [];
        for (const plan of plans) {
            await setTransactionOrganizationContext(
                client,
                plan.entry.organization_id,
                projectCodesByOrganization.get(plan.entry.organization_id)
            );
            readback.push(await readbackEntry(
                client,
                plan.entry,
                plan.desired,
                plan.ownership.assign_project_organization,
                plan.ownership.reassign_claim,
                mode
            ));
        }
        const receipt = {
            schema_version: MIGRATION_ID,
            mode,
            input_count: normalizedEntries.length,
            planned_count: normalizedEntries.length,
            applied_count: mode === 'execute'
                ? appliedCounters.project_organization_assignments + appliedCounters.claim_reassignments + appliedCounters.registry_inserts
                : 0,
            readback_count: readback.length,
            planned: plannedCounters,
            applied: mode === 'execute' ? appliedCounters : emptyCounters(),
            graph_writes: 0,
            per_code: perCode,
            readback: readback.map(({ project_code, project_organization_id, claim_organization_id, registry }) => ({
                project_code, project_organization_id, claim_organization_id, registry
            }))
        };
        if (mode === 'execute') {
            await client.query('COMMIT');
            transactionStarted = false;
        } else {
            await client.query('ROLLBACK');
            transactionStarted = false;
        }
        return receipt;
    } catch (cause) {
        if (transactionStarted) {
            try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
        }
        throw cause;
    } finally {
        client.release();
        if (!pool) await activePool.end();
    }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
    const args = parseLegacyProjectRegistryArgs(argv, env);
    const entries = await readLegacyProjectRegistryInput(args.inputPath);
    return runLegacyProjectRegistryMigration({ entries, mode: args.mode, actor: args.actor, env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().then((receipt) => {
        process.stdout.write(`${JSON.stringify(receipt)}\n`);
    }).catch((error) => {
        process.stderr.write(`${JSON.stringify({
            ok: false,
            error: {
                code: error?.code || 'LEGACY_PROJECT_REGISTRY_MIGRATION_FAILED',
                message: error?.message || String(error),
                ...(error?.details ? { details: error.details } : {})
            }
        })}\n`);
        process.exitCode = 1;
    });
}
