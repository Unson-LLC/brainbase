import { describe, expect, it } from 'vitest';
import {
  createValueProofReviewUI,
  normalizeValueProofReviewHome,
  renderValueProofReview,
} from '../../ui/value-proof-review.js';
import {
  sourceBearingHome,
  sourceBearingProof,
  sourceFreeProof,
  UX06_SOURCE,
} from './ux06-source-fixture.mjs';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
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
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }
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

function byTag(node, tag) {
  return findAll(node, (element) => element?.tagName === tag.toUpperCase());
}

function proof(overrides = {}) {
  return {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: 'intent-1',
    decision_attempt_id: 'attempt-1',
    recorded_at: '2026-09-20T00:00:00.000Z',
    state: 'unconfirmed',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '稼働中の設定へ反映してよいですか？',
      question_digest: 'sha256:question',
      reason_code: 'routine_reversible_work',
      human_reason: null,
    },
    decision: {
      summary: '安全上必要な停止は維持したまま反映する',
      work_impact: '確認で止めず反映まで進めた',
      basis: [{ entity_id: 'dec-1', application: '可逆な設定変更は確認で止めない' }],
      prior_learning_reused: true,
    },
    execution: { status: 'completed', summary: '設定を反映した', artifact_refs: [] },
    outcome: { status: 'unconfirmed', summary: null, evidence_refs: [] },
    human_decision: null,
    feedback: { status: 'none', summary: null, evidence_ref: null },
    ...overrides,
  };
}

function ref(entry, rowKey) {
  return { intent_id: entry.intent_id, decision_attempt_id: entry.decision_attempt_id, row_key: rowKey };
}

function mapRow(key, entries, overrides = {}) {
  return {
    key,
    source: key.startsWith('kind:') ? 'judgment_kind' : key.startsWith('reason:') ? 'reason_code' : 'unrecorded',
    label: key.includes(':') ? key.slice(key.indexOf(':') + 1) : null,
    state: 'verifying',
    state_basis: { reason: 'no_feedback' },
    counts: {
      continued: entries.length, returned: 0, rated: 0,
      by_feedback: { accepted: 0, corrected: 0, next_time_ask: 0, reverted: 0 },
      corrected_or_reverted: 0, inherited: 0,
    },
    latest_recorded_at: entries[0]?.recorded_at ?? null,
    items: entries.map((entry) => ref(entry, key)),
    ...overrides,
  };
}

function delegationMap(rows, overrides = {}) {
  return {
    judged: rows.reduce((total, row) => total + row.items.length, 0),
    kind_recorded: rows.filter((row) => row.source === 'judgment_kind').reduce((total, row) => total + row.items.length, 0),
    rated: 0,
    rows,
    corrected_after_continue: [],
    continued_after_ask: [],
    ...overrides,
  };
}

function home(items = [proof()], map = delegationMap([mapRow('reason:routine_reversible_work', items)]), needsHuman = []) {
  return {
    status: 'available',
    root: '/tmp/journal',
    coverage: { saved: items.length + needsHuman.length, rejected: 0, latest_recorded_at: '2026-09-20T00:00:00.000Z', possibly_stalled: true },
    sections: {
      needs_human: needsHuman.map((entry) => ({ section: 'needs_human', proof: entry, feedback_history: [] })),
      blocked: [],
      continued: items.map((entry) => ({ section: 'continued', proof: entry, feedback_history: [] })),
      other: [],
    },
    delegation_map: map,
    rejected: [],
  };
}

function byClass(node, className) {
  return findAll(node, (element) => String(element?.className ?? '').split(' ').includes(className));
}

function baseState(payload, overrides = {}) {
  return {
    phase: 'ready',
    home: normalizeValueProofReviewHome(payload),
    selectedKey: null,
    selectedRowKey: null,
    railView: 'row',
    unratedOnly: false,
    needsHumanOnly: false,
    draft: { status: '', summary: '', targetLayer: '' },
    save: { state: 'idle', message: '' },
    sourceReads: new Map(),
    ...overrides,
  };
}

/** Renders into a root and a rail, as the local shell mounts the screen. */
function renderHome(payload, overrides = {}, options = {}) {
  const doc = new FakeDocument();
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  renderValueProofReview(root, baseState(payload, overrides), {}, { document: doc, rail, ...options });
  return { root, rail };
}

function docForTest() {
  const doc = new FakeDocument();
  return { doc, root: doc.createElement('main'), rail: doc.createElement('aside') };
}

/** Rows of a ledger (the header row excluded). */
function ledgerRows(ledger) {
  return byClass(ledger, 'bb-ws-ledger-row').filter((row) => !String(row.className).includes('bb-ws-ledger-head'));
}

function click(node) {
  node.listeners.get('click')();
}

/** The ledger's short date, in the runner's time zone like the UI. */
function md(iso) {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('value proof review UI contract', () => {
  it('opens a judgment named by another screen, waiting for the home to load first', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const first = proof({ intent_id: 'intent-1', decision_attempt_id: 'attempt-1' });
    const second = proof({ intent_id: 'intent-2', decision_attempt_id: 'attempt-2' });
    const ui = createValueProofReviewUI({
      root,
      document: doc,
      fetcher: async () => jsonResponse(200, home([first, second], delegationMap([mapRow('reason:routine_reversible_work', [first, second])]))),
      autoLoad: false,
    });
    expect(ui.openDecision('attempt-2')).toBe(false);
    await ui.load();
    expect(ui.state.selectedKey).toBe('intent-2\u0000attempt-2');
    expect(ui.state.railView).toBe('judgment');
    expect(ui.openDecision('attempt-1')).toBe(true);
    expect(ui.state.selectedKey).toBe('intent-1\u0000attempt-1');
    expect(ui.openDecision('no-such-attempt')).toBe(false);
    expect(ui.state.selectedKey).toBe('intent-1\u0000attempt-1');
  });

  it('never turns an unavailable or malformed response into an empty list', () => {
    expect(normalizeValueProofReviewHome({ status: 'unavailable', root: '/x', reason: 'judgment_journal_not_found' }))
      .toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });
    expect(normalizeValueProofReviewHome({ status: 'available', coverage: {}, sections: { continued: [{}] } }).status).toBe('invalid');

    const { root, rail } = renderHome({ status: 'unavailable', root: '/x', reason: 'judgment_journal_not_found' });
    const text = collectText(root);
    expect(text).toContain('判断journalに接続できません');
    expect(text).toContain('brainbase review:serve --journal <判断journalの場所>');
    expect(text).toContain('BRAINBASE_JUDGMENT_JOURNAL_DIR=<判断journalの場所>');
    expect(text).toContain('接続できる状態にしたら「再試行」を押してください。');
    expect(findAll(root, (element) => element.tagName === 'BUTTON' && element.textContent === '再試行')).toHaveLength(1);
    expect(text).toContain('0件としては扱いません');
    expect(text).not.toContain('聞かずに進めた');
    // No metrics at all: an unreadable journal is never shown as zero judgments.
    expect(byClass(root, 'bb-ws-summary')).toHaveLength(0);
    expect(byClass(root, 'bb-ws-notice')[0].className).toContain('is-danger');
    expect(collectText(rail)).toContain('判断を表示できません');
  });

  it('lets a host that cannot read a local journal replace the unavailable notice, still not as zero items', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const ui = createValueProofReviewUI({
      root,
      document: doc,
      fetcher: async () => jsonResponse(200, { status: 'unavailable', reason: 'value_proof_source_not_connected' }),
      unavailableNotice: { title: '判断の記録の出典が接続されていません', guidance: '記録は各自のMacにあり、このホストからは読めません。' },
      autoLoad: false,
    });
    await ui.load();
    const text = collectText(root);
    expect(text).toContain('判断の記録の出典が接続されていません');
    expect(text).toContain('記録は各自のMacにあり、このホストからは読めません。');
    expect(text).toContain('value_proof_source_not_connected');
    expect(text).toContain('0件としては扱いません');
    expect(text).not.toContain('--journal');
    expect(findAll(root, (element) => element.tagName === 'BUTTON' && element.textContent === '再試行')).toHaveLength(1);
    expect(text).not.toContain('場所: 不明');
  });

  it('retries after an unavailable journal once the setup is corrected', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    let retries = 0;
    const ui = createValueProofReviewUI({
      root,
      document: doc,
      fetcher: async () => {
        retries += 1;
        return jsonResponse(200, retries === 1
          ? { status: 'unavailable', root: '/x', reason: 'judgment_journal_not_found' }
          : home());
      },
      autoLoad: false,
    });
    await ui.load();
    click(findAll(root, (element) => element.tagName === 'BUTTON' && element.textContent === '再試行')[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(retries).toBe(2);
    expect(ui.state.phase).toBe('ready');
    expect(collectText(root)).toContain('委任の地図');
  });

  it('reports a failed request as an error with a retry, never as zero', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    let fail = true;
    const ui = createValueProofReviewUI({
      root,
      document: doc,
      fetcher: async () => (fail ? jsonResponse(500, { error: { message: '読めません' } }) : jsonResponse(200, home())),
      autoLoad: false,
    });
    await ui.load();
    expect(collectText(root)).toContain('判断の記録を取得できません（読めません）。0件ではありません。');
    expect(byClass(root, 'bb-ws-summary')).toHaveLength(0);
    fail = false;
    const retry = findAll(root, (element) => element.tagName === 'BUTTON' && element.textContent === '再試行')[0];
    click(retry);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.state.phase).toBe('ready');
    expect(collectText(root)).toContain('委任の地図');
  });

  it('builds the page head from the host page context, the 記録の範囲 notice and the metrics', () => {
    const payload = home();
    payload.coverage.saved = null;
    const { root } = renderHome(payload, {}, { page: { crumbs: ['あなたのBrainbase', '今日'], source: '判断journal' } });
    expect(collectText(byClass(root, 'bb-ws-breadcrumb')[0])).toBe('あなたのBrainbase/今日');
    expect(findAll(root, (element) => element.tagName === 'H1')[0].textContent).toBe('判断の見返し');
    expect(byClass(root, 'bb-ws-source')[0].textContent).toBe('判断journal');
    const notices = byClass(root, 'bb-ws-notice');
    expect(collectText(notices[0])).toContain('記録の範囲');
    expect(collectText(notices[0])).toContain('/tmp/journal');
    // The value-confirmation warning is separate and does not claim the whole journal stopped.
    const stalled = notices.find((element) => collectText(element).includes('価値の確認記録の停止'));
    expect(stalled.className).toContain('is-warning');
    const stalledText = collectText(stalled);
    expect(stalledText).toContain('しばらく新しい価値の確認記録（.value-proof.json）がありません。');
    expect(stalledText).toContain('判断journalには別の記録（episode/final）が書かれます');
    expect(stalledText).toContain('journal全体の停止を示しません。');
    expect(stalledText).toContain('journal全体の最新の書き込み状況は、この画面では確認できません。');
    expect(stalledText).toContain('0件・成功とは扱いません。');
    expect(stalledText).not.toContain('記録が止まっている可能性があります');
    const metrics = byClass(root, 'bb-ws-metric').map((element) => [element.children[0].textContent, element.children[1].textContent]);
    // An unknown saved count is 未確認, never zero.
    expect(metrics).toEqual([['保存済み', '未確認'], ['あなたの判断が必要', '0'], ['聞かずに進めた', '1'], ['評価済み', '0']]);
  });

  it('shows the card in the contract order and surfaces the recorded basis target', () => {
    const { root, rail } = renderHome(home(), { selectedKey: 'intent-1\u0000attempt-1', selectedRowKey: 'reason:routine_reversible_work', railView: 'judgment' });
    const detail = byClass(rail, 'bb-vpr-detail')[0];
    expect(detail.attributes['data-detail']).toBe('judgment');
    const facts = byClass(detail, 'bb-vpr-facts');
    expect(facts.flatMap((list) => byTag(list, 'dt').map((element) => element.textContent))).toEqual([
      '扱い', '判断', '仕事への影響', '根拠', '根拠の対象', '過去の学習の再利用', '引き継ぎ', '実行', '成果の確認', '評価',
    ]);
    // After the facts: the evaluation form, the consult action and the audit details, in that order.
    const titles = byClass(detail, 'bb-ws-rail-block').map((block) => block.attributes['aria-label'] ?? '');
    expect(titles).toEqual(['判断', '根拠と引き継ぎ', '実行と成果', '評価', 'Codexで相談', '']);
    expect(facts.map(collectText).join('')).toContain('dec-1');
    expect(facts.map(collectText).join('')).not.toContain('attempt-1');
    expect(collectText(byClass(detail, 'bb-vpr-audit')[0])).toContain('attempt-1');
    // The workspace keeps only the ledgers; the card lives in the rail.
    expect(byClass(root, 'bb-vpr-detail')).toHaveLength(0);
  });

  it('says the inheritance is unrecorded instead of inventing it, and shows it when recorded', () => {
    const render = (entry) => {
      const { rail } = renderHome(home([entry]), { selectedKey: 'intent-1\u0000attempt-1', railView: 'judgment' });
      return byClass(rail, 'bb-vpr-facts').map(collectText).join('');
    };

    expect(render(proof())).toContain('引き継ぎの記録なし');

    const recorded = proof();
    recorded.decision = {
      ...recorded.decision,
      basis: [{ entity_id: 'objective-1', application: 'フロントの総対応負荷を減らす', layer: 'objective' }],
      judgment_kind: { key: 'evaluation_design', label: '実証の評価設計' },
      inheritance: {
        sources: [{ kind: 'method', ref: 'method-total-load', version: '2', label: 'ホテルAの総負荷の評価方法' }],
        same_conditions: ['問い合わせ自動化の実証である'],
        rechecked_conditions: ['ホテルBの作業記録の方法'],
      },
    };
    const text = render(recorded);
    expect(text).toContain('[目的] フロントの総対応負荷を減らす');
    expect(text).toContain('ホテルAの総負荷の評価方法。今回も同じ: 問い合わせ自動化の実証である。今回だけ確認: ホテルBの作業記録の方法');
  });

  it('keeps a basis without a source target explicit and does not invent a link', () => {
    const entry = proof();
    entry.decision = { ...entry.decision, basis: [] };
    const { rail } = renderHome(home([entry]), { selectedKey: 'intent-1\u0000attempt-1', railView: 'judgment' });
    const detail = byClass(rail, 'bb-vpr-detail')[0];
    const factsText = byClass(detail, 'bb-vpr-facts').map(collectText).join('');
    expect(factsText).toContain('根拠の記録なし');
    expect(factsText).toContain('対象の記録なし');
    expect(byTag(detail, 'A')).toHaveLength(0);
  });

  it('links a source-bearing basis only after the host confirms the exact Graph target', async () => {
    const fixture = sourceBearingProof();
    const payload = sourceBearingHome(fixture);
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    let resolveSource;
    const ui = createValueProofReviewUI({
      root,
      rail,
      document: doc,
      fetcher: async () => jsonResponse(200, payload),
      sourceReader: async (source) => {
        expect(source).toEqual(UX06_SOURCE);
        return new Promise((resolve) => { resolveSource = resolve; });
      },
      autoLoad: false,
    });
    await ui.load();
    ui.callbacks.onSelect('fixture-intent-ux06\u0000fixture-attempt-ux06');
    expect(collectText(rail)).toContain('出典を確認中');
    expect(byTag(rail, 'A')).toHaveLength(0);

    resolveSource({ state: 'available' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const links = byTag(rail, 'A');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('出典を開く');
    expect(links[0].attributes.href).toBe('#graph?entity_id=project-atlas');
  });

  it('keeps a source-free basis non-navigable and reports failed source reads as unconfirmed', () => {
    const sourceKey = [UX06_SOURCE.kind, UX06_SOURCE.entity_id, UX06_SOURCE.entity_type, UX06_SOURCE.version ?? '', UX06_SOURCE.digest ?? ''].join('\u0000');
    const sourceFree = sourceFreeProof();
    const sourceFreeState = baseState(sourceBearingHome(sourceFree), {
      selectedKey: 'fixture-intent-ux06\u0000fixture-attempt-ux06',
      railView: 'judgment',
    });
    const sourceFreeRoot = docForTest();
    renderValueProofReview(sourceFreeRoot.root, sourceFreeState, {}, { document: sourceFreeRoot.doc, rail: sourceFreeRoot.rail });
    expect(byTag(sourceFreeRoot.rail, 'A')).toHaveLength(0);

    for (const state of ['not_found', 'ambiguous', 'forbidden', 'unavailable']) {
      const rendered = docForTest();
      const stateWithRead = baseState(sourceBearingHome(), {
        selectedKey: 'fixture-intent-ux06\u0000fixture-attempt-ux06',
        railView: 'judgment',
        sourceReads: new Map([[sourceKey, { state }]]),
      });
      renderValueProofReview(rendered.root, stateWithRead, {}, { document: rendered.doc, rail: rendered.rail });
      expect(byTag(rendered.rail, 'A'), state).toHaveLength(0);
      expect(collectText(rendered.rail), state).toContain('未確認');
    }
  });

  it('requires a reason for corrections, posts with the review token and confirms the saved feedback by reloading', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    const requests = [];
    let current = home();
    const fetcher = async (path, init) => {
      requests.push({ path, init });
      if (path.endsWith('/home')) return jsonResponse(200, current);
      current = home([proof({ feedback: { status: 'next_time_ask', summary: '本番は次回は聞く', evidence_ref: { kind: 'human_feedback', ref: 'x', status: 'verified' } } })]);
      return jsonResponse(201, { created: true });
    };
    const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher, token: 'token-123', autoLoad: false });
    await ui.load();
    const item = ui.state.home.sections.continued[0];

    ui.callbacks.onDraft({ status: 'corrected', summary: '' });
    await ui.callbacks.onSubmit(item);
    expect(ui.state.save).toMatchObject({ state: 'error' });
    expect(requests.filter((entry) => entry.init?.method === 'POST')).toHaveLength(0);

    ui.callbacks.onDraft({ status: 'next_time_ask', summary: '本番は次回は聞く' });
    await ui.callbacks.onSubmit(item);
    const post = requests.find((entry) => entry.init?.method === 'POST');
    expect(post.init.headers['X-Brainbase-Review-Token']).toBe('token-123');
    expect(JSON.parse(post.init.body)).toMatchObject({ decision_attempt_id: 'attempt-1', status: 'next_time_ask' });
    expect(ui.state.save.state).toBe('saved');
    expect(ui.state.save.message).toContain('読み戻し済み');
    // The read-back is shown on the rated judgment's card in the rail.
    expect(ui.state.railView).toBe('judgment');
    expect(collectText(rail)).toContain('「次回は聞く」を保存しました（読み戻し済み）。');
  });

  it('keeps the read-back on the rated judgment even when the unrated filter now hides it', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    const second = proof({ intent_id: 'intent-2', decision_attempt_id: 'attempt-2' });
    let current = home([proof(), second], delegationMap([mapRow('kind:k1', [proof(), second])]));
    const fetcher = async (path) => {
      if (path.endsWith('/home')) return jsonResponse(200, current);
      const rated = proof({ feedback: { status: 'accepted', summary: null, evidence_ref: { kind: 'human_feedback', ref: 'x', status: 'verified' } } });
      current = home([rated, second], delegationMap([mapRow('kind:k1', [rated, second])]));
      return jsonResponse(201, { created: true });
    };
    const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher, token: 't', autoLoad: false });
    await ui.load();
    ui.callbacks.onToggleUnrated(true);
    ui.callbacks.onSelect('intent-1\u0000attempt-1');
    ui.callbacks.onDraft({ status: 'accepted' });
    await ui.callbacks.onSubmit(ui.state.home.sections.continued[0]);
    expect(ui.state.selectedKey).toBe('intent-1\u0000attempt-1');
    expect(collectText(rail)).toContain('「採用」を保存しました（読み戻し済み）。');
  });

  it('asks what a correction changes and sends it with the correction', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const requests = [];
    let current = home();
    const fetcher = async (path, init) => {
      requests.push({ path, init });
      if (path.endsWith('/home')) return jsonResponse(200, current);
      current = home([proof({ feedback: { status: 'corrected', summary: '目的が実証だった', evidence_ref: { kind: 'human_feedback', ref: 'x', status: 'verified' } } })]);
      return jsonResponse(201, { created: true });
    };
    const ui = createValueProofReviewUI({ root, document: doc, fetcher, token: 'token-123', autoLoad: false });
    await ui.load();
    const item = ui.state.home.sections.continued[0];

    ui.callbacks.onDraft({ status: 'corrected', summary: '目的が実証だった' });
    await ui.callbacks.onSubmit(item);
    expect(ui.state.save.message).toContain('何を直すか');
    expect(requests.filter((entry) => entry.init?.method === 'POST')).toHaveLength(0);

    ui.callbacks.onDraft({ targetLayer: 'objective' });
    await ui.callbacks.onSubmit(item);
    const post = requests.find((entry) => entry.init?.method === 'POST');
    expect(JSON.parse(post.init.body)).toMatchObject({ status: 'corrected', target_layer: 'objective' });
    expect(ui.state.save.state).toBe('saved');
  });

  it('keeps the draft and reports the reason when saving fails', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const fetcher = async (path) => (path.endsWith('/home')
      ? jsonResponse(200, home())
      : jsonResponse(403, { error: { code: 'review_token_required', message: 'A valid review token is required' } }));
    const ui = createValueProofReviewUI({ root, document: doc, fetcher, token: 'wrong', autoLoad: false });
    await ui.load();
    ui.callbacks.onDraft({ status: 'accepted', summary: '' });
    await ui.callbacks.onSubmit(ui.state.home.sections.continued[0]);
    expect(ui.state.save.state).toBe('error');
    expect(ui.state.save.message).toContain('A valid review token is required');
    expect(ui.state.draft.status).toBe('accepted');
  });

  it('treats a response without the delegation map as invalid instead of an empty map', () => {
    const payload = home();
    delete payload.delegation_map;
    expect(normalizeValueProofReviewHome(payload)).toMatchObject({ status: 'invalid', reason: '委任の地図の形式が不正です' });
  });

  it('shows kind rows first in the map ledger with their state, and keeps judgments without a kind apart', () => {
    const kinded = proof({ intent_id: 'intent-2', decision_attempt_id: 'attempt-2', recorded_at: '2026-09-21T00:00:00.000Z' });
    kinded.decision = { ...kinded.decision, judgment_kind: { key: 'production_release', label: '本番への反映' } };
    const unkinded = proof();
    const { root, rail } = renderHome(home([kinded, unkinded], delegationMap([
      mapRow('kind:production_release', [kinded], {
        label: '本番への反映', state: 'delegated',
        state_basis: { reason: 'latest_feedback', status: 'accepted', target_layer: null, at: '2026-09-22T00:00:00.000Z' },
        counts: {
          continued: 1, returned: 0, rated: 1,
          by_feedback: { accepted: 1, corrected: 0, next_time_ask: 0, reverted: 0 },
          corrected_or_reverted: 0, inherited: 0,
        },
      }),
      mapRow('reason:routine_reversible_work', [unkinded]),
    ])), { selectedRowKey: 'kind:production_release' });
    const map = byClass(root, 'bb-vpr-map')[0];
    const text = collectText(map);

    expect(text.indexOf('本番への反映')).toBeLessThan(text.indexOf('判断の種類が記録されていない判断'));
    // Rows without a kind sit under their own heading and name only the reason code.
    expect(text).toContain('理由: routine_reversible_work');
    expect(text).not.toContain('判断の種類はまだ記録されていません');
    const ledgers = byClass(map, 'bb-vpr-map-ledger');
    expect(ledgers.map((ledger) => ledger.className)).toEqual(['bb-ws-ledger bb-vpr-map-ledger', 'bb-ws-ledger bb-vpr-map-ledger is-unrecorded']);
    expect(byClass(ledgers[0], 'bb-ws-ledger-head')[0].children.map((cell) => cell.textContent))
      .toEqual(['判断の種類', '状態', '判断', '評価', '訂正・取り消し', '最新']);
    const [kindRow] = ledgerRows(ledgers[0]);
    expect(kindRow.children.map(collectText)).toEqual(['本番への反映', '任せている', '続行 1・戻した 0', '1件（採用 1）', '0件', md('2026-09-21T00:00:00.000Z')]);
    // The selected row is marked, and only its judgments are listed, in the rail.
    expect(kindRow.className).toContain('is-selected');
    expect(ledgerRows(ledgers[1])[0].className).not.toContain('is-selected');
    const detail = collectText(rail);
    expect(detail).toContain('判断の種類');
    expect(detail).toContain('任せている：最新の評価が採用');
    expect(byClass(rail, 'bb-vpr-item')).toHaveLength(1);
    expect(detail).toContain('稼働中の設定へ反映してよいですか？');
  });

  it('uses the row label for an older judgment after a kind is relabelled', async () => {
    const older = proof({
      intent_id: 'intent-old',
      decision_attempt_id: 'attempt-old',
      recorded_at: '2026-09-20T00:00:00.000Z',
    });
    older.decision = {
      ...older.decision,
      judgment_kind: { key: 'kind-renamed', label: '以前の分類名' },
    };
    const newer = proof({
      intent_id: 'intent-new',
      decision_attempt_id: 'attempt-new',
      recorded_at: '2026-09-22T00:00:00.000Z',
    });
    newer.decision = {
      ...newer.decision,
      judgment_kind: { key: 'kind-renamed', label: '現在の分類名' },
    };
    const other = proof({
      intent_id: 'intent-other',
      decision_attempt_id: 'attempt-other',
      recorded_at: '2026-09-21T00:00:00.000Z',
    });
    other.decision = {
      ...other.decision,
      judgment_kind: { key: 'other-kind', label: '別の分類名' },
    };
    const renamedRow = mapRow('kind:kind-renamed', [newer, older], { label: '現在の分類名' });
    const otherRow = mapRow('kind:other-kind', [other], { label: '別の分類名' });
    const payload = home([newer, older, other], delegationMap([renamedRow, otherRow]));
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    const ui = createValueProofReviewUI({
      root,
      rail,
      document: doc,
      fetcher: async () => jsonResponse(200, payload),
      autoLoad: false,
    });
    await ui.load();

    const map = byClass(root, 'bb-vpr-map')[0];
    expect(collectText(map)).toContain('現在の分類名');
    expect(collectText(map)).toContain('別の分類名');
    expect(collectText(rail)).toContain('現在の分類名');

    // Every detail must agree with its selected row, including the old label
    // and a different kind. The row counts must partition the fixture.
    const rows = ledgerRows(byClass(map, 'bb-vpr-map-ledger')[0]);
    expect(rows).toHaveLength(2);
    const displayedCounts = rows.map((row) => {
      const match = /^続行 (\d+)・戻した (\d+)$/.exec(collectText(row.children[2]));
      expect(match).not.toBeNull();
      return Number(match[1]) + Number(match[2]);
    });
    expect(displayedCounts).toEqual([2, 1]);
    expect(displayedCounts.reduce((total, count) => total + count, 0)).toBe(3);
    expect(displayedCounts.reduce((total, count) => total + count, 0)).toBe(ui.state.home.delegationMap.kindRecorded);
    for (const [rowIndex, expectedLabel, expectedCount] of [
      [0, '現在の分類名', 2],
      [1, '別の分類名', 1],
    ]) {
      click(ledgerRows(byClass(root, 'bb-vpr-map-ledger')[0])[rowIndex]);
      const items = byClass(rail, 'bb-vpr-item');
      expect(items).toHaveLength(expectedCount);
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        click(byClass(rail, 'bb-vpr-item')[itemIndex]);
        const detail = collectText(rail);
        expect(detail).toContain(`判断の種類: ${expectedLabel}`);
        expect(detail).not.toContain('判断の種類: 以前の分類名');
        click(byClass(rail, 'bb-vpr-back')[0]);
      }
    }
  });

  it('gives the rail the row the owner selects, then the judgment picked from it, and goes back to the row', async () => {
    const first = proof();
    const second = proof({ intent_id: 'intent-2', decision_attempt_id: 'attempt-2' });
    second.interruption = { ...second.interruption, question_display_text: '合成の2件目ですか？' };
    const payload = home([first, second], delegationMap([
      mapRow('kind:k1', [first], { label: '一つ目の種類' }),
      mapRow('kind:k2', [second], { label: '二つ目の種類', state: 'returned', state_basis: { reason: 'latest_judgment_returned', at: second.recorded_at } }),
    ]));
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher: async () => jsonResponse(200, payload), autoLoad: false });
    await ui.load();
    // The first row is selected when the screen opens.
    expect(ui.state.selectedRowKey).toBe('kind:k1');
    expect(byClass(rail, 'bb-ws-rail-head').map(collectText)[0]).toContain('一つ目の種類');

    click(ledgerRows(byClass(root, 'bb-vpr-map-ledger')[0])[1]);
    expect(ui.state.selectedRowKey).toBe('kind:k2');
    const head = collectText(byClass(rail, 'bb-ws-rail-head')[0]);
    expect(head).toContain('判断の種類');
    expect(head).toContain('二つ目の種類');
    expect(head).toContain('戻している：最新の判断をあなたに戻した');
    expect(byClass(rail, 'bb-vpr-item').map((button) => collectText(button))).toEqual([expect.stringContaining('合成の2件目ですか？')]);

    click(byClass(rail, 'bb-vpr-item')[0]);
    expect(ui.state.selectedKey).toBe('intent-2\u0000attempt-2');
    expect(byClass(rail, 'bb-vpr-detail')[0].attributes['data-detail']).toBe('judgment');
    expect(collectText(byClass(rail, 'bb-ws-rail-head')[0])).toContain('合成の2件目ですか？');
    expect(byClass(rail, 'vpr-feedback')).toHaveLength(1);

    click(byClass(rail, 'bb-vpr-back')[0]);
    expect(byClass(rail, 'bb-vpr-detail')[0].attributes['data-detail']).toBe('row');
    expect(collectText(rail)).toContain('二つ目の種類');
  });

  it('without a rail, renders the same detail inline after the workspace content', () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    renderValueProofReview(root, baseState(home(), { selectedKey: 'intent-1\u0000attempt-1', railView: 'judgment' }), {}, { document: doc });
    const surface = root.children[0];
    expect(surface.attributes['data-layout']).toBe('inline');
    const last = surface.children.at(-1);
    expect(last.className).toBe('bb-vpr-inline-detail');
    const order = surface.children.map((child) => String(child.className));
    expect(order.indexOf('bb-vpr-map')).toBeLessThan(order.indexOf('bb-vpr-inline-detail'));
    expect(collectText(last)).toContain('扱い');
    expect(byClass(last, 'vpr-feedback')).toHaveLength(1);
    // No placeholder is added inline when nothing is selected.
    const empty = doc.createElement('main');
    renderValueProofReview(empty, baseState({ status: 'unavailable', reason: 'judgment_journal_not_found' }), {}, { document: doc });
    expect(byClass(empty, 'bb-vpr-inline-detail')).toHaveLength(0);
    expect(byClass(empty, 'bb-ws-detail-empty')).toHaveLength(0);
  });

  it('separates an unanswered human decision from post-execution feedback and copy-only consultation', () => {
    const waiting = proof({
      intent_id: 'intent-w',
      decision_attempt_id: 'attempt-w',
      state: 'waiting_human',
      interruption: {
        resolution: 'human_required',
        question_display_text: '本番へ反映しますか？',
        question_digest: 'sha256:waiting-question',
        reason_code: 'irreversible_external_action',
        human_reason: '外部への反映は本人が決める必要があります',
      },
      human_decision: {
        question: '本番へ反映しますか？',
        why_human: '外部への反映は本人が決める必要があります',
        options: [
          { id: 'approve', label: '反映する', impact: '本番へ反映します' },
          { id: 'hold', label: '保留する', impact: '反映せずに止めます' },
        ],
      },
    });
    const payload = home([], delegationMap([
      mapRow('reason:irreversible_external_action', [waiting], {
        state: 'returned',
        state_basis: { reason: 'latest_judgment_returned', at: waiting.recorded_at },
      }),
    ]), [waiting]);
    const { rail } = renderHome(payload, {
      selectedKey: 'intent-w\u0000attempt-w',
      selectedRowKey: 'reason:irreversible_external_action',
      railView: 'judgment',
    });

    expect(collectText(byClass(rail, 'bb-vpr-human-decision')[0]))
      .toContain('この画面では、人に戻した判断への回答や作業の再開はできません。');
    expect(collectText(byClass(rail, 'bb-vpr-feedback-block')[0]))
      .toContain('評価は、実行後の振り返りとして記録します。人に戻した判断への回答や承認ではありません。');
    expect(collectText(rail)).toContain('相談文をコピーするだけで、この画面からCodexへは送信しません。');
  });

  describe('answering a judgment returned to the owner', () => {
    const waitingProof = () => proof({
      intent_id: 'intent-w',
      decision_attempt_id: 'attempt-w',
      state: 'waiting_human',
      interruption: {
        resolution: 'human_required',
        question_display_text: '本番へ反映しますか？',
        question_digest: 'sha256:waiting-question',
        reason_code: 'irreversible_external_action',
        human_reason: '外部への反映は本人が決める必要があります',
      },
      human_decision: {
        question: '本番へ反映しますか？',
        why_human: '外部への反映は本人が決める必要があります',
        options: [
          { id: 'approve', label: '反映する', impact: '本番へ反映します' },
          { id: 'hold', label: '保留する', impact: '反映せずに止めます' },
        ],
      },
    });
    const recorded = {
      schema_version: 'brainbase-judgment-value-proof-answer-v1',
      answer_id: 'sha256:answer',
      intent_id: 'intent-w',
      decision_attempt_id: 'attempt-w',
      question_sha256: 'sha256:q',
      kind: 'select',
      selected_option_id: 'approve',
      selected_option_label: '反映する',
      owner_confirmation: 'local_web_confirmed',
      resume: 'not_started',
      recorded_at: '2026-10-04T07:00:00.000Z',
    };
    const answerHome = (answer = null) => {
      const waiting = waitingProof();
      const payload = home([], delegationMap([
        mapRow('reason:irreversible_external_action', [waiting], {
          state: 'returned',
          state_basis: { reason: 'latest_judgment_returned', at: waiting.recorded_at },
        }),
      ]), [waiting]);
      payload.sections.needs_human[0].answer = answer;
      payload.capabilities = { answer: 'record_only' };
      return payload;
    };
    const buttons = (node, label) => findAll(node, (element) => element.tagName === 'BUTTON' && element.textContent === label);

    it('offers each option and 「どれも選ばない」, says what recording does, and keeps evaluation separate', () => {
      const { rail } = renderHome(answerHome(), {
        selectedKey: 'intent-w\u0000attempt-w', selectedRowKey: 'reason:irreversible_external_action', railView: 'judgment',
      });
      const block = byClass(rail, 'bb-vpr-human-decision')[0];
      expect(buttons(block, '「反映する」で回答する')).toHaveLength(1);
      expect(buttons(block, '「保留する」で回答する')).toHaveLength(1);
      expect(buttons(block, 'どれも選ばない')).toHaveLength(1);
      expect(collectText(block)).toContain('この画面で、選択肢を選んで回答を記録できます。記録しても、止まった作業は自動では再開しません。');
      expect(collectText(block)).not.toContain('この画面では、人に戻した判断への回答や作業の再開はできません。');
      expect(collectText(byClass(rail, 'bb-vpr-feedback-block')[0]))
        .toContain('評価は、実行後の振り返りとして記録します。人に戻した判断への回答や承認ではありません。');
    });

    it('asks for confirmation, then posts the confirmed answer with the token and shows it after reading it back', async () => {
      const doc = new FakeDocument();
      const root = doc.createElement('main');
      const rail = doc.createElement('aside');
      const requests = [];
      let current = answerHome();
      const fetcher = async (path, init) => {
        requests.push({ path, init });
        if (path.endsWith('/home')) return jsonResponse(200, current);
        current = answerHome(recorded);
        return jsonResponse(201, { created: true, record: recorded });
      };
      const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher, token: 'token-123', autoLoad: false });
      await ui.load();
      ui.callbacks.onSelect('intent-w\u0000attempt-w');
      expect(buttons(root, 'あなたの判断が必要 1件')).toHaveLength(1);

      click(buttons(rail, '「反映する」で回答する')[0]);
      const confirm = collectText(byClass(rail, 'bb-vpr-human-decision')[0]);
      expect(confirm).toContain('「反映する」で回答を記録します。');
      expect(confirm).toContain('記録した回答は、この画面では変更・取り消しできません。');
      expect(requests.filter((entry) => entry.init?.method === 'POST')).toHaveLength(0);

      await buttons(rail, '回答を記録する')[0].listeners.get('click')();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const post = requests.find((entry) => entry.init?.method === 'POST');
      expect(post.path).toBe('/api/value-proofs/answers');
      expect(post.init.headers['X-Brainbase-Review-Token']).toBe('token-123');
      expect(JSON.parse(post.init.body)).toEqual({
        intent_id: 'intent-w', decision_attempt_id: 'attempt-w', kind: 'select', selected_option_id: 'approve', confirmed: true,
      });
      expect(ui.state.answerSave).toMatchObject({ state: 'saved', message: '回答を記録しました（読み戻し済み）。' });
      const after = collectText(byClass(rail, 'bb-vpr-human-decision')[0]);
      expect(after).toContain('「反映する」と回答しました');
      expect(after).toContain('止まった作業は自動では再開しません。続きを進めるときは、AIにこの回答を伝えて頼み直してください。');
      expect(buttons(rail, '「保留する」で回答する')).toHaveLength(0);
      expect(buttons(root, 'あなたの判断が必要 0件')).toHaveLength(1);
    });

    it('sends nothing when the owner cancels the confirmation', async () => {
      const doc = new FakeDocument();
      const root = doc.createElement('main');
      const rail = doc.createElement('aside');
      const requests = [];
      const fetcher = async (path, init) => {
        requests.push({ path, init });
        return jsonResponse(200, answerHome());
      };
      const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher, token: 't', autoLoad: false });
      await ui.load();
      ui.callbacks.onSelect('intent-w\u0000attempt-w');
      click(buttons(rail, 'どれも選ばない')[0]);
      expect(collectText(rail)).toContain('「どれも選ばない」で回答を記録します。');
      click(buttons(rail, 'やめる')[0]);
      expect(ui.state.answerDraft).toBeNull();
      expect(buttons(rail, '「反映する」で回答する')).toHaveLength(1);
      expect(requests.filter((entry) => entry.init?.method === 'POST')).toHaveLength(0);
    });

    it('shows a different answer recorded meanwhile instead of claiming the new one, and reports a failed send as not recorded', async () => {
      const doc = new FakeDocument();
      const root = doc.createElement('main');
      const rail = doc.createElement('aside');
      let current = answerHome();
      let status = 409;
      const fetcher = async (path) => {
        if (path.endsWith('/home')) return jsonResponse(200, current);
        if (status === 409) {
          current = answerHome({ ...recorded, selected_option_id: 'hold', selected_option_label: '保留する' });
          return jsonResponse(409, { error: { code: 'answer_conflict', message: 'A different answer is already recorded for this judgment' } });
        }
        return jsonResponse(403, { error: { code: 'review_token_required', message: 'A valid review token is required' } });
      };
      const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher, token: 't', autoLoad: false });
      await ui.load();
      ui.callbacks.onSelect('intent-w\u0000attempt-w');
      click(buttons(rail, '「反映する」で回答する')[0]);
      await ui.callbacks.onAnswerConfirm(ui.state.home.sections.needs_human[0]);
      expect(ui.state.answerSave.message).toContain('この問いには、すでに別の回答が記録されています。');
      expect(collectText(rail)).toContain('「保留する」と回答しました');

      current = answerHome();
      status = 403;
      await ui.load();
      ui.callbacks.onSelect('intent-w\u0000attempt-w');
      click(buttons(rail, '「反映する」で回答する')[0]);
      await ui.callbacks.onAnswerConfirm(ui.state.home.sections.needs_human[0]);
      expect(ui.state.answerSave).toMatchObject({ state: 'error' });
      expect(ui.state.answerSave.message).toContain('A valid review token is required');
      expect(ui.state.answerSave.message).toContain('回答はまだ記録されていません。');
    });

    it('does not say "not recorded" when the host accepted the answer but the read-back failed', async () => {
      const doc = new FakeDocument();
      const root = doc.createElement('main');
      const rail = doc.createElement('aside');
      let homeFails = false;
      const fetcher = async (path) => {
        if (path.endsWith('/home')) {
          return homeFails
            ? jsonResponse(500, { error: { code: 'internal_error', message: 'journal read failed' } })
            : jsonResponse(200, answerHome());
        }
        homeFails = true;
        return jsonResponse(201, { created: true, record: recorded });
      };
      const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher, token: 't', autoLoad: false });
      await ui.load();
      ui.callbacks.onSelect('intent-w\u0000attempt-w');
      click(buttons(rail, '「反映する」で回答する')[0]);
      await ui.callbacks.onAnswerConfirm(ui.state.home.sections.needs_human[0]);
      expect(ui.state.answerSave.state).toBe('error');
      expect(ui.state.answerSave.message).toContain('回答は送信しましたが、記録を確かめられませんでした');
      expect(ui.state.answerSave.message).not.toContain('回答はまだ記録されていません');
    });

    it('shows a judgment whose conversation moved on as such, offers no answer, and leaves it out of the count', () => {
      const payload = answerHome();
      payload.sections.needs_human[0].conversation_moved_on_at = '2026-10-04T07:32:00.000Z';
      const { root, rail } = renderHome(payload, {
        selectedKey: 'intent-w\u0000attempt-w', selectedRowKey: 'reason:irreversible_external_action', railView: 'judgment',
      });
      const block = byClass(rail, 'bb-vpr-human-decision')[0];
      expect(collectText(block)).toContain('この問いのあと、同じ会話で次のやり取りがありました');
      expect(collectText(block)).toContain('この画面では回答を受け付けません。続きが必要なら、元の会話で頼んでください。');
      expect(collectText(block)).not.toContain('この問いに回答する');
      expect(findAll(block, (element) => element.tagName === 'BUTTON')).toHaveLength(0);
      expect(collectText(rail)).toContain('会話で先に進んだ');
      expect(collectText(rail)).not.toContain('回答済み');
      expect(buttons(root, 'あなたの判断が必要 0件')).toHaveLength(1);
      expect(collectText(byClass(root, 'bb-ws-summary')[0])).toContain('会話で先に進んだものを除く');
    });

    it('shows the moved-on note also on a host that does not offer recording answers', () => {
      const payload = answerHome();
      delete payload.capabilities;
      payload.sections.needs_human[0].conversation_moved_on_at = '2026-10-04T07:32:00.000Z';
      const { rail } = renderHome(payload, {
        selectedKey: 'intent-w\u0000attempt-w', selectedRowKey: 'reason:irreversible_external_action', railView: 'judgment',
      });
      const block = byClass(rail, 'bb-vpr-human-decision')[0];
      expect(collectText(block)).toContain('この問いのあと、同じ会話で次のやり取りがありました');
      expect(collectText(block)).not.toContain('この画面では、人に戻した判断への回答や作業の再開はできません。');
    });

    it('keeps the 回答できません note on a host that does not offer recording answers', () => {
      const payload = answerHome();
      delete payload.capabilities;
      const { rail } = renderHome(payload, {
        selectedKey: 'intent-w\u0000attempt-w', selectedRowKey: 'reason:irreversible_external_action', railView: 'judgment',
      });
      const block = byClass(rail, 'bb-vpr-human-decision')[0];
      expect(collectText(block)).toContain('この画面では、人に戻した判断への回答や作業の再開はできません。');
      expect(findAll(block, (element) => element.tagName === 'BUTTON')).toHaveLength(0);
    });

    it('marks an answered judgment in its list entry and keeps it out of the needs-owner filter', async () => {
      const doc = new FakeDocument();
      const root = doc.createElement('main');
      const rail = doc.createElement('aside');
      const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher: async () => jsonResponse(200, answerHome(recorded)), autoLoad: false });
      await ui.load();
      expect(collectText(rail)).toContain('回答済み');
      const toggle = buttons(root, 'あなたの判断が必要 0件')[0];
      expect(toggle.attributes.disabled).toBe('');
      const metrics = collectText(byClass(root, 'bb-ws-summary')[0]);
      expect(metrics).toContain('回答済みを除く');
    });
  });

  it('says that no kind and no evaluation are recorded yet instead of inventing them', () => {
    const text = collectText(renderHome(home()).root);
    expect(text).toContain('判断の種類はまだ記録されていません');
    expect(text).toContain('まだ評価がありません');
    expect(text).not.toContain('聞かずに進めたが直した判断');
  });

  it('puts corrected judgments and judgments that continued after an ask above the map, as ledgers the owner selects', () => {
    const corrected = proof({ feedback: { status: 'corrected', summary: '合成の理由', evidence_ref: { kind: 'human_feedback', ref: 'x', status: 'verified' } } });
    const afterAsk = proof({ intent_id: 'intent-2', decision_attempt_id: 'attempt-2' });
    afterAsk.interruption = { ...afterAsk.interruption, question_display_text: '合成の2回目ですか？' };
    const payload = home([corrected, afterAsk], delegationMap([mapRow('kind:daily_routine', [afterAsk, corrected], { label: '朝夜のルーティン' })], {
      rated: 1,
      corrected_after_continue: [ref(corrected, 'kind:daily_routine')],
      continued_after_ask: [ref(afterAsk, 'kind:daily_routine')],
    }));
    payload.sections.continued[0].feedback_history = [{ status: 'corrected', summary: '合成の理由', target_layer: 'method', recorded_at: '2026-09-21T00:00:00.000Z' }];
    const selected = [];
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    renderValueProofReview(root, baseState(payload), { onSelect: (key) => selected.push(key) }, { document: doc, rail: doc.createElement('aside') });
    const surface = root.children[0];
    const highlights = byClass(root, 'bb-vpr-highlight');

    expect(highlights.map((element) => element.className)).toEqual(['bb-vpr-highlight is-corrected', 'bb-vpr-highlight is-after-ask']);
    expect(surface.children.indexOf(highlights[1])).toBeLessThan(surface.children.indexOf(byClass(root, 'bb-vpr-map')[0]));
    const [correctedRow] = ledgerRows(byClass(highlights[0], 'bb-vpr-judgment-ledger')[0]);
    expect(correctedRow.children.map(collectText)).toEqual(['稼働中の設定へ反映してよいですか？', '朝夜のルーティン', '訂正（判断方法）: 合成の理由', md('2026-09-20T00:00:00.000Z')]);
    expect(collectText(highlights[1])).toContain('合成の2回目ですか？');
    click(ledgerRows(byClass(highlights[1], 'bb-vpr-judgment-ledger')[0])[0]);
    expect(selected).toEqual(['intent-2\u0000attempt-2']);
  });

  it('narrows the map to judgments waiting for the owner with the head toggle', async () => {
    const waiting = proof({ intent_id: 'intent-w', decision_attempt_id: 'attempt-w', state: 'waiting_human' });
    waiting.interruption = { ...waiting.interruption, resolution: 'human_required', question_display_text: '合成の戻した確認ですか？' };
    const continued = proof();
    const payload = home([continued], delegationMap([
      mapRow('reason:owner_value_choice', [waiting], { state: 'returned', state_basis: { reason: 'latest_judgment_returned', at: waiting.recorded_at } }),
      mapRow('reason:routine_reversible_work', [continued]),
    ]), [waiting]);
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher: async () => jsonResponse(200, payload), autoLoad: false });
    await ui.load();
    const toggle = findAll(root, (element) => element.tagName === 'BUTTON' && element.textContent === 'あなたの判断が必要 1件')[0];
    expect(toggle.attributes['aria-pressed']).toBe('false');

    click(toggle);
    const map = collectText(byClass(root, 'bb-vpr-map')[0]);
    expect(map).toContain('owner_value_choice');
    expect(map).not.toContain('routine_reversible_work');
    expect(ui.state.selectedKey).toBe('intent-w\u0000attempt-w');
    expect(ui.state.selectedRowKey).toBe('reason:owner_value_choice');
    expect(collectText(rail)).toContain('合成の戻した確認ですか？');
    expect(collectText(rail)).toContain('最新の判断をあなたに戻した');
    const pressed = findAll(root, (element) => element.tagName === 'BUTTON' && element.textContent.startsWith('あなたの判断が必要 1件（絞り込み中'))[0];
    expect(pressed.attributes['aria-pressed']).toBe('true');
  });

  it('disables the needs-owner toggle when nothing waits, instead of showing an empty filter', async () => {
    const { root } = renderHome(home());
    const toggle = findAll(root, (element) => element.tagName === 'BUTTON' && element.textContent === 'あなたの判断が必要 0件')[0];
    expect(toggle.attributes.disabled).toBe('');
  });

  it('moves the selection to a visible judgment and selects its row when a filter hides the selected one', async () => {
    const rated = proof({ feedback: { status: 'accepted', summary: null, evidence_ref: { kind: 'human_feedback', ref: 'x', status: 'verified' } } });
    const unrated = proof({ intent_id: 'intent-2', decision_attempt_id: 'attempt-2' });
    const payload = home([rated, unrated], delegationMap([mapRow('kind:k1', [rated]), mapRow('kind:k2', [unrated])]));
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    const ui = createValueProofReviewUI({ root, rail, document: doc, fetcher: async () => jsonResponse(200, payload), autoLoad: false });
    await ui.load();
    expect(ui.state.selectedKey).toBe('intent-1\u0000attempt-1');
    expect(ui.state.selectedRowKey).toBe('kind:k1');

    ui.callbacks.onToggleUnrated(true);
    expect(ui.state.selectedKey).toBe('intent-2\u0000attempt-2');
    expect(ui.state.selectedRowKey).toBe('kind:k2');
    const rows = ledgerRows(byClass(root, 'bb-vpr-map-ledger')[0]);
    expect(rows[1].className).toContain('is-selected');
    expect(collectText(rail)).toContain('稼働中の設定へ反映してよいですか？');

    // A row whose judgments are all hidden says so instead of listing nothing.
    click(rows[0]);
    expect(collectText(rail)).toContain('未評価の判断はありません。');
  });
});
