import { describe, expect, it, vi } from 'vitest';
import {
  createProjectKnowledgeWorkspace,
  normalizeProjectContext,
  renderProjectContext,
  projectKnowledgeEdges,
  projectKnowledgeEntities,
  projectKnowledgeUnknowns,
} from '../../ui/project-workspace.js';
import { buttonsNamed, collectText, control, findAll, section, FakeDocument } from './graph-ui-harness.mjs';

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
  it('shows task context as compact rows while keeping other records detailed', () => {
    const context = normalizeProjectContext('project-atlas', { sections: [
      { id: 'tasks', title: 'タスク', state: 'ok', items: [{
        id: 'task-1', title: '導入確認', kind: 'task', status: '確認待ち', statusKind: 'wait',
        owner: '佐藤 花子', dueAt: '2026-09-30T00:00:00.000Z', summary: '一覧には長い説明を出さない',
        updatedAt: '2026-09-29', source: 'Slack',
      }] },
      { id: 'knowledge', title: '知識', state: 'ok', items: [{ id: 'record-1', title: '手順書', summary: '詳細を表示する' }] },
    ] });
    const onTaskOpen = vi.fn();
    const root = renderProjectContext(new FakeDocument(), context, { onTaskOpen });
    const task = section(root, 'タスク');
    const row = findAll(task, (node) => node.className === 'bb-pkw-context-task-row')[0];
    expect(row).toBeDefined();
    expect(collectText(row)).toContain('導入確認');
    expect(collectText(row)).toContain('佐藤 花子');
    expect(collectText(row)).toContain('9/30');
    expect(collectText(row)).toContain('確認待ち');
    expect(collectText(row)).not.toContain('一覧には長い説明を出さない');
    expect(collectText(row)).not.toContain('Slack');
    expect(findAll(row, (node) => node.className.includes('bb-pkw-context-task-wait'))).toHaveLength(2);
    buttonsNamed(row, '導入確認')[0].dispatch('click');
    expect(onTaskOpen).toHaveBeenCalledWith('task-1');
    expect(collectText(section(root, '知識'))).toContain('詳細を表示する');
  });

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

  it('preserves a pending section in a bare progress snapshot', () => {
    expect(normalizeProjectContext('project-atlas', {
      sections: [
        { id: 'tasks', title: 'タスク', state: 'ok', items: [{ id: 'task-1', title: '確認' }] },
        { id: 'knowledge', title: '知識', state: 'loading', items: [] },
      ],
    })).toMatchObject({ projectId: 'project-atlas', state: 'loading' });
  });

  it('preserves detail identifiers and unknown state without inventing a zero', () => {
    const result = normalizeProjectContext('project-atlas', {
      state: 'ok',
      sections: [{
        id: 'tasks',
        title: '仕事',
        state: 'unknown',
        total: 38,
        items: [{
          id: 'task-1',
          title: '導入確認',
          body: '関係者に確認する',
          sourceRecordId: 'record-1',
          unknowns: ['期限'],
        }],
      }],
    });

    expect(result.sections[0]).toMatchObject({ state: 'unknown', total: 38 });
    expect(result.sections[0].items[0]).toMatchObject({
      id: 'task-1',
      body: '関係者に確認する',
      sourceRecordId: 'record-1',
      unknowns: ['期限'],
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
  it('binds the loaded workspace to its project for first-data metrics', () => {
    const workspace = createProjectKnowledgeWorkspace({ document: new FakeDocument(), detail: detail() });

    expect(workspace.element.attributes['data-project-id']).toBe('project-atlas');
    workspace.destroy();
  });

  it('uses an optional host overview projection before the existing context directory', () => {
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail({
        overview: {
          about: { definition: '正本の定義', owner: '責任者', finalApprover: '最終決裁', goal: '確認する' },
          checks: [{ id: 'check-1', title: '正本を確認', recordId: 'record-1' }],
          directMaterials: { state: 'ok', total: 1, items: [{ id: 'doc-1', title: '直接資料', bodyState: 'retrieved' }] },
          relatedMaterials: { state: 'ok', total: 0, items: [] },
        },
      }),
      context: { projectId: 'project-atlas', state: 'ok', sections: [{ id: 'tasks', title: '仕事', state: 'ok', items: [] }] },
    });
    const overview = findAll(workspace.element, (node) => String(node.className).split(' ').includes('bb-pkw-overview'))[0];
    const sections = findAll(overview, (node) => node.tagName === 'SECTION').map((node) => node.attributes['aria-label']);
    expect(sections.slice(0, 5)).toEqual([
      'このプロジェクトについて',
      '次に確認すること',
      'Atlas導入に直接紐づく資料',
      '関連資料',
      '項目別の一覧',
    ]);
    expect(findAll(overview, (node) => node.tagName === 'SECTION' && node.attributes['aria-label'] === '目的と現在地')).toHaveLength(0);
    workspace.destroy();
  });

  it('loads an overview-only material through Graph detail without inventing an edge', async () => {
    const mounts = [];
    const readEntity = vi.fn(async (id) => ({
      state: 'ok',
      payload: {
        entity: fullEntity({ id, type: 'evidence_document', name: '戦略資料', summary: '戦略資料の詳細' }),
        incoming: [],
        outgoing: [],
        asOf: '2026-10-01T00:00:00.000Z',
      },
    }));
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail({
        participants: [],
        relations: [],
        overview: {
          directMaterials: { state: 'ok', total: 1, items: [{ id: 'doc-strategy', title: '戦略資料', bodyState: 'retrieved' }] },
          relatedMaterials: { state: 'ok', total: 0, items: [] },
        },
      }),
      mountGraph: (_container, options) => {
        mounts.push(options);
        return { destroy: vi.fn(), select: vi.fn() };
      },
      readEntity,
    });

    buttonsNamed(workspace.element, '戦略資料')[0].dispatch('click');
    await tick();
    await tick();
    await tick();

    expect(readEntity).toHaveBeenCalledWith('doc-strategy');
    expect(collectText(section(workspace.element, '選択した記録'))).toContain('戦略資料の詳細');
    expect(mounts.at(-1)?.edges).toEqual([]);
    workspace.destroy();
  });

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
      sections: [{ id: 'tasks', title: 'タスク', state: 'ok', items: [{ id: 'task-1', title: '導入確認' }] }],
    });

    expect(findAll(workspace.element, (node) => String(node.className).includes('bb-pkw-graph-canvas'))[0]).toBe(canvas);
    expect(findAll(workspace.element, (node) => node.tagName === 'BUTTON' && node.textContent === '情報を探す')[0].attributes['aria-selected']).toBe('true');
    workspace.setTab('overview');
    const overview = findAll(workspace.element, (node) => String(node.className).split(' ').includes('bb-pkw-overview'))[0];
    expect(collectText(section(overview, '項目別の一覧'))).toContain('1件取得済み');
    expect(collectText(overview)).not.toContain('導入確認');
    workspace.destroy();
  });

  it('shows category counts without expanding every record on the overview', () => {
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      context: {
        projectId: 'project-atlas',
        state: 'ok',
        sections: [{
          id: 'tasks',
          title: 'タスク',
          state: 'ok',
          items: [{ id: 'task-1', title: '導入確認', summary: '最初に確認する作業' }],
        }],
      },
    });

    const overview = findAll(workspace.element, (node) => String(node.className).split(' ').includes('bb-pkw-overview'))[0];
    const directory = section(overview, '項目別の一覧');
    expect(directory).toBeDefined();
    expect(collectText(directory)).toContain('タスク1件取得済み');
    expect(collectText(directory)).toContain('総数未確認');
    expect(collectText(directory)).toContain('判断件数未確認未接続');
    expect(collectText(overview)).not.toContain('最初に確認する作業');
    workspace.destroy();
  });

  it('routes from the dense overview to work and record details by canonical IDs', () => {
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      context: {
        projectId: 'project-atlas',
        state: 'ok',
        sections: [
          {
            id: 'tasks',
            title: '仕事',
            state: 'ok',
            total: 38,
            items: [{
              id: 'task-1',
              title: '導入確認',
              status: '進行中',
              owner: '佐藤 花子',
              sourceRecordId: 'record-1',
              summary: '最初に確認する作業',
            }],
          },
          {
            id: 'records',
            title: '記録',
            state: 'ok',
            items: [{
              id: 'record-1',
              title: '導入会議メモ',
              kind: 'record',
              summary: '決まったこと',
              updatedAt: '2026-09-28T01:00:00.000Z',
            }],
          },
        ],
      },
    });

    buttonsNamed(workspace.element, 'すべて見る')[0].dispatch('click');
    expect(section(workspace.element, '仕事一覧')).toBeDefined();
    expect(collectText(section(workspace.element, '仕事一覧'))).toContain('導入確認');

    buttonsNamed(workspace.element, '導入確認')[0].dispatch('click');
    const workDetail = section(workspace.element, '仕事詳細');
    expect(workDetail).toBeDefined();
    expect(collectText(workDetail)).toContain('関連記録');
    expect(collectText(workDetail)).toContain('record-1');

    buttonsNamed(workDetail, 'record-1')[0].dispatch('click');
    const recordDetail = section(workspace.element, '記録詳細');
    expect(recordDetail).toBeDefined();
    expect(collectText(recordDetail)).toContain('導入会議メモ');
    expect(collectText(recordDetail)).toContain('関連する仕事');

    buttonsNamed(recordDetail, '導入確認')[0].dispatch('click');
    expect(section(workspace.element, '仕事詳細')).toBeDefined();
    workspace.destroy();
  });

  it('opens separate category lists, pages through records, and returns from a detail', () => {
    const records = Array.from({ length: 21 }, (_, index) => ({
      id: `decision-${index + 1}`,
      title: `判断 ${index + 1}`,
      status: index === 20 ? '確定' : '検討中',
      summary: `判断の要点 ${index + 1}`,
    }));
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      context: { projectId: 'project-atlas', state: 'ok', sections: [
        { id: 'tasks', title: 'タスク', state: 'ok', total: 0, items: [] },
        { id: 'decisions', title: '判断', state: 'ok', total: 30, items: records },
        { id: 'knowledge', title: '知識', state: 'ok', items: [{ id: 'knowledge-1', title: '手順書' }] },
        { id: 'glossary', title: '用語集', state: 'failed', message: '読取失敗', items: [] },
      ] },
    });
    const overview = findAll(workspace.element, (node) => String(node.className).split(' ').includes('bb-pkw-overview'))[0];
    expect(collectText(section(overview, '項目別の一覧'))).toContain('30件 · 21件取得済み · 続き未取得');
    expect(collectText(section(overview, '項目別の一覧'))).toContain('タスク0件 · 0件取得済み該当項目なし');
    expect(collectText(section(overview, '項目別の一覧'))).toContain('用語集件数未確認読み取り失敗');
    expect(collectText(overview)).not.toContain('判断 21');
    buttonsNamed(overview, '一覧を見る')[1].dispatch('click');
    const list = section(workspace.element, '判断一覧');
    const rows = () => findAll(list, (node) => node.tagName === 'LI' && String(node.className).includes('bb-pkw-dense-item'));
    expect(rows()).toHaveLength(16);
    expect(collectText(list)).toContain('表示 1–16件');
    expect(collectText(list)).toContain('総数 30件（続き未取得）');
    expect(collectText(rows()[0])).not.toContain('判断の要点 1');
    buttonsNamed(list, '次へ')[0].dispatch('click');
    expect(rows()).toHaveLength(5);
    expect(collectText(list)).toContain('表示 17–21件');
    buttonsNamed(list, '判断 21')[0].dispatch('click');
    const detailPanel = section(workspace.element, '記録詳細');
    expect(collectText(detailPanel)).toContain('判断の要点 21');
    buttonsNamed(detailPanel, '← 判断一覧')[0].dispatch('click');
    const returnedList = section(workspace.element, '判断一覧');
    expect(returnedList).toBeDefined();
    expect(collectText(returnedList)).toContain('表示 17–21件');
    expect(findAll(returnedList, (node) => node.tagName === 'LI' && String(node.className).includes('bb-pkw-dense-item'))).toHaveLength(5);
    workspace.destroy();
  });

  it('filters dense work rows by owner and due state, then caps the first page', () => {
    const items = Array.from({ length: 18 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `導入確認 ${index + 1}`,
      owner: index === 17 ? '鈴木 次郎' : '佐藤 花子',
      dueAt: index % 2 === 0 ? '2026-09-30T00:00:00.000Z' : null,
    }));
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      context: {
        projectId: 'project-atlas',
        state: 'ok',
        sections: [{ id: 'tasks', title: '仕事', state: 'ok', total: 18, items }],
      },
    });
    buttonsNamed(workspace.element, 'すべて見る')[0].dispatch('click');
    const rows = () => findAll(workspace.element, (node) => node.tagName === 'DIV' && node.attributes.role === 'listitem' && String(node.className).includes('bb-pkw-work-row'));
    expect(rows()).toHaveLength(16);
    expect(collectText(workspace.element)).toContain('表示 1–16件');
    buttonsNamed(workspace.element, '次へ')[0].dispatch('click');
    expect(rows()).toHaveLength(2);
    expect(collectText(workspace.element)).toContain('表示 17–18件');
    expect(collectText(rows()[1])).toContain('導入確認 18');

    const owner = control(workspace.element, 'work-owner');
    owner.value = '鈴木 次郎';
    owner.dispatch('change');
    expect(rows()).toHaveLength(1);

    const due = control(workspace.element, 'work-due');
    due.value = 'missing';
    due.dispatch('change');
    expect(rows()).toHaveLength(1);
    expect(collectText(rows()[0])).toContain('導入確認 18');
    workspace.destroy();
  });

  it('keeps the search focused when more context arrives', () => {
    class FocusDocument extends FakeDocument {
      createElement(tagName) {
        const element = super.createElement(tagName);
        element.getAttribute = (name) => element.attributes[name] ?? null;
        element.contains = (target) => findAll(element, (node) => node === target).length > 0;
        element.closest = (selector) => {
          for (let node = element; node; node = node.parentNode) {
            if (selector === '.bb-pkw-work-controls' && String(node.className).split(' ').includes('bb-pkw-work-controls')) return node;
          }
          return null;
        };
        element.querySelector = (selector) => {
          const name = /^\[name="([^"]+)"\]$/.exec(selector)?.[1];
          return name ? findAll(element, (node) => node.attributes.name === name)[0] : null;
        };
        element.focus = () => { this.activeElement = element; };
        element.setSelectionRange = (start, end) => { element.selectionStart = start; element.selectionEnd = end; };
        return element;
      }
    }
    const document = new FocusDocument();
    const context = { projectId: 'project-atlas', state: 'ok', sections: [{
      id: 'tasks', title: 'タスク', state: 'ok', items: [{ id: 'task-1', title: '導入確認' }],
    }] };
    const workspace = createProjectKnowledgeWorkspace({ document, detail: detail(), context });
    buttonsNamed(workspace.element, 'すべて見る')[0].dispatch('click');
    const search = control(workspace.element, 'work-search');
    search.value = '導入';
    search.dispatch('input');
    search.focus();
    search.setSelectionRange(2, 2);

    workspace.setContext({ ...context, sections: [{ ...context.sections[0], items: [
      ...context.sections[0].items,
      { id: 'task-2', title: '導入準備' },
    ] }] });

    const nextSearch = control(workspace.element, 'work-search');
    expect(nextSearch).not.toBe(search);
    expect(nextSearch.value).toBe('導入');
    expect(document.activeElement).toBe(nextSearch);
    expect([nextSearch.selectionStart, nextSearch.selectionEnd]).toEqual([2, 2]);
    expect(collectText(section(workspace.element, '仕事一覧'))).toContain('条件一致 2件');
    workspace.destroy();
  });

  it('shows an unknown context state on the dense overview without treating it as zero', () => {
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      context: {
        projectId: 'project-atlas',
        state: 'unknown',
        message: '補足データの取得時点を確認できません。',
        sections: [],
      },
    });

    const overview = findAll(workspace.element, (node) => String(node.className).split(' ').includes('bb-pkw-overview'))[0];
    const text = collectText(overview);
    expect(text).toContain('未確認');
    expect(text).toContain('補足データの取得時点を確認できません。');
    expect(text).not.toContain('仕事0件');
    workspace.destroy();
  });

  it('distinguishes a missing task section from a confirmed empty task section in today actions', () => {
    const document = new FakeDocument();
    const context = { projectId: 'project-atlas', state: 'ok', sections: [] };
    const workspace = createProjectKnowledgeWorkspace({ document, detail: detail(), context });

    let today = collectText(section(workspace.element, '今日判断・対応すること'));
    expect(today).toContain('未確認');
    expect(today).not.toContain('表示できる仕事はありません。');

    workspace.setContext({ ...context, sections: [{
      id: 'tasks', title: 'タスク', state: 'ok', items: [],
    }] });
    today = collectText(section(workspace.element, '今日判断・対応すること'));
    expect(today).toContain('表示できる仕事はありません。');
    expect(today).not.toContain('タスクを読み取れませんでした。');
    workspace.destroy();
  });

  it('limits today actions to due or confirmation work', () => {
    const workspace = createProjectKnowledgeWorkspace({
      document: new FakeDocument(),
      detail: detail(),
      context: { projectId: 'project-atlas', state: 'ok', sections: [{
        id: 'tasks', title: '仕事', state: 'ok', items: [
          { id: 'due', title: '期限超過の仕事', status: '進行中', dueAt: '2020-01-01' },
          { id: 'waiting', title: '確認待ちの仕事', status: '確認待ち' },
          { id: 'future', title: '将来の仕事', status: '未着手', dueAt: '2099-01-01' },
          { id: 'cancelled', title: '取消済みの仕事', status: '取消済み', dueAt: '2020-01-01' },
        ],
      }] },
    });
    const today = section(workspace.element, '今日判断・対応すること');
    const text = collectText(today);
    expect(text).toContain('期限超過の仕事');
    expect(text).toContain('確認待ちの仕事');
    expect(text).not.toContain('将来の仕事');
    expect(text).not.toContain('取消済みの仕事');
    expect(collectText(workspace.element)).toContain('4件表示');
    expect(collectText(workspace.element)).toContain('総数は未確認');
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
    expect(collectText(section(workspace.element, '関係者'))).toContain('役割: 進行管理');
    expect(collectText(section(workspace.element, '関係者'))).toContain('文脈: 週次の進行確認');
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

    workspace.setTab('graph');
    workspace.select('person-a');
    await tick();
    await tick();

    workspace.setTab('overview');
    const overview = findAll(workspace.element, (node) => String(node.className).split(' ').includes('bb-pkw-overview'))[0];
    expect(overview).toBeDefined();
    expect(collectText(overview)).not.toContain('NCOMの判断');
    expect(findAll(overview, (node) => String(node.className).includes('bb-pkw-dense-record-list'))[0].children).toHaveLength(2);
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
