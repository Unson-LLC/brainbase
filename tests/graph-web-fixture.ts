import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalEdgeId } from '../src/canonical-graph.js';
import { canonicalGraphOntologyRelease } from '../src/templates.js';
import type { CanonicalEdge, CanonicalEntity, CoreRelation } from '../src/types.js';

/** Synthetic single-owner data. No real people or organizations. */
export const FIXTURE_NOW = new Date('2026-09-26T00:00:00.000Z');

function edge(fromId: string, relation: CoreRelation, toId: string, extra: Partial<CanonicalEdge> = {}): CanonicalEdge {
  return { id: canonicalEdgeId({ fromId, relation, toId }), fromId, relation, toId, ...extra };
}

export const ENTITIES = {
  self: { id: 'self', type: 'person', name: 'Owner', summary: 'このPersonal OSの本人。', tags: ['self'] },
  tanaka: { id: 'person-tanaka', type: 'person', name: '田中 太郎', aliases: ['Tanaka'], summary: '導入の最終判断を担当', tags: ['relationship'] },
  sato: { id: 'person-sato', type: 'person', name: '佐藤 花子', summary: '進行管理', tags: ['relationship'] },
  suzuki: { id: 'person-suzuki', type: 'person', name: '鈴木 一郎', summary: '以前の担当', validTo: '2026-01-01T00:00:00Z' },
  acme: { id: 'org-acme', type: 'org', name: 'Acme' },
  atlas: {
    id: 'project-atlas',
    type: 'project',
    name: 'Atlas導入',
    summary: 'Goal: 導入を完了する',
    tags: ['work', 'project'],
    metadata: { goal: '導入を完了する', status: '進行中', decisionPrinciples: ['小さく始める'], sources: [] }
  },
  beta: { id: 'project-beta', type: 'project', name: 'Beta検証', validTo: '2026-03-01T00:00:00Z', metadata: { status: '完了' } },
  scope: { id: 'decision-scope', type: 'decision', name: 'スコープ', summary: '小さく始める' }
} satisfies Record<string, CanonicalEntity>;

export const EDGES = {
  tanakaAtlas: edge('person-tanaka', 'participates_in', 'project-atlas', {
    role: '責任者',
    context: '最終判断を担当',
    provenance: { sourceKind: 'onboarding', sourceId: 'relationship-reg1' }
  }),
  satoAtlas: edge('person-sato', 'accountable_for', 'project-atlas', {
    role: 'PM',
    validFrom: '2026-01-01T00:00:00Z',
    provenance: { sourceKind: 'import', sourceId: 'cand-sato' }
  }),
  satoBeta: edge('person-sato', 'participates_in', 'project-beta', {
    context: '検証',
    validTo: '2026-02-01T00:00:00Z',
    provenance: { sourceKind: 'onboarding', sourceId: 'onb_cand_1' }
  }),
  tanakaAcme: edge('person-tanaka', 'member_of', 'org-acme', {
    provenance: { sourceKind: 'migration', sourceId: 'person-tanaka' }
  }),
  scopeAtlas: edge('decision-scope', 'governs', 'project-atlas', { context: '小さく始める' })
};

/** The record project registration writes for the tanaka -> atlas stakeholder. */
export const REGISTRATION_PROJECTION = {
  id: 'relationship-reg1',
  person: '田中 太郎',
  role: '責任者',
  context: 'Atlas導入: 最終判断を担当',
  tags: ['project', 'relationship'],
  updatedAt: '2026-09-01T00:00:00.000Z'
};

export async function writeGraphV2(
  dataDir: string,
  options: { entities?: CanonicalEntity[]; edges?: CanonicalEdge[]; references?: boolean } = {}
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'graph.json'), `${JSON.stringify({
    version: 2,
    ontology: canonicalGraphOntologyRelease.binding,
    owner: { id: 'self', name: 'Owner' },
    entities: options.entities ?? Object.values(ENTITIES),
    edges: options.edges ?? Object.values(EDGES)
  }, null, 2)}\n`);
  await writeFile(join(dataDir, 'relationships.json'), `${JSON.stringify({
    version: 1,
    relationships: options.entities ? [] : [REGISTRATION_PROJECTION]
  }, null, 2)}\n`);
  await writeFile(join(dataDir, 'personal-kg.jsonl'), '');
  await writeFile(join(dataDir, 'decisions.jsonl'), '');
  if (options.references === false) return;
  await mkdir(join(dataDir, 'candidates'), { recursive: true });
  await writeFile(join(dataDir, 'candidates', 'extracted-abc.json'), `${JSON.stringify({
    candidates: [{ id: 'cand-sato', kind: 'relationship', payload: { person: '佐藤 花子', projectId: 'project-atlas' } }]
  })}\n`);
  await mkdir(join(dataDir, 'runs'), { recursive: true });
  await writeFile(join(dataDir, 'runs', 'connected-onboarding.json'), `${JSON.stringify({
    schemaVersion: 'connected_onboarding.v1',
    runs: [{ id: 'run-1', candidates: [{ id: 'onb_cand_1', kind: 'relationship', reviewStatus: 'approved', payload: { person: '佐藤 花子' } }] }]
  })}\n`);
}

export async function writeGraphV1(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'graph.json'), `${JSON.stringify({
    version: 1,
    owner: { name: 'Owner' },
    entities: [
      { id: 'person-legacy', type: 'person', name: 'Legacy Person' },
      { id: 'project-legacy', type: 'project', name: 'Legacy Project' }
    ]
  }, null, 2)}\n`);
  await writeFile(join(dataDir, 'relationships.json'), `${JSON.stringify({ version: 1, relationships: [] })}\n`);
  await writeFile(join(dataDir, 'personal-kg.jsonl'), '');
  await writeFile(join(dataDir, 'decisions.jsonl'), '');
}
