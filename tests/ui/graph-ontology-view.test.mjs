import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGraphOntologyView, GRAPH_ONTOLOGY_TITLE, normalizeOntology } from '../../ui/graph-ontology-view.js';
import { GRAPH_RELATION_LABELS, groupRelationKinds, relationLabel, typeLabel } from '../../ui/graph-view-shared.js';
import { writeGraphV1, writeGraphV2 } from '../graph-web-fixture.js';
import {
  collectText,
  FakeDocument,
  FakeElement,
  findAll,
  jsonResponse,
  startGraphApi,
  visibleText,
} from './graph-ui-harness.mjs';

/*
 * 情報の種類とつながり方 (ledger D14): the Graph's definitions, under the host's
 * settings and apart from 情報と関係.  Every relation has a plain Japanese name,
 * relations that mean the same are one row, and a count is shown only when the
 * host counted it.
 */

let directory;
let dataDir;
let api;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-graph-ontology-ui-'));
  dataDir = join(directory, 'personal-os');
  api = null;
});

afterEach(async () => {
  await api?.close();
  await rm(directory, { recursive: true, force: true });
});

const PAGE = { crumbs: ['あなたのBrainbase', '設定', GRAPH_ONTOLOGY_TITLE], source: '手元のGraph' };
const byClass = (node, className) => findAll(node, (item) => String(item.className).split(' ').includes(className));
const ledger = (root, className) => byClass(root, className)[0];
const headers = (node) => findAll(node, (item) => item.attributes?.role === 'columnheader').map((item) => item.textContent);
const rows = (node) => findAll(node, (item) => String(item.className).includes('bb-ws-ledger-row') && !String(item.className).includes('bb-ws-ledger-head'));

async function mountLocal(options = {}) {
  api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const view = createGraphOntologyView({ root, page: PAGE, document: new FakeDocument(), fetcher: api.fetcher, autoLoad: false, ...options });
  await view.load();
  return { root, view };
}

async function mountAnswer(answer, options = {}) {
  const root = new FakeElement('div');
  const view = createGraphOntologyView({ root, document: new FakeDocument(), fetcher: async () => jsonResponse(200, answer), autoLoad: false, ...options });
  await view.load();
  return { root, view };
}

/** An organization Graph's answer: its own kinds and relations, relation counts not counted. */
function organizationAnswer({ typeCounts = true } = {}) {
  const relation = (id, from, to, meaning) => ({ id, from: from.join('・'), to: to.join('・'), fromTypes: from, toTypes: to, meaning, count: null, activeCount: null, countStatus: 'unknown' });
  return {
    status: 'ok',
    ontology: { id: null, version: '2.0.0', releaseDigest: 'sha256:release', currentVersion: '2.0.0', upToDate: true },
    entityTypes: [
      { id: 'org', meaning: '法的または運営上の組織', ...(typeCounts ? { count: 12, countStatus: 'exact' } : { count: null, countStatus: 'unknown' }) },
      { id: 'app', meaning: '利用者が操作するソフトウェア', ...(typeCounts ? { count: 30, countStatus: 'exact' } : { count: null, countStatus: 'unknown' }) },
      { id: 'brand', meaning: '市場で識別される約束と表現体系', ...(typeCounts ? { count: null, countStatus: 'at_least', atLeast: 500 } : { count: null, countStatus: 'unknown' }) },
    ],
    relations: [
      relation('owns', ['org'], ['app', 'product', 'brand', 'project'], '所有・運営責任を持つ'),
      relation('owned_by', ['app', 'project'], ['org', 'person'], '責任主体'),
      relation('member_of', ['person'], ['org', 'project'], '所属'),
      relation('belongs_to', ['app', 'decision'], ['org', 'project'], '包含先'),
      relation('depends_on', ['app'], ['app'], '稼働や成果の依存'),
      relation('a_new_relation', ['app'], ['org'], '新しいつながり'),
    ],
    counts: { entityTypes: 'exact', relations: 'unknown' },
  };
}

describe('情報の種類とつながり方', () => {
  it('draws the local definitions with plain names, meanings and counts, read-only and apart from the records', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountLocal({ canCorrect: true });
    expect(findAll(root, (node) => node.tagName === 'H1')[0].textContent).toBe(GRAPH_ONTOLOGY_TITLE);
    expect(collectText(byClass(root, 'bb-ws-breadcrumb')[0])).toBe('あなたのBrainbase/設定/情報の種類とつながり方');
    const text = visibleText(root);
    expect(text).toContain('記録そのものは「情報と関係」で見ます');
    expect(text).toContain('定義の版');
    const kinds = ledger(root, 'bb-go-type-ledger');
    expect(headers(kinds)).toEqual(['種類', '意味', '件数']);
    expect(collectText(kinds)).toContain('人物Graphに登録された人4件');
    expect(collectText(kinds)).toContain('プロジェクト目的を持つ、区切りのある仕事2件');
    const relations = ledger(root, 'bb-go-relation-ledger');
    expect(headers(relations)).toEqual(['つながり', 'つながる種類', '意味', '件数']);
    const relationText = collectText(relations);
    expect(relationText).toContain('参加人物 → プロジェクト（に参加）人物がプロジェクトに参加している2件（うち有効 1件）');
    expect(relationText).toContain('所有プロジェクト → 組織（が所有）');
    expect(text).toContain('新しく加えられる関係: 参加・責任・所属');
    expect(text).toContain('（最新）');
    // Read-only: no change proposal, no button or form.
    expect(findAll(root, (node) => node.tagName === 'BUTTON' || node.tagName === 'FORM')).toEqual([]);
    expect(text).not.toContain('提案');
    // Relation ids are only in the details.
    for (const id of ['participates_in', 'owned_by', 'member_of']) expect(text, id).not.toContain(id);
    expect(collectText(root)).toContain('participates_in');
  });

  it('names every relation in Japanese and merges relations that mean the same into one row', async () => {
    const { root } = await mountAnswer(organizationAnswer());
    const relations = ledger(root, 'bb-go-relation-ledger');
    const firstCells = rows(relations).map((row) => row.children[0].textContent);
    // 所有 = owns + owned_by, 所属 = member_of + belongs_to; an unknown relation uses its meaning, not its id.
    expect(firstCells).toEqual(['所有', '所属', '依存', '新しいつながり']);
    const owning = rows(relations)[0];
    expect(collectText(owning.children[1])).toBe('組織 → アプリ・プロダクト・ブランド・プロジェクト（を所有）アプリ・プロジェクト → 組織・人物（が所有）');
    const visible = visibleText(root);
    for (const id of ['owns', 'owned_by', 'belongs', 'member_of', 'depends_on', 'a_new_relation']) expect(visible, id).not.toContain(id);
    expect(collectText(root)).toContain('owns・owned_by');
    expect(collectText(root)).toContain('つながりのID');
    // Kinds are named in Japanese too.
    expect(collectText(ledger(root, 'bb-go-type-ledger'))).toContain('アプリ利用者が操作するソフトウェア30件');
    expect(collectText(ledger(root, 'bb-go-type-ledger'))).toContain('ブランド市場で識別される約束と表現体系500件以上');
  });

  it('draws no count column for relations the host did not count, and says so once', async () => {
    const { root } = await mountAnswer(organizationAnswer());
    const relations = ledger(root, 'bb-go-relation-ledger');
    expect(headers(relations)).toEqual(['つながり', 'つながる種類', '意味']);
    expect(relations.className).not.toContain('is-counted');
    const text = visibleText(root);
    expect(text.match(/つながりの件数を数えていません/gu)).toHaveLength(1);
    expect(text).not.toContain('件数は未確認');
    expect(text).not.toContain('null');
    expect(text).not.toMatch(/(^|[^0-9])0件/u);
  });

  it('draws no count column for kinds when nothing was counted, and marks only an unfinished count when some were', async () => {
    const { root } = await mountAnswer(organizationAnswer({ typeCounts: false }));
    expect(headers(ledger(root, 'bb-go-type-ledger'))).toEqual(['種類', '意味']);
    expect(visibleText(root)).toContain('種類ごとの件数を数えていません');

    const partial = organizationAnswer();
    partial.entityTypes[1] = { ...partial.entityTypes[1], count: null, countStatus: 'unknown' };
    const mixed = await mountAnswer(partial);
    const kinds = collectText(ledger(mixed.root, 'bb-go-type-ledger'));
    expect(kinds).toContain('組織Graphに登録された組織12件');
    expect(kinds).toContain('アプリ利用者が操作するソフトウェア未確認');
  });

  it('shows Graph v1 as a migration and a failed read with a retry, never as an empty ledger', async () => {
    await writeGraphV1(dataDir);
    const { root } = await mountLocal();
    const text = visibleText(root);
    expect(text).toContain('Graphの移行が必要です');
    expect(byClass(root, 'bb-ws-ledger')).toEqual([]);

    const failed = new FakeElement('div');
    const view = createGraphOntologyView({ root: failed, document: new FakeDocument(), fetcher: async () => jsonResponse(500, { error: { code: 'boom', message: '読めません' } }), autoLoad: false });
    await view.load();
    expect(visibleText(failed)).toContain('0件ではありません');
    expect(findAll(failed, (node) => node.tagName === 'BUTTON' && node.textContent === '再試行')).toHaveLength(1);
  });

  it('labels missing metadata as unconfirmed and latestness only when the host confirms it', async () => {
    const answer = organizationAnswer();
    answer.ontology = {};
    const missing = visibleText((await mountAnswer(answer)).root);
    expect(missing).toContain('定義の版 未確認（最新性は未確認）');
    expect(collectText((await mountAnswer(answer)).root)).toContain('release digest未確認');
    const stale = organizationAnswer();
    stale.ontology = { version: '1.4.0', currentVersion: '2.0.0', upToDate: false };
    expect(visibleText((await mountAnswer(stale)).root)).toContain('最新ではありません。最新は 2.0.0');
    const unflagged = organizationAnswer();
    delete unflagged.ontology.upToDate;
    expect(visibleText((await mountAnswer(unflagged)).root)).toContain('最新性は未確認');
  });

  it('writes kinds that read the same only once in a merged row', async () => {
    const answer = organizationAnswer();
    answer.relations.push(
      { id: 'has_project', from: 'project', to: 'project', meaning: '親projectが子projectを含む', count: null, activeCount: null, countStatus: 'unknown' },
      { id: 'has_engagement', from: 'project', to: 'project', meaning: 'projectがengagement projectを含む', count: null, activeCount: null, countStatus: 'unknown' },
    );
    const { root } = await mountAnswer(answer);
    const row = rows(ledger(root, 'bb-go-relation-ledger')).find((item) => item.children[0].textContent === '含む');
    expect(findAll(row.children[1], (node) => node.tagName === 'LI').map((node) => node.textContent)).toEqual(['プロジェクト → プロジェクト（を含む）']);
  });

  it('refuses a malformed answer', () => {
    expect(normalizeOntology({ state: 'ok', payload: { entityTypes: [], relations: [{ id: 'x' }], ontology: {} } }).state).toBe('invalid');
    expect(normalizeOntology({ state: 'ok', payload: organizationAnswer() }).state).toBe('ok');
  });
});

describe('relation and kind names', () => {
  it('names every relation and kind of an organization Graph in Japanese', () => {
    // The relation ids of the organization ontology release 2.0.0.
    const relations = ['owns', 'owned_by', 'belongs_to', 'belongs_to_project', 'governs', 'supersedes', 'derived_from', 'accountable_for', 'depends_on', 'member_of', 'assigned_to', 'requested_by', 'made_by', 'references', 'alias_of', 'applies_to', 'brand_of', 'covers_engagement', 'describes', 'describes_org', 'evidenced_by', 'governed_by', 'has_diagnosis', 'has_engagement', 'has_environment', 'has_initiative', 'has_project', 'has_push_case', 'has_raci', 'hosted_on', 'key_contact_for', 'mentions', 'operated_by', 'org_unit_of', 'owns_app', 'primary_contact_for', 'relates_to_project', 'role_at', 'serves_customer', 'should_use_secret_store', 'sub_brand_of', 'supports_project', 'uses_app', 'uses_database', 'uses_secret_store', 'appeared_in', 'authored', 'created', 'holds_role', 'informs', 'mentioned_in', 'operates', 'related_to', 'spoke_at', 'superseded_by'];
    expect(relations).toHaveLength(55);
    for (const id of relations) {
      expect(GRAPH_RELATION_LABELS[id], id).toBeDefined();
      expect(relationLabel(id), id).toMatch(/^[^a-z_]+$/u);
    }
    const kinds = ['org', 'person', 'app', 'product', 'brand', 'project', 'customer', 'partner', 'decision', 'raci', 'raci_assignment', 'glossary_term', 'document', 'contact', 'frame', 'story', 'infrastructure_environment', 'speaking', 'media_appearance', 'role_assignment', 'publication', 'press_mention', 'initiative', 'ai_query', 'ai_decision', 'philosophy', 'capital', 'contract', 'database', 'database_cluster', 'diagnosis', 'finance', 'finance_account', 'org_alias', 'organization', 'person_alias', 'push_case', 'objective', 'variable', 'model', 'constraint'];
    expect(kinds).toHaveLength(41);
    for (const id of kinds) expect(typeLabel(id), id).not.toBe(id);
  });

  it('groups by plain name, keeps each kind, and falls back to the meaning before the id', () => {
    const grouped = groupRelationKinds([
      { id: 'owns', from: 'org', to: 'app' },
      { id: 'member_of', from: 'person', to: 'org' },
      { id: 'owned_by', from: 'project', to: 'org' },
      { id: 'mystery', from: 'app', to: 'app', meaning: '謎のつながり' },
      { id: 'bare', from: 'app', to: 'app' },
    ]);
    expect(grouped.map((row) => [row.label, row.kinds.map((item) => item.id)])).toEqual([
      ['所有', ['owns', 'owned_by']],
      ['所属', ['member_of']],
      ['謎のつながり', ['mystery']],
      ['bare', ['bare']],
    ]);
  });
});
