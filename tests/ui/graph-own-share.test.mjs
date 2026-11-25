import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openOwnerPrivateGraph } from '../../src/graph-web.js';
import { createGraphProjectsView } from '../../ui/graph-projects-view.js';
import {
  createOwnObjectivesView,
  createOwnShareView,
  GRAPH_OWN_OBJECTIVES_LABEL,
  GRAPH_OWN_SHARE_COMMANDS,
  GRAPH_OWN_SHARE_LABEL,
  ownShareHandoverRows,
  ownShareHandoverText,
} from '../../ui/graph-own-share.js';
import { FIXTURE_NOW, writeGraphV2 } from '../graph-web-fixture.js';
import { OWNER_NAME, OWNER_PERSON_ID, ownerPrivateBundle } from '../owner-private-graph-fixture.js';
import {
  buttonsNamed,
  collectText,
  FakeDocument,
  FakeElement,
  findAll,
  jsonResponse,
  section,
  startGraphApi,
  type,
  visibleText,
  waitFor,
} from './graph-ui-harness.mjs';

/*
 * The owner's own share next to a host's Graph (handover contract §7, H4):
 * a separate read-only section, `self` shown by the owner's name, never mixed
 * into the host's ledgers or rail, and a failure there only.
 */

const OWN_BASE = '/api/graph/own';
const HANDOVER = { graphId: 'snapshot-1', projectCode: 'project-a', digest: 'sha256:fixture', createdAt: '2026-09-27T01:00:00.000Z' };
const OWN_SOURCE = { dataDir: null, graphFormat: 2, authority: 'owner_private' };

let directory;
let dataDir;
let api;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-graph-own-share-ui-'));
  dataDir = join(directory, 'personal-os');
  api = null;
});

afterEach(async () => {
  await api?.close();
  await rm(directory, { recursive: true, force: true });
});

/** A bundle with a project the host's Graph does not have, so mixing would show. */
function ownBundle() {
  const bundle = ownerPrivateBundle();
  bundle.graph.entities.push({ id: 'project-own-only', type: 'project', name: '手元だけの案件', metadata: { goal: '手元で進める', status: '進行中' } });
  return bundle;
}

/**
 * The host's owner-private routes over `openOwnerPrivateGraph`, as a host
 * serves them.  `mode` is ok, none (not handed over) or failed.
 */
function ownHost(initial = 'ok', bundle = ownBundle()) {
  const graph = openOwnerPrivateGraph(bundle, { personId: OWNER_PERSON_ID, name: OWNER_NAME });
  const host = { mode: initial, requests: [] };
  host.fetch = async (path) => {
    host.requests.push(path);
    const url = new URL(path, 'http://host.test');
    const rest = url.pathname.slice(OWN_BASE.length);
    if (host.mode === 'none') return jsonResponse(200, { status: 'not_handed_over', source: OWN_SOURCE });
    if (host.mode === 'failed') return jsonResponse(502, { error: { code: 'own_share_unavailable', message: '所有者専用領域を読めませんでした' } });
    const now = FIXTURE_NOW;
    const asOf = url.searchParams.get('as_of') || undefined;
    let body;
    try {
      if (rest === '/projects') body = graph.listProjects({ now });
      else if (rest === '/search') {
        body = graph.search({ q: url.searchParams.get('q') ?? '', type: url.searchParams.get('type') || undefined, asOf, limit: Number(url.searchParams.get('limit') ?? 50), now });
      } else if (rest === '/objectives') body = graph.listObjectives();
      else if (rest.startsWith('/projects/')) body = graph.readProject(decodeURIComponent(rest.slice(10)), { now });
      else if (rest.startsWith('/entities/')) body = graph.readEntity(decodeURIComponent(rest.slice(10)), { asOf, now });
      else return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
    } catch (error) {
      return jsonResponse(error.kind === 'not_found' ? 404 : 502, { error: { code: error.code, message: error.message } });
    }
    return jsonResponse(200, { ...body, handover: HANDOVER });
  };
  return host;
}

function combinedFetcher(host) {
  return (path, init) => (String(path).startsWith(OWN_BASE) ? host.fetch(path, init) : api.fetcher(path, init));
}

const byClass = (node, className) => findAll(node, (item) => String(item.className).split(' ').includes(className));
const ownSection = (root, label = GRAPH_OWN_SHARE_LABEL) => section(root, label);
const rowsIn = (node) => findAll(node, (item) => item.tagName === 'BUTTON' && String(item.className).includes('bb-ws-ledger-row'));
const keysIn = (node) => rowsIn(node).map((row) => row.attributes['data-key']);
/** The host's own part of the workspace: everything outside the own-share section. */
function hostPart(root) {
  const surface = findAll(root, (node) => node.tagName === 'SECTION' && String(node.className).startsWith('bb-graph '))[0];
  const clone = new FakeElement('div');
  clone.children = surface.children.filter((child) => child.attributes?.['data-authority'] !== 'owner_private');
  return clone;
}

async function mountProjects({ host, ownShare = { basePath: OWN_BASE } } = {}) {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const rail = new FakeElement('div');
  const view = createGraphProjectsView({
    root, rail, document: new FakeDocument(), fetcher: host ? combinedFetcher(host) : api.fetcher, autoLoad: false,
    canCorrect: false, readOnlyNote: 'ホストの注記', ...(host ? { ownShare } : {}),
  });
  await view.load();
  return { root, rail, view };
}

describe('プロジェクトと関係者 with the owner\'s own share', () => {
  it('draws and reads nothing of the kind without ownShare (the local host)', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountProjects();
    expect(findAll(root, (node) => node.attributes?.['data-authority'] === 'owner_private')).toEqual([]);
    expect(visibleText(root)).not.toContain('引き継いだ');
    expect(api.requests.every((request) => !request.path.startsWith(OWN_BASE))).toBe(true);
  });

  it('shows the own projects in a separate read-only section after the host content, with self shown by the owner name', async () => {
    await writeGraphV2(dataDir);
    const host = ownHost();
    const { root, rail } = await mountProjects({ host });
    const own = ownSection(root);
    expect(own).toBeTruthy();
    const surface = findAll(root, (node) => node.tagName === 'SECTION' && String(node.className).startsWith('bb-graph '))[0];
    expect(surface.children.at(-1)).toBe(own);
    expect(own.attributes['data-authority']).toBe('owner_private');
    const text = visibleText(own);
    expect(text).toContain('読み取りのみ');
    expect(text).toContain(`${ownShareHandoverText(HANDOVER)}`);
    expect(text).toContain('に自分のBrainbaseから持ち込み');
    // The snapshot ID and digest stay reachable in the record details, not in the visible copy.
    expect(text).not.toContain('snapshot-1');
    expect(text).not.toContain('sha256:fixture');
    expect(collectText(own)).toContain('snapshot-1');
    expect(collectText(own)).toContain('sha256:fixture');
    expect(text).toContain(OWNER_NAME);
    expect(text).not.toContain('self');

    // Never mixed: the host's ledger, metrics and rail stay the host's.
    expect(keysIn(own)).toContain('project-own-only');
    expect(keysIn(hostPart(root))).toEqual(['project-atlas', 'project-beta']);
    expect(findAll(byClass(hostPart(root), 'bb-ws-summary')[0], (node) => node.tagName === 'STRONG').map((node) => node.textContent)).toEqual(['1', '1', '2']);
    expect(buttonsNamed(own, 'プロジェクトを直す')).toEqual([]);
    expect(buttonsNamed(own, '関係者を加える')).toEqual([]);
    expect(host.requests).toEqual([`${OWN_BASE}/projects`]);

    // An own project opens below its ledger; the rail keeps the host's project.
    const railBefore = collectText(rail);
    rowsIn(own).find((row) => row.attributes['data-key'] === 'project-atlas').dispatch('click');
    await waitFor(() => visibleText(ownSection(root)).includes('発起人'));
    const detail = byClass(ownSection(root), 'bb-graph-own-detail')[0];
    expect(visibleText(detail)).toContain('持ち込んだ記録・プロジェクト');
    expect(visibleText(detail)).toContain(`責任${OWNER_NAME}`);
    expect(visibleText(detail)).not.toContain('null');
    expect(visibleText(detail)).not.toContain('self');
    expect(collectText(rail)).toBe(railBefore);
    buttonsNamed(detail, '閉じる')[0].dispatch('click');
    expect(byClass(ownSection(root), 'bb-graph-own-detail')).toEqual([]);
  });

  it('labels a missing handover digest as unconfirmed instead of hiding it', () => {
    expect(ownShareHandoverRows({ graphId: 'snapshot-1', projectCode: 'project-a' })).toContainEqual(['照合用のコード', '未確認']);
  });

  it('says it has not been handed over yet, with the commands that send and list it', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountProjects({ host: ownHost('none') });
    const text = visibleText(ownSection(root));
    expect(text).toContain('まだ何も持ち込まれていません');
    for (const command of GRAPH_OWN_SHARE_COMMANDS) expect(text).toContain(command);
    expect(GRAPH_OWN_SHARE_COMMANDS).toEqual(['brainbase graph:upgrade', 'brainbase graph:bundles']);
    expect(keysIn(hostPart(root))).toEqual(['project-atlas', 'project-beta']);
  });

  it('shows a failed read only in the own section, and reads it again on retry', async () => {
    await writeGraphV2(dataDir);
    const host = ownHost('failed');
    const { root } = await mountProjects({ host });
    const text = visibleText(ownSection(root));
    expect(text).toContain('読み取り失敗');
    expect(text).toContain('所有者専用領域を読めませんでした');
    expect(text).toContain('0件ではありません');
    expect(visibleText(hostPart(root))).not.toContain('読み取り失敗');
    expect(keysIn(hostPart(root))).toEqual(['project-atlas', 'project-beta']);
    host.mode = 'ok';
    buttonsNamed(ownSection(root), '再試行')[0].dispatch('click');
    await waitFor(() => keysIn(ownSection(root)).includes('project-own-only'));
  });

  it('keeps the own section when the host Graph cannot be shown', async () => {
    // No data in the host's directory: the host shows its own notice, the own share still shows.
    const { root } = await mountProjects({ host: ownHost() });
    expect(visibleText(hostPart(root))).toContain('まだ登録がありません');
    expect(keysIn(ownSection(root))).toContain('project-own-only');
  });
});

async function mountOwnShare(host) {
  const root = new FakeElement('div');
  const view = createOwnShareView({ root, document: new FakeDocument(), fetcher: host.fetch, autoLoad: false, now: () => new Date(FIXTURE_NOW) });
  await view.search('');
  return { root, view };
}

/*
 * 引き継いだ自分の分 on its own (ledger D14): the owner's snapshot is not part of
 * 情報と関係; a host places it where the owner takes records in (候補の確認).
 */
describe('引き継いだ自分の分 on its own', () => {
  it('says what the snapshot is, lists it read-only with self shown by the owner name, and searches it', async () => {
    const host = ownHost();
    const { root, view } = await mountOwnShare(host);
    const own = ownSection(root);
    expect(own.attributes['data-authority']).toBe('owner_private');
    const lead = visibleText(own);
    expect(lead).toContain('自分のBrainbaseから持ち込んだ最新の記録です');
    expect(lead).toContain('組織の記録とは別に、あなただけに表示されます');
    expect(lead).toContain('組織の記録に書き込むものを選びます');
    expect(lead).toContain('読み取りのみ');
    expect(lead).toContain(ownShareHandoverText(HANDOVER));
    expect(lead).not.toContain('snapshot-1');
    expect(collectText(own)).toContain('snapshot-1');
    expect(keysIn(own)).toContain(OWNER_PERSON_ID);
    expect(keysIn(own)).not.toContain('self');
    expect(lead).toContain(OWNER_NAME);
    expect(lead).toMatch(/持ち込んだ記録 \d+件/u);
    expect(host.requests).toEqual([`${OWN_BASE}/search?limit=50`]);
    // Read-only: no correction anywhere.
    expect(buttonsNamed(root, 'この記録を直す')).toEqual([]);

    type(root, 'q', '手元');
    await findAll(root, (node) => node.tagName === 'FORM' && String(node.className).includes('bb-graph-own-search'))[0].dispatch('submit');
    await waitFor(() => keysIn(ownSection(root)).join() === 'project-own-only');
    expect(host.requests.at(-1)).toBe(`${OWN_BASE}/search?q=${encodeURIComponent('手元')}&limit=50`);
    expect(view.state.applied).toBe('手元');
  });

  it('opens a decision with its judgment record and follows its relations inside the section', async () => {
    const { root } = await mountOwnShare(ownHost());
    rowsIn(ownSection(root)).find((row) => row.attributes['data-key'] === 'decision-scope').dispatch('click');
    await waitFor(() => visibleText(ownSection(root)).includes('最初の利用者の手戻りを小さくするため'));
    const detail = byClass(ownSection(root), 'bb-graph-own-detail')[0];
    expect(visibleText(section(detail, '判断根拠'))).toContain('判断小さく始める');
    buttonsNamed(detail, 'Atlas導入')[0].dispatch('click');
    await waitFor(() => visibleText(byClass(ownSection(root), 'bb-graph-own-detail')[0]).includes('持ち込んだ記録・プロジェクト'));
    buttonsNamed(byClass(ownSection(root), 'bb-graph-own-detail')[0], '閉じる')[0].dispatch('click');
    expect(byClass(ownSection(root), 'bb-graph-own-detail')).toEqual([]);
  });

  it('says it has not been handed over with the commands, and never shows a failure as zero items', async () => {
    const none = visibleText((await mountOwnShare(ownHost('none'))).root);
    expect(none).toContain('まだ何も持ち込まれていません');
    for (const command of GRAPH_OWN_SHARE_COMMANDS) expect(none).toContain(command);

    const host = ownHost('failed');
    const { root } = await mountOwnShare(host);
    const failed = visibleText(ownSection(root));
    expect(failed).toContain('読み取り失敗');
    expect(failed).toContain('0件ではありません');
    expect(byClass(ownSection(root), 'bb-graph-own-caption')).toEqual([]);
    host.mode = 'ok';
    buttonsNamed(ownSection(root), '再試行')[0].dispatch('click');
    await waitFor(() => keysIn(ownSection(root)).includes('project-own-only'));
  });

  it('takes the host label and lead, and stops drawing after destroy', async () => {
    const root = new FakeElement('div');
    let resolveRead;
    const view = createOwnShareView({ root, document: new FakeDocument(), fetcher: () => new Promise((resolve) => { resolveRead = resolve; }), autoLoad: false, label: '自分の束', lead: 'ホストの説明' });
    const pending = view.search('');
    expect(visibleText(section(root, '自分の束'))).toContain('ホストの説明');
    view.destroy();
    resolveRead(jsonResponse(200, { status: 'not_handed_over', source: OWN_SOURCE }));
    await pending;
    expect(root.children.length).toBe(0);
  });
});

class DrawerDocument extends FakeDocument {
  constructor() { super(); this.body = this.createElement('body'); this.defaultView = { matchMedia: () => ({ matches: true }) }; }
  createElement(tag) {
    const node = super.createElement(tag);
    node.ownerDocument = this;
    node.classList = { add: name => { node.className += ` ${name}`; }, remove: name => { node.className = node.className.split(' ').filter(value => value !== name).join(' '); } };
    node.focus = () => { this.activeElement = node; };
    node.showModal = () => { node.open = true; };
    node.close = () => { node.open = false; };
    node.remove = () => { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node); node.removed = true; };
    node.isConnected = true;
    return node;
  }
}

describe('explicit details-only composition', () => {
  it('never uses a different snapshot for a pending name or a relation counterpart', async () => {
    const host = ownHost(), doc = new DrawerDocument(), root = doc.createElement('div');
    const search = await (await host.fetch(`${OWN_BASE}/search`)).json();
    const record = await (await host.fetch(`${OWN_BASE}/entities/decision-scope`)).json();
    const handoverB = { ...HANDOVER, digest: 'snapshot-b' };
    let hold = false, resolveEntity;
    const view = createOwnShareView({ root, document: doc, autoLoad: false, presentation: 'details-only', fetcher: path => {
      if (path.includes('/search')) return Promise.resolve(jsonResponse(200, { ...search, handover: handoverB, results: search.results.map(entity => ({ ...entity, name: 'Snapshot B list name' })) }));
      if (hold) return new Promise(resolve => { resolveEntity = resolve; });
      return Promise.resolve(jsonResponse(200, { ...record, handover: handoverB, entity: { ...record.entity, name: 'Snapshot B detail' }, outgoing: record.outgoing.map(edge => ({ ...edge, counterpart: { ...edge.counterpart, name: 'Snapshot B counterpart' } })) }));
    } });
    await view.search('');
    const first = await view.openEntity('decision-scope', { expectedHandover: HANDOVER });
    expect(first.state).toBe('unknown'); expect(first.pending).toBe(null);
    expect(collectText(doc.body)).not.toContain('Snapshot B');
    await view.openEntity('decision-scope', { expectedHandover: handoverB });
    hold = true;
    const next = view.openEntity('project-atlas', { expectedHandover: HANDOVER });
    expect(view.state.detail.pending).toBe(null); expect(collectText(doc.body)).not.toContain('Snapshot B');
    resolveEntity(await host.fetch(`${OWN_BASE}/entities/project-atlas`)); await next;
    expect(view.state.detail.state).toBe('unknown'); expect(collectText(doc.body)).not.toContain('Snapshot B');
    view.destroy();
  });

  it('keeps a detail during refresh loading but revokes it after a failed or missing snapshot, including a late detail read', async () => {
    for (const response of [jsonResponse(200, { status: 'not_handed_over', source: OWN_SOURCE }), jsonResponse(403, { error: { code: 'forbidden', message: 'Unavailable' } }), jsonResponse(502, { error: { message: 'Read failed' } })]) {
      const host = ownHost(), doc = new DrawerDocument(), root = doc.createElement('div');
      const original = await (await host.fetch(`${OWN_BASE}/entities/decision-scope`)).json();
      let refresh = false, holdEntity = false, resolveSearch, resolveEntity;
      const view = createOwnShareView({ root, document: doc, autoLoad: false, presentation: 'details-only', fetcher: path => {
        if (refresh && path.includes('/search')) return new Promise(resolve => { resolveSearch = resolve; });
        if (holdEntity && path.includes('/entities/')) return new Promise(resolve => { resolveEntity = resolve; });
        return host.fetch(path);
      } });
      await view.search(''); await view.openEntity('decision-scope');
      refresh = true; const reading = view.search('');
      expect(doc.body.children[0].open).toBe(true); expect(collectText(doc.body)).toContain('最初の利用者の手戻りを小さくするため');
      resolveSearch(response); await reading;
      expect(view.state.detail).toBe(null); expect(doc.body.children[0].open).toBe(false);
      expect(collectText(doc.body)).not.toContain('最初の利用者の手戻りを小さくするため');
      refresh = false; await view.search(''); holdEntity = true;
      const pending = view.openEntity('decision-scope');
      refresh = true; const missing = view.search(''); resolveSearch(response); await missing;
      resolveEntity(jsonResponse(200, original)); await pending;
      expect(view.state.detail).toBe(null); expect(doc.body.children[0].open).toBe(false);
      view.destroy();
    }
  });

  it('exposes the existing search read without drawing a duplicate list and retains decision details and relation navigation', async () => {
    const host = ownHost(), doc = new DrawerDocument(), root = doc.createElement('div'), changes = [];
    const view = createOwnShareView({ root, document: doc, fetcher: host.fetch, presentation: 'details-only', autoLoad: false, onState: read => changes.push(read), detailCopy: { kicker: 'Imported records', outgoingTitle: 'From this record', incomingTitle: 'To this record' } });
    await view.search('');
    expect(changes.map(read => read.state)).toEqual(['loading', 'ok']);
    expect(changes[1].payload.handover).toEqual(HANDOVER);
    expect(root.children).toEqual([]);
    const opener = doc.createElement('button'); opener.focus();
    await view.openEntity('decision-scope', { opener });
    const dialog = doc.body.children[0];
    expect(dialog.open).toBe(true); expect(collectText(dialog)).toContain('最初の利用者の手戻りを小さくするため');
    expect(collectText(dialog)).toContain('From this record');
    expect(buttonsNamed(dialog, '閉じる')).toHaveLength(1);
    await buttonsNamed(dialog, 'Atlas導入')[0].dispatch('click');
    expect(view.state.detail.id).toBe('project-atlas');
    dialog.dispatch('cancel');
    expect(dialog.open).toBe(false); expect(view.state.detail).toBe(null); expect(doc.activeElement).toBe(opener);
    view.destroy(); expect(doc.body.children).toEqual([]);
  });

  it('rejects stale same-ID reads, mismatched IDs and snapshot identities, and never reopens after close or disposal', async () => {
    const host = ownHost(), doc = new DrawerDocument(), root = doc.createElement('div');
    const original = await (await host.fetch(`${OWN_BASE}/entities/decision-scope`)).json();
    const pending = [];
    const view = createOwnShareView({ root, document: doc, autoLoad: false, presentation: 'details-only', fetcher: path => path.includes('/entities/') ? new Promise(resolve => pending.push(resolve)) : host.fetch(path) });
    await view.search('');
    const first = view.openEntity('decision-scope'), second = view.openEntity('decision-scope');
    pending[1](jsonResponse(200, { ...original, entity: { ...original.entity, summary: 'Newest read' } })); await second;
    pending[0](jsonResponse(200, original)); await first;
    expect(view.state.detail.payload.entity.summary).toBe('Newest read');
    const wrong = view.openEntity('decision-scope'); pending[2](jsonResponse(200, { ...original, entity: { ...original.entity, id: 'another-id' } })); await wrong;
    expect(view.state.detail.state).toBe('invalid');
    const snapshot = view.openEntity('decision-scope'); pending[3](jsonResponse(200, { ...original, handover: { ...HANDOVER, digest: 'different-snapshot' } })); await snapshot;
    expect(view.state.detail.state).toBe('unknown');
    const late = view.openEntity('decision-scope'); view.closeDetail({ immediate: true });
    const reopened = view.openEntity('decision-scope');
    pending[4](jsonResponse(200, original)); await late; expect(view.state.detail.state).toBe('loading');
    pending[5](jsonResponse(200, original)); await reopened; expect(view.state.detail.state).toBe('ok');
    const expected = view.openEntity('decision-scope', { expectedHandover: { ...HANDOVER, digest: 'old-list-snapshot' } });
    pending[6](jsonResponse(200, original)); await expected; expect(view.state.detail.state).toBe('unknown');
    const closed = view.openEntity('decision-scope'); view.closeDetail({ immediate: true }); pending[7](jsonResponse(200, original)); await closed;
    expect(view.state.detail).toBe(null); expect(doc.body.children[0].open).toBe(false);
    const disposed = view.openEntity('decision-scope'); view.destroy(); pending[8](jsonResponse(200, original)); await disposed;
    expect(doc.body.children).toEqual([]); expect(root.children).toEqual([]);
  });
});

describe('引き継いだ自分の目的', () => {
  async function mountObjectives(host) {
    const root = new FakeElement('div');
    const view = createOwnObjectivesView({ root, document: new FakeDocument(), fetcher: host.fetch, autoLoad: false });
    await view.load();
    return { root, view };
  }

  it('lists the objectives read-only with the owner named, and opens one', async () => {
    const { root, view } = await mountObjectives(ownHost());
    const own = section(root, GRAPH_OWN_OBJECTIVES_LABEL);
    expect(own.attributes['data-authority']).toBe('owner_private');
    expect(keysIn(own)).toEqual(['objective-protect-focus']);
    expect(visibleText(own)).toContain(OWNER_NAME);
    expect(visibleText(own)).not.toContain('self');
    expect(visibleText(own)).not.toContain('objective-protect-focus');
    view.select('objective-protect-focus');
    const detailNode = byClass(section(root, GRAPH_OWN_OBJECTIVES_LABEL), 'bb-graph-own-detail')[0];
    const detail = visibleText(detailNode);
    expect(detail).not.toContain('objective-protect-focus');
    expect(collectText(detailNode)).toContain('objective-protect-focus');
    expect(detail).toContain('目指す状態毎週10時間以上の集中時間を守る');
    expect(detail).toContain('週ごとの集中時間: 10 hours以上');
    expect(detail).toContain(`受益者${OWNER_NAME}、田中 太郎`);
    expect(buttonsNamed(root, '保存')).toEqual([]);
  });

  it('says it has not been handed over, has no objective, or could not be read, never zero items for a failure', async () => {
    expect(visibleText((await mountObjectives(ownHost('none'))).root)).toContain('brainbase graph:upgrade');
    const bare = ownerPrivateBundle({ foundation: null });
    expect(visibleText((await mountObjectives(ownHost('ok', bare))).root)).toContain('持ち込んだ記録には、目的の定義がありません。');
    const tampered = ownerPrivateBundle();
    tampered.graph.foundation.records[1].definition.desiredState = '書き換え';
    const failed = visibleText((await mountObjectives(ownHost('ok', tampered))).root);
    expect(failed).toContain('読み取り失敗');
    expect(failed).toContain('0件ではありません');
  });
});


it('compact own objectives preserve bundle provenance and never convert unavailable provenance to absence', async () => {
  const root = new FakeElement('div'), host = ownHost(); const notices = [];
  const view = createOwnObjectivesView({ root, document: new FakeDocument(), fetcher: host.fetch, compact: true, autoLoad: false, onNotice: n => notices.push(n) });
  await view.load();
  expect(collectText(root)).toContain('snapshot-1'); expect(collectText(root)).toContain('sha256:fixture');
  host.mode = 'failed'; await view.load();
  expect(collectText(root)).toContain('取得できません'); expect(collectText(root)).toContain('出典は確認できません');
  expect(collectText(root)).not.toContain('まだ何も持ち込まれていません'); expect(notices.at(-1).message).toContain('0件ではありません');
  host.mode = 'none'; await view.load(); expect(collectText(root)).toContain('目的はまだ持ち込まれていません');
  view.destroy();
});

it('destroy ignores late compact own objectives and does not notify a discarded host', async () => {
  const root = new FakeElement('div'); let resolveRead; const states = [];
  const view = createOwnObjectivesView({ root, document: new FakeDocument(), fetcher: () => new Promise(r => { resolveRead = r; }), compact: true, autoLoad: false, onState: s => states.push(s) });
  const pending = view.load(); const count = states.length; view.destroy();
  resolveRead(jsonResponse(200, { status: 'not_handed_over', source: OWN_SOURCE })); await pending;
  expect(states.length).toBe(count); expect(root.children.length).toBe(0);
});
