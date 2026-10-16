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
 * The open record, wherever it hangs (below its row, or above the results):
 * a live view so a test can keep one handle while the screen redraws.
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
const railHead = (rail) => collectText(byClass(rail, 'bb-ws-rail-head')[0]);
const DETAIL = '選んだ記録の詳細・';
const ledgerIn = (node, className) => byClass(node, className)[0];

/** The type filter is the shared searchable dropdown: open it and read or pick an option. */
function typeBox(root) {
  return findAll(root, (node) => node.attributes?.id === 'bb-gr-type')[0];
}
function typeOptions(root) {
  const trigger = typeBox(root);
  trigger.dispatch('click');
  const options = findAll(trigger.parentNode, (node) => node.attributes?.role === 'option')
    .map((node) => [node.attributes['data-value'], node.children[0].textContent]);
  trigger.dispatch('click');
  return options;
}
function chooseType(root, value) {
  const trigger = typeBox(root);
  trigger.dispatch('click');
  const option = findAll(trigger.parentNode, (node) => node.attributes?.role === 'option' && node.attributes['data-value'] === value)[0];
  if (!option) throw new Error(`no type option ${value}`);
  return option.dispatch('click');
}
const chips = (root) => findAll(root, (node) => node.tagName === 'BUTTON' && String(node.className).includes('bb-gr-filter-chip')).map((node) => node.attributes['aria-label']);

function searchForm(root) {
  return findAll(root, (node) => node.tagName === 'FORM' && node.className.includes('bb-gr-search'))[0];
}

function relationItem(rail, label, name) {
  return findAll(section(rail, label), (node) => node.tagName === 'LI' && collectText(node).includes(name))[0];
}

describe('情報と関係: workspace', () => {
  it('follows the organization screen pattern and lists every record in a ledger when the query is empty', async () => {
    await writeGraphV2(dataDir);
    const { root, hostRail } = await mountView();
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
    // A record without a summary says so, rather than leaving the cell empty.
    expect(collectText(resultRow(root, 'org-acme'))).toBe('Acmeorg-acme組織要約は未登録期限なし');
    // Nothing is selected until the owner picks a row.
    expect(resultRows(root).some((row) => row.className.includes('is-selected'))).toBe(false);
    expect(collectText(hostRail)).toContain('記録を選択');
    expect(collectText(hostRail)).toContain('その行のすぐ下に');
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

describe('情報と関係: the record below its row', () => {
  it('shows the correction entry and save/readback flow before editing', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '概要'));

    const guidance = visibleText(section(rail, '訂正の流れ'));
    expect(guidance).toContain('訂正入口');
    expect(guidance).toContain('変更案を入力します');
    expect(guidance).toContain('この記録を直す');
    expect(guidance).toContain('関係を加える');
    expect(guidance).toContain('この関係を直す');
    expect(guidance).toContain('承認待ちの提出ではなく');
    expect(guidance).toContain('その場でGraphに反映され');
    expect(guidance).toContain('理由と変更前後が履歴に残ります');
    expect(guidance).toContain('保存後に読み直して一致を確かめ');
    expect(guidance).toContain('次のMCPの search・get_context・resolve_entity で使われます');
    expect(buttonsNamed(rail, 'この記録を直す')).toHaveLength(1);
    expect(buttonsNamed(rail, 'この関係を直す').length).toBeGreaterThan(0);
    expect(findAll(rail, (node) => node.tagName === 'FORM' && node.className.includes('bb-graph-form') && !node.className.includes('bb-gr-search'))).toHaveLength(0);
  });

  it('opens the selected row in the rail with its names, validity and both directions of relations with meaning, role and source', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '概要'));
    expect(railHead(rail)).toBe(`${DETAIL}人物田中 太郎person-tanaka`);
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
    // The ids sit in a disclosure that says whose ids they are.
    const summaries = findAll(rail, (node) => node.tagName === 'SUMMARY').map((node) => node.textContent);
    expect(summaries).toContain('この記録のID（技術情報）');
    expect(summaries).toContain('この関係のID（技術情報）');
    expect(summaries).not.toContain('記録の詳細');
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

    const outgoing = section(rail, '出る関係');
    expect(collectText(outgoing)).toContain('未確認');
    expect(collectText(outgoing)).toContain('関係者の記録元を確認できません。');
    expect(collectText(outgoing)).toContain('登録なしとは判断できません。');
    expect(collectText(outgoing)).not.toContain('この記録から出る関係はありません。');
    expect(buttonsNamed(outgoing, '再試行')).toHaveLength(1);
    expect(buttonsNamed(section(rail, '入る関係'), '再試行')).toHaveLength(1);

    buttonsNamed(outgoing, '再試行')[0].dispatch('click');
    await waitFor(() => detailReads === 2 && collectText(section(rail, '入る関係')).includes('田中 太郎が参加'));
    expect(collectText(section(rail, '出る関係'))).toContain('この記録から出る関係はありません。');
    expect(collectText(section(rail, '出る関係'))).not.toContain('登録なしとは判断できません。');
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

    for (const label of ['出る関係', '入る関係']) {
      const relation = section(rail, label);
      expect(collectText(relation)).toContain('未確認');
      expect(collectText(relation)).toContain('関係者の記録元を確認できません。');
      expect(collectText(relation)).toContain('登録なしとは判断できません。');
      expect(collectText(relation)).not.toContain(`この記録${label === '出る関係' ? 'から出る' : 'へ入る'}関係はありません。`);
      expect(buttonsNamed(relation, '再試行')).toHaveLength(1);
    }
  });

  it('moves the detail with the selected row', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => railHead(rail).includes('田中 太郎') && section(rail, '概要'));
    resultRow(root, 'org-acme').dispatch('click');
    await waitFor(() => railHead(rail).includes('Acme') && section(rail, '概要'));
    expect(railHead(rail)).toBe(`${DETAIL}組織Acmeorg-acme`);
    expect(collectText(section(rail, '入る関係'))).toContain('田中 太郎が所属');
    expect(resultRow(root, 'org-acme').className).toContain('is-selected');
    expect(resultRow(root, 'person-tanaka').className).not.toContain('is-selected');
  });

  it('follows a relation to the other record, resolves local sources, and goes back', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView();
    await view.openEntity('person-tanaka');
    buttonsNamed(relationItem(rail, '出る関係', 'Atlas導入'), 'Atlas導入')[0].dispatch('click');
    await waitFor(() => railHead(rail) === `${DETAIL}プロジェクトAtlas導入project-atlas` && section(rail, '概要'));
    // It opens in the same place, says where the trail began, and the row clicked stays marked.
    expect(collectText(rail)).toContain('「田中 太郎」の関係からたどっています。');
    const incoming = collectText(section(rail, '入る関係'));
    expect(incoming).toContain('佐藤 花子が責任を持つ');
    expect(incoming).toContain('田中 太郎が参加');
    expect(incoming).toContain('スコープが進め方を決める');
    expect(visibleText(relationItem(rail, '入る関係', '佐藤 花子'))).toContain('取り込み候補「佐藤 花子」（candidates/extracted-abc.json）');
    expect(visibleText(section(rail, '概要'))).toContain('目的導入を完了する');

    buttonsNamed(relationItem(rail, '入る関係', '佐藤 花子'), '佐藤 花子')[0].dispatch('click');
    await waitFor(() => visibleText(section(rail, '概要') ?? new FakeElement('div')).includes('進行管理'));
    expect(visibleText(relationItem(rail, '出る関係', 'Beta検証'))).toContain('オンボーディングの候補「佐藤 花子」（実行 run-1、承認済み、runs/connected-onboarding.json）');
    expect(resultRow(root, 'person-tanaka').className).toContain('is-selected');
    expect(resultRow(root, 'person-sato').className).not.toContain('is-selected');
    expect(railHead(rail)).toBe(`${DETAIL}人物佐藤 花子person-sato`);

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

  it('draws nothing after the workspace when the host has no right rail: the record opens below its row', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const root = new FakeElement('div');
    const view = createGraphRegistryView({ root, document: new FakeDocument(), fetcher: api.fetcher, token: TOKEN, autoLoad: false });
    await view.load();
    expect(root.children.map((node) => node.className)).toEqual(['bb-graph bb-gr']);
    await view.openEntity('person-tanaka');
    expect(root.children.map((node) => node.className)).toEqual(['bb-graph bb-gr']);
    expect(railHead(detailView(root))).toBe(`${DETAIL}人物田中 太郎person-tanaka`);
  });
});

describe('情報と関係: what a press or a filter did, where it happened (story-graph-registry-immediate-feedback-v1)', () => {
  const ledger = (root) => ledgerIn(section(root, '検索結果'), 'bb-graph-entity-ledger');

  it('opens the record right below the pressed row, headed by its name, and closes it from the row, 閉じる or the rail', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, hostRail } = await mountView();
    resultRow(root, 'person-tanaka').dispatch('click');
    await waitFor(() => section(rail, '概要'));
    // The detail is the ledger's next child after the pressed row, across every column.
    const children = ledger(root).children;
    const index = children.indexOf(resultRow(root, 'person-tanaka'));
    expect(children[index + 1].className).toBe('bb-ws-ledger-detail');
    expect(children[index + 1].children[0].children[0].attributes.id).toBe('bb-gr-detail');
    expect(resultRow(root, 'person-tanaka').attributes['aria-expanded']).toBe('true');
    expect(resultRow(root, 'person-tanaka').attributes['aria-controls']).toBe('bb-gr-detail');
    expect(resultRow(root, 'org-acme').attributes['aria-expanded']).toBe('false');
    expect(railHead(rail)).toBe(`${DETAIL}人物田中 太郎person-tanaka`);
    // The rail only says which record is open and where.
    expect(collectText(hostRail)).toContain('開いている記録');
    expect(collectText(hostRail)).toContain('田中 太郎');
    expect(collectText(hostRail)).toContain('この記録の行のすぐ下に開いています');
    expect(buttonsNamed(hostRail, '詳細へ移る')).toHaveLength(1);
    expect(section(hostRail, '出る関係')).toBeUndefined();

    // Pressing the open row again closes it.
    resultRow(root, 'person-tanaka').dispatch('click');
    expect(rail.children).toEqual([]);
    expect(resultRow(root, 'person-tanaka').className).not.toContain('is-selected');
    expect(collectText(hostRail)).toContain('記録を選択');

    resultRow(root, 'org-acme').dispatch('click');
    await waitFor(() => section(rail, '概要'));
    buttonsNamed(rail, '閉じる')[0].dispatch('click');
    expect(rail.children).toEqual([]);

    resultRow(root, 'org-acme').dispatch('click');
    await waitFor(() => section(rail, '概要'));
    buttonsNamed(hostRail, '閉じる')[0].dispatch('click');
    expect(rail.children).toEqual([]);
  });

  it('opens a record that is not among the results above them, and says a missing summary is not registered', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView();
    type(root, 'q', 'tanaka');
    await searchForm(root).dispatch('submit');
    await view.openEntity('org-acme');
    const results = section(root, '検索結果');
    expect(results.children.map((node) => node.attributes?.id ?? node.className)).toEqual(['bb-gr-caption', 'bb-gr-detail', 'bb-ws-ledger bb-graph-entity-ledger']);
    expect(visibleText(section(rail, '概要'))).toContain('要約要約は未登録');
  });

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
    // Plain typing applies by itself too.
    type(root, 'q', 'Acme');
    await waitFor(() => resultNames(root).join() === 'Acme');
  });

  it('applies the type at once, shows each condition as a chip that removes it, and すべて外す clears them all', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    expect(chips(root)).toEqual([]);
    chooseType(root, 'person');
    await waitFor(() => resultNames(root).length === 4);
    expect(chips(root)).toEqual(['「種類: 人物」を外す']);
    type(root, 'q', 'tanaka');
    await searchForm(root).dispatch('submit');
    expect(chips(root)).toEqual(['「名前・別名: tanaka」を外す', '「種類: 人物」を外す']);
    expect(resultNames(root)).toEqual(['田中 太郎']);

    findAll(root, (node) => node.attributes?.['aria-label'] === '「名前・別名: tanaka」を外す')[0].dispatch('click');
    await waitFor(() => resultNames(root).length === 4);
    expect(control(root, 'q').value).toBe('');
    expect(chips(root)).toEqual(['「種類: 人物」を外す']);

    type(root, 'as_of', '2026-09-26');
    await waitFor(() => chips(root).length === 2);
    expect(chips(root)).toEqual(['「種類: 人物」を外す', '「2026-09-26 の時点で有効なもの」を外す']);
    await buttonsNamed(root, 'すべて外す')[0].dispatch('click');
    await waitFor(() => resultNames(root).length === 8);
    expect(chips(root)).toEqual([]);
    expect(buttonsNamed(root, 'すべて外す')).toEqual([]);
  });

  it('keeps the day filter under 詳しい条件 in plain words', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    const advanced = findAll(root, (node) => node.tagName === 'DETAILS' && String(node.className).includes('bb-gr-advanced'))[0];
    expect(advanced.children[0].textContent).toBe('詳しい条件');
    expect(control(advanced, 'as_of')).toBeDefined();
    expect(collectText(advanced)).toContain('この日に有効だった記録だけ（空なら今日）');
    expect(collectText(root)).not.toContain('有効時点');
    // A day in force keeps it open.
    type(root, 'as_of', '2026-09-26');
    await waitFor(() => chips(root).length === 1);
    const reopened = findAll(root, (node) => node.tagName === 'DETAILS' && String(node.className).includes('bb-gr-advanced'))[0];
    expect(reopened.attributes.open).toBe('');
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
    // The record stays open because its row is among the new results.
    expect(railHead(rail)).toBe(`${DETAIL}人物田中 太郎person-tanaka`);
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
    await view.openEntity('person-tanaka');
    expect(section(rail, '出る関係')).toBeDefined();
    expect(section(rail, '訂正の流れ')).toBeUndefined();
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

  it('shows the host note in the open record only when the host passes one, and replaces the 出典 notice', async () => {
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

  const PROJECT_ONLY = { entityTypes: ['project'], fields: ['name', 'aliases', 'summary', 'validFrom', 'validTo', 'goal'], edges: false, createEdges: false };
  const SCOPE_NOTE = '人物と関係の訂正は、この画面ではまだできません。';

  it('draws only the corrections the host scope allows and shows the host note where the others would be', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountWith({ correctionScope: PROJECT_ONLY, readOnlyNote: SCOPE_NOTE });
    expect(collectText(root)).toContain('誤りを直します');

    // A person: nothing can be corrected here, and the note says why.
    await view.openEntity('person-tanaka');
    expect(section(rail, '出る関係')).toBeDefined();
    expect(correctionButtons(rail)).toEqual([]);
    expect(byClass(rail, 'bb-ws-notice').map((node) => collectText(node))).toEqual([SCOPE_NOTE]);

    // A project: only the record itself, with the fields in the scope.
    await view.openEntity('project-atlas');
    expect(correctionButtons(rail).map((node) => node.textContent)).toEqual(['この記録を直す']);
    expect(byClass(rail, 'bb-ws-notice').map((node) => collectText(node))).toEqual([SCOPE_NOTE]);
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
    await waitFor(() => visibleText(section(rail, '概要')).includes('別名Atlas'));
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
    expect(railHead(rail)).toBe(`${DETAIL}task見積もりtask-1`);
    expect(collectText(section(rail, '出る関係'))).toContain('このtaskが起点になっている関係です。');
    const text = `${collectText(root)}${collectText(rail)}`;
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('function');
  });
});
