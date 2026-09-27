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

function findAll(node, predicate, result = []) {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, result);
  return result;
}

function nodeName(node) {
  return node?.attributes?.name;
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
  it('shows plain wording to the owner instead of internal type, store, or API names', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../ui/objective-editor.js', import.meta.url), 'utf8');
    // Visible copy: element text, messages, labels, and field captions.
    const visible = [...source.matchAll(/(?:text|message|'aria-label'|placeholder):\s*'([^']*)'|field\('([^']*)'/g)]
      .map((match) => match[1] ?? match[2]);
    expect(visible.length).toBeGreaterThan(20);
    for (const copy of visible) {
      expect(copy).not.toMatch(/Objective|Variable|Constraint|readiness|readback|FoundationRevisionStore|COMPANY OS|\bport\b|\bAPI\b|typed relation|Story/);
    }
  });

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

  it('renders choices as selects, names known readiness in the list and re-reads it for a saved revision', async () => {
    globalThis.document = new FakeDocument();
    const root = new FakeElement('div');
    const readinessCalls = [];
    let current = objectiveRecord();
    const port = {
      listObjectives: async () => ({ records: [{ ...current, readiness: { ready: false, issues: [{ code: 'MISSING_FIELD', path: 'criteria', message: 'x' }] } }], absence_confirmed: true }),
      readObjective: async (_id, _context, revision) => (!revision || revision === current.definition.revision ? current : null),
      checkObjectiveReadiness: async (_id, _context, revision) => { readinessCalls.push(revision); return { ready: revision === '2', issues: [] }; },
      updateObjective: async (id, expectedRevision, definition) => {
        current = { definition: { ...definition, revision: '2' }, digest: 'sha256:objective-2' };
        return { id, type: 'objective', revision: '2', digest: 'sha256:objective-2' };
      },
    };
    const controller = createObjectiveEditorController({ root, port, context: {}, canEdit: true, autoLoad: false });
    await controller.selectObjective({ id: 'objective-load', type: 'objective', revision: '1' });
    expect(collectText(root)).toContain('判断に使えない');
    const adoption = findAll(root, (node) => nodeName(node) === 'adoption_state')[0];
    expect(adoption.tagName).toBe('SELECT');
    expect(findAll(root, (node) => nodeName(node) === 'criteria.0.operator')[0].tagName).toBe('SELECT');

    const result = await controller.saveObjective({ ...controller.state.editor.draft, meaning: '新しい版' });
    expect(result.state).toBe('verified');
    expect(readinessCalls).toEqual(['1', '2']);
    expect(controller.state.readiness).toMatchObject({ state: 'ready', ready: true });
    expect(collectText(root)).toContain('判断に利用可能');

    controller.state.view = 'list';
    await controller.loadObjectives();
    expect(collectText(root)).toContain('判断に使えない（不足1件）');
  });

  describe('workspace layout (the host gives a rail)', () => {
    const byClass = (node, className) => findAll(node, (element) => String(element?.className ?? '').split(' ').includes(className));
    const rowsOf = (ledger) => byClass(ledger, 'bb-ws-ledger-row').filter((row) => !row.className.includes('bb-ws-ledger-head'));
    const second = () => objectiveRecord({
      definition: { ...objectiveRecord().definition, id: 'objective-sleep', meaning: '睡眠を守る', desiredState: '23時に寝る', adoptionState: 'draft', criteria: [] },
      digest: 'sha256:sleep',
    });

    function workspacePort(overrides = {}) {
      const stored = new Map([['objective-load', objectiveRecord()], ['objective-sleep', second()]]);
      const calls = [];
      const port = {
        listObjectives: async () => ({
          records: [
            { ...stored.get('objective-load'), readiness: { ready: true, issues: [] } },
            { ...stored.get('objective-sleep'), readiness: { ready: false, issues: [{ code: 'MISSING', path: 'criteria', message: '評価基準がありません' }] } },
          ],
          absence_confirmed: true,
        }),
        readObjective: async (id, _context, revision) => {
          calls.push(['read', id, revision]);
          const record = stored.get(id);
          return record && (!revision || record.definition.revision === revision) ? record : null;
        },
        checkObjectiveReadiness: async (id) => (id === 'objective-load' ? { ready: true, issues: [] } : { ready: false, issues: [{ code: 'MISSING', path: 'criteria', message: '評価基準がありません' }] }),
        listObjectiveConstraintRefs: async () => ({ refs: [{ id: 'constraint-night', type: 'constraint', revision: '1', meaning: '夜は働かない' }], absence_confirmed: true }),
        updateObjective: async (id, expectedRevision, definition) => {
          calls.push(['update', id, expectedRevision]);
          const next = String(Number(expectedRevision) + 1);
          stored.set(id, { definition: { ...definition, revision: next }, digest: `sha256:${next}` });
          return { id, type: 'objective', revision: next, digest: `sha256:${next}` };
        },
        createObjective: async (definition) => {
          stored.set(definition.id, { definition: { ...definition, revision: '1' }, digest: 'sha256:new' });
          return { id: definition.id, type: 'objective', revision: '1', digest: 'sha256:new' };
        },
        ...overrides,
      };
      return { port, calls, stored };
    }

    async function mountWorkspace(options = {}) {
      globalThis.document = new FakeDocument();
      const root = new FakeElement('div');
      const rail = new FakeElement('aside');
      const { port, calls, stored } = workspacePort(options.port);
      const controllerOptions = {
        root, rail, page: { crumbs: ['あなたのBrainbase', '目的と現状'], source: '手元のGraph' },
        port, context: {}, canEdit: options.canEdit ?? true, constraintsEditable: false, storyLinks: false, autoLoad: false,
        ...options.host,
      };
      const controller = createObjectiveEditorController(controllerOptions);
      await controller.loadObjectives();
      return { root, rail, controller, calls, stored, controllerOptions };
    }

    it('builds the page head, metrics and the objectives ledger, and opens with the first objective in the rail', async () => {
      const { root, rail, controller } = await mountWorkspace();
      expect(collectText(byClass(root, 'bb-ws-breadcrumb')[0])).toBe('あなたのBrainbase/目的と現状');
      expect(findAll(root, (node) => node.tagName === 'H1')[0].textContent).toBe('目的と現状');
      expect(byClass(root, 'bb-ws-source')[0].textContent).toBe('手元のGraph');
      expect(findButtons(byClass(root, 'bb-ws-page-head')[0]).map((button) => [button.textContent, button.className]))
        .toEqual([['再読込', 'bb-ws-button'], ['新しい目的', 'bb-ws-button is-primary']]);
      // No tabs in this layout.
      expect(byClass(root, 'objective-editor-tab')).toHaveLength(0);
      const metrics = byClass(root, 'bb-ws-metric').map((metric) => [metric.children[0].textContent, metric.children[1].textContent]);
      expect(metrics).toEqual([['目的', '2'], ['判断に使える', '1'], ['下書き', '1']]);

      const ledger = byClass(root, 'bb-objective-ledger')[0];
      expect(byClass(ledger, 'bb-ws-ledger-head')[0].children.map((cell) => cell.textContent)).toEqual(['目的', '望ましい状態', '状態', '判断に使えるか', '評価期間']);
      const rows = rowsOf(ledger);
      expect(rows.map((row) => row.children.map(collectText).slice(0, 4))).toEqual([
        ['フロント総対応負荷を減らすobjective-load@1', '引き継ぎと修正を含めた総負荷が減る', '承認済み', '使える'],
        ['睡眠を守るobjective-sleep@1', '23時に寝る', '下書き', '使えない・不足1件'],
      ]);
      // The ledger shortens the period; the end drops its year inside the same year.
      const localDate = (iso, withYear) => { const date = new Date(iso); return `${withYear ? `${date.getFullYear()}/` : ''}${date.getMonth() + 1}/${date.getDate()}`; };
      const sameYear = new Date('2026-01-01T00:00:00.000Z').getFullYear() === new Date('2026-03-31T23:59:59.000Z').getFullYear();
      expect(collectText(rows[0].children[4])).toBe(`${localDate('2026-01-01T00:00:00.000Z', true)}〜${localDate('2026-03-31T23:59:59.000Z', !sameYear)}`);
      expect(rows[0].className).toContain('is-selected');
      expect(controller.state.selectedId).toBe('objective-load');

      const panel = byClass(rail, 'bb-objective-rail')[0];
      expect(panel.attributes['data-rail-mode']).toBe('detail');
      expect(collectText(byClass(panel, 'bb-ws-rail-head')[0])).toBe('目的フロント総対応負荷を減らすobjective-load@1');
      const blocks = byClass(panel, 'bb-ws-rail-block').map((block) => block.attributes['aria-label']);
      expect(blocks).toEqual(['概要', '評価基準 1件', '制約の参照', '判断に使えるか']);
      const text = collectText(panel);
      expect(text).toContain('責任者未記録');
      expect(text).toContain('variable-load@1120 以下');
      expect(text).toContain('constraint-night@1夜は働かない');
      expect(text).toContain('制約の参照はここでは表示だけです。');
      expect(text).toContain('判断に利用可能');
      expect(findButtons(panel).map((button) => button.textContent)).toEqual(['目的を直す']);
      // The workspace itself holds no form.
      expect(findAll(root, (node) => node.tagName === 'FORM')).toHaveLength(0);
    });

    it('gives the rail the objective the owner selects', async () => {
      const { root, rail } = await mountWorkspace();
      rowsOf(byClass(root, 'bb-objective-ledger')[0])[1].dispatch('click');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const rows = rowsOf(byClass(root, 'bb-objective-ledger')[0]);
      expect(rows[1].className).toContain('is-selected');
      expect(rows[0].className).not.toContain('is-selected');
      const panel = byClass(rail, 'bb-objective-rail')[0];
      expect(collectText(byClass(panel, 'bb-ws-rail-head')[0])).toContain('睡眠を守る');
      expect(collectText(panel)).toContain('評価基準はまだありません。');
      expect(collectText(panel)).toContain('criteria: 評価基準がありません');
    });

    it('opens the edit form in the rail, saves a new revision and shows the read-back', async () => {
      const { rail, controller, calls } = await mountWorkspace();
      findButtons(rail).find((button) => button.textContent === '目的を直す').dispatch('click');
      let panel = byClass(rail, 'bb-objective-rail')[0];
      expect(panel.attributes['data-rail-mode']).toBe('form');
      expect(collectText(byClass(panel, 'bb-ws-rail-head')[0])).toContain('目的を直す');
      const form = findAll(panel, (node) => node.tagName === 'FORM')[0];
      expect(findButtons(form).map((button) => button.textContent)).toEqual(expect.arrayContaining(['保存', 'キャンセル']));
      findAll(form, (node) => nodeName(node) === 'meaning')[0].value = '総負荷を二割減らす';
      form.dispatch('submit');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toContainEqual(['update', 'objective-load', '1']);
      expect(controller.state.save.state).toBe('verified');
      panel = byClass(rail, 'bb-objective-rail')[0];
      expect(panel.attributes['data-rail-mode']).toBe('detail');
      const text = collectText(panel);
      expect(text).toContain('正本と一致：保存した版（objective-load@2）を読み戻して確かめました。');
      expect(collectText(byClass(panel, 'bb-ws-rail-head')[0])).toBe('目的総負荷を二割減らすobjective-load@2');
    });

    it('keeps the draft and shows the current revision in the rail on a revision conflict', async () => {
      const { rail, controller } = await mountWorkspace({
        port: { updateObjective: async () => { const error = new Error('stale'); error.code = 'revision_conflict'; error.currentRevision = '3'; throw error; } },
      });
      controller.beginEdit();
      const result = await controller.saveObjective({ ...controller.state.editor.draft, meaning: '入力を保持する' });
      expect(result.state).toBe('conflict');
      const panel = byClass(rail, 'bb-objective-rail')[0];
      expect(panel.attributes['data-rail-mode']).toBe('form');
      const text = collectText(panel);
      expect(text).toContain('版の競合');
      expect(text).toContain('現在の版: 3。入力は残しています。');
      expect(findAll(panel, (node) => nodeName(node) === 'meaning')[0].value).toBe('入力を保持する');
      // Saving again against the same revision would fail again, so there is no retry button.
      expect(findButtons(byClass(panel, 'bb-ws-notice')[0])).toHaveLength(0);
    });

    it('creates an objective from the page head in the rail, and cancelling returns to the previous one', async () => {
      const { root, rail, controller } = await mountWorkspace();
      findButtons(byClass(root, 'bb-ws-page-head')[0]).find((button) => button.textContent === '新しい目的').dispatch('click');
      let panel = byClass(rail, 'bb-objective-rail')[0];
      expect(panel.attributes['data-rail-mode']).toBe('form');
      expect(collectText(byClass(panel, 'bb-ws-rail-head')[0])).toContain('新しい目的');
      findButtons(panel).find((button) => button.textContent === 'キャンセル').dispatch('click');
      await new Promise((resolve) => setTimeout(resolve, 0));
      panel = byClass(rail, 'bb-objective-rail')[0];
      expect(panel.attributes['data-rail-mode']).toBe('detail');
      expect(controller.state.selectedId).toBe('objective-load');
      expect(collectText(byClass(panel, 'bb-ws-rail-head')[0])).toContain('フロント総対応負荷を減らす');
    });

    it('offers no edit actions when the host does not allow writing', async () => {
      const { root, rail } = await mountWorkspace({ canEdit: false });
      expect(findButtons(byClass(root, 'bb-ws-page-head')[0]).map((button) => button.textContent)).toEqual(['再読込']);
      expect(findButtons(rail)).toHaveLength(0);
    });

    it('shows a failed list as a notice with 未確認 metrics, never as zero objectives', async () => {
      const { root } = await mountWorkspace({ port: { listObjectives: async () => { const error = new Error('読めません'); error.statusCode = 503; throw error; } } });
      expect(byClass(root, 'bb-ws-metric').map((metric) => metric.children[1].textContent)).toEqual(['未確認', '未確認', '未確認']);
      expect(byClass(root, 'bb-objective-ledger')).toHaveLength(0);
      const notice = byClass(root, 'bb-ws-notice')[0];
      expect(notice.className).toContain('is-danger');
      expect(collectText(notice)).toContain('読めません');
      expect(collectText(root)).not.toContain('目的はまだ登録されていません。');
    });

    it('takes the host title, lead, notice and buttons in the page head', async () => {
      const clicks = [];
      const host = {
        title: '目的',
        lead: '選んだプロジェクトの目的です。',
        sourceNotice: { label: '対象', text: 'Atlas導入（一覧で切り替え）' },
        pageActions: [{ text: '書き出す', onClick: () => clicks.push('export') }, { text: '止める', variant: 'danger', disabled: true }],
      };
      const { root, controller, controllerOptions } = await mountWorkspace({ host });
      const wrapper = byClass(root, 'bb-objective-workspace')[0];
      expect(findAll(root, (node) => node.tagName === 'H1')[0].textContent).toBe('目的');
      expect(collectText(byClass(root, 'bb-ws-lead')[0])).toBe('選んだプロジェクトの目的です。');
      // The notice comes right after the page head, before the metrics.
      expect(wrapper.children.map((node) => node.className.split(' ')[0])).toEqual(['bb-ws-page', 'bb-ws-notice', 'bb-ws-summary', 'bb-ws-ledger']);
      expect(collectText(wrapper.children[1])).toBe('対象Atlas導入（一覧で切り替え）');
      const buttons = findButtons(byClass(root, 'bb-ws-page-head')[0]);
      expect(buttons.map((button) => [button.textContent, button.className, button.attributes.disabled ?? null])).toEqual([
        ['再読込', 'bb-ws-button', null],
        ['新しい目的', 'bb-ws-button is-primary', null],
        ['書き出す', 'bb-ws-button', null],
        ['止める', 'bb-ws-button is-danger', ''],
      ]);
      buttons[2].dispatch('click');
      expect(clicks).toEqual(['export']);
      // A host may change its copy in the options it passed and draw again.
      controllerOptions.sourceNotice = { label: '対象', text: 'Beta検証（一覧で切り替え）' };
      controller.render();
      expect(collectText(byClass(root, 'bb-objective-workspace')[0].children[1])).toBe('対象Beta検証（一覧で切り替え）');
    });

    it('keeps today\'s page head without host options', async () => {
      const { root } = await mountWorkspace();
      const wrapper = byClass(root, 'bb-objective-workspace')[0];
      expect(wrapper.children.map((node) => node.className.split(' ')[0])).toEqual(['bb-ws-page', 'bb-ws-summary', 'bb-ws-ledger']);
      expect(collectText(byClass(root, 'bb-ws-lead')[0])).toBe('目指す状態と評価基準を、版つきで確かめて直します。下の「現状と見通し」は、目的とは分けた、いまの理解（観測と仮説）です。');
    });

    it('without a rail ignores the host options and draws the same tabs layout', async () => {
      // The tree as a plain value: tags, classes, attributes, text and children (not listeners).
      const shape = (node) => ({
        tag: node.tagName,
        className: node.className,
        attributes: node.attributes,
        text: node.textContent,
        value: node.value,
        disabled: node.disabled,
        hidden: node.hidden,
        children: node.children.map(shape),
      });
      const draw = async (host) => {
        globalThis.document = new FakeDocument();
        const root = new FakeElement('div');
        const { port } = workspacePort();
        const controller = createObjectiveEditorController({ root, port, context: {}, canEdit: true, autoLoad: false, ...host });
        await controller.loadObjectives();
        return JSON.stringify(shape(root));
      };
      const plain = await draw({});
      const withHost = await draw({
        title: '目的',
        lead: '別の説明',
        sourceNotice: { label: '対象', text: 'Atlas導入' },
        pageActions: [{ text: '書き出す', onClick: () => {} }],
      });
      expect(withHost).toBe(plain);
      expect(plain).not.toContain('書き出す');
      expect(plain).toContain('目的と評価基準');
    });

    it('without a rail keeps the tabs layout and never draws the workspace pattern', async () => {
      globalThis.document = new FakeDocument();
      const root = new FakeElement('div');
      const { port } = workspacePort();
      const controller = createObjectiveEditorController({ root, port, context: {}, canEdit: true, autoLoad: false });
      await controller.loadObjectives();
      expect(root.children[0].className).toBe('objective-editor-root');
      expect(findAll(root, (node) => node.tagName === 'H1')[0].textContent).toBe('目的と評価基準');
      expect(byClass(root, 'objective-editor-tab').map((tab) => tab.textContent)).toEqual(['目的一覧', '目的を編集', 'Story参照']);
      expect(findAll(root, (node) => String(node.className).includes('bb-ws-'))).toHaveLength(0);
      // The first objective is not opened by itself in the tabs layout.
      expect(controller.state.view).toBe('list');
      expect(controller.state.selectedId).toBeNull();
    });
  });
});
