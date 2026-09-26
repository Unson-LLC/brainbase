import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyGraphCorrection,
  GRAPH_CORRECTIONS_FILE,
  GraphCorrectionError,
  graphRecordDigest,
  readGraphCorrectionHistory
} from '../src/graph-corrections.js';
import {
  GraphWebError,
  listGraphProjects,
  readGraphEntity,
  readGraphOntology,
  readGraphProject,
  readGraphWebStatus,
  searchGraphEntities
} from '../src/graph-web.js';
import { initializePersonalOs, loadPersonalOs } from '../src/ssot.js';
import type { CanonicalEdge, GraphFileV2, RelationshipsFile } from '../src/types.js';
import { EDGES, ENTITIES, FIXTURE_NOW, REGISTRATION_PROJECTION, writeGraphV1, writeGraphV2 } from './graph-web-fixture.js';

let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brainbase-graph-web-'));
  dataDir = join(root, 'personal-os');
});

afterEach(async () => {
  delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
  await rm(root, { recursive: true, force: true });
});

async function readGraph(): Promise<GraphFileV2> {
  return JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf8')) as GraphFileV2;
}

async function readRelationships(): Promise<RelationshipsFile> {
  return JSON.parse(await readFile(join(dataDir, 'relationships.json'), 'utf8')) as RelationshipsFile;
}

async function historyLines(): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(dataDir, GRAPH_CORRECTIONS_FILE), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function storedEdge(id: string): Promise<CanonicalEdge> {
  const edge = (await readGraph()).edges.find((candidate) => candidate.id === id);
  if (!edge) throw new Error(`missing edge ${id}`);
  return edge;
}

async function expectCorrectionError(promise: Promise<unknown>, kind: string, code: string): Promise<GraphCorrectionError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(GraphCorrectionError);
  expect(error).toMatchObject({ kind, code });
  return error as GraphCorrectionError;
}

describe('local Graph web reads', () => {
  it('lists projects with active participant counts, goal, status and validity', async () => {
    await writeGraphV2(dataDir);
    const list = await listGraphProjects(dataDir, { now: FIXTURE_NOW });
    if (list.status !== 'ok') throw new Error('expected ok');
    expect(list.source).toEqual({ dataDir, graphFormat: 2, authority: 'local_graph' });
    expect(list.absenceConfirmed).toBe(false);
    expect(list.projects.map((project) => [project.id, project.active, project.participantCount, project.accountableCount])).toEqual([
      ['project-atlas', true, 2, 1],
      ['project-beta', false, 0, 0]
    ]);
    expect(list.projects[0]).toMatchObject({ goal: '導入を完了する', status: '進行中', validTo: null });
    expect(list.projects[1]).toMatchObject({ goal: null, status: '完了', validTo: '2026-03-01T00:00:00Z' });
  });

  it('reads a project with each participant, relation, role, validity, provenance kind and record digest', async () => {
    await writeGraphV2(dataDir);
    const detail = await readGraphProject(dataDir, 'project-atlas', { now: FIXTURE_NOW });
    if (detail.status !== 'ok') throw new Error('expected ok');
    expect(detail.project).toMatchObject({ name: 'Atlas導入', goal: '導入を完了する', decisionPrinciples: ['小さく始める'] });
    expect(detail.project.digest).toBe(graphRecordDigest(ENTITIES.atlas));
    expect(detail.participants.map((participant) => ({
      person: [participant.counterpart.id, participant.counterpart.name],
      relation: participant.relation,
      role: participant.role,
      validFrom: participant.validFrom,
      sourceKind: participant.provenance.sourceKind,
      digest: participant.digest
    }))).toEqual([
      { person: ['person-sato', '佐藤 花子'], relation: 'accountable_for', role: 'PM', validFrom: '2026-01-01T00:00:00Z', sourceKind: 'import', digest: graphRecordDigest(EDGES.satoAtlas) },
      { person: ['person-tanaka', '田中 太郎'], relation: 'participates_in', role: '責任者', validFrom: null, sourceKind: 'onboarding', digest: graphRecordDigest(EDGES.tanakaAtlas) }
    ]);
    expect(detail.relations.map((relation) => relation.relation)).toEqual(['governs']);
    expect(detail.participants[0]!.provenance.reference).toEqual({
      status: 'resolved', kind: 'extracted_candidate', file: 'candidates/extracted-abc.json',
      candidateId: 'cand-sato', candidateKind: 'relationship', label: '佐藤 花子'
    });
    expect(detail.participants[1]!.provenance.reference).toEqual({ status: 'unresolved', sourceId: 'relationship-reg1' });
    expect(detail.issues).toEqual([]);
    await expect(readGraphProject(dataDir, 'person-sato')).rejects.toMatchObject({ kind: 'not_found', code: 'project_not_found' });
  });

  it('reads an entity with incoming and outgoing relations and resolves onboarding run references', async () => {
    await writeGraphV2(dataDir);
    const detail = await readGraphEntity(dataDir, 'person-sato', { now: FIXTURE_NOW });
    if (detail.status !== 'ok') throw new Error('expected ok');
    expect(detail.entity).toMatchObject({ id: 'person-sato', type: 'person', active: true, digest: graphRecordDigest(ENTITIES.sato) });
    expect(detail.incoming).toEqual([]);
    expect(detail.outgoing.map((edge) => [edge.relation, edge.counterpart.id, edge.active])).toEqual([
      ['accountable_for', 'project-atlas', true],
      ['participates_in', 'project-beta', false]
    ]);
    expect(detail.outgoing[1]!.provenance.reference).toEqual({
      status: 'resolved', kind: 'onboarding_run_candidate', file: 'runs/connected-onboarding.json',
      runId: 'run-1', candidateId: 'onb_cand_1', candidateKind: 'relationship', reviewStatus: 'approved', label: '佐藤 花子'
    });
    const tanaka = await readGraphEntity(dataDir, 'person-tanaka', { now: FIXTURE_NOW });
    if (tanaka.status !== 'ok') throw new Error('expected ok');
    const membership = tanaka.outgoing.find((edge) => edge.relation === 'member_of')!;
    expect(membership.provenance).toMatchObject({ sourceKind: 'migration', reference: { status: 'unresolved', sourceId: 'person-tanaka' } });
    await expect(readGraphEntity(dataDir, 'missing')).rejects.toMatchObject({ kind: 'not_found', code: 'entity_not_found' });
  });

  it('reports unreadable reference files separately and still resolves the readable ones', async () => {
    await writeGraphV2(dataDir);
    await writeFile(join(dataDir, 'candidates', 'extracted-broken.json'), '{not json');
    await mkdir(join(dataDir, 'evidence'), { recursive: true });
    await writeFile(join(dataDir, GRAPH_CORRECTIONS_FILE), '{"schema":"other"}\n');
    const detail = await readGraphEntity(dataDir, 'person-sato', { now: FIXTURE_NOW });
    if (detail.status !== 'ok') throw new Error('expected ok');
    expect(detail.outgoing[0]!.provenance.reference).toMatchObject({ status: 'resolved', candidateId: 'cand-sato' });
    expect(detail.issues).toEqual([
      expect.objectContaining({ file: 'candidates/extracted-broken.json' }),
      expect.objectContaining({ file: GRAPH_CORRECTIONS_FILE, line: 1 })
    ]);
  });

  it('searches names and aliases with type and as_of filters, and says when absence is confirmed', async () => {
    await writeGraphV2(dataDir);
    const byName = await searchGraphEntities(dataDir, { q: '田中' });
    const byAlias = await searchGraphEntities(dataDir, { q: 'TANAKA' });
    if (byName.status !== 'ok' || byAlias.status !== 'ok') throw new Error('expected ok');
    expect(byName.results.map((entity) => entity.id)).toEqual(['person-tanaka']);
    expect(byAlias.results.map((entity) => entity.id)).toEqual(['person-tanaka']);
    expect(byName.absenceConfirmed).toBe(false);

    const projects = await searchGraphEntities(dataDir, { type: 'project' });
    if (projects.status !== 'ok') throw new Error('expected ok');
    expect(projects.results.map((entity) => entity.id)).toEqual(['project-atlas', 'project-beta']);

    const current = await searchGraphEntities(dataDir, { q: '鈴木', asOf: FIXTURE_NOW.toISOString() });
    const past = await searchGraphEntities(dataDir, { q: '鈴木', asOf: '2025-06-01T00:00:00Z' });
    if (current.status !== 'ok' || past.status !== 'ok') throw new Error('expected ok');
    expect(current.results).toEqual([]);
    expect(current).toMatchObject({ absenceConfirmed: true, graphEmpty: false });
    expect(past.results.map((entity) => entity.id)).toEqual(['person-suzuki']);

    await expect(searchGraphEntities(dataDir, { type: 'relationship' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(searchGraphEntities(dataDir, { asOf: 'yesterday' })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('summarizes relation types with their endpoints, meaning and counts', async () => {
    await writeGraphV2(dataDir);
    const ontology = await readGraphOntology(dataDir, { now: FIXTURE_NOW });
    if (ontology.status !== 'ok') throw new Error('expected ok');
    expect(ontology.ontology.upToDate).toBe(true);
    const counts = Object.fromEntries(ontology.relations.map((relation) => [relation.id, [relation.from, relation.to, relation.count, relation.activeCount]]));
    expect(counts).toEqual({
      member_of: ['person', 'org', 1, 1],
      participates_in: ['person', 'project', 2, 1],
      accountable_for: ['person', 'project', 1, 1],
      owned_by: ['project', 'org', 0, 0],
      governs: ['decision', 'project', 1, 1],
      supersedes: ['decision', 'decision', 0, 0]
    });
    expect(ontology.relations.every((relation) => relation.meaning.length > 0)).toBe(true);
    expect(Object.fromEntries(ontology.entityTypes.map((type) => [type.id, type.count]))).toEqual({ person: 4, org: 1, project: 2, decision: 1 });
    expect(ontology.corrections.newEdgeRelations).toEqual(['participates_in', 'accountable_for', 'member_of']);
  });

  it('confirms an empty Graph v2 and an uninitialized directory without creating it', async () => {
    const missing = join(root, 'missing');
    expect(await listGraphProjects(missing)).toMatchObject({ status: 'not_initialized', absenceConfirmed: true, command: 'brainbase onboard:start' });
    await expectCorrectionError(applyGraphCorrection(missing, {
      kind: 'update_entity', entityId: 'x', expectedDigest: `sha256:${'0'.repeat(64)}`, reason: '直す。', changes: { name: 'x' }
    }), 'not_found', 'graph_not_initialized');
    await expect(access(missing)).rejects.toThrow();

    await initializePersonalOs(dataDir);
    const projects = await listGraphProjects(dataDir);
    const search = await searchGraphEntities(dataDir, { q: 'anything' });
    expect(projects).toMatchObject({ status: 'ok', projects: [], absenceConfirmed: true });
    expect(search).toMatchObject({ status: 'ok', results: [], absenceConfirmed: true, graphEmpty: true });
  });

  it('reports Graph v1 as migration required on every read and never migrates it', async () => {
    await writeGraphV1(dataDir);
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const reads = await Promise.all([
      readGraphWebStatus(dataDir),
      listGraphProjects(dataDir),
      readGraphProject(dataDir, 'project-legacy'),
      searchGraphEntities(dataDir, { q: 'Legacy' }),
      readGraphEntity(dataDir, 'person-legacy'),
      readGraphOntology(dataDir)
    ]);
    for (const result of reads) {
      expect(result).toMatchObject({
        status: 'migration_required',
        source: { graphFormat: 1 },
        legacyEntityCount: 2,
        absenceConfirmed: false
      });
      expect(result).not.toHaveProperty('projects');
      expect(result).not.toHaveProperty('results');
      expect((result as { command: string }).command).toContain('brainbase ontology:migrate');
      expect((result as { writeCommand: string }).writeCommand).toContain('--write --expected-input-digest');
    }
    await expectCorrectionError(applyGraphCorrection(dataDir, {
      kind: 'update_entity', entityId: 'person-legacy', expectedDigest: `sha256:${'0'.repeat(64)}`, reason: '名前を直す。', changes: { name: 'X' }
    }), 'migration_required', 'migration_required');
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
  });

  it('fails loudly when graph.json cannot be read instead of returning zero items', async () => {
    await writeGraphV2(dataDir);
    await writeFile(join(dataDir, 'graph.json'), '{ broken');
    await expect(listGraphProjects(dataDir)).rejects.toBeInstanceOf(GraphWebError);
    await expect(searchGraphEntities(dataDir, { q: 'x' })).rejects.toMatchObject({ kind: 'unavailable', code: 'graph_unavailable' });
  });
});

describe('local Graph corrections', () => {
  it('corrects a role, appends one history line, updates the registration projection and verifies the readback', async () => {
    await writeGraphV2(dataDir);
    const result = await applyGraphCorrection(dataDir, {
      kind: 'update_edge',
      edgeId: EDGES.tanakaAtlas.id,
      expectedDigest: graphRecordDigest(EDGES.tanakaAtlas),
      reason: '役割は責任者ではなく技術顧問だった。',
      changes: { role: '技術顧問' }
    }, { now: FIXTURE_NOW });

    const stored = await storedEdge(EDGES.tanakaAtlas.id);
    expect(stored).toEqual({ ...EDGES.tanakaAtlas, role: '技術顧問' });
    expect(result).toMatchObject({ status: 'saved', recordType: 'edge', record: stored, readback: { verified: true, historyRecorded: true } });
    expect(result.digest).toBe(graphRecordDigest(stored));
    expect(result.appliesTo).toEqual(['search', 'get_context', 'resolve_entity']);

    const lines = await historyLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      schema: 'brainbase-graph-correction.v1',
      id: result.correction.id,
      at: FIXTURE_NOW.toISOString(),
      kind: 'update_edge',
      target: { recordType: 'edge', id: EDGES.tanakaAtlas.id },
      reason: '役割は責任者ではなく技術顧問だった。',
      changedFields: ['role'],
      changes: { role: { before: '責任者', after: '技術顧問' } },
      beforeDigest: graphRecordDigest(EDGES.tanakaAtlas),
      afterDigest: graphRecordDigest(stored)
    });

    const projection = (await readRelationships()).relationships.find((record) => record.id === 'relationship-reg1');
    expect(projection).toEqual({ ...REGISTRATION_PROJECTION, role: '技術顧問', updatedAt: FIXTURE_NOW.toISOString() });

    const detail = await readGraphEntity(dataDir, 'person-tanaka', { now: FIXTURE_NOW });
    if (detail.status !== 'ok') throw new Error('expected ok');
    expect(detail.history.map((record) => record.id)).toEqual([result.correction.id]);
  });

  it('adds a participant as user approved, projects it like project registration and links the history as its source', async () => {
    await writeGraphV2(dataDir);
    const result = await applyGraphCorrection(dataDir, {
      kind: 'create_edge',
      reason: '佐藤さんも実務で参加している。',
      edge: { fromId: 'person-sato', relation: 'participates_in', toId: 'project-atlas', role: '実務', context: '週次の進行' }
    }, { now: FIXTURE_NOW });

    const edge = result.record as CanonicalEdge;
    expect(edge.provenance).toEqual({ sourceKind: 'user_approved', sourceId: result.correction.id });
    expect(result.correction).toMatchObject({ kind: 'create_edge', beforeDigest: null, afterDigest: graphRecordDigest(edge) });
    expect((await readRelationships()).relationships).toContainEqual({
      id: `relationship-${edge.id}`,
      person: '佐藤 花子',
      role: '実務',
      context: 'Atlas導入: 週次の進行',
      tags: ['project', 'relationship'],
      updatedAt: FIXTURE_NOW.toISOString()
    });

    const project = await readGraphProject(dataDir, 'project-atlas', { now: FIXTURE_NOW });
    if (project.status !== 'ok') throw new Error('expected ok');
    const added = project.participants.find((participant) => participant.id === edge.id)!;
    expect(added.provenance.reference).toMatchObject({ status: 'resolved', kind: 'graph_correction', correctionId: result.correction.id, reason: '佐藤さんも実務で参加している。' });
    expect((await loadPersonalOs(dataDir)).graph.version).toBe(2);
  });

  it('ends a relation with validTo instead of deleting it and removes its projection with the removed record in history', async () => {
    await writeGraphV2(dataDir);
    const result = await applyGraphCorrection(dataDir, {
      kind: 'update_edge',
      edgeId: EDGES.tanakaAtlas.id,
      expectedDigest: graphRecordDigest(EDGES.tanakaAtlas),
      reason: '9月で担当を外れた。',
      changes: { validTo: '2026-09-20T00:00:00Z' }
    }, { now: FIXTURE_NOW });
    expect((await storedEdge(EDGES.tanakaAtlas.id)).validTo).toBe('2026-09-20T00:00:00Z');
    expect((await readRelationships()).relationships.map((record) => record.id)).not.toContain('relationship-reg1');
    expect(result.correction.projections).toEqual([expect.objectContaining({
      relationshipId: 'relationship-reg1', action: 'removed', before: REGISTRATION_PROJECTION, afterDigest: null
    })]);
    const list = await listGraphProjects(dataDir, { now: FIXTURE_NOW });
    if (list.status !== 'ok') throw new Error('expected ok');
    expect(list.projects[0]).toMatchObject({ id: 'project-atlas', participantCount: 1 });
  });

  it('corrects a project name, goal and status and re-renders the linked projection context', async () => {
    await writeGraphV2(dataDir);
    const result = await applyGraphCorrection(dataDir, {
      kind: 'update_entity',
      entityId: 'project-atlas',
      expectedDigest: graphRecordDigest(ENTITIES.atlas),
      reason: '正式名称と今期の目的に合わせる。',
      changes: { name: 'Atlas本番導入', goal: '本番で使い始める', status: null }
    }, { now: FIXTURE_NOW });
    const project = (await readGraph()).entities.find((entity) => entity.id === 'project-atlas')!;
    expect(project).toEqual({
      ...ENTITIES.atlas,
      name: 'Atlas本番導入',
      metadata: { goal: '本番で使い始める', decisionPrinciples: ['小さく始める'], sources: [] }
    });
    expect(result.correction.changedFields).toEqual(['name', 'metadata.goal', 'metadata.status']);
    expect((await readRelationships()).relationships.find((record) => record.id === 'relationship-reg1')!.context).toBe('Atlas本番導入: 最終判断を担当');
  });

  it('refuses a stale digest with the current record and writes nothing', async () => {
    await writeGraphV2(dataDir);
    const graphBefore = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const stale = { ...EDGES.tanakaAtlas, role: '古い役割' };
    const error = await expectCorrectionError(applyGraphCorrection(dataDir, {
      kind: 'update_edge', edgeId: EDGES.tanakaAtlas.id, expectedDigest: graphRecordDigest(stale), reason: '役割を直す。', changes: { role: '別の役割' }
    }), 'conflict', 'digest_conflict');
    expect(error.current).toEqual({ recordType: 'edge', record: EDGES.tanakaAtlas, digest: graphRecordDigest(EDGES.tanakaAtlas) });
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(graphBefore);
    expect(await historyLines()).toEqual([]);

    await expectCorrectionError(applyGraphCorrection(dataDir, {
      kind: 'create_edge', reason: 'もう一度加える。', edge: { fromId: 'person-tanaka', relation: 'participates_in', toId: 'project-atlas' }
    }), 'conflict', 'edge_already_exists');
  });

  it('refuses deletes, id/type/relation changes, disallowed fields and missing reasons', async () => {
    await writeGraphV2(dataDir);
    const graphBefore = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const entity = { kind: 'update_entity', entityId: 'person-tanaka', expectedDigest: graphRecordDigest(ENTITIES.tanaka), reason: '直す。' };
    const edge = { kind: 'update_edge', edgeId: EDGES.tanakaAtlas.id, expectedDigest: graphRecordDigest(EDGES.tanakaAtlas), reason: '直す。' };
    const cases: Array<[unknown, string]> = [
      [{ kind: 'delete_entity', entityId: 'person-tanaka', reason: '消す。' }, 'correction_delete_not_allowed'],
      [{ kind: 'delete_edge', edgeId: EDGES.tanakaAtlas.id, reason: '消す。' }, 'correction_delete_not_allowed'],
      [{ ...entity, changes: { type: 'org' } }, 'correction_type_change_not_allowed'],
      [{ ...entity, changes: { id: 'person-other' } }, 'correction_id_change_not_allowed'],
      [{ ...edge, changes: { relation: 'accountable_for' } }, 'correction_relation_change_not_allowed'],
      [{ ...edge, changes: { toId: 'project-beta' } }, 'correction_endpoint_change_not_allowed'],
      [{ ...edge, changes: { validFrom: '2026-01-01T00:00:00Z' } }, 'correction_field_not_allowed'],
      [{ ...entity, changes: { tags: ['x'] } }, 'correction_field_not_allowed'],
      [{ ...entity, changes: { metadata: { goal: 'x' } } }, 'correction_field_not_allowed'],
      [{ ...entity, changes: { goal: '人には目的が無い' } }, 'correction_field_not_allowed'],
      [{ ...entity, reason: undefined, changes: { name: '田中' } }, 'correction_reason_required'],
      [{ ...entity, reason: '   ', changes: { name: '田中' } }, 'correction_reason_required'],
      [{ ...entity, reason: '一文目。\n二文目。', changes: { name: '田中' } }, 'correction_reason_invalid'],
      [{ ...entity, expectedDigest: undefined, changes: { name: '田中' } }, 'correction_digest_required'],
      [{ ...entity, changes: { name: '田中 太郎' } }, 'correction_no_change'],
      [{ ...entity, changes: { validFrom: '2026-10-01T00:00:00Z', validTo: '2026-09-01T00:00:00Z' } }, 'correction_invalid'],
      [{ kind: 'create_edge', reason: '加える。', edge: { fromId: 'decision-scope', relation: 'governs', toId: 'project-atlas' } }, 'correction_relation_not_allowed'],
      [{ kind: 'create_edge', reason: '加える。', edge: { fromId: 'person-sato', relation: 'member_of', toId: 'org-acme', provenance: { sourceKind: 'import' } } }, 'correction_field_not_allowed'],
      [{ kind: 'create_edge', reason: '加える。', edge: { fromId: 'person-sato', relation: 'member_of', toId: 'project-atlas' } }, 'correction_endpoint_type_invalid']
    ];
    for (const [input, code] of cases) {
      await expectCorrectionError(applyGraphCorrection(dataDir, input, { now: FIXTURE_NOW }), 'invalid', code);
    }
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(graphBefore);
    expect(await historyLines()).toEqual([]);
  });

  it('rolls back the Graph change together with its history line when the commit fails', async () => {
    await writeGraphV2(dataDir);
    const graphBefore = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const relationshipsBefore = await readFile(join(dataDir, 'relationships.json'), 'utf8');
    // Four canonical files are published first; failing after the fifth file
    // means the history sidecar was published in the same transaction.
    process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH = '5';
    await expect(applyGraphCorrection(dataDir, {
      kind: 'update_edge', edgeId: EDGES.tanakaAtlas.id, expectedDigest: graphRecordDigest(EDGES.tanakaAtlas), reason: '役割を直す。', changes: { role: '顧問' }
    }, { now: FIXTURE_NOW })).rejects.toThrow('Injected SSOT publish failure after 5 file(s)');
    delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(graphBefore);
    expect(await readFile(join(dataDir, 'relationships.json'), 'utf8')).toBe(relationshipsBefore);
    expect(await readGraphCorrectionHistory(dataDir)).toEqual({ records: [], issues: [] });
  });
});
