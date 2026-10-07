import { describe, expect, it } from 'vitest';
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
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'value') this.value = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
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
});

describe('judgment history UI', () => {
  it('renders the three-column history, metrics and read-only detail without an evaluation control', async () => {
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
    expect(findAll(root, (node) => node.attributes['role'] === 'columnheader').map((node) => node.textContent)).toEqual(['日時', '使った参照', '行った判断']);
    expect(collectText(root)).toContain('Brainbaseが代わりに判断した件数');
    expect(collectText(root)).toContain('週次報告の項目');
    expect(collectText(rail)).toContain('使った参照');
    expect(findAll(root, (node) => node.tagName === 'FORM')).toHaveLength(0);
    view.dispose();
    expect(root.children).toHaveLength(0);
  });

  it('shows unconfirmed metrics for an empty partial read and labels the readable range', async () => {
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
    expect(metrics.map((metric) => metric.children[1]?.textContent)).toEqual(['未確認', '未確認', '未確認']);
    expect(collectText(root)).toContain('取得できた範囲');
    expect(collectText(root)).not.toContain('0回分相当');
    view.dispose();
  });

  it('labels the readable range beside numeric metrics when a partial read has rows', async () => {
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
    expect(metrics.map((metric) => metric.children[1]?.textContent)).toEqual(['1件', '1件', '1回分相当']);
    expect(collectText(root)).toContain('取得できた範囲');
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
});
