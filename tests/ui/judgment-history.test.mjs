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
    expect((text.match(/取得できた範囲/gu) ?? [])).toHaveLength(1);
    expect(text).toContain('サーバー');
    expect(text).toContain('Mana: 未接続');
    expect(text).toContain('既存の項目で進める');

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
});
