/*
 * Read-only judgment history for the local and organization workspaces.
 *
 * The host already owns the journal read model.  This module deliberately
 * projects that model in the browser instead of creating another ledger.  It
 * keeps the projection pure (`aggregateJudgmentHistory`) and keeps the DOM
 * controller small enough to use from both the local shell and the standalone
 * review host.
 */

import {
  makeWorkspaceElement,
  workspaceButton,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceLedger,
  workspaceMetrics,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
} from './workspace-kit.js';

export const JUDGMENT_HISTORY_UI_CONTRACT_VERSION = 'brainbase.judgment-history-ui.v1';

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const PERIODS = Object.freeze({ week: 'week', past30days: 'past30days', all: 'all' });
const PERIOD_LABELS = Object.freeze({ week: '今週', past30days: '過去30日', all: '全期間' });
const SECTION_KEYS = Object.freeze(['needs_human', 'blocked', 'continued', 'other']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function findFirst(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const match = findFirst(child, predicate);
    if (match) return match;
  }
  return null;
}

function replaceNode(nextNode, previousNode) {
  const parent = nextNode?.parentNode;
  if (!parent || !previousNode) return false;
  if (typeof parent.replaceChild === 'function') {
    parent.replaceChild(previousNode, nextNode);
    return true;
  }
  const children = parent.children;
  const index = children && typeof children.indexOf === 'function' ? children.indexOf(nextNode) : -1;
  if (index < 0) return false;
  children[index] = previousNode;
  previousNode.parentNode = parent;
  return true;
}

function attributeValue(node, name) {
  if (!node) return null;
  if (typeof node.getAttribute === 'function') return node.getAttribute(name);
  const attributes = node.attributes;
  if (!attributes) return null;
  if (typeof attributes.getNamedItem === 'function') return attributes.getNamedItem(name)?.value ?? null;
  return attributes[name] ?? null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeCoverage(coverage, status) {
  const source = isRecord(coverage) ? coverage : {};
  const state = text(source.status ?? source.state).toLowerCase();
  const complete = source.complete !== false && state !== 'partial' && state !== 'unknown';
  const saved = nonNegativeInteger(source.saved ?? source.read ?? source.count);
  const rejected = nonNegativeInteger(source.rejected ?? source.rejected_count);
  return {
    saved,
    rejected,
    latestRecordedAt: text(source.latest_recorded_at ?? source.latestRecordedAt) || null,
    possiblyStalled: source.possibly_stalled === true || source.possiblyStalled === true,
    complete: status !== 'partial' && complete,
    reason: text(source.reason ?? source.message) || null,
    state: state || (status === 'partial' ? 'partial' : 'complete'),
  };
}

function isProof(value) {
  return isRecord(value)
    && text(value.intent_id)
    && text(value.decision_attempt_id)
    && timestamp(value.recorded_at) !== null
    && isRecord(value.interruption)
    && isRecord(value.decision);
}

function normalizeSectionItems(sections) {
  if (!isRecord(sections)) return null;
  const result = [];
  let rawCount = 0;
  let invalidCount = 0;
  for (const key of SECTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(sections, key) || !Array.isArray(sections[key])) return null;
    const entries = sections[key];
    rawCount += entries.length;
    for (const item of entries) {
      const proof = isRecord(item) && isProof(item.proof) ? item.proof : isProof(item) ? item : null;
      if (!proof) {
        invalidCount += 1;
        continue;
      }
      result.push({
        section: text(item?.section) || key,
        proof,
      });
    }
  }
  return { items: result, rawCount, invalidCount };
}

/**
 * Validate the small public read model used by the history screen.
 *
 * Invalid records are ignored at the projection boundary.  A malformed home
 * response remains `invalid`, so the UI can explain that it could not read the
 * data instead of turning the situation into a reassuring zero.
 */
export function normalizeJudgmentHistoryHome(payload) {
  if (!isRecord(payload)) return { status: 'invalid', reason: 'response_not_object' };
  if (payload.status === 'unavailable') {
    return { status: 'unavailable', root: text(payload.root) || null, reason: text(payload.reason) || 'judgment_journal_unavailable' };
  }
  if (payload.status !== 'available' && payload.status !== 'partial') {
    return { status: 'invalid', reason: 'unsupported_status' };
  }
  const sectionResult = normalizeSectionItems(payload.sections);
  if (!sectionResult) return { status: 'invalid', reason: 'sections_missing' };
  const rawCoverage = isRecord(payload.coverage) ? payload.coverage : {};
  const saved = nonNegativeInteger(rawCoverage.saved);
  const rejectedCount = nonNegativeInteger(rawCoverage.rejected);
  if (saved === null || rejectedCount === null) return { status: 'invalid', reason: 'coverage_incomplete' };
  const coverageState = text(rawCoverage.status ?? rawCoverage.state).toLowerCase();
  const coverageMismatch = saved !== sectionResult.rawCount || rejectedCount !== (Array.isArray(payload.rejected) ? payload.rejected.length : 0);
  const status = payload.status === 'partial' || rawCoverage.complete === false || coverageState === 'partial' || coverageState === 'unknown'
    || rejectedCount > 0 || coverageMismatch || sectionResult.invalidCount > 0
    ? 'partial'
    : 'available';
  const rejected = Array.isArray(payload.rejected)
    ? payload.rejected.filter(isRecord).map((entry) => ({ file: text(entry.file) || null, reason: text(entry.reason) || 'record_rejected' }))
    : [];
  return {
    status,
    root: text(payload.root) || null,
    coverage: { ...normalizeCoverage(rawCoverage, status), saved, rejected: rejectedCount },
    items: sectionResult.items,
    rejected,
    invalidCount: sectionResult.invalidCount,
  };
}

function jstDayStart(nowMs) {
  const jst = new Date(nowMs + JST_OFFSET_MS);
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS;
}

function periodStart(period, nowMs) {
  const today = jstDayStart(nowMs);
  if (period === PERIODS.all) return Number.NEGATIVE_INFINITY;
  if (period === PERIODS.week) {
    const jst = new Date(today + JST_OFFSET_MS);
    return today - jst.getUTCDay() * DAY_MS + (jst.getUTCDay() === 0 ? -6 * DAY_MS : DAY_MS);
  }
  return today - 29 * DAY_MS;
}

function referenceId(value) {
  return text(value?.entity_id ?? value?.ref ?? value?.id ?? value?.entityId);
}

function referenceVersion(value) {
  return text(value?.entity_version ?? value?.version ?? value?.revision ?? value?.source?.version) || null;
}

function addReference(map, candidate) {
  if (!candidate.id) return;
  const key = `${candidate.id}\u0000${candidate.version ?? ''}`;
  const previous = map.get(key);
  if (!previous) {
    map.set(key, {
      ...candidate,
      applications: candidate.application ? [candidate.application] : [],
      labels: candidate.label ? [candidate.label] : [],
      kinds: [candidate.kind],
    });
    return;
  }
  // A basis entry may name the application while its inherited source only
  // has a label.  Merge both so projection never loses useful context.
  if (candidate.application && !previous.applications.includes(candidate.application)) previous.applications.push(candidate.application);
  if (candidate.label && !previous.labels.includes(candidate.label)) previous.labels.push(candidate.label);
  if (!previous.application && candidate.application) previous.application = candidate.application;
  if (!previous.label && candidate.label) previous.label = candidate.label;
  if (!previous.layer && candidate.layer) previous.layer = candidate.layer;
  if (!previous.kinds.includes(candidate.kind)) previous.kinds.push(candidate.kind);
  previous.kind = previous.kinds.length === 1 ? previous.kinds[0] : 'basis+inheritance';
}

function referencesForProof(proof) {
  const map = new Map();
  const decision = isRecord(proof.decision) ? proof.decision : {};
  const basis = Array.isArray(decision.basis) ? decision.basis : [];
  for (const entry of basis) {
    if (!isRecord(entry)) continue;
    const id = referenceId(entry);
    const application = text(entry.application);
    addReference(map, {
      id,
      version: referenceVersion(entry),
      application: application || null,
      label: application || id || '参照',
      layer: text(entry.layer) || null,
      kind: 'basis',
    });
  }
  const inheritance = isRecord(decision.inheritance) ? decision.inheritance : {};
  const sources = Array.isArray(inheritance.sources) ? inheritance.sources : [];
  for (const entry of sources) {
    if (!isRecord(entry)) continue;
    const id = referenceId(entry);
    const label = text(entry.label ?? entry.application);
    addReference(map, {
      id,
      version: referenceVersion(entry),
      application: label || null,
      label: label || id || '継承した参照',
      layer: text(entry.layer) || null,
      kind: text(entry.kind) || 'inheritance',
    });
  }
  return [...map.values()];
}

function proofSearchText(proof, references) {
  const decision = isRecord(proof.decision) ? proof.decision : {};
  const interruption = isRecord(proof.interruption) ? proof.interruption : {};
  const humanDecision = isRecord(proof.human_decision) ? proof.human_decision : {};
  const execution = isRecord(proof.execution) ? proof.execution : {};
  const outcome = isRecord(proof.outcome) ? proof.outcome : {};
  const options = Array.isArray(humanDecision.options) ? humanDecision.options : [];
  const parts = [
    proof.intent_id,
    proof.decision_attempt_id,
    proof.recorded_at,
    interruption.resolution,
    interruption.reason_code,
    interruption.question_display_text,
    interruption.human_reason,
    decision.summary,
    decision.work_impact,
    humanDecision.question,
    humanDecision.why_human,
    ...options.flatMap((option) => (isRecord(option) ? [option.label, option.impact] : [])),
    execution.summary,
    outcome.summary,
    ...references.flatMap((ref) => [
      ref.id,
      ref.version,
      ref.application,
      ref.label,
      ...(ref.applications ?? []),
      ...(ref.labels ?? []),
      ref.layer,
      ref.kind,
    ]),
  ];
  return parts.filter(Boolean).join(' ').toLocaleLowerCase('ja-JP');
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    const at = timestamp(right.proof.recorded_at) - timestamp(left.proof.recorded_at);
    if (at !== 0) return at;
    const attempt = text(right.proof.decision_attempt_id).localeCompare(text(left.proof.decision_attempt_id));
    if (attempt !== 0) return attempt;
    return text(right.proof.intent_id).localeCompare(text(left.proof.intent_id));
  });
}

function normalizedPeriod(period) {
  return Object.values(PERIODS).includes(period) ? period : PERIODS.past30days;
}

function normalizedNow(now) {
  const candidate = now instanceof Date ? now.getTime() : new Date(now ?? Date.now()).getTime();
  return Number.isFinite(candidate) ? candidate : Date.now();
}

function isDelegated(proof) {
  return proof?.interruption?.resolution === 'continued_without_human' && Boolean(text(proof?.decision?.summary));
}

/**
 * Project a home read model into one newest-first judgment history.
 * `now`, `period` and `query` are options so the same data can be tested and
 * rendered consistently by a host.
 */
export function aggregateJudgmentHistory(home, { now = new Date(), period = PERIODS.past30days, query = '' } = {}) {
  const normalized = home?.items && (home.status === 'available' || home.status === 'partial')
    ? home
    : normalizeJudgmentHistoryHome(home);
  const empty = {
    rows: [],
    stats: {
      judgments: null,
      references: null,
      equivalent: null,
      delegated: null,
      judgmentCount: null,
      referenceCount: null,
      equivalentJudgments: null,
    },
    visibleCount: 0,
    totalCount: 0,
    period: normalizedPeriod(period),
    query: text(query),
    status: normalized.status,
    coverage: normalized.coverage ?? null,
    rejected: normalized.rejected ?? [],
    reason: normalized.reason ?? null,
  };
  if (normalized.status !== 'available' && normalized.status !== 'partial') return empty;

  const nowMs = normalizedNow(now);
  const sorted = sortItems(normalized.items);
  const latestByIntent = new Map();
  for (const item of sorted) {
    const recorded = timestamp(item.proof.recorded_at);
    if (recorded === null) continue;
    const intentId = text(item.proof.intent_id);
    if (!intentId || latestByIntent.has(intentId)) continue;
    latestByIntent.set(intentId, item);
  }
  const start = periodStart(normalizedPeriod(period), nowMs);
  const needle = text(query).toLocaleLowerCase('ja-JP');
  const rows = [];
  for (const item of latestByIntent.values()) {
    const recorded = timestamp(item.proof.recorded_at);
    if (recorded === null || recorded < start || recorded > nowMs) continue;
    const references = referencesForProof(item.proof);
    const searchText = proofSearchText(item.proof, references);
    if (needle && !searchText.includes(needle)) continue;
    rows.push({
      key: `${item.proof.intent_id}\u0000${item.proof.decision_attempt_id}`,
      intentId: item.proof.intent_id,
      decisionAttemptId: item.proof.decision_attempt_id,
      recordedAt: item.proof.recorded_at,
      proof: item.proof,
      section: item.section,
      delegated: isDelegated(item.proof),
      references,
      searchText,
    });
  }
  rows.sort((left, right) => {
    const date = timestamp(right.recordedAt) - timestamp(left.recordedAt);
    return date || right.decisionAttemptId.localeCompare(left.decisionAttemptId);
  });

  const delegatedRows = rows.filter((row) => row.delegated);
  const references = new Map();
  for (const row of delegatedRows) {
    for (const ref of row.references) {
      const key = `${ref.id}\u0000${ref.version ?? ''}`;
      if (!references.has(key)) references.set(key, ref);
    }
  }
  // A partial read with no valid records cannot establish that the owner has
  // zero judgments.  Keep the filtered rows empty, but leave the headline
  // metrics unknown until the reader can confirm an empty result.
  const metricsUnconfirmed = normalized.status === 'partial' && normalized.items.length === 0;
  const judgments = metricsUnconfirmed ? null : delegatedRows.length;
  const referenceCount = metricsUnconfirmed ? null : references.size;
  return {
    ...empty,
    rows,
    stats: {
      judgments,
      references: referenceCount,
      equivalent: judgments,
      delegated: judgments,
      judgmentCount: judgments,
      referenceCount,
      equivalentJudgments: judgments,
    },
    visibleCount: rows.length,
    totalCount: latestByIntent.size,
  };
}

// Friendly aliases for consumers that describe the operation as a projection.
export const projectJudgmentHistory = aggregateJudgmentHistory;
export const deriveJudgmentHistory = aggregateJudgmentHistory;

function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '日時未記録';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  } catch {
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

function makeReferenceSummary(doc, references) {
  if (!references.length) return makeWorkspaceElement(doc, 'span', { className: 'bb-jh-unrecorded', text: '参照は未記録' });
  const wrap = makeWorkspaceElement(doc, 'span', { className: 'bb-jh-reference-summary' });
  const first = references.slice(0, 2).map((ref) => ref.label || ref.id).join('、');
  wrap.append(makeWorkspaceElement(doc, 'strong', { text: first }));
  if (references.length > 2) wrap.append(makeWorkspaceElement(doc, 'small', { text: `ほか${references.length - 2}件` }));
  return wrap;
}

function makeDecisionSummary(doc, row) {
  const summary = text(row.proof?.decision?.summary);
  const wrap = makeWorkspaceElement(doc, 'span', { className: `bb-jh-decision${row.delegated ? ' is-delegated' : ''}` });
  wrap.append(makeWorkspaceElement(doc, 'strong', { text: summary || (row.proof?.interruption?.resolution === 'continued_without_human' ? '判断内容未記録' : '本人に確認') }));
  if (row.delegated) wrap.append(makeWorkspaceElement(doc, 'small', { text: 'Brainbaseが代わりに判断' }));
  else if (row.proof?.interruption?.resolution !== 'continued_without_human') wrap.append(makeWorkspaceElement(doc, 'small', { text: '本人に戻した判断' }));
  return wrap;
}

function appendReferenceList(doc, references) {
  if (!references.length) return makeWorkspaceElement(doc, 'p', { className: 'bb-jh-unrecorded', text: '参照は記録されていません。' });
  const list = makeWorkspaceElement(doc, 'ul', { className: 'bb-jh-reference-list' });
  for (const ref of references) {
    const item = makeWorkspaceElement(doc, 'li');
    item.append(makeWorkspaceElement(doc, 'strong', { text: ref.label || ref.id }));
    item.append(makeWorkspaceElement(doc, 'code', { text: `${ref.id}${ref.version ? `@${ref.version}` : ''}` }));
    if (ref.application && ref.application !== ref.label) item.append(makeWorkspaceElement(doc, 'span', { text: ref.application }));
    const alternateLabels = (ref.labels ?? []).filter((label) => label && label !== ref.label);
    if (alternateLabels.length) item.append(makeWorkspaceElement(doc, 'span', { text: `別名: ${alternateLabels.join('、')}` }));
    list.append(item);
  }
  return list;
}

function appendSupplement(doc, proof) {
  const execution = isRecord(proof.execution) ? proof.execution : {};
  const outcome = isRecord(proof.outcome) ? proof.outcome : {};
  const evidence = Array.isArray(outcome.evidence_refs) ? outcome.evidence_refs.filter(Boolean).join('、') : '';
  return workspaceDefinition(doc, [
    ['実行', [text(execution.status) || '未記録', text(execution.summary)]],
    ['結果', [text(outcome.status) || '未記録', text(outcome.summary), evidence ? `証拠: ${evidence}` : '']],
    ['記録ID', proof.decision_attempt_id || null],
  ]);
}

function appendTextParts(doc, values) {
  const wrap = makeWorkspaceElement(doc, 'div');
  for (const value of values) {
    if (text(value)) wrap.append(makeWorkspaceElement(doc, 'p', { text: value }));
  }
  return wrap;
}

function renderRail(doc, rail, row, onClose) {
  if (!rail) return;
  rail.replaceChildren();
  if (!row) {
    rail.append(workspaceDetailEmpty(doc, {
      mark: '↗',
      title: '履歴を選択',
      text: '行を選ぶと、使った参照と行った判断を確認できます。',
    }));
    return;
  }
  const proof = row.proof;
  rail.append(workspaceRailHead(doc, {
    kicker: row.delegated ? 'Brainbaseの判断' : '判断履歴',
    title: text(proof.decision?.summary) || (row.delegated ? '判断内容未記録' : '本人に確認'),
    sub: formatDate(row.recordedAt),
  }));
  if (typeof onClose === 'function') {
    rail.append(workspaceButton(doc, {
      text: '詳細を閉じる',
      variant: 'quiet',
      onClick: onClose,
      attrs: { 'aria-label': '判断の詳細を閉じる' },
    }));
  }
  rail.append(workspaceRailBlock(doc, {
    title: '使った参照',
    content: appendReferenceList(doc, row.references),
  }));
  rail.append(workspaceRailBlock(doc, {
    title: '行った判断',
    content: appendTextParts(doc, [
      text(proof.decision?.summary) || '判断内容は未記録です。',
      row.delegated ? 'この判断は本人に戻さず進めました。' : 'この判断は本人に戻しています。',
    ]),
  }));
  rail.append(workspaceRailBlock(doc, { title: '実行と結果', content: appendSupplement(doc, proof) }));
}

function safeDocument(explicit) {
  const doc = explicit ?? (typeof document === 'undefined' ? null : document);
  if (!doc || typeof doc.createElement !== 'function') throw new Error('document_unavailable');
  return doc;
}

function statusNotice(doc, phase, error, home, onRetry) {
  if (phase === 'loading') return workspaceNotice(doc, { label: '読み込み中', text: '判断履歴を確認しています。', tone: 'info' });
  if (phase === 'error') return workspaceNotice(doc, {
    label: '取得できません',
    text: [`判断の記録を確認できません。${error ? `理由: ${error}` : ''} `, workspaceButton(doc, { text: '再読み込み', variant: 'quiet', onClick: onRetry })],
    tone: 'danger',
    role: 'alert',
  });
  if (home?.status === 'unavailable') return workspaceNotice(doc, {
    label: '未接続',
    text: ['保存された判断に接続できません。データが0件とは確認できていません。', workspaceButton(doc, { text: '再読み込み', variant: 'quiet', onClick: onRetry })],
    tone: 'warning',
    role: 'alert',
  });
  if (home?.status === 'invalid') return workspaceNotice(doc, {
    label: '未確認',
    text: ['判断の記録の応答を読み取れません。データが0件とは確認できていません。', workspaceButton(doc, { text: '再読み込み', variant: 'quiet', onClick: onRetry })],
    tone: 'danger',
    role: 'alert',
  });
  if (home?.status === 'partial') return workspaceNotice(doc, {
    label: '取得できた範囲',
    text: [`読み取れた判断だけを表示しています。${home.coverage?.rejected ? `読み取れなかった記録は${home.coverage.rejected}件あります。` : ''}`, workspaceButton(doc, { text: '再読み込み', variant: 'quiet', onClick: onRetry })],
    tone: 'warning',
    role: 'status',
  });
  return null;
}

function periodButtons(doc, selected, onSelect) {
  const wrap = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-periods', attrs: { role: 'group', 'aria-label': '期間' } });
  for (const period of [PERIODS.past30days, PERIODS.week, PERIODS.all]) {
    wrap.append(workspaceButton(doc, {
      text: PERIOD_LABELS[period],
      variant: period === selected ? 'primary' : 'quiet',
      onClick: () => onSelect(period),
      attrs: { 'aria-pressed': period === selected ? 'true' : 'false', 'data-period': period },
    }));
  }
  return wrap;
}

function createSearch(doc, value, onInput) {
  const label = makeWorkspaceElement(doc, 'label', { className: 'bb-jh-search' });
  label.append(makeWorkspaceElement(doc, 'span', { text: '参照・判断を検索' }));
  const input = makeWorkspaceElement(doc, 'input', {
    attrs: { type: 'search', value, placeholder: '参照・判断を検索', 'aria-label': '参照・判断を検索' },
  });
  input.value = value;
  input.addEventListener('input', (event) => onInput(event?.target?.value ?? input.value ?? ''));
  label.append(input);
  return label;
}

function makeRows(doc, aggregate, selectedKey, onSelect) {
  return aggregate.rows.map((row) => ({
    key: row.key,
    label: `${formatDate(row.recordedAt)} ${text(row.proof?.decision?.summary) || '判断履歴'}`,
    selected: row.key === selectedKey,
    className: `bb-jh-row${row.delegated ? ' is-delegated' : ' is-returned'}`,
    onSelect,
    cells: [
      makeWorkspaceElement(doc, 'span', { className: 'bb-jh-date', text: formatDate(row.recordedAt) }),
      makeReferenceSummary(doc, row.references),
      makeDecisionSummary(doc, row),
    ],
  }));
}

/** Create the shared, read-only judgment history controller. */
export function createJudgmentHistoryUI({
  root,
  rail = null,
  document: explicitDocument,
  fetcher,
  token,
  basePath = '/api/value-proofs',
  page,
  autoLoad = true,
  pageHeader = true,
  now = new Date(),
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = safeDocument(explicitDocument);
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const normalizedBasePath = String(basePath).replace(/\/+$/u, '');
  const readNow = () => (typeof now === 'function' ? now() : now);
  const state = {
    phase: autoLoad ? 'loading' : 'idle',
    error: null,
    home: null,
    aggregate: null,
    period: PERIODS.past30days,
    query: '',
    selectedKey: null,
    disposed: false,
    generation: 0,
    focusSearch: false,
    lastFocusedKey: null,
    pendingDecisionId: null,
  };

  function closeSelected() {
    if (!state.selectedKey || state.disposed) return false;
    state.lastFocusedKey = state.selectedKey;
    state.selectedKey = null;
    render();
    return true;
  }

  function handleKeyDown(event) {
    if (event?.key === 'Escape') closeSelected();
  }

  root.addEventListener?.('keydown', handleKeyDown);
  rail?.addEventListener?.('keydown', handleKeyDown);

  function currentPage() {
    const crumbs = Array.isArray(page?.crumbs) ? page.crumbs : ['あなたのBrainbase', '判断の履歴'];
    return {
      crumbs,
      source: page?.source ?? '判断の記録',
    };
  }

  function render() {
    if (state.disposed) return;
    const previousSearchInput = findFirst(root, (node) => node.tagName === 'INPUT');
    const previousSearchSelection = previousSearchInput && Number.isInteger(previousSearchInput.selectionStart)
      ? { start: previousSearchInput.selectionStart, end: previousSearchInput.selectionEnd ?? previousSearchInput.selectionStart }
      : null;
    const previousSearchFocused = previousSearchInput && doc.activeElement === previousSearchInput;
    const aggregate = state.aggregate ?? {
      status: state.home?.status ?? 'unavailable', rows: [], visibleCount: 0, stats: {}, coverage: state.home?.coverage ?? null,
    };
    const wrapper = makeWorkspaceElement(doc, 'div', { className: 'bb-jh', attrs: { 'data-contract-version': JUDGMENT_HISTORY_UI_CONTRACT_VERSION } });
    if (pageHeader) {
      const context = currentPage();
      wrapper.append(workspacePageHeader(doc, {
        crumbs: context.crumbs,
        title: '判断の履歴',
        lead: 'Brainbaseにどんな参照が入り、どんな判断を代わりに行ったかを見返せます。',
        source: context.source,
      }));
    }
    const notice = statusNotice(doc, state.phase, state.error, state.home, () => void load());
    if (notice) wrapper.append(notice);
    if (state.phase === 'loading' || state.phase === 'error' || state.home?.status === 'unavailable' || state.home?.status === 'invalid') {
      wrapper.append(workspaceDetailEmpty(doc, { mark: '…', title: state.phase === 'loading' ? '判断履歴を読み込んでいます' : '判断履歴を確認できません', text: '再試行すると最新の状態を確認します。' }));
      root.replaceChildren(wrapper);
      renderRail(doc, rail, null);
      return;
    }
    const controls = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-controls' });
    controls.append(periodButtons(doc, state.period, (period) => {
      state.period = period;
      state.selectedKey = null;
      state.aggregate = aggregateJudgmentHistory(state.home, { now: readNow(), period: state.period, query: state.query });
      render();
    }));
    controls.append(createSearch(doc, state.query, (query) => {
      state.query = String(query);
      state.focusSearch = true;
      state.selectedKey = null;
      state.aggregate = aggregateJudgmentHistory(state.home, { now: readNow(), period: state.period, query: state.query });
      render();
    }));
    controls.append(workspaceButton(doc, {
      text: '再読み込み',
      variant: 'quiet',
      onClick: () => void load(),
      attrs: { 'aria-label': '判断履歴を再読み込み', 'data-action': 'reload' },
    }));
    wrapper.append(controls);
    wrapper.append(makeWorkspaceElement(doc, 'p', {
      className: 'bb-jh-reference-note',
      text: '判断に残った参照だけを表示しています。実行結果の証拠は参照件数に含めません。',
    }));
    if (state.home?.status === 'partial') wrapper.append(statusNotice(doc, 'ready', null, state.home, () => void load()));
    const stats = aggregate.stats ?? {};
    const metricCount = (value, suffix) => value === null || value === undefined ? '未確認' : `${value}${suffix}`;
    wrapper.append(workspaceMetrics(doc, [
      { label: 'Brainbaseが代わりに判断した件数', value: metricCount(stats.judgments, '件'), note: 'この期間の履歴' },
      { label: 'そこで使った参照', value: metricCount(stats.references, '件'), note: '代理判断に含まれる一意の参照' },
      { label: '判断回数にすると', value: metricCount(stats.equivalent, '回分相当'), note: '代理判断1件を1回分として表示' },
    ], { ariaLabel: '判断履歴の集計' }));
    const emptyText = state.home?.status === 'partial'
      ? 'この期間に取得できた判断履歴はありません。'
      : 'この期間の判断履歴はありません。';
    wrapper.append(workspaceLedger(doc, {
      className: 'bb-jh-ledger',
      ariaLabel: '判断履歴',
      columns: ['日時', '使った参照', '行った判断'],
      rows: makeRows(doc, aggregate, state.selectedKey, (key) => {
        state.lastFocusedKey = key;
        state.selectedKey = key;
        render();
      }),
      empty: emptyText,
    }));
    const nextSearchInput = findFirst(wrapper, (node) => node.tagName === 'INPUT');
    if (previousSearchInput && nextSearchInput) {
      previousSearchInput.value = state.query;
      replaceNode(nextSearchInput, previousSearchInput);
    }
    root.replaceChildren(wrapper);
    if (state.focusSearch || previousSearchFocused) {
      const input = findFirst(root, (node) => node.tagName === 'INPUT');
      input?.focus?.();
      const start = previousSearchSelection?.start ?? state.query.length;
      const end = previousSearchSelection?.end ?? start;
      input?.setSelectionRange?.(start, end);
      state.focusSearch = false;
    }
    const selected = aggregate.rows.find((row) => row.key === state.selectedKey) ?? null;
    renderRail(doc, rail, selected, selected ? closeSelected : null);
    if (state.lastFocusedKey) {
      const row = findFirst(root, (node) => attributeValue(node, 'data-key') === state.lastFocusedKey);
      row?.focus?.();
      state.lastFocusedKey = null;
    }
  }

  async function load() {
    if (state.disposed) return null;
    const generation = ++state.generation;
    state.phase = 'loading';
    state.error = null;
    state.home = null;
    state.aggregate = null;
    render();
    if (!request) {
      if (generation !== state.generation || state.disposed) return null;
      state.phase = 'error';
      state.error = 'fetch_unavailable';
      render();
      return null;
    }
    try {
      const response = await request(`${normalizedBasePath}/home`, {
        method: 'GET',
        headers: token ? { 'x-brainbase-review-token': token } : undefined,
      });
      if (generation !== state.generation || state.disposed) return null;
      if (!response || response.ok !== true) throw new Error(`http_${response?.status ?? 0}`);
      const payload = await response.json();
      if (generation !== state.generation || state.disposed) return null;
      state.home = normalizeJudgmentHistoryHome(payload);
      state.phase = 'ready';
      state.aggregate = aggregateJudgmentHistory(state.home, { now: readNow(), period: state.period, query: state.query });
      if (state.pendingDecisionId) {
        const pending = state.aggregate.rows.find((row) => row.decisionAttemptId === state.pendingDecisionId);
        state.pendingDecisionId = null;
        if (pending) state.selectedKey = pending.key;
      }
      render();
      return state.aggregate;
    } catch (error) {
      if (generation !== state.generation || state.disposed) return null;
      state.phase = 'error';
      state.error = error instanceof Error ? error.message : String(error);
      render();
      return null;
    }
  }

  function openDecision(decisionAttemptId) {
    const id = text(decisionAttemptId);
    if (!id || state.disposed) return false;
    if (!state.aggregate) {
      state.pendingDecisionId = id;
      return true;
    }
    const row = state.aggregate?.rows?.find((candidate) => candidate.decisionAttemptId === id);
    if (!row) return false;
    state.selectedKey = row.key;
    state.lastFocusedKey = row.key;
    render();
    return true;
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    state.generation += 1;
    root.removeEventListener?.('keydown', handleKeyDown);
    rail?.removeEventListener?.('keydown', handleKeyDown);
    root.replaceChildren();
    rail?.replaceChildren();
  }

  const controller = { load, render, dispose, openDecision, get state() { return { ...state }; } };
  if (autoLoad) void load();
  else render();
  return controller;
}
