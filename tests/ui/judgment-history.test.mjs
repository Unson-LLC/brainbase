import { describe, expect, it, vi } from 'vitest';
import {
  aggregateJudgmentHistory,
  createJudgmentHistoryUI,
  normalizeJudgmentHistoryHome,
} from '../../ui/judgment-history.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
      contains: name => this.className.split(' ').includes(name),
    };
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.ownerDocument = null;
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(entry => entry !== child);
      child.parentNode = this;
      this.children.push(child);
    }
  }

  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'value') this.value = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  get isConnected() { return Boolean(this.parentNode) || this === this.ownerDocument?.body; }
  contains(target) { return this === target || this.children.some(child => child.contains?.(target)); }
  querySelector() { return findAll(this, node => ['BUTTON', 'SELECT', 'INPUT'].includes(node.tagName))[0] ?? null; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}

class FakeDocument {
  constructor() { this.activeElement = null; }
  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }
}

class DialogDocument extends FakeDocument {
  constructor() {
    super(); this.body = this.createElement('body'); this.listeners = new Map();
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  createElement(tag) {
    const element = super.createElement(tag);
    if (tag === 'dialog') {
      element.open = false;
      element.showModal = () => { element.open = true; };
      element.close = () => { element.open = false; element.listeners.get('close')?.(); };
    }
    return element;
  }
}

function findAll(node, predicate, result = []) {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, result);
  return result;
}

function collectText(node) {
  return `${node?.textContent ?? ''}${(node?.children ?? []).map(collectText).join('')}`;
}

function proof(overrides = {}) {
  return {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: 'intent-1',
    decision_attempt_id: 'attempt-1',
    recorded_at: '2026-10-05T09:00:00.000Z',
    state: 'unconfirmed',
    interruption: { resolution: 'continued_without_human', reason_code: 'routine' },
    decision: {
      summary: '週次報告を既存の項目で進める',
      basis: [
        { entity_id: 'objective-weekly', entity_version: 'v1', application: '週次報告の項目', layer: 'method' },
        { entity_id: 'objective-weekly', entity_version: 'v1', application: '重複した参照' },
      ],
      inheritance: { sources: [{ ref: 'objective-weekly', version: 'v1', label: '継承した週次基準', kind: 'method' }] },
    },
    execution: { status: 'completed', summary: '報告を送った' },
    outcome: { status: 'unconfirmed', summary: null, evidence_refs: ['execution-1'] },
    ...overrides,
  };
}

function home(items, overrides = {}) {
  return {
    status: 'available',
    root: '/journal',
    coverage: { saved: items.length, rejected: 0, latest_recorded_at: items[0]?.proof?.recorded_at ?? null, possibly_stalled: false },
    sections: {
      needs_human: [],
      blocked: [],
      continued: items,
      other: [],
    },
    rejected: [],
    ...overrides,
  };
}

function normalRecord(overrides = {}) {
  return {
    schema_version: 'brainbase-judgment-history-record-v1',
    record_id: 'normal-record-1',
    entrypoint: 'codex',
    recorded_at: '2026-10-05T09:00:00.000Z',
    project_code: 'project-atlas',
    turn_ref: 'turn-1',
    judgment: {
      status: 'selected',
      summary: '既存の項目で進める',
      reason: '当時のプロジェクト基準に一致するため',
      selected_references: [{
        ref: 'objective-atlas',
        kind: 'objective',
        version: 'v2',
        digest: 'sha256:old',
        why: '当時の基準',
        usage: '判断の根拠',
        availability: 'recorded',
      }],
      alternatives: [{ label: '確認してから進める', evaluation: '時間がかかる', adopted: true }],
    },
    execution: { status: 'completed', result_summary: '処理を完了した', outcome_status: 'confirmed' },
    missing_fields: [],
    ...overrides,
  };
}

function normalHome(records, overrides = {}) {
  return {
    contract_version: 'brainbase.judgment-history.v1',
    status: 'available',
    records,
    coverage: {
      complete: true,
      storage: 'local',
      sources: [{ entrypoint: 'codex', status: 'available', reason: null }],
      total: records.length,
    },
    pagination: { next_cursor: null, previous_cursor: null, limit: 50, has_next: false },
    filters: {
      period: 'past30days',
      project: null,
      entrypoint: null,
      projects: [{ value: 'project-atlas', label: 'Atlas' }],
      entrypoints: [{ value: 'codex', label: 'Codex' }],
    },
    ...overrides,
  };
}

const item = (value, section = 'continued') => ({ section, proof: value, feedback_history: [] });
const OWNER_NOW = new Date('2026-10-06T09:00:00.000Z');

describe('judgment history projection', () => {
  it('deduplicates by latest intent before applying period and counts only delegated decisions and their unique refs', () => {
    const latestOutsidePeriod = proof({
      recorded_at: '2026-10-07T09:00:00.000Z',
      decision_attempt_id: 'attempt-newer',
      decision: { summary: '新しいが未来の記録', basis: [{ entity_id: 'outside', application: '未来の記録' }] },
    });
    const olderInsidePeriod = proof({
      recorded_at: '2026-10-01T09:00:00.000Z',
      decision_attempt_id: 'attempt-older',
      decision: { summary: '古いが期間内', basis: [{ entity_id: 'inside', application: '期間内' }] },
    });
    const human = proof({
      intent_id: 'intent-human',
      decision_attempt_id: 'attempt-human',
      interruption: { resolution: 'returned_to_human' },
      decision: { summary: '本人に確認する', basis: [{ entity_id: 'human-ref', application: '確認対象' }] },
    });
    const result = aggregateJudgmentHistory(home([
      item(latestOutsidePeriod), item(olderInsidePeriod), item(human, 'needs_human'),
    ]), { now: OWNER_NOW, period: 'past30days' });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].decisionAttemptId).toBe('attempt-human');
    expect(result.stats.judgments).toBe(0);
    expect(result.stats.references).toBe(0);
  });

  it('keeps the newest delegated record, deduplicates basis and inheritance refs, and applies search', () => {
    const result = aggregateJudgmentHistory(home([
      item(proof()),
      item(proof({ intent_id: 'intent-2', decision_attempt_id: 'attempt-2', recorded_at: '2026-10-04T09:00:00.000Z' })),
    ]), { now: OWNER_NOW, period: 'all', query: '継承した週次基準' });
    expect(result.rows).toHaveLength(2);
    expect(result.stats.judgments).toBe(2);
    expect(result.stats.references).toBe(1);
    expect(result.stats.equivalent).toBe(2);
    expect(result.rows[0].references).toHaveLength(1);
    expect(result.rows[0].references[0].application).toBe('週次報告の項目');
    expect(result.rows[0].references[0].labels).toContain('継承した週次基準');
  });

  it('searches interruption, human decision, execution and outcome context', () => {
    const searchable = proof({
      intent_id: 'intent-search-context',
      decision_attempt_id: 'attempt-search-context',
      interruption: {
        resolution: 'continued_without_human',
        question_display_text: '承認ルートを確認する',
        human_reason: '権限判断が必要',
      },
      human_decision: {
        question: '担当者へ確認する',
        why_human: '重要な変更なので確認が必要',
        options: [{ label: '進める', impact: '公開範囲を確認する' }],
      },
      execution: { status: 'completed', summary: '実行要約検索語' },
      outcome: { status: 'confirmed', summary: '結果要約検索語' },
    });
    for (const query of [
      '承認ルートを確認する',
      '権限判断が必要',
      '担当者へ確認する',
      '重要な変更なので確認が必要',
      '進める',
      '公開範囲を確認する',
      '実行要約検索語',
      '結果要約検索語',
    ]) {
      const result = aggregateJudgmentHistory(home([item(searchable)]), { now: OWNER_NOW, period: 'all', query });
      expect(result.rows, query).toHaveLength(1);
    }
  });

  it('keeps confirmed empty, unknown, partial and unavailable states distinct', () => {
    const empty = normalizeJudgmentHistoryHome(home([], { coverage: { saved: 0, rejected: 0, complete: true } }));
    const partial = normalizeJudgmentHistoryHome(home([], { status: 'partial', coverage: { saved: 0, rejected: 1 } }));
    const unknown = normalizeJudgmentHistoryHome(home([], { coverage: { saved: 0, rejected: 0, status: 'unknown' } }));
    const unavailable = normalizeJudgmentHistoryHome({ status: 'unavailable', root: '/journal', reason: 'not_found' });
    expect(empty.status).toBe('available');
    expect(partial.status).toBe('partial');
    expect(unknown.status).toBe('partial');
    expect(unavailable.status).toBe('unavailable');
    expect(aggregateJudgmentHistory(empty, { now: OWNER_NOW }).stats.judgments).toBe(0);
    expect(aggregateJudgmentHistory(partial, { now: OWNER_NOW }).stats).toEqual(expect.objectContaining({ judgments: null, references: null, equivalent: null }));
    expect(aggregateJudgmentHistory(unknown, { now: OWNER_NOW }).stats).toEqual(expect.objectContaining({ judgments: null, references: null, equivalent: null }));
    expect(aggregateJudgmentHistory(unavailable, { now: OWNER_NOW }).stats.judgments).toBeNull();
  });

  it('keeps partial metrics numeric when at least one readable row exists', () => {
    const partial = normalizeJudgmentHistoryHome(home([item(proof())], {
      status: 'partial',
      coverage: { saved: 1, rejected: 1 },
      rejected: [{ file: 'rejected.json', reason: 'invalid_record' }],
    }));
    const result = aggregateJudgmentHistory(partial, { now: OWNER_NOW, period: 'all' });
    expect(partial.status).toBe('partial');
    expect(result.rows).toHaveLength(1);
    expect(result.stats).toEqual(expect.objectContaining({ judgments: 1, references: 1, equivalent: 1 }));
  });

  it('projects normal judgment records without converting them into value proofs', () => {
    const missing = normalRecord({
      record_id: 'normal-record-2',
      entrypoint: 'mana',
      recorded_at: '2026-10-04T09:00:00.000Z',
      project_code: null,
      turn_ref: null,
      judgment: {
        status: 'unrecorded',
        summary: null,
        reason: null,
        selected_references: null,
        alternatives: null,
      },
      execution: { status: 'unknown', result_summary: null, outcome_status: 'unknown' },
      missing_fields: ['judgment.reason', 'judgment.selected_references'],
    });
    const normalized = normalizeJudgmentHistoryHome(normalHome([normalRecord(), missing]));
    const result = aggregateJudgmentHistory(normalized, { now: OWNER_NOW, period: 'all' });

    expect(normalized.mode).toBe('normal');
    expect(result.mode).toBe('normal');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].recordId).toBe('normal-record-1');
    expect(result.rows[0].record).toBeTruthy();
    expect(result.rows[0].proof).toBeUndefined();
    expect(result.rows[0].references[0]).toEqual(expect.objectContaining({ version: 'v2', digest: 'sha256:old', why: '当時の基準' }));
    expect(result.rows[1].references).toBeNull();
    expect(result.rows[1].alternatives).toBeNull();
    expect(result.stats).toEqual(expect.objectContaining({ judgments: 2, references: null, confirmedOutcomes: 1 }));
  });

  it('keeps retrieved records separate from authoritative normal totals', () => {
    const records = Array.from({ length: 5 }, (_, index) => normalRecord({ record_id: `count-${index}` }));
    const partial = aggregateJudgmentHistory(normalHome(records, {
      status: 'partial', coverage: { complete: false, total: null },
    }), { now: OWNER_NOW });
    expect(partial.stats.judgments).toBeNull();
    expect(partial.retrievedCount).toBe(5);
    expect(partial.countComplete).toBe(false);
    const complete = aggregateJudgmentHistory(normalHome(records, {
      coverage: { complete: true, total: 20 },
      pagination: { next_cursor: 'next', has_next: true, limit: 5 },
    }), { now: OWNER_NOW });
    expect(complete.stats.judgments).toBe(20);
    expect(complete.retrievedCount).toBe(5);
    expect(complete.countComplete).toBe(true);
    const searched = aggregateJudgmentHistory(normalHome(records, {
      coverage: { complete: true, total: 20 },
    }), { now: OWNER_NOW, query: '既存' });
    expect(searched.stats.judgments).toBeNull();
    expect(searched.countComplete).toBe(false);
    const unknownEmpty = aggregateJudgmentHistory(normalHome([], {
      coverage: { complete: true, total: null },
    }), { now: OWNER_NOW });
    expect(unknownEmpty.totalCount).toBeNull();
    expect(unknownEmpty.stats.judgments).toBeNull();
  });

  it.each([0, 5])('labels a partial normal read of %i rows without claiming a total', async (count) => {
    const root = new FakeElement('div');
    const view = createJudgmentHistoryUI({
      root, document: new FakeDocument(), autoLoad: false, now: OWNER_NOW,
      fetcher: async () => ({ ok: true, status: 200, json: async () => normalHome(
        Array.from({ length: count }, (_, index) => normalRecord({ record_id: `partial-count-${index}` })),
        { status: 'partial', coverage: { complete: false, total: null } },
      ) }),
    });
    await view.load();
    expect(findAll(root, (node) => node.className === 'bb-ws-metric')).toHaveLength(0);
    expect(collectText(root)).toContain('一部の記録だけを表示中');
    if (count === 0) expect(collectText(root)).toContain('0件とは確認できません');
    view.dispose();
  });

  it('does not assert absence when an empty complete response lacks its total', async () => {
    const root = new FakeElement('div');
    const view = createJudgmentHistoryUI({
      root, document: new FakeDocument(), autoLoad: false, now: OWNER_NOW,
      fetcher: async () => ({ ok: true, status: 200, json: async () => normalHome([], {
        coverage: { complete: true, total: null },
      }) }),
    });
    await view.load();
    expect(collectText(root)).toContain('0件とは確認できません');
    expect(collectText(root)).not.toContain('この期間の判断履歴はありません。');
    view.dispose();
  });

  it('filters malformed normal collection entries while preserving the missing and partial state', () => {
    const malformed = normalRecord({
      judgment: {
        ...normalRecord().judgment,
        selected_references: [
          { ref: '' },
          { ref: 'objective-valid', version: 'v1', availability: 'recorded' },
        ],
        alternatives: [{ label: '候補', evaluation: '確認が必要', adopted: null }, null],
      },
    });
    const normalized = normalizeJudgmentHistoryHome(normalHome([malformed]));

    expect(normalized.status).toBe('partial');
    expect(normalized.reason).toBe('record_invalid');
    expect(normalized.records[0].selectedReferences).toHaveLength(1);
    expect(normalized.records[0].selectedReferences[0].ref).toBe('objective-valid');
    expect(normalized.records[0].alternatives).toHaveLength(1);
    expect(normalized.records[0].alternatives[0].adopted).toBeNull();
    expect(normalized.records[0].missingFields).toEqual(expect.arrayContaining([
      'judgment.selected_references',
      'judgment.alternatives',
    ]));
  });
});

describe('judgment history UI', () => {
  it('renders the three-column history and read-only detail without a summary band', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      fetcher: async () => ({ ok: true, status: 200, json: async () => home([item(proof())]) }),
      now: OWNER_NOW,
    });
    await view.load();
    expect(findAll(root, (node) => node.attributes['role'] === 'table')).toHaveLength(1);
    expect(findAll(root, (node) => node.attributes['role'] === 'columnheader').map((node) => node.textContent)).toEqual(['日時', '行った判断', '使った参照', '入口・状態']);
    expect(findAll(root, (node) => node.className === 'bb-ws-metric')).toHaveLength(0);
    expect(collectText(root)).toContain('週次報告の項目');
    expect(collectText(rail)).toContain('使った参照');
    expect(findAll(root, (node) => node.tagName === 'FORM')).toHaveLength(0);
    view.dispose();
    expect(root.children).toHaveLength(0);
  });

  it('retains the warning and retry for an empty partial read without a summary band', async () => {
    const root = new FakeElement('div');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    const view = createJudgmentHistoryUI({
      root,
      document: doc,
      autoLoad: false,
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => home([], {
          coverage: { saved: 0, rejected: 1, status: 'unknown' },
          rejected: [{ file: 'rejected.json', reason: 'invalid_record' }],
        }),
      }),
      now: OWNER_NOW,
    });
    await view.load();
    const metrics = findAll(root, (node) => node.className === 'bb-ws-metric');
    expect(metrics).toHaveLength(0);
    expect(findAll(root, node => node.attributes['aria-label'] === '判断履歴を再読み込み')).toHaveLength(1);
    expect(collectText(root)).toContain('一部の記録だけを表示中');
    expect(collectText(root)).not.toContain('0回分相当');
    view.dispose();
  });

  it('labels the readable range and keeps records when a partial read has rows', async () => {
    const root = new FakeElement('div');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    const view = createJudgmentHistoryUI({
      root,
      document: doc,
      autoLoad: false,
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => home([item(proof())], {
          status: 'partial',
          coverage: { saved: 1, rejected: 1 },
          rejected: [{ file: 'rejected.json', reason: 'invalid_record' }],
        }),
      }),
      now: OWNER_NOW,
    });
    await view.load();
    const metrics = findAll(root, (node) => node.className === 'bb-ws-metric');
    expect(metrics).toHaveLength(0);
    expect(collectText(root)).toContain('週次報告の項目');
    expect(collectText(root)).toContain('一部の記録だけを表示中');
    view.dispose();
  });

  it('closes the selected detail with Escape and restores focus to its history row', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async () => ({ ok: true, status: 200, json: async () => home([item(proof())]) }),
      now: OWNER_NOW,
    });
    await view.load();
    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    expect(row).toBeTruthy();
    row.focus();
    row.listeners.get('click')();
    expect(collectText(rail)).toContain('週次報告を既存の項目で進める');
    const selectedRow = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    expect(doc.activeElement).toBe(selectedRow);

    root.listeners.get('keydown')({ key: 'Escape' });

    const restoredRow = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    expect(collectText(rail)).toContain('履歴を選択');
    expect(doc.activeElement).toBe(restoredRow);
    view.dispose();
  });

  it('renders four structured evidence references in the selected history detail', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const entry = proof({
      outcome: {
        status: 'unconfirmed',
        summary: '結果はまだ確認できない',
        evidence_refs: [
          { kind: 'canonical_readback', ref: 'readback-1', status: 'verified', label: '正本の読み戻し' },
          { kind: 'tool_event', ref: 'tool-2', status: 'unconfirmed', label: '実行イベント' },
          { kind: 'artifact', ref: 'artifact-3', status: 'verified' },
          { kind: 'human_feedback', ref: 'feedback-4', status: 'unconfirmed', label: '本人の反応' },
        ],
      },
    });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async () => ({ ok: true, status: 200, json: async () => home([item(entry)]) }),
      now: OWNER_NOW,
    });
    await view.load();
    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    row.listeners.get('click')();
    const detailText = collectText(rail);

    expect(detailText).toContain('正本の読み戻し（canonical_readback:readback-1）（確認済み）');
    expect(detailText).toContain('実行イベント（tool_event:tool-2）（未確認）');
    expect(detailText).toContain('artifact:artifact-3（確認済み）');
    expect(detailText).toContain('本人の反応（human_feedback:feedback-4）（未確認）');
    expect(detailText).not.toContain('[object Object]');
    view.dispose();
  });

  it('labels an evidence reference without identifying information as unavailable', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const entry = proof({
      outcome: { status: 'unconfirmed', summary: null, evidence_refs: [{}] },
    });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async () => ({ ok: true, status: 200, json: async () => home([item(entry)]) }),
      now: OWNER_NOW,
    });
    await view.load();
    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    row.listeners.get('click')();
    const detailText = collectText(rail);

    expect(detailText).toContain('証拠の識別情報は未確認（未確認）');
    expect(detailText).not.toContain('[object Object]');
    view.dispose();
  });

  it('ignores a late response after dispose', async () => {
    let resolve;
    const response = new Promise((settle) => { resolve = settle; });
    const root = new FakeElement('div');
    const view = createJudgmentHistoryUI({ root, document: new FakeDocument(), fetcher: async () => response });
    view.dispose();
    resolve({ ok: true, status: 200, json: async () => home([item(proof())]) });
    await response;
    await new Promise((settle) => setTimeout(settle, 0));
    expect(root.children).toHaveLength(0);
  });

  it('opens a deep-linked decision after the history response arrives', async () => {
    let resolve;
    const pending = new Promise((settle) => { resolve = settle; });
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: new FakeDocument(),
      fetcher: async () => pending,
      now: OWNER_NOW,
    });
    expect(view.openDecision('attempt-1')).toBe(true);
    resolve({ ok: true, status: 200, json: async () => home([item(proof())]) });
    await view.load();
    expect(collectText(rail)).toContain('週次報告を既存の項目で進める');
  });

  it('uses the normal history endpoint, keeps partial warning singular, and reads record details separately', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const record = normalRecord({
      record_id: 'normal-detail-1',
      judgment: {
        ...normalRecord().judgment,
        alternatives: [
          { label: '確認してから進める', evaluation: '時間がかかる', adopted: true },
          { label: '別案を保留する', evaluation: '記録なし', adopted: null },
        ],
      },
    });
    const calls = [];
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async (path) => {
        calls.push(path);
        if (path.includes('/records/normal-detail-1')) return { ok: true, status: 200, json: async () => ({ status: 'available', record }) };
        return {
          ok: true,
          status: 200,
          json: async () => normalHome([record], {
            status: 'partial',
            coverage: {
              complete: false,
              storage: 'server',
              total: null,
              reason: 'unconnected',
              sources: [{ entrypoint: 'mana', status: 'unavailable', reason: 'unconnected' }],
            },
          }),
        };
      },
      now: OWNER_NOW,
    });
    await view.load();

    const text = collectText(root);
    expect(calls[0]).toMatch(/^\/api\/judgment-history\/home\?period=past30days&limit=50$/u);
    expect((text.match(/一部の記録だけを表示中/gu) ?? [])).toHaveLength(1);
    expect(text).toContain('Mana：未接続');
    expect(text).toContain('18:00');
    expect(text).not.toContain('18:00に確認');
    expect(text).toContain('既存の項目で進める');
    const banner = findAll(root, (node) => node.className?.split(' ').includes('bb-jh-banner'))[0];
    expect(findAll(banner, (node) => node.tagName === 'BUTTON' && node.textContent === '再読み込み')).toHaveLength(0);
    expect(findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === '判断履歴を再読み込み')).toHaveLength(1);
    const detail = findAll(root, (node) => node.tagName === 'DETAILS')[0];
    expect(collectText(detail)).toContain('組織のサーバー');
    expect(collectText(detail)).toContain('理由コード: unconnected');

    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    row.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.some((path) => path === '/api/judgment-history/records/normal-detail-1')).toBe(true);
    expect(collectText(rail)).toContain('当時の基準');
    expect(collectText(rail)).toContain('保存された案');
    expect(collectText(rail)).toContain('採用状態: 記録なし');
    expect(collectText(rail)).toContain('結果確認済み');
    view.dispose();
  });

  it('keeps home references visible while the normal detail is loading and after it fails', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const record = normalRecord({ record_id: 'normal-detail-fallback-1' });
    let resolveDetail;
    const detailPending = new Promise((resolve) => { resolveDetail = resolve; });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async (path) => {
        if (path.includes('/records/normal-detail-fallback-1')) return detailPending;
        return { ok: true, status: 200, json: async () => normalHome([record]) };
      },
      now: OWNER_NOW,
    });
    await view.load();

    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    row.listeners.get('click')();
    expect(collectText(rail)).toContain('当時の基準');
    expect(collectText(rail)).toContain('正本の詳細を確認しています。');

    resolveDetail({ ok: false, status: 503 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(collectText(rail)).toContain('当時の基準');
    expect(collectText(rail)).toContain('正本の詳細を確認できないため、追記は利用できません。');
    view.dispose();
  });

  it('prefers refreshed detail references after a successful canonical readback', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const homeRecord = normalRecord({ record_id: 'normal-detail-updated-1' });
    const detailRecord = normalRecord({
      record_id: 'normal-detail-updated-1',
      judgment: {
        ...normalRecord().judgment,
        selected_references: [{
          ref: 'objective-updated',
          kind: 'objective',
          version: 'v3',
          digest: 'sha256:new',
          why: '更新後の基準',
          usage: '更新後の判断の根拠',
          availability: 'recorded',
        }],
      },
    });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async (path) => {
        if (path.includes('/records/normal-detail-updated-1')) {
          return { ok: true, status: 200, json: async () => ({ status: 'available', record: detailRecord }) };
        }
        return { ok: true, status: 200, json: async () => normalHome([homeRecord]) };
      },
      now: OWNER_NOW,
    });
    await view.load();

    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    row.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(collectText(rail)).toContain('更新後の基準');
    expect(collectText(rail)).not.toContain('当時の基準');
    view.dispose();
  });

  it('labels an unconnected Company OS native source while keeping readable records visible', async () => {
    const root = new FakeElement('div');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    const record = normalRecord({ entrypoint: 'company_os', record_id: 'company-os-partial-1' });
    const view = createJudgmentHistoryUI({
      root,
      document: doc,
      autoLoad: false,
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => normalHome([record], {
          status: 'partial',
          coverage: {
            complete: false,
            storage: 'server',
            total: null,
            sources: [{
              entrypoint: 'company_os',
              status: 'partial',
              reason: 'company_os_native_source_not_connected',
            }],
          },
        }),
      }),
      now: OWNER_NOW,
    });

    await view.load();

    const text = collectText(root);
    expect(text).toContain('Company OS：一部（実行履歴は未接続）');
    expect(text).toContain('既存の項目で進める');
    view.dispose();
  });

  it('posts a feedback event with an explicit result state and marks it saved only after canonical readback', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const record = normalRecord({ record_id: 'normal-feedback-1' });
    const calls = [];
    let detailReads = 0;
    let posted;
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async (path, init = {}) => {
        calls.push({ path, init });
        if (path.endsWith('/feedback')) {
          posted = JSON.parse(init.body);
          return { ok: true, status: 201, json: async () => ({ status: 'accepted' }) };
        }
        if (path.endsWith('/records/normal-feedback-1')) {
          detailReads += 1;
          const detail = detailReads > 1
            ? { ...record, feedback_events: [{
              record_id: record.record_id,
              event_id: posted?.event_id,
              kind: posted?.kind,
              content: posted?.content,
            }] }
            : record;
          return { ok: true, status: 200, json: async () => ({ status: 'available', record: detail }) };
        }
        return { ok: true, status: 200, json: async () => normalHome([record]) };
      },
      now: OWNER_NOW,
    });
    await view.load();
    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    row.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const content = findAll(rail, (node) => node.attributes['aria-label'] === '追記の内容')[0];
    const resultStatus = findAll(rail, (node) => node.attributes['aria-label'] === '結果の確認状態')[0];
    expect(content).toBeTruthy();
    content.value = '顧客の返信を確認した';
    content.listeners.get('input')({ target: content });
    resultStatus.value = 'confirmed';
    resultStatus.listeners.get('change')({ target: resultStatus });
    const submit = findAll(rail, (node) => node.attributes['data-action'] === 'submit-judgment-feedback')[0];
    submit.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(posted).toEqual(expect.objectContaining({
      record_id: 'normal-feedback-1',
      kind: 'feedback',
      content: { summary: '顧客の返信を確認した', outcome_status: 'confirmed' },
    }));
    expect(posted.event_id).toBeTruthy();
    expect(collectText(rail)).toContain('保存済み（正本で確認しました）。');
    expect(calls.filter(({ path }) => path.endsWith('/feedback'))).toHaveLength(1);
    expect(detailReads).toBeGreaterThanOrEqual(2);
    view.dispose();
  });

  it('keeps an accepted feedback event unconfirmed when the canonical readback has no matching event', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const record = normalRecord({ record_id: 'normal-feedback-unconfirmed' });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async (path) => {
        if (path.endsWith('/feedback')) return { ok: true, status: 201, json: async () => ({ status: 'accepted' }) };
        if (path.includes('/records/')) return { ok: true, status: 200, json: async () => ({ status: 'available', record }) };
        return { ok: true, status: 200, json: async () => normalHome([record]) };
      },
      now: OWNER_NOW,
    });
    await view.load();
    findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0].listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const content = findAll(rail, (node) => node.attributes['aria-label'] === '追記の内容')[0];
    content.value = '受付だけで正本にはまだ見えていない';
    content.listeners.get('input')({ target: content });
    findAll(rail, (node) => node.attributes['data-action'] === 'submit-judgment-feedback')[0].listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(collectText(rail)).toContain('未確認。');
    expect(collectText(rail)).not.toContain('保存済み（正本で確認しました）。');
    view.dispose();
  });

  it('copies a stable record and feedback reference with the applicability reason without writing a new judgment', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const doc = new FakeDocument();
    root.ownerDocument = doc;
    rail.ownerDocument = doc;
    const record = normalRecord({
      record_id: 'normal-reference-1',
      feedback_events: [{ record_id: 'normal-reference-1', event_id: 'event-reference-1', kind: 'result', content: { summary: '結果を確認した' } }],
    });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: doc,
      autoLoad: false,
      fetcher: async (path) => {
        if (path.includes('/records/')) return { ok: true, status: 200, json: async () => ({ status: 'available', record }) };
        return { ok: true, status: 200, json: async () => normalHome([record]) };
      },
      now: OWNER_NOW,
    });
    await view.load();
    findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0].listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(collectText(rail)).toContain('event_id=event-reference-1');
    const reason = findAll(rail, (node) => node.attributes['aria-label'] === '適用理由（event-reference-1）')[0];
    const copy = findAll(rail, (node) => node.attributes['data-action'] === 'copy-judgment-reference')[0];
    reason.value = '同じ契約条件の判断なので参照する';
    copy.listeners.get('click')();
    let payload = findAll(rail, (node) => node.className === 'bb-jh-reference-payload')[0].textContent;
    for (let attempt = 0; attempt < 20 && !/judgment-history-feedback:normal-reference-1:[a-f0-9]{64}/u.test(payload); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      payload = findAll(rail, (node) => node.className === 'bb-jh-reference-payload')[0].textContent;
    }
    expect(payload).toContain('"ref": "judgment-history:normal-reference-1"');
    expect(payload).toContain('"event_id": "event-reference-1"');
    expect(payload).toContain('"why": "同じ契約条件の判断なので参照する"');
    expect(payload).toMatch(/judgment-history-feedback:normal-reference-1:[a-f0-9]{64}/u);
    expect(findAll(rail, (node) => node.attributes['data-action'] === 'submit-judgment-feedback')).toHaveLength(1);
    view.dispose();
  });

  it('requests the next normal page and appends records while preserving the reported total', async () => {
    const root = new FakeElement('div');
    const doc = new FakeDocument();
    const first = normalRecord({ record_id: 'normal-page-1' });
    const second = normalRecord({ record_id: 'normal-page-2', recorded_at: '2026-10-04T09:00:00.000Z' });
    const calls = [];
    const view = createJudgmentHistoryUI({
      root,
      document: doc,
      autoLoad: false,
      fetcher: async (path) => {
        calls.push(path);
        const next = path.includes('cursor=next-page');
        return {
          ok: true,
          status: 200,
          json: async () => normalHome(next ? [second, first] : [first], {
            coverage: { complete: true, storage: 'local', total: 2 },
            pagination: { next_cursor: next ? null : 'next-page', limit: 1, has_next: !next },
          }),
        };
      },
      now: OWNER_NOW,
    });
    await view.load();
    expect(findAll(root, (node) => node.className === 'bb-ws-metric')).toHaveLength(0);
    expect(collectText(root)).toContain('同じ範囲の件数: 2件');
    const nextButton = findAll(root, (node) => node.attributes['data-action'] === 'next-page')[0];
    expect(nextButton).toBeTruthy();
    nextButton.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls[1]).toContain('cursor=next-page');
    expect(findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')).toHaveLength(2);
    expect(collectText(root)).toContain('同じ範囲の件数: 2件');
    view.dispose();
  });

  it('sends normal period and entrypoint filters from the rendered controls', async () => {
    const root = new FakeElement('div');
    const doc = new FakeDocument();
    const calls = [];
    const view = createJudgmentHistoryUI({
      root,
      document: doc,
      autoLoad: false,
      fetcher: async (path) => {
        calls.push(path);
        return { ok: true, status: 200, json: async () => normalHome([normalRecord()]) };
      },
      now: OWNER_NOW,
    });

    await view.load();
    const weekButton = findAll(root, (node) => node.attributes['data-period'] === 'week')[0];
    weekButton.listeners.get('click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls[1]).toContain('period=week');

    const entrypoint = findAll(root, (node) => node.tagName === 'SELECT' && node.attributes['aria-label'] === '入口')[0];
    entrypoint.value = 'mana';
    entrypoint.listeners.get('change')({ target: entrypoint });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls[2]).toContain('period=week');
    expect(calls[2]).toContain('entrypoint=mana');
    view.dispose();
  });

  it('hides an unknown reason code outside the source detail', async () => {
    const root = new FakeElement('div');
    const view = createJudgmentHistoryUI({
      root,
      document: new FakeDocument(),
      autoLoad: false,
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => normalHome([normalRecord()], {
          status: 'partial',
          coverage: {
            complete: false,
            storage: 'local',
            total: null,
            sources: [{ entrypoint: 'codex', status: 'partial', reason: 'totally_unknown_code' }],
          },
        }),
      }),
      now: OWNER_NOW,
    });
    await view.load();
    const banner = findAll(root, (node) => node.className?.split(' ').includes('bb-jh-banner'))[0];
    const chips = collectText(findAll(banner, (node) => node.className === 'bb-jh-banner-sources')[0]);
    expect(chips).toContain('Codex：一部（理由を確かめられません）');
    expect(chips).not.toContain('totally_unknown_code');
    expect(collectText(findAll(root, (node) => node.tagName === 'DETAILS')[0])).toContain('理由コード: totally_unknown_code');
    view.dispose();
  });

  it('shows unlabeled references as a count and keeps the id in the rail', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    const record = normalRecord({
      record_id: 'unlabeled-1',
      judgment: {
        ...normalRecord().judgment,
        status: 'unknown',
        selected_references: [{ ref: 'phi_visible_or_not_value', availability: 'recorded', why: '当時の基準' }],
      },
    });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: new FakeDocument(),
      autoLoad: false,
      fetcher: async () => ({ ok: true, status: 200, json: async () => normalHome([record]) }),
      now: OWNER_NOW,
    });
    await view.load();
    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    expect(collectText(row)).toContain('名前のない参照 1件');
    expect(collectText(row)).toContain('状態は未記録');
    expect(collectText(row)).not.toContain('phi_visible_or_not_value');
    expect(collectText(row)).not.toContain('unknown');
    row.listeners.get('click')();
    expect(collectText(rail)).toContain('記録ID：phi_visible_or_not_value（コピー）');
    view.dispose();
  });

  it('shows a skeleton with one compact loading notification and disables reload', async () => {
    const root = new FakeElement('div');
    const rail = new FakeElement('aside');
    let resolve;
    const pending = new Promise((settle) => { resolve = settle; });
    const view = createJudgmentHistoryUI({
      root,
      rail,
      document: new FakeDocument(),
      autoLoad: false,
      skeletonDelayMs: 0,
      slowDelayMs: 60000,
      fetcher: async () => pending,
      now: OWNER_NOW,
    });
    const loading = view.load();
    await Promise.resolve();
    expect(collectText(root)).toContain('ロード中');
    expect(findAll(root, node => node.className?.split(' ').includes('bb-ws-loading-card'))).toHaveLength(1);
    expect(findAll(root, (node) => node.className?.includes('bb-jh-skeleton-row'))).toHaveLength(5);
    expect(findAll(root, (node) => node.attributes.role === 'columnheader').map((node) => node.textContent)).toEqual(['日時', '行った判断', '使った参照', '入口・状態']);
    const reload = findAll(root, (node) => node.attributes['data-action'] === 'reload')[0];
    expect(reload.attributes.disabled).toBe('');
    expect(collectText(root)).not.toContain('確認しています…');
    expect(collectText(root)).not.toMatch(/0件/u);
    expect(collectText(root)).not.toContain('この期間の判断履歴はありません。');
    expect(collectText(root)).not.toContain('この期間に取得できた判断履歴はありません。');
    expect(collectText(rail)).toContain('読み込み中の行も、届いたものから選べます。');
    resolve({ ok: true, status: 200, json: async () => normalHome([normalRecord()]) });
    await loading;
    expect(findAll(root, (node) => node.className?.includes('bb-jh-skeleton-row'))).toHaveLength(0);
    view.dispose();
  });

  it('keeps arrived rows selectable and marks the other sources as still loading', async () => {
    const root = new FakeElement('div');
    let resolve;
    const pending = new Promise((settle) => { resolve = settle; });
    const arrived = normalHome([normalRecord({ record_id: 'arrived-1' })], {
      status: 'partial',
      coverage: {
        complete: false,
        total: null,
        sources: [
          { entrypoint: 'codex', status: 'partial', reason: null },
          { entrypoint: 'claude_code', status: 'pending', reason: null },
        ],
      },
    });
    const view = createJudgmentHistoryUI({
      root,
      document: new FakeDocument(),
      autoLoad: false,
      skeletonDelayMs: 60000,
      slowDelayMs: 60000,
      fetcher: async (_path, _init, context) => {
        context.report(arrived);
        return pending;
      },
      now: OWNER_NOW,
    });
    const loading = view.load();
    await Promise.resolve();
    expect(collectText(root)).toContain('既存の項目で進める');
    expect(collectText(root)).toContain('ロード中');
    expect(collectText(root)).toContain('1件');
    expect(collectText(root)).not.toContain('全件数は未確認');
    const row = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes.role === 'row')[0];
    expect(row).toBeTruthy();
    resolve({ ok: true, status: 200, json: async () => arrived });
    await loading;
    view.dispose();
  });

  it('keeps a compact loading notification after the slow delay with reduced motion', async () => {
    const root = new FakeElement('div');
    const previous = globalThis.matchMedia;
    globalThis.matchMedia = (query) => ({ matches: String(query).includes('prefers-reduced-motion'), media: query });
    let resolve;
    const pending = new Promise((settle) => { resolve = settle; });
    const view = createJudgmentHistoryUI({
      root,
      document: new FakeDocument(),
      autoLoad: false,
      skeletonDelayMs: 60000,
      slowDelayMs: 0,
      fetcher: async () => pending,
      now: OWNER_NOW,
    });
    const loading = view.load();
    await Promise.resolve();
    expect(collectText(root)).toContain('ロード中');
    expect(findAll(root, (node) => node.className?.includes('is-reduced-motion'))).toHaveLength(1);
    resolve({ ok: false, status: 503 });
    await loading;
    globalThis.matchMedia = previous;
    view.dispose();
  });

  it('puts reload inside the alert when the history cannot be read', async () => {
    const root = new FakeElement('div');
    const view = createJudgmentHistoryUI({
      root,
      document: new FakeDocument(),
      autoLoad: false,
      fetcher: async () => ({ ok: false, status: 503 }),
      now: OWNER_NOW,
    });
    await view.load();
    const banner = findAll(root, (node) => node.className?.includes('bb-jh-banner') && node.className.includes('is-danger'))[0];
    expect(banner.attributes.role).toBe('alert');
    expect(collectText(banner)).toContain('データが0件とは確認できていません');
    expect(findAll(banner, (node) => node.tagName === 'BUTTON' && node.textContent === '再読み込み')).toHaveLength(1);
    expect(findAll(root, (node) => node.attributes.role === 'table')).toHaveLength(0);
    view.dispose();
  });
});


describe('judgment history shared drawer and filter lifecycle', () => {
  it('keeps one drawer during asynchronous canonical detail updates and restores the current row on animated close', async () => {
    const doc = new DialogDocument();
    const root = doc.createElement('main'); doc.body.append(root);
    const rail = doc.createElement('aside'); doc.body.append(rail);
    let finishDetail;
    const detail = new Promise(resolve => { finishDetail = resolve; });
    const record = normalRecord();
    const view = createJudgmentHistoryUI({
      root, rail, document: doc, autoLoad: false, now: OWNER_NOW,
      fetcher: async path => path.includes('/records/') ? detail
        : { ok: true, json: async () => normalHome([record]) },
    });
    await view.load();
    const row = findAll(root, node => node.attributes.role === 'row' && node.tagName === 'BUTTON')[0];
    row.listeners.get('click')();
    const dialog = findAll(doc.body, node => node.tagName === 'DIALOG')[0];
    expect(rail.hidden).toBe(true);
    expect(dialog.classList.contains('bb-ws-drawer')).toBe(true);
    expect(collectText(dialog)).toContain('当時の基準');
    finishDetail({ ok: true, json: async () => ({ record: { ...record, judgment: { ...record.judgment, reason: '詳細から届いた理由' } } }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(findAll(doc.body, node => node.tagName === 'DIALOG')).toEqual([dialog]);
    expect(collectText(dialog)).toContain('詳細から届いた理由');
    dialog.listeners.get('cancel')({ preventDefault() {} });
    expect(dialog.open).toBe(true);
    expect(dialog.classList.contains('is-closing')).toBe(true);
    dialog.listeners.get('animationend')({ target: dialog, animationName: 'bb-ws-drawer-out' });
    expect(findAll(doc.body, node => node.tagName === 'DIALOG')).toHaveLength(0);
    expect(doc.activeElement.attributes['data-key']).toBe(row.attributes['data-key']);
    view.openDecision(record.record_id);
    expect(findAll(doc.body, node => node.tagName === 'DIALOG')).toHaveLength(1);
    view.dispose();
    expect(findAll(doc.body, node => node.tagName === 'DIALOG')).toHaveLength(0);
  });

  it('does not announce an empty history while loading and shows verified absence only after completion', async () => {
    const doc = new DialogDocument(); const root = doc.createElement('main'); doc.body.append(root);
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const view = createJudgmentHistoryUI({ root, document: doc, autoLoad: false, now: OWNER_NOW,
      skeletonDelayMs: 0, fetcher: async () => pending,
    });
    const loading = view.load();
    expect(collectText(root)).not.toContain('この期間の判断履歴はありません。');
    expect(collectText(root)).not.toContain('この期間に取得できた判断履歴はありません。');
    finish({ ok: true, json: async () => normalHome([], { coverage: { complete: true, total: 0 } }) });
    await loading;
    expect(collectText(root)).toContain('この期間の判断履歴はありません。');
    view.dispose();
  });

  it('anchors notifications in the host page without putting them inside the search content and removes them on dispose', async () => {
    const doc = new DialogDocument(); const page = doc.createElement('section'); doc.body.append(page);
    const root = doc.createElement('main'); page.append(root);
    const view = createJudgmentHistoryUI({ root, notificationRoot: page, document: doc, autoLoad: false, now: OWNER_NOW,
      fetcher: async () => ({ ok: true, json: async () => normalHome([normalRecord()], {
        status: 'partial', coverage: { complete: false },
      }) }),
    });
    await view.load();
    const stack = findAll(page, node => node.classList?.contains('bb-jh-notifications'))[0];
    expect(stack.parentNode).toBe(page);
    expect(root.contains(stack)).toBe(false);
    expect(findAll(stack, node => node.classList?.contains('bb-jh-banner'))).toHaveLength(1);
    view.dispose(); expect(page.contains(stack)).toBe(false);
  });

  it('reuses a fading loading notification on retry and leaves one collapsed source warning', async () => {
    vi.useFakeTimers();
    const doc = new DialogDocument(); const root = doc.createElement('main'); doc.body.append(root);
    const pending = [];
    const view = createJudgmentHistoryUI({ root, document: doc, autoLoad: false, now: OWNER_NOW,
      fetcher: () => new Promise(resolve => pending.push(resolve)),
    });
    try {
      const first = view.load();
      pending.shift()({ ok: true, json: async () => normalHome([normalRecord()]) }); await first;
      expect(findAll(root, node => node.classList?.contains('bb-ws-loading-card'))).toHaveLength(1);
      const retry = view.load(); view.render();
      expect(findAll(root, node => node.classList?.contains('bb-ws-loading-card'))).toHaveLength(1);
      pending.shift()({ ok: true, json: async () => normalHome([normalRecord()], {
        status: 'partial', coverage: { complete: false, sources: [{ entrypoint: 'mana', status: 'unavailable', reason: 'mana_not_connected' }] },
      }) }); await retry;
      view.render();
      vi.advanceTimersByTime(500);
      expect(findAll(root, node => node.classList?.contains('bb-ws-loading-card'))).toHaveLength(0);
      const cards = findAll(root, node => node.classList?.contains('bb-jh-banner'));
      expect(cards).toHaveLength(1);
      const details = findAll(cards[0], node => node.tagName === 'DETAILS')[0];
      expect(details.open).not.toBe(true);
      expect(collectText(details)).toContain('理由コード: mana_not_connected');
    } finally { view.dispose(); vi.useRealTimers(); }
  });

  it('keeps advanced search open and the selected filter focused after reload, without stealing external search focus', async () => {
    const doc = new DialogDocument(); const root = doc.createElement('main'); doc.body.append(root);
    const requests = [];
    const view = createJudgmentHistoryUI({
      root, document: doc, autoLoad: false, now: OWNER_NOW,
      fetcher: async path => { requests.push(path); return { ok: true, json: async () => normalHome([normalRecord()]) }; },
    });
    await view.load();
    findAll(root, node => node.tagName === 'BUTTON' && node.textContent === '詳細検索')[0].listeners.get('click')();
    let select = findAll(root, node => node.tagName === 'SELECT' && node.attributes['aria-label'] === 'プロジェクト')[0];
    select.focus(); select.value = 'project-atlas'; select.listeners.get('change')({ target: select });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(requests.at(-1)).toContain('project=project-atlas');
    expect(findAll(root, node => node.attributes.role === 'region')[0].hidden).toBe(false);
    expect(doc.activeElement.attributes['aria-label']).toBe('プロジェクト');
    const search = findAll(root, node => node.tagName === 'INPUT')[0]; search.focus();
    search.value = '既存'; search.listeners.get('input')({ target: search });
    expect(doc.activeElement).toBe(search);
    expect(collectText(root)).not.toContain('全件数は未確認');
    const toolbar = findAll(root, node => node.className === 'bb-jh-toolbar-status')[0];
    expect(toolbar.children[0].textContent).toBe('18:00');
    expect(toolbar.children.at(-1).attributes['aria-label']).toBe('判断履歴を再読み込み');
    view.dispose(); expect(doc.listeners.size).toBe(0);
  });
});
