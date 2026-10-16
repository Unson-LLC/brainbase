import { afterEach, describe, expect, it } from 'vitest';

import {
  createKnowledgeOutcomeController,
  createKnowledgeOverviewController,
  knowledgeItemHeading,
  knowledgeItemProjectLabel,
  normalizeKnowledgeCollection,
  renderKnowledgeList,
} from '../../ui/outcome-knowledge.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
  }

  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'value') this.value = String(value);
  }

  addEventListener(name, callback) { this.listeners.set(name, callback); }

  dispatch(name, event = {}) { this.listeners.get(name)?.({ preventDefault() {}, target: this, ...event }); }

  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
}

function collectText(node) {
  if (!node) return '';
  return `${node.textContent ?? ''}${(node.children ?? []).map(collectText).join('')}`;
}

function findAll(node, predicate) {
  const found = [];
  if (predicate(node)) found.push(node);
  for (const child of node?.children ?? []) found.push(...findAll(child, predicate));
  return found;
}

const byClass = (name) => (node) => String(node?.className ?? '').split(/\s+/).includes(name);
const byTag = (tag) => (node) => node?.tagName === tag.toUpperCase();

async function settle() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

const previousDocument = globalThis.document;
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

const organizationList = {
  state: 'results',
  records: [
    { id: 'decision-1', type: 'decision', project_code: 'baao', title: 'Growinの提案方針', scope: 'project', lifecycle: { status: 'active' } },
    { id: 'doc-1', type: 'document', project_code: 'brainbase', title: null, summary: '\n  知識の画面は組織全体を既定にする\n詳細', scope: 'project', lifecycle: { status: 'active' } },
    { id: 'shared-1', type: 'decision', project_code: 'unson', title: null, summary: null, scope: 'organization', lifecycle: { status: 'active' } },
  ],
  searched_scope: ['baao', 'brainbase', 'unson'],
  truncated: true,
};

describe('organization-wide knowledge list', () => {
  it('uses the record body for a missing title and never invents a heading', () => {
    expect(knowledgeItemHeading({ title: '  方針  ' })).toBe('方針');
    expect(knowledgeItemHeading({ title: '', summary: '\n\n  一行目\n二行目' })).toBe('一行目');
    expect(knowledgeItemHeading({ summary: null, content: 'あ'.repeat(90) })).toBe(`${'あ'.repeat(80)}…`);
    expect(knowledgeItemHeading({})).toBe('タイトル未確認');
  });

  it('labels each record with its project, and organization-wide records as such', () => {
    expect(knowledgeItemProjectLabel({ scope: 'organization', project_code: 'unson' })).toBe('組織共通');
    expect(knowledgeItemProjectLabel({ scope: 'project', project_code: 'baao' }, (code) => (code === 'baao' ? 'BAAO' : null))).toBe('BAAO');
    expect(knowledgeItemProjectLabel({ scope: 'project', project_code: 'zeims' })).toBe('zeims');
    expect(knowledgeItemProjectLabel({ scope: 'project' })).toBe('プロジェクト未確認');
  });

  it('shows the project of each row, the cap, and keeps the project list free of a scope chip', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderKnowledgeList(root, normalizeKnowledgeCollection(organizationList), { showProject: true, scopeText: () => '読んだ範囲: 3件' });
    const projects = findAll(root, byClass('knowledge-row-project')).map((node) => node.textContent);
    expect(projects).toEqual(['baao', 'brainbase', '組織共通']);
    expect(findAll(root, byClass('knowledge-row-scope'))).toHaveLength(0);
    const titles = findAll(root, byClass('knowledge-row-title')).map((node) => node.textContent);
    expect(titles).toEqual(['Growinの提案方針', '知識の画面は組織全体を既定にする', 'タイトル未確認']);
    const text = collectText(root);
    expect(text).toContain('3件（新しい順の上限まで）');
    expect(text).toContain('読んだ範囲: 3件');
  });

  it('keeps the single project list unchanged when no project option is passed', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    renderKnowledgeList(root, normalizeKnowledgeCollection({ ...organizationList, truncated: false }), {});
    expect(findAll(root, byClass('knowledge-row-project'))).toHaveLength(0);
    expect(findAll(root, byClass('knowledge-row-scope'))).toHaveLength(3);
    expect(collectText(root)).toContain('3件');
    expect(collectText(root)).not.toContain('上限');
  });

  it('reads the organization-wide list without choosing a project implicitly', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const calls = [];
    const opened = [];
    const controller = createKnowledgeOverviewController({
      root,
      projects: [{ code: 'baao', name: 'BAAO' }, { code: 'brainbase', name: 'brainbase' }],
      api: async (path) => { calls.push(path); return organizationList; },
      onSelectProject: (code, context) => opened.push([code, context?.reason]),
    });
    await settle();
    expect(calls).toEqual(['/api/knowledge/items?scope=all&status=active']);
    expect(collectText(root)).not.toContain('プロジェクト: ');
    expect(findAll(root, byClass('knowledge-project-context'))).toHaveLength(0);
    const select = findAll(root, (node) => byTag('select')(node) && node.attributes.name === 'knowledge_project')[0];
    expect(select.value).toBe('');
    expect(findAll(select, byTag('option')).map((option) => option.textContent)).toEqual(['すべてのプロジェクト', 'BAAO（baao）', 'brainbase']);
    expect(findAll(root, byClass('knowledge-row-project')).map((node) => node.textContent)).toEqual(['BAAO', 'brainbase', '組織共通']);
    expect(collectText(root)).toContain('読んだ範囲: 見られる3件のプロジェクトと組織共通');
    // Registration lives in the project workspace, not in the overview.
    expect(collectText(root)).not.toContain('登録案を作る');

    select.value = 'baao';
    select.dispatch('change');
    expect(opened).toEqual([['baao', 'filter']]);
    expect(controller.state.list.records).toHaveLength(3);
  });

  it('reads a selected record through its own project and offers to open that project', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const calls = [];
    const opened = [];
    const controller = createKnowledgeOverviewController({
      root,
      autoLoad: false,
      api: async (path) => { calls.push(path); return { item: { id: 'decision-1', type: 'decision', title: 'Growinの提案方針', summary: '本文', scope: 'project', lifecycle: { status: 'active' } } }; },
      onSelectProject: (code, context) => opened.push([code, context?.item_id]),
    });
    controller.state.list = normalizeKnowledgeCollection(organizationList);
    await controller.selectItem(controller.state.list.records[0]);
    expect(calls).toEqual(['/api/projects/baao/knowledge/items/decision-1']);
    expect(controller.state.detail.state).toBe('ready');
    expect(controller.state.selected.project_code).toBe('baao');
    expect(collectText(root)).toContain('所属: baao');
    const open = findAll(root, (node) => byTag('button')(node) && node.textContent === 'このプロジェクトで開く')[0];
    open.dispatch('click');
    expect(opened).toEqual([['baao', 'decision-1']]);
  });

  it('separates an empty readable scope, a filtered miss, and a failed read', async () => {
    globalThis.document = new FakeDocument();
    let response = { state: 'empty', records: [], searched_scope: ['baao'] };
    const root = new FakeElement('div');
    const controller = createKnowledgeOverviewController({ root, autoLoad: false, api: async () => { if (response instanceof Error) throw response; return response; } });
    await controller.loadItems();
    expect(collectText(root)).toContain('見られる範囲に、有効な知識・判断の記録はありません。');
    controller.state.filters = { q: '提案', scope: 'all', status: 'active' };
    await controller.loadItems();
    expect(collectText(root)).toContain('この条件に一致する知識・判断はありません。');
    response = Object.assign(new Error('upstream'), { status: 502, payload: { error: 'upstream_unavailable' } });
    await controller.loadItems();
    expect(controller.state.list.state).toBe('error_retryable');
    expect(collectText(root)).not.toContain('記録はありません');
  });

  it('lets the project workspace show an explicit, changeable project filter', () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const changes = [];
    createKnowledgeOutcomeController({
      root,
      project: { code: 'baao' },
      autoLoad: false,
      api: async () => ({}),
      projectFilter: { projects: [{ code: 'baao' }, { code: 'brainbase' }], onChange: (code) => changes.push(code) },
    });
    expect(findAll(root, byClass('knowledge-project-context'))).toHaveLength(0);
    const select = findAll(root, (node) => byTag('select')(node) && node.attributes.name === 'knowledge_project')[0];
    expect(select.value).toBe('baao');
    select.value = '';
    select.dispatch('change');
    expect(changes).toEqual([null]);
  });
});
