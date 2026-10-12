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
import { FakeDocument, FakeElement, findAll, jsonResponse, section, startGraphApi, visibleText, waitFor } from './graph-ui-harness.mjs';

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

async function mountView({ fetcher } = {}) {
  if (!fetcher) api = await startGraphApi(dataDir);
  const root = new FakeElement('div');
  const rail = new FakeElement('div');
  const view = createPeopleAndCompaniesView({ root, rail, page: PAGE, document: new FakeDocument(), fetcher: fetcher ?? api.fetcher, autoLoad: false, now: () => new Date(2026, 8, 26, 12) });
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
    // Read only: no correction control in this screen.
    expect(findAll(root, (node) => ['INPUT', 'TEXTAREA', 'SELECT', 'FORM'].includes(node.tagName))).toEqual([]);
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
