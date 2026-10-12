import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalEdgeId } from '../../src/canonical-graph.js';
import {
  COMPANY_LEDGER_COLUMNS,
  createPeopleAndCompaniesView,
  groupPeople,
  normalizePeopleAndCompanies,
  PEOPLE_LEDGER_COLUMNS,
} from '../../ui/people-and-companies-view.js';
import { EDGES, ENTITIES, writeGraphV2 } from '../graph-web-fixture.js';
import { dayToRfc3339 } from '../../ui/graph-view-shared.js';
import {
  buttonsNamed,
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
  directory = await mkdtemp(join(tmpdir(), 'brainbase-people-companies-ui-'));
  dataDir = join(directory, 'personal-os');
  api = null;
});

afterEach(async () => {
  await api?.close();
  await rm(directory, { recursive: true, force: true });
});

const PAGE = { crumbs: ['あなたのBrainbase', '人と会社'], source: '手元のGraph' };
const link = (fromId, relation, toId) => ({ id: canonicalEdgeId({ fromId, relation, toId }), fromId, relation, toId });
const GLOBEX = { id: 'org-globex', type: 'org', name: 'Globex' };

async function mountView({ fetcher, ...options } = {}) {
  if (!fetcher) api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const rail = new FakeElement('div');
  const view = createPeopleAndCompaniesView({ root, rail, page: PAGE, document: new FakeDocument(), fetcher: fetcher ?? api.fetcher, autoLoad: false, now: () => new Date(2026, 8, 26, 12), ...options });
  await view.load();
  return { root, rail, view };
}

const ledgerNames = (node) => findAll(node, (item) => item.tagName === 'BUTTON' && String(item.className).includes('bb-ws-ledger-row'))
  .map((row) => row.children[0].children[0].textContent);
const ledgerByLabel = (root, label) => findAll(root, (node) => node.attributes?.['aria-label'] === label && node.attributes?.role === 'table')[0];

describe('人と会社', () => {
  it('splits people into internal, external by company and not yet known from memberships and the own company', async () => {
    await writeGraphV2(dataDir, {
      entities: [...Object.values(ENTITIES), GLOBEX],
      edges: [...Object.values(EDGES), link('self', 'member_of', 'org-globex'), link('person-sato', 'member_of', 'org-globex')],
    });
    const { root } = await mountView();
    const people = section(root, '人');
    expect(visibleText(people)).toContain('社内（Globex）');
    expect(ledgerNames(ledgerByLabel(root, '社内の人'))).toEqual(['Owner（あなた）', '佐藤 花子']);
    expect(ledgerNames(ledgerByLabel(root, 'Acmeの人'))).toEqual(['田中 太郎']);
    expect(ledgerNames(ledgerByLabel(root, '所属未確認の人'))).toEqual([]);
    expect(visibleText(people)).not.toContain('自社が未設定');
    // Companies: the own company first; the ended person is only counted.
    expect(ledgerNames(ledgerByLabel(root, '会社の一覧'))).toEqual(['Globex（自社）', 'Acme']);
    expect(visibleText(root)).toContain('終わった記録（人 1件、会社 0件）');
    expect(findAll(root, (node) => node.attributes?.role === 'columnheader').map((node) => node.textContent))
      .toEqual(expect.arrayContaining([...PEOPLE_LEDGER_COLUMNS, ...COMPANY_LEDGER_COLUMNS]));
  });

  it('says the own company is unset and puts everyone under not yet known instead of guessing', async () => {
    await writeGraphV2(dataDir);
    const { root } = await mountView();
    const people = section(root, '人');
    expect(visibleText(people)).toContain('自社が未設定');
    expect(visibleText(people)).toContain('あなた（本人）の所属する会社がGraphにありません。');
    expect(ledgerByLabel(root, '社内の人')).toBeUndefined();
    expect(ledgerNames(ledgerByLabel(root, '所属未確認の人'))).toEqual(['Owner（あなた）', '佐藤 花子', '田中 太郎']);
    // Tanaka still shows his company; only the internal / external split is withheld.
    expect(visibleText(ledgerByLabel(root, '所属未確認の人'))).toContain('Acme');
  });

  it('opens a person in the rail with memberships, projects, validity and provenance, and points to 情報と関係 for fixes', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView();
    await view.openEntity('person-tanaka');
    await waitFor(() => view.state.detail?.state === 'ok');
    const text = visibleText(rail);
    expect(text).toContain('田中 太郎');
    expect(text).toContain('所属未確認（自社が未設定）');
    expect(visibleText(section(rail, '所属'))).toContain('Acme');
    expect(visibleText(section(rail, '関わるプロジェクト'))).toContain('Atlas導入');
    expect(visibleText(section(rail, '関わるプロジェクト'))).toContain('出典: オンボーディング');
    const fix = findAll(rail, (node) => node.tagName === 'A')[0];
    expect(fix.attributes.href).toBe('#graph?entity_id=person-tanaka');
    // Read only unless the host says it can write: no write control anywhere.
    expect(findAll(root, (node) => ['INPUT', 'TEXTAREA', 'SELECT', 'FORM'].includes(node.tagName))).toEqual([]);
    for (const label of ['人を加える', '会社を加える', '所属を付ける', '所属を終える']) {
      expect(buttonsNamed(root, label)).toEqual([]);
      expect(buttonsNamed(rail, label)).toEqual([]);
    }
    // Even a form opened from code is refused before anything is sent.
    view.correction.openCreateEntity({ types: ['org'] });
    type(rail, 'name', 'Globex');
    type(rail, 'reason', '作る。');
    await submit(rail);
    expect(visibleText(rail)).toContain('このホストでは保存できません。');
    expect(api.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('opens a company with its members and owned projects', async () => {
    await writeGraphV2(dataDir, { entities: Object.values(ENTITIES), edges: [...Object.values(EDGES), link('project-atlas', 'owned_by', 'org-acme')] });
    const { rail, view } = await mountView();
    await view.openEntity('org-acme');
    await waitFor(() => view.state.detail?.state === 'ok');
    expect(visibleText(section(rail, '所属する人'))).toContain('田中 太郎');
    expect(visibleText(section(rail, 'この会社のプロジェクト'))).toContain('Atlas導入');
    expect(visibleText(section(rail, '顧客・協業先として関わるプロジェクト'))).toContain('記録はありません');
    // No kind, stage or deal is recorded for Acme, so none is shown.
    expect(visibleText(rail)).not.toContain('種類');
    expect(section(rail, '提案中の案件')).toBeUndefined();
  });

  it('lists companies with the kind from records and opens related projects with the role and the deals', async () => {
    await writeGraphV2(dataDir, {
      entities: [
        ...Object.values(ENTITIES),
        { ...GLOBEX, metadata: { orgType: 'customer' } },
        { id: 'org-initech', type: 'org', name: 'Initech', metadata: { lifecycle_stage: 'opportunity', deals: [{ name: 'PoCの提案', stage: '提案中' }] } },
        { id: 'org-plain', type: 'org', name: 'Plain社' },
      ],
      edges: [
        ...Object.values(EDGES),
        link('self', 'member_of', 'org-acme'),
        { ...link('org-globex', 'related_to', 'project-atlas'), role: 'customer', provenance: { sourceKind: 'user_approved' } },
      ],
    });
    const { root, rail, view } = await mountView();
    const companies = ledgerByLabel(root, '会社の一覧');
    expect(ledgerNames(companies)).toEqual(['Acme（自社）', 'Globex', 'Initech', 'Plain社']);
    const kindCells = findAll(companies, (node) => node.attributes?.role === 'row' && node.tagName === 'BUTTON').map((row) => row.children[1].textContent);
    expect(kindCells).toEqual(['', '顧客', '提案中', '']);
    expect(visibleText(companies)).toContain('0件（関わる 1件）');

    await view.openEntity('org-globex');
    await waitFor(() => view.state.detail?.state === 'ok');
    expect(visibleText(rail)).toContain('顧客（会社の属性・プロジェクトとの関係の役割から）');
    const related = visibleText(section(rail, '顧客・協業先として関わるプロジェクト'));
    expect(related).toContain('Atlas導入');
    expect(related).toContain('役割: 顧客');
    expect(visibleText(section(rail, 'この会社のプロジェクト'))).toContain('記録はありません');

    await view.openEntity('org-initech');
    await waitFor(() => view.state.detail?.state === 'ok');
    expect(visibleText(rail)).toContain('記録上の段階');
    expect(visibleText(rail)).toContain('opportunity');
    expect(visibleText(section(rail, '提案中の案件'))).toContain('PoCの提案');
    expect(visibleText(section(rail, '提案中の案件'))).toContain('段階: 提案中');
  });

  it('never shows a failed or malformed read as zero people', async () => {
    const failing = async () => jsonResponse(503, { error: { code: 'graph_unavailable', message: 'graph.json が読めません' } });
    const { root } = await mountView({ fetcher: failing });
    expect(visibleText(root)).toContain('読み取れませんでした');
    expect(visibleText(root)).toContain('0件ではありません');
    expect(section(root, '人')).toBeUndefined();

    expect(normalizePeopleAndCompanies({ state: 'ok', payload: { ownCompany: null, people: [], companies: [] } })).toMatchObject({ state: 'invalid' });
    // A company without the related projects, deals or kinds is malformed, not a company without them.
    const company = { id: 'org-a', type: 'org', name: 'A', aliases: [], summary: null, tags: [], validFrom: null, validTo: null, active: true, digest: 'd', memberIds: [], projectIds: [] };
    const own = { id: null, reason: 'owner_not_found', candidateIds: [] };
    expect(normalizePeopleAndCompanies({ state: 'ok', payload: { ownCompany: own, people: [], companies: [company] } })).toMatchObject({ state: 'invalid' });
    expect(normalizePeopleAndCompanies({ state: 'ok', payload: { ownCompany: own, people: [], companies: [{ ...company, relatedProjects: [], orgType: null, lifecycleStage: null, deals: [], kinds: [] }] } }))
      .toMatchObject({ state: 'ok' });
    expect(normalizePeopleAndCompanies({ state: 'ok', payload: { ownCompany: { id: null, reason: 'owner_not_found', candidateIds: [] }, people: [], companies: [] } }))
      .toEqual({ state: 'unknown' });
  });

  it('groups by the first known company and leaves people without a company as not yet known', () => {
    const person = (id, companyIds) => ({ id, name: id, active: true, companyIds });
    const groups = groupPeople({
      ownCompany: { id: 'org-own' },
      companies: [{ id: 'org-own', name: '自社' }, { id: 'org-b', name: 'B' }, { id: 'org-a', name: 'A' }],
      people: [person('p1', ['org-own']), person('p2', ['org-b']), person('p3', ['org-a', 'org-b']), person('p4', []), { ...person('p5', ['org-own']), active: false }],
    });
    expect(groups.internal.map((item) => item.id)).toEqual(['p1']);
    expect(groups.external.map((group) => [group.company.id, group.people.map((item) => item.id)])).toEqual([['org-a', ['p3']], ['org-b', ['p2']]]);
    expect(groups.unknown.map((item) => item.id)).toEqual(['p4']);
  });
});

describe('人と会社: writing (情報契約S3)', () => {
  const writable = { canCorrect: true, token: TOKEN };
  const company = (root, name) => findAll(ledgerByLabel(root, '会社の一覧'), (node) => node.tagName === 'BUTTON' && visibleText(node).startsWith(name))[0];

  it('creates a company from the screen, reads it back and opens it, with the reason sent to the host', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView(writable);
    expect(buttonsNamed(root, '人を加える')).toHaveLength(1);
    buttonsNamed(root, '会社を加える')[0].dispatch('click');
    expect(visibleText(section(rail, '会社を加える'))).toContain('Graphに会社の記録を作ります。');
    // Only the kind the button names is offered.
    expect(control(rail, 'type')).toBeUndefined();
    type(rail, 'name', 'Globex');
    type(rail, 'aliases', 'グローベックス');
    type(rail, 'reason', '新しい取引先として記録する。');
    await submit(rail);
    const post = api.posts()[0];
    expect(post.body).toEqual({ kind: 'create_entity', reason: '新しい取引先として記録する。', entity: { type: 'org', name: 'Globex', aliases: ['グローベックス'] } });
    expect(post.headers['X-Brainbase-Review-Token']).toBe(TOKEN);
    await waitFor(() => company(root, 'Globex') && view.state.detail?.state === 'ok' && view.state.detail.payload.entity.name === 'Globex');
    const saved = visibleText(section(rail, '会社を加える'));
    expect(saved).toContain('保存しました。保存後に読み直し');
    expect(saved).toContain('種類会社');
    expect(saved).toContain('名前Globex');
    expect(visibleText(rail)).toContain('所属する人');
  });

  it('refuses a second company with the same name and shows the existing record', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView(writable);
    buttonsNamed(root, '会社を加える')[0].dispatch('click');
    type(rail, 'name', 'acme');
    type(rail, 'reason', '作る。');
    await submit(rail);
    const text = visibleText(section(rail, '会社を加える'));
    expect(text).toContain('同じ名前の記録がすでにあるため、作りませんでした。');
    expect(text).toContain('Acme');
    expect(text).not.toContain('保存しました');
  });

  it('adds a membership to a person, then ends it with an end date instead of deleting it', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView(writable);
    await view.openEntity('person-sato');
    await waitFor(() => view.state.detail?.state === 'ok');
    buttonsNamed(rail, '所属を付ける')[0].dispatch('click');
    await waitFor(() => findAll(control(rail, 'counterpartId'), (node) => node.tagName === 'OPTION').some((node) => node.textContent === 'Acme'));
    expect(findAll(control(rail, 'relation'), (node) => node.tagName === 'OPTION').map((node) => node.attributes.value)).toEqual(['member_of']);
    expect(api.requests.some((request) => request.path === '/api/graph/search?type=org&limit=100')).toBe(true);
    type(rail, 'counterpartId', 'org-acme');
    type(rail, 'reason', 'Acmeの社員だと確かめた。');
    await submit(rail);
    expect(api.posts()[0].body).toEqual({ kind: 'create_edge', reason: 'Acmeの社員だと確かめた。', edge: { fromId: 'person-sato', relation: 'member_of', toId: 'org-acme' } });
    // Read back from the host: the ledger and the rail show the new membership.
    await waitFor(() => visibleText(section(rail, '所属')).includes('Acme')
      && view.state.list.payload.people.find((person) => person.id === 'person-sato').companyIds.includes('org-acme'));
    expect(visibleText(rail)).toContain('保存しました。保存後に読み直し');

    const end = buttonsNamed(section(rail, '所属'), '所属を終える');
    expect(end).toHaveLength(1);
    end[0].dispatch('click');
    expect(control(rail, 'validTo').value).toBe('2026-09-26');
    type(rail, 'validTo', '2026-09-01');
    type(rail, 'reason', '9月に退職した。');
    await submit(rail);
    const ended = api.posts()[1].body;
    expect(ended).toMatchObject({ kind: 'update_edge', reason: '9月に退職した。', changes: { validTo: dayToRfc3339('2026-09-01') } });
    await waitFor(() => visibleText(section(rail, '所属')).includes('2026-09-01 に終了')
      && !view.state.list.payload.people.find((person) => person.id === 'person-sato').companyIds.includes('org-acme'));
    // An ended membership offers no button, and nothing deletes a record.
    expect(buttonsNamed(section(rail, '所属'), '所属を終える').filter((node) => visibleText(node.parentNode?.parentNode).includes('Acme'))).toHaveLength(0);
    expect(findAll(root, (node) => node.tagName === 'BUTTON' && /削除|消す/u.test(node.textContent))).toEqual([]);
    expect(findAll(rail, (node) => node.tagName === 'BUTTON' && /削除|消す/u.test(node.textContent))).toEqual([]);
    expect(api.posts().every((request) => !/delete/u.test(request.body.kind))).toBe(true);
  });

  it('adds a person to a company from the company rail', async () => {
    await writeGraphV2(dataDir);
    const { rail, view } = await mountView(writable);
    await view.openEntity('org-acme');
    await waitFor(() => view.state.detail?.state === 'ok');
    expect(buttonsNamed(section(rail, '所属する人'), '所属を終える')).toHaveLength(1);
    buttonsNamed(rail, '所属する人を加える')[0].dispatch('click');
    await waitFor(() => findAll(control(rail, 'counterpartId'), (node) => node.tagName === 'OPTION').some((node) => node.textContent === '佐藤 花子'));
    type(rail, 'counterpartId', 'person-sato');
    type(rail, 'reason', 'Acmeに入った。');
    await submit(rail);
    expect(api.posts()[0].body.edge).toEqual({ fromId: 'person-sato', relation: 'member_of', toId: 'org-acme' });
    await waitFor(() => visibleText(section(rail, '所属する人')).includes('佐藤 花子'));
  });

  it('withholds what the host scope does not allow, without any role name in the part', async () => {
    await writeGraphV2(dataDir);
    const { root, rail, view } = await mountView({ ...writable, correctionScope: { createEntities: false, edges: false } });
    expect(buttonsNamed(root, '人を加える')).toEqual([]);
    expect(buttonsNamed(root, '会社を加える')).toEqual([]);
    await view.openEntity('person-tanaka');
    await waitFor(() => view.state.detail?.state === 'ok');
    expect(buttonsNamed(rail, '所属を付ける')).toHaveLength(1);
    expect(buttonsNamed(rail, '所属を終える')).toEqual([]);
    expect(view.correction.openCreateEntity({ types: ['org'] })).toBeNull();
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../ui/people-and-companies-view.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(gm|ceo|admin|owner_role|member_role)\b/u);
  });

  it('does not say saved when the host could not read the record back', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const fetcher = async (path, init = {}) => (init.method === 'POST'
      ? jsonResponse(500, { error: { code: 'readback_mismatch', message: 'The saved record does not match' } })
      : api.fetcher(path, init));
    const { root, rail } = await mountView({ ...writable, fetcher });
    buttonsNamed(root, '人を加える')[0].dispatch('click');
    type(rail, 'name', '山田 次郎');
    type(rail, 'reason', '新しく関わる人。');
    await submit(rail);
    const text = visibleText(section(rail, '人を加える'));
    expect(text).toContain('保存後に読み直した内容が一致しませんでした');
    expect(text).not.toContain('保存しました');
  });

  it('asks which project a new person joins when the host lists projects, and sends the chosen one', async () => {
    await writeGraphV2(dataDir);
    api = await startGraphApi(dataDir);
    const posts = [];
    const fetcher = async (path, init = {}) => {
      if (init.method === 'POST') {
        posts.push(JSON.parse(init.body));
        return jsonResponse(500, { error: { code: 'readback_mismatch', message: 'not saved in this test' } });
      }
      const response = await api.fetcher(path, init);
      if (!String(path).includes('/people-and-companies')) return response;
      const body = await response.json();
      return jsonResponse(response.status, { ...body, personProjects: [{ code: 'proj-a', name: 'プロジェクトA' }, { code: 'proj-b', name: null }] });
    };
    const { root, rail } = await mountView({ ...writable, fetcher });
    buttonsNamed(root, '人を加える')[0].dispatch('click');
    expect(control(rail, 'projectCode').children.map((option) => option.textContent))
      .toEqual(['プロジェクトを選んでください', 'プロジェクトA', 'proj-b']);
    type(rail, 'name', '山田 次郎');
    type(rail, 'reason', '新しく関わる人。');
    // A person is placed in a project as one of its people; without a choice nothing is sent.
    await submit(rail);
    expect(posts).toEqual([]);
    expect(visibleText(section(rail, '人を加える'))).toContain('人を加えるプロジェクトを選んでください。');
    type(rail, 'projectCode', 'proj-a');
    await submit(rail);
    expect(posts).toEqual([{ kind: 'create_entity', reason: '新しく関わる人。', entity: { type: 'person', name: '山田 次郎', projectCode: 'proj-a' } }]);

    // A company is not placed by this choice.
    buttonsNamed(root, '会社を加える')[0].dispatch('click');
    expect(control(rail, 'projectCode')).toBeUndefined();
  });

  it('offers no project choice and sends no project when the host lists none', async () => {
    await writeGraphV2(dataDir);
    const { root, rail } = await mountView(writable);
    buttonsNamed(root, '人を加える')[0].dispatch('click');
    expect(control(rail, 'projectCode')).toBeUndefined();
  });

  it('treats a malformed project list as a failed read instead of guessing', () => {
    const payload = { ownCompany: { id: null, reason: 'owner_not_found', candidateIds: [] }, people: [], companies: [], absenceConfirmed: true };
    expect(normalizePeopleAndCompanies({ state: 'ok', payload: { ...payload, personProjects: [{ code: '' }] } }).state).toBe('invalid');
    expect(normalizePeopleAndCompanies({ state: 'ok', payload: { ...payload, personProjects: [{ code: 'proj-a', name: 'A' }] } }).state).toBe('ok');
  });

  it('shows the company text on a person whose company is not known as a note, not as a membership', async () => {
    await writeGraphV2(dataDir, {
      entities: [
        ...Object.values(ENTITIES).map((entity) => entity.id === 'person-sato' ? { ...entity, metadata: { org: '雲孫 / BAAO' } }
          : entity.id === 'person-tanaka' ? { ...entity, metadata: { organization: 'Acme株式会社' } } : entity),
      ],
      edges: [...Object.values(EDGES), link('self', 'member_of', 'org-acme')],
    });
    const { root, rail, view } = await mountView();
    const unknown = visibleText(ledgerByLabel(root, '所属未確認の人'));
    expect(unknown).toContain('所属の記録なし');
    expect(unknown).toContain('記録上のメモ: 雲孫 / BAAO（所属ではありません）');
    // Tanaka is internal through his membership; his text is not shown.
    expect(visibleText(ledgerByLabel(root, '社内の人'))).not.toContain('記録上のメモ');
    expect(view.state.list.payload.people.find((person) => person.id === 'person-sato').companyIds).toEqual([]);
    await view.openEntity('person-sato');
    await waitFor(() => view.state.detail?.state === 'ok');
    expect(visibleText(rail)).toContain('記録上のメモ雲孫 / BAAO（人物の記録に文字で残っている会社名です。所属の記録ではありません）');
    expect(visibleText(section(rail, '所属'))).toContain('会社への所属の記録はありません。');
  });
});
