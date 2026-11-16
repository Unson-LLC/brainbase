/* story-objective-row-actions-v1: a row of 目的と現状 opens what can be done with the objective (or why
 * nothing can be done from here), and 待っていること says whose what the objective waits for. */
import { strict as assert } from 'node:assert';
import { test } from 'vitest';

import { objectiveWaiting, renderFoundationCollectionOverview } from '../../ui/foundation-overview.js';
import { FakeDocument, collectText, findAll } from './world-canvas-harness.mjs';

const doc = new FakeDocument();
// The harness has no modal dialog; this one opens and closes like the browser's.
const createElement = doc.createElement.bind(doc);
doc.createElement = (tag) => {
  const node = createElement(tag);
  if (tag === 'dialog') {
    node.showModal = () => { node.open = true; };
    node.close = () => { node.open = false; node.dispatch('close'); };
  }
  return node;
};
const byClass = (node, name) => findAll(node, (item) => String(item.className).split(' ').includes(name));

function objective(id, { accountableId = null, current = undefined, criteria = [{ variableRef: { id: 'variable-a', type: 'variable', revision: '1' }, operator: 'at_least', target: 1 }] } = {}) {
  return {
    definition: {
      id, type: 'objective', revision: '1', meaning: `${id}の意味`, desiredState: '目指す状態', adoptionState: 'draft', authorizedUses: ['draft'],
      acl: { ownerId: 'owner', visibility: 'project', readerIds: [], writerIds: ['owner'] }, storage: 'candidate',
      provenance: [{ sourceId: 'doc', sourceKind: 'document', evidenceIds: [] }], scope: { subjectIds: ['project-alpha'], validFrom: '2026-01-01T00:00:00.000Z' },
      criteria, evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' }, ...(accountableId ? { accountableId } : {}),
    },
    details: { title: `${id}の題`, ...(current ? { current_state: current } : {}) },
    digest: `sha256:${id}`,
  };
}

const unconfirmed = objective('obj-a', { current: { as_of: '2026-10-06', status: '方針は確認済み', missing: ['評価者', '実績'] } });
const unrecorded = objective('obj-b', { accountableId: 'per_owner', criteria: [] });
const catalog = {
  contractVersion: 'foundation-overview.v1', scopeId: 'project-alpha', objectives: [unconfirmed, unrecorded],
  variables: [{ definition: { id: 'variable-a', type: 'variable', revision: '1', meaning: '件数', adoptionState: 'draft', authorizedUses: ['draft'], acl: { ownerId: 'owner', visibility: 'project', readerIds: [], writerIds: [] }, storage: 'candidate', provenance: [], scope: { subjectIds: ['project-alpha'] } }, digest: 'sha256:v' }],
  models: [], philosophies: [], philosophies_without_applicability: [],
};

function draw(callbacks = {}) {
  const root = doc.createElement('div');
  doc.body.replaceChildren();
  const sources = [{ scopeId: 'project-alpha', label: 'Alpha', state: { status: 'ready', catalog } }];
  renderFoundationCollectionOverview(root, sources, { document: doc, viewState: { query: '', page: 0 }, callbacks });
  const rows = findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes['data-key']);
  return { root, rows, dialog: () => findAll(doc.body, (node) => node.tagName === 'DIALOG')[0] };
}

test('says whose what each objective waits for, from its own record', () => {
  assert.deepEqual(objectiveWaiting(unconfirmed), { what: '未確認：評価者・実績', who: '責任者が未記録のため、確かめる人が決まっていません', items: ['評価者', '実績'], kind: 'unconfirmed', accountableRecorded: false });
  assert.equal(objectiveWaiting(unrecorded).what, '未記録：評価基準・記録上の現状');
  assert.equal(objectiveWaiting(unrecorded).who, '責任者の確認待ち');
  const { root } = draw();
  const text = collectText(root);
  assert.match(text, /待っていること/);
  assert.doesNotMatch(text, /確認待ち確認日/, 'the column is no longer the bare 確認待ち');
  assert.match(text, /未確認：評価者・実績責任者が未記録のため、確かめる人が決まっていません/);
  assert.match(text, /未記録：評価基準・記録上の現状責任者の確認待ち/);
});

test('a row opens what can be done: the host\'s way to correct the objective', () => {
  const asked = [];
  const { root, rows, dialog } = draw({ objectiveAction: (context) => ({ label: '目的を直す・現状を記録する', onSelect: () => asked.push(context) }) });
  assert.match(collectText(root), /行を押すと、目的の詳細と、この目的でできること（直す・現状を記録する）が開きます。/);
  rows[0].click();
  const opened = dialog();
  assert.ok(opened?.open, 'the row opens the objective');
  const text = collectText(opened);
  assert.match(text, /待っていること何を未確認：評価者・実績誰が責任者が未記録のため、確かめる人が決まっていません/);
  assert.match(text, /この目的でできること/);
  const button = findAll(byClass(opened, 'bb-fov-actions')[0], (node) => node.tagName === 'BUTTON')[0];
  assert.equal(button.textContent, '目的を直す・現状を記録する ›');
  button.click();
  assert.equal(opened.open, false, 'going to the editor closes the dialog');
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].scopeIds, ['project-alpha']);
  assert.equal(asked[0].objectiveId, 'obj-a');
  assert.equal(asked[0].title, 'obj-aの題');
});

test('without a way to correct it, the dialog says why and shows no control that does nothing', () => {
  const readonly = draw({ objectiveAction: () => ({ unavailable: 'この事業の目的を保存する権限がありません。' }) });
  readonly.rows[0].click();
  const actions = byClass(readonly.dialog(), 'bb-fov-actions')[0];
  assert.match(collectText(actions), /この事業の目的を保存する権限がありません。/);
  assert.equal(findAll(actions, (node) => node.tagName === 'BUTTON').length, 0);

  const none = draw();
  assert.match(collectText(none.root), /行を押すと、目的の詳細が開きます。この画面は読むだけです。/);
  none.rows[1].click();
  const plain = byClass(none.dialog(), 'bb-fov-actions')[0];
  assert.match(collectText(plain), /この画面は読むだけです。ここからは記録を変えられません。/);
  assert.equal(findAll(plain, (node) => node.tagName === 'BUTTON').length, 0);
});
