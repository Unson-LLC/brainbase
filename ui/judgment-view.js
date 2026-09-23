/*
 * Shared read-only judgment trace surface.
 *
 * The host supplies the historical judgment-view response and, optionally, a
 * same-origin request function.  This module owns presentation only: it does
 * not select a tenant, copy member/RACI data, or turn unresolved data into an
 * empty state.
 */

export const JUDGMENT_VIEW_UI_CONTRACT_VERSION = 'judgment-view-ui.v1';

const STATUSES = Object.freeze(['resolved', 'unknown', 'permission_denied', 'unavailable', 'undecidable', 'invalid']);
const STATUS_LABELS = Object.freeze({
  resolved: '確認済み',
  unknown: '未確認',
  permission_denied: '権限不足',
  unavailable: '取得できません',
  undecidable: '判定不能',
  invalid: '記録不正',
});
const CHILD_STATUS_LABELS = Object.freeze({ completed: '完了', failed: '失敗', held: '保留' });
const ACHIEVEMENT_LABELS = Object.freeze({ achieved: '達成', not_achieved: '未達成', indeterminate: '判定不能' });
const VALIDITY_LABELS = Object.freeze({ valid: '妥当', invalid: '不妥当', indeterminate: '判定不能' });

function getDocument(explicit) {
  const value = explicit ?? (typeof document === 'undefined' ? null : document);
  if (!value || typeof value.createElement !== 'function') throw new Error('document_unavailable');
  return value;
}

function makeElement(doc, tag, { className, text, attrs = {} } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  return element;
}

function append(parent, ...children) {
  parent.append(...children.filter((child) => child !== null && child !== undefined));
  return parent;
}

function clear(parent) {
  parent.replaceChildren();
  return parent;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function status(value) {
  return STATUSES.includes(value) ? value : 'unknown';
}

function label(value, fallback = '未確認') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function jsonValue(value) {
  if (value === undefined) return '未確認';
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? '未確認' : serialized;
  } catch {
    return '未確認';
  }
}

function statusText(value) {
  const normalized = status(value);
  return STATUS_LABELS[normalized] ?? '未確認';
}

function normalizeSection(value) {
  if (!isRecord(value) || !STATUSES.includes(value.status)) return { status: 'unknown', reason: '表示データが不正です' };
  if (value.status === 'resolved' && !Object.hasOwn(value, 'value')) return { status: 'unknown', reason: '表示データが不足しています' };
  return value.status === 'resolved'
    ? { status: 'resolved', value: value.value }
    : { status: value.status, ...(nonEmpty(value.reason) ? { reason: value.reason } : {}) };
}

function normalizeCollection(value, itemValidator = () => true) {
  if (!isRecord(value) || !STATUSES.includes(value.status)) {
    return { status: 'unknown', items: null, absence_confirmed: false, reason: '一覧データが不正です' };
  }
  if (value.status === 'resolved') {
    if (!Array.isArray(value.items) || typeof value.absence_confirmed !== 'boolean' || value.items.some((item) => !itemValidator(item))) {
      return { status: 'unknown', items: null, absence_confirmed: false, reason: '一覧データが不正です' };
    }
    if (value.items.length === 0 && value.absence_confirmed !== true) {
      return { status: 'unknown', items: null, absence_confirmed: false, reason: '空であることを確認できません' };
    }
    return { status: 'resolved', items: value.items, absence_confirmed: value.items.length === 0 };
  }
  if (value.items !== null || value.absence_confirmed !== false) {
    return { status: 'unknown', items: null, absence_confirmed: false, reason: '未確認の一覧を空として扱えません' };
  }
  return { status: value.status, items: null, absence_confirmed: false, ...(nonEmpty(value.reason) ? { reason: value.reason } : {}) };
}

function validRef(value) {
  return isRecord(value) && nonEmpty(value.id) && nonEmpty(value.type) && nonEmpty(value.revision) && nonEmpty(value.digest);
}

function validReferenceItem(value) {
  return isRecord(value) && nonEmpty(value.kind) && nonEmpty(value.id) && nonEmpty(value.revision) && nonEmpty(value.digest);
}

function validChild(value) {
  return isRecord(value) && nonEmpty(value.invocationId) && isRecord(value.dag) && nonEmpty(value.dag.id)
    && nonEmpty(value.dag.version) && ['completed', 'failed', 'held'].includes(value.status);
}

function validEvidence(value) {
  return isRecord(value) && value.source === 'subdag' && nonEmpty(value.invocationId) && nonEmpty(value.kind) && nonEmpty(value.id);
}

function validCriterion(value) {
  return isRecord(value)
    && validRef(value.variableRef)
    && value.variableRef.type === 'variable'
    && isRecord(value.variable);
}

function validResultEvaluation(value) {
  return isRecord(value) && nonEmpty(value.evaluationId)
    && ['achieved', 'not_achieved', 'indeterminate'].includes(value.achievement)
    && Array.isArray(value.criteria) && Array.isArray(value.predictionComparisons)
    && nonEmpty(value.evaluatedAt);
}

function validJudgmentValidity(value) {
  return isRecord(value) && ['valid', 'invalid', 'indeterminate'].includes(value.status)
    && nonEmpty(value.basis) && Array.isArray(value.evidenceRefs) && value.evidenceRefs.every(nonEmpty);
}

/**
 * Normalize the boundary without dropping malformed collection members.  A
 * single malformed member makes the collection unknown so the UI cannot claim
 * a complete list from a filtered response.
 */
export function normalizeJudgmentView(input) {
  if (!isRecord(input) || input.mode !== 'historical') {
    return { contract_version: JUDGMENT_VIEW_UI_CONTRACT_VERSION, mode: 'historical', status: 'unknown', reason: '判断記録を確認できません' };
  }
  const run = normalizeSection(input.run);
  const conclusion = normalizeSection(input.conclusion);
  const problem = normalizeSection(input.problem);
  const objective = normalizeSection(input.objective);
  const evidence = normalizeCollection(input.evidence, validEvidence);
  const childRuns = normalizeCollection(input.childRuns, validChild);
  const resultEvaluation = normalizeSection(input.resultEvaluation);
  const judgmentValidity = normalizeSection(input.judgmentValidity);
  const normalizedObjective = objective.status === 'resolved'
    && isRecord(objective.value)
    && validRef(objective.value.ref)
    && nonEmpty(objective.value.meaning)
    && nonEmpty(objective.value.desiredState)
    ? {
      ...objective,
      value: {
        ...objective.value,
        criteria: normalizeCollection(objective.value.criteria, validCriterion),
      },
    }
    : objective;
  const normalizedEvaluation = resultEvaluation.status === 'resolved' && validResultEvaluation(resultEvaluation.value)
    ? resultEvaluation
    : resultEvaluation.status === 'resolved'
      ? { status: 'unknown', reason: '成果評価の表示データが不正です' }
      : resultEvaluation;
  const normalizedValidity = judgmentValidity.status === 'resolved' && validJudgmentValidity(judgmentValidity.value)
    ? judgmentValidity
    : judgmentValidity.status === 'resolved'
      ? { status: 'unknown', reason: '判断妥当性の表示データが不正です' }
      : judgmentValidity;
  return {
    ...input,
    contract_version: JUDGMENT_VIEW_UI_CONTRACT_VERSION,
    mode: 'historical',
    status: status(input.status),
    run,
    conclusion,
    problem,
    objective: normalizedObjective,
    evidence,
    childRuns,
    resultEvaluation: normalizedEvaluation,
    judgmentValidity: normalizedValidity,
  };
}

function statusNotice(doc, section, title) {
  const state = status(section?.status);
  const notice = makeElement(doc, 'p', { className: `judgment-view-notice is-${state}`, attrs: { role: 'status' } });
  notice.textContent = `${title}: ${statusText(state)}${nonEmpty(section?.reason) ? `（${section.reason}）` : ''}`;
  return notice;
}

function refText(ref) {
  if (!isRecord(ref)) return '未確認';
  return `${label(ref.type)} / ${label(ref.id)} @ ${label(ref.revision)}${ref.digest ? ` / ${label(ref.digest)}` : ''}`;
}

function renderReferenceList(doc, parent, references) {
  const list = makeElement(doc, 'ul', { className: 'judgment-view-reference-list' });
  for (const reference of references) {
    list.append(makeElement(doc, 'li', { text: `${label(reference.kind)}: ${refText(reference)}` }));
  }
  parent.append(list);
}

function renderConclusion(doc, root, section) {
  const panel = makeElement(doc, 'section', { className: 'judgment-view-panel judgment-view-conclusion', attrs: { 'aria-labelledby': 'judgment-view-conclusion-heading' } });
  panel.append(makeElement(doc, 'h2', { text: '結論', attrs: { id: 'judgment-view-conclusion-heading' } }));
  if (section.status !== 'resolved') {
    panel.append(statusNotice(doc, section, '結論'));
  } else {
    panel.append(makeElement(doc, 'pre', { className: 'judgment-view-conclusion-value', text: jsonValue(section.value?.value) }));
    const linkRow = makeElement(doc, 'p', { className: 'judgment-view-link-row' });
    panel.append(linkRow);
    const link = makeElement(doc, 'a', { text: '根拠へ移動', attrs: { href: '#judgment-view-evidence' } });
    linkRow.append(link);
  }
  root.append(panel);
}

function renderProblem(doc, root, section) {
  const panel = makeElement(doc, 'section', { className: 'judgment-view-panel', attrs: { 'aria-labelledby': 'judgment-view-problem-heading' } });
  panel.append(makeElement(doc, 'h2', { text: '判断時点のProblem', attrs: { id: 'judgment-view-problem-heading' } }));
  if (section.status !== 'resolved') {
    panel.append(statusNotice(doc, section, 'Problem'));
  } else {
    const value = section.value;
    panel.append(makeElement(doc, 'p', { className: 'judgment-view-question', text: label(value?.question) }));
    const meta = makeElement(doc, 'dl', { className: 'judgment-view-meta' });
    for (const [term, detail] of [
      ['Snapshot', `${label(value?.snapshotId)} / ${label(value?.problemId)} @ ${label(value?.revision)}`],
      ['参照モード', '当時版（historical）'],
    ]) {
      meta.append(makeElement(doc, 'dt', { text: term }), makeElement(doc, 'dd', { text: detail }));
    }
    panel.append(meta);
    const references = Array.isArray(value?.references) ? value.references : null;
    if (references) {
      panel.append(makeElement(doc, 'h3', { text: '固定された参照' }));
      renderReferenceList(doc, panel, references);
    }
  }
  root.append(panel);
}

function renderObjective(doc, root, section) {
  const panel = makeElement(doc, 'section', { className: 'judgment-view-panel', attrs: { 'aria-labelledby': 'judgment-view-objective-heading' } });
  panel.append(makeElement(doc, 'h2', { text: '当時のObjective', attrs: { id: 'judgment-view-objective-heading' } }));
  if (section.status !== 'resolved') {
    panel.append(statusNotice(doc, section, 'Objective'));
  } else {
    const value = section.value;
    panel.append(makeElement(doc, 'p', { className: 'judgment-view-objective-state', text: label(value?.desiredState) }));
    panel.append(makeElement(doc, 'p', { text: label(value?.meaning) }));
    panel.append(makeElement(doc, 'p', { className: 'judgment-view-muted', text: `定義版: ${refText(value?.ref)} / 採用状態: ${label(value?.adoptionState)} / 認識状態: ${label(value?.epistemicState)}` }));
    const criteria = value?.criteria;
    panel.append(makeElement(doc, 'h3', { text: '達成基準' }));
    if (!criteria || criteria.status !== 'resolved') {
      panel.append(statusNotice(doc, criteria, '達成基準'));
    } else if (criteria.items.length === 0) {
      panel.append(makeElement(doc, 'p', { className: 'judgment-view-muted', text: '達成基準は記録されていません。' }));
    } else {
      const list = makeElement(doc, 'ul', { className: 'judgment-view-criteria' });
      for (const criterion of criteria.items) {
        list.append(makeElement(doc, 'li', { text: `${refText(criterion.variableRef)} / ${label(criterion.operator)} / 目標: ${label(criterion.target)}` }));
      }
      panel.append(list);
    }
  }
  root.append(panel);
}

function renderEvidence(doc, root, collection) {
  const panel = makeElement(doc, 'section', { className: 'judgment-view-panel', attrs: { id: 'judgment-view-evidence', 'aria-labelledby': 'judgment-view-evidence-heading' } });
  panel.append(makeElement(doc, 'h2', { text: '根拠の参照記録', attrs: { id: 'judgment-view-evidence-heading' } }));
  if (collection.status !== 'resolved') {
    panel.append(statusNotice(doc, collection, '根拠'));
  } else if (collection.items.length === 0) {
    panel.append(makeElement(doc, 'p', { className: 'judgment-view-notice is-unknown', text: '根拠の参照記録はありません（空成功ではありません）。', attrs: { role: 'status' } }));
  } else {
    const list = makeElement(doc, 'ul', { className: 'judgment-view-evidence-list' });
    for (const item of collection.items) {
      list.append(makeElement(doc, 'li', { text: `${label(item.kind)} / ${label(item.id)}${item.revision ? ` @ ${label(item.revision)}` : ''}（${label(item.invocationId)}）` }));
    }
    panel.append(list);
  }
  root.append(panel);
}

function renderChildRuns(doc, root, collection) {
  const panel = makeElement(doc, 'section', { className: 'judgment-view-panel', attrs: { 'aria-labelledby': 'judgment-view-child-heading' } });
  panel.append(makeElement(doc, 'h2', { text: '下位判断', attrs: { id: 'judgment-view-child-heading' } }));
  if (collection.status !== 'resolved') {
    panel.append(statusNotice(doc, collection, '下位判断'));
  } else if (collection.items.length === 0) {
    panel.append(makeElement(doc, 'p', { className: 'judgment-view-muted', text: '下位判断はありません。' }));
  } else {
    const list = makeElement(doc, 'ul', { className: 'judgment-view-child-list' });
    for (const child of collection.items) {
      const item = makeElement(doc, 'li', { className: `judgment-view-child is-${child.status}` });
      item.append(makeElement(doc, 'strong', { text: `${label(child.invocationId)} — ${CHILD_STATUS_LABELS[child.status] ?? child.status}` }));
      item.append(makeElement(doc, 'span', { text: `${label(child.dag.id)} @ ${label(child.dag.version)}: ${label(child.question)}` }));
      if (child.status !== 'completed' && nonEmpty(child.reason)) item.append(makeElement(doc, 'span', { className: 'judgment-view-muted', text: child.reason }));
      list.append(item);
    }
    panel.append(list);
  }
  root.append(panel);
}

function renderEvaluation(doc, root, resultEvaluation, judgmentValidity) {
  const panel = makeElement(doc, 'section', { className: 'judgment-view-panel', attrs: { 'aria-labelledby': 'judgment-view-evaluation-heading' } });
  panel.append(makeElement(doc, 'h2', { text: '結果評価と判断妥当性', attrs: { id: 'judgment-view-evaluation-heading' } }));
  const result = makeElement(doc, 'div', { className: 'judgment-view-evaluation-block' });
  result.append(makeElement(doc, 'h3', { text: '結果の達成度' }));
  if (resultEvaluation.status !== 'resolved') result.append(statusNotice(doc, resultEvaluation, '結果評価'));
  else result.append(makeElement(doc, 'p', { text: `${ACHIEVEMENT_LABELS[resultEvaluation.value.achievement] ?? '判定不能'}（評価ID: ${label(resultEvaluation.value.evaluationId)}）` }));
  const validity = makeElement(doc, 'div', { className: 'judgment-view-evaluation-block' });
  validity.append(makeElement(doc, 'h3', { text: '判断時点の妥当性' }));
  if (judgmentValidity.status !== 'resolved') validity.append(statusNotice(doc, judgmentValidity, '判断妥当性'));
  else {
    validity.append(makeElement(doc, 'p', { text: `${VALIDITY_LABELS[judgmentValidity.value.status] ?? '判定不能'}: ${label(judgmentValidity.value.basis)}` }));
    if (judgmentValidity.value.evidenceRefs.length > 0) validity.append(makeElement(doc, 'p', { className: 'judgment-view-muted', text: `妥当性の根拠参照: ${judgmentValidity.value.evidenceRefs.join(', ')}` }));
  }
  panel.append(result, validity);
  root.append(panel);
}

/** Render one normalized document into a host-owned root. */
export function renderJudgmentView(root, input, options = {}) {
  const doc = getDocument(options.document);
  const model = normalizeJudgmentView(input);
  clear(root);
  const surface = makeElement(doc, 'section', { className: 'judgment-view', attrs: { 'data-contract-version': JUDGMENT_VIEW_UI_CONTRACT_VERSION } });
  const header = makeElement(doc, 'header', { className: 'judgment-view-header' });
  header.append(makeElement(doc, 'div', { className: 'judgment-view-kicker', text: 'BRAINBASE / JUDGMENT TRACE' }));
  header.append(makeElement(doc, 'h1', { text: '判断の追跡' }));
  header.append(makeElement(doc, 'p', { className: 'judgment-view-mode', text: '当時版（historical）を表示しています。現在版で補完しません。' }));
  header.append(makeElement(doc, 'span', { className: `judgment-view-status is-${model.status}`, text: statusText(model.status), attrs: { role: 'status' } }));
  surface.append(header);
  if (nonEmpty(model.reason)) surface.append(makeElement(doc, 'p', { className: 'judgment-view-notice is-unknown', text: model.reason, attrs: { role: 'status' } }));
  if (model.run.status === 'resolved' && isRecord(model.run.value)) {
    const run = makeElement(doc, 'p', { className: 'judgment-view-run-meta', text: `Run: ${label(model.run.value.runId)} / 構成版: ${label(model.run.value.composition?.id)} @ ${label(model.run.value.composition?.version)} / 状態: ${CHILD_STATUS_LABELS[model.run.value.status] ?? label(model.run.value.status)}` });
    surface.append(run);
  } else surface.append(statusNotice(doc, model.run, 'Run'));
  renderConclusion(doc, surface, model.conclusion);
  renderProblem(doc, surface, model.problem);
  renderObjective(doc, surface, model.objective);
  renderEvidence(doc, surface, model.evidence);
  renderChildRuns(doc, surface, model.childRuns);
  renderEvaluation(doc, surface, model.resultEvaluation, model.judgmentValidity);
  root.append(surface);
  return surface;
}

function buildPath(runId, evaluationId, basePath = '/judgment-views') {
  const path = `${String(basePath).replace(/\/+$/u, '')}/${encodeURIComponent(runId)}`;
  return evaluationId ? `${path}?evaluationId=${encodeURIComponent(evaluationId)}` : path;
}

export function createJudgmentViewUI({ root, document: explicitDocument, api, fetcher, runId, evaluationId, basePath, autoLoad = true } = {}) {
  if (!root) throw new TypeError('root is required');
  if (!nonEmpty(runId)) throw new TypeError('runId is required');
  const doc = getDocument(explicitDocument);
  const read = typeof api === 'function' ? api : api && typeof api.read === 'function' ? (path) => api.read(path) : null;
  const request = read ?? (typeof fetcher === 'function' ? fetcher : typeof globalThis.fetch === 'function' ? (path) => globalThis.fetch(path) : null);
  const state = { model: normalizeJudgmentView({ mode: 'historical', status: 'unknown' }), loading: false, error: null };
  const controller = {
    get state() { return state; },
    render() { renderJudgmentView(root, state.model, { document: doc }); return controller; },
    async load() {
      if (!request) {
        state.model = normalizeJudgmentView({ mode: 'historical', status: 'unavailable', reason: '判断ビューのAPIが未設定です' });
        state.error = 'api_unavailable';
        controller.render();
        return state.model;
      }
      state.loading = true;
      controller.render();
      try {
        const response = await request(buildPath(runId, evaluationId, basePath));
        const body = response && typeof response.json === 'function' ? await response.json() : response;
        state.model = normalizeJudgmentView(body);
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'request_failed';
        state.model = normalizeJudgmentView({ mode: 'historical', status: 'unavailable', reason: '判断ビューを取得できません' });
      } finally {
        state.loading = false;
      }
      controller.render();
      return state.model;
    },
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default renderJudgmentView;
