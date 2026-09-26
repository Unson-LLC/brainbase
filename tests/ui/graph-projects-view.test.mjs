import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGraphCorrection, graphRecordDigest } from '../../src/graph-corrections.js';
import { createGraphProjectsView, normalizeProjectList } from '../../ui/graph-projects-view.js';
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

async function mountView(options = {}) {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const view = createGraphProjectsView({ root, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, now: OWNER_NOW, ...options });
  await view.load();
  return { root, view };
}

async function openAtlas() {
  const mounted = await mountView();
  await mounted.view.openProject('project-atlas');
  return mounted;
}

function participantRow(root, name) {
  return findAll(section(root, '関係者'), (node) => node.tagName === 'TR' && collectText(node).includes(name))[0];
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

describe('プロジェクトと関係者: list and detail', () => {
  it('lists each project with its status, goal, 関係者 count and validity', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    const header = findAll(root, (node) => node.className === 'bb-graph-header')[0];
    expect(header.children[0].className).toBe('bb-graph-eyebrow');
    expect(header.children[0].textContent).toBe('BRAINBASE / PROJECTS');
    const list = section(root, 'プロジェクトの一覧');
    const items = findAll(list, (node) => node.tagName === 'LI');
    expect(items).toHaveLength(2);
    const atlas = collectText(items[0]);
    expect(atlas).toContain('Atlas導入');
    expect(atlas).toContain('進行中');
    expect(atlas).toContain('導入を完了する');
    expect(atlas).toContain('2人（うち責任を持つ人 1人）');
    expect(atlas).toContain('期限なし');
    expect(atlas).toContain('有効');
    const beta = collectText(items[1]);
    expect(beta).toContain('Beta検証');
    expect(beta).toContain('完了');
    expect(beta).toContain('目的未記入');
    // The ended participation is not counted as a current 関係者.
    expect(beta).toContain('0人（うち責任を持つ人 0人）');
    expect(beta).toContain('2026-03-01 に終了');
    expect(beta).toContain('終了');
  });

  it('shows the goal, principles and every participation with how, role, validity and source in plain Japanese', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    const summary = collectText(section(root, 'プロジェクトの詳細'));
    expect(summary).toContain('導入を完了する');
    expect(summary).toContain('進行中');
    expect(summary).toContain('小さく始める');

    const sato = participantRow(root, '佐藤 花子');
    const satoText = visibleText(sato);
    expect(satoText).toContain('責任');
    expect(satoText).toContain('PM');
    expect(satoText).toContain('2026-01-01 から');
    expect(satoText).toContain('取り込み');
    expect(satoText).toContain('取り込み候補「佐藤 花子」（candidates/extracted-abc.json）');

    const tanaka = participantRow(root, '田中 太郎');
    const tanakaText = visibleText(tanaka);
    expect(tanakaText).toContain('参加');
    expect(tanakaText).toContain('責任者');
    expect(tanakaText).toContain('最終判断を担当');
    expect(tanakaText).toContain('オンボーディング');
    // A source id that points to no local record is shown raw and marked.
    expect(tanakaText).toContain('出典 relationship-reg1（未解決）');

    // Accountable first, then participants; ended participations stay listed.
    const rows = findAll(section(root, '関係者'), (node) => node.tagName === 'TR').slice(1);
    expect(rows.map((row) => row.children[0].children[0].textContent)).toEqual(['佐藤 花子', '田中 太郎']);
    expect(collectText(section(root, 'そのほかの関係'))).toContain('スコープが進め方を決める');

    const visible = visibleText(root);
    for (const internal of ['edge-', 'sha256:', 'digest', 'Canonical', 'RACI', '権限', 'メンバー', 'アクセス']) {
      expect(visible, internal).not.toContain(internal);
    }
    // Ids and digests stay available inside the details disclosure.
    expect(collectText(tanaka)).toContain(EDGES.tanakaAtlas.id);
    // Nothing is ever deleted here.
    expect(findAll(root, (node) => node.tagName === 'BUTTON' && /削除/u.test(node.textContent))).toEqual([]);
  });

  it('reads the history of corrections beside the project and counts unreadable history lines apart', async () => {
    await writeGraphV2(dataDir);
    await applyGraphCorrection(dataDir, {
      kind: 'update_entity', entityId: 'project-atlas', expectedDigest: graphRecordDigest(ENTITIES.atlas), reason: '状態を最新にした。', changes: { status: '保留' },
    }, { now: FIXTURE_NOW });
    await writeFile(join(dataDir, 'evidence', 'graph-corrections.jsonl'), `${await readFile(join(dataDir, 'evidence', 'graph-corrections.jsonl'), 'utf8')}{ broken\n`);
    const { root } = await openAtlas();
    const text = collectText(root);
    expect(text).toContain('読めない記録が1件あります');
    expect(text).toContain('evidence/graph-corrections.jsonl（2行目）');
    expect(text).toContain('訂正の履歴（1件）');
    expect(text).toContain('記録を直した（状態）。理由: 状態を最新にした。');
    expect(collectText(section(root, 'プロジェクトの詳細'))).toContain('保留');
  });
});

describe('プロジェクトと関係者: states', () => {
  it('shows Graph v1 as a migration with both commands, never as zero projects', async () => {
    await writeGraphV1(dataDir);
    const { root } = await mountView();
    const text = collectText(root);
    expect(text).toContain('Graphの移行が必要です');
    expect(text).toContain('0件ではありません');
    expect(text).toContain(`brainbase ontology:migrate --dir ${dataDir}`);
    expect(text).toContain('--write --expected-input-digest');
    expect(text).toContain('Graph v1には2件の記録があります');
    expect(text).not.toContain('まだ登録がありません');
  });

  it('shows how to start when no Brainbase data exists, and when the Graph confirms no project', async () => {
    const empty = await mountView();
    expect(collectText(empty.root)).toContain('まだ登録がありません');
    expect(collectText(empty.root)).toContain(`brainbase onboard:start --dir ${dataDir}`);
    await api.close();

    await writeGraphV2(dataDir, { entities: [ENTITIES.self], edges: [] });
    const { root } = await mountView();
    const text = collectText(root);
    expect(text).toContain('まだ登録がありません');
    expect(text).toContain('brainbase onboard:projects --name <名前> --goal <目的> --write');
  });

  it('reports a read failure with a retry instead of zero projects', async () => {
    await writeGraphV2(dataDir);
    const good = await readFile(join(dataDir, 'graph.json'), 'utf8');
    await writeFile(join(dataDir, 'graph.json'), '{ broken');
    const { root } = await mountView();
    const text = collectText(root);
    expect(text).toContain('読み取れませんでした');
    expect(text).toContain('0件ではありません');
    expect(text).not.toContain('まだ登録がありません');
    await writeFile(join(dataDir, 'graph.json'), good);
    buttonsNamed(root, '再試行')[0].dispatch('click');
    await waitFor(() => collectText(root).includes('Atlas導入'));
  });

  it('never shows an unconfirmed or malformed list as zero projects', async () => {
    const source = { dataDir: '/data', graphFormat: 2, authority: 'local_graph' };
    for (const [payload, expected] of [
      [{ status: 'ok', source, projects: [], absenceConfirmed: false }, '記録の有無を確かめられません。0件ではありません。'],
      [{ status: 'ok', source, projects: [{ id: 'p' }], absenceConfirmed: true }, '応答の形式が不正です'],
      [{ status: 'broken' }, '応答の形式が不正です'],
    ]) {
      const root = new FakeElement('div');
      const view = createGraphProjectsView({ root, document: new FakeDocument(), fetcher: async () => jsonResponse(200, payload), autoLoad: false });
      await view.load();
      const text = collectText(root);
      expect(text).toContain(expected);
      expect(text).not.toContain('まだ登録がありません');
    }
    expect(normalizeProjectList({ state: 'ok', payload: { projects: [], absenceConfirmed: true } })).toMatchObject({ state: 'ok' });
  });
});

describe('プロジェクトと関係者: corrections', () => {
  it('requires a one-sentence reason before sending anything', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    buttonsNamed(participantRow(root, '田中 太郎'), '役割を直す')[0].dispatch('click');
    type(root, 'role', '技術顧問');
    await submit(root);
    expect(collectText(root)).toContain('理由を1文で書いてください。');
    expect(api.posts()).toEqual([]);
    expect(await history()).toEqual([]);
  });

  it('fixes a role with the digest of the shown relation and shows the read-back values and where they are used next', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    buttonsNamed(participantRow(root, '田中 太郎'), '役割を直す')[0].dispatch('click');
    expect(control(root, 'role').value).toBe('責任者');
    type(root, 'role', '技術顧問');
    type(root, 'reason', '役割は技術顧問だった。');
    await submit(root);

    const [post] = api.posts();
    expect(post.body).toEqual({
      kind: 'update_edge',
      edgeId: EDGES.tanakaAtlas.id,
      expectedDigest: graphRecordDigest(EDGES.tanakaAtlas),
      reason: '役割は技術顧問だった。',
      changes: { role: '技術顧問' },
    });
    expect(post.headers['X-Brainbase-Review-Token']).toBe(TOKEN);

    const panel = section(root, '役割を直す');
    const text = collectText(panel);
    expect(text).toContain('保存後に読み直し、保存した内容と一致することを確かめました');
    expect(text).toContain('読み直した内容役割技術顧問');
    expect(text).toContain('次にMCPの search・get_context・resolve_entity を使うときから、この内容が使われます。');
    await waitFor(() => visibleText(participantRow(root, '田中 太郎')).includes('技術顧問'));
    const [line] = await history();
    expect(line).toMatchObject({ kind: 'update_edge', reason: '役割は技術顧問だった。', changedFields: ['role'] });
  });

  it('keeps the draft on a conflict, shows the current values, and saves only the owner\'s change on top of them', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    buttonsNamed(participantRow(root, '田中 太郎'), '役割を直す')[0].dispatch('click');
    type(root, 'role', '顧問');
    type(root, 'reason', '役割を顧問に直す。');
    // Another save changes the same relation after it was shown.
    const other = await applyGraphCorrection(dataDir, {
      kind: 'update_edge', edgeId: EDGES.tanakaAtlas.id, expectedDigest: graphRecordDigest(EDGES.tanakaAtlas), reason: '文脈を狭めた。', changes: { context: '導入判断だけを担当' },
    }, { now: FIXTURE_NOW });
    await submit(root);

    const panel = section(root, '役割を直す');
    const text = collectText(panel);
    expect(text).toContain('ほかの保存で内容が変わっていたため、保存しませんでした');
    expect(text).toContain('今の内容');
    expect(text).toContain('導入判断だけを担当');
    expect(control(root, 'role').value).toBe('顧問');
    expect(control(root, 'reason').value).toBe('役割を顧問に直す。');
    // The field the owner did not touch now shows the current value.
    expect(control(root, 'context').value).toBe('導入判断だけを担当');
    expect(buttonsNamed(root, '今の内容に対して保存する')).toHaveLength(1);
    expect((await storedEdge(EDGES.tanakaAtlas.id)).role).toBe('責任者');

    await submit(root);
    const posts = api.posts();
    expect(posts).toHaveLength(2);
    expect(posts[1].body.expectedDigest).toBe(other.digest);
    expect(posts[1].body.changes).toEqual({ role: '顧問' });
    expect(collectText(section(root, '役割を直す'))).toContain('読み直した内容');
    expect(await storedEdge(EDGES.tanakaAtlas.id)).toMatchObject({ role: '顧問', context: '導入判断だけを担当' });
  });

  it('adds a 関係者 chosen from the registered people, with role and start date', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    buttonsNamed(root, '関係者を加える')[0].dispatch('click');
    await waitFor(() => control(root, 'counterpartId'));
    const options = findAll(control(root, 'counterpartId'), (node) => node.tagName === 'OPTION').map((node) => node.textContent);
    expect(options).toEqual(['人物を選んでください', 'Owner', '佐藤 花子', '田中 太郎（Tanaka）', '鈴木 一郎（終了）']);
    expect(api.requests.some((request) => request.path === '/api/graph/search?type=person&limit=100')).toBe(true);
    type(root, 'relation', 'accountable_for');
    type(root, 'counterpartId', 'self');
    type(root, 'role', '承認');
    type(root, 'validFrom', '2026-10-01');
    type(root, 'reason', '10月から承認を担当する。');
    await submit(root);

    const [post] = api.posts();
    expect(post.body).toMatchObject({ kind: 'create_edge', reason: '10月から承認を担当する。', edge: { fromId: 'self', relation: 'accountable_for', toId: 'project-atlas', role: '承認' } });
    expect(post.body.edge.validFrom).toMatch(/^2026-10-01T00:00:00(?:Z|[+-]\d{2}:\d{2})$/u);
    const panel = collectText(section(root, '関係者を加える'));
    expect(panel).toContain('関わり方責任');
    expect(panel).toContain('相手Owner');
    expect(panel).toContain('次にMCPの search・get_context・resolve_entity');
    await waitFor(() => participantRow(root, 'Owner'));
    const row = visibleText(participantRow(root, 'Owner'));
    expect(row).toContain('2026-10-01 から');
    expect(row).toContain('開始前');
    expect(row).toContain('利用者が承認');
    expect(row).toContain('訂正 2026-09-26「10月から承認を担当する。」');
  });

  it('refuses to add an existing participation again and shows the current one', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    buttonsNamed(root, '関係者を加える')[0].dispatch('click');
    await waitFor(() => control(root, 'counterpartId'));
    type(root, 'counterpartId', 'person-tanaka');
    type(root, 'reason', '参加を登録する。');
    await submit(root);
    const text = collectText(section(root, '関係者を加える'));
    expect(text).toContain('この関わりはすでに登録されているため、加えませんでした');
    expect(text).toContain('責任者');
    expect(control(root, 'reason').value).toBe('参加を登録する。');
    expect(await history()).toEqual([]);
  });

  it('ends a participation with an end date (today by default) instead of deleting it', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    buttonsNamed(participantRow(root, '田中 太郎'), '関わりを終える')[0].dispatch('click');
    expect(control(root, 'validTo').value).toBe('2026-09-20');
    type(root, 'reason', '導入が終わったため。');
    await submit(root);
    const [post] = api.posts();
    expect(post.body).toMatchObject({ kind: 'update_edge', edgeId: EDGES.tanakaAtlas.id, expectedDigest: graphRecordDigest(EDGES.tanakaAtlas) });
    expect(Object.keys(post.body.changes)).toEqual(['validTo']);
    expect(post.body.changes.validTo).toMatch(/^2026-09-20T00:00:00(?:Z|[+-]\d{2}:\d{2})$/u);
    await waitFor(() => visibleText(participantRow(root, '田中 太郎')).includes('2026-09-20 に終了'));
    const row = participantRow(root, '田中 太郎');
    expect(visibleText(row)).toContain('終了');
    expect(buttonsNamed(row, '終了日を直す')).toHaveLength(1);
    expect(await storedEdge(EDGES.tanakaAtlas.id)).toBeDefined();
  });

  it('fixes the project goal and status, sending only the changed fields', async () => {
    await writeGraphV2(dataDir);
    const { root, view } = await openAtlas();
    buttonsNamed(root, 'プロジェクトを直す')[0].dispatch('click');
    expect(control(root, 'name').value).toBe('Atlas導入');
    expect(control(root, 'goal').value).toBe('導入を完了する');
    expect(control(root, 'aliases')).toBeUndefined();
    type(root, 'goal', '本番で使える状態にする');
    type(root, 'status', '保留');
    type(root, 'reason', '優先度が下がったため。');
    await submit(root);
    const [post] = api.posts();
    expect(post.body).toEqual({
      kind: 'update_entity',
      entityId: 'project-atlas',
      expectedDigest: graphRecordDigest(ENTITIES.atlas),
      reason: '優先度が下がったため。',
      changes: { goal: '本番で使える状態にする', status: '保留' },
    });
    const panel = collectText(section(root, 'プロジェクトを直す'));
    expect(panel).toContain('目的本番で使える状態にする');
    expect(panel).toContain('状態保留');
    await view.showList();
    expect(collectText(section(root, 'プロジェクトの一覧'))).toContain('本番で使える状態にする');
  });

  it('says there is nothing to save when nothing changed', async () => {
    await writeGraphV2(dataDir);
    const { root } = await openAtlas();
    buttonsNamed(root, 'プロジェクトを直す')[0].dispatch('click');
    type(root, 'reason', '確認のため。');
    await submit(root);
    expect(collectText(root)).toContain('変更がありません');
    expect(api.posts()).toEqual([]);
  });
});

describe('プロジェクトと関係者: write errors', () => {
  it('explains a refused write without losing the draft', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    // No launch token: the host refuses the write.
    const view = createGraphProjectsView({ root, document: new FakeDocument(), fetcher: api.fetcher, autoLoad: false, now: OWNER_NOW });
    await view.load();
    await view.openProject('project-atlas');
    buttonsNamed(participantRow(root, '田中 太郎'), '役割を直す')[0].dispatch('click');
    type(root, 'role', '技術顧問');
    type(root, 'reason', '役割を直す。');
    await submit(root);
    expect(collectText(root)).toContain('起動時のトークンを確かめられません。ページを開き直してください。');
    expect(control(root, 'role').value).toBe('技術顧問');
    expect(await history()).toEqual([]);
  });
});
