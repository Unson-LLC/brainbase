/*
 * Optional host projection for the first project overview surface.
 *
 * This module only renders values supplied by an authorized host. It does not
 * derive relationships, counts, next actions, or material membership from the
 * shared Graph payload.
 */

import { formatDateTime, makeElement, textOrNull } from './graph-view-shared.js';
import { workspaceNotice } from './workspace-kit.js';

const MATERIAL_STATES = new Set(['ok', 'partial', 'unknown', 'failed', 'unavailable', 'loading']);
const BODY_STATES = new Set(['retrieved', 'unretrieved', 'unavailable', 'failed', 'unknown']);

const MATERIAL_STATE_LABELS = Object.freeze({
  ok: '取得済み',
  partial: '一部取得',
  unknown: '未確認',
  failed: '読み取り失敗',
  unavailable: '未接続',
  loading: '読み込み中',
});

const BODY_STATE_LABELS = Object.freeze({
  retrieved: '本文取得済み',
  unretrieved: '本文未取得',
  unavailable: '本文未接続',
  failed: '本文読取失敗',
  unknown: '本文状態未確認',
});

function cleanText(value) {
  return textOrNull(value);
}

function normalizeTotal(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value);
  return null;
}

function normalizeDate(value) {
  return cleanText(value);
}

function normalizeMaterialItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = cleanText(item.id);
  const title = cleanText(item.title) ?? (id ? id : '資料名未確認');
  const relation = cleanText(item.relation);
  const source = cleanText(item.source);
  const bodyState = BODY_STATES.has(item.bodyState) ? item.bodyState : 'unknown';
  const contentAsOf = normalizeDate(item.contentAsOf);
  const updatedAt = normalizeDate(item.updatedAt);
  if (!id && !relation && !source && !contentAsOf && !updatedAt && bodyState === 'unknown' && title === '資料名未確認') return null;
  return { id, title, relation, source, bodyState, contentAsOf, updatedAt };
}

function normalizeMaterials(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const state = MATERIAL_STATES.has(input.state) ? input.state : 'unknown';
  return {
    state,
    items: Array.isArray(input.items) ? input.items.map(normalizeMaterialItem).filter(Boolean) : [],
    total: normalizeTotal(input.total),
    note: cleanText(input.note),
  };
}

function normalizeCheck(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = cleanText(item.id);
  const title = cleanText(item.title) ?? (id ? id : '確認事項未確認');
  return {
    id,
    title,
    summary: cleanText(item.summary),
    recordId: cleanText(item.recordId),
  };
}

function normalizeAbout(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    definition: cleanText(input.definition),
    owner: cleanText(input.owner),
    finalApprover: cleanText(input.finalApprover),
    goal: cleanText(input.goal),
    source: cleanText(input.source),
    asOf: normalizeDate(input.asOf),
  };
}

/**
 * Normalize the optional host projection without turning malformed or missing
 * fields into successful empty data.
 */
export function normalizeProjectOverview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    about: normalizeAbout(value.about),
    checks: Array.isArray(value.checks) ? value.checks.map(normalizeCheck).filter(Boolean) : [],
    directMaterials: normalizeMaterials(value.directMaterials),
    relatedMaterials: normalizeMaterials(value.relatedMaterials),
  };
}

function displayDate(value) {
  if (!value) return '未確認';
  return Number.isNaN(Date.parse(value)) ? '日時未確認' : formatDateTime(value);
}

function stateLabel(state) {
  return MATERIAL_STATE_LABELS[state] ?? '未確認';
}

function renderAbout(doc, about) {
  const section = makeElement(doc, 'section', {
    className: 'bb-pkw-overview-section bb-pkw-overview-about',
    attrs: { 'aria-label': 'このプロジェクトについて' },
  });
  section.append(makeElement(doc, 'h3', { text: 'このプロジェクトについて' }));
  const facts = makeElement(doc, 'dl', { className: 'bb-pkw-overview-facts' });
  for (const [label, value] of [
    ['何のプロジェクトか', about.definition],
    ['責任者', about.owner],
    ['最終決裁', about.finalApprover],
    ['現在の目標', about.goal],
  ]) {
    const row = makeElement(doc, 'div', { className: 'bb-pkw-overview-fact' });
    row.append(makeElement(doc, 'dt', { text: label }), makeElement(doc, 'dd', { text: value ?? '未確認' }));
    facts.append(row);
  }
  section.append(facts);
  const metadata = makeElement(doc, 'p', { className: 'bb-pkw-overview-meta' });
  metadata.append(
    makeElement(doc, 'span', { text: `出典: ${about.source ?? '未確認'}` }),
    makeElement(doc, 'span', { text: `読み取った時点: ${displayDate(about.asOf)}` }),
  );
  section.append(metadata);
  return section;
}

function renderChecks(doc, checks, actions = {}) {
  const section = makeElement(doc, 'section', {
    className: 'bb-pkw-overview-section bb-pkw-overview-checks',
    attrs: { 'aria-label': '次に確認すること' },
  });
  section.append(makeElement(doc, 'h3', { text: '次に確認すること' }));
  if (checks.length === 0) {
    section.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: '確認事項は未確認です。' }));
    return section;
  }
  const list = makeElement(doc, 'ol', { className: 'bb-pkw-overview-check-list' });
  for (const check of checks) {
    const item = makeElement(doc, 'li', { className: 'bb-pkw-overview-check' });
    // `id` identifies the host-side check; it is not necessarily a Graph ID.
    // Only an explicit canonical recordId may open the existing Graph detail.
    const targetId = check.recordId;
    const title = typeof actions.openGraphEntity === 'function' && targetId
      ? makeElement(doc, 'button', { className: 'bb-pkw-overview-link', text: check.title, attrs: { type: 'button', 'data-record-id': targetId } })
      : makeElement(doc, 'strong', { text: check.title });
    if (typeof actions.openGraphEntity === 'function' && targetId) title.addEventListener('click', () => actions.openGraphEntity(targetId));
    item.append(title);
    if (check.summary) item.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: check.summary }));
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderMaterialState(doc, materials) {
  const state = materials.state;
  const total = materials.total;
  let text;
  if (state === 'ok') {
    if (total === 0 && materials.items.length === 0) text = '確認済み 0件';
    else if (total === null) text = materials.items.length > 0 ? `表示 ${materials.items.length}件 · 総数未確認` : '件数未確認';
    else text = `表示 ${materials.items.length}件 · 総数 ${total}件${total > materials.items.length ? ' · 続き未取得' : ''}`;
  } else if (total !== null) {
    text = `表示 ${materials.items.length}件 · 総数 ${total}件 · ${stateLabel(state)}`;
  } else {
    text = materials.items.length > 0 ? `表示 ${materials.items.length}件 · 総数未確認 · ${stateLabel(state)}` : stateLabel(state);
  }
  return makeElement(doc, 'p', { className: 'bb-pkw-overview-material-state', text });
}

function materialNotice(doc, materials) {
  if (materials.state === 'ok') return null;
  const tone = materials.state === 'failed' ? 'danger' : materials.state === 'unknown' || materials.state === 'partial' ? 'warning' : 'info';
  return workspaceNotice(doc, {
    label: stateLabel(materials.state),
    text: materials.note ?? (materials.state === 'partial' ? '一部の資料だけ取得されています。' : '資料の取得状態を確認できません。'),
    tone,
    role: materials.state === 'failed' ? 'alert' : 'status',
  });
}

function renderMaterialTable(doc, materials, actions = {}) {
  const table = makeElement(doc, 'div', {
    className: 'bb-pkw-overview-material-table',
    attrs: { role: 'table', 'aria-label': '資料一覧' },
  });
  const columns = ['資料', '関係', '出典', '本文', '内容時点', '記録更新'];
  const header = makeElement(doc, 'div', { className: 'bb-pkw-overview-material-row bb-pkw-overview-material-header', attrs: { role: 'row' } });
  for (const column of columns) header.append(makeElement(doc, 'span', { text: column, attrs: { role: 'columnheader' } }));
  table.append(header);
  if (materials.items.length === 0) {
    const empty = materials.state === 'ok' && materials.total === 0
      ? '確認済みの資料はありません。'
      : '資料の行は未確認です。';
    table.append(makeElement(doc, 'p', { className: 'bb-pkw-muted bb-pkw-overview-material-empty', text: empty }));
    return table;
  }
  for (const material of materials.items) {
    const row = makeElement(doc, 'div', { className: 'bb-pkw-overview-material-row', attrs: { role: 'row' } });
    const title = typeof actions.openGraphEntity === 'function' && material.id
      ? makeElement(doc, 'button', { className: 'bb-pkw-overview-link', text: material.title, attrs: { type: 'button', 'data-record-id': material.id } })
      : makeElement(doc, 'strong', { text: material.title });
    if (typeof actions.openGraphEntity === 'function' && material.id) title.addEventListener('click', () => actions.openGraphEntity(material.id));
    row.append(
      makeElement(doc, 'span', { attrs: { role: 'cell' } }),
      makeElement(doc, 'span', { text: material.relation ?? '関係未確認', attrs: { role: 'cell' } }),
      makeElement(doc, 'span', { text: material.source ?? '出典未確認', attrs: { role: 'cell' } }),
      makeElement(doc, 'span', { text: BODY_STATE_LABELS[material.bodyState] ?? BODY_STATE_LABELS.unknown, attrs: { role: 'cell' } }),
      makeElement(doc, 'time', { text: displayDate(material.contentAsOf), attrs: { role: 'cell', ...(material.contentAsOf ? { datetime: material.contentAsOf } : {}) } }),
      makeElement(doc, 'time', { text: displayDate(material.updatedAt), attrs: { role: 'cell', ...(material.updatedAt ? { datetime: material.updatedAt } : {}) } }),
    );
    row.children[0].append(title);
    table.append(row);
  }
  return table;
}

function renderMaterials(doc, title, materials, actions = {}) {
  const section = makeElement(doc, 'section', {
    className: 'bb-pkw-overview-section bb-pkw-overview-materials',
    attrs: { 'aria-label': title },
  });
  const heading = makeElement(doc, 'div', { className: 'bb-pkw-overview-section-heading' });
  heading.append(makeElement(doc, 'h3', { text: title }), renderMaterialState(doc, materials));
  section.append(heading);
  const notice = materialNotice(doc, materials);
  if (notice) section.append(notice);
  if (materials.note && materials.state === 'ok') section.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: materials.note }));
  section.append(renderMaterialTable(doc, materials, actions));
  return section;
}

/** Render the host-provided overview in the required cognitive order. */
export function renderProjectOverview(doc, value, { projectName = 'プロジェクト', actions = {} } = {}) {
  const overview = normalizeProjectOverview(value);
  if (!overview) return null;
  const name = cleanText(projectName) ?? 'プロジェクト';
  const root = makeElement(doc, 'div', { className: 'bb-pkw-overview-projection', attrs: { 'aria-label': 'プロジェクト概要' } });
  root.append(
    renderAbout(doc, overview.about),
    renderChecks(doc, overview.checks, actions),
    renderMaterials(doc, `${name}に直接紐づく資料`, overview.directMaterials, actions),
    renderMaterials(doc, '関連資料', overview.relatedMaterials, actions),
  );
  return root;
}
