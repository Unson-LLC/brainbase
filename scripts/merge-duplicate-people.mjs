#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export const MERGES = Object.freeze([
  {
    canonicalId: 'per_01KGYC7NQNW6Y68C0BWY54GNJG',
    legacyId: 'per_01KGYC7NMPPZTY9BKY9PN3CD24',
    name: '川合 秀明',
  },
  {
    canonicalId: 'per_01KGYC7NPEH326Q25TJDE2NWCH',
    legacyId: 'person_uchimura_takashi',
    name: '内村 隆志',
  },
  {
    canonicalId: 'per_sato-noriyuki',
    legacyId: 'person_sato_noriyuki',
    name: '佐藤 紀征',
  },
  {
    canonicalId: 'per_01KRKM28H0W4KB2DPGS1N5JQEZ',
    legacyId: 'per_01KGYC7NKZ0Y3968XHRABM9TPR',
    name: '星野 秀弥',
  },
]);

const BACKUP_VERSION = 'duplicate-people-merge.v1';
const DEFAULT_BACKUP_ROOT = '/home/ubuntu/brainbase/var/people-merge/backups';
const OPERATIONAL_REFERENCES = Object.freeze({
  auth_grants: ['person_id'],
  raci_assignments: ['person_id'],
  users: ['person_id'],
  canonical_tasks: ['assignee_person_id'],
  decisions: ['owner_person_id'],
  integration_account_defaults: ['created_by_person_id'],
  integration_accounts: ['created_by_person_id', 'owner_person_id', 'updated_by_person_id'],
  memory_candidates: ['owner_person_id', 'recommended_owner_person_id'],
});
const HISTORICAL_REFERENCES = Object.freeze({
  auth_audit_logs: ['person_id'],
  events: ['actor_person_id'],
  account_audit_events: ['actor_person_id'],
  candidate_scan_blocks: ['actor_person_id'],
  memory_candidate_audit_logs: ['actor_person_id', 'decision_owner_person_id'],
  memory_candidates: ['actor_person_id'],
  promotion_audit_events: ['actor_person_id', 'decision_owner_person_id'],
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function uniqueValues(...groups) {
  const values = groups.flat().filter((value) => value !== null && value !== undefined && value !== '');
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

export function mergePayloads(canonical, legacy, { canonicalId, legacyId, name }) {
  const merge = (preferred, fallback) => {
    if (Array.isArray(preferred) || Array.isArray(fallback)) {
      return uniqueValues(Array.isArray(preferred) ? preferred : [], Array.isArray(fallback) ? fallback : []);
    }
    if (isPlainObject(preferred) || isPlainObject(fallback)) {
      const left = isPlainObject(preferred) ? preferred : {};
      const right = isPlainObject(fallback) ? fallback : {};
      return Object.fromEntries(
        uniqueValues(Object.keys(left), Object.keys(right))
          .map((key) => [key, merge(left[key], right[key])]),
      );
    }
    return preferred !== null && preferred !== undefined && preferred !== '' ? preferred : fallback;
  };
  const payload = merge(canonical ?? {}, legacy ?? {});
  delete payload.canonical_entity_id;
  delete payload.merged_at;
  return {
    ...payload,
    person_id: canonicalId,
    name,
    aliases: uniqueValues(
      canonical?.aliases ?? [],
      legacy?.aliases ?? [],
      [canonical?.name, legacy?.name, name, legacyId],
    ),
    merged_person_ids: uniqueValues(
      canonical?.merged_person_ids ?? [],
      legacy?.merged_person_ids ?? [],
      [legacyId],
    ),
    status: 'active',
  };
}

export function buildAliasPayload({ canonicalId, legacyId, name, legacyPayload, mergedAt }) {
  return {
    name: legacyPayload?.name || name,
    aliases: uniqueValues(legacyPayload?.aliases ?? [], [legacyId]),
    status: 'merged',
    canonical_entity_id: canonicalId,
    merged_at: mergedAt,
  };
}

export function deepReplaceExact(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => deepReplaceExact(item, replacements));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepReplaceExact(item, replacements)]),
    );
  }
  if (typeof value === 'string' && Object.hasOwn(replacements, value)) return replacements[value];
  return value;
}

function rows(client, text, params = []) {
  return client.query(text, params).then((result) => result.rows);
}

async function existingColumns(client, table, requested) {
  const result = await rows(client, `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])
  `, [table, requested]);
  return result.map((row) => row.column_name);
}

async function primaryKeyColumns(client, table) {
  const result = await rows(client, `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `, [table]);
  assert(result.length > 0, `primary key not found for ${table}`);
  return result.map((row) => row.column_name);
}

async function collectState(client) {
  const ids = MERGES.flatMap(({ canonicalId, legacyId }) => [canonicalId, legacyId]);
  const patterns = ids.map((id) => `%${id}%`);
  const graphEntities = await rows(client, `
    SELECT * FROM graph_entities
    WHERE id = ANY($1::text[]) OR payload::text LIKE ANY($2::text[])
    ORDER BY id
  `, [ids, patterns]);
  const graphEdges = await rows(client, `
    SELECT * FROM graph_edges
    WHERE from_id = ANY($1::text[]) OR to_id = ANY($1::text[]) OR payload::text LIKE ANY($2::text[])
    ORDER BY id
  `, [ids, patterns]);
  const people = await rows(client, 'SELECT * FROM people WHERE id = ANY($1::text[]) ORDER BY id', [ids]);
  const operational = {};
  const historicalCounts = {};

  for (const [table, requested] of Object.entries(OPERATIONAL_REFERENCES)) {
    const columns = await existingColumns(client, table, requested);
    if (!columns.length) continue;
    const predicate = columns.map((column) => `${column} = ANY($1::text[])`).join(' OR ');
    operational[table] = await rows(client, `SELECT * FROM ${table} WHERE ${predicate}`, [ids]);
  }
  for (const [table, requested] of Object.entries(HISTORICAL_REFERENCES)) {
    const columns = await existingColumns(client, table, requested);
    if (!columns.length) continue;
    const predicate = columns.map((column) => `${column} = ANY($1::text[])`).join(' OR ');
    const result = await rows(client, `SELECT count(*)::int AS count FROM ${table} WHERE ${predicate}`, [ids]);
    historicalCounts[table] = result[0]?.count ?? 0;
  }
  return { ids, graphEntities, graphEdges, people, operational, historicalCounts };
}

function indexById(list) {
  return new Map(list.map((row) => [row.id, row]));
}

export function validateState(state) {
  const entities = indexById(state.graphEntities);
  for (const merge of MERGES) {
    const canonical = entities.get(merge.canonicalId);
    const legacy = entities.get(merge.legacyId);
    assert(canonical?.entity_type === 'person', `canonical person '${merge.canonicalId}' was not found`);
    assert(legacy?.entity_type === 'person', `legacy person '${merge.legacyId}' was not found`);
  }
  const replacements = Object.fromEntries(MERGES.map(({ legacyId, canonicalId }) => [legacyId, canonicalId]));
  const aliasReuseByLegacy = new Map();
  const conflicts = [];
  for (const edge of state.graphEdges.filter((row) => row.rel_type !== 'alias_of')) {
    const fromId = replacements[edge.from_id] ?? edge.from_id;
    const toId = replacements[edge.to_id] ?? edge.to_id;
    const duplicate = state.graphEdges.find((candidate) => (
      candidate.id !== edge.id
      && candidate.rel_type === edge.rel_type
      && (replacements[candidate.from_id] ?? candidate.from_id) === fromId
      && (replacements[candidate.to_id] ?? candidate.to_id) === toId
    ));
    if (!duplicate || edge.id.localeCompare(duplicate.id) > 0) continue;
    const legacyEdge = replacements[edge.from_id]
      ? edge
      : replacements[duplicate.from_id]
        ? duplicate
        : null;
    const canonicalEdge = legacyEdge === edge ? duplicate : edge;
    const merge = legacyEdge && MERGES.find(({ legacyId }) => legacyId === legacyEdge.from_id);
    if (
      merge
      && canonicalEdge.from_id === merge.canonicalId
      && legacyEdge.to_id === canonicalEdge.to_id
      && legacyEdge.rel_type === 'member_of'
      && !aliasReuseByLegacy.has(merge.legacyId)
    ) {
      aliasReuseByLegacy.set(merge.legacyId, legacyEdge.id);
    } else {
      conflicts.push(`${edge.id}/${duplicate.id}`);
    }
  }
  assert(conflicts.length === 0, `edge migration conflicts: ${uniqueValues(conflicts).join(', ')}`);
  return { entities, replacements, aliasReuseByLegacy };
}

export function countLegacyReferences(state, legacyId) {
  const direct = Object.values(state.operational).flat().reduce(
    (count, row) => count + Object.values(row).filter((value) => value === legacyId).length,
    0,
  );
  const graphEdges = state.graphEdges.filter((row) => (
    row.from_id === legacyId || row.to_id === legacyId || JSON.stringify(row.payload).includes(legacyId)
  )).length;
  const graphPayloads = state.graphEntities.filter((row) => (
    row.id !== legacyId && JSON.stringify(row.payload).includes(legacyId)
  )).length;
  return { direct, graph_edges: graphEdges, graph_payloads: graphPayloads };
}

export function sanitizedPlan(state) {
  validateState(state);
  return {
    mode: 'dry-run',
    status: 'ready',
    merges: MERGES.map((merge) => ({
      ...merge,
      references_to_move: countLegacyReferences(state, merge.legacyId),
    })),
    operational_rows_to_update: Object.fromEntries(
      Object.entries(state.operational).map(([table, list]) => [table, list.length]),
    ),
    preserved_historical_rows: state.historicalCounts,
    physical_person_deletes: 0,
  };
}

async function writeBackup(state, backupRoot) {
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(backupRoot, 0o700);
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const backupPath = path.join(backupRoot, `${stamp}.json`);
  const aliasEdgeIds = MERGES.map(({ legacyId, canonicalId }) => `edg_alias_${legacyId}_to_${canonicalId}`);
  const body = {
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    rows: {
      graph_entities: state.graphEntities,
      graph_edges: state.graphEdges,
      people: state.people,
      ...state.operational,
    },
    created_ids: { graph_edges: aliasEdgeIds },
  };
  await fs.writeFile(backupPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.chmod(backupPath, 0o600);
  return backupPath;
}

async function upsertWholeRows(client, table, tableRows) {
  if (!tableRows.length) return;
  const pk = await primaryKeyColumns(client, table);
  const typeRows = await rows(client, `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table]);
  const types = new Map(typeRows.map((row) => [row.column_name, row.data_type]));
  for (const row of tableRows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
    const assignments = columns
      .filter((column) => !pk.includes(column))
      .map((column) => `${column} = EXCLUDED.${column}`)
      .join(',');
    await client.query(`
      INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})
      ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${assignments}
    `, columns.map((column) => (
      ['json', 'jsonb'].includes(types.get(column)) ? json(row[column]) : row[column]
    )));
  }
}

async function updateOperationalReferences(client, replacements) {
  for (const [table, requested] of Object.entries(OPERATIONAL_REFERENCES)) {
    const columns = await existingColumns(client, table, requested);
    for (const column of columns) {
      for (const [legacyId, canonicalId] of Object.entries(replacements)) {
        await client.query(`UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`, [legacyId, canonicalId]);
      }
    }
  }
  for (const { legacyId, canonicalId, name } of MERGES) {
    await client.query(
      'UPDATE auth_grants SET person_name = $3, updated_at = NOW() WHERE person_id = $2 OR person_id = $1',
      [legacyId, canonicalId, name],
    );
  }
}

async function applyMerge(client, state, mergedAt) {
  const { entities, replacements, aliasReuseByLegacy } = validateState(state);

  for (const entity of state.graphEntities) {
    if (replacements[entity.id]) continue;
    const payload = deepReplaceExact(entity.payload, replacements);
    if (JSON.stringify(payload) !== JSON.stringify(entity.payload)) {
      await client.query('UPDATE graph_entities SET payload = $2, updated_at = NOW() WHERE id = $1', [entity.id, json(payload)]);
    }
  }
  for (const edge of state.graphEdges) {
    const reusedForAlias = [...aliasReuseByLegacy.entries()].find(([, edgeId]) => edgeId === edge.id);
    if (reusedForAlias) {
      const [legacyId] = reusedForAlias;
      const canonicalId = replacements[legacyId];
      await client.query(`
        UPDATE graph_edges
        SET from_id = $2, to_id = $3, rel_type = 'alias_of',
            payload = $4, role_min = 'member', sensitivity = 'internal', updated_at = NOW()
        WHERE id = $1
      `, [edge.id, legacyId, canonicalId, json({ status: 'active', merged_at: mergedAt })]);
      continue;
    }
    const fromId = replacements[edge.from_id] ?? edge.from_id;
    const toId = replacements[edge.to_id] ?? edge.to_id;
    const payload = deepReplaceExact(edge.payload, replacements);
    if (fromId !== edge.from_id || toId !== edge.to_id || JSON.stringify(payload) !== JSON.stringify(edge.payload)) {
      await client.query(
        'UPDATE graph_edges SET from_id = $2, to_id = $3, payload = $4, updated_at = NOW() WHERE id = $1',
        [edge.id, fromId, toId, json(payload)],
      );
    }
  }

  for (const merge of MERGES) {
    const canonical = entities.get(merge.canonicalId);
    const legacy = entities.get(merge.legacyId);
    const canonicalPayload = mergePayloads(canonical.payload, legacy.payload, merge);
    await client.query(`
      UPDATE graph_entities
      SET payload = $2, role_min = $3, sensitivity = $4, updated_at = NOW()
      WHERE id = $1
    `, [
      merge.canonicalId,
      json(canonicalPayload),
      canonical.role_min,
      canonical.sensitivity,
    ]);
    await client.query(`
      UPDATE graph_entities
      SET entity_type = 'person_alias', payload = $2, role_min = 'member',
          sensitivity = 'internal', updated_at = NOW()
      WHERE id = $1
    `, [merge.legacyId, json(buildAliasPayload({ ...merge, legacyPayload: legacy.payload, mergedAt }))]);
    await client.query(`
      INSERT INTO graph_edges (
        id, from_id, to_id, rel_type, project_id, payload,
        role_min, sensitivity, created_at, updated_at
      ) VALUES ($1,$2,$3,'alias_of',$4,$5,'member','internal',NOW(),NOW())
      ON CONFLICT (from_id,to_id,rel_type) DO UPDATE
      SET payload = EXCLUDED.payload, updated_at = NOW()
    `, [
      `edg_alias_${merge.legacyId}_to_${merge.canonicalId}`,
      merge.legacyId,
      merge.canonicalId,
      canonical.project_id,
      json({ status: 'active', merged_at: mergedAt }),
    ]);
    await client.query('UPDATE people SET name = $2, status = $3 WHERE id = $1', [merge.canonicalId, merge.name, 'active']);
    await client.query('UPDATE people SET status = $2 WHERE id = $1', [merge.legacyId, 'merged']);
  }
  await updateOperationalReferences(client, replacements);

  const post = await collectState(client);
  for (const { legacyId, canonicalId } of MERGES) {
    const entity = post.graphEntities.find((row) => row.id === legacyId);
    assert(entity?.entity_type === 'person_alias', `${legacyId} was not converted to person_alias`);
    assert(entity.payload?.canonical_entity_id === canonicalId, `${legacyId} does not point to ${canonicalId}`);
    const remaining = countLegacyReferences(post, legacyId);
    assert(remaining.direct === 0, `current operational references remain for ${legacyId}`);
    assert(remaining.graph_edges === 1, `unexpected graph edge references remain for ${legacyId}`);
    assert(
      remaining.graph_payloads === 1,
      `unexpected graph payload references remain for ${legacyId}: ${remaining.graph_payloads}`,
    );
  }
  return post;
}

async function rollback(client, backupPath) {
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  assert(backup.version === BACKUP_VERSION, `unsupported backup version '${backup.version}'`);
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('duplicate-people-merge'))");
    const createdEdgeIds = backup.created_ids?.graph_edges ?? [];
    if (createdEdgeIds.length) {
      await client.query('DELETE FROM graph_edges WHERE id = ANY($1::text[])', [createdEdgeIds]);
    }
    for (const [table, tableRows] of Object.entries(backup.rows)) {
      await upsertWholeRows(client, table, tableRows);
    }
    await client.query('COMMIT');
    return { mode: 'rollback', status: 'rolled_back', backup_path: backupPath };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function run(
  { mode = 'dry-run', backupPath, backupRoot = process.env.PEOPLE_MERGE_BACKUP_ROOT || DEFAULT_BACKUP_ROOT } = {},
  { createPool = (connectionString) => new Pool({ connectionString }) } = {},
) {
  const connectionString = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
  assert(connectionString, 'INFO_SSOT_DATABASE_URL is required');
  const pool = createPool(connectionString);
  let client;
  try {
    client = await pool.connect();
    if (mode === 'rollback') {
      assert(backupPath, 'rollback requires a backup path');
      return await rollback(client, backupPath);
    }
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('duplicate-people-merge'))");
      const state = await collectState(client);
      const plan = sanitizedPlan(state);
      if (mode === 'dry-run') {
        await client.query('ROLLBACK');
        return plan;
      }
      assert(mode === 'apply', `unsupported mode '${mode}'`);
      const createdBackupPath = await writeBackup(state, backupRoot);
      const mergedAt = new Date().toISOString();
      const post = await applyMerge(client, state, mergedAt);
      const brainbaseProject = await rows(client, "SELECT id FROM projects WHERE code = 'brainbase' LIMIT 1");
      assert(brainbaseProject[0], 'brainbase project was not found');
      const eventId = `evt_duplicate_people_merge_${createHash('sha256').update(mergedAt).digest('hex').slice(0, 16)}`;
      await client.query(`
        INSERT INTO events (
          id, project_id, actor_person_id, event_type, payload,
          occurred_at, source, confidence, role_min, sensitivity, created_at
        ) VALUES ($1,$2,$3,$4,$5,NOW(),$6,1,'ceo','internal',NOW())
      `, [
        eventId,
        brainbaseProject[0].id,
        'per_01KGYC7NNS0VXADK7NP48W4VR5',
        'duplicate_people_merged',
        json({ merges: MERGES, backup_file: path.basename(createdBackupPath), physical_person_deletes: 0 }),
        'scripts/merge-duplicate-people.mjs',
      ]);
      await client.query('COMMIT');
      return {
        mode: 'apply',
        status: 'applied',
        backup_path: createdBackupPath,
        event_id: eventId,
        canonical_people: MERGES.map(({ canonicalId, name }) => ({ canonicalId, name })),
        preserved_historical_rows: post.historicalCounts,
        physical_person_deletes: 0,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main() {
  const [mode = 'dry-run', backupPath] = process.argv.slice(2);
  const result = await run({ mode, backupPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
