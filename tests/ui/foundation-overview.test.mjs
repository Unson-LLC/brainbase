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
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
    };
  }

  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); }
  focus() {}
  getAttribute(name) { return this.attributes[name]; }
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

  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }

  dispatch(name, event = {}) {
    return this.listeners.get(name)?.({ preventDefault() {}, target: this, ...event });
  }
}

class FakeDocument {
  constructor() { this.defaultView = { matchMedia: () => ({ matches: true }) }; this.body = this.createElement('body'); }
  createElement(tagName) { const node = new FakeElement(tagName); node.ownerDocument = this; return node; }
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
  const listText = textOf(root);
  byAttr(root, 'data-key', 'objective-profit@2')[0].dispatch('click');
  const visible = listText + textOf(doc.body);

  assert.equal(root.children[0].attributes['data-contract-version'], FOUNDATION_OVERVIEW_CONTRACT_VERSION);
  assert.equal(byClass(root, 'bb-ws-metric').length, 0);
  assert.match(visible, /目的と現状/);
  assert.match(visible, /利益改善を現場の行動へつなぐ/);
  assert.match(visible, /四半期ごとに現場責任者が確認する/);
  assert.match(visible, /利益指標を版付き変数で評価する/);
  assert.match(visible, /記録上の現状/);

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

  assert.match(visible, /判断の前提を確認するとき/);
  assert.match(visible, /プロジェクト: project-alpha/);
  assert.doesNotMatch(visible, /"scope":"project"/);
  assert.match(visible, /世界モデル/);
  assert.match(visible, /仮説/);
  assert.match(visible, /未検証/);
  assert.match(visible, /変数の版が一致しません/);
  assert.doesNotMatch(visible, /達成率\s*100|達成済み/);
  assert.equal(byClass(root, 'bb-fov-objective-card').length, 0);
  assert.ok(byClass(doc.body, 'bb-fov-objective-card').length > 0);
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
  doc.body.replaceChildren();
  assert.equal(byClass(root, 'bb-fov-objective-card').length, 0);
  assert.doesNotMatch(textOf(root), /Brainbase\/目的と現状/);
  assert.doesNotMatch(textOf(root), /詳細表示/);
  const rows = byClass(root, 'bb-ws-ledger-row').filter((row) => row.attributes['data-key']);
  assert.equal(rows.length, 11);
  rows[1].dispatch('click');
  assert.match(textOf(doc.body), /目的 2/);
  assert.equal(byClass(doc.body, 'bb-fov-objective-card').length, 1);
  assert.match(textOf(doc.body), /達成条件.*確認の根拠.*出典/);
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
  doc.body.replaceChildren();
  byAttr(root, 'data-key', 'objective-profit@2')[0].dispatch('click');
  const visible = textOf(doc.body);

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

test('keeps an unreadable empty catalog unconfirmed instead of rendering zero records', async () => {
  const root = new FakeElement('main');
  const unknown = catalog({
    objectives: [],
    variables: [],
    models: [],
    philosophies: [],
    read_status: 'unknown',
    status: 'api_unavailable',
    absence_confirmed: false,
  });
  const controller = createFoundationOverview({
    root,
    port: { readCatalog: async () => unknown },
    scopeId: 'project-alpha',
    document: doc,
    autoLoad: false,
  });
  await controller.load();
  const visible = textOf(root);

  assert.equal(controller.state.status, 'unavailable');
  assert.match(visible, /取得状態を確認できません/);
  assert.match(visible, /登録なし・0件として表示していません/);
  assert.match(visible, /再試行/);
  assert.doesNotMatch(visible, /登録された目的がありません/);
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
  assert.equal(byClass(root, 'bb-fov-objective-card').length, 0, 'overview stays compact until a purpose is selected');
  assert.equal(byClass(root, 'bb-fov-model-card').length, 2);
  assert.match(textOf(byClass(root, 'bb-fov-model-card')[0]), /Alpha.*利益改善/);
  assert.match(textOf(byClass(root, 'bb-fov-model-card')[1]), /Beta.*Beta固有の指標/);
  doc.body.replaceChildren();
  const rows = byClass(root, 'bb-ws-ledger-row').filter(node => node.attributes['data-key']);
  assert.ok(rows.length);
  rows[1].dispatch('click');
  assert.match(textOf(doc.body), /Beta.*Beta固有の指標/s);
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
  assert.equal(textOf(root).includes('取得済みの範囲'), false);
  assert.equal(textOf(root).includes('全体は未確認'), false);
  assert.equal(byClass(root, 'bb-ws-metric').length, 0);
  b.philosophies[0].digest = 'sha256:different';
  renderFoundationCollectionOverview(root, sources, { document: doc });
  assert.equal(byClass(root, 'bb-fov-philosophy-card').length, 2);
});


test('collection reports one pending state without per-project loading bands or false empty sections', () => {
  const root = doc.createElement('div');
  const loading = [];
  const sources = ['Alpha', 'Beta'].map(label => ({ label, scopeId: label, state: { status: 'loading' } }));
  renderFoundationCollectionOverview(root, sources, { document: doc, onLoading: value => loading.push(value) });
  assert.deepEqual(loading, [true]);
  assert.equal(root.children.length, 0, 'pending catalogs have no empty-state content');
  sources[0].state = { status: 'ready', catalog: catalog({ scopeId: 'Alpha' }) };
  renderFoundationCollectionOverview(root, sources, { document: doc, onLoading: value => loading.push(value) });
  assert.equal(loading.at(-1), true, 'one slow scope keeps the aggregate loading state');
  sources[1].state = { status: 'error', error: { message: 'catalog unavailable' } };
  renderFoundationCollectionOverview(root, sources, { document: doc, onLoading: value => loading.push(value) });
  assert.equal(loading.at(-1), false);
  assert.match(textOf(root), /catalog unavailable/);
  assert.doesNotMatch(textOf(root), /取得済みの範囲|読み込んでいます/);
});

function unscopedPhilosophy(id, overrides = {}) {
  return {
    kind: 'philosophy', id, version: 1, applicability: null, applicability_state: 'unrecorded',
    payload: { title: '見えなければ価値ではない', statement: '利用者の画面に見えなければ価値ではない。', status: 'active' },
    ...overrides,
  };
}

test('shows philosophies without recorded applicability instead of reporting none registered', async () => {
  const root = new FakeElement('main');
  const port = { readCatalog: async () => catalog({ philosophies: [], philosophies_without_applicability: [unscopedPhilosophy('phi_visible_or_not_value')] }) };
  const controller = createFoundationOverview({ root, port, scopeId: 'project-alpha', document: doc, autoLoad: false });
  await controller.load();
  const visible = textOf(root);

  assert.doesNotMatch(visible, /登録された哲学がありません/);
  assert.match(visible, /次の1件は、判断への適用範囲が記録されていない哲学です/);
  assert.match(visible, /見えなければ価値ではない/);
  assert.match(visible, /利用者の画面に見えなければ価値ではない。/);
  assert.match(visible, /適用範囲.*未記録/s);
  assert.equal(byClass(root, 'bb-fov-philosophy-card').length, 1);
});

test('keeps an older host without the unscoped list from claiming no philosophy exists', async () => {
  const root = new FakeElement('main');
  const port = { readCatalog: async () => catalog({ philosophies: [] }) };
  const controller = createFoundationOverview({ root, port, scopeId: 'project-alpha', document: doc, autoLoad: false });
  await controller.load();
  const visible = textOf(root);
  assert.doesNotMatch(visible, /この対象範囲には登録された哲学がありません/);
  assert.match(visible, /適用範囲が未記録の哲学があるかは確認できていません/);

  const known = new FakeElement('main');
  const empty = createFoundationOverview({ root: known, port: { readCatalog: async () => catalog({ philosophies: [], philosophies_without_applicability: [] }) }, scopeId: 'project-alpha', document: doc, autoLoad: false });
  await empty.load();
  assert.match(textOf(known), /この対象範囲には登録された哲学がありません/);
});

test('rejects a malformed unscoped philosophy instead of dropping it', () => {
  assert.throws(
    () => normalizeFoundationCatalog(catalog({ philosophies_without_applicability: [unscopedPhilosophy('x', { applicability_state: 'recorded' })] }), 'project-alpha'),
    /適用範囲が未記録の哲学/,
  );
  assert.throws(
    () => normalizeFoundationCatalog(catalog({ philosophies_without_applicability: [unscopedPhilosophy('x', { payload: { statement: '' } })] }), 'project-alpha'),
    /適用範囲が未記録の哲学/,
  );
});

test('collection merges unscoped philosophies with their project provenance', () => {
  const root = doc.createElement('div');
  const a = catalog({ philosophies: [], philosophies_without_applicability: [unscopedPhilosophy('phi-a')] });
  const b = catalog({ scopeId: 'project-beta', philosophies: [], philosophies_without_applicability: [unscopedPhilosophy('phi-b', { payload: { title: 'Beta哲学', statement: 'Betaの本文' } })] });
  const sources = [a, b].map((value, i) => ({ scopeId: value.scopeId, label: i ? 'Beta' : 'Alpha', state: { status: 'ready', catalog: value } }));
  renderFoundationCollectionOverview(root, sources, { document: doc });
  assert.equal(byClass(root, 'bb-fov-philosophy-card').length, 2);
  assert.match(textOf(root), /次の2件は/);
  assert.match(textOf(root), /Beta哲学/);
  assert.doesNotMatch(textOf(root), /登録された哲学がありません/);
});

// What a reader sees without opening a record's details: section disclosures count as open,
// the per-record "記録の詳細" disclosures do not.
const frontText = (node) => {
  if (!node) return '';
  if (node.tagName === 'DETAILS' && !String(node.className).split(' ').includes('bb-ws-disclosure')) {
    return textOf(node.children.find((child) => child.tagName === 'SUMMARY'));
  }
  return `${node.textContent ?? ''}${(node.children ?? []).map(frontText).join('')}`;
};

test('keeps record ids, digests, field names and secondary states behind the record details', async () => {
  const root = new FakeElement('main');
  const objective = objectiveRecord({
    id: 'fnd_objective_7f3a',
    provenance: [
      { sourceId: 'foundation-objective-editor', sourceKind: 'candidate', evidenceIds: [] },
      { sourceId: 'foundation-adoption:fnd_objective_7f3a@1', sourceKind: 'decision', evidenceIds: ['dec_91ab'] },
    ],
  });
  const model = foundationRecord('model', 'fnd_model_c0ffee', '3', {
    meaning: '施策が利益に影響する',
    adoptionState: 'approved',
    authorizedUses: ['judgment', 'evaluation'],
    epistemicState: 'hypothesis',
    validationState: 'in_progress',
    inputVariableRefs: [{ id: 'variable-profit', type: 'variable', revision: '1' }],
    outputVariableRefs: [{ id: 'fnd_variable_missing', type: 'variable', revision: '2' }],
    applicability: { subjectIds: ['prj_8d2e'], validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-12-31T00:00:00.000Z' },
    relationship: '施策が利益へ影響する',
    uncertainty: '因果関係は未検証',
  });
  model.details = { applicability_text: 'AI生成資料・要約・提案書' };
  const unnamed = foundationRecord('model', 'fnd_model_unnamed', '1', { meaning: undefined });
  delete unnamed.definition.meaning;
  const controller = createFoundationOverview({
    root,
    port: { readCatalog: async () => catalog({ objectives: [objective], models: [model, unnamed] }) },
    scopeId: 'project-alpha',
    document: doc,
    autoLoad: false,
  });
  await controller.load();
  doc.body.replaceChildren();
  byAttr(root, 'data-key', 'fnd_objective_7f3a@2')[0].dispatch('click');
  const front = frontText(root) + frontText(doc.body);
  const everything = textOf(root) + textOf(doc.body);

  // Ids and secondary states move behind the details, where correction and tracing still find them.
  for (const internal of ['fnd_objective_7f3a', 'fnd_model_c0ffee', 'fnd_variable_missing', 'variable-profit@1', 'sha256:', 'prj_8d2e',
    'foundation-adoption', 'dec_91ab', '許可用途', '登録状態']) {
    assert.equal(front.includes(internal), false, `${internal} is visible before opening the record details: ${front.slice(Math.max(0, front.indexOf(internal) - 80), front.indexOf(internal) + 40)}`);
    assert.equal(everything.includes(internal), true, `${internal} stays reachable in the record details`);
  }
  // Field names of the stored shape are never the words of the screen.
  for (const field of ['validFrom', 'validUntil', 'subjectIds', '{"']) {
    assert.equal(front.includes(field), false, `${field} is visible before opening the record details`);
  }
  assert.match(front, /候補からの登録/);
  assert.match(front, /決定（証拠1件）/);
  // The record's own words say where it applies; the stored scope is ids and a registration time.
  assert.match(front, /適用範囲AI生成資料・要約・提案書/);
  assert.match(front, /範囲の説明は記録されていません/);
  assert.doesNotMatch(front, /2026-01-01 から/);
  assert.match(everything, /登録上の開始日時2026-01-01 から 2026-12-31 まで/);
  assert.match(front, /確からしさ: 仮説/);
  assert.match(front, /名前の記録がない変数/);
  assert.match(front, /名前の記録なし/);
});

test('keeps the id of an unnamed unscoped philosophy in its record details', () => {
  const root = doc.createElement('div');
  const unnamed = unscopedPhilosophy('phi_internal_id', { payload: { statement: '名前の無い哲学の本文' } });
  const sources = [{ scopeId: 'project-alpha', label: 'Alpha', state: { status: 'ready', catalog: catalog({ philosophies: [], philosophies_without_applicability: [unnamed] }) } }];
  renderFoundationCollectionOverview(root, sources, { document: doc });
  const heading = textOf(byClass(root, 'bb-fov-philosophy-card')[0].children.find((child) => child.tagName === 'H3'));
  assert.equal(heading, '名前の記録なし');
  assert.doesNotMatch(frontText(root), /phi_internal_id/);
  assert.match(textOf(root), /phi_internal_id/);
});
