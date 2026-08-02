import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

export const AUTHORITY = Object.freeze({
    storyId: 'story-brainbase-ontology-production-activation',
    decisionId: 'dec_ontology_1_0_0_activation_20260803',
    scopeId: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H',
    personId: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
    assignments: [
        { id: 'raci_ontology_1_0_0_proposer_20260803', lane: 'proposer', roleCode: 'R' },
        { id: 'raci_ontology_1_0_0_decider_20260803', lane: 'decider', roleCode: 'A' },
        { id: 'raci_ontology_1_0_0_applier_20260803', lane: 'applier', roleCode: 'A' }
    ]
});

function option(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

function stableEdgeId(fromId, toId, relation) {
    return `edg_ontology_auth_${createHash('sha256').update(`${fromId}\0${toId}\0${relation}`).digest('hex').slice(0, 20)}`;
}

export function buildAuthorityPlan({ sourceCommit, releaseDigest, impactScope, projectId }) {
    if (!/^[a-f0-9]{40}$/.test(sourceCommit || '')) throw new Error('source commit must be a full SHA-1');
    if (!/^[a-f0-9]{64}$/.test(releaseDigest || '')) throw new Error('release digest must be SHA-256');
    const provenance = {
        story_id: AUTHORITY.storyId,
        approved_by: AUTHORITY.personId,
        approved_at: '2026-08-03',
        authority: 'user-approved-recommendation-2026-08-03'
    };
    const entities = [{
        id: AUTHORITY.decisionId,
        entity_type: 'decision',
        project_id: projectId,
        role_min: 'gm',
        sensitivity: 'internal',
        payload: {
            title: 'Ontology 1.0.0を本番で有効化する',
            status: 'decided',
            effective_at: '2026-08-02T15:00:00.000Z',
            ontology_release_version: '1.0.0',
            ontology_release_digest: releaseDigest,
            ontology_source_commit_sha: sourceCommit,
            ontology_proposer_entity_id: AUTHORITY.personId,
            ontology_decider_entity_id: AUTHORITY.personId,
            ontology_scope_entity_id: AUTHORITY.scopeId,
            ontology_impact_scope: impactScope,
            provenance
        }
    }, ...AUTHORITY.assignments.map((assignment) => ({
        id: assignment.id,
        entity_type: 'raci_assignment',
        project_id: projectId,
        role_min: 'gm',
        sensitivity: 'internal',
        payload: {
            name: `Ontology 1.0.0 ${assignment.lane}`,
            role_code: assignment.roleCode,
            lane: assignment.lane,
            status: 'active',
            provenance
        }
    }))];
    const edges = [
        [AUTHORITY.decisionId, AUTHORITY.personId, 'owned_by'],
        [AUTHORITY.decisionId, AUTHORITY.scopeId, 'belongs_to_project'],
        ...AUTHORITY.assignments.flatMap((assignment) => [
            [assignment.id, AUTHORITY.personId, 'assigned_to'],
            [assignment.id, AUTHORITY.scopeId, 'belongs_to_project']
        ])
    ].map(([fromId, toId, relation]) => ({
        id: stableEdgeId(fromId, toId, relation),
        from_id: fromId,
        to_id: toId,
        relation,
        project_id: projectId,
        role_min: 'gm',
        sensitivity: 'internal',
        payload: { provenance }
    }));
    return { entities, edges };
}

async function saveBackup(client, plan, backupDir) {
    const ids = plan.entities.map((item) => item.id);
    const existingEntities = (await client.query('SELECT * FROM graph_entities WHERE id = ANY($1::text[]) ORDER BY id', [ids])).rows;
    const existingEdges = (await client.query('SELECT * FROM graph_edges WHERE from_id = ANY($1::text[]) ORDER BY id', [ids])).rows;
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
    const backupPath = path.join(backupDir, `ontology-1.0.0-authority-${stamp}.json`);
    await writeFile(backupPath, `${JSON.stringify({
        schema_version: '1.0.0', created_at: new Date().toISOString(), operation: 'pre-authority-backup',
        existing_entities: existingEntities, existing_edges: existingEdges
    }, null, 2)}\n`, { mode: 0o600 });
    return backupPath;
}

async function persist(client, plan) {
    for (const entity of plan.entities) {
        await client.query(
            `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
             ON CONFLICT (id) DO UPDATE SET entity_type=EXCLUDED.entity_type, project_id=EXCLUDED.project_id,
                 payload=EXCLUDED.payload, role_min=EXCLUDED.role_min, sensitivity=EXCLUDED.sensitivity, updated_at=NOW()`,
            [entity.id, entity.entity_type, entity.project_id, JSON.stringify(entity.payload), entity.role_min, entity.sensitivity]
        );
    }
    for (const edge of plan.edges) {
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
    const sourceCommit = option('--source-commit');
    const releaseDigest = option('--release-digest');
    const impactScope = JSON.parse(option('--impact-scope-json') || 'null');
    if (!impactScope) throw new Error('--impact-scope-json is required');
    const apply = process.argv.includes('--apply');
    const client = new pg.Client({ connectionString: process.env.INFO_SSOT_DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    try {
        if (!apply) await client.query('SET TRANSACTION READ ONLY');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('ontology-establish-publication-authority-1.0.0'))");
        const required = (await client.query(
            'SELECT id, entity_type, project_id FROM graph_entities WHERE id = ANY($1::text[])',
            [[AUTHORITY.scopeId, AUTHORITY.personId]]
        )).rows;
        if (required.find((row) => row.id === AUTHORITY.scopeId)?.entity_type !== 'project') throw new Error('Brainbase scope project is missing');
        if (required.find((row) => row.id === AUTHORITY.personId)?.entity_type !== 'person') throw new Error('Publication actor person is missing');
        const projectId = required.find((row) => row.id === AUTHORITY.scopeId).project_id;
        const plan = buildAuthorityPlan({ sourceCommit, releaseDigest, impactScope, projectId });
        let backupPath = null;
        if (apply) {
            backupPath = await saveBackup(client, plan, path.resolve(option('--backup-dir') || 'var/ontology-backups'));
            await persist(client, plan);
            const count = Number((await client.query(
                `SELECT COUNT(DISTINCT r.id)::int AS count FROM graph_entities r
                 JOIN graph_edges a ON a.from_id=r.id AND a.rel_type='assigned_to' AND a.to_id=$1
                 JOIN graph_edges s ON s.from_id=r.id AND s.rel_type='belongs_to_project' AND s.to_id=$2
                 WHERE r.id = ANY($3::text[])`,
                [AUTHORITY.personId, AUTHORITY.scopeId, AUTHORITY.assignments.map((item) => item.id)]
            )).rows[0].count);
            if (count !== 3) throw new Error(`Authority postcondition failed: expected 3 assignments, got ${count}`);
            await client.query('COMMIT');
        } else {
            await client.query('ROLLBACK');
        }
        process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', status: apply ? 'committed' : 'planned', entities: plan.entities.length, edges: plan.edges.length, deletes: 0, backup_path: backupPath }, null, 2)}\n`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await client.end();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
