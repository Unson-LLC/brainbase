import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGraphCorrection, graphRecordDigest } from '../../src/graph-corrections.js';
import {
  createGraphRegistryView,
  GRAPH_ENTITY_LEDGER_COLUMNS,
  GRAPH_ENTITY_TYPE_LEDGER_COLUMNS,
  GRAPH_RELATION_TYPE_LEDGER_COLUMNS,
  normalizeSearch,
} from '../../ui/graph-registry-view.js';
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

const PAGE = { crumbs: ['あなたのBrainbase', '情報と関係'], source: '手元のGraph' };

async function mountView() {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const rail = new FakeElement('div');
  const view = createGraphRegistryView({ root, rail, page: PAGE, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, now: () => new Date(2026, 8, 20, 12) });
  await view.load();
  return { root, rail, view };
}

const byClass = (node, className) => findAll(node, (item) => String(item.className).split(' ').includes(className));
const resultRows = (root) => findAll(section(root, '検索結果'), (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-ws-ledger-row'));
const resultNames = (root) => resultRows(root).map((row) => row.children[0].children[0].textContent);
const resultRow = (root, key) => resultRows(root).find((row) => row.attributes['data-key'] === key);
const railHead = (rail) => collectText(byClass(rail, 'bb-ws-rail-head')[0]);
const ledgerIn = (node, className) => byClass(node, className)[0];

function searchForm(root) {
  return findAll(root, (node) => node.tagName === 'FORM' && node.className.includes('bb-gr-search'))[0];
}

function relationItem(rail, label, name) {
  return findAll(section(rail, label), (node) => node.tagName === 'LI' && collectText(node).includes(name))[0];
}

describe('情報と関係: workspace', () => {
  it('follows the organization screen pattern and lists every record in a ledger when the query is empty', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    expect(collectText(byClass(root, 'bb-ws-breadcrumb')[0])).toBe('あなたのBrainbase/情報と関係');
    expect(findAll(root, (node) => node.tagName === 'H1')[0].textContent).toBe('情報と関係');
    expect(byClass(root, 'bb-ws-source')[0].textContent).toBe('手元のGraph');
    const [source] = byClass(root, 'bb-ws-notice');
    expect(source.children[0].textContent).toBe('出典');
    expect(collectText(source)).toContain(dataDir);
    expect(collectText(source)).toContain('MCPの search・get_context・resolve_entity で次から使われます');
    expect(visibleText(root)).not.toContain('BRAINBASE /');

    const results = section(root, '検索結果');
    expect(collectText(results)).toContain('検索結果 8件');
    const ledger = ledgerIn(results, 'bb-ws-ledger');
    expect(ledger.className).toBe('bb-ws-ledger bb-graph-entity-ledger');
    expect(findAll(ledger, (node) => node.attributes?.role === 'columnheader').map((node) => node.textContent)).toEqual([...GRAPH_ENTITY_LEDGER_COLUMNS]);
    expect(GRAPH_ENTITY_LEDGER_COLUMNS).toEqual(['名前', '種類', '要約', '有効期間']);
    expect(resultNames(root)).toHaveLength(8);
    expect(collectText(resultRow(root, 'person-tanaka'))).toBe('田中 太郎person-tanaka人物導入の最終判断を担当期限なし');
    expect(collectText(resultRow(root, 'person-suzuki'))).toBe('鈴木 一郎person-suzuki人物以前の担当2026-01-01 に終了');
    expect(resultRow(root, 'person-suzuki').className).toContain('is-ended');
    expect(collectText(resultRow(root, 'org-acme'))).toBe('Acmeorg-acme組織要約なし期限なし');
    // Nothing is selected until the owner picks a row.
    expect(resultRows(root).some((row) => row.className.includes('is-selected'))).toBe(false);
    expect(collectText(rail)).toContain('記録を選択');
  });

  it('searches by name or alias, type and as-of date', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    type(root, 'q', 'tanaka');
    type(root, 'type', 'person');
    await searchForm(root).dispatch('submit');
    expect(resultNames(root)).toEqual(['田中 太郎']);
    expect(api.requests.at(-1).path).toBe('/api/graph/search?q=tanaka&type=person&limit=50');

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
    expect(collectText(section(root, '検索結果'))).toContain('（2026-09-26 の時点で有効なもの）');
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
    expect(byClass(section(empty.root, '検索結果'), 'bb-ws-ledger')).toEqual([]);
  });

  it('shows Graph v1 as a migration in search and in the kinds of information, never as a zero-count ledger', async () => {
    await writeGraphV1(dataDir);
    const { root } = await mountView();
    for (const label of ['検索結果', '情報の種類とつながり方']) {
      const part = section(root, label);
      const text = collectText(part);
      expect(text, label).toContain('Graphの移行が必要です');
      expect(text, label).toContain('brainbase ontology:migrate --dir');
      expect(text, label).toContain('--write --expected-input-digest');
      expect(text, label).not.toContain('条件に合う記録はありません');
      expect(text, label).not.toContain('0件（');
      expect(byClass(part, 'bb-ws-notice')[0].className, label).toBe('bb-ws-notice is-warning');
      expect(byClass(part, 'bb-ws-ledger'), label).toEqual([]);
    }
  });

  it('reports a read failure with a retry and treats an unconfirmed empty result as unknown', async () => {
    await writeGraphV2(dataDir);
    const good = await readFile(join(dataDir, 'graph.json'), 'utf8');
    await writeFile(join(dataDir, 'graph.json'), '{ broken');
    const { root } = await mountView();
    expect(collectText(section(root, '検索結果'))).toContain('読み取れませんでした');
    expect(byClass(section(root, '検索結果'), 'bb-ws-notice')[0].className).toBe('bb-ws-notice is-danger');
    expect(collectText(section(root, '情報の種類とつながり方'))).toContain('0件ではありません');
    await writeFile(join(dataDir, 'graph.json'), good);
    buttonsNamed(section(root, '検索結果'), '再試行')[0].dispatch('click');
    await waitFor(() => resultNames(root).length === 8);

    expect(normalizeSearch({ state: 'ok', payload: { results: [], absenceConfirmed: false } })).toEqual({ state: 'unknown' });
    const unknownRoot = new FakeElement('div');
    const view = createGraphRegistryView({
      root: unknownRoot,
      rail: new FakeElement('div'),
      document: new FakeDocument(),
      fetcher: async () => jsonResponse(200, { status: 'ok', results: [], absenceConfirmed: false }),
      autoLoad: false,
    });
    await view.search();
    const unknown = section(unknownRoot, '検索結果');
    expect(collectText(unknown)).toContain('記録の有無を確かめられません。0件ではありません。');
    expect(byClass(unknown, 'bb-ws-ledger')).toEqual([]);
  });
});

describe('情報と関係: the record in the rail', () => {
  it('opens the selected row in the rail with its names, validity and both directions of relations with meaning, role and source', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '概要'));
    expect(railHead(rail)).toBe('人物田中 太郎person-tanaka');
    expect(resultRow(root, 'person-tanaka').className).toContain('is-selected');
    const summary = visibleText(section(rail, '概要'));
    expect(summary).toContain('別名Tanaka');
    expect(summary).toContain('要約導入の最終判断を担当');
    expect(summary).toContain('有効期間期限なし有効');

    const member = visibleText(relationItem(rail, '出る関係', 'Acme'));
    expect(member).toContain('Acmeに所属');
    expect(member).toContain('関係の意味人物が組織に所属している');
    expect(member).toContain('相手の種類組織');
    expect(member).toContain('移行');
    expect(member).toContain('出典 person-tanaka（未解決）');
    const participation = visibleText(relationItem(rail, '出る関係', 'Atlas導入'));
    expect(participation).toContain('Atlas導入に参加');
    expect(participation).toContain('役割責任者');
    expect(participation).toContain('文脈最終判断を担当');
    expect(participation).toContain('オンボーディング');
    expect(collectText(section(rail, '入る関係'))).toContain('この記録へ入る関係はありません。');

    const visible = `${visibleText(root)}${visibleText(rail)}`;
    for (const internal of ['edge-', 'sha256:', 'digest', 'Canonical', 'participates_in', 'member_of']) {
      expect(visible, internal).not.toContain(internal);
    }
    expect(collectText(relationItem(rail, '出る関係', 'Acme'))).toContain(EDGES.tanakaAcme.id);
    // The record itself is not repeated in the workspace.
    expect(collectText(root)).not.toContain('出る関係');
  });

  it('moves the rail with the selected row', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => railHead(rail).includes('田中 太郎') && section(rail, '概要'));
    resultRow(root, 'org-acme').dispatch('click');
    await waitFor(() => railHead(rail).includes('Acme') && section(rail, '概要'));
    expect(railHead(rail)).toBe('組織Acmeorg-acme');
    expect(collectText(section(rail, '入る関係'))).toContain('田中 太郎が所属');
    expect(resultRow(root, 'org-acme').className).toContain('is-selected');
    expect(resultRow(root, 'person-tanaka').className).not.toContain('is-selected');
  });

  it('follows a relation to the other record, resolves local sources, and goes back', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView();
    await view.openEntity('person-tanaka');
    buttonsNamed(relationItem(rail, '出る関係', 'Atlas導入'), 'Atlas導入')[0].dispatch('click');
    await waitFor(() => railHead(rail) === 'プロジェクトAtlas導入project-atlas' && section(rail, '概要'));
    const incoming = collectText(section(rail, '入る関係'));
    expect(incoming).toContain('佐藤 花子が責任を持つ');
    expect(incoming).toContain('田中 太郎が参加');
    expect(incoming).toContain('スコープが進め方を決める');
    expect(visibleText(relationItem(rail, '入る関係', '佐藤 花子'))).toContain('取り込み候補「佐藤 花子」（candidates/extracted-abc.json）');
    expect(visibleText(section(rail, '概要'))).toContain('目的導入を完了する');

    buttonsNamed(relationItem(rail, '入る関係', '佐藤 花子'), '佐藤 花子')[0].dispatch('click');
    await waitFor(() => visibleText(section(rail, '概要') ?? new FakeElement('div')).includes('進行管理'));
    expect(visibleText(relationItem(rail, '出る関係', 'Beta検証'))).toContain('オンボーディングの候補「佐藤 花子」（実行 run-1、承認済み、runs/connected-onboarding.json）');
    expect(resultRow(root, 'person-sato').className).toContain('is-selected');

    buttonsNamed(rail, '← 前の記録（Atlas導入）に戻る')[0].dispatch('click');
    await waitFor(() => railHead(rail).includes('Atlas導入') && section(rail, '概要'));
    buttonsNamed(rail, '← 前の記録（田中 太郎）に戻る')[0].dispatch('click');
    await waitFor(() => railHead(rail).includes('田中 太郎') && section(rail, '概要'));
    expect(buttonsNamed(rail, '← 前の記録（田中 太郎）に戻る')).toEqual([]);
  });

  it('reports a record that does not exist without showing it as empty', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView();
    await view.openEntity('person-nobody');
    expect(collectText(rail)).toContain('この記録は見つかりません');
    expect(section(rail, '出る関係')).toBeUndefined();
  });

  it('puts the rail content after the workspace when the host has no right rail', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    const view = createGraphRegistryView({ root, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false });
    await view.load();
    expect(root.children.map((node) => node.className)).toEqual(['bb-graph bb-gr', 'bb-graph-rail-inline']);
    await view.openEntity('person-tanaka');
    expect(railHead(root.children[1])).toBe('人物田中 太郎person-tanaka');
  });
});

describe('情報と関係: corrections', () => {
  it('corrects aliases with the shown digest, and the next search finds the record by the new alias', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '概要'));
    buttonsNamed(rail, 'この記録を直す')[0].dispatch('click');
    expect(control(rail, 'aliases').value).toBe('Tanaka');
    expect(control(rail, 'goal')).toBeUndefined();
    type(rail, 'aliases', 'Tanaka、タナカ');
    type(rail, 'reason', '読みを別名に加える。');
    await submit(rail);
    const [post] = api.posts();
    expect(post.body).toEqual({
      kind: 'update_entity',
      entityId: 'person-tanaka',
      expectedDigest: graphRecordDigest(ENTITIES.tanaka),
      reason: '読みを別名に加える。',
      changes: { aliases: ['Tanaka', 'タナカ'] },
    });
    const panel = collectText(section(rail, 'この記録を直す'));
    expect(panel).toContain('別名Tanaka、タナカ');
    expect(panel).toContain('次にMCPの search・get_context・resolve_entity を使うときから、この内容が使われます。');
    await waitFor(() => visibleText(section(rail, '概要')).includes('別名Tanaka、タナカ'));

    type(root, 'q', 'タナカ');
    await searchForm(root).dispatch('submit');
    expect(resultNames(root)).toEqual(['田中 太郎']);
    // The record stays in the rail because it is among the new results.
    expect(railHead(rail)).toBe('人物田中 太郎person-tanaka');
  });

  it('ends a relation with an end date and keeps the draft with the current values on a conflict', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView();
    await view.openEntity('person-tanaka');
    buttonsNamed(relationItem(rail, '出る関係', 'Acme'), 'この関係を直す')[0].dispatch('click');
    // The form opens inside that relation.
    expect(section(relationItem(rail, '出る関係', 'Acme'), '関係を直す')).toBeDefined();
    type(rail, 'validTo', '2026-09-01');
    type(rail, 'reason', '9月に退職した。');
    await applyGraphCorrection(dataDir, {
      kind: 'update_edge', edgeId: EDGES.tanakaAcme.id, expectedDigest: graphRecordDigest(EDGES.tanakaAcme), reason: '役割を記録する。', changes: { role: '顧問' },
    }, { now: FIXTURE_NOW });
    await submit(rail);
    const conflict = collectText(section(rail, '関係を直す'));
    expect(conflict).toContain('ほかの保存で内容が変わっていた');
    expect(conflict).toContain('役割顧問');
    expect(control(rail, 'validTo').value).toBe('2026-09-01');
    expect(control(rail, 'reason').value).toBe('9月に退職した。');

    await submit(rail);
    const posts = api.posts();
    expect(posts[0].body.expectedDigest).toBe(graphRecordDigest(EDGES.tanakaAcme));
    expect(posts[1].body.expectedDigest).not.toBe(graphRecordDigest(EDGES.tanakaAcme));
    expect(posts[1].body.changes).toEqual({ validTo: dayToRfc3339('2026-09-01') });
    expect(collectText(section(rail, '関係を直す'))).toContain('終了日2026-09-01');
    await waitFor(() => visibleText(relationItem(rail, '出る関係', 'Acme')).includes('2026-09-01 に終了'));
  });

  it('adds a relation from a person, looking up the other side by the kind the relation needs', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView();
    await view.openEntity('person-sato');
    buttonsNamed(rail, '関係を加える')[0].dispatch('click');
    await waitFor(() => control(rail, 'counterpartId'));
    const relations = findAll(control(rail, 'relation'), (node) => node.tagName === 'OPTION').map((node) => node.attributes.value);
    expect(relations).toEqual(['participates_in', 'accountable_for', 'member_of']);
    type(rail, 'relation', 'member_of');
    await waitFor(() => api.requests.some((request) => request.path === '/api/graph/search?type=org&limit=100')
      && findAll(control(rail, 'counterpartId'), (node) => node.tagName === 'OPTION').some((node) => node.textContent === 'Acme'));
    type(rail, 'counterpartId', 'org-acme');
    type(rail, 'reason', 'Acmeに所属している。');
    await submit(rail);
    expect(api.posts()[0].body).toEqual({
      kind: 'create_edge',
      reason: 'Acmeに所属している。',
      edge: { fromId: 'person-sato', relation: 'member_of', toId: 'org-acme' },
    });
    await waitFor(() => relationItem(rail, '出る関係', 'Acme'));
    expect(visibleText(relationItem(rail, '出る関係', 'Acme'))).toContain('利用者が承認');
    // A decision cannot gain a relation through a correction.
    await view.openEntity('decision-scope');
    expect(buttonsNamed(rail, '関係を加える')).toEqual([]);
  });
});

describe('情報と関係: kinds of information', () => {
  it('lists relation kinds and kinds of information as two read-only ledgers with meaning and counts', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    const panel = section(root, '情報の種類とつながり方');
    expect(findAll(panel, (node) => node.tagName === 'H2')[0].textContent).toBe('情報の種類とつながり方');
    const relations = ledgerIn(panel, 'bb-graph-relation-type-ledger');
    const kinds = ledgerIn(panel, 'bb-graph-entity-type-ledger');
    expect(findAll(relations, (node) => node.attributes?.role === 'columnheader').map((node) => node.textContent)).toEqual([...GRAPH_RELATION_TYPE_LEDGER_COLUMNS]);
    expect(findAll(kinds, (node) => node.attributes?.role === 'columnheader').map((node) => node.textContent)).toEqual([...GRAPH_ENTITY_TYPE_LEDGER_COLUMNS]);
    const kindText = collectText(kinds);
    expect(kindText).toContain('人物Graphに登録された人4件');
    expect(kindText).toContain('プロジェクト目的を持つ、区切りのある仕事2件');
    const relationText = collectText(relations);
    expect(relationText).toContain('参加人物 → プロジェクト人物がプロジェクトに参加している2件（うち有効 1件）');
    expect(relationText).toContain('責任人物 → プロジェクト人物がプロジェクトの成果や判断に責任を持つ1件（うち有効 1件）');
    expect(relationText).toContain('所有プロジェクト → 組織');
    const text = collectText(panel);
    expect(text).toContain('新しく加えられる関係: 参加・責任・所属');
    expect(text).toContain('（最新）');
    // Read-only: no change proposal and no button in this panel.
    expect(findAll(panel, (node) => node.tagName === 'BUTTON' || node.tagName === 'FORM')).toEqual([]);
    expect(text).not.toContain('提案');
    // The organization Graph (not connected here) gets no column or placeholder.
    expect(collectText(root)).not.toContain('組織のGraph');
  });
});

describe('情報と関係: counts another host could not finish', () => {
  // A host whose Graph is larger than one read (the organization Graph) sends
  // null counts with a status instead of a number it cannot vouch for.
  async function mountPartial() {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const fetcher = async (url, init) => {
      const response = await api.fetcher(url, init);
      const path = String(url);
      if (!path.includes('/ontology') && !path.includes('/search')) return response;
      const payload = await response.json();
      if (path.includes('/ontology')) {
        payload.entityTypes = payload.entityTypes.map((item, index) => (index === 0
          ? { ...item, count: null, countStatus: 'at_least', atLeast: 500 }
          : { ...item, count: null, countStatus: 'unknown' }));
        payload.relations = payload.relations.map((item) => ({ ...item, count: null, activeCount: null, countStatus: 'unknown' }));
      } else {
        Object.assign(payload, { total: null, totalStatus: 'unknown', truncated: true, absenceConfirmed: false });
      }
      return jsonResponse(200, payload);
    };
    const root = new FakeElement('div');
    const view = createGraphRegistryView({ root, rail: new FakeElement('div'), page: PAGE, document: new FakeDocument(), fetcher, token: TOKEN, autoLoad: false });
    await view.load();
    return root;
  }

  it('shows an unfinished count as unconfirmed or as a lower bound, never as null or zero', async () => {
    const root = await mountPartial();
    const panel = section(root, '情報の種類とつながり方');
    const text = collectText(panel);
    expect(text).not.toContain('読み取れませんでした');
    expect(collectText(ledgerIn(panel, 'bb-graph-entity-type-ledger'))).toContain('500件以上');
    expect(collectText(ledgerIn(panel, 'bb-graph-entity-type-ledger'))).toContain('件数は未確認');
    expect(collectText(ledgerIn(panel, 'bb-graph-relation-type-ledger'))).toContain('件数は未確認');
    expect(text).not.toContain('null');
    expect(text).not.toMatch(/(^|[^0-9])0件/);
  });

  it('shows how many results are on screen when the host cannot give the search total', async () => {
    const root = await mountPartial();
    const results = collectText(section(root, '検索結果'));
    expect(results).toContain('検索結果 8件を表示（全体の件数は未確認）');
    expect(results).toContain('ほかにもある可能性があります。条件を絞って探してください。');
    expect(results).not.toContain('null');
    expect(results).not.toContain('NaN');
  });
});

describe('情報と関係: host extensions', () => {
  const CORRECTION_BUTTONS = ['この記録を直す', '関係を加える', 'この関係を直す'];
  const correctionButtons = (node) => findAll(node, (item) => item.tagName === 'BUTTON' && CORRECTION_BUTTONS.includes(item.textContent));
  const typeOptions = (root) => findAll(control(root, 'type'), (node) => node.tagName === 'OPTION').map((node) => [node.attributes.value, node.textContent]);

  async function mountWith(options) {
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    const rail = new FakeElement('div');
    const view = createGraphRegistryView({ root, rail, page: PAGE, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, ...options });
    await view.load();
    return { root, rail, view };
  }

  it('draws no correction control and never posts when the host cannot correct', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountWith({ canCorrect: false });
    await view.openEntity('person-tanaka');
    expect(section(rail, '出る関係')).toBeDefined();
    expect(correctionButtons(rail)).toEqual([]);
    expect(byClass(rail, 'bb-ws-notice')).toEqual([]);
    // What this screen can correct is not listed either; the kinds stay.
    const kinds = collectText(section(root, '情報の種類とつながり方'));
    expect(kinds).not.toContain('この画面で直せること');
    expect(kinds).toContain('人物Graphに登録された人4件');
    // A person can normally gain a relation; here even a correction opened by code is refused before sending.
    view.correction.openCreate(view.state.detail.payload.entity);
    await waitFor(() => view.correction.form?.candidates?.state === 'ok');
    view.correction.callbacks.onInput('counterpartId', 'project-beta');
    view.correction.callbacks.onReason('参加を加える。');
    const form = await view.correction.submit();
    expect(form.message.text).toBe('このホストでは保存できません。');
    expect(api.posts()).toEqual([]);
    expect(correctionButtons(rail)).toEqual([]);
  });

  it('shows the host note in the rail only when the host passes one, and replaces the 出典 notice', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountWith({
      canCorrect: false,
      readOnlyNote: 'この画面からは直せません。',
      sourceNotice: { label: '読み取り元', text: '別のGraphを表示だけしています。' },
    });
    const [first] = byClass(root, 'bb-ws-notice');
    expect(collectText(first)).toBe('読み取り元別のGraphを表示だけしています。');
    expect(collectText(root)).not.toContain('このMacのGraph');
    expect(collectText(root)).not.toContain('MCPの search');
    await view.openEntity('org-acme');
    expect(byClass(rail, 'bb-ws-notice').map((node) => collectText(node))).toEqual(['この画面からは直せません。']);
    // The default keeps the 出典 notice and the buttons.
    await api.close();
    const plain = await mountView();
    expect(collectText(byClass(plain.root, 'bb-ws-notice')[0])).toContain('このMacのGraph');
    await plain.view.openEntity('org-acme');
    expect(buttonsNamed(plain.rail, 'この記録を直す')).toHaveLength(1);
    expect(collectText(plain.rail)).not.toContain('この画面からは直せません。');
  });

  it('lists the kinds of the Graph in the type filter, the local four by default', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    expect(typeOptions(root)).toEqual([['', 'すべての種類'], ['person', '人物'], ['org', '組織'], ['project', 'プロジェクト'], ['decision', '判断']]);
    // The answer was read from the host, not assumed.
    expect(api.requests.some((request) => request.path === '/api/graph/ontology')).toBe(true);
  });

  it('takes the type filter from the ontology answer and shows unknown kinds by their raw id everywhere', async () => {
    const entity = (id, type, name) => ({ id, type, name, aliases: [], summary: null, tags: [], validFrom: null, validTo: null, active: true, digest: `sha256:${id}` });
    const results = [entity('person-a', 'person', 'A さん'), entity('task-1', 'task', '見積もり'), entity('odd-1', 'constructor', '変わった記録')];
    const routes = {
      '/search': () => ({ status: 'ok', source: { dataDir: '/data' }, query: { q: '', type: null, asOf: null }, results, total: 3, truncated: false, absenceConfirmed: false, graphEmpty: false }),
      '/ontology': () => ({
        status: 'ok',
        source: { dataDir: '/data' },
        asOf: '2026-09-26T00:00:00Z',
        ontology: { id: 'graph', version: '2', releaseDigest: 'sha256:r', currentVersion: '2', upToDate: true },
        entityTypes: [
          { id: 'person', meaning: 'A human.', count: 1 },
          { id: 'task', meaning: '仕事の単位', count: 1 },
          { id: 'constructor', meaning: '', count: 1 },
        ],
        relations: [{ id: 'assigned_to', from: 'task', to: 'person', meaning: '担当している', count: 0, activeCount: 0 }],
      }),
      '/entities/task-1': () => ({ status: 'ok', source: { dataDir: '/data' }, asOf: '2026-09-26T00:00:00Z', entity: { ...entity('task-1', 'task', '見積もり'), metadata: {} }, outgoing: [], incoming: [], history: [], issues: [] }),
    };
    const root = new FakeElement('div');
    const rail = new FakeElement('div');
    let ontologyReady = false;
    const view = createGraphRegistryView({
      root,
      rail,
      document: new FakeDocument(),
      autoLoad: false,
      canCorrect: false,
      fetcher: async (path) => {
        const route = routes[new URL(path, 'http://localhost').pathname.replace('/api/graph', '')];
        if (path.includes('/ontology') && !ontologyReady) return jsonResponse(500, { error: { code: 'boom', message: 'まだ読めません' } });
        return route ? jsonResponse(200, route()) : jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
      },
    });
    await view.load();
    // Until the kinds are read, the local four are offered.
    expect(typeOptions(root).map(([value]) => value)).toEqual(['', 'person', 'org', 'project', 'decision']);
    ontologyReady = true;
    await view.loadOntology();
    expect(typeOptions(root)).toEqual([['', 'すべての種類'], ['person', '人物'], ['task', 'task'], ['constructor', 'constructor']]);

    const typeCells = resultRows(root).map((row) => collectText(row.children[1]));
    expect(typeCells).toEqual(['人物', 'task', 'constructor']);
    const kinds = collectText(ledgerIn(section(root, '情報の種類とつながり方'), 'bb-graph-entity-type-ledger'));
    // A local kind keeps its plain meaning; another kind shows the host's.
    expect(kinds).toContain('人物Graphに登録された人1件');
    expect(kinds).toContain('task仕事の単位1件');
    expect(kinds).toContain('constructor1件');
    expect(collectText(ledgerIn(section(root, '情報の種類とつながり方'), 'bb-graph-relation-type-ledger'))).toContain('assigned_totask → 人物担当している');

    await view.openEntity('task-1');
    expect(railHead(rail)).toBe('task見積もりtask-1');
    expect(collectText(section(rail, '出る関係'))).toContain('このtaskが起点になっている関係です。');
    const text = `${collectText(root)}${collectText(rail)}`;
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('function');
  });
});
