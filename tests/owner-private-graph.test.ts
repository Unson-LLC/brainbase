import { describe, expect, it } from 'vitest';
import { GraphWebError, openOwnerPrivateGraph } from '../src/graph-web.js';
import { bindPortableGraphOwner, portableGraphDigest } from '../src/portable-graph.js';
import { FIXTURE_NOW } from './graph-web-fixture.js';
import {
  OWNER_NAME,
  OWNER_PERSON_ID,
  SELF_ATLAS,
  VARIABLE,
  foundationCatalog,
  objectiveDefinition,
  ownerPrivateBundle
} from './owner-private-graph-fixture.js';

const owner = { personId: OWNER_PERSON_ID, name: OWNER_NAME };
const read = { now: FIXTURE_NOW };

/** Every string anywhere in a value except tags (a tag `self` is a label, not an ID), to prove `self` is gone. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => (key === 'tags' ? [] : strings(item)));
  return [];
}

describe('bindPortableGraphOwner (handover contract §5.1)', () => {
  it('replaces self with the owner person ID wherever it names a person, and never changes the stored bundle', () => {
    const bundle = ownerPrivateBundle();
    const before = structuredClone(bundle);
    const digest = portableGraphDigest(bundle);
    const bound = bindPortableGraphOwner(bundle, owner);

    expect(bundle).toEqual(before);
    expect(portableGraphDigest(bundle)).toBe(digest);
    expect(bound.graph.owner).toEqual({ id: OWNER_PERSON_ID, name: OWNER_NAME });
    const ownerRecord = bound.graph.entities.find((entity) => entity.id === OWNER_PERSON_ID);
    expect(ownerRecord).toMatchObject({ type: 'person', name: OWNER_NAME, aliases: ['Owner'] });
    expect(bound.graph.entities.some((entity) => entity.id === 'self')).toBe(false);
    const selfEdge = bound.graph.edges.find((item) => item.id === SELF_ATLAS.id);
    // The relation keeps the ID it has in the stored bundle; its endpoint is the owner.
    expect(selfEdge).toMatchObject({ fromId: OWNER_PERSON_ID, toId: 'project-atlas' });
    const objective = bound.graph.foundation!.records.find((record) => record.definition.type === 'objective')!.definition as any;
    expect(objective.acl).toMatchObject({ ownerId: OWNER_PERSON_ID, readerIds: [OWNER_PERSON_ID], writerIds: [OWNER_PERSON_ID] });
    expect(objective.beneficiaryIds).toEqual([OWNER_PERSON_ID, 'person-tanaka']);
    expect(objective.accountableId).toBe(OWNER_PERSON_ID);
    expect(objective.scope.subjectIds).toEqual([OWNER_PERSON_ID, 'project-atlas']);
    // Free text is not an ID: the variable's subject description stays as written.
    const variable = bound.graph.foundation!.records.find((record) => record.definition.type === 'variable')!.definition as any;
    expect(variable.subject).toBe('self/focus');
    expect(variable.acl.ownerId).toBe(OWNER_PERSON_ID);
  });

  it('keeps the bundle name when the host has none, and refuses an owner ID that is missing, self, or already another record', () => {
    const bound = bindPortableGraphOwner(ownerPrivateBundle(), { personId: OWNER_PERSON_ID });
    expect(bound.graph.entities.find((entity) => entity.id === OWNER_PERSON_ID)?.name).toBe('Owner');
    for (const personId of ['', '  ', 'self', undefined]) {
      expect(() => bindPortableGraphOwner(ownerPrivateBundle(), { personId } as any)).toThrow('PORTABLE-GRAPH-OWNER');
    }
    expect(() => bindPortableGraphOwner(ownerPrivateBundle(), { personId: 'person-tanaka' })).toThrow('PORTABLE-GRAPH-OWNER-CONFLICT');
  });
});

describe('openOwnerPrivateGraph', () => {
  it('serves the local Graph read views over the bundle, labelled owner_private and read as the owner', () => {
    const graph = openOwnerPrivateGraph(ownerPrivateBundle(), owner);
    const list = graph.listProjects(read);
    expect(list.source).toEqual({ dataDir: null, graphFormat: 2, authority: 'owner_private' });
    const atlas = list.projects.find((project) => project.id === 'project-atlas')!;
    expect(atlas.people).toContainEqual({ id: OWNER_PERSON_ID, name: OWNER_NAME, accountable: true });
    const detail = graph.readProject('project-atlas', read);
    expect(detail.participants.map((item) => item.counterpart.name)).toContain(OWNER_NAME);
    // The candidate files and onboarding ledger stayed on the owner's machine.
    const tanaka = detail.participants.find((item) => item.counterpart.id === 'person-tanaka')!;
    expect(tanaka.provenance.reference).toEqual({ status: 'unresolved', sourceId: 'relationship-reg1' });
    expect(detail.history).toEqual([]);
    for (const view of [list, detail, graph.search({ now: FIXTURE_NOW }), graph.readEntity(OWNER_PERSON_ID, read)]) {
      expect(strings(view)).not.toContain('self');
    }
  });

  it('finds the owner by the host name and the bundle name, not by self', () => {
    const graph = openOwnerPrivateGraph(ownerPrivateBundle(), owner);
    expect(graph.search({ q: OWNER_NAME, now: FIXTURE_NOW }).results.map((item) => item.id)).toEqual([OWNER_PERSON_ID]);
    expect(graph.search({ q: 'Owner', now: FIXTURE_NOW }).results.map((item) => item.id)).toEqual([OWNER_PERSON_ID]);
    const bySelf = graph.search({ q: 'self', now: FIXTURE_NOW });
    expect(bySelf.results).toEqual([]);
    expect(bySelf.absenceConfirmed).toBe(true);
    expect(() => graph.readEntity('self', read)).toThrow(GraphWebError);
  });

  it('shows a decision with its judgment record from the bundle', () => {
    const graph = openOwnerPrivateGraph(ownerPrivateBundle(), owner);
    expect(graph.readEntity('decision-scope', read).decisionRecord).toEqual({
      title: 'スコープ',
      decision: '小さく始める',
      rationale: '最初の利用者の手戻りを小さくするため',
      topic: 'scope',
      effectiveAt: '2026-08-01T00:00:00.000Z',
      supersedes: []
    });
    expect(graph.readEntity('project-atlas', read)).not.toHaveProperty('decisionRecord');
  });

  it('lists the latest revision of each objective with the people it names', () => {
    const catalog = foundationCatalog([VARIABLE, objectiveDefinition('1', '古い目的'), objectiveDefinition('2')]);
    const objectives = openOwnerPrivateGraph(ownerPrivateBundle({ foundation: catalog }), owner).listObjectives();
    expect(objectives).toMatchObject({ source: { authority: 'owner_private' }, foundation: 'ok', absenceConfirmed: false });
    expect(objectives.objectives).toEqual([{
      id: 'objective-protect-focus',
      revision: '2',
      meaning: '集中時間を守る',
      desiredState: '毎週10時間以上の集中時間を守る',
      adoptionState: 'draft',
      evaluationPeriod: { from: '2026-08-01T00:00:00.000Z', until: '2026-09-30T23:59:59.000Z' },
      criteria: [{ variable: { id: 'variable-focus-hours', revision: '1', meaning: '週ごとの集中時間', unit: 'hours' }, operator: 'at_least', target: 10 }],
      accountable: { id: OWNER_PERSON_ID, name: OWNER_NAME },
      beneficiaries: [{ id: OWNER_PERSON_ID, name: OWNER_NAME }, { id: 'person-tanaka', name: '田中 太郎' }],
      visibility: 'private'
    }]);
    const none = openOwnerPrivateGraph(ownerPrivateBundle({ foundation: null }), owner).listObjectives();
    expect(none).toMatchObject({ objectives: [], foundation: 'none', absenceConfirmed: true });
  });

  it('fails only the objectives when the foundation does not pass the catalog check', () => {
    const bundle = ownerPrivateBundle();
    (bundle.graph.foundation!.records[1]!.definition as any).desiredState = '書き換えた目的';
    const graph = openOwnerPrivateGraph(bundle, owner);
    expect(graph.listProjects(read).projects.length).toBeGreaterThan(0);
    expect(() => graph.listObjectives()).toThrow(expect.objectContaining({ code: 'foundation_invalid' }));
  });

  it('refuses a bundle that is not a valid portable Graph, and an owner ID the bundle already uses', () => {
    const broken = ownerPrivateBundle() as any;
    broken.personalKg = [];
    expect(() => openOwnerPrivateGraph(broken, owner)).toThrow(expect.objectContaining({ code: 'portable_graph_invalid' }));
    expect(() => openOwnerPrivateGraph(ownerPrivateBundle(), { personId: 'org-acme' })).toThrow(expect.objectContaining({ code: 'portable_graph_owner_conflict' }));
  });
});
