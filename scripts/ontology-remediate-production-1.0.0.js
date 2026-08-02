import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { OntologyRegistry } from '../server/services/ontology-registry.js';

const VERSION = '1.0.0';
const EXPECTED_VIOLATIONS = Object.freeze({
    'edge-reference-integrity': 31,
    'CON-APP-OWNER-001': 26,
    'CON-DECISION-DECIDER-001': 3,
    'CON-DECISION-SCOPE-001': 1
});
export const EXPECTED_PRE_REMEDIATION_SNAPSHOT_DIGEST = '4db7964d1402e50ab7d69f54c7ceb166c87d4d2826d8a8c08e9033dc37f8820a';
const CANONICAL_SATO_ID = 'per_01KGYC7NNS0VXADK7NP48W4VR5';
const HISTORICAL_SATO_ID = 'per_01KGS5F2HGJSWMZX68QJEQB0BB';
const BRAINBASE_PROJECT_ID = 'prj_01KGCS8CAJKKDWACPNK1E5WX8H';
const VERIFICATION_DECISION_IDS = Object.freeze([
    'dec_01KQ8T4J1P5CZ0GXTD1YGS774D',
    'dec_01KQ8T8SZV67GHYYERGYGMFSZ4'
]);
const VIBEPRO_DECISION_ID = 'dec_vibepro_ai_self_evaluation_metrics_japanese_ssot';

const APP_OWNERS = Object.freeze({
    app_aitle: 'techknight',
    app_aitle_site: 'techknight',
    app_baao: 'baao',
    app_back_office: 'unson',
    app_brainbase: 'unson',
    app_conn: 'unson',
    app_detectiveai: 'unson',
    app_dialogai: 'unson',
    app_dialogai_environment_production: 'unson',
    app_dialogai_environment_staging: 'unson',
    app_emporio: 'unson',
    app_flux: 'unson',
    app_hq_dashboard: 'techknight',
    app_infisical: 'unson',
    app_mana: 'unson',
    app_mywa: 'baao',
    app_postio: 'unson',
    app_salestailor: 'salestailor',
    app_sato_portfolio: 'unson',
    app_senpainurse: 'techknight',
    app_senrigan: 'unson',
    app_smartfront: 'techknight',
    app_techknight_platform: 'techknight',
    app_unson_os: 'unson',
    app_vibepro: 'unson',
    app_zeims: 'zeims'
});

function hasFlag(name) {
    return process.argv.includes(name);
}

function argument(name, fallback = null) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

function counts(violations) {
    return Object.fromEntries([...violations.reduce((result, item) => {
        result.set(item.rule_id, (result.get(item.rule_id) || 0) + 1);
        return result;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function sameCounts(actual, expected) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    return [...keys].every((key) => actual[key] === expected[key]);
}

export function remediationSnapshotDigest({ entities, edges }) {
    const normalized = {
        entities: entities.map((entity) => ({
            id: entity.id,
            type: entity.type || entity.entity_type,
            payload: entity.payload
        })).sort((left, right) => left.id.localeCompare(right.id)),
        edges: edges.map((edge) => ({
            from_id: edge.from_id,
            to_id: edge.to_id,
            relation: edge.relation || edge.rel_type,
            payload: edge.payload
        })).sort((left, right) => left.from_id.localeCompare(right.from_id)
            || left.to_id.localeCompare(right.to_id)
            || left.relation.localeCompare(right.relation))
    };
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function assertRemediationPrecondition({ violations, snapshotDigest }) {
    const actualCounts = counts(violations);
    if (!sameCounts(actualCounts, EXPECTED_VIOLATIONS)) {
        throw new Error(`Precondition failed: unexpected ontology violations ${JSON.stringify(actualCounts)}`);
    }
    if (snapshotDigest !== EXPECTED_PRE_REMEDIATION_SNAPSHOT_DIGEST) {
        throw new Error(`Precondition failed: production snapshot digest changed (${snapshotDigest})`);
    }
    return actualCounts;
}

function stableEdgeId(fromId, toId, relation) {
    const digest = createHash('sha256').update(`${fromId}\0${toId}\0${relation}`).digest('hex').slice(0, 24);
    return `edg_ontology_100_${digest}`;
}

function edgeKey(edge) {
    return `${edge.from_id}\0${edge.to_id}\0${edge.relation || edge.rel_type}`;
}

function required(map, id, type = null) {
    const value = map.get(id);
    if (!value) throw new Error(`Required Graph entity is missing: ${id}`);
    const actualType = value.type || value.entity_type;
    if (type && actualType !== type) throw new Error(`Graph entity ${id} must be ${type}; got ${actualType}`);
    return value;
}

function remediationPayload(kind, details = {}) {
    return {
        ontology_remediation: {
            story_id: 'story-brainbase-ontology-production-compatibility',
            ontology_version: VERSION,
            kind,
            authority: 'user-approved-recommendation-2026-08-03',
            ...details
        }
    };
}

export function buildRemediationPlan({ entities, edges }) {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const byEdge = new Map(edges.map((edge) => [edgeKey(edge), edge]));
    const canonicalSato = required(byId, CANONICAL_SATO_ID, 'person');
    const brainbaseProject = required(byId, BRAINBASE_PROJECT_ID, 'project');
    const entityUpserts = [];
    const entityPayloadUpdates = [];
    const edgeUpserts = [];

    if (!byId.has(HISTORICAL_SATO_ID)) {
        entityUpserts.push({
            id: HISTORICAL_SATO_ID,
            entity_type: 'person',
            project_id: canonicalSato.project_id,
            payload: {
                name: '佐藤 圭吾',
                status: 'merged',
                canonical_entity_id: CANONICAL_SATO_ID,
                aliases: ['佐藤圭吾', 'Keigo Sato'],
                ...remediationPayload('restore_historical_person_reference', {
                    reason: 'Preserve legacy portfolio edge history without rewriting provenance.'
                })
            },
            role_min: canonicalSato.role_min || 'member',
            sensitivity: canonicalSato.sensitivity || 'internal'
        });
    }

    for (const project of [
        { id: 'ncom-catalyst-program', name: 'NCOM Catalyst Program' },
        { id: 'unson-ncom-engagement', name: 'UNSON NCOM Engagement' }
    ]) {
        if (byId.has(project.id)) continue;
        entityUpserts.push({
            id: project.id,
            entity_type: 'project',
            project_id: 'prj_01KGCS8C1PSSXPHXPBX1D4CKDT',
            payload: {
                id: project.id,
                name: project.name,
                status: 'historical_reference_restored',
                ...remediationPayload('restore_project_reference', {
                    reason: 'Restore the high-confidence Graph resolver target referenced by retained NCOM edges.'
                })
            },
            role_min: 'member',
            sensitivity: 'internal'
        });
    }

    for (const [appId, ownerId] of Object.entries(APP_OWNERS)) {
        const app = required(byId, appId, 'app');
        required(byId, ownerId, 'org');
        const edge = {
            id: stableEdgeId(appId, ownerId, 'owned_by'),
            from_id: appId,
            to_id: ownerId,
            relation: 'owned_by',
            project_id: app.project_id,
            payload: remediationPayload('assign_primary_app_owner', {
                basis: 'Graph SSOT organization context and source app ownership metadata',
                primary_owner: true
            }),
            role_min: app.role_min || 'member',
            sensitivity: app.sensitivity || 'internal'
        };
        if (!byEdge.has(edgeKey(edge))) edgeUpserts.push(edge);
    }

    for (const decisionId of VERIFICATION_DECISION_IDS) {
        const decision = required(byId, decisionId, 'decision');
        if (decision.payload?.status === 'decided') {
            entityPayloadUpdates.push({
                id: decisionId,
                payload: {
                    ...decision.payload,
                    status: 'pending_validation',
                    ...remediationPayload('quarantine_verification_record', {
                        reason: 'A verification fixture has no attributable human decider and must not be effective.'
                    })
                }
            });
        }
    }

    const vibeproDecision = required(byId, VIBEPRO_DECISION_ID, 'decision');
    for (const edge of [
        {
            id: stableEdgeId(VIBEPRO_DECISION_ID, CANONICAL_SATO_ID, 'owned_by'),
            from_id: VIBEPRO_DECISION_ID,
            to_id: CANONICAL_SATO_ID,
            relation: 'owned_by',
            project_id: vibeproDecision.project_id,
            payload: remediationPayload('materialize_explicit_decider', { source_field: 'payload.decider' }),
            role_min: vibeproDecision.role_min || 'member',
            sensitivity: vibeproDecision.sensitivity || 'internal'
        },
        {
            id: stableEdgeId(VIBEPRO_DECISION_ID, BRAINBASE_PROJECT_ID, 'belongs_to_project'),
            from_id: VIBEPRO_DECISION_ID,
            to_id: BRAINBASE_PROJECT_ID,
            relation: 'belongs_to_project',
            project_id: vibeproDecision.project_id || brainbaseProject.project_id,
            payload: remediationPayload('materialize_explicit_project_scope', { source_field: 'payload.project_id' }),
            role_min: vibeproDecision.role_min || 'member',
            sensitivity: vibeproDecision.sensitivity || 'internal'
        }
    ]) {
        if (!byEdge.has(edgeKey(edge))) edgeUpserts.push(edge);
    }

    return { entityUpserts, entityPayloadUpdates, edgeUpserts };
}

export function applyPlanToSnapshot({ entities, edges }, plan) {
    const byId = new Map(entities.map((entity) => [entity.id, structuredClone(entity)]));
    for (const entity of plan.entityUpserts) byId.set(entity.id, { ...entity, type: entity.entity_type });
    for (const update of plan.entityPayloadUpdates) {
        const existing = required(byId, update.id);
        byId.set(update.id, { ...existing, payload: update.payload });
    }
    const byEdge = new Map(edges.map((edge) => [edgeKey(edge), structuredClone(edge)]));
    for (const edge of plan.edgeUpserts) byEdge.set(edgeKey(edge), edge);
    return { entities: [...byId.values()], edges: [...byEdge.values()], complete: true };
}

async function loadSnapshot(client) {
    const entities = (await client.query(
        `SELECT id, entity_type AS type, entity_type, project_id, payload, role_min, sensitivity
           FROM graph_entities ORDER BY id`
    )).rows;
    const edges = (await client.query(
        `SELECT id, from_id, to_id, rel_type AS relation, rel_type, project_id, payload, role_min, sensitivity
           FROM graph_edges ORDER BY from_id, to_id, rel_type`
    )).rows;
    return { entities, edges, complete: true };
}

async function saveBackup(client, plan, backupDir) {
    const entityIds = [...new Set([
        ...plan.entityUpserts.map((item) => item.id),
        ...plan.entityPayloadUpdates.map((item) => item.id)
    ])];
    const edgeIds = plan.edgeUpserts.map((item) => item.id);
    const existingEntities = (await client.query(
        'SELECT * FROM graph_entities WHERE id = ANY($1::text[]) ORDER BY id', [entityIds]
    )).rows;
    const existingEdges = (await client.query(
        'SELECT * FROM graph_edges WHERE id = ANY($1::text[]) ORDER BY id', [edgeIds]
    )).rows;
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
    const backupPath = path.join(backupDir, `ontology-1.0.0-remediation-${stamp}.json`);
    await writeFile(backupPath, `${JSON.stringify({
        schema_version: '1.0.0',
        created_at: new Date().toISOString(),
        story_id: 'story-brainbase-ontology-production-compatibility',
        operation: 'pre-mutation-backup',
        existing_entities: existingEntities,
        existing_edges: existingEdges,
        inserted_entity_ids: plan.entityUpserts.filter((item) => !existingEntities.some((row) => row.id === item.id)).map((item) => item.id),
        inserted_edge_ids: plan.edgeUpserts.filter((item) => !existingEdges.some((row) => row.id === item.id)).map((item) => item.id)
    }, null, 2)}\n`, { mode: 0o600 });
    return backupPath;
}

async function persistPlan(client, plan) {
    for (const entity of plan.entityUpserts) {
        await client.query(
            `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
             ON CONFLICT (id) DO UPDATE SET entity_type=EXCLUDED.entity_type, project_id=EXCLUDED.project_id,
                 payload=EXCLUDED.payload, role_min=EXCLUDED.role_min, sensitivity=EXCLUDED.sensitivity, updated_at=NOW()`,
            [entity.id, entity.entity_type, entity.project_id, JSON.stringify(entity.payload), entity.role_min, entity.sensitivity]
        );
    }
    for (const update of plan.entityPayloadUpdates) {
        await client.query('UPDATE graph_entities SET payload=$2, updated_at=NOW() WHERE id=$1', [update.id, JSON.stringify(update.payload)]);
    }
    for (const edge of plan.edgeUpserts) {
        await client.query(
            `INSERT INTO graph_edges (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
             ON CONFLICT (from_id, to_id, rel_type) DO UPDATE SET project_id=EXCLUDED.project_id,
                 payload=EXCLUDED.payload, role_min=EXCLUDED.role_min, sensitivity=EXCLUDED.sensitivity, updated_at=NOW()`,
            [edge.id, edge.from_id, edge.to_id, edge.relation, edge.project_id, JSON.stringify(edge.payload), edge.role_min, edge.sensitivity]
        );
    }
}

async function main() {
    if (!process.env.INFO_SSOT_DATABASE_URL) throw new Error('INFO_SSOT_DATABASE_URL is required');
    const apply = hasFlag('--apply');
    const backupDir = path.resolve(argument('--backup-dir', 'var/ontology-backups'));
    const release = new OntologyRegistry({ rootDir: process.cwd() }).resolve({ version: VERSION });
    const client = new pg.Client({ connectionString: process.env.INFO_SSOT_DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    try {
        if (!apply) await client.query('SET TRANSACTION READ ONLY');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('ontology-remediate-production-1.0.0'))");
        const beforeSnapshot = await loadSnapshot(client);
        const before = release.kernel.validateSnapshot(beforeSnapshot);
        if (before.valid) {
            await client.query('ROLLBACK');
            process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', status: 'already_valid', before: 0, after: 0 }, null, 2)}\n`);
            return;
        }
        const actualCounts = assertRemediationPrecondition({
            violations: before.violations,
            snapshotDigest: remediationSnapshotDigest(beforeSnapshot)
        });
        const plan = buildRemediationPlan(beforeSnapshot);
        const planned = release.kernel.validateSnapshot(applyPlanToSnapshot(beforeSnapshot, plan));
        if (!planned.valid) throw new Error(`Planned snapshot remains invalid: ${JSON.stringify(counts(planned.violations))}`);
        let backupPath = null;
        if (apply) {
            backupPath = await saveBackup(client, plan, backupDir);
            await persistPlan(client, plan);
            const persisted = release.kernel.validateSnapshot(await loadSnapshot(client));
            if (!persisted.valid) throw new Error(`Persisted snapshot remains invalid: ${JSON.stringify(counts(persisted.violations))}`);
            await client.query('COMMIT');
        } else {
            await client.query('ROLLBACK');
        }
        process.stdout.write(`${JSON.stringify({
            mode: apply ? 'apply' : 'dry-run',
            status: apply ? 'committed' : 'planned',
            ontology_version: VERSION,
            before: before.violations.length,
            after: planned.violations.length,
            violations_before: actualCounts,
            actions: {
                entity_upserts: plan.entityUpserts.length,
                entity_payload_updates: plan.entityPayloadUpdates.length,
                edge_upserts: plan.edgeUpserts.length,
                deletes: 0
            },
            backup_path: backupPath
        }, null, 2)}\n`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await client.end();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}
