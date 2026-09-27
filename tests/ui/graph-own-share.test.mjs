import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openOwnerPrivateGraph } from '../../src/graph-web.js';
import { createGraphProjectsView } from '../../ui/graph-projects-view.js';
import { createGraphRegistryView } from '../../ui/graph-registry-view.js';
import {
  createOwnObjectivesView,
  GRAPH_OWN_OBJECTIVES_LABEL,
  GRAPH_OWN_SHARE_COMMANDS,
  GRAPH_OWN_SHARE_LABEL,
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
    expect(text).toContain('束 snapshot-1（置き場所 project-a、');
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
    expect(visibleText(detail)).toContain('プロジェクト（引き継いだ自分の分）');
    expect(visibleText(detail)).toContain(`責任${OWNER_NAME}`);
    expect(visibleText(detail)).not.toContain('self');
    expect(collectText(rail)).toBe(railBefore);
    buttonsNamed(detail, '閉じる')[0].dispatch('click');
    expect(byClass(ownSection(root), 'bb-graph-own-detail')).toEqual([]);
  });

  it('says it has not been handed over yet, with the commands that send and list it', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountProjects({ host: ownHost('none') });
    const text = visibleText(ownSection(root));
    expect(text).toContain('まだ引き継いでいません');
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

async function mountRegistry(host) {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const rail = new FakeElement('div');
  const view = createGraphRegistryView({
    root, rail, document: new FakeDocument(), fetcher: combinedFetcher(host), autoLoad: false, canCorrect: false,
    ownShare: { basePath: OWN_BASE },
  });
  await view.load();
  return { root, rail, view };
}

describe('情報と関係 with the owner\'s own share', () => {
  it('runs the same search on the own share and shows its results apart from the organization results', async () => {
    await writeGraphV2(dataDir);
    const host = ownHost();
    const { root } = await mountRegistry(host);
    const own = ownSection(root);
    expect(keysIn(own)).toContain(OWNER_PERSON_ID);
    expect(keysIn(own)).not.toContain('self');
    expect(keysIn(hostPart(root))).not.toContain(OWNER_PERSON_ID);
    expect(visibleText(hostPart(root))).toContain('組織のGraphの検索結果');
    expect(visibleText(own)).toContain(OWNER_NAME);

    type(root, 'q', '手元');
    await findAll(root, (node) => node.tagName === 'FORM' && String(node.className).includes('bb-gr-search'))[0].dispatch('submit');
    await waitFor(() => keysIn(ownSection(root)).join() === 'project-own-only');
    expect(host.requests.at(-1)).toBe(`${OWN_BASE}/search?q=${encodeURIComponent('手元')}&limit=50`);
    expect(keysIn(hostPart(root))).toEqual([]);
  });

  it('opens a decision of the own share with its judgment record, and follows its relations inside the section', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountRegistry(ownHost());
    const railBefore = collectText(rail);
    rowsIn(ownSection(root)).find((row) => row.attributes['data-key'] === 'decision-scope').dispatch('click');
    await waitFor(() => visibleText(ownSection(root)).includes('最初の利用者の手戻りを小さくするため'));
    const detail = byClass(ownSection(root), 'bb-graph-own-detail')[0];
    expect(visibleText(section(detail, '判断根拠'))).toContain('判断小さく始める');
    expect(collectText(rail)).toBe(railBefore);
    buttonsNamed(detail, 'Atlas導入')[0].dispatch('click');
    await waitFor(() => visibleText(byClass(ownSection(root), 'bb-graph-own-detail')[0]).includes('プロジェクト（引き継いだ自分の分）'));
  });

  it('keeps the organization search when the own share fails', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountRegistry(ownHost('failed'));
    expect(visibleText(ownSection(root))).toContain('読み取り失敗');
    expect(keysIn(hostPart(root)).length).toBeGreaterThan(0);
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
    view.select('objective-protect-focus');
    const detail = visibleText(byClass(section(root, GRAPH_OWN_OBJECTIVES_LABEL), 'bb-graph-own-detail')[0]);
    expect(detail).toContain('目指す状態毎週10時間以上の集中時間を守る');
    expect(detail).toContain('週ごとの集中時間: 10 hours以上');
    expect(detail).toContain(`受益者${OWNER_NAME}、田中 太郎`);
    expect(buttonsNamed(root, '保存')).toEqual([]);
  });

  it('says it has not been handed over, has no objective, or could not be read, never zero items for a failure', async () => {
    expect(visibleText((await mountObjectives(ownHost('none'))).root)).toContain('brainbase graph:upgrade');
    const bare = ownerPrivateBundle({ foundation: null });
    expect(visibleText((await mountObjectives(ownHost('ok', bare))).root)).toContain('この束には、目的の定義がありません。');
    const tampered = ownerPrivateBundle();
    tampered.graph.foundation.records[1].definition.desiredState = '書き換え';
    const failed = visibleText((await mountObjectives(ownHost('ok', tampered))).root);
    expect(failed).toContain('読み取り失敗');
    expect(failed).toContain('0件ではありません');
  });
});
