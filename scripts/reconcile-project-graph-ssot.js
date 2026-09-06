#!/usr/bin/env node
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

const MIGRATION_ID = 'project-graph-ssot.v1';
const LOCK_NAME = `brainbase:${MIGRATION_ID}`;

export class ProjectGraphReconciliationError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = 'ProjectGraphReconciliationError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

const text = (value) => String(value || '').trim();

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function classifyProjectBinding(row) {
    const candidates = (Array.isArray(row?.candidates) ? row.candidates : [])
        .filter((candidate) => candidate.lifecycle_status !== 'merged');
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const linked = text(row?.graph_entity_id);
    if (linked && byId.has(linked)) {
        const remaining = candidates.filter((candidate) => candidate.id !== linked);
        const mergeable = remaining.filter((candidate) => candidate.id === row.scope_id);
        const conflicts = remaining.filter((candidate) => candidate.id !== row.scope_id)
            .map((candidate) => candidate.id).sort();
        if (conflicts.length) {
            return { action: 'ambiguous', canonical_entity_id: linked, merge_entity_ids: [], conflicts };
        }
        return {
            action: 'link_existing', canonical_entity_id: linked,
            merge_entity_ids: mergeable.map((candidate) => candidate.id), conflicts: []
        };
    }
    const exact = byId.get(row.project_code);
    if (exact) {
        const remaining = candidates.filter((candidate) => candidate.id !== exact.id);
        const mergeable = remaining.filter((candidate) => candidate.id === row.scope_id);
        const conflicts = remaining.filter((candidate) => candidate.id !== row.scope_id).map((candidate) => candidate.id).sort();
        if (conflicts.length) {
            return { action: 'ambiguous', canonical_entity_id: exact.id, merge_entity_ids: [], conflicts };
        }
        return {
            action: 'link_existing', canonical_entity_id: exact.id,
            merge_entity_ids: mergeable.map((candidate) => candidate.id), conflicts: []
        };
    }
    if (candidates.length === 0) {
        return { action: 'create_canonical', canonical_entity_id: row.project_code, merge_entity_ids: [], conflicts: [] };
    }
    if (candidates.length === 1 && candidates[0].id === row.scope_id) {
        return {
            action: 'create_canonical', canonical_entity_id: row.project_code,
            merge_entity_ids: [row.scope_id], conflicts: []
        };
    }
    return {
        action: 'ambiguous', canonical_entity_id: null, merge_entity_ids: [],
        conflicts: candidates.map((candidate) => candidate.id).sort()
    };
}

function parseArgs(argv, env) {
    let mode = 'dry-run';
    let organizationId = null;
    let receiptPath = env.PROJECT_GRAPH_RECONCILIATION_RECEIPT || null;
    let actor = text(env.BRAINBASE_MIGRATION_ACTOR) || null;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--execute') mode = 'execute';
        else if (argument === '--dry-run') mode = 'dry-run';
        else if (argument === '--organization') organizationId = argv[++index];
        else if (argument.startsWith('--organization=')) organizationId = argument.slice(15);
        else if (argument === '--receipt') receiptPath = argv[++index];
        else if (argument.startsWith('--receipt=')) receiptPath = argument.slice(10);
        else if (argument === '--actor') actor = argv[++index];
        else if (argument.startsWith('--actor=')) actor = argument.slice(8);
        else throw new ProjectGraphReconciliationError('ARGUMENT_INVALID', `Unsupported argument: ${argument}`);
    }
    if (mode === 'execute' && !text(actor)) {
        throw new ProjectGraphReconciliationError('MIGRATION_ACTOR_REQUIRED', '--execute requires --actor or BRAINBASE_MIGRATION_ACTOR');
    }
    return { mode, organizationId: text(organizationId) || null, receiptPath, actor: text(actor) || null };
}

async function setContext(client, organizationId, projectCodes) {
    await client.query("SELECT set_config('app.role',$1,true)", ['ceo']);
    await client.query("SELECT set_config('app.project_codes',$1,true)", [projectCodes.join(',')]);
    await client.query("SELECT set_config('app.clearance',$1,true)", ['internal,restricted,finance,hr,contract']);
    await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
}

async function readRows(client, organizationId = null) {
    const { rows } = await client.query(
        `SELECT pr.project_code, pr.organization_id, pr.display_name, pr.kind,
                pr.catalog_version, pr.lifecycle_status, pr.organization_entity_id,
                pr.owner_person_id, pr.graph_entity_id, pr.graph_binding_status,
                p.id AS scope_id, p.name AS scope_name,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id', ge.id, 'project_id', ge.project_id, 'payload', ge.payload,
                  'lifecycle_status', ge.lifecycle_status, 'version', ge.version
                ) ORDER BY ge.id) FILTER (WHERE ge.id IS NOT NULL), '[]'::jsonb) AS candidates
           FROM project_registry pr
           JOIN projects p ON p.code=pr.project_code AND p.organization_id=pr.organization_id
      LEFT JOIN graph_entities ge ON ge.project_id=p.id AND ge.entity_type='project'
            AND (ge.id=pr.project_code OR ge.id=pr.graph_entity_id OR ge.id=p.id
              OR ge.payload->>'catalog_project_id'=pr.project_code
              OR ge.payload->>'code'=pr.project_code)
          WHERE ($1::text IS NULL OR pr.organization_id=$1)
          GROUP BY pr.project_code, pr.organization_id, pr.display_name, pr.kind,
                   pr.catalog_version, pr.lifecycle_status, pr.organization_entity_id,
                   pr.owner_person_id, pr.graph_entity_id, pr.graph_binding_status,
                   p.id, p.name
          ORDER BY pr.organization_id, pr.project_code`,
        [organizationId]
    );
    return rows.map((row) => ({ ...row, candidates: typeof row.candidates === 'string' ? JSON.parse(row.candidates) : row.candidates }));
}

function canonicalPayload(row, existing = {}) {
    return {
        ...existing,
        name: text(existing.name) || row.display_name,
        catalog_project_id: row.project_code,
        catalog_version: Number(existing.catalog_version) > 0 ? Number(existing.catalog_version) : Number(row.catalog_version),
        source_ref: text(existing.source_ref) || `project-catalog:${row.project_code}@${row.catalog_version}`,
        kind: text(existing.kind) || row.kind,
        organization_entity_id: text(existing.organization_entity_id) || row.organization_entity_id,
        owner_person_id: text(existing.owner_person_id) || row.owner_person_id
    };
}

async function mergeLegacyEntity(client, legacyId, canonicalId) {
    const { rows: edges } = await client.query(
        'SELECT id, from_id, to_id, rel_type FROM graph_edges WHERE from_id=$1 OR to_id=$1 ORDER BY id FOR UPDATE',
        [legacyId]
    );
    let rewired = 0;
    let deduplicated = 0;
    for (const edge of edges) {
        const fromId = edge.from_id === legacyId ? canonicalId : edge.from_id;
        const toId = edge.to_id === legacyId ? canonicalId : edge.to_id;
        const duplicate = await client.query(
            'SELECT id FROM graph_edges WHERE from_id=$1 AND to_id=$2 AND rel_type=$3 AND id<>$4 LIMIT 1',
            [fromId, toId, edge.rel_type, edge.id]
        );
        if (duplicate.rows[0]) {
            await client.query('DELETE FROM graph_edges WHERE id=$1', [edge.id]);
            deduplicated += 1;
        } else {
            await client.query('UPDATE graph_edges SET from_id=$2,to_id=$3,updated_at=now() WHERE id=$1', [edge.id, fromId, toId]);
            rewired += 1;
        }
    }
    await client.query(
        `UPDATE graph_entities SET lifecycle_status='merged',
                payload=payload || jsonb_build_object('canonical_entity_id',$2,'merged_by',$3),
                version=version+1,updated_at=now() WHERE id=$1`,
        [legacyId, canonicalId, MIGRATION_ID]
    );
    return { rewired, deduplicated };
}

async function applyPlan(client, row, plan, actor) {
    const candidate = row.candidates.find((item) => item.id === plan.canonical_entity_id);
    if (plan.action === 'create_canonical') {
        await client.query(
            `INSERT INTO graph_entities
             (id,entity_type,project_id,payload,role_min,sensitivity,lifecycle_status,version)
             VALUES ($1,'project',$2,$3::jsonb,'member','internal','active',1)`,
            [plan.canonical_entity_id, row.scope_id, JSON.stringify(canonicalPayload(row))]
        );
    } else {
        await client.query(
            `UPDATE graph_entities SET payload=$2::jsonb,updated_at=now()
              WHERE id=$1 AND entity_type='project'`,
            [plan.canonical_entity_id, JSON.stringify(canonicalPayload(row, candidate?.payload || {}))]
        );
    }
    const merge = { rewired: 0, deduplicated: 0 };
    for (const legacyId of plan.merge_entity_ids) {
        const result = await mergeLegacyEntity(client, legacyId, plan.canonical_entity_id);
        merge.rewired += result.rewired;
        merge.deduplicated += result.deduplicated;
    }
    const { rows } = await client.query(
        `SELECT ge.id,ge.project_id,ge.payload,ge.lifecycle_status
           FROM graph_entities ge WHERE ge.id=$1 AND ge.entity_type='project'`,
        [plan.canonical_entity_id]
    );
    const graph = rows[0];
    if (!graph || graph.project_id !== row.scope_id || !text(graph.payload?.name)) {
        throw new ProjectGraphReconciliationError('READBACK_FAILED', `Canonical Graph readback failed: ${row.project_code}`);
    }
    await client.query(
        `UPDATE project_registry SET graph_entity_id=$2,graph_binding_status=$3,
                graph_binding_reason=$4,graph_binding_evidence=$5::jsonb,
                display_name=$6,kind=$7,catalog_version=$8,lifecycle_status=$9,
                organization_entity_id=$10,owner_person_id=$11,updated_at=now()
          WHERE project_code=$1`,
        [row.project_code, graph.id, graph.lifecycle_status === 'active' ? 'linked' : 'retired',
            MIGRATION_ID, JSON.stringify({
                canonical_entity_id: graph.id, merged_entity_ids: plan.merge_entity_ids, actor
            }),
            graph.payload.name, graph.payload.kind, graph.payload.catalog_version, graph.lifecycle_status,
            graph.payload.organization_entity_id, graph.payload.owner_person_id]
    );
    await client.query('UPDATE projects SET name=$2 WHERE id=$1', [row.scope_id, graph.payload.name]);
    return { canonical_entity_id: graph.id, ...merge };
}

async function readBackCommitted(client, rows, results, byOrganization) {
    await client.query('BEGIN READ ONLY');
    try {
        for (const result of results.filter((item) => item.status === 'applied')) {
            const row = rows.find((item) => item.project_code === result.project_code
                && item.organization_id === result.organization_id);
            await setContext(client, result.organization_id, byOrganization.get(result.organization_id));
            const { rows: readbackRows } = await client.query(
                `SELECT pr.graph_entity_id,pr.graph_binding_status,p.id AS scope_id,
                        ge.id AS entity_id,ge.project_id,ge.lifecycle_status,
                        btrim(ge.payload->>'name') <> '' AS has_name,
                        pr.display_name IS NOT DISTINCT FROM ge.payload->>'name' AS name_synced,
                        pr.kind IS NOT DISTINCT FROM ge.payload->>'kind' AS kind_synced,
                        pr.catalog_version IS NOT DISTINCT FROM
                          CASE WHEN ge.payload->>'catalog_version' ~ '^[1-9][0-9]*$'
                            THEN (ge.payload->>'catalog_version')::integer ELSE NULL END AS version_synced,
                        pr.lifecycle_status IS NOT DISTINCT FROM ge.lifecycle_status AS lifecycle_synced,
                        pr.organization_entity_id IS NOT DISTINCT FROM ge.payload->>'organization_entity_id' AS organization_synced,
                        pr.owner_person_id IS NOT DISTINCT FROM ge.payload->>'owner_person_id' AS owner_synced
                   FROM project_registry pr
                   JOIN projects p ON p.code=pr.project_code AND p.organization_id=pr.organization_id
                   JOIN graph_entities ge ON ge.id=pr.graph_entity_id AND ge.project_id=p.id
                  WHERE pr.project_code=$1 AND pr.organization_id=$2`,
                [result.project_code, result.organization_id]
            );
            const readback = readbackRows[0];
            const verified = Boolean(readback)
                && readback.graph_binding_status === (readback.lifecycle_status === 'active' ? 'linked' : 'retired')
                && readback.graph_entity_id === result.canonical_entity_id
                && readback.entity_id === result.canonical_entity_id
                && readback.scope_id === row.scope_id
                && readback.project_id === row.scope_id
                && readback.has_name === true
                && ['name_synced', 'kind_synced', 'version_synced', 'lifecycle_synced',
                    'organization_synced', 'owner_synced'].every((key) => readback[key] === true);
            result.status = verified ? 'verified' : 'readback_failed';
            result.readback = verified ? 'matched' : 'mismatch';
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

export async function runProjectGraphReconciliation({
    mode = 'dry-run', organizationId = null, actor = null, env = process.env, pool = null
} = {}) {
    if (!['dry-run', 'execute'].includes(mode)) throw new ProjectGraphReconciliationError('ARGUMENT_INVALID', `Unsupported mode: ${mode}`);
    if (mode === 'execute' && !text(actor)) throw new ProjectGraphReconciliationError('MIGRATION_ACTOR_REQUIRED', 'actor is required for execute mode');
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new ProjectGraphReconciliationError('DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required');
    const client = await activePool.connect();
    let transactionStarted = false;
    try {
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0::bigint))', [LOCK_NAME]);
        const rows = await readRows(client, organizationId);
        const byOrganization = new Map();
        for (const row of rows) {
            const codes = byOrganization.get(row.organization_id) || [];
            codes.push(row.project_code);
            byOrganization.set(row.organization_id, codes);
        }
        const results = [];
        for (const row of rows) {
            await setContext(client, row.organization_id, byOrganization.get(row.organization_id));
            const plan = classifyProjectBinding(row);
            if (plan.action === 'ambiguous') {
                if (mode === 'execute') {
                    await client.query(
                        `UPDATE project_registry SET graph_binding_status='ambiguous',graph_binding_reason=$2,
                                graph_binding_evidence=$3::jsonb,updated_at=now() WHERE project_code=$1`,
                        [row.project_code, MIGRATION_ID, JSON.stringify({ candidate_entity_ids: plan.conflicts })]
                    );
                }
                results.push({ project_code: row.project_code, organization_id: row.organization_id, ...plan, status: 'unresolved' });
                continue;
            }
            const applied = mode === 'execute' ? await applyPlan(client, row, plan, actor) : null;
            results.push({ project_code: row.project_code, organization_id: row.organization_id, ...plan,
                status: mode === 'execute' ? 'applied' : 'planned', ...(applied || {}) });
        }
        if (mode === 'execute') await client.query('COMMIT');
        else await client.query('ROLLBACK');
        transactionStarted = false;
        let postCommitReadback = { status: mode === 'execute' ? 'pending' : 'not_applicable' };
        if (mode === 'execute') {
            try {
                await readBackCommitted(client, rows, results, byOrganization);
                postCommitReadback = { status: 'completed' };
            } catch (error) {
                for (const result of results.filter((item) => item.status === 'applied')) {
                    result.status = 'readback_unknown';
                    result.readback = 'unavailable';
                }
                postCommitReadback = { status: 'unavailable', code: error?.code || 'READBACK_UNAVAILABLE' };
            }
        }
        const unresolved = results.filter((result) => result.status === 'unresolved');
        const readbackFailed = results.filter((result) => ['readback_failed', 'readback_unknown'].includes(result.status));
        return {
            migration_id: MIGRATION_ID, mode, actor: mode === 'execute' ? actor : null,
            inventory_digest: sha256(rows),
            post_commit_readback: postCommitReadback,
            summary: {
                total: results.length,
                verified: results.filter((result) => result.status === 'verified').length,
                planned: results.filter((result) => result.status === 'planned').length,
                unresolved: unresolved.length,
                readback_failed_or_unknown: readbackFailed.length
            },
            complete: unresolved.length === 0 && readbackFailed.length === 0,
            results
        };
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        if (!pool) await activePool.end();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2), process.env);
    const receipt = await runProjectGraphReconciliation({ ...options, env: process.env });
    const serialized = JSON.stringify({
        ...receipt,
        generated_at: new Date().toISOString(),
        digest: `sha256:${crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex')}`
    }, null, 2);
    if (options.receiptPath) {
        const resolved = path.resolve(options.receiptPath);
        await mkdir(path.dirname(resolved), { recursive: true });
        await writeFile(resolved, `${serialized}\n`, { mode: 0o600 });
    }
    process.stdout.write(`${serialized}\n`);
    if (!receipt.complete) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    main().catch((error) => {
        process.stderr.write(`${JSON.stringify({ error: error.code || 'RECONCILIATION_FAILED', message: error.message, details: error.details })}\n`);
        process.exitCode = 1;
    });
}
