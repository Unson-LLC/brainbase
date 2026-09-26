/*
 * 「プロジェクトと関係者」: which projects exist, who takes part in or is
 * accountable for each one, and whether that record is right.
 *
 * Reads `GET {base}/projects` and `GET {base}/projects/:id` and corrects
 * through `POST {base}/corrections` (see `graph-view-shared.js`).  「関係者」
 * are the people recorded as taking part in or being accountable for a
 * project; they are not logins or sharing settings.  Participation ends with
 * an end date and is never deleted.  The host injects the fetcher, base path
 * and launch token; this module keeps no global state.
 */

import {
  activityBadge,
  badge,
  button,
  createGraphClient,
  createGraphCorrection,
  facts,
  getDocument,
  isEdgeView,
  isEntityView,
  makeElement,
  notice,
  recordDetails,
  relationLabel,
  renderCorrectionHistory,
  renderGraphIssues,
  renderGraphReadState,
  renderProvenance,
  textOrNull,
  validityText,
  GRAPH_RELATION_LABELS,
} from './graph-view-shared.js';

export const GRAPH_PROJECTS_VIEW_CONTRACT_VERSION = 'brainbase.graph-projects-view.v1';

/** The two ways a person is related to a project in the OSS Graph. */
export const PARTICIPATION_LABELS = Object.freeze({ participates_in: '参加', accountable_for: '責任' });

const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });

function isProjectItem(value) {
  return isEntityView(value) && value.type === 'project'
    && Number.isInteger(value.participantCount) && Number.isInteger(value.accountableCount);
}

function shellArg(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value);
}

/**
 * A project list is shown only when it is well formed.  An empty list is
 * `ok` only when the host confirmed that no project exists; otherwise the
 * absence is `unknown`, never zero items.
 */
export function normalizeProjectList(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  if (!Array.isArray(payload.projects) || !payload.projects.every(isProjectItem)) return INVALID;
  if (payload.projects.length === 0 && payload.absenceConfirmed !== true) return { state: 'unknown' };
  return { state: 'ok', payload };
}

export function normalizeProjectDetail(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  const project = payload.project;
  if (!isEntityView(project) || project.type !== 'project') return INVALID;
  if (!Array.isArray(payload.participants) || !payload.participants.every(isEdgeView)) return INVALID;
  if (payload.relations !== undefined && (!Array.isArray(payload.relations) || !payload.relations.every(isEdgeView))) return INVALID;
  return { state: 'ok', payload };
}

function block(doc, label, heading, lead) {
  const section = makeElement(doc, 'section', { className: 'bb-graph-block', attrs: { 'aria-label': label } });
  const head = makeElement(doc, 'div', { className: 'bb-graph-block-head' });
  head.append(makeElement(doc, 'h3', { className: 'bb-graph-heading', text: heading }));
  if (lead) head.append(makeElement(doc, 'p', { className: 'bb-graph-lead', text: lead }));
  section.append(head);
  return section;
}

function participantCountText(project) {
  return `${project.participantCount}人（うち責任を持つ人 ${project.accountableCount}人）`;
}

export function createGraphProjectsView({
  root,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph',
  token,
  tokenHeader,
  autoLoad = true,
  now = () => new Date(),
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const client = createGraphClient({ fetcher, basePath, token, ...(tokenHeader ? { tokenHeader } : {}) });
  const state = { list: { state: 'loading' }, listStale: false, detail: null };

  const correction = createGraphCorrection({
    client,
    now,
    rerender: () => controller.render(),
    onSaved: async () => {
      state.listStale = true;
      if (state.detail) await controller.loadDetail(state.detail.id, { keep: true });
    },
    onConflict: async () => {
      if (state.detail) await controller.loadDetail(state.detail.id, { keep: true });
    },
  });

  function renderList(surface) {
    const section = block(doc, 'プロジェクトの一覧', 'プロジェクトの一覧');
    surface.append(section);
    if (!renderGraphReadState(doc, section, state.list, { onRetry: () => controller.load() })) return;
    const { payload } = state.list;
    if (payload.projects.length === 0) {
      const box = makeElement(doc, 'div', { className: 'bb-graph-state is-muted', attrs: { role: 'status' } });
      const dir = textOrNull(payload.source?.dataDir);
      box.append(
        makeElement(doc, 'strong', { text: 'まだ登録がありません' }),
        makeElement(doc, 'p', { text: 'このGraphには、プロジェクトがまだ登録されていません。次のコマンドで登録できます。CodexやClaude Codeからは、MCPのオンボーディング（brainbase_onboarding_start）で資料から候補を作り、確かめてから登録できます。' }),
      );
      const commands = makeElement(doc, 'ol', { className: 'bb-graph-commands' });
      const item = makeElement(doc, 'li');
      item.append(makeElement(doc, 'code', { text: `brainbase onboard:projects --name <名前> --goal <目的> --write${dir ? ` --dir ${shellArg(dir)}` : ''}` }));
      commands.append(item);
      box.append(commands);
      section.append(box);
      return;
    }
    const list = makeElement(doc, 'ul', { className: 'bb-graph-list bb-gp-list' });
    for (const project of payload.projects) {
      const item = makeElement(doc, 'li', { className: `bb-graph-item${project.active ? '' : ' is-ended'}` });
      const head = makeElement(doc, 'div', { className: 'bb-graph-item-head' });
      head.append(button(doc, project.name, () => controller.openProject(project.id), { className: 'bb-graph-link' }));
      const badges = makeElement(doc, 'span', { className: 'bb-graph-badges' });
      if (textOrNull(project.status)) badges.append(badge(doc, project.status, 'accent'));
      badges.append(activityBadge(doc, project, payload.asOf));
      head.append(badges);
      item.append(head, facts(doc, [
        ['目的', textOrNull(project.goal) ?? '未記入'],
        ['関係者', participantCountText(project)],
        ['有効期間', validityText(project.validFrom, project.validTo)],
      ]));
      list.append(item);
    }
    section.append(list);
  }

  function participantRow(edge, project, asOf) {
    const row = makeElement(doc, 'tr', { className: edge.active ? '' : 'is-ended' });
    const cell = (label, ...children) => {
      const td = makeElement(doc, 'td', { attrs: { 'data-label': label } });
      td.append(...children);
      row.append(td);
      return td;
    };
    const person = makeElement(doc, 'span', { className: 'bb-graph-strong', text: edge.counterpart.name });
    cell('人物', person, ...(edge.counterpart.active === false ? [makeElement(doc, 'small', { className: 'bb-graph-help', text: '人物の記録は終了しています' })] : []));
    cell('関わり方', badge(doc, PARTICIPATION_LABELS[edge.relation] ?? relationLabel(edge.relation), edge.relation === 'accountable_for' ? 'accent' : ''));
    const role = makeElement(doc, 'span', { text: textOrNull(edge.role) ?? '未記入', className: textOrNull(edge.role) ? '' : 'bb-graph-muted' });
    cell('役割', role, ...(textOrNull(edge.context) ? [makeElement(doc, 'small', { className: 'bb-graph-help', text: edge.context })] : []));
    cell('有効期間', makeElement(doc, 'span', { text: validityText(edge.validFrom, edge.validTo) }), activityBadge(doc, edge, asOf));
    cell('出典', renderProvenance(doc, edge.provenance), recordDetails(doc, [['関係ID', edge.id], ['人物ID', edge.counterpart.id], ['digest', edge.digest]]));
    const subject = `${edge.counterpart.name}（${PARTICIPATION_LABELS[edge.relation] ?? relationLabel(edge.relation)}、${project.name}）`;
    const actions = makeElement(doc, 'div', { className: 'bb-graph-row-actions' });
    actions.append(button(doc, '役割を直す', () => correction.openEdge(edge, { mode: 'role', subject })));
    actions.append(edge.active
      ? button(doc, '関わりを終える', () => correction.openEdge(edge, { mode: 'end', subject }))
      : button(doc, '終了日を直す', () => correction.openEdge(edge, { mode: 'end', title: '終了日を直す', subject })));
    cell('直す', actions);
    return row;
  }

  function renderParticipants(surface, payload) {
    const { project } = payload;
    const section = block(doc, '関係者', '関係者', '参加している人と、責任を持つ人です。終わった関わりも、終了日つきで残ります。');
    const head = section.children[0];
    head.append(button(doc, '関係者を加える', () => correction.openCreate(project, {
      relations: ['participates_in', 'accountable_for'],
      relationNames: PARTICIPATION_LABELS,
      relationLabel: '関わり方',
      title: '関係者を加える',
      subject: `プロジェクト「${project.name}」`,
    }), { className: 'bb-graph-button is-primary' }));
    if (payload.participants.length === 0) {
      section.append(notice(doc, 'muted', 'このプロジェクトには、まだ関係者の登録がありません。'));
    } else {
      const table = makeElement(doc, 'table', { className: 'bb-graph-table bb-gp-participants' });
      const thead = makeElement(doc, 'thead');
      const headRow = makeElement(doc, 'tr');
      for (const label of ['人物', '関わり方', '役割', '有効期間', '出典', '直す']) headRow.append(makeElement(doc, 'th', { text: label, attrs: { scope: 'col' } }));
      thead.append(headRow);
      const tbody = makeElement(doc, 'tbody');
      for (const edge of payload.participants) tbody.append(participantRow(edge, project, payload.asOf));
      table.append(thead, tbody);
      section.append(table);
    }
    surface.append(section);
  }

  function renderOtherRelations(surface, payload) {
    const relations = Array.isArray(payload.relations) ? payload.relations : [];
    if (relations.length === 0) return;
    const section = block(doc, 'そのほかの関係', 'そのほかの関係', '所有する組織や、進め方を決める判断などです。直すときは「情報と関係」を使います。');
    const list = makeElement(doc, 'ul', { className: 'bb-graph-plain-list' });
    for (const edge of relations) {
      const labels = GRAPH_RELATION_LABELS[edge.relation];
      const phrase = labels ? (edge.direction === 'outgoing' ? labels.outgoing : labels.incoming) : '';
      const item = makeElement(doc, 'li');
      item.append(badge(doc, relationLabel(edge.relation), 'muted'), makeElement(doc, 'span', { text: ` ${edge.counterpart.name}${phrase}` }), activityBadge(doc, edge, payload.asOf));
      list.append(item);
    }
    section.append(list);
    surface.append(section);
  }

  function renderDetail(surface) {
    const detail = state.detail;
    surface.append(button(doc, '← プロジェクトの一覧に戻る', () => controller.showList(), { className: 'bb-graph-back' }));
    if (detail.state !== 'ok') {
      const section = block(doc, 'プロジェクトの詳細', 'プロジェクトの詳細');
      renderGraphReadState(doc, section, detail, { onRetry: () => controller.loadDetail(detail.id) });
      surface.append(section);
      return;
    }
    const { payload } = detail;
    const { project } = payload;
    const issues = renderGraphIssues(doc, payload.issues);
    if (issues) surface.append(issues);

    const summary = makeElement(doc, 'section', { className: 'bb-graph-block', attrs: { 'aria-label': 'プロジェクトの詳細' } });
    const head = makeElement(doc, 'div', { className: 'bb-graph-block-head' });
    const title = makeElement(doc, 'div', { className: 'bb-graph-title-row' });
    title.append(makeElement(doc, 'h3', { className: 'bb-graph-title', text: project.name }));
    const badges = makeElement(doc, 'span', { className: 'bb-graph-badges' });
    if (textOrNull(project.status)) badges.append(badge(doc, project.status, 'accent'));
    badges.append(activityBadge(doc, project, payload.asOf));
    title.append(badges);
    head.append(title, button(doc, 'プロジェクトを直す', () => correction.openEntity(project, {
      fields: ['name', 'goal', 'status'],
      title: 'プロジェクトを直す',
      subject: `プロジェクト「${project.name}」の名前・目的・状態`,
    })));
    summary.append(head);
    const principles = Array.isArray(project.decisionPrinciples) ? project.decisionPrinciples.filter((item) => typeof item === 'string' && item.trim()) : [];
    let principleList = null;
    if (principles.length > 0) {
      principleList = makeElement(doc, 'ul', { className: 'bb-graph-plain-list' });
      for (const principle of principles) principleList.append(makeElement(doc, 'li', { text: principle }));
    }
    summary.append(facts(doc, [
      ['目的', textOrNull(project.goal) ?? '未記入'],
      ['状態', textOrNull(project.status) ?? '未記入'],
      ['判断の原則', principleList ?? 'まだ登録がありません'],
      ['要約', textOrNull(project.summary)],
      ['別名', project.aliases.length > 0 ? project.aliases.join('、') : null],
      ['有効期間', validityText(project.validFrom, project.validTo)],
    ]));
    summary.append(recordDetails(doc, [['プロジェクトID', project.id], ['digest', project.digest], ['読み取った時点', payload.asOf]]));
    surface.append(summary);

    const panel = correction.render(doc);
    if (panel) surface.append(panel);

    renderParticipants(surface, payload);
    renderOtherRelations(surface, payload);
    const history = renderCorrectionHistory(doc, payload.history);
    if (history) surface.append(history);
  }

  const controller = {
    get state() { return state; },
    get correction() { return correction; },
    render() {
      root.replaceChildren();
      const surface = makeElement(doc, 'section', {
        className: 'bb-graph bb-gp',
        attrs: { 'data-contract-version': GRAPH_PROJECTS_VIEW_CONTRACT_VERSION, 'aria-label': 'プロジェクトと関係者' },
      });
      const header = makeElement(doc, 'header', { className: 'bb-graph-header' });
      header.append(
        makeElement(doc, 'h2', { text: 'プロジェクトと関係者' }),
        makeElement(doc, 'p', { className: 'bb-graph-lead', text: 'どのプロジェクトに誰がどう関わっているかを確かめ、誤りを直します。関係者は、参加している人や責任を持つ人の記録で、ログインや共有の設定ではありません。' }),
      );
      surface.append(header);
      if (state.detail) renderDetail(surface);
      else renderList(surface);
      root.append(surface);
      return controller;
    },
    async load() {
      state.list = { state: 'loading' };
      state.listStale = false;
      controller.render();
      state.list = normalizeProjectList(await client.read('/projects'));
      controller.render();
      return state.list;
    },
    /** `keep` shows the current detail until the new one has been read. */
    async loadDetail(id, { keep = false } = {}) {
      const previous = state.detail;
      if (!(keep && previous?.id === id && previous.state === 'ok')) {
        state.detail = { id, state: 'loading' };
        controller.render();
      }
      const result = await client.read(`/projects/${encodeURIComponent(id)}`);
      if (state.detail?.id !== id) return state.detail;
      state.detail = result.state === 'error' && result.status === 404
        ? { id, state: 'not_found', reason: 'このプロジェクトは見つかりません。一覧に戻って読み直してください。' }
        : { id, ...normalizeProjectDetail(result) };
      controller.render();
      return state.detail;
    },
    async openProject(id) {
      if (correction.form) correction.close();
      return controller.loadDetail(id);
    },
    async showList() {
      state.detail = null;
      if (correction.form) correction.close();
      if (state.listStale || state.list.state !== 'ok') return controller.load();
      controller.render();
      return state.list;
    },
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default createGraphProjectsView;
