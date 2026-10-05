import { describe, expect, it } from 'vitest';
import { projectOrganizationGraph, projectVocabularyTerms } from '../src/organization-graph-web.js';

const entity = (id: string, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, entity_type: type, lifecycle_status: 'active', payload, ...extra
});
const edge = (id: string, from: string, rel: string, to: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id, from_id: from, to_id: to, rel_type: rel, lifecycle_status: 'active', payload, ...extra
});

const records = {
  entities: {
    project: [
      entity('prj_atlas', 'project', { name: 'Atlas', purpose: '研修', status: 'active' }, { project_code: 'atlas' }),
      entity('prj_old', 'project', { name: 'Old Product' }, { lifecycle_status: 'retired' })
    ],
    person: [entity('per_owner', 'person', { name: '山田 太郎', aliases: ['山田'] }), entity('per_a', 'person', { name: '鈴木' })],
    org: [entity('acme', 'org', { name: '例示組織' })],
    decision: [entity('dec_1', 'decision', { title: '研修は月1' })],
    raci_assignment: [
      entity('rac_final', 'raci_assignment', { role_code: 'decision:最終決裁' }, { project_id: 'prj_atlas' }),
      entity('rac_r', 'raci_assignment', { role_code: 'responsible' }, { project_id: 'prj_atlas' })
    ]
  },
  memberOf: [
    edge('e1', 'per_owner', 'member_of', 'prj_atlas', { role_code: 'decision:最終決裁' }),
    edge('e2', 'per_a', 'member_of', 'prj_atlas'),
    edge('e3', 'per_a', 'member_of', 'prj_old')
  ],
  assignedTo: [edge('e4', 'rac_final', 'assigned_to', 'per_owner'), edge('e5', 'rac_r', 'assigned_to', 'per_a')]
};

describe('organization Graph projects placed for the world', () => {
  it('writes each project\'s code, its catalog parent and its repositories, as the organization Graph states them', () => {
    const projected = projectOrganizationGraph({
      entities: {
        project: [
          entity('prj_atlas', 'project', { name: 'Atlas', code: 'atlas', kind: 'internal', repository_roots: [{ repository: 'atlas-app' }, { repository: '' }] }, { project_code: 'atlas' }),
          entity('eng_training', 'project', { name: '研修案件' }, { project_code: 'atlas' }),
          entity('eng_orphan', 'project', { name: '行き先なし' }, { project_code: 'no-such' }),
          entity('prj_plain', 'project', { name: 'Plain' }),
          entity('mana', 'project', { name: 'mana', kind: 'product' }, { project_code: 'mana' }),
          entity('eng_mana_pilot', 'project', { name: 'mana試行', code: 'mana-pilot' }, { project_code: 'mana' })
        ],
        person: [], org: [], decision: [], raci_assignment: []
      },
      memberOf: [],
      assignedTo: []
    }).graph;
    const metadata = (id: string) => projected.entities.find((item) => item.id === id)?.metadata;
    expect(metadata('prj_atlas')).toMatchObject({ code: 'atlas', kind: 'internal', repositories: ['atlas-app'] });
    expect(metadata('prj_atlas')).not.toHaveProperty('parent_project_id');
    expect(metadata('eng_training')).toMatchObject({ parent_project_code: 'atlas', parent_project_id: 'prj_atlas' });
    expect(metadata('eng_orphan')).toMatchObject({ parent_project_code: 'no-such' });
    expect(metadata('eng_orphan')).not.toHaveProperty('parent_project_id');
    expect(metadata('prj_plain')).not.toHaveProperty('parent_project_code');
    // A project whose id is its scope's code is that scope's project too.
    expect(metadata('mana')).toMatchObject({ code: 'mana' });
    expect(metadata('mana')).not.toHaveProperty('parent_project_code');
    expect(metadata('eng_mana_pilot')).toMatchObject({ code: 'mana-pilot', parent_project_id: 'mana' });
  });
});

describe('organization terms that name field values', () => {
  it('reads active glossary terms with a vocabulary as names and meanings of field values', () => {
    const terms = projectVocabularyTerms([
      entity('gls_kind_product', 'glossary_term', { label: 'プロダクト', term: 'Product', definition: '自社の提供物', vocabulary: { field: 'project.kind', value: 'product' } }),
      entity('gls_kind_lab', 'glossary_term', { term: '研究所', vocabulary: { field: 'project.kind', value: 'lab' } }),
      entity('gls_kind_bare', 'glossary_term', { vocabulary: { field: 'project.kind', value: 'bare' } }),
      entity('gls_plain', 'glossary_term', { term: 'Graph SSOT', definition: '正本' }),
      entity('gls_retired', 'glossary_term', { label: '旧', vocabulary: { field: 'project.kind', value: 'old' } }, { lifecycle_status: 'retired' }),
      entity('gls_partial', 'glossary_term', { label: '片方', vocabulary: { field: 'project.kind' } }),
    ]);
    expect(terms).toEqual([
      { id: 'gls_kind_bare', field: 'project.kind', value: 'bare', label: 'bare', definition: null },
      { id: 'gls_kind_lab', field: 'project.kind', value: 'lab', label: '研究所', definition: null },
      { id: 'gls_kind_product', field: 'project.kind', value: 'product', label: 'プロダクト', definition: '自社の提供物' },
    ]);
  });
});

describe('organization Graph records projected into a Graph v2', () => {
  it('turns stated memberships and RACI into participation and accountability', () => {
    const { graph, excluded } = projectOrganizationGraph(records);
    expect(excluded).toEqual({ inactive: 1, unnamed: 0, danglingRelations: 1 });
    expect(graph.entities.find((item) => item.id === 'prj_atlas')).toMatchObject({ type: 'project', name: 'Atlas', metadata: expect.objectContaining({ goal: '研修', status: 'active' }) });
    expect(graph.edges.filter((item) => item.fromId === 'per_owner' && item.toId === 'prj_atlas').map((item) => item.relation)).toContain('accountable_for');
    const member = graph.edges.filter((item) => item.fromId === 'per_a');
    // The same person, relation and project become one relation with both role names.
    expect(member).toEqual([expect.objectContaining({ relation: 'participates_in', role: 'responsible' })]);
  });
});
