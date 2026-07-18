import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IDS,
  buildCanonicalOrgPayload,
  buildOrgAliasPayload,
  deepReplaceExact,
  removePersonalAbsolutePaths,
  rollback,
  sanitizedPlan,
  writeBackup,
} from '../../scripts/normalize-graph-data-ssot.mjs';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function backupFixture() {
  return {
    version: 'graph-data-ssot-normalization.v1',
    created_at: '2026-07-18T00:00:00.000Z',
    target_ids: {
      graph_entities: ['baao'],
      graph_edges: ['edge-1'],
      people: [IDS.canonicalPerson],
      auth_grants: ['grant-1'],
      raci_assignments: ['raci-1'],
    },
    rows: {
      graph_entities: [{ id: 'baao', entity_type: 'org', project_id: 'project-baao', payload: { name: 'BAAO' }, role_min: 'member', sensitivity: 'internal', created_at: null, updated_at: null }],
      graph_edges: [{ id: 'edge-1', from_id: 'org_baao', to_id: 'baao', rel_type: 'alias_of', project_id: 'project-baao', payload: {}, role_min: 'member', sensitivity: 'internal', created_at: null, updated_at: null }],
      people: [{ id: IDS.canonicalPerson, name: '佐藤 圭吾', status: 'active' }],
      auth_grants: [{ id: 'grant-1', person_id: IDS.canonicalPerson, person_name: '佐藤 圭吾', slack_user_id: null, slack_workspace_id: null, role: 'member', project_codes: ['brainbase'], clearance: ['internal'], active: true, created_at: null, updated_at: null }],
      raci_assignments: [{ id: 'raci-1', project_id: 'project-baao', person_id: IDS.canonicalPerson, role_code: 'A', authority_scope: {}, sensitivity_min: 'internal', sensitivity: 'internal', created_at: null, updated_at: null }],
    },
  };
}

async function writeBackupFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-normalization-rollback-'));
  tempDirs.push(dir);
  const backupPath = path.join(dir, 'backup.json');
  await fs.writeFile(backupPath, JSON.stringify(backupFixture()));
  return backupPath;
}

function fakeRollbackClient({ failOn } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      calls.push({ text: normalized, params });
      if (failOn && normalized.includes(failOn)) throw new Error('injected rollback failure');
      if (normalized.includes('SELECT * FROM projects WHERE code = $1')) return { rows: [{ id: 'project-brainbase', code: 'brainbase' }] };
      return { rows: [] };
    },
  };
}

describe('normalize-graph-data-ssot', () => {
  it('repoints exact legacy IDs without rewriting prose substrings', () => {
    expect(deepReplaceExact({ org_id: 'org_baao', note: 'org_baao is legacy', nested: ['org_unson'] }, {
      org_baao: 'baao',
      org_unson: 'unson',
    })).toEqual({ org_id: 'baao', note: 'org_baao is legacy', nested: ['unson'] });
  });

  it('converts BAAO absolute source paths to repository-relative paths and drops other personal paths', () => {
    expect(removePersonalAbsolutePaths([
      '/Users/ksato/workspace/projects/baao/docs/ABOUT.md',
      '/Users/other/private.md',
      'docs/internal/OPERATIONS_HANDBOOK.md',
    ])).toEqual([
      'docs/ABOUT.md',
      'docs/internal/OPERATIONS_HANDBOOK.md',
    ]);
  });

  it('merges richer organization fields into the canonical record without finance data', () => {
    const payload = buildCanonicalOrgPayload({
      canonical: { name: 'old', mission: 'old mission', aliases: ['old alias'], bank_account: { secret: true } },
      alias: { mission: ['current mission'], vision_summary: 'current vision', description: 'current description', aliases: ['new alias'], bank_account: { secret: true } },
      id: 'unson',
      name: '合同会社雲孫',
      aliases: ['Unson LLC'],
    });
    expect(payload).toMatchObject({
      org_id: 'unson',
      name: '合同会社雲孫',
      mission: ['current mission'],
      vision_summary: 'current vision',
      description: 'current description',
      status: 'active',
    });
    expect(payload.aliases).toEqual(expect.arrayContaining(['old alias', 'new alias', 'Unson LLC']));
    expect(payload).not.toHaveProperty('bank_account');
  });

  it('keeps legacy org IDs as auditable aliases pointing to the canonical ID', () => {
    expect(buildOrgAliasPayload({ id: IDS.baaoOrgAlias, name: 'BAAO', aliases: ['BAAO'] })).toMatchObject({
      status: 'retired_alias',
      canonical_entity_id: IDS.baaoOrg,
      retired_reason: 'duplicate_org_normalization',
    });
  });

  it('reports an idempotent post-apply plan without exposing payload values', () => {
    const state = {
      graphEntities: [{ id: IDS.vibeproDecision, role_min: 'member', payload: { decision_id: IDS.vibeproDecision } }],
      graphEdges: [{ id: IDS.baaoAliasEdge, from_id: IDS.baaoOrgAlias, to_id: IDS.baaoOrg, rel_type: 'alias_of', payload: {} }],
      authGrants: [{ id: 'grant-1', person_id: IDS.canonicalPerson }],
      raciAssignments: [{ id: 'raci-1', person_id: IDS.canonicalPerson }],
      authAuditCounts: [{ person_id: IDS.legacyPerson, count: 14 }],
    };

    expect(sanitizedPlan(state)).toMatchObject({
      status: 'ready',
      legacy_business_edges_to_migrate: 0,
      payload_records_to_repoint: 0,
      legacy_auth_grants_to_migrate: 0,
      legacy_raci_to_migrate: 0,
      preserved_legacy_auth_audit_logs: 14,
      vibepro_decision_action: 'preserve_existing',
      physical_deletes: 0,
    });
  });

  it('writes the targeted backup with owner-only directory and file permissions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-normalization-backup-'));
    tempDirs.push(root);
    const backupRoot = path.join(root, 'backups');
    const state = {
      graphEntities: [],
      graphEdges: [],
      people: [],
      authGrants: [],
      raciAssignments: [],
    };

    const backupPath = await writeBackup(state, backupRoot);
    expect((await fs.stat(backupRoot)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(backupPath)).mode & 0o777).toBe(0o600);
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
    expect(backup.version).toBe('graph-data-ssot-normalization.v1');
    expect(backup.target_ids.graph_entities).toEqual(expect.arrayContaining([
      IDS.baaoPhilosophy,
      IDS.unsonFinance,
      IDS.legacyPerson,
      IDS.vibeproDecision,
    ]));
  });

  it('rehearses rollback as one transaction limited to backed-up IDs', async () => {
    const backupPath = await writeBackupFixture();
    const client = fakeRollbackClient();

    const result = await rollback(client, backupPath);

    expect(result).toMatchObject({ mode: 'rollback', status: 'rolled_back' });
    const statements = client.calls.map(({ text }) => text);
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    const deletes = statements.filter((text) => text.startsWith('DELETE FROM'));
    expect(deletes).toHaveLength(4);
    expect(deletes.every((text) => text.includes('WHERE') && text.includes('= ANY($1::text[])'))).toBe(true);
    expect(statements).toContain("SELECT pg_advisory_xact_lock(hashtext('graph-data-ssot-normalization'))");
  });

  it('rolls back the rollback transaction when a restore statement fails', async () => {
    const backupPath = await writeBackupFixture();
    const client = fakeRollbackClient({ failOn: 'INSERT INTO graph_entities' });

    await expect(rollback(client, backupPath)).rejects.toThrow('injected rollback failure');
    expect(client.calls.map(({ text }) => text)).toContain('ROLLBACK');
    expect(client.calls.map(({ text }) => text)).not.toContain('COMMIT');
  });
});
