import { afterEach, describe, expect, it } from 'vitest';

import {
  createObjectiveEditorController,
  normalizeObjectiveCollection,
  normalizeObjectiveRecord,
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
    expect(normalizeObjectiveCollection({ records: [] })).toMatchObject({ state: 'empty', absence_confirmed: true });
    expect(normalizeObjectiveCollection({ status: 'unknown' })).toMatchObject({ state: 'unknown', absence_confirmed: false });
    const draft = normalizeObjectiveRecord(objectiveRecord({ definition: { ...objectiveRecord().definition, adoptionState: 'draft' } }));
    expect(objectiveJudgmentState(draft)).toBe('draft');
    const ready = normalizeObjectiveRecord({ ...objectiveRecord(), readiness: { ready: true, issues: [] } });
    expect(objectiveJudgmentState(ready)).toBe('judgment_available');
  });

  it('renders Story relation labels without copying Story content', () => {
    const links = normalizeStoryObjectiveLinks({ links: [{ relation: 'contributes_to', objective: { id: 'objective-1', type: 'objective', revision: '2' }, story: { id: 'story-1', type: 'story', revision: '1' } }] });
    expect(links.links[0]).toMatchObject({ relation: 'contributes_to', relationLabel: '目的への貢献' });
    expect(links.links[0].objective).toMatchObject({ id: 'objective-1', revision: '2' });
    expect(links.links[0].raw).not.toHaveProperty('content');
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
});
