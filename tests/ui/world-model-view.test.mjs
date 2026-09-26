import { describe, expect, it } from 'vitest';
import {
  createWorldModelView,
  normalizeWorldModelSection,
} from '../../ui/world-model-view.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
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

  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
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

function section(root, label) {
  return findAll(root, (node) => node.tagName === 'SECTION' && node.attributes['aria-label'] === label)[0];
}

const acl = { ownerId: 'self', visibility: 'private', readerIds: [], writerIds: [] };

const variablesPayload = {
  state: 'ready',
  absence_confirmed: true,
  unreadable: { count: 0, codes: [] },
  records: [{
    digest: 'sha256:v',
    definition: {
      id: 'focus.hours', type: 'variable', revision: '1', meaning: '中断されない作業時間', epistemicState: 'supported',
      adoptionState: 'approved', acl, subject: '自分の作業時間', unit: '時間', measurementMethod: 'カレンダーから集計',
    },
  }],
};

const modelsPayload = {
  state: 'ready',
  absence_confirmed: true,
  unreadable: { count: 0, codes: [] },
  records: [{
    digest: 'sha256:m',
    definition: {
      id: 'model.meetings', type: 'model', revision: '2', meaning: '会議が増えると深い仕事が減る', epistemicState: 'hypothesis',
      validationState: 'in_progress', relationship: '会議が多いほど減る', uncertainty: '会議の長さは未確認',
      inputVariableRefs: [{ id: 'meetings.count', type: 'variable', revision: '1' }],
      outputVariableRefs: [{ id: 'focus.hours', type: 'variable', revision: '1' }],
    },
  }],
};

function observation(id, value, extra = {}) {
  return {
    id,
    variableRef: { id: 'focus.hours', type: 'variable', revision: '1' },
    subjectId: 'home',
    value,
    occurredAt: '2026-06-10T01:00:00.000Z',
    period: { from: '2026-06-08T00:00:00.000Z', until: '2026-06-14T23:59:59.000Z' },
    recordedAt: '2026-06-11T01:00:00.000Z',
    sourceRef: { sourceId: 'calendar-week-24', sourceKind: 'observation', evidenceIds: ['e-1'] },
    ...extra,
  };
}

const observationsPayload = {
  state: 'ready',
  absence_confirmed: true,
  unreadable: { count: 0, codes: [] },
  observations: [observation('observation-1', 6), observation('observation-2', 7, { supersedes: 'observation-1' })],
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetcherFor(routes) {
  const calls = [];
  const fetcher = async (path) => {
    calls.push(path);
    const route = routes[path];
    if (!route) return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
    return typeof route === 'function' ? route() : route;
  };
  return { fetcher, calls };
}

async function mount(routes) {
  const root = new FakeElement('div');
  const { fetcher, calls } = fetcherFor(routes);
  const view = createWorldModelView({ root, document: new FakeDocument(), fetcher, autoLoad: false });
  await view.load();
  return { root, view, calls };
}

describe('World Model view', () => {
  it('keeps the view (variables and models) apart from recorded observations', async () => {
    const { root } = await mount({
      '/api/world-model/variables': jsonResponse(200, variablesPayload),
      '/api/world-model/models': jsonResponse(200, modelsPayload),
      '/api/world-model/observations': jsonResponse(200, observationsPayload),
      '/api/world-model/adoptions': jsonResponse(200, { state: 'empty', adoptions: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
    });
    const text = collectText(root);
    expect(text.indexOf('見方：変数とモデル')).toBeGreaterThan(-1);
    expect(text.indexOf('見方：変数とモデル')).toBeLessThan(text.indexOf('観測：記録された値'));

    const view = collectText(section(root, '変数とモデル'));
    expect(view).toContain('中断されない作業時間');
    expect(view).toContain('認識: 支持');
    expect(view).toContain('focus.hours@1');
    expect(view).toContain('会議が増えると深い仕事が減る');
    expect(view).toContain('認識: 仮説');
    expect(view).toContain('検証: 検証中');
    expect(view).toContain('中断されない作業時間（focus.hours@1）');
    expect(view).not.toContain('observation-1');

    const observed = collectText(section(root, '観測'));
    expect(observed).toContain('home：6 時間');
    expect(observed).toContain('発生');
    expect(observed).toContain('記録');
    expect(observed).toContain('観測（calendar-week-24）');
    expect(observed).toContain('観測「observation-1」を訂正');
    expect(observed).toContain('観測「observation-2」で訂正済み');
    // Observations never carry an epistemic label; that belongs to the view.
    expect(observed).not.toContain('認識:');

    expect(collectText(section(root, 'モデルの採用'))).toContain('モデルの採用はまだありません。');
  });

  it('marks only the adoptions as unverifiable when approval cannot be checked', async () => {
    const { root } = await mount({
      '/api/world-model/variables': jsonResponse(200, variablesPayload),
      '/api/world-model/models': jsonResponse(200, modelsPayload),
      '/api/world-model/observations': jsonResponse(200, observationsPayload),
      '/api/world-model/adoptions': jsonResponse(503, { error: { code: 'approval_reference_unresolved', message: 'no reader' } }),
    });
    expect(collectText(section(root, 'モデルの採用'))).toContain('承認を確かめられないため表示できません');
    expect(collectText(section(root, '観測'))).toContain('home：6 時間');
    expect(collectText(section(root, '変数とモデル'))).toContain('認識: 支持');
  });

  it('shows adoptions with their state and basis', async () => {
    const adoption = {
      adoptionId: 'adoption-1',
      modelRef: { id: 'model.meetings', type: 'model', revision: '2' },
      candidate: { candidateId: 'c-1', hypothesis: '会議が週5件を超えると深い仕事が減る', evidenceIds: ['n-1', 'n-2'], acl, epistemicState: 'hypothesis' },
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      modelDigest: 'sha256:m',
      approvalRef: { id: 'decision-1', type: 'decision', revision: '1' },
    };
    const { root } = await mount({
      '/api/world-model/variables': jsonResponse(200, variablesPayload),
      '/api/world-model/models': jsonResponse(200, modelsPayload),
      '/api/world-model/observations': jsonResponse(200, observationsPayload),
      '/api/world-model/adoptions': jsonResponse(200, { state: 'ready', adoptions: [adoption], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
    });
    const text = collectText(section(root, 'モデルの採用'));
    expect(text).toContain('会議が増えると深い仕事が減る（model.meetings@2）');
    expect(text).toContain('承認済み');
    expect(text).toContain('会議が週5件を超えると深い仕事が減る');
    expect(text).toContain('2件');
    expect(text).toContain('decision-1@1');
  });

  it('never shows a failed, unconfirmed or partial section as zero items', async () => {
    let attempts = 0;
    const { root, view, calls } = await mount({
      '/api/world-model/variables': jsonResponse(200, { state: 'empty', records: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
      '/api/world-model/models': jsonResponse(200, { state: 'unknown', records: [] }),
      '/api/world-model/observations': () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse(500, { error: { code: 'corrupt_record', message: '記録が壊れています' } })
          : jsonResponse(200, observationsPayload);
      },
      '/api/world-model/adoptions': jsonResponse(200, { state: 'partial', adoptions: [], absence_confirmed: false, unreadable: { count: 1, codes: ['authorization_denied'] } }),
    });
    const text = collectText(root);
    expect(text).toContain('変数はまだ登録がありません。');
    expect(text).toContain('記録の有無を確かめられません。0件ではありません。');
    expect(text).toContain('読み取れませんでした（記録が壊れています）。0件ではありません。');
    expect(text).toContain('読めない記録が1件あります（読む権限がない）');
    expect(text).not.toContain('モデルはまだ登録がありません');
    expect(text).not.toContain('観測はまだ記録がありません');

    const retry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '再試行')[0];
    retry.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.filter((path) => path === '/api/world-model/observations')).toHaveLength(2);
    expect(view.state.observations.state).toBe('ready');
    // Without a readable Variable the unit is unknown, so only the value is shown.
    expect(collectText(root)).toContain('home：6訂正済み');
  });

  it('treats a missing array or malformed record as invalid, not empty', () => {
    expect(normalizeWorldModelSection('variables', { state: 'ready' })).toMatchObject({ state: 'invalid', items: null });
    expect(normalizeWorldModelSection('observations', { observations: [{ id: 'x' }], absence_confirmed: true })).toMatchObject({ state: 'invalid' });
    expect(normalizeWorldModelSection('models', { records: [{ definition: { id: 'v', type: 'variable', revision: '1' } }] })).toMatchObject({ state: 'invalid' });
    expect(normalizeWorldModelSection('adoptions', { adoptions: [], absence_confirmed: true })).toMatchObject({ state: 'empty', items: [] });
    expect(normalizeWorldModelSection('adoptions', { adoptions: [] })).toMatchObject({ state: 'unknown', items: null });
  });
});
