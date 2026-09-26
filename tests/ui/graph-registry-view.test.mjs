import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGraphCorrection, graphRecordDigest } from '../../src/graph-corrections.js';
import { createGraphRegistryView, normalizeSearch } from '../../ui/graph-registry-view.js';
import { dayToRfc3339 } from '../../ui/graph-view-shared.js';
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
  directory = await mkdtemp(join(tmpdir(), 'brainbase-graph-registry-ui-'));
  dataDir = join(directory, 'personal-os');
  api = null;
});

afterEach(async () => {
  await api?.close();
  await rm(directory, { recursive: true, force: true });
});

async function mountView() {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const view = createGraphRegistryView({ root, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, now: () => new Date(2026, 8, 20, 12) });
  await view.load();
  return { root, view };
}

function resultNames(root) {
  const results = section(root, '検索結果');
  return findAll(results, (node) => node.tagName === 'BUTTON' && node.className === 'bb-graph-link').map((node) => node.textContent);
}

function searchForm(root) {
  return findAll(root, (node) => node.tagName === 'FORM' && node.className.includes('bb-gr-search'))[0];
}

function relationItem(root, label, name) {
  return findAll(section(root, label), (node) => node.tagName === 'LI' && collectText(node).includes(name))[0];
}

describe('情報と関係: search', () => {
  it('lists every record when the query is empty and searches by name or alias, type and as-of date', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    expect(collectText(section(root, '検索結果'))).toContain('8件');
    expect(resultNames(root)).toHaveLength(8);

    type(root, 'q', 'tanaka');
    type(root, 'type', 'person');
    await searchForm(root).dispatch('submit');
    expect(resultNames(root)).toEqual(['田中 太郎']);
    const last = api.requests.at(-1).path;
    expect(last).toBe('/api/graph/search?q=tanaka&type=person&limit=50');

    type(root, 'q', '');
    type(root, 'type', '');
    type(root, 'as_of', '2026-09-26');
    await searchForm(root).dispatch('submit');
    const url = new URL(api.requests.at(-1).path, 'http://localhost');
    expect(url.searchParams.get('as_of')).toBe(dayToRfc3339('2026-09-26'));
    // Records that ended before that day are not listed.
    expect(resultNames(root)).not.toContain('鈴木 一郎');
    expect(resultNames(root)).not.toContain('Beta検証');
    expect(resultNames(root)).toContain('田中 太郎');
  });

  it('says no record matched only after the whole Graph was searched, apart from an empty Graph', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    type(root, 'q', 'zzz');
    await searchForm(root).dispatch('submit');
    const text = collectText(section(root, '検索結果'));
    expect(text).toContain('条件に合う記録はありません');
    expect(text).not.toContain('まだ登録がありません');
    await api.close();

    await writeGraphV2(dataDir, { entities: [], edges: [] });
    const empty = await mountView();
    const emptyText = collectText(section(empty.root, '検索結果'));
    expect(emptyText).toContain('まだ登録がありません');
    expect(emptyText).toContain(`brainbase onboard:start --dir ${dataDir}`);
  });

  it('shows Graph v1 as a migration in search and in the kinds of information, never as zero', async () => {
    await writeGraphV1(dataDir);
    const { root } = await mountView();
    for (const label of ['検索結果', '情報の種類とつながり方']) {
      const text = collectText(section(root, label));
      expect(text, label).toContain('Graphの移行が必要です');
      expect(text, label).toContain('brainbase ontology:migrate --dir');
      expect(text, label).toContain('--write --expected-input-digest');
      expect(text, label).not.toContain('条件に合う記録はありません');
      expect(text, label).not.toContain('0件（');
    }
  });

  it('reports a read failure with a retry and treats an unconfirmed empty result as unknown', async () => {
    await writeGraphV2(dataDir);
    const good = await readFile(join(dataDir, 'graph.json'), 'utf8');
    await writeFile(join(dataDir, 'graph.json'), '{ broken');
    const { root } = await mountView();
    expect(collectText(section(root, '検索結果'))).toContain('読み取れませんでした');
    expect(collectText(section(root, '情報の種類とつながり方'))).toContain('0件ではありません');
    await writeFile(join(dataDir, 'graph.json'), good);
    buttonsNamed(section(root, '検索結果'), '再試行')[0].dispatch('click');
    await waitFor(() => resultNames(root).length === 8);

    expect(normalizeSearch({ state: 'ok', payload: { results: [], absenceConfirmed: false } })).toEqual({ state: 'unknown' });
    const unknownRoot = new FakeElement('div');
    const view = createGraphRegistryView({
      root: unknownRoot,
      document: new FakeDocument(),
      fetcher: async () => jsonResponse(200, { status: 'ok', results: [], absenceConfirmed: false }),
      autoLoad: false,
    });
    await view.search();
    expect(collectText(section(unknownRoot, '検索結果'))).toContain('記録の有無を確かめられません。0件ではありません。');
  });
});

describe('情報と関係: record detail', () => {
  it('shows type, names, summary, validity and both directions of relations with meaning, role and source', async () => {
    await writeGraphV2(dataDir);
    const { root, view } = await mountView();
    await view.openEntity('person-tanaka');
    const summary = visibleText(section(root, '記録の詳細'));
    expect(summary).toContain('田中 太郎');
    expect(summary).toContain('種類人物');
    expect(summary).toContain('別名Tanaka');
    expect(summary).toContain('導入の最終判断を担当');
    expect(summary).toContain('期限なし');

    const member = visibleText(relationItem(root, '出る関係', 'Acme'));
    expect(member).toContain('Acmeに所属');
    expect(member).toContain('人物が組織に所属している');
    expect(member).toContain('相手の種類組織');
    expect(member).toContain('移行');
    expect(member).toContain('出典 person-tanaka（未解決）');
    const participation = visibleText(relationItem(root, '出る関係', 'Atlas導入'));
    expect(participation).toContain('Atlas導入に参加');
    expect(participation).toContain('役割責任者');
    expect(participation).toContain('文脈最終判断を担当');
    expect(participation).toContain('オンボーディング');
    expect(collectText(section(root, '入る関係'))).toContain('この記録へ入る関係はありません。');

    const visible = visibleText(root);
    for (const internal of ['edge-', 'sha256:', 'digest', 'Canonical', 'participates_in', 'member_of']) {
      expect(visible, internal).not.toContain(internal);
    }
    expect(collectText(relationItem(root, '出る関係', 'Acme'))).toContain(EDGES.tanakaAcme.id);
  });

  it('follows a relation to the other record, resolves local sources, and goes back', async () => {
    await writeGraphV2(dataDir);
    const { root, view } = await mountView();
    await view.openEntity('person-tanaka');
    buttonsNamed(relationItem(root, '出る関係', 'Atlas導入'), 'Atlas導入')[0].dispatch('click');
    await waitFor(() => visibleText(section(root, '記録の詳細')).includes('種類プロジェクト'));
    const incoming = collectText(section(root, '入る関係'));
    expect(incoming).toContain('佐藤 花子が責任を持つ');
    expect(incoming).toContain('田中 太郎が参加');
    expect(incoming).toContain('スコープが進め方を決める');
    expect(visibleText(relationItem(root, '入る関係', '佐藤 花子'))).toContain('取り込み候補「佐藤 花子」（candidates/extracted-abc.json）');
    expect(visibleText(section(root, '記録の詳細'))).toContain('目的導入を完了する');

    buttonsNamed(relationItem(root, '入る関係', '佐藤 花子'), '佐藤 花子')[0].dispatch('click');
    await waitFor(() => visibleText(section(root, '記録の詳細')).includes('進行管理'));
    expect(visibleText(relationItem(root, '出る関係', 'Beta検証'))).toContain('オンボーディングの候補「佐藤 花子」（実行 run-1、承認済み、runs/connected-onboarding.json）');

    buttonsNamed(root, '← 前の記録（Atlas導入）に戻る')[0].dispatch('click');
    await waitFor(() => visibleText(section(root, '記録の詳細')).includes('種類プロジェクト'));
    buttonsNamed(root, '← 前の記録（田中 太郎）に戻る')[0].dispatch('click');
    await waitFor(() => visibleText(section(root, '記録の詳細')).includes('田中 太郎'));
    buttonsNamed(root, '← 検索結果に戻る')[0].dispatch('click');
    await waitFor(() => resultNames(root).length === 8);
  });

  it('reports a record that does not exist without showing it as empty', async () => {
    await writeGraphV2(dataDir);
    const { root, view } = await mountView();
    await view.openEntity('person-nobody');
    expect(collectText(root)).toContain('この記録は見つかりません');
  });
});

describe('情報と関係: corrections', () => {
  it('corrects aliases with the shown digest, and the next search finds the record by the new alias', async () => {
    await writeGraphV2(dataDir);
    const { root, view } = await mountView();
    await view.openEntity('person-tanaka');
    buttonsNamed(root, 'この記録を直す')[0].dispatch('click');
    expect(control(root, 'aliases').value).toBe('Tanaka');
    expect(control(root, 'goal')).toBeUndefined();
    type(root, 'aliases', 'Tanaka、タナカ');
    type(root, 'reason', '読みを別名に加える。');
    await submit(root);
    const [post] = api.posts();
    expect(post.body).toEqual({
      kind: 'update_entity',
      entityId: 'person-tanaka',
      expectedDigest: graphRecordDigest(ENTITIES.tanaka),
      reason: '読みを別名に加える。',
      changes: { aliases: ['Tanaka', 'タナカ'] },
    });
    const panel = collectText(section(root, 'この記録を直す'));
    expect(panel).toContain('別名Tanaka、タナカ');
    expect(panel).toContain('次にMCPの search・get_context・resolve_entity を使うときから、この内容が使われます。');

    type(root, 'q', 'タナカ');
    await searchForm(root).dispatch('submit');
    expect(resultNames(root)).toEqual(['田中 太郎']);
  });

  it('ends a relation with an end date and keeps the draft with the current values on a conflict', async () => {
    await writeGraphV2(dataDir);
    const { root, view } = await mountView();
    await view.openEntity('person-tanaka');
    buttonsNamed(relationItem(root, '出る関係', 'Acme'), 'この関係を直す')[0].dispatch('click');
    type(root, 'validTo', '2026-09-01');
    type(root, 'reason', '9月に退職した。');
    await applyGraphCorrection(dataDir, {
      kind: 'update_edge', edgeId: EDGES.tanakaAcme.id, expectedDigest: graphRecordDigest(EDGES.tanakaAcme), reason: '役割を記録する。', changes: { role: '顧問' },
    }, { now: FIXTURE_NOW });
    await submit(root);
    const conflict = collectText(section(root, '関係を直す'));
    expect(conflict).toContain('ほかの保存で内容が変わっていた');
    expect(conflict).toContain('役割顧問');
    expect(control(root, 'validTo').value).toBe('2026-09-01');

    await submit(root);
    const posts = api.posts();
    expect(posts[0].body.expectedDigest).toBe(graphRecordDigest(EDGES.tanakaAcme));
    expect(posts[1].body.changes).toEqual({ validTo: dayToRfc3339('2026-09-01') });
    expect(collectText(section(root, '関係を直す'))).toContain('終了日2026-09-01');
    await waitFor(() => visibleText(relationItem(root, '出る関係', 'Acme')).includes('2026-09-01 に終了'));
  });

  it('adds a relation from a person, looking up the other side by the kind the relation needs', async () => {
    await writeGraphV2(dataDir);
    const { root, view } = await mountView();
    await view.openEntity('person-sato');
    buttonsNamed(root, '関係を加える')[0].dispatch('click');
    await waitFor(() => control(root, 'counterpartId'));
    const relations = findAll(control(root, 'relation'), (node) => node.tagName === 'OPTION').map((node) => node.attributes.value);
    expect(relations).toEqual(['participates_in', 'accountable_for', 'member_of']);
    type(root, 'relation', 'member_of');
    await waitFor(() => api.requests.some((request) => request.path === '/api/graph/search?type=org&limit=100')
      && findAll(control(root, 'counterpartId'), (node) => node.tagName === 'OPTION').some((node) => node.textContent === 'Acme'));
    type(root, 'counterpartId', 'org-acme');
    type(root, 'reason', 'Acmeに所属している。');
    await submit(root);
    expect(api.posts()[0].body).toEqual({
      kind: 'create_edge',
      reason: 'Acmeに所属している。',
      edge: { fromId: 'person-sato', relation: 'member_of', toId: 'org-acme' },
    });
    await waitFor(() => relationItem(root, '出る関係', 'Acme'));
    expect(visibleText(relationItem(root, '出る関係', 'Acme'))).toContain('利用者が承認');
    // A decision cannot gain a relation through a correction.
    await view.openEntity('decision-scope');
    expect(buttonsNamed(root, '関係を加える')).toEqual([]);
  });
});

describe('情報と関係: kinds of information', () => {
  it('lists relation kinds with their start and end kinds, meaning and counts, read-only', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    const panel = section(root, '情報の種類とつながり方');
    const text = collectText(panel);
    expect(text).toContain('人物Graphに登録された人4件');
    expect(text).toContain('プロジェクト目的を持つ、区切りのある仕事2件');
    expect(text).toContain('参加人物 → プロジェクト人物がプロジェクトに参加している2件（うち有効 1件）');
    expect(text).toContain('責任人物 → プロジェクト人物がプロジェクトの成果や判断に責任を持つ1件（うち有効 1件）');
    expect(text).toContain('所有プロジェクト → 組織');
    expect(text).toContain('新しく加えられる関係: 参加・責任・所属');
    expect(text).toContain('（最新）');
    // Read-only: no change proposal and no button in this panel.
    expect(findAll(panel, (node) => node.tagName === 'BUTTON' || node.tagName === 'FORM')).toEqual([]);
    expect(text).not.toContain('提案');
    // The organization Graph (not connected here) gets no column or placeholder.
    expect(collectText(root)).not.toContain('組織のGraph');
  });
});
