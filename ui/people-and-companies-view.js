/*
 * 「人と会社」: who the people in the Graph are, which company each belongs
 * to, and whether they are internal, external or not yet known.
 *
 * Reads `GET {base}/people-and-companies` for the ledgers and
 * `GET {base}/entities/:id` for the selected record in the right rail (see
 * `graph-view-shared.js`).  Read only: there is no correction here; the rail
 * points to 「情報と関係」, where the same record is corrected.
 *
 * A company's kind (顧客・協業先・提案中) is what the host derives from the
 * company attributes (`orgType`, `lifecycle_stage`), the roles of its
 * `related_to` relations and its recorded deals; a company without such a
 * record shows no kind.  Its projects are split into its own (`owned_by`)
 * and the ones it is involved in (`related_to`, with the role).
 *
 * Internal and external are not stored anywhere.  They come from the
 * company memberships (`member_of`) and the own company the host answers.
 * When the own company is not known, every person is shown as not yet known
 * instead of being guessed.  Ended records stay out of the ledgers and are
 * only counted.
 *
 * The host injects the fetcher, base path, right rail and page context; this
 * module keeps no global state.
 */

import {
  badge,
  createGraphClient,
  createGraphLayout,
  getDocument,
  graphHostEmptyNotice,
  graphPageContext,
  graphStateNotice,
  isEdgeView,
  isEntityView,
  isRecord,
  makeElement,
  provenanceSummary,
  relationLabel,
  textOrNull,
  validityLabel,
} from './graph-view-shared.js';
import {
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceHostNotice,
  workspaceLedger,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
  workspaceSectionTitle,
} from './workspace-kit.js';

export const PEOPLE_AND_COMPANIES_VIEW_CONTRACT_VERSION = 'brainbase.people-and-companies-view.v1';
export const PEOPLE_LEDGER_COLUMNS = Object.freeze(['名前', '会社', '関わるプロジェクト', '有効期間']);
export const COMPANY_LEDGER_COLUMNS = Object.freeze(['会社', '種類', '所属する人', 'プロジェクト', '有効期間']);

/** Plain labels of the company kinds the host derives, and of where each came from. */
export const COMPANY_KIND_LABELS = Object.freeze({ customer: '顧客', partner: '協業先', prospect: '提案中' });
const COMPANY_KIND_SOURCE_LABELS = Object.freeze({
  orgType: '会社の属性',
  lifecycle_stage: '会社の段階',
  related_to: 'プロジェクトとの関係の役割',
  deals: '提案中の案件の記録',
});
/** Plain labels of the recorded related_to roles; another role shows as recorded. */
const RELATED_ROLE_LABELS = Object.freeze({ customer: '顧客', partner: '協業先' });

const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });

const OWN_COMPANY_REASONS = Object.freeze({
  owner_has_no_company: 'あなた（本人）の所属する会社がGraphにありません。',
  owner_has_several_companies: 'あなた（本人）が複数の会社に所属しているため、自社を1つに決められません。',
  owner_not_found: 'Graphに、あなた（本人）の記録がありません。',
});

function isIdList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const isTextOrNull = (value) => value === null || typeof value === 'string';

function isCompanySummary(company) {
  return isEntityView(company) && isIdList(company.memberIds) && isIdList(company.projectIds)
    && Array.isArray(company.relatedProjects) && company.relatedProjects.every((item) => isRecord(item) && typeof item.projectId === 'string' && isTextOrNull(item.role))
    && isTextOrNull(company.orgType) && isTextOrNull(company.lifecycleStage)
    && Array.isArray(company.deals) && company.deals.every((deal) => isRecord(deal) && isTextOrNull(deal.name) && isTextOrNull(deal.stage))
    && Array.isArray(company.kinds) && company.kinds.every((item) => isRecord(item) && typeof item.kind === 'string' && isIdList(item.sources));
}

/** The company's kinds in plain Japanese (e.g. 顧客・協業先), or '' when none is recorded. */
export function companyKindLabel(company) {
  return (company?.kinds ?? []).map((item) => ownKey(COMPANY_KIND_LABELS, item.kind) ?? item.kind).join('・');
}

/** A related_to role in plain Japanese; an unknown role shows as recorded. */
export function relatedRoleLabel(role) {
  const text = textOrNull(role);
  return text ? ownKey(RELATED_ROLE_LABELS, text.toLowerCase()) ?? text : null;
}

function ownKey(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The read is `ok` only when every person and company is well formed. */
export function normalizePeopleAndCompanies(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  const own = payload.ownCompany;
  if (!isRecord(own) || !(own.id === null || typeof own.id === 'string') || typeof own.reason !== 'string' || !isIdList(own.candidateIds)) return INVALID;
  if (!Array.isArray(payload.people) || !payload.people.every((person) => isEntityView(person)
    && isIdList(person.companyIds) && Number.isInteger(person.projectCount) && Number.isInteger(person.accountableProjectCount))) return INVALID;
  if (!Array.isArray(payload.companies) || !payload.companies.every(isCompanySummary)) return INVALID;
  if (payload.people.length === 0 && payload.companies.length === 0 && payload.absenceConfirmed !== true) return { state: 'unknown' };
  return { state: 'ok', payload };
}

/**
 * Splits the active people into internal, external by company and not yet
 * known.  Without an own company every active person is not yet known.
 */
export function groupPeople(payload) {
  const ownId = payload.ownCompany?.id ?? null;
  const companies = new Map(payload.companies.map((company) => [company.id, company]));
  const active = payload.people.filter((person) => person.active);
  const groups = { ownCompanyId: ownId, internal: [], external: [], unknown: [] };
  if (!ownId) {
    groups.unknown = active;
    return groups;
  }
  const byCompany = new Map();
  for (const person of active) {
    if (person.companyIds.includes(ownId)) {
      groups.internal.push(person);
      continue;
    }
    const companyId = person.companyIds.find((id) => companies.has(id));
    if (!companyId) {
      groups.unknown.push(person);
      continue;
    }
    if (!byCompany.has(companyId)) byCompany.set(companyId, []);
    byCompany.get(companyId).push(person);
  }
  groups.external = [...byCompany.entries()]
    .map(([companyId, people]) => ({ company: companies.get(companyId), people }))
    .sort((left, right) => left.company.name.localeCompare(right.company.name, 'ja') || left.company.id.localeCompare(right.company.id, 'en'));
  return groups;
}

/** Whether a person is internal, external or not yet known, in plain Japanese. */
export function personStanding(person, ownCompanyId) {
  if (!ownCompanyId) return '所属未確認（自社が未設定）';
  if (person.companyIds.includes(ownCompanyId)) return '社内';
  return person.companyIds.length > 0 ? '社外' : '所属未確認';
}

export function createPeopleAndCompaniesView({
  root,
  rail,
  page,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph',
  autoLoad = true,
  initialEntityId,
  now = () => new Date(),
  sourceNotice,
  emptyNotice,
  correctionHref = (id) => `#graph?entity_id=${encodeURIComponent(id)}`,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const client = createGraphClient({ fetcher, basePath });
  const context = graphPageContext(page);
  const layout = createGraphLayout(doc, {
    root,
    rail,
    label: '人と会社',
    className: 'bb-pc',
    contractVersion: PEOPLE_AND_COMPANIES_VIEW_CONTRACT_VERSION,
  });
  const state = { list: { state: 'loading' }, detail: null };

  const nameOf = (id) => {
    if (state.list.state !== 'ok') return id;
    const { people, companies } = state.list.payload;
    return (people.find((item) => item.id === id) ?? companies.find((item) => item.id === id))?.name ?? id;
  };
  const asOf = () => (state.list.state === 'ok' ? state.list.payload.asOf : now().toISOString());

  // -------------------------------------------------------------------------
  // Workspace

  function personRows(people) {
    const ownId = state.list.payload.ownCompany.id;
    return people.map((person) => ({
      key: person.id,
      selected: person.id === state.detail?.id,
      onSelect: (id) => void controller.openEntity(id),
      cells: [
        { primary: person.isOwner ? `${person.name}（あなた）` : person.name, secondary: person.id },
        person.companyIds.length > 0 ? person.companyIds.map(nameOf).join('、') : '所属の記録なし',
        person.accountableProjectCount > 0
          ? `${person.projectCount}件（うち責任 ${person.accountableProjectCount}件）`
          : `${person.projectCount}件`,
        validityLabel(person, asOf()),
      ],
      label: `${person.name}、${personStanding(person, ownId)}`,
    }));
  }

  function peopleLedger(label, people, empty) {
    return workspaceLedger(doc, {
      className: 'bb-pc-people-ledger',
      ariaLabel: label,
      columns: PEOPLE_LEDGER_COLUMNS,
      empty,
      rows: personRows(people),
    });
  }

  function peopleSection(payload) {
    const section = makeElement(doc, 'section', { className: 'bb-pc-people', attrs: { 'aria-label': '人' } });
    section.append(workspaceSectionTitle(doc, { title: '人', lead: '社内か社外かは、所属（会社への所属の関係）と自社から決めています。印は別に持っていません。' }));
    const groups = groupPeople(payload);
    if (!groups.ownCompanyId) {
      const reason = OWN_COMPANY_REASONS[payload.ownCompany.reason] ?? '自社を決められません。';
      section.append(workspaceNotice(doc, {
        label: '自社が未設定',
        tone: 'warning',
        text: `${reason}推測で社内・社外を分けず、全員を所属未確認に置いています。あなたの記録に会社への所属を加えると、社内と社外に分かれます。`,
      }));
    }
    if (groups.ownCompanyId) {
      section.append(makeElement(doc, 'h3', { className: 'bb-pc-group-title', text: `社内（${nameOf(groups.ownCompanyId)}）` }));
      section.append(peopleLedger('社内の人', groups.internal, '自社に所属する人の記録はありません。'));
      section.append(makeElement(doc, 'h3', { className: 'bb-pc-group-title', text: '社外' }));
      if (groups.external.length === 0) section.append(makeElement(doc, 'p', { className: 'bb-pc-empty', text: 'ほかの会社に所属する人の記録はありません。' }));
      for (const group of groups.external) {
        section.append(makeElement(doc, 'h4', { className: 'bb-pc-company-title', text: group.company.name }));
        section.append(peopleLedger(`${group.company.name}の人`, group.people));
      }
    }
    section.append(makeElement(doc, 'h3', { className: 'bb-pc-group-title', text: '所属未確認' }));
    section.append(peopleLedger('所属未確認の人', groups.unknown, '所属が分からない人はいません。'));
    return section;
  }

  function companySection(payload) {
    const section = makeElement(doc, 'section', { className: 'bb-pc-companies', attrs: { 'aria-label': '会社' } });
    section.append(workspaceSectionTitle(doc, {
      title: '会社',
      lead: '自社を先頭に、顧客・協業先など関わる会社を並べています。種類は、会社の属性、プロジェクトとの関係の役割、提案中の案件の記録から出しています。記録が無い会社には種類を出しません。',
    }));
    const active = payload.companies.filter((company) => company.active);
    section.append(workspaceLedger(doc, {
      className: 'bb-pc-company-ledger',
      ariaLabel: '会社の一覧',
      columns: COMPANY_LEDGER_COLUMNS,
      empty: '会社の記録はありません。',
      rows: active.map((company) => ({
        key: company.id,
        selected: company.id === state.detail?.id,
        onSelect: (id) => void controller.openEntity(id),
        cells: [
          { primary: company.id === payload.ownCompany.id ? `${company.name}（自社）` : company.name, secondary: company.id },
          companyKindLabel(company),
          `${company.memberIds.length}人`,
          company.relatedProjects.length > 0
            ? `${company.projectIds.length}件（関わる ${company.relatedProjects.length}件）`
            : `${company.projectIds.length}件`,
          validityLabel(company, payload.asOf),
        ],
      })),
    }));
    return section;
  }

  function endedNote(payload) {
    const people = payload.people.filter((person) => !person.active).length;
    const companies = payload.companies.filter((company) => !company.active).length;
    if (people === 0 && companies === 0) return null;
    return makeElement(doc, 'p', {
      className: 'bb-pc-ended',
      text: `終わった記録（人 ${people}件、会社 ${companies}件）は一覧に出していません。「情報と関係」で見られます。`,
    });
  }

  function workspace() {
    const children = [workspacePageHeader(doc, {
      crumbs: context.crumbs,
      title: '人と会社',
      lead: 'Graphに登録された人が、どの会社の人か、社内か社外か所属が分からないかを確かめます。',
      source: context.source,
    })];
    const hostNotice = sourceNotice ? workspaceHostNotice(doc, sourceNotice) : null;
    if (hostNotice) children.push(hostNotice);
    const notice = graphStateNotice(doc, state.list, { onRetry: () => void controller.load() });
    if (notice) return [...children, notice];
    const payload = state.list.payload;
    if (payload.absenceConfirmed) {
      return [...children, graphHostEmptyNotice(doc, emptyNotice)
        ?? workspaceNotice(doc, { label: '未登録', tone: 'info', role: 'status', text: 'Graphに人と会社の記録はまだありません。' })];
    }
    return [...children, peopleSection(payload), companySection(payload), endedNote(payload)];
  }

  // -------------------------------------------------------------------------
  // Rail

  function edgeList(edges, empty, { roleLabel = textOrNull } = {}) {
    if (edges.length === 0) return makeElement(doc, 'p', { className: 'bb-pc-empty', text: empty });
    const list = makeElement(doc, 'ul', { className: 'bb-pc-relation-list' });
    for (const edge of edges) {
      const item = makeElement(doc, 'li', { className: `bb-pc-relation${edge.active ? '' : ' is-ended'}` });
      const head = makeElement(doc, 'div', { className: 'bb-pc-relation-head' });
      head.append(makeElement(doc, 'strong', { text: edge.counterpart.name }), badge(doc, relationLabel(edge.relation), 'muted'));
      const source = provenanceSummary(edge.provenance);
      item.append(
        head,
        makeElement(doc, 'span', { className: 'bb-pc-relation-meta', text: [
          validityLabel(edge, asOf()),
          roleLabel(edge.role) ? `役割: ${roleLabel(edge.role)}` : null,
          `出典: ${source.kind}${source.reference ? `（${source.reference}）` : ''}`,
        ].filter(Boolean).join('　') }),
      );
      list.append(item);
    }
    return list;
  }

  function dealList(deals) {
    const list = makeElement(doc, 'ul', { className: 'bb-pc-relation-list' });
    for (const deal of deals) {
      const item = makeElement(doc, 'li', { className: 'bb-pc-relation' });
      item.append(makeElement(doc, 'strong', { text: deal.name ?? '名前の記録が無い案件' }));
      if (deal.stage) item.append(makeElement(doc, 'span', { className: 'bb-pc-relation-meta', text: `段階: ${deal.stage}` }));
      list.append(item);
    }
    return list;
  }

  function railContent() {
    const detail = state.detail;
    if (!detail) {
      return [workspaceDetailEmpty(doc, { mark: '人', title: '人か会社を選んでください', text: '所属と関わるプロジェクトを、有効期間と出典つきで確かめられます。' })];
    }
    const notice = graphStateNotice(doc, detail, { onRetry: () => void controller.openEntity(detail.id) });
    if (notice) return [notice];
    const { entity, outgoing, incoming } = detail.payload;
    const listed = state.list.state === 'ok'
      ? state.list.payload.people.find((person) => person.id === entity.id)
      : null;
    const ownId = state.list.state === 'ok' ? state.list.payload.ownCompany.id : null;
    const company = state.list.state === 'ok' && entity.type === 'org'
      ? state.list.payload.companies.find((item) => item.id === entity.id)
      : null;
    const blocks = [workspaceRailHead(doc, {
      kicker: entity.type === 'org' ? '会社' : '人',
      title: entity.name,
      sub: entity.id,
      lead: textOrNull(entity.summary) ?? undefined,
    })];
    blocks.push(workspaceDefinition(doc, [
      ...(entity.type === 'person' && listed ? [['区分', personStanding(listed, ownId)]] : []),
      ...(entity.type === 'org' && entity.id === ownId ? [['区分', '自社']] : []),
      ...(company && company.kinds.length > 0 ? [['種類', company.kinds.map((item) => {
        const sources = item.sources.map((source) => ownKey(COMPANY_KIND_SOURCE_LABELS, source) ?? source).join('・');
        return `${ownKey(COMPANY_KIND_LABELS, item.kind) ?? item.kind}（${sources}から）`;
      }).join('、')]] : []),
      ...(company?.lifecycleStage ? [['記録上の段階', company.lifecycleStage]] : []),
      ['有効期間', validityLabel(entity, asOf())],
    ]));
    if (entity.type === 'org') {
      blocks.push(workspaceRailBlock(doc, { title: '所属する人', content: edgeList(incoming.filter((edge) => edge.relation === 'member_of'), '所属する人の記録はありません。') }));
      blocks.push(workspaceRailBlock(doc, { title: 'この会社のプロジェクト', content: edgeList(incoming.filter((edge) => edge.relation === 'owned_by'), 'この会社のプロジェクトの記録はありません。') }));
      blocks.push(workspaceRailBlock(doc, {
        title: '顧客・協業先として関わるプロジェクト',
        content: edgeList(outgoing.filter((edge) => edge.relation === 'related_to'), '顧客・協業先として関わるプロジェクトの記録はありません。', { roleLabel: relatedRoleLabel }),
      }));
      if (company && company.deals.length > 0) blocks.push(workspaceRailBlock(doc, { title: '提案中の案件', content: dealList(company.deals) }));
    } else {
      blocks.push(workspaceRailBlock(doc, { title: '所属', content: edgeList(outgoing.filter((edge) => edge.relation === 'member_of'), '会社への所属の記録はありません。') }));
      blocks.push(workspaceRailBlock(doc, {
        title: '関わるプロジェクト',
        content: edgeList(outgoing.filter((edge) => edge.relation === 'participates_in' || edge.relation === 'accountable_for'), '関わるプロジェクトの記録はありません。'),
      }));
    }
    const fix = makeElement(doc, 'p', { className: 'bb-pc-fix' });
    fix.append(
      makeElement(doc, 'span', { text: '間違いは「情報と関係」で、この記録を開いて直します。' }),
      makeElement(doc, 'a', { text: '情報と関係で開く', attrs: { href: correctionHref(entity.id) } }),
    );
    blocks.push(fix);
    return blocks;
  }

  // -------------------------------------------------------------------------
  // Controller

  const controller = Object.freeze({
    get state() {
      return state;
    },
    render() {
      layout.render(workspace(), railContent());
    },
    async load() {
      state.list = { state: 'loading' };
      controller.render();
      state.list = normalizePeopleAndCompanies(await client.read('/people-and-companies'));
      controller.render();
      if (initialEntityId && !state.detail) await controller.openEntity(initialEntityId);
    },
    async openEntity(id) {
      state.detail = { id, state: 'loading' };
      controller.render();
      const result = await client.read(`/entities/${encodeURIComponent(id)}`);
      if (state.detail?.id !== id) return;
      state.detail = { id, ...normalizeEntityDetail(result) };
      controller.render();
    },
  });

  if (autoLoad) void controller.load();
  else controller.render();
  return controller;
}

function normalizeEntityDetail(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  if (!isEntityView(payload.entity)) return INVALID;
  for (const key of ['outgoing', 'incoming']) {
    if (!Array.isArray(payload[key]) || !payload[key].every(isEdgeView)) return INVALID;
  }
  return { state: 'ok', payload };
}
