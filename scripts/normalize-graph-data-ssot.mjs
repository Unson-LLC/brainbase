#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

export const IDS = Object.freeze({
  baaoOrg: 'baao',
  baaoOrgAlias: 'org_baao',
  baaoProjectEntity: 'prj_01KGCS8BC76XRHFCHRRQ8G25MY',
  baaoPhilosophy: 'phi_baao_trusted_ai_adoption',
  unsonOrg: 'unson',
  unsonOrgAlias: 'org_unson',
  unsonFinance: 'fin_unson_bank_account',
  canonicalPerson: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
  legacyPerson: 'per_01KGYC7NNPNVRG527BGTFH5SGH',
  vibeproFrame: 'frm_vibepro',
  vibeproDecision: 'dec_vibepro_ai_self_evaluation_metrics_japanese_ssot',
  baaoAliasEdge: 'edg_alias_org_baao_to_baao',
  unsonAliasEdge: 'edg_alias_org_unson_to_unson',
});

export const REQUIRED_METRIC_TERMS = Object.freeze([
  '本番化ギャップ捕捉率',
  '本番化ギャップ的中率',
  'ゲート違反流出率',
  '開発DAG合致率',
  '証跡欠落率',
  'ゲート前進違反率',
  '残リスク回収率',
  'Story-to-Ship閉鎖率',
]);

const BACKUP_VERSION = 'graph-data-ssot-normalization.v1';
const BACKUP_TABLES = Object.freeze(['graph_entities', 'graph_edges', 'people', 'auth_grants', 'raci_assignments']);
const DEFAULT_BACKUP_ROOT = '/home/ubuntu/brainbase/var/graph-data-normalization/backups';
const NORMALIZED_AT = '2026-07-18';
const BACKUP_ROW_SCHEMAS = Object.freeze({
  graph_entities: {
    requiredStrings: ['id', 'entity_type', 'role_min', 'sensitivity'],
    nullableStrings: ['project_id'],
    objectFields: ['payload'],
    timestampFields: ['created_at', 'updated_at'],
  },
  graph_edges: {
    requiredStrings: ['id', 'from_id', 'to_id', 'rel_type', 'project_id', 'role_min', 'sensitivity'],
    objectFields: ['payload'],
    timestampFields: ['created_at', 'updated_at'],
  },
  people: {
    requiredStrings: ['id', 'name', 'status'],
  },
  auth_grants: {
    requiredStrings: ['id', 'person_name', 'role'],
    nullableStrings: ['person_id', 'slack_user_id', 'slack_workspace_id'],
    stringArrays: ['project_codes', 'clearance'],
    booleanFields: ['active'],
    timestampFields: ['created_at', 'updated_at'],
  },
  raci_assignments: {
    requiredStrings: ['id', 'project_id', 'person_id', 'role_code', 'sensitivity_min', 'sensitivity'],
    stringOrObjectFields: ['authority_scope'],
    timestampFields: ['created_at', 'updated_at'],
  },
});
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function uniqueStrings(...groups) {
  return [...new Set(groups.flat().filter((value) => typeof value === 'string' && value.trim()))];
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBackupRow(table, row) {
  const schema = BACKUP_ROW_SCHEMAS[table];
  assert(isPlainObject(row), `invalid backup schema: rows.${table} must contain objects`);
  for (const field of schema.requiredStrings ?? []) {
    assert(typeof row[field] === 'string' && row[field].trim(), `invalid backup schema: rows.${table}.${field} must be a non-empty string`);
  }
  for (const field of schema.nullableStrings ?? []) {
    assert(row[field] === null || (typeof row[field] === 'string' && row[field].trim()), `invalid backup schema: rows.${table}.${field} must be null or a non-empty string`);
  }
  for (const field of schema.objectFields ?? []) {
    assert(isPlainObject(row[field]), `invalid backup schema: rows.${table}.${field} must be an object`);
  }
  for (const field of schema.stringOrObjectFields ?? []) {
    assert((typeof row[field] === 'string') || isPlainObject(row[field]), `invalid backup schema: rows.${table}.${field} must be a string or object`);
  }
  for (const field of schema.stringArrays ?? []) {
    assert(Array.isArray(row[field]) && row[field].every((item) => typeof item === 'string'), `invalid backup schema: rows.${table}.${field} must be an array of strings`);
  }
  for (const field of schema.booleanFields ?? []) {
    assert(typeof row[field] === 'boolean', `invalid backup schema: rows.${table}.${field} must be a boolean`);
  }
  for (const field of schema.timestampFields ?? []) {
    assert(typeof row[field] === 'string' && row[field].trim() && !Number.isNaN(Date.parse(row[field])), `invalid backup schema: rows.${table}.${field} must be a valid timestamp string`);
  }
}

export function summarizeAuditLogs(rows) {
  const ordered = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const ids = ordered.map((row) => row.id);
  const timestamps = ordered.map((row) => new Date(row.created_at).toISOString());
  const content = ordered.map((row) => ({
    id: row.id,
    person_id: row.person_id,
    slack_user_id: row.slack_user_id,
    slack_workspace_id: row.slack_workspace_id,
    event_type: row.event_type,
    metadata: row.metadata ?? {},
    created_at: new Date(row.created_at).toISOString(),
  }));
  return {
    count: ordered.length,
    id_set_sha256: sha256(ids.join('\n')),
    timestamp_set_sha256: sha256(timestamps.join('\n')),
    content_sha256: sha256(stableJson(content)),
    first_created_at: timestamps.length ? [...timestamps].sort()[0] : null,
    last_created_at: timestamps.length ? [...timestamps].sort().at(-1) : null,
  };
}

export function validateBackup(backup) {
  assert(backup && typeof backup === 'object' && !Array.isArray(backup), 'invalid backup schema: root must be an object');
  assert(backup.version === BACKUP_VERSION, `unsupported backup version: ${backup.version}`);
  assert(typeof backup.created_at === 'string' && backup.created_at.trim(), 'invalid backup schema: created_at must be a non-empty string');
  assert(backup.target_ids && typeof backup.target_ids === 'object' && !Array.isArray(backup.target_ids), 'invalid backup schema: target_ids must be an object');
  assert(backup.rows && typeof backup.rows === 'object' && !Array.isArray(backup.rows), 'invalid backup schema: rows must be an object');
  for (const table of BACKUP_TABLES) {
    const targetIds = backup.target_ids[table];
    const rows = backup.rows[table];
    assert(Array.isArray(targetIds), `invalid backup schema: target_ids.${table} must be an array`);
    assert(Array.isArray(rows), `invalid backup schema: rows.${table} must be an array`);
    assert(targetIds.every((id) => typeof id === 'string' && id.trim()), `invalid backup schema: target_ids.${table} must contain non-empty strings`);
    assert(new Set(targetIds).size === targetIds.length, `invalid backup schema: target_ids.${table} must not contain duplicates`);
    rows.forEach((row) => validateBackupRow(table, row));
    assert(rows.every((row) => targetIds.includes(row.id)), `invalid backup schema: rows.${table} contains an id outside target_ids`);
  }
  return backup;
}

export async function readBackup(backupPath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('invalid backup JSON: malformed JSON', { cause: error });
    throw error;
  }
  return validateBackup(parsed);
}

export function deepReplaceExact(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => deepReplaceExact(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplaceExact(item, replacements)]));
  }
  if (typeof value === 'string' && Object.hasOwn(replacements, value)) return replacements[value];
  return value;
}

export function removePersonalAbsolutePaths(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => removePersonalAbsolutePaths(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, removePersonalAbsolutePaths(item)])
        .filter(([, item]) => item !== undefined),
    );
  }
  if (typeof value !== 'string') return value;
  const baaoPrefix = '/Users/ksato/workspace/projects/baao/';
  if (value.startsWith(baaoPrefix)) return value.slice(baaoPrefix.length);
  if (value.startsWith('/Users/')) return undefined;
  return value;
}

export function buildCanonicalOrgPayload({ canonical, alias, id, name, aliases }) {
  const payload = { ...(canonical ?? {}), ...(alias ?? {}) };
  delete payload.bank_account;
  delete payload.canonical_entity_id;
  delete payload.superseded_by;
  delete payload.retired_reason;
  delete payload.retired_at;
  return removePersonalAbsolutePaths({
    ...payload,
    org_id: id,
    name,
    aliases: uniqueStrings(canonical?.aliases, alias?.aliases, aliases),
    status: 'active',
  });
}

export function buildOrgAliasPayload({ id, name, aliases }) {
  return {
    name,
    aliases: uniqueStrings(aliases, id),
    status: 'retired_alias',
    canonical_entity_id: id === IDS.baaoOrgAlias ? IDS.baaoOrg : IDS.unsonOrg,
    retired_reason: 'duplicate_org_normalization',
    retired_at: NORMALIZED_AT,
  };
}

function buildBaaoPhilosophyPayload(baaoPayload) {
  const text = (value) => {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).join(' / ');
    return '';
  };
  const mission = text(baaoPayload.mission);
  assert(mission, 'BAAO org mission is required to derive its core Philosophy');
  const why = text(baaoPayload.vision) || text(baaoPayload.vision_summary) || text(baaoPayload.description);
  return {
    philosophy_id: IDS.baaoPhilosophy,
    title: 'BAAOの使命と信頼原則',
    display_name: 'BAAO Trusted AI Adoption',
    statement: mission,
    why: why || 'BAAOの既存missionとvaluesを、Graphから判断に使える固有文脈として提供するため。',
    scope: ['baao', 'governance', 'operations', 'education', 'partnership'],
    status: 'active',
    priority: 'core',
    decision_tests: [
      '教育・情報発信・連携によるAI活用の普及に寄与するか',
      'アクセシビリティ、倫理、透明性、信頼を損なわないか',
      'BAAOが提供する役務と責任の境界を説明できるか',
    ],
    anti_patterns: [
      '個人のローカルパスを組織の正本として保存する',
      '承認されていない制度文書を施行済みdecisionとして扱う',
    ],
    source_refs: ['graph:org:baao', 'docs/ABOUT.md'],
  };
}

function buildVibeProDecisionPayload({ frame, glossaryTerms }) {
  const metricEntityIds = REQUIRED_METRIC_TERMS.map((term) => glossaryTerms.get(term).id);
  return {
    decision_id: IDS.vibeproDecision,
    title: 'VibeProのAI自己評価指標はGraph SSOTの日本語指標を正本とする',
    status: 'decided',
    decision: 'VibeProのAI自己評価では、frm_vibeproとGraphに登録された日本語指標8語を正本として使用する。',
    frame_id: frame.id,
    metric_terms: [...REQUIRED_METRIC_TERMS],
    metric_entity_ids: metricEntityIds,
    reason: '2026-04-26の出荷証跡、現行spec、現行CI契約が同一IDを参照し、意図的廃止または削除の監査証跡が存在しないため、Graph driftを同一IDで復元する。',
    restored_from_drift: true,
    restored_at: NORMALIZED_AT,
    source_refs: [
      'graph:frame:frm_vibepro',
      'docs/specs/vibepro-brainbase-self-evaluation-spec.md',
      'docs/internal/vibepro-dogfood/ship.md',
      'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/graph-ssot-assessment.md',
      'scripts/vibepro-graph-ssot-check.mjs',
    ],
  };
}

async function query(client, text, params = []) {
  return (await client.query(text, params)).rows;
}

async function one(client, text, params = []) {
  const rows = await query(client, text, params);
  return rows[0] ?? null;
}

async function projectByCode(client, code) {
  const project = await one(client, 'SELECT * FROM projects WHERE code = $1', [code]);
  assert(project, `project '${code}' was not found`);
  return project;
}

async function entityById(client, id) {
  return one(client, 'SELECT * FROM graph_entities WHERE id = $1', [id]);
}

async function collectState(client) {
  const [baaoProject, unsonProject, brainbaseProject] = await Promise.all([
    projectByCode(client, 'baao'),
    projectByCode(client, 'unson'),
    projectByCode(client, 'brainbase'),
  ]);
  const fixedEntityIds = [
    IDS.baaoOrg,
    IDS.baaoOrgAlias,
    IDS.baaoProjectEntity,
    IDS.baaoPhilosophy,
    IDS.unsonOrg,
    IDS.unsonOrgAlias,
    IDS.unsonFinance,
    IDS.canonicalPerson,
    IDS.legacyPerson,
    IDS.vibeproFrame,
    IDS.vibeproDecision,
  ];
  const graphEntities = await query(client, `
    SELECT * FROM graph_entities
    WHERE id = ANY($1::text[])
       OR payload::text LIKE $2
       OR payload::text LIKE $3
    ORDER BY id
  `, [fixedEntityIds, `%${IDS.baaoOrgAlias}%`, `%${IDS.unsonOrgAlias}%`]);
  const graphEdges = await query(client, `
    SELECT * FROM graph_edges
    WHERE id = ANY($1::text[])
       OR from_id = ANY($2::text[])
       OR to_id = ANY($2::text[])
       OR payload::text LIKE $3
       OR payload::text LIKE $4
    ORDER BY id
  `, [
    [IDS.baaoAliasEdge, IDS.unsonAliasEdge],
    [IDS.baaoOrgAlias, IDS.unsonOrgAlias, IDS.baaoOrg, IDS.unsonOrg],
    `%${IDS.baaoOrgAlias}%`,
    `%${IDS.unsonOrgAlias}%`,
  ]);
  const people = await query(client, 'SELECT * FROM people WHERE id = ANY($1::text[]) ORDER BY id', [[IDS.legacyPerson, IDS.canonicalPerson]]);
  const authGrants = await query(client, 'SELECT * FROM auth_grants WHERE person_id = ANY($1::text[]) ORDER BY id', [[IDS.legacyPerson, IDS.canonicalPerson]]);
  const raciAssignments = await query(client, 'SELECT * FROM raci_assignments WHERE person_id = ANY($1::text[]) ORDER BY id', [[IDS.legacyPerson, IDS.canonicalPerson]]);
  const users = await query(client, 'SELECT person_id FROM users WHERE person_id = ANY($1::text[]) ORDER BY person_id', [[IDS.legacyPerson, IDS.canonicalPerson]]);
  const authAuditLogs = await query(client, `
    SELECT id, person_id, slack_user_id, slack_workspace_id, event_type, metadata, created_at
    FROM auth_audit_logs WHERE person_id = ANY($1::text[])
    ORDER BY id
  `, [[IDS.legacyPerson, IDS.canonicalPerson]]);
  const glossaryRows = await query(client, `
    SELECT * FROM graph_entities
    WHERE entity_type = 'glossary_term' AND payload->>'term' = ANY($1::text[])
    ORDER BY id
  `, [[...REQUIRED_METRIC_TERMS]]);
  return {
    projects: { baao: baaoProject, unson: unsonProject, brainbase: brainbaseProject },
    graphEntities,
    graphEdges,
    people,
    authGrants,
    raciAssignments,
    users,
    authAuditLogs,
    glossaryRows,
  };
}

function indexById(rows) {
  return new Map(rows.map((row) => [row.id, row]));
}

function validateState(state) {
  const entities = indexById(state.graphEntities);
  for (const id of [IDS.baaoOrg, IDS.baaoOrgAlias, IDS.baaoProjectEntity, IDS.unsonOrg, IDS.unsonOrgAlias, IDS.canonicalPerson, IDS.vibeproFrame]) {
    assert(entities.has(id), `required Graph entity '${id}' was not found`);
  }
  const people = indexById(state.people);
  assert(people.has(IDS.legacyPerson), `legacy person '${IDS.legacyPerson}' was not found`);
  assert(people.has(IDS.canonicalPerson), `canonical person '${IDS.canonicalPerson}' was not found`);
  const glossaryTerms = new Map(state.glossaryRows.map((row) => [row.payload?.term, row]));
  const missingTerms = REQUIRED_METRIC_TERMS.filter((term) => !glossaryTerms.has(term));
  assert(missingTerms.length === 0, `VibePro metric terms are missing: ${missingTerms.join(', ')}`);

  const conflicts = [];
  for (const edge of state.graphEdges.filter((row) => (
    row.rel_type !== 'alias_of'
    && (row.from_id === IDS.baaoOrgAlias || row.to_id === IDS.baaoOrgAlias || row.from_id === IDS.unsonOrgAlias || row.to_id === IDS.unsonOrgAlias)
  ))) {
    const fromId = edge.from_id === IDS.baaoOrgAlias ? IDS.baaoOrg : edge.from_id === IDS.unsonOrgAlias ? IDS.unsonOrg : edge.from_id;
    const toId = edge.to_id === IDS.baaoOrgAlias ? IDS.baaoOrg : edge.to_id === IDS.unsonOrgAlias ? IDS.unsonOrg : edge.to_id;
    const duplicate = state.graphEdges.find((candidate) => candidate.id !== edge.id && candidate.from_id === fromId && candidate.to_id === toId && candidate.rel_type === edge.rel_type);
    if (duplicate) conflicts.push({ edgeId: edge.id, duplicateId: duplicate.id });
  }
  assert(conflicts.length === 0, `edge migration conflicts: ${conflicts.map(({ edgeId, duplicateId }) => `${edgeId}/${duplicateId}`).join(', ')}`);

  const legacyRaci = state.raciAssignments.filter((row) => row.person_id === IDS.legacyPerson);
  const canonicalRaci = state.raciAssignments.filter((row) => row.person_id === IDS.canonicalPerson);
  const raciConflicts = legacyRaci.filter((legacy) => canonicalRaci.some((canonical) => canonical.project_id === legacy.project_id && canonical.role_code === legacy.role_code));
  assert(raciConflicts.length === 0, `RACI migration conflicts: ${raciConflicts.map((row) => row.id).join(', ')}`);
  return { entities, glossaryTerms };
}

export function sanitizedPlan(state) {
  const entities = indexById(state.graphEntities);
  const vibeproDecision = entities.get(IDS.vibeproDecision);
  const legacyGrantCount = state.authGrants.filter((row) => row.person_id === IDS.legacyPerson).length;
  const legacyRaciCount = state.raciAssignments.filter((row) => row.person_id === IDS.legacyPerson).length;
  const legacyAuditProof = summarizeAuditLogs(state.authAuditLogs.filter((row) => row.person_id === IDS.legacyPerson));
  return {
    mode: 'dry-run',
    status: 'ready',
    target_entities: [
      IDS.baaoOrg,
      IDS.baaoOrgAlias,
      IDS.baaoProjectEntity,
      IDS.baaoPhilosophy,
      IDS.unsonOrg,
      IDS.unsonOrgAlias,
      IDS.unsonFinance,
      IDS.canonicalPerson,
      IDS.legacyPerson,
      IDS.vibeproDecision,
    ],
    legacy_business_edges_to_migrate: state.graphEdges.filter((row) => (
      row.rel_type !== 'alias_of'
      && (row.from_id === IDS.baaoOrgAlias || row.to_id === IDS.baaoOrgAlias || row.from_id === IDS.unsonOrgAlias || row.to_id === IDS.unsonOrgAlias)
    )).length,
    payload_records_to_repoint: state.graphEntities.filter((row) => ![IDS.baaoOrgAlias, IDS.unsonOrgAlias].includes(row.id) && JSON.stringify(row.payload).match(/org_baao|org_unson/)).length,
    legacy_auth_grants_to_migrate: legacyGrantCount,
    legacy_raci_to_migrate: legacyRaciCount,
    preserved_legacy_auth_audit_logs: legacyAuditProof.count,
    legacy_auth_audit_proof: legacyAuditProof,
    auth_audit_logs_in_write_set: false,
    vibepro_decision_action: !vibeproDecision
      ? 'restore_same_id'
      : vibeproDecision.role_min === 'member'
        ? 'preserve_existing'
        : 'preserve_payload_lower_role_for_ci_readback',
    physical_deletes: 0,
  };
}

export async function writeBackup(state, backupRoot = DEFAULT_BACKUP_ROOT) {
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(backupRoot, 0o700);
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const backupPath = path.join(backupRoot, `${stamp}.json`);
  const body = {
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    target_ids: {
      graph_entities: uniqueStrings(state.graphEntities.map((row) => row.id), [IDS.baaoPhilosophy, IDS.unsonFinance, IDS.legacyPerson, IDS.vibeproDecision]),
      graph_edges: uniqueStrings(state.graphEdges.map((row) => row.id), [IDS.baaoAliasEdge, IDS.unsonAliasEdge]),
      people: state.people.map((row) => row.id),
      auth_grants: state.authGrants.map((row) => row.id),
      raci_assignments: state.raciAssignments.map((row) => row.id),
    },
    rows: {
      graph_entities: state.graphEntities,
      graph_edges: state.graphEdges,
      people: state.people,
      auth_grants: state.authGrants,
      raci_assignments: state.raciAssignments,
    },
  };
  await fs.writeFile(backupPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.chmod(backupPath, 0o600);
  return backupPath;
}

async function upsertEntity(client, row) {
  await client.query(`
    INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),NOW())
    ON CONFLICT (id) DO UPDATE SET
      entity_type = EXCLUDED.entity_type,
      project_id = EXCLUDED.project_id,
      payload = EXCLUDED.payload,
      role_min = EXCLUDED.role_min,
      sensitivity = EXCLUDED.sensitivity,
      updated_at = NOW()
  `, [row.id, row.entity_type, row.project_id, json(row.payload), row.role_min, row.sensitivity, row.created_at ?? null]);
}

async function upsertAliasEdge(client, { id, fromId, toId, projectId }) {
  await client.query(`
    INSERT INTO graph_edges (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
    VALUES ($1,$2,$3,'alias_of',$4,$5,'member','internal',NOW(),NOW())
    ON CONFLICT (from_id, to_id, rel_type) DO UPDATE SET
      payload = EXCLUDED.payload,
      role_min = EXCLUDED.role_min,
      sensitivity = EXCLUDED.sensitivity,
      updated_at = NOW()
  `, [id, fromId, toId, projectId, json({ status: 'active', normalized_at: NORMALIZED_AT })]);
}

async function applyNormalization(client, state) {
  const { entities, glossaryTerms } = validateState(state);
  const replacements = { [IDS.baaoOrgAlias]: IDS.baaoOrg, [IDS.unsonOrgAlias]: IDS.unsonOrg };
  const baaoPayload = buildCanonicalOrgPayload({
    canonical: entities.get(IDS.baaoOrg).payload,
    alias: entities.get(IDS.baaoOrgAlias).payload,
    id: IDS.baaoOrg,
    name: '一般社団法人 ビジネスAI推進機構',
    aliases: ['BAAO', 'Business AI Advancement Organization'],
  });
  const unsonPayload = buildCanonicalOrgPayload({
    canonical: entities.get(IDS.unsonOrg).payload,
    alias: entities.get(IDS.unsonOrgAlias).payload,
    id: IDS.unsonOrg,
    name: '合同会社雲孫',
    aliases: ['雲孫合同会社', 'Unson LLC', '雲孫'],
  });
  const priorFinance = entities.get(IDS.unsonFinance)?.payload?.account;
  const financeAccount = entities.get(IDS.unsonOrgAlias).payload?.bank_account ?? priorFinance;
  assert(financeAccount, 'Unson finance payload is missing; refusing to discard the protected account record');

  await upsertEntity(client, { ...entities.get(IDS.baaoOrg), payload: baaoPayload });
  await upsertEntity(client, {
    ...entities.get(IDS.baaoOrgAlias),
    entity_type: 'org_alias',
    payload: buildOrgAliasPayload({ id: IDS.baaoOrgAlias, name: 'BAAO', aliases: entities.get(IDS.baaoOrgAlias).payload?.aliases }),
    role_min: 'member',
    sensitivity: 'internal',
  });
  await upsertEntity(client, { ...entities.get(IDS.unsonOrg), payload: unsonPayload });
  await upsertEntity(client, {
    ...entities.get(IDS.unsonOrgAlias),
    entity_type: 'org_alias',
    payload: buildOrgAliasPayload({ id: IDS.unsonOrgAlias, name: '雲孫', aliases: entities.get(IDS.unsonOrgAlias).payload?.aliases }),
    role_min: 'member',
    sensitivity: 'internal',
  });
  await upsertEntity(client, {
    id: IDS.unsonFinance,
    entity_type: 'finance_account',
    project_id: state.projects.unson.id,
    payload: { organization_id: IDS.unsonOrg, account: financeAccount, status: 'active', normalized_at: NORMALIZED_AT },
    role_min: 'ceo',
    sensitivity: 'finance',
  });
  await upsertEntity(client, {
    ...entities.get(IDS.baaoProjectEntity),
    payload: { ...entities.get(IDS.baaoProjectEntity).payload, code: 'baao', name: 'BAAO' },
  });
  await upsertEntity(client, {
    id: IDS.baaoPhilosophy,
    entity_type: 'philosophy',
    project_id: state.projects.baao.id,
    payload: buildBaaoPhilosophyPayload(baaoPayload),
    role_min: 'member',
    sensitivity: 'internal',
  });
  const existingVibeproDecision = entities.get(IDS.vibeproDecision);
  if (existingVibeproDecision) {
    assert(existingVibeproDecision.entity_type === 'decision', 'VibePro decision ID exists with an unexpected entity_type');
    assert(existingVibeproDecision.project_id === state.projects.brainbase.id, 'VibePro decision belongs to an unexpected project');
    assert(existingVibeproDecision.payload?.decision_id === IDS.vibeproDecision, 'VibePro decision payload does not match the exact decision ID');
    if (existingVibeproDecision.role_min !== 'member') {
      await client.query(`
        UPDATE graph_entities
        SET role_min = 'member', updated_at = NOW()
        WHERE id = $1
      `, [IDS.vibeproDecision]);
    }
  } else {
    await upsertEntity(client, {
      id: IDS.vibeproDecision,
      entity_type: 'decision',
      project_id: state.projects.brainbase.id,
      payload: buildVibeProDecisionPayload({ frame: entities.get(IDS.vibeproFrame), glossaryTerms }),
      role_min: 'member',
      sensitivity: 'internal',
    });
  }

  const canonicalPersonEntity = entities.get(IDS.canonicalPerson);
  await upsertEntity(client, {
    ...canonicalPersonEntity,
    payload: {
      ...canonicalPersonEntity.payload,
      person_id: IDS.canonicalPerson,
      name: '佐藤 圭吾',
      aliases: uniqueStrings(canonicalPersonEntity.payload?.aliases, ['佐藤圭吾']),
      merged_person_ids: uniqueStrings(canonicalPersonEntity.payload?.merged_person_ids, [IDS.legacyPerson]),
      status: 'active',
    },
  });
  await upsertEntity(client, {
    id: IDS.legacyPerson,
    entity_type: 'person_alias',
    project_id: state.projects.brainbase.id,
    payload: {
      name: state.people.find((row) => row.id === IDS.legacyPerson)?.name ?? '佐藤圭吾',
      status: 'merged',
      canonical_entity_id: IDS.canonicalPerson,
      merged_at: NORMALIZED_AT,
    },
    role_min: 'member',
    sensitivity: 'internal',
  });

  for (const entity of state.graphEntities.filter((row) => ![IDS.baaoOrgAlias, IDS.unsonOrgAlias, IDS.baaoOrg, IDS.unsonOrg, IDS.baaoProjectEntity, IDS.canonicalPerson, IDS.vibeproDecision, IDS.baaoPhilosophy, IDS.unsonFinance].includes(row.id))) {
    const replaced = deepReplaceExact(entity.payload, replacements);
    if (JSON.stringify(replaced) !== JSON.stringify(entity.payload)) await upsertEntity(client, { ...entity, payload: replaced });
  }

  for (const edge of state.graphEdges.filter((row) => ![IDS.baaoAliasEdge, IDS.unsonAliasEdge].includes(row.id))) {
    const fromId = replacements[edge.from_id] ?? edge.from_id;
    const toId = replacements[edge.to_id] ?? edge.to_id;
    const payload = deepReplaceExact(edge.payload, replacements);
    if (fromId !== edge.from_id || toId !== edge.to_id || JSON.stringify(payload) !== JSON.stringify(edge.payload)) {
      await client.query(`
        UPDATE graph_edges
        SET from_id = $2, to_id = $3, payload = $4, updated_at = NOW()
        WHERE id = $1
      `, [edge.id, fromId, toId, json(payload)]);
    }
  }
  await upsertAliasEdge(client, { id: IDS.baaoAliasEdge, fromId: IDS.baaoOrgAlias, toId: IDS.baaoOrg, projectId: state.projects.baao.id });
  await upsertAliasEdge(client, { id: IDS.unsonAliasEdge, fromId: IDS.unsonOrgAlias, toId: IDS.unsonOrg, projectId: state.projects.unson.id });

  await client.query('UPDATE people SET status = $2 WHERE id = $1', [IDS.legacyPerson, 'merged']);
  await client.query('UPDATE people SET name = $2, status = $3 WHERE id = $1', [IDS.canonicalPerson, '佐藤 圭吾', 'active']);
  await client.query('UPDATE auth_grants SET person_id = $2, person_name = $3, updated_at = NOW() WHERE person_id = $1', [IDS.legacyPerson, IDS.canonicalPerson, '佐藤 圭吾']);
  await client.query('UPDATE raci_assignments SET person_id = $2, updated_at = NOW() WHERE person_id = $1', [IDS.legacyPerson, IDS.canonicalPerson]);

  const post = await collectState(client);
  const postEntities = indexById(post.graphEntities);
  const legacyBusinessEdges = post.graphEdges.filter((row) => (
    row.rel_type !== 'alias_of'
    && [row.from_id, row.to_id].some((id) => [IDS.baaoOrgAlias, IDS.unsonOrgAlias].includes(id))
  ));
  assert(legacyBusinessEdges.length === 0, 'legacy business edges remain after normalization');
  assert(postEntities.get(IDS.baaoProjectEntity)?.payload?.name === 'BAAO', 'BAAO project name was not updated');
  assert(postEntities.get(IDS.baaoPhilosophy)?.payload?.priority === 'core', 'BAAO core Philosophy was not created');
  assert(postEntities.has(IDS.vibeproDecision), 'VibePro decision was not restored');
  assert(!postEntities.get(IDS.unsonOrg)?.payload?.bank_account, 'finance data remains in canonical Unson org');
  assert(!postEntities.get(IDS.unsonOrgAlias)?.payload?.bank_account, 'finance data remains in Unson alias');
  assert(postEntities.get(IDS.unsonFinance)?.role_min === 'ceo' && postEntities.get(IDS.unsonFinance)?.sensitivity === 'finance', 'Unson finance boundary is invalid');
  assert(post.authGrants.every((row) => row.person_id !== IDS.legacyPerson), 'legacy auth_grants reference remains');
  assert(post.raciAssignments.every((row) => row.person_id !== IDS.legacyPerson), 'legacy RACI reference remains');
  assert(post.users.every((row) => row.person_id !== IDS.legacyPerson), 'legacy users reference remains');
  await client.query(`
    INSERT INTO events (
      id, project_id, actor_person_id, event_type, payload,
      occurred_at, source, confidence, role_min, sensitivity, created_at
    ) VALUES ($1,$2,$3,$4,$5,NOW(),$6,1,'member','internal',NOW())
    ON CONFLICT (id) DO NOTHING
  `, [
    'evt_graph_data_ssot_normalization_20260718',
    state.projects.brainbase.id,
    IDS.canonicalPerson,
    'graph_data_ssot_normalized',
    json({
      story_id: 'story-graph-data-ssot-normalization',
      canonical_orgs: [IDS.baaoOrg, IDS.unsonOrg],
      retired_aliases: [IDS.baaoOrgAlias, IDS.unsonOrgAlias],
      restored_entities: [IDS.baaoPhilosophy, ...(!existingVibeproDecision ? [IDS.vibeproDecision] : [])],
      visibility_repaired_entities: existingVibeproDecision?.role_min !== 'member' ? [IDS.vibeproDecision] : [],
      canonical_person_id: IDS.canonicalPerson,
      physical_deletes: 0,
    }),
    'scripts/normalize-graph-data-ssot.mjs',
  ]);
  return post;
}

async function restoreRows(client, table, idColumn, targetIds, rows, columns) {
  if (targetIds.length > 0) await client.query(`DELETE FROM ${table} WHERE ${idColumn} = ANY($1::text[])`, [targetIds]);
  for (const row of rows) {
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
    const values = columns.map((column) => column === 'payload' ? json(row[column]) : row[column]);
    await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`, values);
  }
}

export async function rollback(client, backupPath) {
  const backup = await readBackup(backupPath);
  return withNormalizationTransaction(client, async () => {
    await restoreRows(client, 'graph_edges', 'id', backup.target_ids.graph_edges, backup.rows.graph_edges, ['id', 'from_id', 'to_id', 'rel_type', 'project_id', 'payload', 'role_min', 'sensitivity', 'created_at', 'updated_at']);
    await restoreRows(client, 'graph_entities', 'id', backup.target_ids.graph_entities, backup.rows.graph_entities, ['id', 'entity_type', 'project_id', 'payload', 'role_min', 'sensitivity', 'created_at', 'updated_at']);
    await restoreRows(client, 'raci_assignments', 'id', backup.target_ids.raci_assignments, backup.rows.raci_assignments, ['id', 'project_id', 'person_id', 'role_code', 'authority_scope', 'sensitivity_min', 'sensitivity', 'created_at', 'updated_at']);
    await restoreRows(client, 'auth_grants', 'id', backup.target_ids.auth_grants, backup.rows.auth_grants, ['id', 'person_id', 'person_name', 'slack_user_id', 'slack_workspace_id', 'organization_id', 'role', 'project_codes', 'clearance', 'active', 'created_at', 'updated_at']);
    for (const person of backup.rows.people) {
      await client.query(`
        INSERT INTO people (id, name, status) VALUES ($1,$2,$3)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status
      `, [person.id, person.name, person.status]);
    }
    const brainbaseProject = await projectByCode(client, 'brainbase');
    const rollbackId = `evt_graph_data_ssot_rollback_${createHash('sha256').update(path.basename(backupPath)).digest('hex').slice(0, 16)}`;
    await client.query(`
      INSERT INTO events (
        id, project_id, actor_person_id, event_type, payload,
        occurred_at, source, confidence, role_min, sensitivity, created_at
      ) VALUES ($1,$2,$3,$4,$5,NOW(),$6,1,'member','internal',NOW())
      ON CONFLICT (id) DO NOTHING
    `, [
      rollbackId,
      brainbaseProject.id,
      IDS.canonicalPerson,
      'graph_data_ssot_normalization_rolled_back',
      json({ story_id: 'story-graph-data-ssot-normalization', backup_file: path.basename(backupPath) }),
      'scripts/normalize-graph-data-ssot.mjs',
    ]);
    return { mode: 'rollback', status: 'rolled_back', backup_path: backupPath, restored_targets: Object.fromEntries(Object.entries(backup.target_ids).map(([key, ids]) => [key, ids.length])) };
  });
}

export async function withNormalizationTransaction(client, operation, { commit = true } = {}) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('graph-data-ssot-normalization'))");
    const result = await operation();
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function run(
  { mode = 'dry-run', backupPath, backupRoot = process.env.GRAPH_NORMALIZATION_BACKUP_ROOT || DEFAULT_BACKUP_ROOT } = {},
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
    return await withNormalizationTransaction(client, async () => {
      const state = await collectState(client);
      validateState(state);
      if (mode === 'dry-run') {
        return sanitizedPlan(state);
      }
      assert(mode === 'apply', `unsupported mode '${mode}'`);
      const createdBackupPath = await writeBackup(state, backupRoot);
      const migratedEdgeIds = state.graphEdges
        .filter((row) => (
          [row.from_id, row.to_id].some((id) => [IDS.baaoOrgAlias, IDS.unsonOrgAlias].includes(id))
          || JSON.stringify(row.payload).includes(IDS.baaoOrgAlias)
          || JSON.stringify(row.payload).includes(IDS.unsonOrgAlias)
        ))
        .map((row) => row.id);
      const post = await applyNormalization(client, state);
      return {
        mode: 'apply',
        status: 'applied',
        backup_path: createdBackupPath,
        changed_entities: [IDS.baaoOrg, IDS.baaoOrgAlias, IDS.baaoProjectEntity, IDS.baaoPhilosophy, IDS.unsonOrg, IDS.unsonOrgAlias, IDS.unsonFinance, IDS.canonicalPerson, IDS.legacyPerson, IDS.vibeproDecision],
        changed_edges: uniqueStrings(migratedEdgeIds, [IDS.baaoAliasEdge, IDS.unsonAliasEdge]),
        canonical_person_references: {
          auth_grants: post.authGrants.filter((row) => row.person_id === IDS.canonicalPerson).length,
          raci_assignments: post.raciAssignments.filter((row) => row.person_id === IDS.canonicalPerson).length,
          users: post.users.filter((row) => row.person_id === IDS.canonicalPerson).length,
        },
        preserved_legacy_auth_audit_logs: post.authAuditLogs.filter((row) => row.person_id === IDS.legacyPerson).length,
        legacy_auth_audit_proof: summarizeAuditLogs(post.authAuditLogs.filter((row) => row.person_id === IDS.legacyPerson)),
        auth_audit_logs_in_write_set: false,
        physical_deletes: 0,
      };
    }, { commit: mode !== 'dry-run' });
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
