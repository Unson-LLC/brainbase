import { describe, expect, it } from 'vitest';
import {
  createValueProofReviewUI,
  normalizeValueProofReviewHome,
  renderValueProofReview,
} from '../../ui/value-proof-review.js';

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

function home(items = [proof()]) {
  return {
    status: 'available',
    root: '/tmp/journal',
    coverage: { saved: items.length, rejected: 0, latest_recorded_at: '2026-09-20T00:00:00.000Z', possibly_stalled: true },
    sections: { needs_human: [], blocked: [], continued: items.map((entry) => ({ section: 'continued', proof: entry, feedback_history: [] })), other: [] },
    rejected: [],
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('value proof review UI contract', () => {
  it('never turns an unavailable or malformed response into an empty list', () => {
    expect(normalizeValueProofReviewHome({ status: 'unavailable', root: '/x', reason: 'judgment_journal_not_found' }))
      .toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });
    expect(normalizeValueProofReviewHome({ status: 'available', coverage: {}, sections: { continued: [{}] } }).status).toBe('invalid');

    const doc = new FakeDocument();
    const root = doc.createElement('main');
    renderValueProofReview(root, { phase: 'ready', home: normalizeValueProofReviewHome({ status: 'unavailable', root: '/x', reason: 'judgment_journal_not_found' }) }, {}, { document: doc });
    const text = collectText(root);
    expect(text).toContain('判断journalに接続できません');
    expect(text).toContain('0件としては扱いません');
    expect(text).not.toContain('聞かずに進めた');
  });

  it('shows the card in the contract order and keeps internal IDs in the audit details', () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const state = {
      phase: 'ready',
      home: normalizeValueProofReviewHome(home()),
      selectedKey: 'intent-1\u0000attempt-1',
      unratedOnly: false,
      draft: { status: '', summary: '' },
      save: { state: 'idle', message: '' },
    };
    renderValueProofReview(root, state, {}, { document: doc });

    const card = findAll(root, (element) => element?.className === 'vpr-card')[0];
    const facts = findAll(card, (element) => element?.className === 'vpr-facts')[0];
    expect(byTag(facts, 'dt').map((element) => element.textContent)).toEqual([
      '扱い', '判断', '仕事への影響', '根拠', '過去の学習の再利用', '引き継ぎ', '実行', '成果の確認', '評価',
    ]);
    expect(collectText(facts)).not.toContain('attempt-1');
    const audit = findAll(card, (element) => element?.className === 'vpr-audit')[0];
    expect(collectText(audit)).toContain('attempt-1');
    expect(collectText(root)).toContain('記録が止まっている可能性があります');
  });

  it('says the inheritance is unrecorded instead of inventing it, and shows it when recorded', () => {
    const doc = new FakeDocument();
    const render = (entry) => {
      const root = doc.createElement('main');
      renderValueProofReview(root, {
        phase: 'ready',
        home: normalizeValueProofReviewHome(home([entry])),
        selectedKey: 'intent-1\u0000attempt-1',
        unratedOnly: false,
        draft: { status: '', summary: '' },
        save: { state: 'idle', message: '' },
      }, {}, { document: doc });
      return collectText(findAll(root, (element) => element?.className === 'vpr-facts')[0]);
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

  it('requires a reason for corrections, posts with the review token and confirms the saved feedback by reloading', async () => {
    const doc = new FakeDocument();
    const root = doc.createElement('main');
    const requests = [];
    let current = home();
    const fetcher = async (path, init) => {
      requests.push({ path, init });
      if (path.endsWith('/home')) return jsonResponse(200, current);
      current = home([proof({ feedback: { status: 'next_time_ask', summary: '本番は次回は聞く', evidence_ref: { kind: 'human_feedback', ref: 'x', status: 'verified' } } })]);
      return jsonResponse(201, { created: true });
    };
    const ui = createValueProofReviewUI({ root, document: doc, fetcher, token: 'token-123', autoLoad: false });
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
});
