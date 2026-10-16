/*
 * 「人と会社」: who the people in the Graph are, which company each belongs
 * to, and whether they are internal, external or not yet known.
 *
 * Reads `GET {base}/people-and-companies` for the ledgers and
 * `GET {base}/entities/:id` for the selected record (see
 * `graph-view-shared.js`).  Choosing a row turns the workspace into the
 * record's page, as a CRM does: a way back to the ledgers with the record's
 * place and previous / next, the head with what can be done to this record,
 * then its memberships and projects.  The record's facts (standing, kind,
 * validity, id) sit in the right rail, or on the page when the host has no
 * rail.  So the page never depends on where a host puts its rail on a narrow
 * screen.  Read only unless the host says it can write (`canCorrect: true`):
 * then it creates people and companies (`create_entity`), adds a company
 * membership (`create_edge` of `member_of`) and ends one with an end date
 * (`update_edge`), all through `POST {base}/corrections`.  Nothing is
 * deleted, and the page says so next to the actions.  A viewer who cannot
 * write sees the actions disabled with the reason.  After a save the ledgers
 * and the record are read again from the host.  Other corrections stay in
 * 「情報と関係」, which the page links to.
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
  workspaceButton,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceHostNotice,
  workspaceLedger,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
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

/** What the page says next to the actions: nothing is deleted, a membership is ended. */
export const NO_DELETE_NOTE = '消す操作はありません。所属は終了日を入れて「終える」と一覧から外れ、記録は履歴に残ります。';
const DEFAULT_READ_ONLY_NOTE = 'この画面では見るだけです。人・会社の追加と、所属を付ける・終える操作はできません。';

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

/** First visible character of a name for its mark, or a placeholder. */
function nameInitial(name) {
  const text = String(name ?? '').trim();
  const latin = text.split(/\s+/u).filter(Boolean);
  if (/^[A-Za-z]/u.test(text) && latin.length > 1) return `${latin[0][0]}${latin[1][0]}`.toUpperCase();
  return ([...text][0] ?? '?').toUpperCase();
}

/** A stable tone (0-5) per id so a person or company keeps its color. */
function markTone(id) {
  let hash = 0;
  for (const character of String(id ?? '')) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return hash % 6;
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
  if (payload.personProjects !== undefined && !(Array.isArray(payload.personProjects) && payload.personProjects.every((project) => isRecord(project)
    && typeof project.code === 'string' && project.code.trim() && isTextOrNull(project.name)))) return INVALID;
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
 *   A host that places people in projects lists the projects a new person may join as
 *   `personProjects` (`[{ code, name }]`) in its read; 人を加える then requires one and sends it as
 *   `entity.projectCode`.  Without that list (the local host) no project is asked or sent.
 * @param {string | ((subject: { id: string, type: string, name: string } | null) => string | null)} [options.readOnlyNote]
 *   Without writes, why the actions are disabled (for example who can write).  Without it a
 *   general sentence is shown; the part names no role itself.
 * @param {string} [options.recordFixNote] When the host cannot correct a person's or company's own
 *   record (name, aliases, summary), why; the page then shows this instead of the link to
 *   「情報と関係」.
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
  readOnlyNote,
  recordFixNote,
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
  // Where to move after the next render: the opened record's head, or the row it was opened from.
  let pendingScroll = null;
  let detailTop = null;
  let detailHead = null;
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
        { primary: person.isOwner ? `${person.name}（あなた）` : person.name, leading: personMark(person) },
        person.companyIds.length > 0 ? companyChips(person.companyIds) : companyCell(person, ownId),
        person.accountableProjectCount > 0
          ? `${person.projectCount}件（うち責任 ${person.accountableProjectCount}件）`
          : `${person.projectCount}件`,
        validityLabel(person, asOf()),
      ],
      label: `${person.name}、${personStanding(person, ownId)}`,
    }));
  }

  function personMark(person) {
    return makeElement(doc, 'span', {
      className: `bb-pc-mark bb-pc-person-mark bb-pc-tone-${markTone(person.id)}`,
      text: nameInitial(person.name),
      attrs: { 'aria-hidden': 'true' },
    });
  }

  function companyMark(id, name) {
    return makeElement(doc, 'span', {
      className: `bb-pc-mark bb-pc-company-mark bb-pc-tone-${markTone(id)}`,
      text: nameInitial(name),
      attrs: { 'aria-hidden': 'true' },
    });
  }

  function companyChips(ids) {
    const list = makeElement(doc, 'span', { className: 'bb-pc-company-chips' });
    for (const id of ids) {
      const chip = makeElement(doc, 'span', { className: 'bb-pc-company-chip' });
      chip.append(companyMark(id, nameOf(id)), makeElement(doc, 'span', { text: nameOf(id) }));
      list.append(chip);
    }
    return list;
  }

  function kindBadges(company) {
    const kinds = company.kinds ?? [];
    if (kinds.length === 0) return '';
    const list = makeElement(doc, 'span', { className: 'bb-pc-kinds' });
    for (const item of kinds) {
      list.append(makeElement(doc, 'span', {
        className: `bb-pc-kind bb-pc-kind-${Object.hasOwn(COMPANY_KIND_LABELS, item.kind) ? item.kind : 'other'}`,
        text: ownKey(COMPANY_KIND_LABELS, item.kind) ?? item.kind,
      }));
    }
    return list;
  }

  function groupTitle(tag, text, count, { className = 'bb-pc-group-title', leading } = {}) {
    const title = makeElement(doc, tag, { className });
    if (leading) title.append(leading);
    title.append(makeElement(doc, 'span', { text }), makeElement(doc, 'span', { className: 'bb-pc-count', text: String(count) }));
    return title;
  }

  function jumpLinks(payload) {
    const people = payload.people.filter((person) => person.active).length;
    const companies = payload.companies.filter((company) => company.active).length;
    const nav = makeElement(doc, 'nav', { className: 'bb-pc-jump', attrs: { 'aria-label': '人と会社の段' } });
    for (const [label, count, target] of [['人', people, 'bb-pc-people'], ['会社', companies, 'bb-pc-companies']]) {
      const link = button(doc, '', () => {
        const node = typeof doc.getElementById === 'function' ? doc.getElementById(target) : null;
        node?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, { className: 'bb-pc-jump-link', attrs: { 'aria-label': `${label} ${count}件の段へ移る` } });
      link.append(makeElement(doc, 'span', { text: label }), makeElement(doc, 'span', { className: 'bb-pc-count', text: String(count) }));
      nav.append(link);
    }
    return nav;
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

  function readOnlyText(subject) {
    const value = typeof readOnlyNote === 'function' ? readOnlyNote(subject ?? null) : readOnlyNote;
    return textOrNull(value) ?? DEFAULT_READ_ONLY_NOTE;
  }

  /**
   * One action.  Allowed: a button.  Withheld by the host's scope: nothing.
   * Without writes: the button disabled, pointing at the reason shown next to it.
   */
  function actionButton(text, allowed, onClick, { variant = 'default', reasonId, adds = false } = {}) {
    const attrs = { 'data-adds': adds };
    if (allowed) return workspaceButton(doc, { text, variant, onClick, attrs });
    if (writable) return null;
    return workspaceButton(doc, { text, variant, disabled: true, attrs: { ...attrs, 'aria-describedby': reasonId } });
  }

  /** The actions with what the page says about them: why they are disabled, and that nothing is deleted. */
  function actionGroup({ label, buttons, notes = [], subject, reasonId, className = '' }) {
    const shown = buttons.filter(Boolean);
    const group = makeElement(doc, 'div', { className: `bb-pc-action-group${className ? ` ${className}` : ''}`, attrs: { role: 'group', 'aria-label': label } });
    if (shown.length > 0) {
      const row = makeElement(doc, 'div', { className: 'bb-pc-action-row' });
      row.append(...shown);
      group.append(row);
    }
    if (!writable && shown.length > 0) group.append(makeElement(doc, 'p', { className: 'bb-pc-action-reason', text: readOnlyText(subject), attrs: { id: reasonId } }));
    const shownNotes = notes.filter(Boolean);
    for (const note of shownNotes) group.append(typeof note === 'string' ? makeElement(doc, 'p', { className: 'bb-pc-action-note', text: note }) : note);
    return shown.length > 0 || shownNotes.length > 0 ? group : null;
  }

  function openCreateEntity(type) {
    // A host that places people in projects lists the ones a new person may join (`personProjects`).
    const projects = type === 'person' && state.list.state === 'ok' ? state.list.payload.personProjects ?? [] : [];
    correction.openCreateEntity({
      types: [type],
      typeNames: { person: '人', org: '会社' },
      title: type === 'org' ? '会社を加える' : '人を加える',
      subject: type === 'org' ? 'Graphに会社の記録を作ります。' : 'Graphに人の記録を作ります。',
      projects,
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
    const section = makeElement(doc, 'section', { className: 'bb-pc-people', attrs: { 'aria-label': '人', id: 'bb-pc-people' } });
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
      section.append(groupTitle('h3', `社内（${nameOf(groups.ownCompanyId)}）`, groups.internal.length));
      section.append(peopleLedger('社内の人', groups.internal, '自社に所属する人の記録はありません。'));
      section.append(groupTitle('h3', '社外', groups.external.reduce((sum, group) => sum + group.people.length, 0)));
      if (groups.external.length === 0) section.append(makeElement(doc, 'p', { className: 'bb-pc-empty', text: 'ほかの会社に所属する人の記録はありません。' }));
      for (const group of groups.external) {
        section.append(groupTitle('h4', group.company.name, group.people.length, { className: 'bb-pc-company-title', leading: companyMark(group.company.id, group.company.name) }));
        section.append(peopleLedger(`${group.company.name}の人`, group.people));
      }
    }
    section.append(groupTitle('h3', '所属未確認', groups.unknown.length));
    section.append(peopleLedger('所属未確認の人', groups.unknown, '所属が分からない人はいません。'));
    return section;
  }

  function companySection(payload) {
    const section = makeElement(doc, 'section', { className: 'bb-pc-companies', attrs: { 'aria-label': '会社', id: 'bb-pc-companies' } });
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
          { primary: company.id === payload.ownCompany.id ? `${company.name}（自社）` : company.name, leading: companyMark(company.id, company.name) },
          kindBadges(company),
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
    if (state.detail) return detailPage();
    const listed = state.list.state === 'ok' && !state.list.payload.absenceConfirmed;
    const addActions = listed
      ? actionGroup({
        label: '人と会社を加える',
        className: 'bb-pc-add',
        reasonId: 'bb-pc-add-reason',
        buttons: [
          actionButton('人を加える', can.createPerson, () => openCreateEntity('person'), { variant: 'primary', reasonId: 'bb-pc-add-reason', adds: true }),
          actionButton('会社を加える', can.createCompany, () => openCreateEntity('org'), { reasonId: 'bb-pc-add-reason', adds: true }),
        ],
      })
      : null;
    const children = [workspacePageHeader(doc, {
      crumbs: context.crumbs,
      title: '人と会社',
      lead: 'Graphに登録された人が、どの会社の人か、社内か社外か所属が分からないかを確かめます。行を押すと、その人・会社のページが開きます。',
      source: context.source,
    })];
    const hostNotice = sourceNotice ? workspaceHostNotice(doc, sourceNotice) : null;
    if (hostNotice) children.push(hostNotice);
    const notice = graphStateNotice(doc, state.list, { onRetry: () => void controller.load() });
    if (notice) return [...children, notice];
    const payload = state.list.payload;
    if (payload.absenceConfirmed) {
      // Nothing is listed yet, so creating the first record is the next step.
      const empty = graphHostEmptyNotice(doc, emptyNotice)
        ?? workspaceNotice(doc, { label: '未登録', tone: 'info', role: 'status', text: 'Graphに人と会社の記録はまだありません。' });
      const first = actionGroup({
        label: '人と会社を加える',
        className: 'bb-pc-add',
        reasonId: 'bb-pc-add-reason',
        buttons: [
          actionButton('人を加える', can.createPerson, () => openCreateEntity('person'), { variant: 'primary', reasonId: 'bb-pc-add-reason', adds: true }),
          actionButton('会社を加える', can.createCompany, () => openCreateEntity('org'), { reasonId: 'bb-pc-add-reason', adds: true }),
        ],
      });
      return [...children, empty, first, correction.render(doc)];
    }
    // A new record's form opens right under the buttons that open it.
    return [...children, addActions, correction.render(doc), jumpLinks(payload), peopleSection(payload), companySection(payload), endedNote(payload)];
  }

  // -------------------------------------------------------------------------
  // The record's page

  /** The listed records of the opened record's kind, in the order the ledgers show them. */
  function listedIds(type) {
    if (state.list.state !== 'ok') return [];
    const payload = state.list.payload;
    if (type === 'org') return payload.companies.filter((company) => company.active).map((company) => company.id);
    const groups = groupPeople(payload);
    return [...groups.internal, ...groups.external.flatMap((group) => group.people), ...groups.unknown].map((person) => person.id);
  }

  function backToList() {
    const id = state.detail?.id;
    correction.close();
    state.detail = null;
    pendingScroll = id ? { row: id } : null;
    controller.render();
  }

  function detailNav(entity) {
    const nav = makeElement(doc, 'nav', { className: 'bb-pc-detail-nav', attrs: { 'aria-label': '人と会社の一覧の中の位置' } });
    nav.append(button(doc, '← 人と会社の一覧へ', backToList, { className: 'bb-ws-button is-quiet bb-pc-back' }));
    const type = entity?.type === 'org' ? 'org' : 'person';
    const ids = listedIds(type);
    const index = entity ? ids.indexOf(entity.id) : -1;
    if (index >= 0) {
      const place = makeElement(doc, 'span', { className: 'bb-pc-detail-place' });
      place.append(
        makeElement(doc, 'span', { text: type === 'org' ? '会社' : '人' }),
        makeElement(doc, 'span', { className: 'bb-pc-count', text: `${index + 1} / ${ids.length}` }),
      );
      const step = (offset, text, label) => workspaceButton(doc, {
        text,
        variant: 'quiet',
        disabled: !ids[index + offset],
        attrs: { 'aria-label': label },
        onClick: () => { if (ids[index + offset]) void controller.openEntity(ids[index + offset]); },
      });
      nav.append(place, step(-1, '‹', '前へ'), step(1, '›', '次へ'));
    }
    return nav;
  }

  function detailHeadOf(entity, standing, company) {
    const head = makeElement(doc, 'header', { className: 'bb-pc-detail-head' });
    const mark = makeElement(doc, 'span', {
      className: `bb-pc-mark ${entity.type === 'org' ? 'bb-pc-company-mark' : 'bb-pc-person-mark'} bb-pc-tone-${markTone(entity.id)} bb-pc-detail-mark`,
      text: nameInitial(entity.name),
      attrs: { 'aria-hidden': 'true' },
    });
    const copy = makeElement(doc, 'div', { className: 'bb-pc-detail-copy' });
    const listed = state.list.state === 'ok' ? state.list.payload.people.find((person) => person.id === entity.id) : null;
    // The heading takes the focus when the page opens, so a keyboard or screen reader lands here.
    const title = makeElement(doc, 'h2', { text: listed?.isOwner ? `${entity.name}（あなた）` : entity.name, attrs: { tabindex: '-1' } });
    detailHead = title;
    const sub = [entity.type === 'org' ? '会社' : '人', standing, entity.type === 'org' && company ? `所属する人 ${company.memberIds.length}人` : null]
      .filter(Boolean).join(' · ');
    copy.append(title, makeElement(doc, 'p', { className: 'bb-pc-detail-sub', text: sub }));
    const summary = textOrNull(entity.summary);
    if (summary) copy.append(makeElement(doc, 'p', { className: 'bb-pc-detail-lead', text: summary }));
    head.append(mark, copy);
    return head;
  }

  /** What can be done to this record, gathered under its head. */
  function detailActions(entity, memberships) {
    const subject = { id: entity.id, type: entity.type, name: entity.name };
    const reasonId = 'bb-pc-detail-reason';
    const buttons = entity.type === 'org'
      ? [actionButton('所属する人を加える', can.addMembership, () => openMembership(entity), { variant: 'primary', reasonId, adds: true })]
      : [
        actionButton('所属を付ける', can.addMembership, () => openMembership(entity), { variant: 'primary', reasonId, adds: true }),
        ...memberships.filter((edge) => edge.active).map((edge) => actionButton(
          `「${edge.counterpart.name}」の所属を終える`,
          can.endMembership,
          () => openEndMembership(edge, entity),
          { reasonId },
        )),
      ];
    const fix = recordFixNote
      ? makeElement(doc, 'p', { className: 'bb-pc-action-note', text: recordFixNote })
      : (() => {
        const line = makeElement(doc, 'p', { className: 'bb-pc-action-note' });
        line.append(
          makeElement(doc, 'span', { text: '名前・別名・要約の間違いは、' }),
          makeElement(doc, 'a', { text: '情報と関係でこの記録を開いて直します', attrs: { href: correctionHref(entity.id) } }),
          makeElement(doc, 'span', { text: '。' }),
        );
        return line;
      })();
    const endNote = entity.type === 'org' && (can.endMembership || !writable)
      ? `${NO_DELETE_NOTE}所属する人の所属は、下の「所属する人」の各行で終えます。`
      : NO_DELETE_NOTE;
    return actionGroup({ label: entity.type === 'org' ? 'この会社への操作' : 'この人への操作', className: 'bb-pc-detail-actions', buttons, notes: [endNote, fix], subject, reasonId });
  }

  function detailFacts(entity, listed, company, ownId) {
    return workspaceDefinition(doc, [
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
      ['ID', entity.id],
    ]);
  }

  function detailBlock(title, content) {
    const block = makeElement(doc, 'section', { className: 'bb-pc-detail-block', attrs: { 'aria-label': title } });
    block.append(makeElement(doc, 'h3', { text: title }));
    for (const item of [content].flat()) if (item) block.append(item);
    return block;
  }

  function detailPage() {
    const detail = state.detail;
    detailTop = null;
    detailHead = null;
    const notice = graphStateNotice(doc, detail, { onRetry: () => void controller.openEntity(detail.id) });
    if (notice) {
      const nav = detailNav(null);
      detailTop = nav;
      return [nav, notice];
    }
    const { entity, outgoing, incoming } = detail.payload;
    const listed = state.list.state === 'ok' ? state.list.payload.people.find((person) => person.id === entity.id) : null;
    const ownId = state.list.state === 'ok' ? state.list.payload.ownCompany.id : null;
    const company = state.list.state === 'ok' && entity.type === 'org'
      ? state.list.payload.companies.find((item) => item.id === entity.id)
      : null;
    const standing = entity.type === 'person' && listed
      ? personStanding(listed, ownId)
      : entity.type === 'org' && entity.id === ownId ? '自社' : companyKindLabel(company) || null;
    const memberships = entity.type === 'org'
      ? incoming.filter((edge) => edge.relation === 'member_of')
      : outgoing.filter((edge) => edge.relation === 'member_of');
    const page = makeElement(doc, 'article', { className: 'bb-pc-detail', attrs: { 'aria-label': `${entity.type === 'org' ? '会社' : '人'}「${entity.name}」` } });
    detailTop = page;
    page.append(detailNav(entity), detailHeadOf(entity, standing, company));
    const actions = detailActions(entity, memberships);
    if (actions) page.append(actions);
    // A membership form opens right under the actions that open it.
    const panel = correction.render(doc);
    if (panel) page.append(panel);
    // Without a rail of the host's, the facts stay on the page.
    if (layout.inline) page.append(detailBlock('詳細', detailFacts(entity, listed, company, ownId)));
    if (entity.type === 'org') {
      page.append(
        detailBlock('所属する人', edgeList(memberships, '所属する人の記録はありません。', { actions: (edge) => membershipActions(edge, entity) })),
        detailBlock('この会社のプロジェクト', edgeList(incoming.filter((edge) => edge.relation === 'owned_by'), 'この会社のプロジェクトの記録はありません。')),
        detailBlock('顧客・協業先として関わるプロジェクト', edgeList(outgoing.filter((edge) => edge.relation === 'related_to'), '顧客・協業先として関わるプロジェクトの記録はありません。', { roleLabel: relatedRoleLabel })),
      );
      if (company && company.deals.length > 0) page.append(detailBlock('提案中の案件', dealList(company.deals)));
    } else {
      page.append(
        // A person's memberships are ended from the actions under the head.
        detailBlock('所属', edgeList(memberships, '会社への所属の記録はありません。')),
        detailBlock('関わるプロジェクト', edgeList(outgoing.filter((edge) => edge.relation === 'participates_in' || edge.relation === 'accountable_for'), '関わるプロジェクトの記録はありません。')),
      );
    }
    return [page];
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

  function openEndMembership(edge, entity) {
    const person = entity.type === 'org' ? edge.counterpart.name : entity.name;
    const company = entity.type === 'org' ? entity.name : edge.counterpart.name;
    correction.openEdge(edge, {
      mode: 'end',
      title: '所属を終える',
      subject: `${person}の「${company}」への所属に終了日を入れます。記録は消さずに残り、終了日から先は一覧に出ません。`,
    });
  }

  /** On a company's page, each member's row ends that membership (a person's page has it under the head). */
  function membershipActions(edge, entity) {
    if (!can.endMembership || !edge.active) return [];
    return [button(doc, '所属を終える', () => openEndMembership(edge, entity))];
  }

  function openMembership(entity) {
    const label = entity.type === 'org' ? '所属する人を加える' : '所属を付ける';
    correction.openCreate(
      { id: entity.id, type: entity.type, name: entity.name },
      {
        relations: ['member_of'],
        relationNames: { member_of: '所属' },
        relationLabel: '関わり方',
        title: label,
        subject: entity.type === 'org' ? `「${entity.name}」に所属する人を選びます。` : `${entity.name}が所属する会社を選びます。`,
      },
    );
  }

  /** The rail: a guide while the ledgers show, the opened record's facts while its page shows. */
  function railContent() {
    const detail = state.detail;
    if (!detail) {
      return [workspaceDetailEmpty(doc, { mark: '人', title: '人か会社を選んでください', text: '一覧の行を押すと、その人・会社のページが開き、所属と関わるプロジェクト、できる操作が出ます。' })];
    }
    if (layout.inline || detail.state !== 'ok') return [];
    const { entity } = detail.payload;
    const listed = state.list.state === 'ok' ? state.list.payload.people.find((person) => person.id === entity.id) : null;
    const ownId = state.list.state === 'ok' ? state.list.payload.ownCompany.id : null;
    const company = state.list.state === 'ok' && entity.type === 'org'
      ? state.list.payload.companies.find((item) => item.id === entity.id)
      : null;
    return [workspaceRailBlock(doc, { title: '詳細', content: detailFacts(entity, listed, company, ownId) })];
  }

  /** After a render: bring the opened record's head, or the row it was opened from, into view. */
  function settleScroll() {
    const target = pendingScroll;
    if (!target) return;
    if (target.head) {
      if (!detailTop) return;
      // Settled only once the record is read: a loading or failed page is shown, but the move waits.
      if (detailHead) pendingScroll = null;
      detailTop.scrollIntoView?.({ block: 'start' });
      detailHead?.focus?.({ preventScroll: true });
      return;
    }
    pendingScroll = null;
    const key = String(target.row).replace(/["\\]/gu, '\\$&');
    const row = root.querySelector?.(`[data-key="${key}"]`);
    row?.scrollIntoView?.({ block: 'center' });
    row?.focus?.({ preventScroll: true });
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
      settleScroll();
    },
    /** Back from a record's page to the ledgers, at the row it was opened from. */
    showList() {
      backToList();
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
    /**
     * Opens a record's page and moves to its head.  Choosing another record closes an open form
     * unless `keepCorrection`; reading the same record again (after a save) stays where it is.
     */
    async openEntity(id, { keepCorrection = false } = {}) {
      if (!keepCorrection && correction.form && state.detail?.id !== id) correction.close();
      if (state.detail?.id !== id) pendingScroll = { head: true };
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
