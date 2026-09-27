import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGraphCorrection, graphRecordDigest } from '../../src/graph-corrections.js';
import { createGraphProjectsView, GRAPH_PROJECT_LEDGER_COLUMNS, normalizeProjectList } from '../../ui/graph-projects-view.js';
import { EDGES, ENTITIES, FIXTURE_NOW, writeGraphV1, writeGraphV2 } from '../graph-web-fixture.js';
import {
  buttonsNamed,
  collectText,
  control,
  FakeDocument,
  FakeElement,
  findAll,
  jsonResponse,
  section,
  startGraphApi,
  submit,
  TOKEN,
  type,
  visibleText,
  waitFor,
} from './graph-ui-harness.mjs';

let directory;
let dataDir;
let api;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-graph-projects-ui-'));
  dataDir = join(directory, 'personal-os');
  api = null;
});

afterEach(async () => {
  await api?.close();
  await rm(directory, { recursive: true, force: true });
});

/** The owner's clock for the end-date default: a day before the fixture time in every time zone. */
const OWNER_NOW = () => new Date(2026, 8, 20, 12, 0, 0);
const PAGE = { crumbs: ['あなたのBrainbase', 'プロジェクトと関係者'], source: '手元のGraph' };

/** Mounts the screen with its own right rail, as the local Web shell does. */
async function mountView(options = {}) {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const rail = new FakeElement('div');
  const view = createGraphProjectsView({ root, rail, page: PAGE, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, now: OWNER_NOW, ...options });
  await view.load();
  return { root, rail, view };
}

const byClass = (node, className) => findAll(node, (item) => String(item.className).split(' ').includes(className));
const ledgerRows = (root) => findAll(root, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-ws-ledger-row'));
const ledgerRow = (root, key) => ledgerRows(root).find((node) => node.attributes['data-key'] === key);
const railHead = (rail) => collectText(byClass(rail, 'bb-ws-rail-head')[0]);
const metricValues = (root) => findAll(byClass(root, 'bb-ws-summary')[0], (node) => node.tagName === 'STRONG').map((node) => node.textContent);

function participantItem(rail, name) {
  return findAll(section(rail, '関係者'), (node) => node.tagName === 'LI' && String(node.className).includes('bb-graph-compact') && collectText(node).includes(name))[0];
}

async function history() {
  try {
    return (await readFile(join(dataDir, 'evidence', 'graph-corrections.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function storedEdge(id) {
  const graph = JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf8'));
  return graph.edges.find((edge) => edge.id === id);
}

describe('プロジェクトと関係者: workspace', () => {
  it('follows the organization screen pattern: breadcrumb and head, the source notice, metrics and the project ledger', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    expect(collectText(byClass(root, 'bb-ws-breadcrumb')[0])).toBe('あなたのBrainbase/プロジェクトと関係者');
    expect(findAll(root, (node) => node.tagName === 'H1')[0].textContent).toBe('プロジェクトと関係者');
    expect(byClass(root, 'bb-ws-source')[0].textContent).toBe('手元のGraph');
    const [source] = byClass(root, 'bb-ws-notice');
    expect(source.children[0].textContent).toBe('出典');
    expect(collectText(source)).toContain(dataDir);
    expect(collectText(source)).toContain('ログインや共有の設定ではありません');

    // Active projects, those 進行中, and each person with an active participation once.
    expect(metricValues(root)).toEqual(['1', '1', '2']);
    expect(collectText(byClass(root, 'bb-ws-summary')[0])).toContain('有効なもの（全2件）');

    const [ledger] = byClass(root, 'bb-ws-ledger');
    expect(ledger.className).toBe('bb-ws-ledger bb-graph-project-ledger');
    expect(findAll(ledger, (node) => node.attributes?.role === 'columnheader').map((node) => node.textContent)).toEqual([...GRAPH_PROJECT_LEDGER_COLUMNS]);
    expect(GRAPH_PROJECT_LEDGER_COLUMNS).toEqual(['プロジェクト', '目的', '責任を持つ人', '状態', '関係者', '有効期間']);
    const rows = ledgerRows(root);
    expect(rows).toHaveLength(2);
    expect(collectText(rows[0])).toBe('Atlas導入project-atlas導入を完了する佐藤 花子進行中2人期限なし');
    // The ended participation is not counted, and an unknown goal or accountable person is marked, not blank.
    expect(collectText(rows[1])).toBe('Beta検証project-beta目的未記入未登録完了0人2026-03-01 に終了');
    expect(rows[1].className).toContain('is-ended');
    expect(byClass(rows[1], 'is-unresolved').map((node) => node.textContent)).toEqual(['目的未記入', '未登録']);
    expect(visibleText(root)).not.toContain('BRAINBASE /');
  });

  it('selects the first project on load, shows it in the rail, and moves the rail with the selected row', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    expect(ledgerRow(root, 'project-atlas').className).toContain('is-selected');
    expect(ledgerRow(root, 'project-atlas').attributes['aria-pressed']).toBe('true');
    expect(railHead(rail)).toBe('プロジェクトAtlas導入project-atlas');
    // The detail stays in the rail, not in the workspace.
    expect(collectText(root)).not.toContain('判断の原則');

    ledgerRow(root, 'project-beta').dispatch('click');
    await waitFor(() => collectText(section(rail, '関係者') ?? new FakeElement('div')).includes('佐藤 花子'));
    expect(railHead(rail)).toBe('プロジェクトBeta検証project-beta');
    expect(ledgerRow(root, 'project-beta').className).toContain('is-selected');
    expect(ledgerRow(root, 'project-atlas').className).not.toContain('is-selected');
    expect(ledgerRow(root, 'project-atlas').attributes['aria-pressed']).toBe('false');
    const summary = visibleText(section(rail, '概要'));
    expect(summary).toContain('完了');
    expect(summary).toContain('2026-03-01 に終了');
    expect(summary).not.toContain('小さく始める');
    const sato = participantItem(rail, '佐藤 花子');
    expect(visibleText(sato)).toContain('2026-02-01 に終了');
    expect(buttonsNamed(sato, '終了日を直す')).toHaveLength(1);
    expect(api.requests.map((request) => request.path)).toEqual(['/api/graph/projects', '/api/graph/projects/project-atlas', '/api/graph/projects/project-beta']);
  });

  it('shows the goal, principles and every participation with how, role, validity and source in plain Japanese', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    const summary = visibleText(section(rail, '概要'));
    expect(summary).toContain('状態進行中有効');
    expect(summary).toContain('目的導入を完了する');
    expect(summary).toContain('判断の原則小さく始める');
    expect(summary).toContain('有効期間期限なし');
    expect(summary).toContain('出典このMacのGraph（graph.json）');

    const sato = visibleText(participantItem(rail, '佐藤 花子'));
    expect(sato).toContain('責任');
    expect(sato).toContain('役割PM');
    expect(sato).toContain('2026-01-01 から');
    expect(sato).toContain('取り込み');
    expect(sato).toContain('取り込み候補「佐藤 花子」（candidates/extracted-abc.json）');

    const tanakaItem = participantItem(rail, '田中 太郎');
    const tanaka = visibleText(tanakaItem);
    expect(tanaka).toContain('参加');
    expect(tanaka).toContain('役割責任者');
    expect(tanaka).toContain('文脈最終判断を担当');
    expect(tanaka).toContain('オンボーディング');
    // A source id that points to no local record is shown raw and marked.
    expect(tanaka).toContain('出典 relationship-reg1（未解決）');
    expect(byClass(tanakaItem, 'is-unresolved')[0].textContent).toBe('出典 relationship-reg1（未解決）');

    // Accountable first, then participants; ended participations stay listed.
    const items = findAll(section(rail, '関係者'), (node) => node.tagName === 'LI');
    expect(items.map((item) => byClass(item, 'bb-graph-compact-title')[0].textContent)).toEqual(['佐藤 花子', '田中 太郎']);
    expect(collectText(section(rail, 'そのほかの関係'))).toContain('スコープが進め方を決める');
    expect(buttonsNamed(rail, '関係者を加える')[0].className).toBe('bb-ws-button is-primary');
    expect(buttonsNamed(rail, 'プロジェクトを直す')).toHaveLength(1);

    const visible = `${visibleText(root)}${visibleText(rail)}`;
    for (const internal of ['edge-', 'sha256:', 'digest', 'Canonical', 'RACI', '権限', 'メンバー', 'アクセス']) {
      expect(visible, internal).not.toContain(internal);
    }
    // Ids and digests stay available inside the details disclosure.
    expect(collectText(tanakaItem)).toContain(EDGES.tanakaAtlas.id);
    // Nothing is ever deleted here.
    expect(findAll(rail, (node) => node.tagName === 'BUTTON' && /削除/u.test(node.textContent))).toEqual([]);
  });

  it('puts the rail content after the workspace when the host has no right rail', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    const view = createGraphProjectsView({ root, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, now: OWNER_NOW });
    await view.load();
    expect(root.children.map((node) => [node.tagName, node.className])).toEqual([
      ['SECTION', 'bb-graph bb-gp'],
      ['ASIDE', 'bb-graph-rail-inline'],
    ]);
    // Without a page context there is no breadcrumb or source label, and the screen still works.
    expect(byClass(root, 'bb-ws-breadcrumb')).toEqual([]);
    expect(railHead(root.children[1])).toBe('プロジェクトAtlas導入project-atlas');
    buttonsNamed(participantItem(root, '田中 太郎'), '役割を直す')[0].dispatch('click');
    expect(control(root.children[1], 'role').value).toBe('責任者');
  });

  it('reads the history of corrections beside the project and counts unreadable history lines apart', async () => {
    await writeGraphV2(dataDir);
    await applyGraphCorrection(dataDir, {
      kind: 'update_entity', entityId: 'project-atlas', expectedDigest: graphRecordDigest(ENTITIES.atlas), reason: '状態を最新にした。', changes: { status: '保留' },
    }, { now: FIXTURE_NOW });
    await writeFile(join(dataDir, 'evidence', 'graph-corrections.jsonl'), `${await readFile(join(dataDir, 'evidence', 'graph-corrections.jsonl'), 'utf8')}{ broken\n`);
    const { root, rail } = await mountView();
    const issues = byClass(root, 'bb-ws-notice').find((node) => collectText(node).includes('読めない記録'));
    expect(issues.className).toBe('bb-ws-notice is-warning');
    expect(collectText(issues)).toContain('読めない記録が1件あります');
    expect(collectText(issues)).toContain('evidence/graph-corrections.jsonl（2行目）');
    const text = collectText(rail);
    expect(text).toContain('訂正の履歴（1件）');
    expect(text).toContain('記録を直した（状態）。理由: 状態を最新にした。');
    expect(collectText(section(rail, '概要'))).toContain('保留');
  });
});

describe('プロジェクトと関係者: states', () => {
  it('shows Graph v1 as a migration with both commands, never as zero projects', async () => {
    await writeGraphV1(dataDir);
    const { root, rail } = await mountView();
    const text = collectText(root);
    expect(text).toContain('Graphの移行が必要です');
    expect(text).toContain('0件ではありません');
    expect(text).toContain(`brainbase ontology:migrate --dir ${dataDir}`);
    expect(text).toContain('--write --expected-input-digest');
    expect(text).toContain('Graph v1には2件の記録があります');
    expect(text).not.toContain('まだ登録がありません');
    expect(byClass(root, 'bb-ws-notice').some((node) => node.className === 'bb-ws-notice is-warning')).toBe(true);
    expect(byClass(root, 'bb-ws-ledger')).toEqual([]);
    expect(byClass(root, 'bb-ws-summary')).toEqual([]);
    expect(collectText(rail)).toContain('プロジェクトを選択');
  });

  it('shows how to start when no Brainbase data exists, and when the Graph confirms no project', async () => {
    const empty = await mountView();
    expect(collectText(empty.root)).toContain('まだ登録がありません');
    expect(collectText(empty.root)).toContain(`brainbase onboard:start --dir ${dataDir}`);
    expect(byClass(empty.root, 'bb-ws-ledger')).toEqual([]);
    await api.close();

    await writeGraphV2(dataDir, { entities: [ENTITIES.self], edges: [] });
    const { root, rail } = await mountView();
    const text = collectText(root);
    expect(text).toContain('まだ登録がありません');
    expect(text).toContain('brainbase onboard:projects --name <名前> --goal <目的> --write');
    // A confirmed absence is zero.
    expect(metricValues(root)).toEqual(['0', '0', '0']);
    expect(collectText(rail)).toContain('プロジェクトを選択');
  });

  it('reports a read failure with a retry instead of zero projects', async () => {
    await writeGraphV2(dataDir);
    const good = await readFile(join(dataDir, 'graph.json'), 'utf8');
    await writeFile(join(dataDir, 'graph.json'), '{ broken');
    const { root, rail } = await mountView();
    const text = collectText(root);
    expect(text).toContain('読み取れませんでした');
    expect(text).toContain('0件ではありません');
    expect(text).not.toContain('まだ登録がありません');
    expect(byClass(root, 'bb-ws-notice').some((node) => node.className === 'bb-ws-notice is-danger')).toBe(true);
    expect(byClass(root, 'bb-ws-ledger')).toEqual([]);
    await writeFile(join(dataDir, 'graph.json'), good);
    buttonsNamed(root, '再試行')[0].dispatch('click');
    await waitFor(() => collectText(root).includes('Atlas導入') && railHead(rail).includes('Atlas導入'));
  });

  it('never shows an unconfirmed or malformed list as zero projects', async () => {
    const source = { dataDir: '/data', graphFormat: 2, authority: 'local_graph' };
    for (const [payload, expected] of [
      [{ status: 'ok', source, projects: [], absenceConfirmed: false }, '記録の有無を確かめられません。0件ではありません。'],
      [{ status: 'ok', source, projects: [{ id: 'p' }], absenceConfirmed: true }, '応答の形式が不正です'],
      [{ status: 'broken' }, '応答の形式が不正です'],
    ]) {
      const root = new FakeElement('div');
      const view = createGraphProjectsView({ root, rail: new FakeElement('div'), document: new FakeDocument(), fetcher: async () => jsonResponse(200, payload), autoLoad: false });
      await view.load();
      const text = collectText(root);
      expect(text).toContain(expected);
      expect(text).not.toContain('まだ登録がありません');
      expect(byClass(root, 'bb-ws-summary')).toEqual([]);
    }
    expect(normalizeProjectList({ state: 'ok', payload: { projects: [], absenceConfirmed: true } })).toMatchObject({ state: 'ok' });
  });

  it('shows the 関係者 count as 未確認, not zero, when the host does not name the people', async () => {
    const project = {
      id: 'project-x', type: 'project', name: 'X', aliases: [], summary: null, tags: [], validFrom: null, validTo: null,
      active: true, digest: 'sha256:x', goal: 'g', status: '進行中', participantCount: 3, accountableCount: 1,
    };
    const root = new FakeElement('div');
    const view = createGraphProjectsView({
      root,
      rail: new FakeElement('div'),
      document: new FakeDocument(),
      fetcher: async (path) => (path.endsWith('/projects')
        ? jsonResponse(200, { status: 'ok', source: { dataDir: '/data' }, asOf: '2026-09-26T00:00:00Z', projects: [project], absenceConfirmed: false })
        : jsonResponse(500, { error: { code: 'boom', message: 'boom' } })),
      autoLoad: false,
    });
    await view.load();
    expect(metricValues(root)).toEqual(['1', '1', '未確認']);
    expect(collectText(ledgerRow(root, 'project-x'))).toBe('Xproject-xg1人進行中3人期限なし');
  });
});

describe('プロジェクトと関係者: corrections in the rail', () => {
  it('requires a one-sentence reason before sending anything', async () => {
    await writeGraphV2(dataDir);
    const { rail } = await mountView();
    buttonsNamed(participantItem(rail, '田中 太郎'), '役割を直す')[0].dispatch('click');
    type(rail, 'role', '技術顧問');
    await submit(rail);
    expect(collectText(rail)).toContain('理由を1文で書いてください。');
    expect(api.posts()).toEqual([]);
    expect(await history()).toEqual([]);
  });

  it('fixes a role with the digest of the shown relation and shows the read-back values and where they are used next', async () => {
    await writeGraphV2(dataDir);
    const { rail } = await mountView();
    buttonsNamed(participantItem(rail, '田中 太郎'), '役割を直す')[0].dispatch('click');
    // The form opens inside that 関係者's item.
    expect(section(participantItem(rail, '田中 太郎'), '役割を直す')).toBeDefined();
    expect(control(rail, 'role').value).toBe('責任者');
    type(rail, 'role', '技術顧問');
    type(rail, 'reason', '役割は技術顧問だった。');
    await submit(rail);

    const [post] = api.posts();
    expect(post.body).toEqual({
      kind: 'update_edge',
      edgeId: EDGES.tanakaAtlas.id,
      expectedDigest: graphRecordDigest(EDGES.tanakaAtlas),
      reason: '役割は技術顧問だった。',
      changes: { role: '技術顧問' },
    });
    expect(post.headers['X-Brainbase-Review-Token']).toBe(TOKEN);

    const text = collectText(section(rail, '役割を直す'));
    expect(text).toContain('保存後に読み直し、保存した内容と一致することを確かめました');
    expect(text).toContain('読み直した内容役割技術顧問');
    expect(text).toContain('次にMCPの search・get_context・resolve_entity を使うときから、この内容が使われます。');
    await waitFor(() => visibleText(participantItem(rail, '田中 太郎')).includes('役割技術顧問'));
    const [line] = await history();
    expect(line).toMatchObject({ kind: 'update_edge', reason: '役割は技術顧問だった。', changedFields: ['role'] });
  });

  it('keeps the draft on a conflict, shows the current values, and saves only the owner\'s change on top of them', async () => {
    await writeGraphV2(dataDir);
    const { rail } = await mountView();
    buttonsNamed(participantItem(rail, '田中 太郎'), '役割を直す')[0].dispatch('click');
    type(rail, 'role', '顧問');
    type(rail, 'reason', '役割を顧問に直す。');
    // Another save changes the same relation after it was shown.
    const other = await applyGraphCorrection(dataDir, {
      kind: 'update_edge', edgeId: EDGES.tanakaAtlas.id, expectedDigest: graphRecordDigest(EDGES.tanakaAtlas), reason: '文脈を狭めた。', changes: { context: '導入判断だけを担当' },
    }, { now: FIXTURE_NOW });
    await submit(rail);

    const text = collectText(section(rail, '役割を直す'));
    expect(text).toContain('ほかの保存で内容が変わっていたため、保存しませんでした');
    expect(text).toContain('今の内容');
    expect(text).toContain('導入判断だけを担当');
    expect(control(rail, 'role').value).toBe('顧問');
    expect(control(rail, 'reason').value).toBe('役割を顧問に直す。');
    // The field the owner did not touch now shows the current value.
    expect(control(rail, 'context').value).toBe('導入判断だけを担当');
    expect(buttonsNamed(rail, '今の内容に対して保存する')).toHaveLength(1);
    expect((await storedEdge(EDGES.tanakaAtlas.id)).role).toBe('責任者');

    await submit(rail);
    const posts = api.posts();
    expect(posts).toHaveLength(2);
    expect(posts[1].body.expectedDigest).toBe(other.digest);
    expect(posts[1].body.changes).toEqual({ role: '顧問' });
    expect(collectText(section(rail, '役割を直す'))).toContain('読み直した内容');
    expect(await storedEdge(EDGES.tanakaAtlas.id)).toMatchObject({ role: '顧問', context: '導入判断だけを担当' });
  });

  it('adds a 関係者 chosen from the registered people, with role and start date, and counts them in the ledger', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    buttonsNamed(rail, '関係者を加える')[0].dispatch('click');
    await waitFor(() => control(rail, 'counterpartId'));
    const options = findAll(control(rail, 'counterpartId'), (node) => node.tagName === 'OPTION').map((node) => node.textContent);
    expect(options).toEqual(['人物を選んでください', 'Owner', '佐藤 花子', '田中 太郎（Tanaka）', '鈴木 一郎（終了）']);
    expect(api.requests.some((request) => request.path === '/api/graph/search?type=person&limit=100')).toBe(true);
    type(rail, 'relation', 'accountable_for');
    type(rail, 'counterpartId', 'self');
    type(rail, 'role', '承認');
    type(rail, 'validFrom', '2026-10-01');
    type(rail, 'reason', '10月から承認を担当する。');
    await submit(rail);

    const [post] = api.posts();
    expect(post.body).toMatchObject({ kind: 'create_edge', reason: '10月から承認を担当する。', edge: { fromId: 'self', relation: 'accountable_for', toId: 'project-atlas', role: '承認' } });
    expect(post.body.edge.validFrom).toMatch(/^2026-10-01T00:00:00(?:Z|[+-]\d{2}:\d{2})$/u);
    const panel = collectText(section(rail, '関係者を加える'));
    expect(panel).toContain('関わり方責任');
    expect(panel).toContain('相手Owner');
    expect(panel).toContain('次にMCPの search・get_context・resolve_entity');
    await waitFor(() => participantItem(rail, 'Owner'));
    const item = visibleText(participantItem(rail, 'Owner'));
    expect(item).toContain('2026-10-01 から');
    expect(item).toContain('開始前');
    expect(item).toContain('利用者が承認');
    expect(item).toContain('訂正 2026-09-26「10月から承認を担当する。」');
    // It starts later, so the ledger and the metrics do not count it yet, and the list was read again.
    expect(api.requests.filter((request) => request.path === '/api/graph/projects')).toHaveLength(2);
    expect(collectText(ledgerRow(root, 'project-atlas'))).toContain('佐藤 花子進行中2人');
  });

  it('refuses to add an existing participation again and shows the current one', async () => {
    await writeGraphV2(dataDir);
    const { rail } = await mountView();
    buttonsNamed(rail, '関係者を加える')[0].dispatch('click');
    await waitFor(() => control(rail, 'counterpartId'));
    type(rail, 'counterpartId', 'person-tanaka');
    type(rail, 'reason', '参加を登録する。');
    await submit(rail);
    const text = collectText(section(rail, '関係者を加える'));
    expect(text).toContain('この関わりはすでに登録されているため、加えませんでした');
    expect(text).toContain('責任者');
    expect(control(rail, 'reason').value).toBe('参加を登録する。');
    expect(await history()).toEqual([]);
  });

  it('ends a participation with an end date (today by default) instead of deleting it, and the ledger stops counting it', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    buttonsNamed(participantItem(rail, '田中 太郎'), '関わりを終える')[0].dispatch('click');
    expect(control(rail, 'validTo').value).toBe('2026-09-20');
    type(rail, 'reason', '導入が終わったため。');
    await submit(rail);
    const [post] = api.posts();
    expect(post.body).toMatchObject({ kind: 'update_edge', edgeId: EDGES.tanakaAtlas.id, expectedDigest: graphRecordDigest(EDGES.tanakaAtlas) });
    expect(Object.keys(post.body.changes)).toEqual(['validTo']);
    expect(post.body.changes.validTo).toMatch(/^2026-09-20T00:00:00(?:Z|[+-]\d{2}:\d{2})$/u);
    await waitFor(() => visibleText(participantItem(rail, '田中 太郎')).includes('2026-09-20 に終了'));
    const item = participantItem(rail, '田中 太郎');
    expect(item.className).toContain('is-ended');
    expect(visibleText(item)).toContain('終了');
    expect(buttonsNamed(item, '終了日を直す')).toHaveLength(1);
    expect(await storedEdge(EDGES.tanakaAtlas.id)).toBeDefined();
    await waitFor(() => collectText(ledgerRow(root, 'project-atlas')).includes('1人'));
    expect(metricValues(root)).toEqual(['1', '1', '1']);
  });

  it('fixes the project goal and status, sending only the changed fields, and the ledger shows the new values', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    buttonsNamed(rail, 'プロジェクトを直す')[0].dispatch('click');
    expect(control(rail, 'name').value).toBe('Atlas導入');
    expect(control(rail, 'goal').value).toBe('導入を完了する');
    expect(control(rail, 'aliases')).toBeUndefined();
    type(rail, 'goal', '本番で使える状態にする');
    type(rail, 'status', '保留');
    type(rail, 'reason', '優先度が下がったため。');
    await submit(rail);
    const [post] = api.posts();
    expect(post.body).toEqual({
      kind: 'update_entity',
      entityId: 'project-atlas',
      expectedDigest: graphRecordDigest(ENTITIES.atlas),
      reason: '優先度が下がったため。',
      changes: { goal: '本番で使える状態にする', status: '保留' },
    });
    const panel = collectText(section(rail, 'プロジェクトを直す'));
    expect(panel).toContain('目的本番で使える状態にする');
    expect(panel).toContain('状態保留');
    await waitFor(() => collectText(ledgerRow(root, 'project-atlas')).includes('本番で使える状態にする'));
    expect(collectText(ledgerRow(root, 'project-atlas'))).toContain('保留');
    // No longer 進行中.
    expect(metricValues(root)).toEqual(['1', '0', '2']);
    expect(ledgerRow(root, 'project-atlas').className).toContain('is-selected');
  });

  it('says there is nothing to save when nothing changed', async () => {
    await writeGraphV2(dataDir);
    const { rail } = await mountView();
    buttonsNamed(rail, 'プロジェクトを直す')[0].dispatch('click');
    type(rail, 'reason', '確認のため。');
    await submit(rail);
    expect(collectText(rail)).toContain('変更がありません');
    expect(api.posts()).toEqual([]);
  });

  it('closes an open correction when another project is selected', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView();
    buttonsNamed(rail, 'プロジェクトを直す')[0].dispatch('click');
    expect(section(rail, 'プロジェクトを直す')).toBeDefined();
    ledgerRow(root, 'project-beta').dispatch('click');
    await waitFor(() => railHead(rail).includes('Beta検証') && section(rail, '概要'));
    expect(view.correction.form).toBeNull();
    expect(section(rail, 'プロジェクトを直す')).toBeUndefined();
  });
});

describe('プロジェクトと関係者: write errors', () => {
  it('explains a refused write without losing the draft', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    const rail = new FakeElement('div');
    // No launch token: the host refuses the write.
    const view = createGraphProjectsView({ root, rail, document: new FakeDocument(), fetcher: api.fetcher, autoLoad: false, now: OWNER_NOW });
    await view.load();
    buttonsNamed(participantItem(rail, '田中 太郎'), '役割を直す')[0].dispatch('click');
    type(rail, 'role', '技術顧問');
    type(rail, 'reason', '役割を直す。');
    await submit(rail);
    expect(collectText(rail)).toContain('起動時のトークンを確かめられません。ページを開き直してください。');
    expect(control(rail, 'role').value).toBe('技術顧問');
    expect(await history()).toEqual([]);
  });
});

describe('プロジェクトと関係者: host extensions', () => {
  const CORRECTION_BUTTONS = ['関係者を加える', 'プロジェクトを直す', '役割を直す', '関わりを終える', '終了日を直す'];
  const correctionButtons = (node) => findAll(node, (item) => item.tagName === 'BUTTON' && CORRECTION_BUTTONS.includes(item.textContent));
  const railBlocks = (rail) => findAll(rail, (node) => node.tagName === 'SECTION' || String(node.className).split(' ').includes('bb-ws-notice') || node.tagName === 'DETAILS')
    .filter((node) => node.parentNode?.className === 'bb-graph-rail bb-gp-rail')
    .map((node) => node.attributes['aria-label'] ?? (node.tagName === 'DETAILS' ? 'history' : collectText(node)));

  it('says the screen only checks when the host cannot correct, and uses the host guidance when no project is registered', async () => {
    await writeGraphV2(dataDir, { entities: [ENTITIES.self], edges: [] });
    const { root } = await mountView({
      canCorrect: false,
      emptyNotice: { label: '未登録', text: 'このプロジェクトはまだ組織のGraphにありません。管理者に登録を頼んでください。' },
      extraMetrics: () => [{ label: '未完了', value: 3 }, { label: '確認待ち', value: 1 }],
    });
    const text = collectText(root);
    expect(text).toContain('どのプロジェクトに誰がどう関わっているかを確かめます。');
    expect(text).not.toContain('誤りを直します');
    expect(text).toContain('このプロジェクトはまだ組織のGraphにありません。');
    expect(text).not.toContain('brainbase onboard');
    // Five metrics stay in one row.
    expect(byClass(root, 'bb-ws-summary')[0].className).toContain('is-5');
  });

  it('draws no correction control and never posts when the host cannot correct', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView({ canCorrect: false });
    expect(correctionButtons(rail)).toEqual([]);
    expect(visibleText(section(rail, 'そのほかの関係'))).not.toContain('直すときは');
    // Without a note the rail says nothing about corrections.
    expect(byClass(rail, 'bb-ws-notice')).toEqual([]);
    // The ended participation of the second project offers no 終了日を直す either.
    ledgerRow(root, 'project-beta').dispatch('click');
    await waitFor(() => railHead(rail).includes('Beta検証') && section(rail, '関係者'));
    expect(correctionButtons(rail)).toEqual([]);
    expect(correctionButtons(root)).toEqual([]);

    // Even a correction opened by code is refused before anything is sent.
    const project = view.state.detail.payload.project;
    view.correction.openEntity(project, { fields: ['status'] });
    view.correction.callbacks.onInput('status', '進行中');
    view.correction.callbacks.onReason('状態を戻す。');
    const form = await view.correction.submit();
    expect(form.phase).toBe('error');
    expect(form.message.text).toBe('このホストでは保存できません。');
    // The refused form is not drawn in the rail either.
    expect(section(rail, '記録を直す')).toBeUndefined();
    expect(api.posts()).toEqual([]);
    expect(await history()).toEqual([]);
  });

  it('shows the host note where the correction buttons would be, only when the host passes one', async () => {
    await writeGraphV2(dataDir);
    const { rail } = await mountView({ canCorrect: false, readOnlyNote: 'この画面からは直せません。' });
    const notes = byClass(rail, 'bb-ws-notice');
    expect(notes.map((node) => collectText(node))).toEqual(['この画面からは直せません。']);
    const order = railBlocks(rail);
    expect(order.indexOf('この画面からは直せません。')).toBe(order.indexOf('関係者') + 1);
    // With corrections allowed the note is not shown.
    await api.close();
    const writable = await mountView({ readOnlyNote: 'この画面からは直せません。' });
    expect(collectText(writable.rail)).not.toContain('この画面からは直せません。');
    expect(buttonsNamed(writable.rail, '関係者を加える')).toHaveLength(1);
  });

  it('replaces the 出典 notice with the host notice and drops the rail row that names this Mac', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView({ sourceNotice: { label: '読み取り元', text: '別のGraphを表示だけしています。' } });
    const [first] = byClass(root, 'bb-ws-notice');
    expect(first.children[0].textContent).toBe('読み取り元');
    expect(collectText(first)).toBe('読み取り元別のGraphを表示だけしています。');
    expect(collectText(root)).not.toContain('このMacのGraph');
    expect(visibleText(section(rail, '概要'))).not.toContain('このMacのGraph');
    expect(visibleText(section(rail, '概要'))).toContain('目的導入を完了する');
  });

  it('adds the host buttons to the page head and calls them on click', async () => {
    await writeGraphV2(dataDir);
    const clicks = [];
    const { root } = await mountView({
      pageActions: [
        { text: '＋追加', variant: 'primary', onClick: () => clicks.push('add') },
        { text: '書き出す', disabled: true, onClick: () => clicks.push('export') },
        { variant: 'primary' },
      ],
    });
    const head = byClass(root, 'bb-ws-page-head')[0];
    const buttons = findAll(head, (node) => node.tagName === 'BUTTON');
    expect(buttons.map((button) => [button.textContent, button.className, button.attributes.disabled ?? null])).toEqual([
      ['＋追加', 'bb-ws-button is-primary', null],
      ['書き出す', 'bb-ws-button', ''],
    ]);
    buttons[0].dispatch('click');
    expect(clicks).toEqual(['add']);
    // Without host buttons the page head has none.
    await api.close();
    const plain = await mountView();
    expect(findAll(byClass(plain.root, 'bb-ws-page-head')[0], (node) => node.tagName === 'BUTTON')).toEqual([]);
  });

  it('appends the host metrics after the built-in ones, with a null value as 未確認, and reports a failing one', async () => {
    await writeGraphV2(dataDir);
    const seen = [];
    const { root } = await mountView({
      extraMetrics: (payload) => {
        seen.push(payload.projects.map((project) => project.id));
        return [{ label: '仕事', value: 7, note: '開いているもの' }, { label: '基盤', value: null }];
      },
    });
    expect(metricValues(root)).toEqual(['1', '1', '2', '7', '未確認']);
    expect(collectText(byClass(root, 'bb-ws-summary')[0])).toContain('仕事7開いているもの');
    expect(seen.at(-1)).toEqual(['project-atlas', 'project-beta']);
    expect(byClass(root, 'bb-ws-notice').some((node) => node.className.includes('is-danger'))).toBe(false);

    await api.close();
    const failing = await mountView({ extraMetrics: () => { throw new Error('集計できません'); } });
    expect(metricValues(failing.root)).toEqual(['1', '1', '2']);
    const notice = byClass(failing.root, 'bb-ws-notice').find((node) => node.className.includes('is-danger'));
    expect(collectText(notice)).toContain('ホストが加えた集計を表示できませんでした（集計できません）。');
    expect(ledgerRows(failing.root)).toHaveLength(2);
  });

  it('draws the host rail blocks after 関係者 for the selected project, again on every selection', async () => {
    await writeGraphV2(dataDir);
    const calls = [];
    const { root, rail } = await mountView({
      renderRailExtensions: (projectId, detail, { document }) => {
        calls.push([projectId, detail ? detail.project.id : null]);
        const block = document.createElement('section');
        block.setAttribute('aria-label', '追加の欄');
        block.textContent = `追加: ${projectId}`;
        return [block, null];
      },
    });
    expect(collectText(section(rail, '追加の欄'))).toBe('追加: project-atlas');
    // After 関係者 and its buttons, before そのほかの関係 (and the history, when there is one).
    expect(railBlocks(rail)).toEqual(['概要', '関係者', '追加の欄', 'そのほかの関係']);
    // Called with the loaded detail of the selected project (and with null while it was read).
    expect(calls.filter(([, detail]) => detail !== null)).toEqual([['project-atlas', 'project-atlas']]);
    expect(calls.every(([id]) => id === 'project-atlas')).toBe(true);

    ledgerRow(root, 'project-beta').dispatch('click');
    await waitFor(() => collectText(section(rail, '追加の欄') ?? new FakeElement('div')) === '追加: project-beta' && section(rail, '関係者'));
    expect(calls.at(-1)).toEqual(['project-beta', 'project-beta']);
    expect(calls.filter(([id]) => id === 'project-beta').some(([, detail]) => detail === null)).toBe(true);
  });

  it('keeps the host rail blocks before the corrections history, also when the host cannot correct', async () => {
    await writeGraphV2(dataDir);
    await applyGraphCorrection(dataDir, {
      kind: 'update_entity', entityId: 'project-atlas', expectedDigest: graphRecordDigest(ENTITIES.atlas), reason: '状態を最新にした。', changes: { status: '保留' },
    }, { now: FIXTURE_NOW });
    const block = (document) => {
      const element = document.createElement('section');
      element.setAttribute('aria-label', '追加の欄');
      return element;
    };
    const writable = await mountView({ renderRailExtensions: (_id, _detail, { document }) => block(document) });
    expect(railBlocks(writable.rail)).toEqual(['概要', '関係者', '追加の欄', 'そのほかの関係', 'history']);
    await api.close();
    const readOnly = await mountView({ canCorrect: false, readOnlyNote: '表示だけです。', renderRailExtensions: (_id, _detail, { document }) => block(document) });
    expect(railBlocks(readOnly.rail)).toEqual(['概要', '関係者', '表示だけです。', '追加の欄', 'そのほかの関係', 'history']);
  });

  it('shows a failing host rail block as a small notice and keeps the rail', async () => {
    await writeGraphV2(dataDir);
    const { rail } = await mountView({ renderRailExtensions: () => { throw new Error('欄が壊れています'); } });
    const notice = byClass(rail, 'bb-ws-notice').find((node) => node.className.includes('is-danger'));
    expect(collectText(notice)).toBe('表示できませんホストが加えた欄を表示できませんでした（欄が壊れています）。');
    expect(section(rail, '概要')).toBeDefined();
    expect(participantItem(rail, '田中 太郎')).toBeDefined();
    await api.close();
    const malformed = await mountView({ renderRailExtensions: () => '文字だけ' });
    expect(collectText(malformed.rail)).toContain('ホストが加えた欄を表示できませんでした（欄の形式が正しくありません）。');
    expect(collectText(malformed.rail)).not.toContain('文字だけ');
  });

  it('starts at the project the host asks for, tells the host about its own selections, and follows select()', async () => {
    await writeGraphV2(dataDir);
    const selected = [];
    const { root, rail, view } = await mountView({ selectedId: 'project-beta', onSelect: (id) => selected.push(id) });
    expect(railHead(rail)).toBe('プロジェクトBeta検証project-beta');
    expect(ledgerRow(root, 'project-beta').className).toContain('is-selected');
    expect(api.requests.map((request) => request.path)).toEqual(['/api/graph/projects', '/api/graph/projects/project-beta']);
    expect(selected).toEqual([]);

    ledgerRow(root, 'project-atlas').dispatch('click');
    expect(selected).toEqual(['project-atlas']);
    await waitFor(() => railHead(rail).includes('Atlas導入') && section(rail, '関係者'));

    await view.select('project-beta');
    expect(railHead(rail)).toBe('プロジェクトBeta検証project-beta');
    expect(ledgerRow(root, 'project-beta').className).toContain('is-selected');
    expect(selected).toEqual(['project-atlas']);
    // Selecting the project already selected reads nothing and keeps an open correction.
    buttonsNamed(rail, 'プロジェクトを直す')[0].dispatch('click');
    const before = api.requests.length;
    await view.select('project-beta');
    expect(api.requests).toHaveLength(before);
    expect(section(rail, 'プロジェクトを直す')).toBeDefined();
  });

  it('selects the first project when the host asks for one that is not listed, and says so', async () => {
    await writeGraphV2(dataDir);
    const selected = [];
    const { rail } = await mountView({ selectedId: 'project-gone', onSelect: (id) => selected.push(id) });
    expect(railHead(rail)).toBe('プロジェクトAtlas導入project-atlas');
    expect(selected).toEqual(['project-atlas']);
    expect(api.requests.map((request) => request.path)).toEqual(['/api/graph/projects', '/api/graph/projects/project-atlas']);
  });
});
