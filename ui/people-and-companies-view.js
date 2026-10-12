/*
 * 「人と会社」: who the people in the Graph are, which company each belongs
 * to, and whether they are internal, external or not yet known.
 *
 * Reads `GET {base}/people-and-companies` for the ledgers and
 * `GET {base}/entities/:id` for the selected record in the right rail (see
 * `graph-view-shared.js`).  Read only unless the host says it can write
 * (`canCorrect: true`): then it creates people and companies
 * (`create_entity`), adds a company membership (`create_edge` of
 * `member_of`) and ends one with an end date (`update_edge`), all through
 * `POST {base}/corrections`.  Nothing is deleted.  After a save the ledgers
 * and the rail are read again from the host.  Other corrections stay in
 * 「情報と関係」, which the rail links to.
 *
 * The company text recorded on a person (`orgNote`) is shown only for
 * people whose company is not yet known, and only as a note: it never
 * decides a membership, the own company or internal / external.
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
  button,
  createGraphClient,
  createGraphCorrection,
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
  readOnlyGraphClient,
  graphCorrectionScope,
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
    && isIdList(person.companyIds) && Number.isInteger(person.projectCount) && Number.isInteger(person.accountableProjectCount)
    && (person.orgNote === undefined || isTextOrNull(person.orgNote)))) return INVALID;
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

/** The company text recorded on a person whose company is not yet known, or null. */
export function personOrgNote(person, ownCompanyId) {
  const note = textOrNull(person?.orgNote);
  if (!note) return null;
  const standing = personStanding(person, ownCompanyId);
  return standing === '社内' || standing === '社外' ? null : note;
}

/**
 * @param {object} options
 * @param {boolean} [options.canCorrect=false] Whether the host lets this viewer write.  Only then
 *   人を加える, 会社を加える, 所属を付ける, 所属する人を加える and 所属を終える are drawn; otherwise the
 *   client refuses every correction before sending it.  The host decides it (for example from the
 *   viewer's role); this part holds no role name.
 * @param {{ entityTypes?: string[], edges?: boolean, createEdges?: boolean, createEntities?: boolean }} [options.correctionScope]
 *   With writes allowed, only these (see `graphCorrectionScope`): `createEntities: false` withholds
 *   人を加える・会社を加える, `createEdges: false` withholds 所属を付ける・所属する人を加える, `edges: false`
 *   withholds 所属を終える, and `entityTypes` limits the kinds that may be created.
 * @param {string} [options.token] Launch token sent with a correction.
 * @param {string} [options.tokenHeader] Header name for the token.
 */
export function createPeopleAndCompaniesView({
  root,
  rail,
  page,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph',
  token,
  tokenHeader,
  autoLoad = true,
  initialEntityId,
  now = () => new Date(),
  canCorrect = false,
  correctionScope,
  sourceNotice,
  emptyNotice,
  correctionHref = (id) => `#graph?entity_id=${encodeURIComponent(id)}`,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const graphClient = createGraphClient({ fetcher, basePath, token, ...(tokenHeader ? { tokenHeader } : {}) });
  const writable = canCorrect === true;
  const client = writable ? graphClient : readOnlyGraphClient(graphClient);
  const scope = graphCorrectionScope(correctionScope);
  const can = Object.freeze({
    createPerson: writable && scope.createEntities && scope.entity('person'),
    createCompany: writable && scope.createEntities && scope.entity('org'),
    addMembership: writable && scope.createEdges,
    endMembership: writable && scope.edges,
  });
  const context = graphPageContext(page);
  const layout = createGraphLayout(doc, {
    root,
    rail,
    label: '人と会社',
    className: 'bb-pc',
    contractVersion: PEOPLE_AND_COMPANIES_VIEW_CONTRACT_VERSION,
  });
  const state = { list: { state: 'loading' }, detail: null };
  const correction = createGraphCorrection({
    client,
    now,
    scope: correctionScope,
    rerender: () => controller.render(),
    onSaved: async (payload, form) => {
      // Read the saved state back from the host, never from the form.
      const id = form.kind === 'create_entity' ? payload.record?.id : state.detail?.id;
      await controller.load({ keepDetail: true });
      if (id) await controller.openEntity(id, { keepCorrection: true });
    },
    onConflict: async () => {
      if (state.detail) await controller.openEntity(state.detail.id, { keepCorrection: true });
    },
  });

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
        person.companyIds.length > 0 ? person.companyIds.map(nameOf).join('、') : companyCell(person, ownId),
        person.accountableProjectCount > 0
          ? `${person.projectCount}件（うち責任 ${person.accountableProjectCount}件）`
          : `${person.projectCount}件`,
        validityLabel(person, asOf()),
      ],
      label: `${person.name}、${personStanding(person, ownId)}`,
    }));
  }

  function orgNoteText(note) {
    return `記録上のメモ: ${note}（所属ではありません）`;
  }

  function companyCell(person, ownId) {
    const note = personOrgNote(person, ownId);
    if (!note) return '所属の記録なし';
    const cell = makeElement(doc, 'span', { className: 'bb-pc-company-cell' });
    cell.append(
      makeElement(doc, 'span', { text: '所属の記録なし' }),
      makeElement(doc, 'small', { className: 'bb-pc-org-note', text: orgNoteText(note) }),
    );
    return cell;
  }

  function sectionActions(label, onClick) {
    const actions = makeElement(doc, 'div', { className: 'bb-pc-actions' });
    actions.append(button(doc, label, onClick));
    return actions;
  }

  function openCreateEntity(type) {
    correction.openCreateEntity({
      types: [type],
      typeNames: { person: '人', org: '会社' },
      title: type === 'org' ? '会社を加える' : '人を加える',
      subject: type === 'org' ? 'Graphに会社の記録を作ります。' : 'Graphに人の記録を作ります。',
    });
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
    if (can.createPerson) section.append(sectionActions('人を加える', () => openCreateEntity('person')));
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
    if (can.createCompany) section.append(sectionActions('会社を加える', () => openCreateEntity('org')));
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

  function edgeList(edges, empty, { roleLabel = textOrNull, actions } = {}) {
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
      const controls = actions?.(edge) ?? [];
      if (controls.length > 0) {
        const row = makeElement(doc, 'div', { className: 'bb-pc-relation-actions' });
        row.append(...controls);
        item.append(row);
      }
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

  function membershipActions(edge, entity) {
    if (!can.endMembership || !edge.active) return [];
    const person = entity.type === 'org' ? edge.counterpart.name : entity.name;
    const company = entity.type === 'org' ? entity.name : edge.counterpart.name;
    return [button(doc, '所属を終える', () => correction.openEdge(edge, {
      mode: 'end',
      title: '所属を終える',
      subject: `${person}の「${company}」への所属に終了日を入れます。記録は消さずに残ります。`,
    }))];
  }

  function addMembershipButton(entity) {
    if (!can.addMembership) return null;
    const label = entity.type === 'org' ? '所属する人を加える' : '所属を付ける';
    return sectionActions(label, () => correction.openCreate(
      { id: entity.id, type: entity.type, name: entity.name },
      {
        relations: ['member_of'],
        relationNames: { member_of: '所属' },
        relationLabel: '関わり方',
        title: label,
        subject: entity.type === 'org' ? `「${entity.name}」に所属する人を選びます。` : `${entity.name}が所属する会社を選びます。`,
      },
    ));
  }

  function railContent() {
    const panel = correction.render(doc);
    const blocks = railBlocks();
    if (!panel) return blocks;
    // A new record's form shows first; a membership form right after the record's head.
    if (correction.form?.kind === 'create_entity' || !state.detail || state.detail.state !== 'ok') return [panel, ...blocks];
    return [blocks[0], panel, ...blocks.slice(1)];
  }

  function railBlocks() {
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
      ...(entity.type === 'person' && listed && personOrgNote(listed, ownId)
        ? [['記録上のメモ', `${personOrgNote(listed, ownId)}（人物の記録に文字で残っている会社名です。所属の記録ではありません）`]]
        : []),
      ...(entity.type === 'org' && entity.id === ownId ? [['区分', '自社']] : []),
      ...(company && company.kinds.length > 0 ? [['種類', company.kinds.map((item) => {
        const sources = item.sources.map((source) => ownKey(COMPANY_KIND_SOURCE_LABELS, source) ?? source).join('・');
        return `${ownKey(COMPANY_KIND_LABELS, item.kind) ?? item.kind}（${sources}から）`;
      }).join('、')]] : []),
      ...(company?.lifecycleStage ? [['記録上の段階', company.lifecycleStage]] : []),
      ['有効期間', validityLabel(entity, asOf())],
    ]));
    if (entity.type === 'org') {
      blocks.push(workspaceRailBlock(doc, { title: '所属する人', content: [
        edgeList(incoming.filter((edge) => edge.relation === 'member_of'), '所属する人の記録はありません。', { actions: (edge) => membershipActions(edge, entity) }),
        addMembershipButton(entity),
      ] }));
      blocks.push(workspaceRailBlock(doc, { title: 'この会社のプロジェクト', content: edgeList(incoming.filter((edge) => edge.relation === 'owned_by'), 'この会社のプロジェクトの記録はありません。') }));
      blocks.push(workspaceRailBlock(doc, {
        title: '顧客・協業先として関わるプロジェクト',
        content: edgeList(outgoing.filter((edge) => edge.relation === 'related_to'), '顧客・協業先として関わるプロジェクトの記録はありません。', { roleLabel: relatedRoleLabel }),
      }));
      if (company && company.deals.length > 0) blocks.push(workspaceRailBlock(doc, { title: '提案中の案件', content: dealList(company.deals) }));
    } else {
      blocks.push(workspaceRailBlock(doc, { title: '所属', content: [
        edgeList(outgoing.filter((edge) => edge.relation === 'member_of'), '会社への所属の記録はありません。', { actions: (edge) => membershipActions(edge, entity) }),
        addMembershipButton(entity),
      ] }));
      blocks.push(workspaceRailBlock(doc, {
        title: '関わるプロジェクト',
        content: edgeList(outgoing.filter((edge) => edge.relation === 'participates_in' || edge.relation === 'accountable_for'), '関わるプロジェクトの記録はありません。'),
      }));
    }
    const fix = makeElement(doc, 'p', { className: 'bb-pc-fix' });
    fix.append(
      makeElement(doc, 'span', { text: writable
        ? '名前・別名・要約などの間違いは「情報と関係」で、この記録を開いて直します。'
        : '間違いは「情報と関係」で、この記録を開いて直します。' }),
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
    get correction() {
      return correction;
    },
    render() {
      layout.render(workspace(), railContent());
    },
    /** Reads the ledgers.  `keepDetail` keeps the open record (and the shown ledgers) while reading. */
    async load({ keepDetail = false } = {}) {
      if (!keepDetail || state.list.state !== 'ok') {
        state.list = { state: 'loading' };
        controller.render();
      }
      state.list = normalizePeopleAndCompanies(await client.read('/people-and-companies'));
      controller.render();
      if (initialEntityId && !state.detail) await controller.openEntity(initialEntityId);
    },
    /** Opens a record in the rail.  Choosing another record closes an open form unless `keepCorrection`. */
    async openEntity(id, { keepCorrection = false } = {}) {
      if (!keepCorrection && correction.form && state.detail?.id !== id) correction.close();
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
