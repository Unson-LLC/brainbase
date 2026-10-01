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

function byClass(node, className) {
  return findAll(node, (element) => String(element?.className ?? '').split(' ').includes(className));
}

/** Rows of the block's ledger as cell texts, the header row first. */
function ledgerTable(block) {
  const ledger = byClass(block, 'bb-ws-ledger')[0];
  if (!ledger) return null;
  return byClass(ledger, 'bb-ws-ledger-row').map((row) => row.children.map(collectText));
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

async function mount(routes, options = {}) {
  const root = new FakeElement('div');
  const rail = new FakeElement('aside');
  const { fetcher, calls } = fetcherFor(routes);
  const view = createWorldModelView({ root, rail, document: new FakeDocument(), fetcher, autoLoad: false, ...options });
  await view.load();
  return { root, rail, view, calls };
}

describe('World Model view', () => {
  it('explains the real registration boundary when every World Model section is confirmed empty', async () => {
    const { root, rail } = await mount({
      '/api/world-model/variables': jsonResponse(200, { state: 'empty', records: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
      '/api/world-model/models': jsonResponse(200, { state: 'empty', records: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
      '/api/world-model/observations': jsonResponse(200, { state: 'empty', observations: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
      '/api/world-model/adoptions': jsonResponse(200, { state: 'empty', adoptions: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
    });
    const guidance = byClass(root, 'bb-wm-registration-guidance');
    expect(guidance).toHaveLength(1);
    const text = collectText(guidance[0]);
    expect(text).toContain('登録方法');
    expect(text).toContain('この欄は表示専用です');
    expect(text).toContain('利用者向けのWeb/CLI登録入口は現行OSSにありません');
    expect(text).toContain('この画面からは登録できません');
    expect(text).toContain('@unson/brainbase-mcp/world-model');
    expect(text).toContain('createWorldModelStore');
    expect(findAll(root, (node) => node.tagName === 'BUTTON')).toHaveLength(0);
    expect(findAll(root, (node) => node.tagName === 'A')).toHaveLength(0);
    expect(rail.children).toHaveLength(0);
  });

  it('keeps the view (variables and models) apart from recorded observations, as read-only ledgers', async () => {
    const { root, rail } = await mount({
      '/api/world-model/variables': jsonResponse(200, variablesPayload),
      '/api/world-model/models': jsonResponse(200, modelsPayload),
      '/api/world-model/observations': jsonResponse(200, observationsPayload),
      '/api/world-model/adoptions': jsonResponse(200, { state: 'empty', adoptions: [], absence_confirmed: true, unreadable: { count: 0, codes: [] } }),
    });
    // A section title under the page head, not a second page head.
    const title = byClass(root, 'bb-ws-section-title')[0];
    expect(findAll(title, (node) => node.tagName === 'H2')[0].textContent).toBe('現状と見通し');
    expect(findAll(root, (node) => node.tagName === 'H1')).toHaveLength(0);
    const text = collectText(root);
    expect(text.indexOf('見方：変数とモデル')).toBeGreaterThan(-1);
    expect(text.indexOf('見方：変数とモデル')).toBeLessThan(text.indexOf('観測：記録された値'));

    const view = ledgerTable(section(root, '変数とモデル'));
    expect(view[0]).toEqual(['名前', '種類', '認識の状態', '版']);
    expect(view[1]).toEqual(['中断されない作業時間対象: 自分の作業時間単位: 時間測り方: カレンダーから集計', '変数承認済み', '支持', 'focus.hours@1']);
    expect(view[2][0]).toContain('会議が増えると深い仕事が減る');
    expect(view[2][0]).toContain('出力: 中断されない作業時間（focus.hours@1）');
    expect(view[2].slice(1)).toEqual(['モデル検証: 検証中', '仮説', 'model.meetings@2']);
    expect(collectText(section(root, '変数とモデル'))).not.toContain('observation-1');

    const observed = ledgerTable(section(root, '観測'));
    expect(observed[0]).toEqual(['対象', '値', '期間', '記録', '出典']);
    expect(observed[1][0]).toBe('home中断されない作業時間（focus.hours@1）');
    expect(observed[1][1]).toBe('6 時間観測「observation-2」で訂正済み');
    expect(observed[1][2]).toContain('発生 ');
    expect(observed[1][4]).toBe('観測（calendar-week-24）観測ID observation-1');
    expect(observed[2][1]).toBe('7 時間観測「observation-1」を訂正');
    // The corrected observation stays, marked as superseded.
    const rows = byClass(byClass(section(root, '観測'), 'bb-ws-ledger')[0], 'bb-ws-ledger-row');
    expect(rows[1].className).toContain('is-superseded');
    expect(rows[2].className).not.toContain('is-superseded');
    // Observations never carry an epistemic state; that belongs to the view.
    const observedText = collectText(section(root, '観測'));
    expect(observedText).not.toContain('認識');
    expect(observedText).not.toContain('支持');

    expect(collectText(section(root, 'モデルの採用'))).toContain('モデルの採用はまだありません。');
    expect(byClass(root, 'bb-wm-registration-guidance')).toHaveLength(0);
    // Rows are not selectable and the view never writes to the host's rail.
    expect(findAll(root, (node) => node.tagName === 'BUTTON')).toHaveLength(0);
    expect(rail.children).toHaveLength(0);
  });

  it('marks only the adoptions as unverifiable when approval cannot be checked', async () => {
    const { root } = await mount({
      '/api/world-model/variables': jsonResponse(200, variablesPayload),
      '/api/world-model/models': jsonResponse(200, modelsPayload),
      '/api/world-model/observations': jsonResponse(200, observationsPayload),
      '/api/world-model/adoptions': jsonResponse(503, { error: { code: 'approval_reference_unresolved', message: 'no reader' } }),
    });
    const adoptions = section(root, 'モデルの採用');
    expect(collectText(adoptions)).toContain('承認を確かめられないため表示できません');
    expect(byClass(adoptions, 'bb-ws-notice')[0].className).toContain('is-warning');
    expect(ledgerTable(adoptions)).toBeNull();
    expect(ledgerTable(section(root, '観測'))[1][1]).toContain('6 時間');
    expect(ledgerTable(section(root, '変数とモデル'))[1][2]).toBe('支持');
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
    const table = ledgerTable(section(root, 'モデルの採用'));
    expect(table[0]).toEqual(['モデル', '状態', '根拠', '用途', '承認', '日時']);
    expect(table[1].slice(0, 5)).toEqual([
      '会議が増えると深い仕事が減る（model.meetings@2）',
      '承認済み',
      '会議が週5件を超えると深い仕事が減る候補の認識: 仮説証拠 2件',
      '判断',
      'decision-1@1',
    ]);
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
    expect(byClass(root, 'bb-wm-registration-guidance')).toHaveLength(0);

    const retry = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === '再試行')[0];
    retry.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.filter((path) => path === '/api/world-model/observations')).toHaveLength(2);
    expect(view.state.observations.state).toBe('ready');
    // Without a readable Variable the unit is unknown, so only the value is shown.
    expect(ledgerTable(section(root, '観測'))[1][1]).toBe('6観測「observation-2」で訂正済み');
  });

  it('treats a missing array or malformed record as invalid, not empty', () => {
    expect(normalizeWorldModelSection('variables', { state: 'ready' })).toMatchObject({ state: 'invalid', items: null });
    expect(normalizeWorldModelSection('observations', { observations: [{ id: 'x' }], absence_confirmed: true })).toMatchObject({ state: 'invalid' });
    expect(normalizeWorldModelSection('models', { records: [{ definition: { id: 'v', type: 'variable', revision: '1' } }] })).toMatchObject({ state: 'invalid' });
    expect(normalizeWorldModelSection('adoptions', { adoptions: [], absence_confirmed: true })).toMatchObject({ state: 'empty', items: [] });
    expect(normalizeWorldModelSection('adoptions', { adoptions: [] })).toMatchObject({ state: 'unknown', items: null });
  });

  describe('a host without a World Model source', () => {
    const unavailable = (reason) => jsonResponse(200, { status: 'unavailable', reason });
    const allUnavailable = {
      '/api/world-model/variables': unavailable('World Modelの読み取り元がありません'),
      '/api/world-model/models': unavailable('World Modelの読み取り元がありません'),
      '/api/world-model/observations': unavailable('World Modelの読み取り元がありません'),
      '/api/world-model/adoptions': unavailable('World Modelの読み取り元がありません'),
    };
    const HOST_COPY = { title: '未接続', guidance: 'この画面の現状と見通しは、まだどこにもつながっていません。' };

    it('treats a section answered as unavailable (HTTP 200) as unavailable, never as empty or malformed', async () => {
      expect(normalizeWorldModelSection('observations', { status: 'unavailable', reason: '読み取り元がありません' }))
        .toEqual({ state: 'unavailable', items: null, reason: '読み取り元がありません' });
      expect(normalizeWorldModelSection('models', { status: 'unavailable' })).toEqual({ state: 'unavailable', items: null, reason: null });
      const { root, view } = await mount({ ...allUnavailable, '/api/world-model/variables': jsonResponse(200, variablesPayload) });
      expect(view.state.models.state).toBe('unavailable');
      const models = collectText(section(root, '変数とモデル'));
      expect(models).toContain('このホストでは読めません（World Modelの読み取り元がありません）。0件ではありません。');
      expect(ledgerTable(section(root, '変数とモデル'))[1][0]).toContain('中断されない作業時間');
      const text = collectText(root);
      for (const wrong of ['まだ登録がありません', 'まだ記録がありません', 'まだありません', '形式が不正', '再試行']) expect(text).not.toContain(wrong);
      expect(byClass(section(root, '観測'), 'bb-ws-notice')[0].className).toContain('is-warning');
    });

    it('shows one notice with the host copy and the reason when every section is unavailable', async () => {
      const { root } = await mount(allUnavailable, { unavailableNotice: HOST_COPY });
      const notices = byClass(root, 'bb-ws-notice');
      expect(notices).toHaveLength(1);
      expect(notices[0].children[0].textContent).toBe('未接続');
      expect(collectText(notices[0])).toBe('未接続この画面の現状と見通しは、まだどこにもつながっていません。理由: World Modelの読み取り元がありません。0件ではありません。');
      for (const label of ['変数とモデル', '観測', 'モデルの採用']) expect(section(root, label)).toBeUndefined();
      expect(byClass(root, 'bb-ws-ledger')).toHaveLength(0);
      // The section title stays; nothing reads as zero items.
      expect(findAll(byClass(root, 'bb-ws-section-title')[0], (node) => node.tagName === 'H2')[0].textContent).toBe('現状と見通し');
      for (const empty of ['まだ登録がありません', 'まだ記録がありません', 'まだありません']) expect(collectText(root)).not.toContain(empty);
    });

    it('says a reason code in the host words when the host names it, and keeps an unnamed code as it is', async () => {
      const code = 'organization_world_model_source_not_connected';
      const coded = Object.fromEntries(Object.keys(allUnavailable).map((path) => [path, unavailable(code)]));
      const named = await mount(coded, { unavailableNotice: { ...HOST_COPY, reasonLabels: { [code]: '組織版に現状と見通しの記録元がまだありません' } } });
      const namedText = collectText(byClass(named.root, 'bb-ws-notice')[0]);
      expect(namedText).toContain('理由: 組織版に現状と見通しの記録元がまだありません。0件ではありません。');
      expect(namedText).not.toContain(code);
      // An own label only: a code that happens to name an Object method stays as it is.
      const unnamed = await mount(coded, { unavailableNotice: { ...HOST_COPY, reasonLabels: { toString: 'x' } } });
      expect(collectText(byClass(unnamed.root, 'bb-ws-notice')[0])).toContain(`理由: ${code}。`);
    });

    it('keeps reporting each block when only some sections are unavailable, or when the host passed no copy', async () => {
      const partial = await mount({ ...allUnavailable, '/api/world-model/adoptions': jsonResponse(500, { error: { code: 'boom', message: '読めません' } }) }, { unavailableNotice: HOST_COPY });
      expect(collectText(partial.root)).not.toContain('未接続');
      expect(collectText(section(partial.root, 'モデルの採用'))).toContain('読み取れませんでした（読めません）。0件ではありません。');
      expect(collectText(section(partial.root, '観測'))).toContain('このホストでは読めません');

      const plain = await mount(allUnavailable);
      expect(byClass(plain.root, 'bb-ws-notice')).toHaveLength(4);
      for (const label of ['変数とモデル', '観測', 'モデルの採用']) expect(section(plain.root, label)).toBeDefined();
    });
  });
});
