import { afterEach, describe, expect, it } from 'vitest';

import {
  createObjectiveEditorController,
  normalizeObjectiveCollection,
  normalizeObjectiveRecord,
  normalizeReferenceCollection,
  normalizeStoryObjectiveLinks,
  objectiveJudgmentState,
} from '../../ui/objective-editor.js';

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
    this.disabled = false;
    this.hidden = false;
  }

  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'checked') this.checked = true;
    if (name === 'disabled') this.disabled = true;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name, event = {}) { this.listeners.get(name)?.({ preventDefault() {}, target: this, ...event }); }
  get firstChild() { return this.children[0] ?? null; }
}

class FakeDocument { createElement(tagName) { return new FakeElement(tagName); } }

function collectText(node) {
  return `${node?.textContent ?? ''}${(node?.children ?? []).map(collectText).join('')}`;
}

function findButtons(node, result = []) {
  if (!node) return result;
  if (node.tagName === 'BUTTON') result.push(node);
  for (const child of node.children ?? []) findButtons(child, result);
  return result;
}

function objectiveRecord(overrides = {}) {
  return {
    definition: {
      id: 'objective-load',
      type: 'objective',
      revision: '1',
      meaning: 'フロント総対応負荷を減らす',
      desiredState: '引き継ぎと修正を含めた総負荷が減る',
      beneficiaryIds: ['org-1'],
      criteria: [{ variableRef: { id: 'variable-load', type: 'variable', revision: '1' }, operator: 'at_most', target: 120 }],
      evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-03-31T23:59:59.000Z' },
      adoptionState: 'approved',
      authorizedUses: ['draft', 'judgment'],
      acl: { ownerId: 'owner-1', visibility: 'private', readerIds: [], writerIds: ['owner-1'] },
      storage: 'ontology',
      provenance: [],
      scope: { subjectIds: ['org-1'], validFrom: '2026-01-01T00:00:00.000Z' },
    },
    digest: 'sha256:objective-1',
    ...overrides,
  };
}

const previousDocument = globalThis.document;
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

describe('Objective editor common UI contract', () => {
  it('keeps unknown, draft, and judgment-ready states distinct', () => {
    expect(normalizeObjectiveCollection({ records: [] })).toMatchObject({ state: 'unknown', records: null, absence_confirmed: false });
    expect(normalizeObjectiveCollection({ records: [], state: 'empty', absence_confirmed: true })).toMatchObject({ state: 'empty', records: [], absence_confirmed: true });
    expect(normalizeObjectiveCollection({ status: 'unknown' })).toMatchObject({ state: 'unknown', absence_confirmed: false });
    const draft = normalizeObjectiveRecord(objectiveRecord({ definition: { ...objectiveRecord().definition, adoptionState: 'draft' } }));
    expect(objectiveJudgmentState(draft)).toBe('draft');
    const ready = normalizeObjectiveRecord({ ...objectiveRecord(), readiness: { ready: true, issues: [] } });
    expect(objectiveJudgmentState(ready)).toBe('judgment_available');
  });

  it('does not turn malformed collection items into a confirmed empty or partial result', () => {
    const objectives = normalizeObjectiveCollection({ records: [objectiveRecord(), { id: 'broken-objective', type: 'objective' }] });
    expect(objectives).toMatchObject({ state: 'unknown', records: null, absence_confirmed: false });

    const wrongType = normalizeObjectiveCollection({ records: [{ id: 'model-1', type: 'model', revision: '1' }] });
    expect(wrongType).toMatchObject({ state: 'unknown', records: null, absence_confirmed: false });

    const refs = normalizeReferenceCollection({ refs: [{ id: 'constraint-1', type: 'constraint', revision: '1' }, { id: 'broken-ref' }] });
    expect(refs).toMatchObject({ state: 'unknown', refs: null, absence_confirmed: false });
  });

  it('requires explicit absence confirmation for empty constraints and Story links', () => {
    expect(normalizeReferenceCollection({ refs: [], state: 'empty', absence_confirmed: false }))
      .toMatchObject({ state: 'unknown', refs: null, absence_confirmed: false });
    expect(normalizeReferenceCollection({ refs: [], state: 'empty', absence_confirmed: true }))
      .toMatchObject({ state: 'empty', refs: [], absence_confirmed: true });

    expect(normalizeStoryObjectiveLinks({ links: [], state: 'empty', absence_confirmed: false }))
      .toMatchObject({ state: 'unknown', links: null, absence_confirmed: false });
    expect(normalizeStoryObjectiveLinks({ links: [], state: 'empty', absence_confirmed: true }))
      .toMatchObject({ state: 'empty', links: [], absence_confirmed: true });
  });

  it('preserves explicit collection failures instead of treating them as unknown or empty', () => {
    expect(normalizeObjectiveCollection({ records: [], state: 'permission_denied' }))
      .toMatchObject({ state: 'permission_denied', records: null, absence_confirmed: false });
    expect(normalizeReferenceCollection({ refs: [], state: 'api_unavailable' }))
      .toMatchObject({ state: 'api_unavailable', refs: null, absence_confirmed: false });
    expect(normalizeStoryObjectiveLinks({ links: [], state: 'conflict' }))
      .toMatchObject({ state: 'conflict', links: null, absence_confirmed: false });
    expect(normalizeObjectiveCollection({ records: [], state: 'missing' }))
      .toMatchObject({ state: 'missing', records: null, absence_confirmed: false });
  });

  it('rejects an Objective when any criterion has a non-Variable reference', () => {
    const invalid = objectiveRecord({
      definition: {
        ...objectiveRecord().definition,
        criteria: [{ variableRef: { id: 'model-1', type: 'model', revision: '1' }, operator: 'at_most', target: 1 }],
      },
    });
    expect(normalizeObjectiveRecord(invalid)).toBeNull();
    expect(normalizeObjectiveCollection({ records: [invalid] }))
      .toMatchObject({ state: 'unknown', records: null, absence_confirmed: false });
  });

  it('renders Story relation labels without copying Story content', () => {
    const links = normalizeStoryObjectiveLinks({ links: [{ relation: 'contributes_to', objective: { id: 'objective-1', type: 'objective', revision: '2' }, story: { id: 'story-1', type: 'story', revision: '1' } }] });
    expect(links.links[0]).toMatchObject({ relation: 'contributes_to', relationLabel: '目的への貢献' });
    expect(links.links[0].objective).toMatchObject({ id: 'objective-1', revision: '2' });
    expect(links.links[0].raw).not.toHaveProperty('content');
  });

  it('rejects a Story relation whose target is a model instead of an Objective', () => {
    const links = normalizeStoryObjectiveLinks({ links: [{ relation: 'contributes_to', objective: { id: 'model-1', type: 'model', revision: '1' }, story: { id: 'story-1', type: 'story', revision: '1' } }] });
    expect(links).toMatchObject({ state: 'unknown', links: null, absence_confirmed: false });

    const missingType = normalizeStoryObjectiveLinks({ links: [{ relation: 'contributes_to', objective: { id: 'objective-1', revision: '1' }, story: { id: 'story-1', type: 'story', revision: '1' } }] });
    expect(missingType).toMatchObject({ state: 'unknown', links: null, absence_confirmed: false });
  });

  it('requires the same ID and a readback of the new revision before verified', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const stored = new Map();
    const port = {
      listObjectives: async () => ({ records: [...stored.values()] }),
      readObjective: async (id, _context, revision) => {
        const record = stored.get(id);
        return record && (!revision || record.definition.revision === revision) ? record : null;
      },
      checkObjectiveReadiness: async () => ({ ready: false, issues: [{ code: 'MISSING_VARIABLE_REVISION', path: 'criteria[0]', message: 'Variable is missing' }] }),
      createObjective: async (definition) => {
        const record = { definition: { ...definition, revision: '1' }, digest: 'sha256:created' };
        stored.set(definition.id, record);
        return { id: definition.id, type: 'objective', revision: '1', digest: record.digest };
      },
    };
    const controller = createObjectiveEditorController({ root, port, context: { principal: 'owner-1' }, canEdit: true, autoLoad: false });
    controller.beginCreate();
    const result = await controller.saveObjective({
      id: 'objective-created', type: 'objective', revision: '1', meaning: '目的', desiredState: '状態', beneficiaryIds: [], criteria: [],
      evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-03-31T00:00:00.000Z' }, adoptionState: 'draft', authorizedUses: ['draft'],
      acl: { ownerId: 'owner-1', visibility: 'private', readerIds: [], writerIds: ['owner-1'] }, storage: 'ontology', provenance: [], scope: { subjectIds: ['org-1'], validFrom: '2026-01-01T00:00:00.000Z' },
    });
    expect(result.state).toBe('verified');
    expect(result.readback.definition.id).toBe('objective-created');
    expect(collectText(root)).toContain('正本と一致');
  });

  it('keeps draft input and reports revision conflicts without retrying', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    let updates = 0;
    const port = {
      listObjectives: async () => ({ records: [objectiveRecord()] }),
      readObjective: async () => objectiveRecord(),
      checkObjectiveReadiness: async () => ({ ready: true, issues: [] }),
      updateObjective: async () => { updates += 1; const error = new Error('stale'); error.code = 'revision_conflict'; error.currentRevision = '2'; throw error; },
    };
    const controller = createObjectiveEditorController({ root, port, context: { principal: 'owner-1' }, canEdit: true, autoLoad: false });
    await controller.selectObjective({ id: 'objective-load', type: 'objective', revision: '1' });
    const draft = { ...controller.state.editor.draft, meaning: '入力を保持する' };
    const result = await controller.saveObjective(draft);
    expect(result.state).toBe('conflict');
    expect(result.currentRevision).toBe('2');
    expect(updates).toBe(1);
    expect(controller.state.editor.draft.meaning).toBe('入力を保持する');
  });

  it('keeps an update unverified when the mutation returns the expected revision again', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    let updates = 0;
    const port = {
      readObjective: async () => objectiveRecord(),
      checkObjectiveReadiness: async () => ({ ready: true, issues: [] }),
      updateObjective: async (id, expectedRevision) => {
        updates += 1;
        return { id, type: 'objective', revision: expectedRevision, digest: 'sha256:objective-1' };
      },
    };
    const controller = createObjectiveEditorController({ root, port, context: { principal: 'owner-1' }, canEdit: true, autoLoad: false });
    await controller.selectObjective({ id: 'objective-load', type: 'objective', revision: '1' });
    const result = await controller.saveObjective({ ...controller.state.editor.draft, meaning: '新版を返さない更新' });
    expect(result.state).toBe('saved_unverified');
    expect(result.expectedRevision).toBe('1');
    expect(result.reference.revision).toBe('1');
    expect(updates).toBe(1);
  });

  it('shows constraints read-only and hides the Story tab only when the host asks', async () => {
    globalThis.document = new FakeDocument();
    const buttons = (node) => findButtons(node).map((button) => button.textContent);
    const port = {
      readObjective: async () => objectiveRecord(),
      checkObjectiveReadiness: async () => ({ ready: true, issues: [] }),
      listObjectiveConstraintRefs: async () => ({ refs: [{ id: 'constraint-1', type: 'constraint', revision: '1', meaning: '夜は働かない' }], absence_confirmed: true }),
    };

    const defaultRoot = new FakeElement('div');
    const defaults = createObjectiveEditorController({ root: defaultRoot, port, context: {}, canEdit: true, autoLoad: false });
    await defaults.selectObjective({ id: 'objective-load', type: 'objective', revision: '1' });
    expect(buttons(defaultRoot)).toEqual(expect.arrayContaining(['Story参照', '外す', '参照を追加']));

    const root = new FakeElement('div');
    const readOnly = createObjectiveEditorController({ root, port, context: {}, canEdit: true, autoLoad: false, constraintsEditable: false, storyLinks: false });
    await readOnly.selectObjective({ id: 'objective-load', type: 'objective', revision: '1' });
    expect(collectText(root)).toContain('constraint-1@1');
    expect(collectText(root)).toContain('制約の参照はここでは表示だけです。');
    expect(buttons(root)).not.toContain('外す');
    expect(buttons(root)).not.toContain('参照を追加');
    expect(buttons(root)).not.toContain('Story参照');
    readOnly.addConstraintRef({ id: 'constraint-2', type: 'constraint', revision: '1' });
    readOnly.removeConstraintRef({ id: 'constraint-1', type: 'constraint', revision: '1' });
    expect(readOnly.state.editor.constraintRefs.map((ref) => ref.id)).toEqual(['constraint-1']);
    expect(readOnly.state.editor.constraintRefsChanged).toBe(false);
  });

  it('lists each Objective with its desired state, evaluation period, accountable person and criteria', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    // Noon UTC keeps the local calendar date stable in every common time zone.
    const record = objectiveRecord({ definition: {
      ...objectiveRecord().definition,
      accountableId: 'self',
      evaluationPeriod: { from: '2026-01-15T12:00:00.000Z', until: '2026-03-15T12:00:00.000Z' },
    } });
    const controller = createObjectiveEditorController({
      root, port: { listObjectives: async () => ({ records: [record], absence_confirmed: true }) }, context: {}, autoLoad: false,
    });
    await controller.loadObjectives();
    const text = collectText(root);
    expect(text).toContain('実現したい状態: 引き継ぎと修正を含めた総負荷が減る');
    expect(text).toContain('評価期間 2026-01-15〜2026-03-15');
    expect(text).toContain('責任者 self');
    expect(text).toContain('評価基準 1件');
    expect(text).toContain('承認済み');
  });
});

