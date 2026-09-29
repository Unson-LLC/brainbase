import { describe, expect, it, vi } from 'vitest';
import {
  createProjectKnowledgeWorkspace,
  normalizeProjectContext,
  projectKnowledgeEdges,
  projectKnowledgeEntities,
  projectKnowledgeUnknowns,
} from '../../ui/project-workspace.js';
import { collectText, findAll, section, FakeDocument } from './graph-ui-harness.mjs';

const project = {
  id: 'project-atlas',
  type: 'project',
  name: 'Atlas導入',
  aliases: [],
  summary: '導入を進める',
  tags: [],
  active: true,
  digest: 'sha256:project',
  goal: '導入を完了する',
  status: '進行中',
  validFrom: null,
  validTo: null,
};

const edge = (overrides = {}) => ({
  id: 'edge-person-atlas',
  relation: 'participates_in',
  meaning: '人物がプロジェクトに参加している',
  direction: 'incoming',
  fromId: 'person-a',
  toId: 'project-atlas',
  role: '進行管理',
  context: '週次の進行確認',
  active: true,
  provenance: { sourceKind: 'import', reference: { status: 'unresolved', sourceId: 'slack-1' } },
  counterpart: { id: 'person-a', type: 'person', name: '佐藤 花子', active: true, digest: 'sha256:person' },
  digest: 'sha256:edge',
  ...overrides,
});

const detail = (overrides = {}) => ({
  project,
  participants: [edge()],
  relations: [edge({
    id: 'edge-service-atlas',
    relation: 'uses_custom_service',
    meaning: 'プロジェクトが独自サービスを利用する',
    direction: 'outgoing',
    fromId: 'project-atlas',
    toId: 'service-a',
    counterpart: { id: 'service-a', type: 'service', name: '決済基盤', active: true, digest: 'sha256:service' },
  })],
  asOf: '2026-09-28T00:00:00.000Z',
  source: { authority: 'local_graph' },
  ...overrides,
});

describe('project knowledge projection', () => {
  it('keeps arbitrary entity and relation types in the accessible projection', () => {
    const result = projectKnowledgeEntities(detail({ knowledge: {
      entities: [{ id: 'doc-a', type: 'evidence_document', name: '導入計画', summary: '計画書' }],
      edges: [{ id: 'edge-doc', source: 'doc-a', target: 'project-atlas', relation: 'supports', label: '根拠' }],
    } }));
    expect(result.map((item) => [item.id, item.type])).toEqual([
      ['project-atlas', 'project'],
      ['person-a', 'person'],
      ['service-a', 'service'],
      ['doc-a', 'evidence_document'],
    ]);

    const edges = projectKnowledgeEdges(detail({ knowledge: {
      edges: [{ id: 'edge-doc', source: 'doc-a', target: 'project-atlas', relation: 'supports', label: '根拠' }],
    } }));
    expect(edges.map((item) => [item.id, item.source, item.target, item.label])).toContainEqual(['edge-doc', 'doc-a', 'project-atlas', '根拠']);
    expect(edges.find((item) => item.id === 'edge-service-atlas')).toMatchObject({
      source: 'project-atlas', target: 'service-a', label: 'uses_custom_service',
    });
  });

  it('does not turn missing decision records into a pending decision', () => {
    const unknowns = projectKnowledgeUnknowns(detail({ project: { ...project, goal: null, status: null } }));
    expect(unknowns).toContain('目的');
    expect(unknowns).toContain('状態');
    expect(unknowns.join('')).not.toContain('未決');
    expect(unknowns.join('')).not.toContain('判断待ち');
  });

  it('keeps supplementary sections explicit about unavailable and failed reads', () => {
    expect(normalizeProjectContext('project-atlas', null)).toMatchObject({ state: 'unavailable' });
    expect(normalizeProjectContext('project-atlas', { sections: [{ id: 'tasks', title: 'タスク', state: 'failed', message: '上流が停止中' }] })).toEqual({
      projectId: 'project-atlas',
      state: 'ok',
      sections: [{ id: 'tasks', title: 'タスク', state: 'failed', message: '上流が停止中', items: [] }],
    });
  });
});

const fullEntity = (overrides = {}) => ({
  id: 'person-a',
  type: 'person',
  name: '佐藤 花子',
  aliases: [],
  summary: '一覧に表示する要約',
  digest: 'sha256:person-a',
  active: true,
  ...overrides,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('project knowledge workspace lifecycle', () => {
  it('does not mount Sigma while the overview is visible and destroys a late async mount', async () => {
    const mounts = [];
    let resolveMount;
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      mountGraph: (container, options) => {
        mounts.push({ container, options });
        return new Promise((resolve) => { resolveMount = resolve; });
      },
    });

    expect(mounts).toHaveLength(0);
    workspace.setTab('graph');
    await tick();
    expect(mounts).toHaveLength(1);

    workspace.setTab('overview');
    const lateHandle = { destroy: vi.fn() };
    resolveMount(lateHandle);
    await tick();
    expect(lateHandle.destroy).toHaveBeenCalledTimes(1);
    workspace.destroy();
  });

  it('updates a partial context without resetting the active graph surface', async () => {
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      mountGraph: (_container) => ({ destroy: vi.fn(), select: vi.fn() }),
    });
    workspace.setTab('graph');
    await tick();
    const canvas = findAll(workspace.element, (node) => String(node.className).includes('bb-pkw-graph-canvas'))[0];
    const graphTab = findAll(workspace.element, (node) => node.tagName === 'BUTTON' && node.textContent === '情報を探す')[0];
    expect(graphTab.attributes['aria-selected']).toBe('true');

    workspace.setContext({
      projectId: 'project-atlas',
      state: 'ok',
      sections: [{ id: 'tasks', title: 'タスク', state: 'loading', items: [] }],
    });

    expect(findAll(workspace.element, (node) => String(node.className).includes('bb-pkw-graph-canvas'))[0]).toBe(canvas);
    expect(findAll(workspace.element, (node) => node.tagName === 'BUTTON' && node.textContent === '情報を探す')[0].attributes['aria-selected']).toBe('true');
    workspace.destroy();
  });

  it('keeps loading and failed reads renderable, then shows the fetched entity summary and metadata', async () => {
    let resolveRead;
    const readEntity = vi.fn(() => new Promise((resolve) => { resolveRead = resolve; }));
    const workspace = createProjectKnowledgeWorkspace({ document: new FakeDocument(), detail: detail(), readEntity });
    workspace.setTab('graph');
    workspace.select('person-a');

    expect(collectText(section(workspace.element, '選択した記録'))).toContain('読み込み中');
    resolveRead({
      state: 'ok',
      payload: {
        entity: fullEntity({ summary: '詳細取得で更新された要約', metadata: { team: '導入チーム', active: true } }),
        incoming: [],
        outgoing: [],
        asOf: '2026-09-28T01:00:00.000Z',
      },
    });
    await tick();
    const selected = section(workspace.element, '選択した記録');
    expect(collectText(selected)).toContain('詳細取得で更新された要約');
    expect(collectText(selected)).toContain('導入チーム');
    expect(readEntity).toHaveBeenCalledWith('person-a');
    workspace.destroy();
  });

  it('lets overview records enter the graph and traverses fetched counterpart edges', async () => {
    const fetched = new Map([
      ['person-a', {
        state: 'ok',
        payload: {
          entity: fullEntity({ summary: '人物の詳細' }),
          incoming: [{
            id: 'edge-person-b', relation: 'member_of', direction: 'incoming', digest: 'sha256:edge-b',
            counterpart: { id: 'person-b', type: 'person', name: '鈴木 次郎', aliases: [], digest: 'sha256:person-b' },
            provenance: { sourceKind: 'import', reference: { status: 'resolved', sourceId: 'people.json' } },
          }],
          outgoing: [],
          asOf: '2026-09-28T01:00:00.000Z',
        },
      }],
      ['person-b', { state: 'failed', message: '詳細の読み取り失敗' }],
    ]);
    const mounts = [];
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      mountGraph: (_container, options) => {
        mounts.push(options);
        return { destroy: vi.fn(), select: vi.fn() };
      },
      readEntity: async (id) => fetched.get(id),
    });

    const overviewPerson = findAll(workspace.element, (node) => node.tagName === 'BUTTON' && node.textContent === '佐藤 花子')[0];
    expect(overviewPerson).toBeDefined();
    overviewPerson.dispatch('click');
    await tick();
    await tick();
    expect(collectText(section(workspace.element, '選択した記録'))).toContain('人物の詳細');
    expect(mounts.at(-1).edges).toContainEqual(expect.objectContaining({ id: 'edge-person-b', source: 'person-b', target: 'person-a' }));

    const counterpart = findAll(workspace.element, (node) => node.tagName === 'BUTTON' && node.textContent === '鈴木 次郎')[0];
    expect(counterpart).toBeDefined();
    counterpart.dispatch('click');
    await tick();
    await tick();
    expect(collectText(section(workspace.element, '選択した記録'))).toContain('詳細の読み取り失敗');
    workspace.destroy();
  });

  it('keeps fetched neighboring decisions out of the project overview', async () => {
    const projectDetail = detail({
      knowledge: {
        entities: [{
          id: 'decision-atlas',
          type: 'decision',
          name: 'Atlasの判断',
          summary: 'このプロジェクトに結びついた判断',
          digest: 'sha256:decision-atlas',
        }],
        edges: [{
          id: 'edge-decision-atlas',
          source: 'decision-atlas',
          target: 'project-atlas',
          relation: 'decides',
          label: '方針を決める',
        }],
      },
    });
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: projectDetail,
      readEntity: async (id) => {
        if (id !== 'person-a') return { state: 'failed', message: '詳細の読み取り失敗' };
        return {
          state: 'ok',
          payload: {
            entity: fullEntity({ summary: '人物の詳細' }),
            incoming: [{
              id: 'edge-unrelated-decision',
              relation: 'owned_by',
              direction: 'incoming',
              digest: 'sha256:edge-unrelated-decision',
              counterpart: {
                id: 'decision-ncom',
                type: 'decision',
                name: 'NCOMの判断',
                summary: '別プロジェクトの判断',
                digest: 'sha256:decision-ncom',
              },
            }],
            outgoing: [],
            asOf: '2026-09-28T01:00:00.000Z',
          },
        };
      },
    });

    const overviewPerson = findAll(workspace.element, (node) => node.tagName === 'BUTTON' && node.textContent === '佐藤 花子')[0];
    overviewPerson.dispatch('click');
    await tick();
    await tick();

    workspace.setTab('overview');
    const decisions = section(workspace.element, '記録された判断');
    expect(collectText(decisions)).toContain('Atlasの判断');
    expect(collectText(decisions)).not.toContain('NCOMの判断');
    workspace.destroy();
  });

  it('filters the graph record list by text and preserves custom entity types', () => {
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail({ knowledge: {
        entities: [{ id: 'doc-a', type: 'evidence_document', name: '導入計画書', summary: '移行の根拠' }],
      } }),
    });
    workspace.setTab('graph');
    const items = () => findAll(workspace.element, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-pkw-graph-item'));
    expect(items().map((item) => collectText(item))).toEqual(expect.arrayContaining(['Atlas導入プロジェクト', '導入計画書evidence_document']));

    const search = findAll(workspace.element, (node) => node.tagName === 'INPUT' && node.attributes.type === 'search')[0];
    search.value = '計画';
    search.dispatch('input');
    expect(items().map((item) => collectText(item))).toEqual(['導入計画書evidence_document']);

    const type = findAll(workspace.element, (node) => node.tagName === 'SELECT')[0];
    expect(type.children.map((option) => option.attributes.value)).toContain('evidence_document');
    type.value = 'evidence_document';
    type.dispatch('change');
    expect(items().map((item) => collectText(item))).toEqual(['導入計画書evidence_document']);
    workspace.destroy();
  });
});
