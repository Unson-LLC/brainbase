import { afterEach, describe, expect, it } from 'vitest';
import {
  createJudgmentViewUI,
  normalizeJudgmentView,
  renderJudgmentView,
} from '../../ui/judgment-view.js';

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

  setAttribute(name, value) {
    this.attributes[name] = String(value);
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

function findAll(node, tagName) {
  const found = [];
  if (node?.tagName === String(tagName).toUpperCase()) found.push(node);
  for (const child of node?.children ?? []) found.push(...findAll(child, tagName));
  return found;
}

function view(overrides = {}) {
  return {
    contract_version: 'judgment-view.v1',
    mode: 'historical',
    status: 'resolved',
    run: {
      status: 'resolved',
      value: { runId: 'run-1', status: 'completed', question: 'どの方式か', composition: { id: 'composition', version: '1.0.0' }, parentDag: { id: 'parent', version: '1.0.0' }, problemSnapshot: { snapshot_id: 'sha256:bbbb', problem_id: 'problem-1', revision: '3' } },
    },
    conclusion: { status: 'resolved', value: { source: 'parent-run-artifact', runId: 'run-1', dag: { id: 'parent', version: '1.0.0' }, value: { choice: 'pilot' } } },
    problem: { status: 'resolved', value: { snapshotId: 'sha256:bbbb', problemId: 'problem-1', revision: '3', question: 'どの方式か', references: [{ kind: 'objective', id: 'objective-1', revision: '2', digest: 'sha256:oooo' }] } },
    objective: {
      status: 'resolved',
      value: {
        ref: { id: 'objective-1', type: 'objective', revision: '2', digest: 'sha256:oooo' },
        meaning: '総対応負荷を減らす', desiredState: '週120分以下', adoptionState: 'approved', epistemicState: 'supported', beneficiaryIds: ['front-desk'],
        criteria: { status: 'resolved', items: [{ variableRef: { id: 'variable-1', type: 'variable', revision: '1', digest: 'sha256:vvvv' }, operator: 'at_most', target: 120, variable: { meaning: '総対応時間', subject: 'front-desk', valueKind: 'number', aggregation: 'sum', granularity: 'week' } }], absence_confirmed: false },
      },
    },
    evidence: { status: 'resolved', items: [{ source: 'subdag', invocationId: 'technical', kind: 'observation', id: 'evidence-1', revision: '1' }], absence_confirmed: false },
    childRuns: { status: 'resolved', items: [{ invocationId: 'operations', dag: { id: 'operations', version: '1.0.0' }, status: 'held', question: '運用できるか', conclusion: { answer: '保留' }, uncertainty: { level: 'high' }, applicability: { scope: 'project' }, reason: '追加確認が必要' }], absence_confirmed: false },
    resultEvaluation: { status: 'resolved', value: { evaluationId: 'evaluation-1', achievement: 'achieved', criteria: [], predictionComparisons: [], evaluatedAt: '2026-03-31T00:00:00.000Z', outcomeCaseRef: { id: 'outcome-1', revision: '1', digest: 'sha256:eeee' } } },
    judgmentValidity: { status: 'resolved', value: { status: 'indeterminate', basis: '実証期間が短い', evidenceRefs: ['evidence-1'] } },
    ...overrides,
  };
}

const previousDocument = globalThis.document;
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

describe('judgment view UI contract', () => {
  it('does not turn an unconfirmed empty collection into an empty success', () => {
    const normalized = normalizeJudgmentView(view({
      evidence: { status: 'resolved', items: [], absence_confirmed: false },
      childRuns: { status: 'resolved', items: [], absence_confirmed: true },
    }));

    expect(normalized.evidence).toMatchObject({ status: 'unknown', items: null, absence_confirmed: false });
    expect(normalized.childRuns).toMatchObject({ status: 'resolved', items: [], absence_confirmed: true });
  });

  it('rejects a malformed Objective criterion instead of filtering it out', () => {
    const normalized = normalizeJudgmentView(view({
      objective: {
        ...view().objective,
        value: {
          ...view().objective.value,
          criteria: { status: 'resolved', items: [{ variableRef: { id: 'variable-1', type: 'model', revision: '1', digest: 'sha256:vvvv' }, operator: 'at_most', target: 120, variable: {} }], absence_confirmed: false },
        },
      },
    }));

    expect(normalized.objective.value.criteria).toMatchObject({ status: 'unknown', items: null, absence_confirmed: false });
  });

  it('renders historical trace, conclusion-to-evidence anchor, held child, and separate evaluation states', () => {
    const root = new FakeElement('div');
    const surface = renderJudgmentView(root, view(), { document: new FakeDocument() });
    const text = collectText(surface);

    expect(text).toContain('判断の追跡');
    expect(text).toContain('当時版（historical）');
    expect(text).toContain('pilot');
    expect(text).toContain('根拠へ移動');
    expect(text).toContain('保留');
    expect(text).toContain('結果の達成度');
    expect(text).toContain('判断時点の妥当性');
    expect(findAll(root, 'a').some((link) => link.attributes.href === '#judgment-view-evidence')).toBe(true);
  });

  it('loads through the host API path without adding tenant or principal parameters', async () => {
    const root = new FakeElement('div');
    const paths = [];
    const controller = createJudgmentViewUI({
      root,
      document: new FakeDocument(),
      runId: 'run/1',
      evaluationId: 'evaluation-1',
      autoLoad: false,
      fetcher: async (path) => { paths.push(path); return view(); },
    });

    await controller.load();
    expect(paths).toEqual(['/judgment-views/run%2F1?evaluationId=evaluation-1']);
    expect(paths[0]).not.toMatch(/tenant|principal|scope/);
    expect(controller.state.model.conclusion.value.value.choice).toBe('pilot');
  });
});
