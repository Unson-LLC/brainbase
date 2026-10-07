import { strict as assert } from 'node:assert';
import { test } from 'vitest';

import {
  FOUNDATION_OVERVIEW_CONTRACT_VERSION,
  createFoundationOverview,
  renderFoundationCollectionOverview,
  normalizeFoundationCatalog,
} from '../../ui/foundation-overview.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.parentNode = null;
  }

  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  prepend(...children) { this.children.unshift(...children); }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'disabled') this.disabled = true;
  }

  addEventListener(name, callback) { this.listeners.set(name, callback); }

  dispatch(name, event = {}) {
    return this.listeners.get(name)?.({ preventDefault() {}, target: this, ...event });
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
}

const doc = new FakeDocument();
const textOf = (node) => `${node?.textContent ?? ''}${(node?.children ?? []).map(textOf).join('')}`;
const findAll = (node, predicate, result = []) => {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, result);
  return result;
};
const byClass = (node, name) => findAll(node, (item) => String(item.className).split(' ').includes(name));
const byAttr = (node, name, value) => findAll(node, (item) => item.attributes?.[name] === value);

function foundationRecord(type, id, revision = '1', definition = {}) {
  return {
    definition: {
      id,
      type,
      revision,
      meaning: definition.meaning ?? `${id}の意味`,
      adoptionState: definition.adoptionState ?? 'draft',
      authorizedUses: definition.authorizedUses ?? ['draft'],
      acl: definition.acl ?? { ownerId: 'owner', visibility: 'project', readerIds: [], writerIds: ['owner'] },
      storage: definition.storage ?? 'candidate',
      provenance: definition.provenance ?? [{ sourceId: 'source-1', sourceKind: 'document', evidenceIds: [] }],
      scope: definition.scope ?? { subjectIds: ['project-alpha'], validFrom: '2026-01-01T00:00:00.000Z' },
      ...definition,
    },
    digest: `sha256:${id}`,
  };
}

function objectiveRecord(overrides = {}) {
  return foundationRecord('objective', 'objective-profit', '2', {
    meaning: '現場実行と利益改善をつなぐ',
    desiredState: '現場の改善が利益改善につながっている',
    beneficiaryIds: ['company-alpha'],
    criteria: [{ variableRef: { id: 'variable-profit', type: 'variable', revision: '1' }, operator: 'at_least', target: 1 }],
    evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-12-31T23:59:59.000Z' },
    ...overrides,
  });
}

function philosophyRecord(id, payload = {}) {
  return {
    kind: 'philosophy',
    id,
    revision: '1',
    digest: `sha256:${id}`,
    payload: {
      title: '正本は用途別に置く',
      statement: 'UIは正本ではなく投影である',
      summary: '表示と記録を混同しない',
      status: 'active',
      applicability_text: '判断の前提を確認するとき',
      judgmentApplicability: { scope: { type: 'project', id: 'project-alpha' }, validFrom: '2026-01-01T00:00:00.000Z' },
      ...payload,
    },
    applicability: { scope: { type: 'project', id: 'project-alpha' }, validFrom: '2026-01-01T00:00:00.000Z' },
    currentAcl: { ownerId: 'owner', visibility: 'project', readerIds: [], writerIds: ['owner'] },
    currentScope: { type: 'project', id: 'project-alpha' },
  };
}

function catalog(overrides = {}) {
  return {
    contractVersion: FOUNDATION_OVERVIEW_CONTRACT_VERSION,
    scopeId: 'project-alpha',
    objectives: [objectiveRecord()],
    variables: [foundationRecord('variable', 'variable-profit', '1', {
      meaning: '利益改善',
      unit: '円',
      definition: '会計上の利益の金額',
      rubric: '月次集計値',
      valueSpace: { min: 0, unit: '円' },
    })],
    models: [foundationRecord('model', 'model-profit', '1', {
      meaning: '施策が利益に影響する',
      epistemicState: 'hypothesis',
      inputVariableRefs: [{ id: 'variable-profit', type: 'variable', revision: '1' }],
      outputVariableRefs: [{ id: 'variable-missing', type: 'variable', revision: '2' }],
      applicability: { subjectIds: ['project-alpha'], validFrom: '2026-01-01T00:00:00.000Z' },
      relationship: '施策が利益へ影響する',
      uncertainty: '因果関係は未検証',
      validationState: 'unverified',
    })],
    philosophies: [philosophyRecord('phi-projection')],
    ...overrides,
  };
}

test('normalizes the catalog and rejects scope or malformed responses', () => {
  const normalized = normalizeFoundationCatalog(catalog(), 'project-alpha');
  assert.equal(normalized.scopeId, 'project-alpha');
  assert.equal(normalized.objectives.length, 1);
  assert.throws(() => normalizeFoundationCatalog(catalog({ scopeId: 'project-beta' }), 'project-alpha'), /対象範囲|scope/i);
  assert.throws(() => normalizeFoundationCatalog(catalog({ models: [{}] }), 'project-alpha'), /model|record|形式/i);
  assert.throws(() => normalizeFoundationCatalog({ ...catalog(), philosophies: [{}] }, 'project-alpha'), /哲学|philosoph/i);
});

test('renders objectives, saved-state notice, philosophy, and model uncertainty', async () => {
  const root = new FakeElement('main');
  const objective = objectiveRecord();
  objective.definition.accountableId = 'owner-1';
  objective.details = {
    title: '利益改善を現場の行動へつなぐ',
    criteria_text: ['四半期ごとに現場責任者が確認する', '利益指標を版付き変数で評価する'],
    evaluation_period_note: '四半期ごとに確認',
    evaluator_note: '現場責任者が確認',
    current_state: {
      as_of: '2026-09-01T00:00:00.000Z',
      status: 'in_review',
      evidence_scope: '初回ヒアリング記録',
      missing: ['実績データ', '評価者の確定'],
    },
  };
  const port = { readCatalog: async () => catalog({ objectives: [objective] }) };
  const controller = createFoundationOverview({ root, port, scopeId: 'project-alpha', document: doc, autoLoad: false });
  await controller.load();
  const visible = textOf(root);

  assert.equal(root.children[0].attributes['data-contract-version'], FOUNDATION_OVERVIEW_CONTRACT_VERSION);
  assert.match(visible, /目的と現状/);
  assert.match(visible, /利益改善を現場の行動へつなぐ/);
  assert.match(visible, /四半期ごとに現場責任者が確認する/);
  assert.match(visible, /利益指標を版付き変数で評価する/);
  assert.match(visible, /記録上の現状/);
  assert.match(visible, /保存時点の記述/);
  assert.match(visible, /記録時点: 2026-09-01/);
  assert.match(visible, /状態: in_review/);
  assert.match(visible, /証拠範囲/);
  assert.match(visible, /初回ヒアリング記録/);
  assert.match(visible, /保存時点で未確認/);
  assert.match(visible, /実績データ/);
  assert.doesNotMatch(visible, /不足項目は記録上ありません/);
  assert.match(visible, /評価規準: 月次集計値/);
  assert.match(visible, /値域: min: 0、unit: 円/);
  assert.match(visible, /評価期間/);
  assert.match(visible, /評価者/);
  assert.match(visible, /責任者/);
  assert.match(visible, /owner-1/);
  assert.match(visible, /哲学/);
  assert.match(visible, /正本は用途別に置く/);
  assert.match(visible, /状態: 有効/);
  assert.match(visible, /判断の前提を確認するとき/);
  assert.match(visible, /プロジェクト: project-alpha/);
  assert.doesNotMatch(visible, /"scope":"project"/);
  assert.match(visible, /世界モデル/);
  assert.match(visible, /仮説/);
  assert.match(visible, /未検証/);
  assert.match(visible, /変数の版が一致しません/);
  assert.doesNotMatch(visible, /達成率\s*100|達成済み/);
  assert.ok(byClass(root, 'bb-fov-objective-card').length > 0);
  assert.ok(byAttr(root, 'aria-label', '世界モデル').length > 0);
});

test('paginates models by 50 and filters without changing the source catalog', async () => {
  const models = Array.from({ length: 51 }, (_, index) => foundationRecord('model', `model-${index + 1}`, '1', {
    relationship: `関係 ${index + 1}`,
    uncertainty: '不確かさあり',
    epistemicState: 'hypothesis',
    validationState: 'unverified',
    inputVariableRefs: [],
    outputVariableRefs: [],
    applicability: { subjectIds: ['project-alpha'], validFrom: '2026-01-01T00:00:00.000Z' },
  }));
  const root = new FakeElement('main');
  const controller = createFoundationOverview({ root, port: { readCatalog: async () => catalog({ models }) }, scopeId: 'project-alpha', document: doc, autoLoad: false });
  await controller.load();
  assert.equal(byClass(root, 'bb-fov-model-card').length, 50);
  const initialSearch = findAll(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'model-search')[0];
  assert.ok(initialSearch);
  const next = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '次の50件')[0];
  assert.ok(next);
  next.dispatch('click');
  assert.equal(byClass(root, 'bb-fov-model-card').length, 1);
  const search = findAll(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'model-search')[0];
  search.value = 'model';
  search.dispatch('input');
  assert.equal(byClass(root, 'bb-fov-model-card').length, 50);
  assert.equal(findAll(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'model-search')[0], initialSearch);
  search.value = 'model-51';
  search.dispatch('input');
  assert.equal(byClass(root, 'bb-fov-model-card').length, 1);
  assert.equal(findAll(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'model-search')[0], initialSearch);
  assert.match(textOf(root), /model-51/);
});

test('shows one selected objective detail and can mount without the shared header', async () => {
  const objectives = Array.from({ length: 11 }, (_, index) => objectiveRecord({
    id: undefined,
    meaning: `目的 ${index + 1}`,
  }));
  objectives.forEach((record, index) => { record.definition.id = `objective-${index + 1}`; });
  const root = new FakeElement('main');
  const controller = createFoundationOverview({
    root,
    port: { readCatalog: async () => catalog({ objectives }) },
    scopeId: 'project-alpha',
    document: doc,
    autoLoad: false,
    showHeader: false,
  });
  await controller.load();
  assert.equal(byClass(root, 'bb-fov-objective-card').length, 1);
  assert.doesNotMatch(textOf(root), /Brainbase\/目的と現状/);
  assert.match(textOf(root), /目的11件のうち1件/);
  const rows = byClass(root, 'bb-ws-ledger-row').filter((row) => row.attributes['data-key']);
  assert.equal(rows.length, 11);
  rows[1].dispatch('click');
  assert.match(textOf(root), /目的 2/);
  assert.equal(byClass(root, 'bb-fov-objective-card').length, 1);
});

test('keeps recorded notes separate from canonical missing fields', async () => {
  const root = new FakeElement('main');
  const objective = objectiveRecord({
    desiredState: undefined,
    criteria: [],
    evaluationPeriod: undefined,
  });
  objective.details = {
    criteria_text: '確認方法のメモ',
    evaluation_period_note: '期間のメモ',
    evaluator_note: '評価者のメモ',
    current_state: {
      status: '未確認',
      missing: ['実績データ'],
    },
  };
  const controller = createFoundationOverview({
    root,
    port: { readCatalog: async () => catalog({ objectives: [objective] }) },
    scopeId: 'project-alpha',
    document: doc,
    autoLoad: false,
  });
  await controller.load();
  const visible = textOf(root);

  assert.match(visible, /確認方法のメモ/);
  assert.match(visible, /期間のメモ/);
  assert.match(visible, /評価者のメモ/);
  assert.match(visible, /目指す状態: 未確定/);
  assert.match(visible, /評価基準: 未確定/);
  assert.match(visible, /評価期間: 未確定/);
  assert.match(visible, /責任者: 未確定/);
  assert.doesNotMatch(visible, /不足項目は記録上ありません/);
  assert.match(visible, /保存時点で未確認/);
});

test('keeps request failures visible and ignores stale responses after destroy', async () => {
  const root = new FakeElement('main');
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const controller = createFoundationOverview({ root, port: { readCatalog: () => pending }, scopeId: 'project-alpha', document: doc, autoLoad: false });
  const load = controller.load();
  controller.destroy();
  resolve(catalog());
  await load;
  assert.equal(root.children.length, 0);

  const failedRoot = new FakeElement('main');
  const failed = createFoundationOverview({ root: failedRoot, port: { readCatalog: async () => { throw new Error('connection failed'); } }, scopeId: 'project-alpha', document: doc, autoLoad: false });
  await failed.load();
  assert.match(textOf(failedRoot), /取得できません|connection failed/);
  assert.doesNotMatch(textOf(failedRoot), /登録された目的はありません/);
});


test('collection groups by topic, retains project provenance and resolves colliding variable IDs locally', () => {
  const root = doc.createElement('div');
  const a = catalog();
  const b = catalog({ scopeId: 'project-beta' });
  b.objectives[0].definition.desiredState = 'Betaの目標';
  b.variables[0].definition.meaning = 'Beta固有の指標';
  const sources = [a, b].map((value, i) => ({ scopeId: value.scopeId, label: i ? 'Beta' : 'Alpha', state: { status: 'ready', catalog: value } }));
  const state = { query: '', page: 0 };
  const draw = () => renderFoundationCollectionOverview(root, sources, { document: doc, viewState: state, callbacks: { render: draw } });
  draw();
  for (const name of ['目的', '哲学', '世界モデル']) assert.equal(byAttr(root, 'aria-label', name).length, 1);
  assert.equal(byClass(root, 'bb-fov-model-card').length, 2);
  assert.match(textOf(byClass(root, 'bb-fov-model-card')[0]), /Alpha.*利益改善/);
  assert.match(textOf(byClass(root, 'bb-fov-model-card')[1]), /Beta.*Beta固有の指標/);
  const rows = findAll(root, node => node.listeners.has('click') && textOf(node).includes('Betaの目標'));
  assert.ok(rows.length);
  rows[0].dispatch('click');
  assert.match(textOf(byClass(root, 'bb-fov-objective-card')[0]), /Beta.*Beta固有の指標/);
});

test('collection deduplicates exact shared revisions, preserves conflicting digests and marks failed sources', () => {
  const root = doc.createElement('div');
  const shared = philosophyRecord('shared');
  shared.currentScope = { type: 'organization', id: 'org-1' };
  const a = catalog({ philosophies: [shared] });
  const b = catalog({ scopeId: 'project-beta', philosophies: [structuredClone(shared)] });
  const sources = [a, b].map((value, i) => ({ scopeId: value.scopeId, label: i ? 'Beta' : 'Alpha', state: { status: 'ready', catalog: value } }));
  sources.push({ scopeId: 'denied', label: '未取得案件', state: { status: 'error', error: { message: '未確認。0件ではありません。' } } });
  renderFoundationCollectionOverview(root, sources, { document: doc });
  assert.equal(byClass(root, 'bb-fov-philosophy-card').length, 1);
  assert.match(textOf(root), /組織共通.*Alpha・Beta/);
  assert.match(textOf(root), /未取得案件.*未確認/);
  assert.match(textOf(root), /全体は未確認/);
  b.philosophies[0].digest = 'sha256:different';
  renderFoundationCollectionOverview(root, sources, { document: doc });
  assert.equal(byClass(root, 'bb-fov-philosophy-card').length, 2);
});
