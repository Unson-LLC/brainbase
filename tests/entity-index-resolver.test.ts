import { describe, it, vi } from 'vitest';
import assert from 'node:assert';
import {
  createEmptyIndex,
  resolveCanonicalActivePerson,
  resolveEntities,
  searchEntities,
} from '../src/entity-indexer.js';
import type { EntityIndex } from '../src/entity-types.js';
import type { GraphAPISource } from '../src/graph-api-source.js';
import type { EntitySource } from '../src/entity-source.js';

function seedResolverIndex(): EntityIndex {
  const index = createEmptyIndex();

  index.people.set('per_wakamatsu_fuyumi', {
    id: 'per_wakamatsu_fuyumi',
    filePath: 'graph://person/per_wakamatsu_fuyumi',
    type: 'person',
    name: '若松 冬美',
    role: '役員',
    org: '株式会社リカルド',
    org_tags: ['riccardo'],
    projects: ['techknight'],
    aliases: ['若松冬美', 'Wakamatsu Fuyumi'],
    status: 'active',
    content: 'TechKnight relation record',
  });
  index.people.set('per_mochida_sho', {
    id: 'per_mochida_sho',
    filePath: 'graph://person/per_mochida_sho',
    type: 'person',
    name: '持田 渉',
    role: '営業',
    org: '株式会社リカルド',
    org_tags: ['riccardo'],
    projects: ['senpainurse'],
    aliases: ['Sho Mochida'],
    status: 'active',
    content: '',
  });
  index.people.set('per_sato_keigo', {
    id: 'per_sato_keigo',
    filePath: 'graph://person/per_sato_keigo',
    type: 'person',
    name: '佐藤 圭吾',
    role: '代表',
    org: '合同会社雲孫',
    org_tags: ['unson'],
    projects: ['brainbase'],
    aliases: ['佐藤圭吾', 'per_sato_keigo_merged'],
    status: 'active',
    content: '',
  });
  index.people.set('per_sato_keigo_merged', {
    id: 'per_sato_keigo_merged',
    filePath: 'graph://person/per_sato_keigo_merged',
    type: 'person',
    name: '佐藤 圭吾',
    role: '代表',
    org: '合同会社雲孫',
    org_tags: ['unson'],
    projects: ['brainbase'],
    aliases: [],
    status: 'merged',
    content: '',
  });
  index.projects.set('senpainurse', {
    id: 'senpainurse',
    filePath: 'graph://project/senpainurse',
    type: 'project',
    project_id: 'senpainurse',
    name: 'senpainurse',
    status: 'active',
    team: ['per_mochida_sho'],
    orgs: ['riccardo'],
    apps: [],
    customers: [],
    content: '',
  });
  index.projects.set('brainbase', {
    id: 'brainbase',
    graph_entity_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H',
    filePath: 'graph://project/brainbase',
    type: 'project',
    project_id: 'brainbase',
    name: 'Brainbase',
    aliases: ['ブレインベース'],
    status: 'active',
    team: [], orgs: [], apps: [], customers: [], content: '',
  });
  index.extensions.set('contact', new Map([
    ['contact_sato_keigo', {
      id: 'contact_sato_keigo',
      filePath: 'graph://contact/contact_sato_keigo',
      type: 'contact',
      name: '佐藤 圭吾',
      title: '代表取締役',
      content: '',
      payload: {
        name: '佐藤 圭吾',
        company_name: '株式会社雲孫',
        department: '経営',
        title: '代表取締役',
        email: 'keigo@example.com',
        mobile: '090-0000-0001',
        exchanged_at: '2026-07-01',
      },
    }],
    ['contact_sato_hanako', {
      id: 'contact_sato_hanako',
      filePath: 'graph://contact/contact_sato_hanako',
      type: 'contact',
      name: '佐藤 花子',
      title: '部長',
      content: '',
      payload: {
        name: '佐藤 花子',
        company_name: '株式会社Example',
        department: '営業部',
        title: '部長',
        email: 'hanako@example.com',
        tel_company: '03-0000-0000',
        exchanged_at: '2025-12-10',
      },
    }],
  ]));

  return index;
}

describe('Graph entity resolver', () => {
  it('excludes merged rows and resolves an explicit legacy ID through the active canonical alias', () => {
    const index = seedResolverIndex();
    const byName = resolveEntities(index, { query: '佐藤圭吾', types: ['person'] });
    assert.deepStrictEqual(byName.candidates.map(candidate => candidate.entity_id), ['per_sato_keigo']);

    const byLegacyId = resolveEntities(index, { query: 'per_sato_keigo_merged', types: ['person'] });
    assert.deepStrictEqual(byLegacyId.candidates.map(candidate => candidate.entity_id), ['per_sato_keigo']);
  });

  it('rejects inactive canonical people and their aliases from every resolver path', () => {
    const index = seedResolverIndex();
    index.people.set('per_inactive', {
      id: 'per_inactive',
      filePath: 'graph://person/per_inactive',
      type: 'person',
      name: '休止人物',
      role: 'member',
      org: '合同会社雲孫',
      org_tags: ['unson'],
      projects: ['brainbase'],
      aliases: ['inactive-owner'],
      status: 'inactive',
      lifecycle_status: 'active',
      content: '',
    });

    assert.strictEqual(resolveCanonicalActivePerson(index, 'per_inactive'), null);
    assert.strictEqual(resolveCanonicalActivePerson(index, 'inactive-owner'), null);
    assert.deepStrictEqual(resolveEntities(index, { query: '休止人物', types: ['person'] }).candidates, []);
    assert.deepStrictEqual(searchEntities(index, 'inactive-owner'), []);
  });

  it('binds first-person expressions only to the authenticated active canonical person', () => {
    const index = seedResolverIndex();
    const unauthenticated = resolveEntities(index, { query: '俺 自分', types: ['person'] });
    assert.deepStrictEqual(unauthenticated.candidates, []);

    const authenticated = resolveEntities(index, {
      query: '俺のデータと自分の判断',
      types: ['person'],
      ownerPersonId: 'per_sato_keigo_merged',
    });
    assert.strictEqual(authenticated.candidates[0]?.entity_id, 'per_sato_keigo');
    assert.ok(authenticated.candidates[0]?.matched_fields.includes('authenticated_owner'));
  });

  it('story-graph-entity-resolver: resolves a noisy compound query by exact person name evidence', () => {
    const result = resolveEntities(seedResolverIndex(), {
      query: '若松 Lecaldo レカルド TechKnight 役員',
      types: ['person'],
    });

    assert.notStrictEqual(result.absence_verdict, 'not_in_graph');
    assert.strictEqual(result.candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(result.candidates[0]?.confidence, 'high');
    assert.ok(result.candidates[0]?.matched_terms.includes('若松'));
    assert.ok(result.candidates[0]?.matched_fields.includes('name'));
  });

  it('story-graph-entity-resolver: treats project as context instead of a strict candidate filter', () => {
    const result = resolveEntities(seedResolverIndex(), {
      query: '若松 Lecaldo レカルド TechKnight 役員',
      types: ['person'],
      project: 'brainbase',
    });

    assert.strictEqual(result.absence_verdict, 'candidates_found');
    assert.strictEqual(result.candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(result.candidates[0]?.project_code, 'techknight');
  });

  it('UX-20261001-02: resolves a project by its Graph alias without semantic fallback', () => {
    const result = resolveEntities(seedResolverIndex(), { query: 'ブレインベース', types: ['project'] });
    assert.strictEqual(result.candidates[0]?.entity_id, 'prj_01KGCS8CAJKKDWACPNK1E5WX8H');
    assert.ok(result.candidates[0]?.matched_fields.includes('aliases'));
    assert.deepStrictEqual(result.candidates[0]?.aliases, ['ブレインベース']);
  });

  it('story-graph-entity-resolver: normalizes honorifics, spaces, and romanized aliases', () => {
    const index = seedResolverIndex();

    assert.strictEqual(resolveEntities(index, { query: '若松さん', types: ['person'] }).candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(resolveEntities(index, { query: '若松冬美', types: ['person'] }).candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(resolveEntities(index, { query: 'Wakamatsu Fuyumi', types: ['person'] }).candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(resolveEntities(index, { query: '持田', types: ['person'] }).candidates[0]?.entity_id, 'per_mochida_sho');
  });

  it('story-graph-entity-resolver: reports structured-field matches instead of silent absence', () => {
    const riccardo = resolveEntities(seedResolverIndex(), {
      query: 'リカルド',
      types: ['person', 'org'],
    });

    assert.notStrictEqual(riccardo.absence_verdict, 'not_in_graph');
    assert.ok(riccardo.candidates.length > 0);
    assert.ok(riccardo.candidates.some(candidate => candidate.matched_fields.includes('org')));

    const lecaldo = resolveEntities(seedResolverIndex(), {
      query: 'Le caldo',
      types: ['person', 'org'],
    });
    assert.ok(lecaldo.candidates.some(candidate => candidate.entity_id === 'per_wakamatsu_fuyumi'));
    assert.ok(lecaldo.searched_terms.includes('リカルド'));

    const project = resolveEntities(seedResolverIndex(), {
      query: 'senpainurse',
      types: ['person', 'project'],
    });
    assert.ok(project.candidates.some(candidate => candidate.entity_id === 'senpainurse' || candidate.matched_fields.includes('projects')));
  });

  it('resolves an explicitly requested contact surname to every matching candidate', () => {
    const contactOnly = resolveEntities(seedResolverIndex(), {
      query: '佐藤さん',
      types: ['contact'],
    });

    assert.deepStrictEqual(contactOnly.unsupported_types, []);
    assert.strictEqual(contactOnly.absence_verdict, 'candidates_found');
    assert.deepStrictEqual(
      contactOnly.candidates.map(candidate => candidate.entity_id),
      ['contact_sato_hanako', 'contact_sato_keigo'],
    );
  });

  it('returns structured contact details needed to disambiguate people', () => {
    const result = resolveEntities(seedResolverIndex(), {
      query: '佐藤圭吾',
      types: ['contact'],
    });

    assert.deepStrictEqual(result.candidates[0]?.details, {
      company_name: '株式会社雲孫',
      department: '経営',
      title: '代表取締役',
      email: 'keigo@example.com',
      mobile: '090-0000-0001',
      exchanged_at: '2026-07-01',
    });
  });

  it('still reports genuinely unsupported type filters', () => {
    const mixed = resolveEntities(seedResolverIndex(), {
      query: '若松',
      types: ['unknown_type', 'person'],
    });

    assert.deepStrictEqual(mixed.unsupported_types, ['unknown_type']);
    assert.strictEqual(mixed.candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
  });


});
