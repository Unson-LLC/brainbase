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

/**
 * The open record's own screen: a live view so a test can keep one handle
 * while the screen redraws.
 */
function detailView(root) {
  return {
    tagName: 'DIV',
    attributes: {},
    className: '',
    textContent: '',
    get children() {
      const panel = findAll(root, (node) => node.attributes?.id === 'bb-gr-detail')[0];
      return panel ? [panel] : [];
    },
  };
}

async function mountView(options = {}) {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const hostRail = new FakeElement('div');
  const view = createGraphRegistryView({ root, rail: hostRail, page: PAGE, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, now: () => new Date(2026, 8, 20, 12), ...options });
  await view.load();
  return { root, rail: detailView(root), hostRail, view };
}

const byClass = (node, className) => findAll(node, (item) => String(item.className).split(' ').includes(className));
const resultRows = (root) => findAll(section(root, '検索結果'), (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-ws-ledger-row'));
const resultNames = (root) => resultRows(root).map((row) => row.children[0].children[0].textContent);
const resultRow = (root, key) => resultRows(root).find((row) => row.attributes['data-key'] === key);
/** The open record's heading: its kind, then its name. */
const railHead = (rail) => {
  const head = byClass(rail, 'bb-gr-detail-head')[0];
  return head ? `${byClass(head, 'bb-gr-detail-kind')[0].textContent}${findAll(head, (node) => node.tagName === 'H1')[0].textContent}` : '';
};
const ledgerIn = (node, className) => byClass(node, className)[0];

/** The kinds are tabs: read them as [type, label, count?], or press one. */
const typeTabs = (root) => findAll(root, (node) => node.attributes?.role === 'tab');
function typeOptions(root) {
  return typeTabs(root).map((tab) => [tab.attributes['data-type'], tab.children[0].textContent, ...(tab.children[1] ? [tab.children[1].textContent] : [])]);
}
function chooseType(root, value) {
  const tab = typeTabs(root).find((node) => node.attributes['data-type'] === value);
  if (!tab) throw new Error(`no type tab ${value}`);
  return tab.dispatch('click');
}
const chips = (root) => findAll(root, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-gr-filter-chip')).map((node) => node.attributes['aria-label']);

function searchForm(root) {
  return findAll(root, (node) => node.tagName === 'FORM' && node.className.includes('bb-gr-search'))[0];
}

/** One relation's line in a part of the record's screen: つながり, 根拠と履歴 or 直す. */
function relationItem(rail, label, name) {
  return findAll(section(rail, label), (node) => node.tagName === 'LI' && !String(node.parentNode?.className).includes('bb-gr-reach')
    && collectText(node).includes(name))[0];
}

describe('情報と関係: workspace', () => {
  it('follows the organization screen pattern and lists every record in a ledger when the query is empty', async () => {
    await writeGraphV2(dataDir);
    const { root, hostRail } = await mountView();
    expect(collectText(byClass(root, 'bb-ws-breadcrumb')[0])).toBe('あなたのBrainbase/情報と関係');
    expect(findAll(root, (node) => node.tagName === 'H1')[0].textContent).toBe('情報と関係');
    expect(byClass(root, 'bb-ws-source')[0].textContent).toBe('手元のGraph');
    // The 出典 notice belongs to a record's 根拠と履歴, not to the whole list.
    expect(collectText(root)).not.toContain('このMacのGraph');
    expect(visibleText(root)).not.toContain('BRAINBASE /');

    const results = section(root, '検索結果');
    expect(collectText(results)).toContain('検索結果 8件');
    const ledger = ledgerIn(results, 'bb-ws-ledger');
    expect(ledger.className).toBe('bb-ws-ledger bb-graph-entity-ledger');
    // The local Graph does not say when a record changed, so there is no 最終更新 column to fill with guesses.
    expect(GRAPH_ENTITY_LEDGER_COLUMNS).toEqual(['名前', '種類', '説明', '最終更新']);
    expect(findAll(ledger, (node) => node.attributes?.role === 'columnheader').map((node) => node.textContent)).toEqual(['名前', '種類', '説明']);
    expect(resultNames(root)).toHaveLength(8);
    expect(collectText(resultRow(root, 'person-tanaka'))).toBe('田中 太郎人導入の最終判断を担当');
    expect(collectText(resultRow(root, 'person-suzuki'))).toBe('鈴木 一郎2026-01-01 に終了人以前の担当');
    expect(resultRow(root, 'person-suzuki').className).toContain('is-ended');
    // A record without a description says so, rather than leaving the cell empty.
    expect(collectText(resultRow(root, 'org-acme'))).toBe('Acme会社説明の記録なし');
    expect(resultRow(root, 'org-acme').attributes['aria-label']).toBe('Acme（会社）を開く');
    // The internal ids stay off the list.
    expect(visibleText(section(root, '検索結果'))).not.toContain('person-tanaka');
    // The rail stays empty: a record opens as its own screen.
    expect(hostRail.children.map((node) => collectText(node)).join('')).toBe('');
    // No 探す button: the conditions apply as they change.
    expect(buttonsNamed(root, '探す')).toEqual([]);
  });

  it('searches by name or alias, type and as-of date', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    type(root, 'q', 'tanaka');
    chooseType(root, 'person');
    await searchForm(root).dispatch('submit');
    expect(resultNames(root)).toEqual(['田中 太郎']);
    expect(api.requests.at(-1).path).toBe('/api/graph/search?q=tanaka&type=person&limit=50');

    type(root, 'q', '');
    chooseType(root, '');
    type(root, 'as_of', '2026-09-26');
    await searchForm(root).dispatch('submit');
    const url = new URL(api.requests.at(-1).path, 'http://localhost');
    expect(url.searchParams.get('as_of')).toBe(dayToRfc3339('2026-09-26'));
    // Records that ended before that day are not listed.
    expect(resultNames(root)).not.toContain('鈴木 一郎');
    expect(resultNames(root)).not.toContain('Beta検証');
    expect(resultNames(root)).toContain('田中 太郎');
    expect(collectText(section(root, '検索結果'))).toContain('（2026-09-26 の状態）');
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
    expect(collectText(section(root, '検索結果'))).toContain('記録を取得できませんでした');
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

describe('情報と関係: the record as its own screen (D14)', () => {
  it('opens a row as its own screen headed by its name and kind, and goes back to the list with that row focused', async () => {
    await writeGraphV2(dataDir);
    const routes = [];
    const { root, rail } = await mountView({ onRouteChange: (id, options) => routes.push([id, options]) });
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '何者か'));
    expect(routes).toEqual([['person-tanaka', { back: false }]]);
    // The list is gone: the screen is the record's.
    expect(section(root, '検索結果')).toBeUndefined();
    expect(railHead(rail)).toBe('人田中 太郎');
    // 何者か → つながり → 根拠と履歴 → 直す; there is no read path for 使われた場所 yet, so no such part.
    const parts = findAll(rail, (node) => node.tagName === 'SECTION' && String(node.className).includes('bb-gr-page-section')).map((node) => node.attributes['aria-label']);
    expect(parts).toEqual(['何者か', 'つながり', '根拠と履歴', '直す']);
    const identity = visibleText(section(rail, '何者か'));
    expect(identity).toContain('種類人');
    expect(identity).toContain('説明導入の最終判断を担当');
    expect(identity).toContain('別名Tanaka');

    buttonsNamed(rail, '← 情報と関係の一覧に戻る')[0].dispatch('click');
    expect(rail.children).toEqual([]);
    expect(routes.at(-1)).toEqual([null, { back: true }]);
    expect(resultNames(root)).toHaveLength(8);
  });

  it('reads the connections as sentences grouped by the kind of the other record, without out and in', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView();
    await view.openEntity('project-atlas');
    const connections = section(rail, 'つながり');
    const groups = findAll(connections, (node) => node.attributes?.role === 'group').map((node) => node.attributes['aria-label']);
    expect(groups).toEqual(['人', '判断']);
    const people = visibleText(findAll(connections, (node) => node.attributes?.role === 'group' && node.attributes['aria-label'] === '人')[0]);
    expect(people).toContain('人（2）');
    expect(people).toContain('佐藤 花子が責任を持つ');
    expect(people).toContain('田中 太郎が参加（役割: 責任者・最終判断を担当）');
    expect(visibleText(connections)).toContain('スコープが進め方を決める');
    for (const word of ['出る関係', '入る関係', 'participates_in', 'accountable_for']) expect(visibleText(rail), word).not.toContain(word);
    await view.openEntity('person-tanaka');
    expect(visibleText(section(rail, 'つながり'))).toContain('Acmeに所属');
  });

  it('keeps the source, period, corrections and ids folded in 根拠と履歴, named for what they belong to', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView();
    await view.openEntity('person-tanaka');
    const evidence = section(rail, '根拠と履歴');
    // Folded: nothing of it is visible until opened.
    expect(visibleText(evidence)).toBe('根拠と履歴');
    expect(findAll(evidence, (node) => node.tagName === 'SUMMARY')[0].textContent).toBe('出典・有効期間・訂正の履歴を見る');
    const text = collectText(evidence);
    expect(text).toContain('このMacのGraph');
    expect(text).toContain('MCPの search・get_context・resolve_entity で次から使われます');
    expect(text).toContain('有効期間期限なし');
    expect(collectText(relationItem(rail, '根拠と履歴', 'Acme'))).toContain('移行');
    expect(collectText(relationItem(rail, '根拠と履歴', 'Acme'))).toContain('出典 person-tanaka（未解決）');
    expect(collectText(relationItem(rail, '根拠と履歴', 'Atlas導入'))).toContain('オンボーディング');
    expect(collectText(relationItem(rail, '根拠と履歴', 'Acme'))).toContain(EDGES.tanakaAcme.id);
    const summaries = findAll(rail, (node) => node.tagName === 'SUMMARY').map((node) => node.textContent);
    expect(summaries).toContain('この記録のID（技術情報）');
    expect(summaries).toContain('この関係のID（技術情報）');
    expect(summaries).not.toContain('記録の詳細');
    for (const internal of ['edge-', 'sha256:', 'digest', 'Canonical']) expect(visibleText(rail), internal).not.toContain(internal);

    await view.openEntity('project-atlas');
    expect(collectText(relationItem(rail, '根拠と履歴', '佐藤 花子'))).toContain('取り込み候補「佐藤 花子」（candidates/extracted-abc.json）');
  });

  it('shows what a fix reaches before the correction entries', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '直す'));
    const fix = section(rail, '直す');
    const text = visibleText(fix);
    expect(text.indexOf('影響する先')).toBeLessThan(text.indexOf('この記録を直す'));
    expect(text).toContain('この人を名前・別名で探す検索と、MCPの search・get_context・resolve_entity（次の呼び出しから）');
    expect(text).toContain('つながる2件の記録（Acme、Atlas導入）の詳細に出る、この記録の名前とつながり');
    expect(text).toContain('訂正入口');
    expect(text).toContain('承認待ちの提出ではなく');
    expect(text).toContain('保存後に読み直して一致を確かめ');
    expect(buttonsNamed(fix, 'この記録を直す')).toHaveLength(1);
    expect(buttonsNamed(fix, '関係を加える')).toHaveLength(1);
    expect(buttonsNamed(fix, 'この関係を直す')).toHaveLength(2);
    expect(findAll(rail, (node) => node.tagName === 'FORM' && node.className.includes('bb-graph-form'))).toHaveLength(0);
  });

  it('keeps an empty relation result unconfirmed when the selected project still has known participants, and offers a retry', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    let detailReads = 0;
    const fetcher = async (path) => {
      const response = await api.fetcher(path);
      if (!String(path).includes('/api/graph/entities/project-atlas')) return response;
      const body = await response.json();
      detailReads += 1;
      if (detailReads > 1) return jsonResponse(200, body);
      return jsonResponse(200, {
        ...body,
        entity: {
          ...body.entity,
          participantCount: 2,
          accountableCount: 1,
          people: [{ id: 'person-a', name: '担当A', accountable: true }, { id: 'person-b', name: '担当B', accountable: false }],
        },
        outgoing: [],
        incoming: [],
        participants_status: 'unavailable',
        participants_reason: '関係者の記録元を確認できません。',
        absenceConfirmed: false,
        source: { ...body.source, edges_not_provided: true },
      });
    };
    const root = new FakeElement('div');
    const rail = detailView(root);
    const view = createGraphRegistryView({ root, rail: new FakeElement('div'), page: PAGE, document: new FakeDocument(), fetcher, token: TOKEN, autoLoad: false, now: () => new Date(2026, 8, 20, 12) });
    await view.load();
    await view.openEntity('project-atlas');

    const connections = section(rail, 'つながり');
    expect(collectText(connections)).toContain('確認できない');
    expect(collectText(connections)).toContain('関係者の記録元を確認できません。');
    expect(collectText(connections)).toContain('登録なしとは判断できません。');
    expect(collectText(connections)).not.toContain('つながる記録はありません');
    expect(buttonsNamed(connections, '再試行')).toHaveLength(1);

    buttonsNamed(connections, '再試行')[0].dispatch('click');
    await waitFor(() => detailReads === 2 && collectText(section(rail, 'つながり')).includes('田中 太郎が参加'));
    expect(collectText(section(rail, 'つながり'))).not.toContain('登録なしとは判断できません。');
  });

  it('prioritizes incomplete source signals over a contradictory confirmed-empty relation status', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const fetcher = async (path) => {
      const response = await api.fetcher(path);
      if (!String(path).includes('/api/graph/entities/project-atlas')) return response;
      const body = await response.json();
      return jsonResponse(200, {
        ...body,
        entity: {
          ...body.entity,
          participantCount: 2,
          accountableCount: 1,
          people: [{ id: 'person-a', name: '担当A', accountable: true }, { id: 'person-b', name: '担当B', accountable: false }],
        },
        outgoing: [],
        incoming: [],
        relations_status: 'confirmed_empty',
        participants_status: 'unavailable',
        participants_reason: '関係者の記録元を確認できません。',
        absenceConfirmed: false,
        source: { ...body.source, edges_not_provided: true },
      });
    };
    const root = new FakeElement('div');
    const rail = detailView(root);
    const view = createGraphRegistryView({ root, rail: new FakeElement('div'), page: PAGE, document: new FakeDocument(), fetcher, token: TOKEN, autoLoad: false, now: () => new Date(2026, 8, 20, 12) });
    await view.load();
    await view.openEntity('project-atlas');

    const connections = section(rail, 'つながり');
    expect(collectText(connections)).toContain('確認できない');
    expect(collectText(connections)).toContain('登録なしとは判断できません。');
    expect(collectText(connections)).not.toContain('つながる記録はありません');
    expect(buttonsNamed(connections, '再試行')).toHaveLength(1);
  });

  it('opens another row from the list after going back', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => railHead(rail).includes('田中 太郎') && section(rail, '何者か'));
    buttonsNamed(rail, '← 情報と関係の一覧に戻る')[0].dispatch('click');
    resultRow(root, 'org-acme').dispatch('click');
    await waitFor(() => railHead(rail).includes('Acme') && section(rail, '何者か'));
    expect(railHead(rail)).toBe('会社Acme');
    expect(collectText(section(rail, 'つながり'))).toContain('田中 太郎が所属');
  });

  it('follows a connection to the other record, resolves local sources, and goes back', async () => {
    await writeGraphV2(dataDir);
    const routes = [];
    const { rail, view } = await mountView({ onRouteChange: (id, options) => routes.push([id, options]) });
    await view.openEntity('person-tanaka');
    // A host opening an address hears nothing back.
    expect(routes).toEqual([]);
    buttonsNamed(relationItem(rail, 'つながり', 'Atlas導入'), 'Atlas導入')[0].dispatch('click');
    await waitFor(() => railHead(rail) === 'プロジェクトAtlas導入' && section(rail, '何者か'));
    expect(routes).toEqual([['project-atlas', { back: false }]]);
    expect(collectText(rail)).toContain('「田中 太郎」のつながりからたどっています。');
    expect(visibleText(section(rail, '何者か'))).toContain('目的導入を完了する');

    buttonsNamed(relationItem(rail, 'つながり', '佐藤 花子'), '佐藤 花子')[0].dispatch('click');
    await waitFor(() => visibleText(section(rail, '何者か') ?? new FakeElement('div')).includes('進行管理'));
    expect(collectText(relationItem(rail, '根拠と履歴', 'Beta検証'))).toContain('オンボーディングの候補「佐藤 花子」（実行 run-1、承認済み、runs/connected-onboarding.json）');
    expect(railHead(rail)).toBe('人佐藤 花子');

    buttonsNamed(rail, '← 前の記録（Atlas導入）に戻る')[0].dispatch('click');
    await waitFor(() => railHead(rail).includes('Atlas導入') && section(rail, '何者か'));
    expect(routes.at(-1)).toEqual(['project-atlas', { back: false }]);
    buttonsNamed(rail, '← 前の記録（田中 太郎）に戻る')[0].dispatch('click');
    await waitFor(() => railHead(rail).includes('田中 太郎') && section(rail, '何者か'));
    expect(buttonsNamed(rail, '← 前の記録（田中 太郎）に戻る')).toEqual([]);
    // The host's address catching up with the open record changes nothing.
    const reads = api.requests.length;
    await view.openEntity('person-tanaka');
    expect(api.requests.length).toBe(reads);
    // The host's back (its address is the list again) closes the record without reporting back.
    const reported = routes.length;
    view.closeEntity();
    expect(rail.children).toEqual([]);
    expect(routes.length).toBe(reported);
  });

  it('goes back to the list with Escape', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView();
    await view.openEntity('org-acme');
    root.dispatch('keydown', { key: 'Escape' });
    expect(rail.children).toEqual([]);
    expect(resultNames(root)).toHaveLength(8);
  });

  it('reports a record that does not exist without showing it as empty', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView();
    await view.openEntity('person-nobody');
    expect(collectText(rail)).toContain('この記録は見つかりません');
    expect(section(rail, 'つながり')).toBeUndefined();
  });

  it('draws nothing after the workspace when the host has no right rail', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    const view = createGraphRegistryView({ root, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false });
    await view.load();
    expect(root.children.map((node) => node.className)).toEqual(['bb-graph bb-gr']);
    await view.openEntity('person-tanaka');
    expect(root.children.map((node) => node.className)).toEqual(['bb-graph bb-gr']);
    expect(railHead(detailView(root))).toBe('人田中 太郎');
  });
});

describe('情報と関係: the list applies as it changes (D14)', () => {
  it('applies the name after typing pauses, never in the middle of a conversion, and Enter at once', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView({ searchDelayMs: 0 });
    const searches = () => api.requests.filter((request) => request.path.startsWith('/api/graph/search')).length;
    const before = searches();
    const q = control(root, 'q');
    q.dispatch('compositionstart');
    q.value = 'たなか';
    q.dispatch('input', { isComposing: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(searches()).toBe(before);
    q.value = 'Tanaka';
    q.dispatch('compositionend');
    await waitFor(() => resultNames(root).length === 1);
    expect(resultNames(root)).toEqual(['田中 太郎']);
    expect(api.requests.at(-1).path).toBe('/api/graph/search?q=Tanaka&limit=50');
    type(root, 'q', 'Acme');
    await waitFor(() => resultNames(root).join() === 'Acme');
  });

  it('lists the kinds as tabs with counts, people, companies and projects first', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    expect(typeOptions(root)).toEqual([['', 'すべて'], ['person', '人', '4'], ['org', '会社', '1'], ['project', 'プロジェクト', '2'], ['decision', '判断', '1']]);
    expect(api.requests.some((request) => request.path === '/api/graph/ontology')).toBe(true);
    chooseType(root, 'person');
    await waitFor(() => resultNames(root).length === 4);
    expect(typeTabs(root).find((tab) => tab.attributes['aria-selected'] === 'true').attributes['data-type']).toBe('person');
  });

  it('shows each condition as a chip that removes it, and すべて外す clears them all', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    expect(chips(root)).toEqual([]);
    chooseType(root, 'person');
    await waitFor(() => resultNames(root).length === 4);
    expect(chips(root)).toEqual(['「種類: 人」を外す']);
    type(root, 'q', 'tanaka');
    await searchForm(root).dispatch('submit');
    expect(chips(root)).toEqual(['「名前・別名: tanaka」を外す', '「種類: 人」を外す']);
    expect(resultNames(root)).toEqual(['田中 太郎']);

    findAll(root, (node) => node.attributes?.['aria-label'] === '「名前・別名: tanaka」を外す')[0].dispatch('click');
    await waitFor(() => resultNames(root).length === 4);
    expect(control(root, 'q').value).toBe('');
    expect(chips(root)).toEqual(['「種類: 人」を外す']);

    type(root, 'as_of', '2026-09-26');
    await waitFor(() => chips(root).length === 2);
    expect(chips(root)).toEqual(['「種類: 人」を外す', '「2026-09-26 の状態で見ています」を外す']);
    await buttonsNamed(root, 'すべて外す')[0].dispatch('click');
    await waitFor(() => resultNames(root).length === 8);
    expect(chips(root)).toEqual([]);
    expect(buttonsNamed(root, 'すべて外す')).toEqual([]);
  });

  it('keeps an earlier day under 詳しい条件 as 過去のある日の状態で見る', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    const advanced = () => findAll(root, (node) => node.tagName === 'DETAILS' && String(node.className).includes('bb-gr-advanced'))[0];
    expect(advanced().children[0].textContent).toBe('詳しい条件');
    expect(control(advanced(), 'as_of')).toBeDefined();
    expect(collectText(advanced())).toContain('過去のある日の状態で見る');
    expect(collectText(root)).not.toContain('有効時点');
    type(root, 'as_of', '2026-09-26');
    await waitFor(() => chips(root).length === 1);
    expect(advanced().attributes.open).toBe('');
  });

  it('keeps the last results on screen while a new search is read', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    let release;
    const fetcher = async (path, init) => {
      if (String(path).includes('/search') && String(path).includes('q=Acme')) await new Promise((resolve) => { release = resolve; });
      return api.fetcher(path, init);
    };
    const root = new FakeElement('div');
    const view = createGraphRegistryView({ root, rail: new FakeElement('div'), document: new FakeDocument(), fetcher, token: TOKEN, autoLoad: false });
    await view.load();
    type(root, 'q', 'Acme');
    const pending = searchForm(root).dispatch('submit');
    await waitFor(() => release);
    expect(resultNames(root)).toHaveLength(8);
    expect(section(root, '検索結果').attributes['aria-busy']).toBe('true');
    expect(collectText(section(root, '検索結果'))).toContain('新しい条件で探しています');
    release();
    await pending;
    expect(resultNames(root)).toEqual(['Acme']);
    expect(section(root, '検索結果').attributes['aria-busy']).toBe('false');
  });

  it('adds 最終更新 only when the host says when records changed', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const fetcher = async (path, init) => {
      const response = await api.fetcher(path, init);
      if (!String(path).includes('/search')) return response;
      const body = await response.json();
      body.results = body.results.map((entity, index) => (index === 0 ? { ...entity, updatedAt: '2026-10-01T09:00:00.000Z' } : entity));
      return jsonResponse(200, body);
    };
    const root = new FakeElement('div');
    const view = createGraphRegistryView({ root, rail: new FakeElement('div'), document: new FakeDocument(), fetcher, token: TOKEN, autoLoad: false });
    await view.load();
    const ledger = ledgerIn(section(root, '検索結果'), 'bb-ws-ledger');
    expect(findAll(ledger, (node) => node.attributes?.role === 'columnheader').map((node) => node.textContent)).toEqual(['名前', '種類', '説明', '最終更新']);
    const [first, second] = resultRows(root);
    expect(collectText(first)).toContain('2026-10-01');
    expect(collectText(second)).toContain('未確認');
  });
});

describe('情報と関係: corrections', () => {
  it('corrects aliases with the shown digest, and the next search finds the record by the new alias', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '何者か'));
    buttonsNamed(rail, 'この記録を直す')[0].dispatch('click');
    // The form opens under 直す.
    expect(section(section(rail, '直す'), 'この記録を直す')).toBeDefined();
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
    await waitFor(() => visibleText(section(rail, '何者か')).includes('別名Tanaka、タナカ'));

    buttonsNamed(rail, '← 情報と関係の一覧に戻る')[0].dispatch('click');
    type(root, 'q', 'タナカ');
    await searchForm(root).dispatch('submit');
    expect(resultNames(root)).toEqual(['田中 太郎']);
  });

  it('ends a relation with an end date and keeps the draft with the current values on a conflict', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView();
    await view.openEntity('person-tanaka');
    buttonsNamed(relationItem(rail, '直す', 'Acme'), 'この関係を直す')[0].dispatch('click');
    // The form opens inside that relation, under 直す.
    expect(section(relationItem(rail, '直す', 'Acme'), '関係を直す')).toBeDefined();
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
    await waitFor(() => visibleText(relationItem(rail, 'つながり', 'Acme')).includes('2026-09-01 に終了'));
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
    await waitFor(() => relationItem(rail, 'つながり', 'Acme'));
    expect(visibleText(relationItem(rail, 'つながり', 'Acme'))).toContain('Acmeに所属');
    expect(collectText(relationItem(rail, '根拠と履歴', 'Acme'))).toContain('利用者が承認');
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
  async function mountPartial({ missingOntologyMetadata = false, omitOntologyFreshness = false, ontologyUpToDate } = {}) {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const fetcher = async (url, init) => {
      const response = await api.fetcher(url, init);
      const path = String(url);
      if (!path.includes('/ontology') && !path.includes('/search')) return response;
      const payload = await response.json();
      if (path.includes('/ontology')) {
        if (missingOntologyMetadata) {
          delete payload.ontology.id;
          delete payload.ontology.version;
          delete payload.ontology.currentVersion;
          delete payload.ontology.releaseDigest;
        }
        if (omitOntologyFreshness) delete payload.ontology.upToDate;
        if (ontologyUpToDate !== undefined) payload.ontology.upToDate = ontologyUpToDate;
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

  it('labels missing ontology metadata as unconfirmed instead of rendering undefined', async () => {
    const root = await mountPartial({ missingOntologyMetadata: true });
    const panel = section(root, '情報の種類とつながり方');
    const text = collectText(panel);
    expect(text).toContain('定義の版 未確認（最新性は未確認）');
    expect(text).toContain('定義ID未確認');
    expect(text).toContain('release digest未確認');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('does not infer latestness from a version when the host omits its freshness flag', async () => {
    const root = await mountPartial({ omitOntologyFreshness: true });
    const text = collectText(section(root, '情報の種類とつながり方'));
    expect(text).toContain('最新性は未確認');
    expect(text).not.toContain('（最新）');
  });

  it('labels a version as latest only when the host explicitly confirms it', async () => {
    const root = await mountPartial({ ontologyUpToDate: true });
    const text = collectText(section(root, '情報の種類とつながり方'));
    expect(text).toContain('（最新）');
    expect(text).not.toContain('最新性は未確認');
  });
});

describe('情報と関係: host extensions', () => {
  const CORRECTION_BUTTONS = ['この記録を直す', '関係を加える', 'この関係を直す'];
  const correctionButtons = (node) => findAll(node, (item) => item.tagName === 'BUTTON' && CORRECTION_BUTTONS.includes(item.textContent));

  async function mountWith(options) {
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    const view = createGraphRegistryView({ root, rail: new FakeElement('div'), page: PAGE, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false, ...options });
    await view.load();
    return { root, rail: detailView(root), view };
  }

  it('says the screen only checks when the host cannot correct, and uses the host guidance for an empty Graph', async () => {
    await writeGraphV2(dataDir, { entities: [], edges: [] });
    const { root } = await mountWith({ canCorrect: false, emptyNotice: { text: '組織のGraphにはまだ記録がありません。' } });
    const text = collectText(root);
    expect(text).toContain('Graphに何がどう登録されているかを確かめます。');
    expect(text).not.toContain('誤りを直します');
    const results = collectText(section(root, '検索結果'));
    expect(results).toContain('未登録');
    expect(results).toContain('組織のGraphにはまだ記録がありません。');
    expect(results).not.toContain('brainbase onboard');
  });

  it('draws no correction control and never posts when the host cannot correct', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountWith({ canCorrect: false });
    // What this screen can correct is not listed either; the kinds stay.
    const kinds = collectText(section(root, '情報の種類とつながり方'));
    expect(kinds).not.toContain('この画面で直せること');
    expect(kinds).toContain('人物Graphに登録された人4件');
    await view.openEntity('person-tanaka');
    expect(section(rail, 'つながり')).toBeDefined();
    // Without a host note there is nothing to say under 直す, so the part is not drawn.
    expect(section(rail, '直す')).toBeUndefined();
    expect(correctionButtons(rail)).toEqual([]);
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

  it('shows the host note in the open record only when the host passes one, and replaces the 出典 notice', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountWith({
      canCorrect: false,
      readOnlyNote: 'この画面からは直せません。',
      sourceNotice: { label: '読み取り元', text: '別のGraphを表示だけしています。' },
    });
    // The host's 出典 notice is part of a record's 根拠と履歴, not of the list.
    expect(collectText(root)).not.toContain('別のGraphを表示だけしています。');
    await view.openEntity('org-acme');
    const [first] = byClass(section(rail, '根拠と履歴'), 'bb-ws-notice');
    expect(collectText(first)).toBe('読み取り元別のGraphを表示だけしています。');
    expect(collectText(rail)).not.toContain('このMacのGraph');
    expect(collectText(rail)).not.toContain('MCPの search');
    expect(byClass(section(rail, '直す'), 'bb-ws-notice').map((node) => collectText(node))).toEqual(['この画面からは直せません。']);
    // The default keeps the 出典 notice and the buttons.
    await api.close();
    const plain = await mountView();
    await plain.view.openEntity('org-acme');
    expect(collectText(byClass(section(plain.rail, '根拠と履歴'), 'bb-ws-notice')[0])).toContain('このMacのGraph');
    expect(buttonsNamed(plain.rail, 'この記録を直す')).toHaveLength(1);
    expect(collectText(plain.rail)).not.toContain('この画面からは直せません。');
  });

  const PROJECT_ONLY = { entityTypes: ['project'], fields: ['name', 'aliases', 'summary', 'validFrom', 'validTo', 'goal'], edges: false, createEdges: false };
  const SCOPE_NOTE = '人物と関係の訂正は、この画面ではまだできません。';

  it('draws only the corrections the host scope allows and shows the host note where the others would be', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountWith({ correctionScope: PROJECT_ONLY, readOnlyNote: SCOPE_NOTE });
    expect(collectText(root)).toContain('誤りを直します');

    // A person: nothing can be corrected here, and the note says why.
    await view.openEntity('person-tanaka');
    expect(section(rail, 'つながり')).toBeDefined();
    expect(correctionButtons(rail)).toEqual([]);
    expect(byClass(section(rail, '直す'), 'bb-ws-notice').map((node) => collectText(node))).toEqual([SCOPE_NOTE]);

    // A project: only the record itself, with the fields in the scope.
    await view.openEntity('project-atlas');
    expect(correctionButtons(rail).map((node) => node.textContent)).toEqual(['この記録を直す']);
    expect(byClass(section(rail, '直す'), 'bb-ws-notice').map((node) => collectText(node))).toEqual([SCOPE_NOTE]);
    buttonsNamed(rail, 'この記録を直す')[0].dispatch('click');
    expect(['name', 'aliases', 'summary', 'validFrom', 'validTo', 'goal', 'status'].filter((name) => control(rail, name))).toEqual(
      ['name', 'aliases', 'summary', 'validFrom', 'validTo', 'goal'],
    );
    type(rail, 'aliases', 'Atlas');
    type(rail, 'reason', '略称を別名に加える。');
    await submit(rail);
    const [post] = api.posts();
    expect(post.body).toEqual({
      kind: 'update_entity',
      entityId: 'project-atlas',
      expectedDigest: graphRecordDigest(ENTITIES.atlas),
      reason: '略称を別名に加える。',
      changes: { aliases: ['Atlas'] },
    });
    await waitFor(() => visibleText(section(rail, '何者か')).includes('別名Atlas'));
  });

  it('refuses a correction outside the host scope before sending it', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountWith({ correctionScope: PROJECT_ONLY, readOnlyNote: SCOPE_NOTE });
    await view.openEntity('person-tanaka');
    const { entity, outgoing } = view.state.detail.payload;
    expect(view.correction.openEntity(entity)).toBeNull();
    expect(view.correction.openCreate(entity)).toBeNull();
    expect(view.correction.openEdge(outgoing[0], { mode: 'edit' })).toBeNull();
    expect(view.correction.form).toBeNull();
    expect(correctionButtons(rail)).toEqual([]);
    expect(api.posts()).toEqual([]);
  });

  it('takes the kind tabs from the ontology answer and never names a kind it has no plain name for', async () => {
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
    const rail = detailView(root);
    let ontologyReady = false;
    const view = createGraphRegistryView({
      root,
      rail: new FakeElement('div'),
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
    // Until the kinds are read, the local four are offered, without counts.
    expect(typeOptions(root)).toEqual([['', 'すべて'], ['person', '人'], ['org', '会社'], ['project', 'プロジェクト'], ['decision', '判断']]);
    ontologyReady = true;
    await view.loadOntology();
    // Only kinds with a plain name become tabs; the others are under すべて.
    expect(typeOptions(root)).toEqual([['', 'すべて'], ['person', '人', '1']]);

    const typeCells = resultRows(root).map((row) => collectText(row.children[1]));
    expect(typeCells).toEqual(['人', 'その他の記録', 'その他の記録']);
    const kinds = collectText(ledgerIn(section(root, '情報の種類とつながり方'), 'bb-graph-entity-type-ledger'));
    // A local kind keeps its plain meaning; another kind shows the host's.
    expect(kinds).toContain('人物Graphに登録された人1件');
    expect(kinds).toContain('task仕事の単位1件');
    expect(kinds).toContain('constructor1件');
    expect(collectText(ledgerIn(section(root, '情報の種類とつながり方'), 'bb-graph-relation-type-ledger'))).toContain('assigned_totask → 人物担当している');

    await view.openEntity('task-1');
    expect(railHead(rail)).toBe('その他の記録見積もり');
    expect(visibleText(rail)).not.toContain('task');
    expect(collectText(section(rail, 'つながり'))).toContain('この記録とつながる記録はありません。');
    const text = `${collectText(root)}${collectText(rail)}`;
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('function');
  });
});
