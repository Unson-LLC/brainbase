import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { getContext, searchAll } from '../src/tools.js';
import type { PersonalOs } from '../src/types.js';
import { canonicalResolutionGraph } from './canonical-resolution-fixture.js';

const dirs: string[] = [];
const asOf = '2026-08-17T00:00:00.000Z';

function v2Os(): PersonalOs {
  return {
    dataDir: '/fixture',
    graph: canonicalResolutionGraph,
    personalKg: [],
    relationships: {
      version: 1,
      relationships: [
        { id: 'legacy-tanaka', person: '田中', role: '責任者', context: 'Atlas導入を担当する' },
        { id: 'legacy-unknown', person: '未解決人物', context: '正本IDへ未移行' }
      ]
    },
    decisions: [
      { id: 'decision-user-outcome', title: '判断基準', decision: '実測と利用者成果を分ける' }
    ],
    sourceCount: 0
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Graph v2 retrieval', () => {
  it('traverses active ID edges for scoped context while preserving legacy fields additively', () => {
    const context = getContext(v2Os(), { project: 'project-atlas', asOf }) as Record<string, any>;

    expect(context.projects.map((item: { id: string }) => item.id)).toEqual(['project-atlas']);
    expect(context.relationships).toEqual(expect.any(Array));
    expect(context.canonicalGraph).toMatchObject({
      schemaVersion: 2,
      ontology: canonicalResolutionGraph.ontology,
      project: { id: 'project-atlas' },
      asOf,
      authority: 'local_graph'
    });
    expect(context.canonicalGraph.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalEntityId: 'person-tanaka-atlas', relationPath: [canonicalResolutionGraph.edges[0]!.id] }),
      expect.objectContaining({ canonicalEntityId: 'decision-user-outcome', relationPath: [canonicalResolutionGraph.edges[2]!.id] })
    ]));
  });

  it('returns canonical-first deduplicated results and treats honorifics as query aliases only', () => {
    const results = searchAll(v2Os(), '田中さん', 10, { project: 'project-atlas', asOf });

    expect(results[0]).toMatchObject({
      source: 'graph',
      id: 'person-tanaka-atlas',
      canonicalEntityId: 'person-tanaka-atlas',
      recordClass: 'canonical',
      authority: 'local_graph',
      relationPath: [canonicalResolutionGraph.edges[0]!.id]
    });
    expect(results.filter((result) => result.projectionOf === 'person-tanaka-atlas')).toHaveLength(0);
    expect(results.some((result) => result.title.includes('さん'))).toBe(false);
    expect(searchAll(v2Os(), '未解決人物', 10, { asOf })[0]).toMatchObject({
      id: 'legacy-unknown',
      recordClass: 'unresolved',
      authority: 'legacy_relationships'
    });
  });

  it('excludes expired entities and edges at as_of', () => {
    expect(searchAll(v2Os(), '田中さん', 10, {
      project: 'project-atlas',
      asOf: '2025-12-31T23:59:59.000Z'
    })).toEqual([]);
  });
});

describe('doctor Graph diagnosis', () => {
  it('reports schema, ontology and healthy edge counts separately from migration and defects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brainbase-doctor-v2-'));
    dirs.push(dir);
    await writeFile(join(dir, 'graph.json'), `${JSON.stringify(canonicalResolutionGraph)}\n`);
    await writeFile(join(dir, 'relationships.json'), '{"version":1,"relationships":[]}\n');
    await writeFile(join(dir, 'personal-kg.jsonl'), '');
    await writeFile(join(dir, 'decisions.jsonl'), '');
    const output = capture();

    expect(await runCli(['doctor', '--dir', dir], output.io)).toBe(0);
    expect(JSON.parse(output.stdout()).graphDiagnosis).toMatchObject({
      status: 'healthy',
      schemaVersion: 2,
      ontology: canonicalResolutionGraph.ontology,
      counts: { entities: 5, edges: 3, activeEdges: 3, danglingEdges: 0, invalidEdges: 0, duplicateEdges: 0, unresolvedRecords: 0, projections: 0 },
      migrationRequired: false
    });
  });

  it('does not collapse dangling, duplicate, invalid, unresolved, projection, or migration into healthy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brainbase-doctor-defects-'));
    dirs.push(dir);
    const graph = structuredClone(canonicalResolutionGraph) as any;
    graph.edges.push({ ...graph.edges[0], id: graph.edges[0].id });
    graph.edges.push({ id: 'edge-dangling', fromId: 'missing', relation: 'accountable_for', toId: 'project-atlas' });
    graph.edges.push({ id: 'edge-invalid', fromId: 'project-atlas', relation: 'accountable_for', toId: 'person-tanaka-atlas' });
    await writeFile(join(dir, 'graph.json'), `${JSON.stringify(graph)}\n`);
    await writeFile(join(dir, 'relationships.json'), JSON.stringify({ version: 1, relationships: [
      { id: 'projection', person: '田中', context: 'duplicate view' },
      { id: 'unresolved', person: '不存在', context: 'not mapped' }
    ] }));
    await writeFile(join(dir, 'personal-kg.jsonl'), '');
    await writeFile(join(dir, 'decisions.jsonl'), '');
    const output = capture();

    expect(await runCli(['doctor', '--dir', dir], output.io)).toBe(0);
    expect(JSON.parse(output.stdout()).graphDiagnosis).toMatchObject({
      status: 'issues',
      counts: { danglingEdges: 1, invalidEdges: 1, duplicateEdges: 1, unresolvedRecords: 1, projections: 1 }
    });
  });

  it('reports v1 as migration_required and malformed v2 as invalid without crashing doctor', async () => {
    const migrationDir = await mkdtemp(join(tmpdir(), 'brainbase-doctor-migration-'));
    const invalidDir = await mkdtemp(join(tmpdir(), 'brainbase-doctor-invalid-'));
    dirs.push(migrationDir, invalidDir);
    await writeFile(join(migrationDir, 'graph.json'), JSON.stringify({ version: 1, owner: {}, entities: [] }));
    await writeFile(join(invalidDir, 'graph.json'), '{"version":2,"ontology":');
    for (const dir of [migrationDir, invalidDir]) {
      await writeFile(join(dir, 'relationships.json'), '{"version":1,"relationships":[]}\n');
      await writeFile(join(dir, 'personal-kg.jsonl'), '');
      await writeFile(join(dir, 'decisions.jsonl'), '');
    }

    const migration = capture();
    expect(await runCli(['doctor', '--dir', migrationDir], migration.io)).toBe(0);
    expect(JSON.parse(migration.stdout()).graphDiagnosis).toMatchObject({
      status: 'migration_required', schemaVersion: 1, migrationRequired: true,
      issues: expect.arrayContaining([expect.objectContaining({ class: 'migration' })])
    });

    const invalid = capture();
    expect(await runCli(['doctor', '--dir', invalidDir], invalid.io)).toBe(0);
    expect(JSON.parse(invalid.stdout()).graphDiagnosis).toMatchObject({
      status: 'invalid', schemaVersion: null, migrationRequired: false,
      issues: expect.arrayContaining([expect.objectContaining({ class: 'invalid' })])
    });
  });
});

function capture(): { stdout: () => string; io: { stdout: { write: (chunk: string | Uint8Array) => boolean }; stderr: { write: () => boolean } } } {
  let out = '';
  return {
    stdout: () => out,
    io: {
      stdout: { write: (chunk) => { out += chunk.toString(); return true; } },
      stderr: { write: () => true }
    }
  };
}
