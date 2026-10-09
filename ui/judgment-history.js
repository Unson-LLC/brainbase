/*
 * Judgment history projection for the local and organization workspaces.
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
const NORMAL_ENTRYPOINTS = Object.freeze(['codex', 'claude_code', 'mana', 'company_os', 'unknown']);
const NORMAL_ENTRYPOINT_LABELS = Object.freeze({
  codex: 'Codex',
  claude_code: 'Claude Code',
  mana: 'Mana',
  company_os: 'Company OS',
  unknown: '入口不明',
});
const FEEDBACK_KINDS = Object.freeze(['feedback', 'result', 'correction']);
const FEEDBACK_KIND_LABELS = Object.freeze({
  feedback: 'フィードバック',
  result: '結果',
  correction: '訂正',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(null);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function feedbackKind(value) {
  const candidate = text(value).toLowerCase();
  return FEEDBACK_KINDS.includes(candidate) ? candidate : null;
}

function normalizeFeedbackEvent(value, fallbackRecordId) {
  if (!isRecord(value)) return null;
  const eventId = text(value.event_id ?? value.eventId ?? value.id);
  const recordId = text(value.record_id ?? value.recordId ?? fallbackRecordId);
  const kind = feedbackKind(value.kind ?? value.type);
  if (!eventId || !recordId || !kind || !isRecord(value.content)) return null;
  return {
    recordId,
    eventId,
    kind,
    content: value.content,
    recordedAt: text(value.recorded_at ?? value.recordedAt) || null,
    saved: value.saved === true,
    storageStatus: text(value.storage_status ?? value.storageStatus ?? value.save_status).toLowerCase() || null,
  };
}

function normalizeFeedbackEvents(value, fallbackRecordId) {
  if (!isRecord(value)) return [];
  const candidates = [
    value.feedback_events,
    value.feedback,
    isRecord(value.feedback) ? value.feedback.events : undefined,
    value.events,
    value.appended_events,
    value.event,
    value.feedback_event,
  ];
  const collection = candidates.find((candidate) => Array.isArray(candidate))
    ?? candidates.find((candidate) => isRecord(candidate));
  if (!collection) return [];
  const entries = Array.isArray(collection) ? collection : [collection];
  const seen = new Set();
  const result = [];
  for (const candidate of entries) {
    const event = normalizeFeedbackEvent(candidate, fallbackRecordId);
    if (!event || seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    result.push(event);
  }
  return result;
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
  const total = nonNegativeInteger(source.total);
  const storage = text(source.storage).toLowerCase() || null;
  const sources = Array.isArray(source.sources)
    ? source.sources.filter(isRecord).map((entry) => ({
      entrypoint: text(entry.entrypoint) || 'unknown',
      status: text(entry.status) || 'unknown',
      reason: text(entry.reason) || null,
    }))
    : [];
  return {
    saved,
    rejected,
    total,
    storage,
    sources,
    latestRecordedAt: text(source.latest_recorded_at ?? source.latestRecordedAt) || null,
    possiblyStalled: source.possibly_stalled === true || source.possiblyStalled === true,
    complete: status !== 'partial' && complete,
    reason: text(source.reason ?? source.message) || null,
    state: state || (status === 'partial' ? 'partial' : 'complete'),
  };
}

function normalEntrypoint(value) {
  const candidate = text(value).toLowerCase();
  return NORMAL_ENTRYPOINTS.includes(candidate) ? candidate : 'unknown';
}

function normalizeNormalReference(value) {
  if (!isRecord(value)) return null;
  const ref = text(value.ref ?? value.entity_id ?? value.id);
  if (!ref) return null;
  return {
    ref,
    id: ref,
    kind: text(value.kind) || null,
    version: text(value.version ?? value.revision) || null,
    digest: text(value.digest) || null,
    why: text(value.why) || null,
    usage: text(value.usage) || null,
    availability: text(value.availability).toLowerCase() || 'unknown',
    label: text(value.label ?? value.name) || ref,
  };
}

function normalizeNormalAlternative(value) {
  if (!isRecord(value)) return null;
  const adopted = typeof value.adopted === 'boolean' ? value.adopted : null;
  return {
    label: text(value.label ?? value.summary ?? value.option) || null,
    evaluation: text(value.evaluation ?? value.impact ?? value.reason) || null,
    adoption: text(value.adoption ?? value.adoption_status ?? value.selected) || null,
    adopted,
  };
}

function normalizeNormalRecord(value) {
  if (!isRecord(value)) return null;
  const recordId = text(value.record_id);
  const recordedAt = text(value.recorded_at);
  if (!recordId || timestamp(recordedAt) === null) return null;
  const judgment = isRecord(value.judgment) ? value.judgment : {};
  const execution = isRecord(value.execution) ? value.execution : {};
  const invalidFields = [];
  const normalizeCollection = (value, field, normalize) => {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) {
      invalidFields.push(field);
      return null;
    }
    const normalized = value.map(normalize);
    if (normalized.some((entry) => entry === null)) invalidFields.push(field);
    return normalized.filter(Boolean);
  };
  const selectedReferences = normalizeCollection(judgment.selected_references, 'judgment.selected_references', normalizeNormalReference);
  const alternatives = normalizeCollection(judgment.alternatives, 'judgment.alternatives', normalizeNormalAlternative);
  const missingFields = Array.isArray(value.missing_fields)
    ? value.missing_fields.map((field) => text(field)).filter(Boolean)
    : [];
  for (const field of invalidFields) {
    if (!missingFields.includes(field)) missingFields.push(field);
  }
  return {
    record: value,
    recordId,
    entrypoint: normalEntrypoint(value.entrypoint),
    recordedAt,
    projectCode: value.project_code === null || value.project_code === undefined ? null : text(value.project_code) || null,
    turnRef: value.turn_ref === null || value.turn_ref === undefined ? null : text(value.turn_ref) || null,
    judgment,
    execution,
    selectedReferences,
    alternatives,
    feedbackEvents: normalizeFeedbackEvents(value, recordId),
    missingFields,
    invalidFields,
  };
}

function normalizeNormalFilters(filters) {
  if (!isRecord(filters)) return { period: null, project: null, entrypoint: null, projects: [], entrypoints: [] };
  const normalizeOptions = (value) => {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
      if (typeof entry === 'string') return { value: entry, label: entry };
      if (!isRecord(entry)) return null;
      const option = text(entry.value ?? entry.code ?? entry.project ?? entry.entrypoint ?? entry.id);
      return option ? { value: option, label: text(entry.label) || option } : null;
    }).filter(Boolean);
  };
  const projects = normalizeOptions(filters.projects ?? filters.project_options ?? filters.projectCodes);
  const entrypoints = normalizeOptions(filters.entrypoints ?? filters.entrypoint_options)
    .filter((entry) => NORMAL_ENTRYPOINTS.includes(entry.value));
  return {
    period: text(filters.period) || null,
    project: filters.project === null || filters.project === undefined ? null : text(filters.project) || null,
    entrypoint: filters.entrypoint === null || filters.entrypoint === undefined ? null : normalEntrypoint(filters.entrypoint),
    projects,
    entrypoints,
  };
}

function normalizePagination(pagination) {
  if (!isRecord(pagination)) return { nextCursor: null, previousCursor: null, limit: null, hasNext: false };
  const nextCursor = text(pagination.next_cursor ?? pagination.nextCursor) || null;
  const previousCursor = text(pagination.previous_cursor ?? pagination.previousCursor) || null;
  const limit = nonNegativeInteger(pagination.limit);
  return {
    nextCursor,
    previousCursor,
    limit,
    hasNext: pagination.has_next === true || pagination.hasNext === true || Boolean(nextCursor),
  };
}

function isNormalHistoryPayload(payload) {
  return payload?.contract_version === 'brainbase.judgment-history.v1'
    || Array.isArray(payload?.records)
    || isRecord(payload?.record);
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
  if (isNormalHistoryPayload(payload)) {
    const rawStatus = text(payload.status).toLowerCase();
    if (!['available', 'partial', 'unavailable', 'error'].includes(rawStatus)) {
      return { mode: 'normal', status: 'invalid', reason: 'unsupported_status' };
    }
    const coverage = normalizeCoverage(payload.coverage, rawStatus);
    if (rawStatus === 'unavailable' || rawStatus === 'error') {
      return {
        mode: 'normal',
        status: rawStatus,
        contractVersion: text(payload.contract_version) || 'brainbase.judgment-history.v1',
        coverage,
        filters: normalizeNormalFilters(payload.filters),
        pagination: normalizePagination(payload.pagination),
        records: [],
        reason: text(payload.reason ?? coverage.reason) || null,
      };
    }
    if (!Array.isArray(payload.records)) return { mode: 'normal', status: 'invalid', reason: 'records_missing' };
    const records = payload.records.map(normalizeNormalRecord).filter(Boolean);
    const invalidRecordCount = records.filter((record) => record.invalidFields.length > 0).length;
    const invalidCount = payload.records.length - records.length + invalidRecordCount;
    const sourceGaps = coverage.sources.filter((source) => ['partial', 'unavailable'].includes(source.status));
    const status = rawStatus === 'partial' || coverage.complete === false || invalidCount > 0 || sourceGaps.length > 0 ? 'partial' : 'available';
    const reason = text(payload.reason ?? coverage.reason)
      || sourceGaps.find((source) => source.reason)?.reason
      || (invalidCount > 0 ? 'record_invalid' : null);
    return {
      mode: 'normal',
      status,
      contractVersion: text(payload.contract_version) || 'brainbase.judgment-history.v1',
      coverage: { ...coverage, complete: status === 'available' && coverage.complete !== false },
      filters: normalizeNormalFilters(payload.filters),
      pagination: normalizePagination(payload.pagination),
      records,
      invalidCount,
      reason,
    };
  }
  if (payload.status === 'unavailable') {
    return { mode: 'legacy', status: 'unavailable', root: text(payload.root) || null, reason: text(payload.reason) || 'judgment_journal_unavailable' };
  }
  if (payload.status !== 'available' && payload.status !== 'partial') {
    return { mode: 'legacy', status: 'invalid', reason: 'unsupported_status' };
  }
  const sectionResult = normalizeSectionItems(payload.sections);
  if (!sectionResult) return { mode: 'legacy', status: 'invalid', reason: 'sections_missing' };
  const rawCoverage = isRecord(payload.coverage) ? payload.coverage : {};
  const saved = nonNegativeInteger(rawCoverage.saved);
  const rejectedCount = nonNegativeInteger(rawCoverage.rejected);
  if (saved === null || rejectedCount === null) return { mode: 'legacy', status: 'invalid', reason: 'coverage_incomplete' };
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
    mode: 'legacy',
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

function normalReferenceSearchText(reference) {
  if (!isRecord(reference)) return '';
  return [
    reference.ref,
    reference.kind,
    reference.version,
    reference.digest,
    reference.why,
    reference.usage,
    reference.availability,
    reference.label,
  ].filter(Boolean).join(' ');
}

function normalRecordSearchText(record) {
  const judgment = isRecord(record.judgment) ? record.judgment : {};
  const execution = isRecord(record.execution) ? record.execution : {};
  const alternatives = Array.isArray(record.alternatives) ? record.alternatives : [];
  const references = Array.isArray(record.selectedReferences) ? record.selectedReferences : [];
  return [
    record.recordId,
    record.entrypoint,
    NORMAL_ENTRYPOINT_LABELS[record.entrypoint],
    record.projectCode,
    record.turnRef,
    record.recordedAt,
    judgment.status,
    judgment.summary,
    judgment.reason,
    execution.status,
    execution.result_summary,
    execution.outcome_status,
    ...record.missingFields,
    ...references.map(normalReferenceSearchText),
    ...alternatives.flatMap((alternative) => [alternative.label, alternative.evaluation, alternative.adoption, alternative.adopted]),
  ].filter(Boolean).join(' ').toLocaleLowerCase('ja-JP');
}

function aggregateNormalJudgmentHistory(home, { now = new Date(), period = PERIODS.past30days, query = '' } = {}) {
  const empty = {
    mode: 'normal',
    rows: [],
    stats: {
      judgments: null,
      references: null,
      equivalent: null,
      outcomes: null,
      judgmentCount: null,
      referenceCount: null,
      equivalentJudgments: null,
      confirmedOutcomes: null,
    },
    visibleCount: 0,
    retrievedCount: 0,
    countComplete: false,
    totalCount: home.status === 'available' && home.coverage?.complete === true ? nonNegativeInteger(home.coverage?.total) : null,
    period: normalizedPeriod(period),
    query: text(query),
    status: home.status,
    coverage: home.coverage ?? null,
    rejected: home.rejected ?? [],
    reason: home.reason ?? null,
    pagination: home.pagination ?? { nextCursor: null, previousCursor: null, limit: null, hasNext: false },
    filters: home.filters ?? null,
  };
  if (home.status !== 'available' && home.status !== 'partial') return empty;
  const nowMs = normalizedNow(now);
  const start = periodStart(normalizedPeriod(period), nowMs);
  const needle = text(query).toLocaleLowerCase('ja-JP');
  const rows = [];
  for (const record of home.records ?? []) {
    const recorded = timestamp(record.recordedAt);
    if (recorded === null || recorded < start || recorded > nowMs) continue;
    const searchText = normalRecordSearchText(record);
    if (needle && !searchText.includes(needle)) continue;
    rows.push({
      mode: 'normal',
      key: record.recordId,
      recordId: record.recordId,
      recordedAt: record.recordedAt,
      record: record.record,
      entrypoint: record.entrypoint,
      projectCode: record.projectCode,
      turnRef: record.turnRef,
      judgment: record.judgment,
      execution: record.execution,
      missingFields: record.missingFields,
      alternatives: record.alternatives,
      references: record.selectedReferences,
      searchText,
    });
  }
  rows.sort((left, right) => {
    const date = timestamp(right.recordedAt) - timestamp(left.recordedAt);
    return date || right.recordId.localeCompare(left.recordId);
  });
  const references = new Map();
  let referencesUnconfirmed = false;
  for (const row of rows) {
    if (row.references === null) {
      referencesUnconfirmed = true;
      continue;
    }
    for (const reference of row.references) {
      const key = `${reference.ref}\u0000${reference.version ?? ''}\u0000${reference.digest ?? ''}`;
      if (!references.has(key)) references.set(key, reference);
    }
  }
  const metricsUnconfirmed = home.status === 'partial' && rows.length === 0;
  // A page length is a retrieved count, never proof of the whole range.
  const countComplete = home.status === 'available' && home.coverage?.complete === true
    && nonNegativeInteger(home.coverage?.total) !== null && !needle;
  const judgments = countComplete ? home.coverage.total : null;
  const referenceCount = metricsUnconfirmed || referencesUnconfirmed ? null : references.size;
  const confirmedOutcomes = metricsUnconfirmed
    ? null
    : rows.filter((row) => text(row.execution?.outcome_status).toLowerCase() === 'confirmed').length;
  return {
    ...empty,
    rows,
    stats: {
      judgments,
      references: referenceCount,
      equivalent: judgments,
      outcomes: confirmedOutcomes,
      delegated: judgments,
      judgmentCount: judgments,
      referenceCount,
      equivalentJudgments: judgments,
      confirmedOutcomes,
    },
    visibleCount: rows.length,
    retrievedCount: rows.length,
    countComplete,
    totalCount: home.status === 'available' && home.coverage?.complete === true ? nonNegativeInteger(home.coverage?.total) : null,
  };
}

/**
 * Project a home read model into one newest-first judgment history.
 * `now`, `period` and `query` are options so the same data can be tested and
 * rendered consistently by a host.
 */
export function aggregateJudgmentHistory(home, { now = new Date(), period = PERIODS.past30days, query = '' } = {}) {
  const normalized = home?.mode === 'normal'
    || (home?.items && (home.status === 'available' || home.status === 'partial'))
    ? home
    : normalizeJudgmentHistoryHome(home);
  if (normalized.mode === 'normal') return aggregateNormalJudgmentHistory(normalized, { now, period, query });
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
  if (references === null || references === undefined) return makeWorkspaceElement(doc, 'span', { className: 'bb-jh-unrecorded', text: '参照は未記録' });
  if (!references.length) return makeWorkspaceElement(doc, 'span', { className: 'bb-jh-unrecorded', text: '参照はありません' });
  const wrap = makeWorkspaceElement(doc, 'span', { className: 'bb-jh-reference-summary' });
  const first = references.slice(0, 2).map((ref) => ref.label || ref.id).join('、');
  wrap.append(makeWorkspaceElement(doc, 'strong', { text: first }));
  if (references.length > 2) wrap.append(makeWorkspaceElement(doc, 'small', { text: `ほか${references.length - 2}件` }));
  return wrap;
}

function makeDecisionSummary(doc, row) {
  if (row.mode === 'normal') {
    const summary = text(row.judgment?.summary);
    const status = text(row.judgment?.status);
    const wrap = makeWorkspaceElement(doc, 'span', { className: 'bb-jh-decision is-normal' });
    wrap.append(makeWorkspaceElement(doc, 'strong', { text: summary || '判断内容は未記録' }));
    wrap.append(makeWorkspaceElement(doc, 'small', { text: `${NORMAL_ENTRYPOINT_LABELS[row.entrypoint] ?? '入口不明'}${status ? `・${status}` : ''}` }));
    return wrap;
  }
  const summary = text(row.proof?.decision?.summary);
  const wrap = makeWorkspaceElement(doc, 'span', { className: `bb-jh-decision${row.delegated ? ' is-delegated' : ''}` });
  wrap.append(makeWorkspaceElement(doc, 'strong', { text: summary || (row.proof?.interruption?.resolution === 'continued_without_human' ? '判断内容未記録' : '本人に確認') }));
  if (row.delegated) wrap.append(makeWorkspaceElement(doc, 'small', { text: 'Brainbaseが代わりに判断' }));
  else if (row.proof?.interruption?.resolution !== 'continued_without_human') wrap.append(makeWorkspaceElement(doc, 'small', { text: '本人に戻した判断' }));
  return wrap;
}

function appendReferenceList(doc, references) {
  if (references === null || references === undefined) return makeWorkspaceElement(doc, 'p', { className: 'bb-jh-unrecorded', text: '参照は記録されていません。' });
  if (!references.length) return makeWorkspaceElement(doc, 'p', { className: 'bb-jh-unrecorded', text: '参照はありません。' });
  const list = makeWorkspaceElement(doc, 'ul', { className: 'bb-jh-reference-list' });
  for (const ref of references) {
    const item = makeWorkspaceElement(doc, 'li');
    item.append(makeWorkspaceElement(doc, 'strong', { text: ref.label || ref.id }));
    item.append(makeWorkspaceElement(doc, 'code', { text: `${ref.ref ?? ref.id}${ref.version ? `@${ref.version}` : ''}${ref.digest ? `#${ref.digest}` : ''}` }));
    if (ref.application && ref.application !== ref.label) item.append(makeWorkspaceElement(doc, 'span', { text: ref.application }));
    if (ref.availability && ref.availability !== 'recorded') {
      const availability = ref.availability === 'permission_denied' ? '権限がありません' : ref.availability === 'unavailable' ? '現在は参照できません' : '参照状態は未確認';
      item.append(makeWorkspaceElement(doc, 'span', { className: 'bb-jh-reference-availability', text: availability }));
    }
    if (ref.why) item.append(makeWorkspaceElement(doc, 'span', { text: `理由: ${ref.why}` }));
    if (ref.usage) item.append(makeWorkspaceElement(doc, 'span', { text: `用途: ${ref.usage}` }));
    const alternateLabels = (ref.labels ?? []).filter((label) => label && label !== ref.label);
    if (alternateLabels.length) item.append(makeWorkspaceElement(doc, 'span', { text: `別名: ${alternateLabels.join('、')}` }));
    list.append(item);
  }
  return list;
}

function evidenceIdentifier(entry) {
  const direct = text(entry);
  if (direct) return direct;
  if (!isRecord(entry)) return '';
  const label = text(entry.label);
  const kind = text(entry.kind);
  const reference = text(entry.ref);
  const identity = [kind, reference].filter(Boolean).join(':');
  if (label && identity) return `${label}（${identity}）`;
  return label || identity;
}

function evidenceText(entry) {
  const status = isRecord(entry) && entry.status === 'verified' ? '確認済み' : '未確認';
  return `${evidenceIdentifier(entry) || '証拠の識別情報は未確認'}（${status}）`;
}

function appendSupplement(doc, proof) {
  const execution = isRecord(proof.execution) ? proof.execution : {};
  const outcome = isRecord(proof.outcome) ? proof.outcome : {};
  const evidence = Array.isArray(outcome.evidence_refs) ? outcome.evidence_refs.filter(Boolean).map(evidenceText).join('、') : '';
  return workspaceDefinition(doc, [
    ['実行', [text(execution.status) || '未記録', text(execution.summary)]],
    ['結果', [text(outcome.status) || '未記録', text(outcome.summary), evidence ? `証拠: ${evidence}` : '']],
    ['記録ID', proof.decision_attempt_id || null],
  ]);
}

function appendNormalAlternatives(doc, alternatives) {
  if (alternatives === null || alternatives === undefined) {
    return makeWorkspaceElement(doc, 'p', { className: 'bb-jh-unrecorded', text: '案は記録されていません。' });
  }
  if (!alternatives.length) return makeWorkspaceElement(doc, 'p', { className: 'bb-jh-unrecorded', text: '保存された案はありません。' });
  const list = makeWorkspaceElement(doc, 'ul', { className: 'bb-jh-alternative-list' });
  for (const alternative of alternatives) {
    const item = makeWorkspaceElement(doc, 'li');
    item.append(makeWorkspaceElement(doc, 'strong', { text: alternative.label || '案の名称は未記録' }));
    if (alternative.evaluation) item.append(makeWorkspaceElement(doc, 'span', { text: `評価: ${alternative.evaluation}` }));
    if (alternative.adoption) item.append(makeWorkspaceElement(doc, 'span', { text: `採用状態: ${alternative.adoption}` }));
    else if (alternative.adopted === true) item.append(makeWorkspaceElement(doc, 'span', { text: '採用状態: 採用' }));
    else if (alternative.adopted === false) item.append(makeWorkspaceElement(doc, 'span', { text: '採用状態: 不採用' }));
    else if (Object.prototype.hasOwnProperty.call(alternative, 'adopted')) item.append(makeWorkspaceElement(doc, 'span', { text: '採用状態: 記録なし' }));
    list.append(item);
  }
  return list;
}

function normalExecutionLabel(execution) {
  const status = text(execution?.status).toLowerCase();
  const labels = { pending: '実行待ち', completed: '実行済み', failed: '実行失敗', held: '保留', cancelled: '取消', unknown: '実行状態未確認' };
  return labels[status] ?? '実行状態未確認';
}

function normalOutcomeLabel(execution) {
  const status = text(execution?.outcome_status).toLowerCase();
  const labels = { confirmed: '結果確認済み', unconfirmed: '結果未確認', unknown: '結果未確認' };
  return labels[status] ?? '結果未確認';
}

function appendNormalExecution(doc, execution) {
  return workspaceDefinition(doc, [
    ['実行', [normalExecutionLabel(execution), text(execution?.result_summary)]],
    ['結果', normalOutcomeLabel(execution)],
  ]);
}

function appendNormalMissingFields(doc, missingFields) {
  if (!Array.isArray(missingFields) || missingFields.length === 0) return null;
  return makeWorkspaceElement(doc, 'p', { className: 'bb-jh-missing-fields', text: `未記録: ${missingFields.join('、')}` });
}

function appendTextParts(doc, values) {
  const wrap = makeWorkspaceElement(doc, 'div');
  for (const value of values) {
    if (text(value)) wrap.append(makeWorkspaceElement(doc, 'p', { text: value }));
  }
  return wrap;
}

function normalFeedbackContentSummary(content) {
  if (!isRecord(content)) return '内容は未記録';
  return text(content.summary ?? content.result_summary ?? content.message ?? content.reason)
    || canonicalJson(content)
    || '内容は未記録';
}

function normalReferencePayload(record, event, applicabilityReason = '', eventRef = null) {
  const payload = {
    ref: `judgment-history:${record.recordId}`,
    record_id: record.recordId,
    why: text(applicabilityReason) || null,
  };
  if (event) {
    payload.event_ref = eventRef;
    payload.event_id = event.eventId;
    payload.kind = event.kind;
  }
  return payload;
}

function normalReferencePayloadText(record, event, applicabilityReason = '', eventRef = null) {
  return JSON.stringify(normalReferencePayload(record, event, applicabilityReason, eventRef), null, 2);
}

function appendNormalReferenceExport(doc, record, event, { onCopyReference } = {}) {
  const wrap = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-reference-export' });
  const refLabel = event
    ? `${record.recordId} / ${event.eventId}`
    : `${record.recordId} / イベントIDは未記録`;
  wrap.append(makeWorkspaceElement(doc, 'code', { text: refLabel }));
  if (event) wrap.append(makeWorkspaceElement(doc, 'p', { text: `種別: ${FEEDBACK_KIND_LABELS[event.kind] ?? event.kind}・${normalFeedbackContentSummary(event.content)}` }));
  const reason = makeWorkspaceElement(doc, 'textarea', {
    className: 'bb-jh-applicability-reason',
    attrs: {
      rows: 2,
      'aria-label': `適用理由${event ? `（${event.eventId}）` : ''}`,
      placeholder: '次の判断で使う理由を記入',
    },
  });
  reason.value = '';
  wrap.append(makeWorkspaceElement(doc, 'label', { text: '適用理由' }), reason);
  const preview = makeWorkspaceElement(doc, 'pre', {
    className: 'bb-jh-reference-payload',
    text: normalReferencePayloadText(record, event),
  });
  const status = makeWorkspaceElement(doc, 'span', { className: 'bb-jh-copy-status', text: 'この情報を次の判断へ渡せます。' });
  wrap.append(preview, workspaceButton(doc, {
    text: '参照情報をコピー',
    variant: 'quiet',
    attrs: { 'data-action': 'copy-judgment-reference' },
    onClick: () => {
      if (typeof onCopyReference === 'function') onCopyReference({ record, event, reason, preview, status });
      else status.textContent = '参照情報を選択してコピーできます。';
    },
  }), status);
  return wrap;
}

function appendNormalFeedbackEvents(doc, record, { onCopyReference } = {}) {
  const events = Array.isArray(record.feedbackEvents) ? record.feedbackEvents : [];
  const wrap = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-feedback-events' });
  if (!events.length) {
    wrap.append(makeWorkspaceElement(doc, 'p', { className: 'bb-jh-unrecorded', text: '追記された結果・訂正・フィードバックはありません。' }));
    wrap.append(appendNormalReferenceExport(doc, record, null, { onCopyReference }));
    return wrap;
  }
  for (const event of events) {
    const item = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-feedback-event' });
    item.append(makeWorkspaceElement(doc, 'strong', { text: FEEDBACK_KIND_LABELS[event.kind] ?? event.kind }));
    item.append(makeWorkspaceElement(doc, 'code', { text: `record_id=${event.recordId} event_id=${event.eventId}` }));
    item.append(makeWorkspaceElement(doc, 'p', { text: normalFeedbackContentSummary(event.content) }));
    item.append(appendNormalReferenceExport(doc, record, event, { onCopyReference }));
    wrap.append(item);
  }
  return wrap;
}

function feedbackStatusText(draft) {
  if (!draft) return '';
  if (draft.phase === 'submitting') return '送信中です。保存状態はまだ未確認です。';
  if (draft.phase === 'readback') return '正本を読み戻して保存状態を確認しています。';
  if (draft.phase === 'saved') return '保存済み（正本で確認しました）。';
  if (draft.phase === 'unavailable') return `利用できません。${draft.status || '正本に接続できないため、保存状態を確認できません。'}`;
  if (draft.phase === 'unconfirmed') return `未確認。${draft.status || 'POST後の正本読戻しで一致を確認できませんでした。'}`;
  if (draft.phase === 'error') return `送信できません。保存状態は未確認です。${draft.status ? ` ${draft.status}` : ''}`;
  return draft.status || '送信前です。';
}

function appendNormalFeedbackComposer(doc, record, {
  detailReady = false,
  detailPhase = 'idle',
  draft,
  onKindChange,
  onSummaryChange,
  onOutcomeStatusChange,
  onSubmitFeedback,
} = {}) {
  const wrap = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-feedback-composer' });
  if (!detailReady) {
    const message = detailPhase === 'loading'
      ? '正本の詳細を確認しています。'
      : '正本の詳細を確認できないため、追記は利用できません。';
    wrap.append(makeWorkspaceElement(doc, 'p', { className: 'bb-jh-unrecorded', text: message }));
    return wrap;
  }
  const kindLabel = makeWorkspaceElement(doc, 'label', { text: '追記の種別' });
  const kind = makeWorkspaceElement(doc, 'select', { attrs: { 'aria-label': '追記の種別' } });
  for (const value of FEEDBACK_KINDS) {
    kind.append(makeWorkspaceElement(doc, 'option', {
      text: FEEDBACK_KIND_LABELS[value],
      attrs: { value },
    }));
  }
  kind.value = draft?.kind ?? 'feedback';
  kind.addEventListener('change', (event) => onKindChange?.(event?.target?.value ?? kind.value));
  const summaryLabel = makeWorkspaceElement(doc, 'label', { text: '内容（保存公開フィールド）' });
  const summary = makeWorkspaceElement(doc, 'textarea', {
    className: 'bb-jh-feedback-content',
    attrs: { rows: 3, 'aria-label': '追記の内容', placeholder: '結果・訂正・フィードバックを記入' },
  });
  summary.value = draft?.summary ?? '';
  summary.addEventListener('input', (event) => onSummaryChange?.(event?.target?.value ?? summary.value));
  const outcomeLabel = makeWorkspaceElement(doc, 'label', { text: '結果の確認状態（明示する場合）' });
  const outcomeStatus = makeWorkspaceElement(doc, 'select', { attrs: { 'aria-label': '結果の確認状態' } });
  outcomeStatus.append(makeWorkspaceElement(doc, 'option', { text: '記録しない', attrs: { value: '' } }));
  for (const value of ['unknown', 'unconfirmed', 'confirmed']) {
    const label = { unknown: '未確認', unconfirmed: '結果未確認', confirmed: '結果確認済み' }[value];
    outcomeStatus.append(makeWorkspaceElement(doc, 'option', { text: label, attrs: { value } }));
  }
  outcomeStatus.value = draft?.outcomeStatus ?? '';
  outcomeStatus.addEventListener('change', (event) => onOutcomeStatusChange?.(event?.target?.value ?? outcomeStatus.value));
  const eventId = makeWorkspaceElement(doc, 'code', { text: `event_id=${draft?.eventId ?? '未発行'}` });
  const phase = draft?.phase ?? 'idle';
  const busy = phase === 'submitting' || phase === 'readback';
  const button = workspaceButton(doc, {
    text: phase === 'saved' ? '保存済み' : '結果・訂正・フィードバックを追記',
    variant: 'primary',
    disabled: busy || phase === 'saved',
    attrs: { 'data-action': 'submit-judgment-feedback' },
    onClick: () => onSubmitFeedback?.({ kind, summary, outcomeStatus, eventId: draft?.eventId }),
  });
  const status = makeWorkspaceElement(doc, 'p', {
    className: `bb-jh-feedback-status is-${phase}`,
    text: feedbackStatusText(draft),
    attrs: { role: phase === 'error' || phase === 'unavailable' ? 'alert' : 'status' },
  });
  wrap.append(kindLabel, kind, summaryLabel, summary, outcomeLabel, outcomeStatus, eventId, button, status);
  return wrap;
}

function renderNormalRail(doc, rail, row, detail, onClose, options = {}) {
  if (!rail) return;
  rail.replaceChildren();
  const record = detail ?? row;
  rail.append(workspaceRailHead(doc, {
    kicker: `${NORMAL_ENTRYPOINT_LABELS[record.entrypoint] ?? '入口不明'}の判断`,
    title: text(record.judgment?.summary) || '判断内容は未記録',
    sub: formatDate(record.recordedAt),
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
    title: '使った参照（当時の記録）',
    content: appendReferenceList(doc, record.selectedReferences),
  }));
  rail.append(workspaceRailBlock(doc, {
    title: '判断の理由',
    content: appendTextParts(doc, [text(record.judgment?.reason) || '理由は記録されていません。']),
  }));
  rail.append(workspaceRailBlock(doc, {
    title: '保存された案',
    content: appendNormalAlternatives(doc, record.alternatives),
  }));
  rail.append(workspaceRailBlock(doc, {
    title: '実行と結果',
    content: appendNormalExecution(doc, record.execution),
  }));
  rail.append(workspaceRailBlock(doc, {
    title: '結果・訂正・フィードバック',
    content: appendNormalFeedbackEvents(doc, record, { onCopyReference: options.onCopyReference }),
  }));
  rail.append(workspaceRailBlock(doc, {
    title: '次の判断に渡す参照',
    content: appendNormalFeedbackComposer(doc, record, options),
  }));
  const metadata = workspaceDefinition(doc, [
    ['記録ID', record.recordId],
    ['プロジェクト', record.projectCode],
    ['Turn', record.turnRef],
  ]);
  const missing = appendNormalMissingFields(doc, record.missingFields);
  if (missing) metadata.append(missing);
  rail.append(workspaceRailBlock(doc, { title: '記録の範囲', content: metadata }));
}

function renderRail(doc, rail, row, detail, onClose, options = {}) {
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
  if (row.mode === 'normal') {
    renderNormalRail(doc, rail, row, detail, onClose, options);
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
  if (home?.status === 'error') return workspaceNotice(doc, {
    label: '取得に失敗',
    text: ['判断の記録を確認できません。データが0件とは確認できていません。', workspaceButton(doc, { text: '再読み込み', variant: 'quiet', onClick: onRetry })],
    tone: 'danger',
    role: 'alert',
  });
  const sourceSummary = normalSourcesSummary(home);
  if (home?.status === 'unavailable') return workspaceNotice(doc, {
    label: '未接続',
    text: [`保存された判断に接続できません${home.coverage?.storage ? `（${normalStorageLabel(home.coverage.storage)}）` : ''}。データが0件とは確認できていません。`, sourceSummary ? `取得元: ${sourceSummary}` : null, workspaceButton(doc, { text: '再読み込み', variant: 'quiet', onClick: onRetry })],
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
    text: [`読み取れた判断だけを表示しています。${home.coverage?.storage ? `（${normalStorageLabel(home.coverage.storage)}）` : ''}${home.coverage?.reason ? ` ${normalReasonLabel(home.coverage.reason)}` : ''}${home.coverage?.rejected ? ` 読み取れなかった記録は${home.coverage.rejected}件あります。` : ''}`, sourceSummary ? `取得元: ${sourceSummary}` : null, workspaceButton(doc, { text: '再読み込み', variant: 'quiet', onClick: onRetry })],
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

function normalStorageLabel(storage) {
  if (storage === 'local') return '端末';
  if (storage === 'server') return 'サーバー';
  return storage || '接続先不明';
}

function normalReasonLabel(reason) {
  const labels = {
    unconnected: '未接続',
    mana_not_connected: '未接続（Mana）',
    company_os_native_source_not_connected: 'Company OSの判断実行履歴が未接続',
    journal_unavailable: '判断記録がありません',
    journal_unreadable: '判断記録を読み取れません',
  };
  return labels[reason] ?? reason;
}

function normalSourceStatusLabel(status) {
  const labels = {
    available: '接続済み',
    partial: '一部取得',
    unavailable: '未接続',
  };
  return labels[status] ?? '未確認';
}

function normalSourcesSummary(home) {
  if (home?.mode !== 'normal' || !Array.isArray(home.coverage?.sources) || home.coverage.sources.length === 0) return '';
  return home.coverage.sources.map((source) => {
    const entrypoint = NORMAL_ENTRYPOINT_LABELS[normalEntrypoint(source.entrypoint)] ?? '入口不明';
    const reason = source.reason ? `（${normalReasonLabel(source.reason)}）` : '';
    return `${entrypoint}: ${normalSourceStatusLabel(source.status)}${reason}`;
  }).join('、');
}

function createFilterSelect(doc, { label, value, options, onChange, className = '' }) {
  const wrap = makeWorkspaceElement(doc, 'label', { className: `bb-jh-filter${className ? ` ${className}` : ''}` });
  wrap.append(makeWorkspaceElement(doc, 'span', { text: label }));
  const select = makeWorkspaceElement(doc, 'select', { attrs: { 'aria-label': label } });
  const current = value ?? '';
  const choices = [{ value: '', label: 'すべて' }, ...options];
  for (const option of choices) {
    const optionElement = makeWorkspaceElement(doc, 'option', { text: option.label, attrs: { value: option.value, selected: option.value === current ? 'selected' : undefined } });
    optionElement.value = option.value;
    select.append(optionElement);
  }
  select.value = current;
  select.addEventListener('change', (event) => onChange(event?.target?.value ?? select.value ?? ''));
  wrap.append(select);
  return wrap;
}

function normalFilterControls(doc, home, state, onChange) {
  const filters = home?.filters ?? {};
  const projects = [...(filters.projects ?? [])];
  const knownProjects = (home.records ?? []).map((record) => record.projectCode).filter(Boolean);
  for (const project of knownProjects) {
    if (!projects.some((option) => option.value === project)) projects.push({ value: project, label: project });
  }
  const entrypoints = [...(filters.entrypoints ?? [])];
  const knownEntrypoints = (home.records ?? []).map((record) => record.entrypoint).filter(Boolean);
  for (const entrypoint of [...NORMAL_ENTRYPOINTS, ...knownEntrypoints]) {
    if (!entrypoints.some((option) => option.value === entrypoint)) {
      entrypoints.push({ value: entrypoint, label: NORMAL_ENTRYPOINT_LABELS[entrypoint] ?? entrypoint });
    }
  }
  const wrap = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-normal-filters', attrs: { 'aria-label': '絞り込み' } });
  wrap.append(createFilterSelect(doc, {
    label: 'プロジェクト',
    value: state.project,
    options: projects,
    onChange: (project) => onChange({ project: project || null }),
  }));
  wrap.append(createFilterSelect(doc, {
    label: '入口',
    value: state.entrypoint,
    options: entrypoints,
    onChange: (entrypoint) => onChange({ entrypoint: entrypoint || null }),
  }));
  return wrap;
}

function paginationControls(doc, aggregate, onNext) {
  if (aggregate?.mode !== 'normal') return null;
  const pagination = aggregate?.pagination;
  const total = aggregate?.totalCount;
  if (!pagination?.hasNext && total === null) return null;
  const wrap = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-pagination' });
  const count = total === null ? '同じ範囲の件数は未確認' : `${aggregate.query ? '検索前の全件数' : '同じ範囲の件数'}: ${total}件`;
  wrap.append(makeWorkspaceElement(doc, 'span', { className: 'bb-jh-pagination-count', text: count }));
  if (pagination?.hasNext) {
    wrap.append(workspaceButton(doc, { text: '次のページ', variant: 'quiet', onClick: onNext, attrs: { 'data-action': 'next-page' } }));
  }
  return wrap;
}

function makeRows(doc, aggregate, selectedKey, onSelect) {
  return aggregate.rows.map((row) => ({
    key: row.key,
    label: `${formatDate(row.recordedAt)} ${row.mode === 'normal' ? text(row.judgment?.summary) || '判断履歴' : text(row.proof?.decision?.summary) || '判断履歴'}`,
    selected: row.key === selectedKey,
    className: `bb-jh-row${row.mode === 'normal' ? ' is-normal' : row.delegated ? ' is-delegated' : ' is-returned'}`,
    onSelect,
    cells: [
      makeWorkspaceElement(doc, 'span', { className: 'bb-jh-date', text: formatDate(row.recordedAt) }),
      makeReferenceSummary(doc, row.references),
      makeDecisionSummary(doc, row),
    ],
  }));
}

/** Create the shared judgment history controller and canonical feedback adapter. */
export function createJudgmentHistoryUI({
  root,
  rail = null,
  document: explicitDocument,
  fetcher,
  token,
  basePath = '/api/judgment-history',
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
  const legacyBasePath = normalizedBasePath === '/api/judgment-history' ? '/api/value-proofs' : null;
  const readNow = () => (typeof now === 'function' ? now() : now);
  const state = {
    phase: autoLoad ? 'loading' : 'idle',
    error: null,
    home: null,
    aggregate: null,
    period: PERIODS.past30days,
    query: '',
    project: null,
    entrypoint: null,
    cursor: null,
    limit: 50,
    selectedKey: null,
    details: new Map(),
    detailPhase: 'idle',
    detailError: null,
    activeBasePath: normalizedBasePath,
    feedbackDrafts: new Map(),
    disposed: false,
    generation: 0,
    detailGeneration: 0,
    focusSearch: false,
    lastFocusedKey: null,
    pendingDecisionId: null,
  };

  function closeSelected() {
    if (!state.selectedKey || state.disposed) return false;
    state.lastFocusedKey = state.selectedKey;
    state.selectedKey = null;
    state.detailPhase = 'idle';
    state.detailError = null;
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

  function newFeedbackEventId() {
    try {
      if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    } catch {
      // The fallback below is sufficient for a retry token when Web Crypto is unavailable.
    }
    return `judgment-history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function feedbackDraft(recordId) {
    if (!recordId) return null;
    let draft = state.feedbackDrafts.get(recordId);
    if (!draft) {
      draft = {
        recordId,
        eventId: newFeedbackEventId(),
        kind: 'feedback',
        summary: '',
        outcomeStatus: '',
        phase: 'idle',
        status: '',
      };
      state.feedbackDrafts.set(recordId, draft);
    }
    return draft;
  }

  function updateFeedbackDraft(recordId, changes) {
    const current = feedbackDraft(recordId);
    if (!current || !isRecord(changes)) return current;
    const next = { ...current, ...changes };
    state.feedbackDrafts.set(recordId, next);
    return next;
  }

  function feedbackReadbackMatches(detail, expected) {
    if (!detail || !expected) return false;
    const events = Array.isArray(detail.feedbackEvents) ? detail.feedbackEvents : [];
    return events.some((event) => event.recordId === expected.recordId
      && event.eventId === expected.eventId
      && event.kind === expected.kind
      && canonicalJson(event.content) === canonicalJson(expected.content));
  }

  function responseFeedbackReadback(payload, expected) {
    if (!isRecord(payload) || !expected) return false;
    const candidate = payload.event
      ?? payload.feedback_event
      ?? (isRecord(payload.feedback) ? payload.feedback : null)
      ?? (text(payload.event_id) ? payload : null);
    const event = normalizeFeedbackEvent(candidate, expected.recordId);
    if (!event) return false;
    const storageStatus = text(payload.storage_status ?? payload.storage?.status ?? payload.save_status).toLowerCase();
    const saved = payload.saved === true || event.saved === true || ['saved', 'stored', 'idempotent', 'confirmed'].includes(storageStatus)
      || ['saved', 'stored', 'idempotent', 'confirmed'].includes(event.storageStatus)
      || text(payload.status).toLowerCase() === 'saved';
    return saved
      && event.recordId === expected.recordId
      && event.eventId === expected.eventId
      && event.kind === expected.kind
      && canonicalJson(event.content) === canonicalJson(expected.content);
  }

  async function feedbackReference(record, event) {
    if (!record || !event) return null;
    try {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle || typeof subtle.digest !== 'function' || typeof TextEncoder !== 'function') return null;
      const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(event.eventId));
      const hash = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return `judgment-history-feedback:${record.recordId}:${hash}`;
    } catch {
      return null;
    }
  }

  async function copyReference({ record, event, reason, preview, status } = {}) {
    if (!record || !preview || !status) return false;
    const applicabilityReason = reason?.value ?? '';
    preview.textContent = normalReferencePayloadText(record, event, applicabilityReason);
    const eventRef = await feedbackReference(record, event);
    const serialized = normalReferencePayloadText(record, event, applicabilityReason, eventRef);
    preview.textContent = serialized;
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('clipboard_unavailable');
      await clipboard.writeText(serialized);
      status.textContent = '参照情報をコピーしました。';
      return true;
    } catch {
      status.textContent = '参照情報を表示しました。選択してコピーできます。';
      return false;
    }
  }

  async function submitFeedback(row, controls) {
    if (!row || row.mode !== 'normal' || !controls || !request || state.disposed) return false;
    const current = feedbackDraft(row.recordId);
    const kind = feedbackKind(controls.kind?.value ?? current?.kind) ?? 'feedback';
    const summary = text(controls.summary?.value ?? current?.summary);
    const outcomeStatus = text(controls.outcomeStatus?.value ?? current?.outcomeStatus).toLowerCase();
    if (!summary) {
      updateFeedbackDraft(row.recordId, { kind, summary, outcomeStatus: '', phase: 'error', status: '内容を入力してください。' });
      render();
      return false;
    }
    const acceptedOutcomeStatuses = new Set(['unknown', 'unconfirmed', 'confirmed']);
    const content = { summary };
    if (acceptedOutcomeStatuses.has(outcomeStatus)) content.outcome_status = outcomeStatus;
    const displayedEventId = text(controls.eventId?.textContent);
    const eventId = displayedEventId.startsWith('event_id=')
      ? displayedEventId.slice('event_id='.length)
      : displayedEventId || current?.eventId || newFeedbackEventId();
    const expected = { recordId: row.recordId, eventId, kind, content };
    updateFeedbackDraft(row.recordId, { eventId, kind, summary, outcomeStatus, phase: 'submitting', status: '' });
    render();
    try {
      const response = await request(`${state.activeBasePath}/feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-brainbase-review-token': token } : {}),
        },
        body: JSON.stringify({ record_id: row.recordId, event_id: eventId, kind, content }),
      });
      if (!response || response.ok !== true) {
        const statusCode = response?.status ?? 0;
        const unavailable = [401, 403, 404, 405, 501, 503].includes(statusCode);
        updateFeedbackDraft(row.recordId, {
          phase: unavailable ? 'unavailable' : 'unconfirmed',
          status: unavailable ? `正本へ接続できません（HTTP ${statusCode}）。` : `受付応答はHTTP ${statusCode}でした。`,
        });
        render();
        return false;
      }
      let responsePayload = null;
      if (typeof response.json === 'function') {
        try { responsePayload = await response.json(); } catch { responsePayload = null; }
      }
      updateFeedbackDraft(row.recordId, { phase: 'readback', status: '' });
      render();
      const detail = await loadDetail(row);
      const detailReadback = feedbackReadbackMatches(detail, expected);
      const responseReadback = responseFeedbackReadback(responsePayload, expected);
      if (detailReadback || responseReadback) {
        updateFeedbackDraft(row.recordId, { phase: 'saved', status: '' });
      } else if (state.detailPhase === 'error') {
        updateFeedbackDraft(row.recordId, { phase: 'unavailable', status: '正本を読み戻せませんでした。' });
      } else {
        updateFeedbackDraft(row.recordId, { phase: 'unconfirmed', status: '同じevent_idの正本記録を確認できませんでした。' });
      }
      render();
      return detailReadback || responseReadback;
    } catch (error) {
      updateFeedbackDraft(row.recordId, {
        phase: 'unavailable',
        status: `正本へ接続できません。${error instanceof Error ? error.message : String(error)}`,
      });
      render();
      return false;
    }
  }

  function historyPath(path, cursor = null) {
    const params = new URLSearchParams();
    params.set('period', state.period);
    if (state.project) params.set('project', state.project);
    if (state.entrypoint) params.set('entrypoint', state.entrypoint);
    params.set('limit', String(state.limit));
    if (cursor) params.set('cursor', cursor);
    return `${path}/home?${params.toString()}`;
  }

  function normalMode() {
    return state.home?.mode === 'normal' || state.aggregate?.mode === 'normal';
  }

  function handleNormalFilterChange(changes) {
    if (!normalMode()) return;
    if (Object.prototype.hasOwnProperty.call(changes, 'project')) state.project = changes.project;
    if (Object.prototype.hasOwnProperty.call(changes, 'entrypoint')) state.entrypoint = changes.entrypoint;
    state.cursor = null;
    state.selectedKey = null;
    state.details = new Map();
    void load({ append: false });
  }

  async function loadDetail(row) {
    if (!row || row.mode !== 'normal' || !request || state.disposed) return null;
    const generation = ++state.detailGeneration;
    state.detailPhase = 'loading';
    state.detailError = null;
    render();
    try {
      const response = await request(`${state.activeBasePath}/records/${encodeURIComponent(row.recordId)}`, {
        method: 'GET',
        headers: token ? { 'x-brainbase-review-token': token } : undefined,
      });
      if (generation !== state.detailGeneration || state.disposed) return null;
      if (!response || response.ok !== true) throw new Error(`http_${response?.status ?? 0}`);
      const payload = await response.json();
      if (generation !== state.detailGeneration || state.disposed) return null;
      let rawRecord = isRecord(payload?.record) ? { ...payload.record } : isRecord(payload) && text(payload.record_id) ? payload : null;
      if (rawRecord && isRecord(payload)) {
        for (const key of ['feedback_events', 'feedback', 'events', 'appended_events', 'event', 'feedback_event']) {
          if (rawRecord[key] === undefined && payload[key] !== undefined) rawRecord[key] = payload[key];
        }
      }
      const detail = normalizeNormalRecord(rawRecord);
      if (!detail) throw new Error('record_response_invalid');
      state.details.set(row.recordId, detail);
      state.detailPhase = 'ready';
      render();
      return detail;
    } catch (error) {
      if (generation !== state.detailGeneration || state.disposed) return null;
      state.detailPhase = 'error';
      state.detailError = error instanceof Error ? error.message : String(error);
      render();
      return null;
    }
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
    if (state.phase === 'loading' || state.phase === 'error' || state.home?.status === 'unavailable' || state.home?.status === 'error' || state.home?.status === 'invalid') {
      wrapper.append(workspaceDetailEmpty(doc, { mark: '…', title: state.phase === 'loading' ? '判断履歴を読み込んでいます' : '判断履歴を確認できません', text: '再試行すると最新の状態を確認します。' }));
      root.replaceChildren(wrapper);
      renderRail(doc, rail, null, null);
      return;
    }
    const controls = makeWorkspaceElement(doc, 'div', { className: 'bb-jh-controls' });
    controls.append(periodButtons(doc, state.period, (period) => {
      state.period = period;
      state.selectedKey = null;
      state.cursor = null;
      if (normalMode()) void load({ append: false });
      else {
        state.aggregate = aggregateJudgmentHistory(state.home, { now: readNow(), period: state.period, query: state.query });
        render();
      }
    }));
    if (normalMode()) controls.append(normalFilterControls(doc, state.home, state, handleNormalFilterChange));
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
    const normalSourceSummary = normalSourcesSummary(state.home);
    wrapper.append(makeWorkspaceElement(doc, 'p', {
      className: 'bb-jh-reference-note',
      text: normalMode()
        ? `保存された判断の理由、当時の参照、案、実行と結果を表示しています。参照の本文は現在の権限で確認できる場合だけ開きます。${normalSourceSummary ? ` 取得元: ${normalSourceSummary}` : ''}`
        : '判断に残った参照だけを表示しています。実行結果の証拠は参照件数に含めません。',
    }));
    const stats = aggregate.stats ?? {};
    const metricCount = (value, suffix) => value === null || value === undefined ? '未確認' : `${value}${suffix}`;
    wrapper.append(workspaceMetrics(doc, normalMode() ? [
      {
        label: aggregate.query ? '表示対象' : aggregate.countComplete ? '判断件数' : '取得済み',
        value: metricCount(aggregate.countComplete ? stats.judgments : aggregate.retrievedCount, '件'),
        note: aggregate.countComplete ? 'この期間・絞り込みの全件数'
          : aggregate.query ? '取得済み履歴の検索結果・全件数未確認' : '全件数未確認',
      },
      { label: '使った参照', value: metricCount(stats.references, '件'), note: '当時の記録にある一意の参照' },
      { label: '確認済みの結果', value: metricCount(stats.confirmedOutcomes, '件'), note: '成果が確認済みと記録された判断' },
    ] : [
      { label: 'Brainbaseが代わりに判断した件数', value: metricCount(stats.judgments, '件'), note: 'この期間の履歴' },
      { label: 'そこで使った参照', value: metricCount(stats.references, '件'), note: '代理判断に含まれる一意の参照' },
      { label: '判断回数にすると', value: metricCount(stats.equivalent, '回分相当'), note: '代理判断1件を1回分として表示' },
    ], { ariaLabel: '判断履歴の集計' }));
    const emptyText = state.home?.status === 'partial' || (normalMode() && !aggregate.countComplete)
      ? 'この期間に取得できた判断履歴はありません。全件数が未確認のため0件とは確認できません。'
      : 'この期間の判断履歴はありません。';
    wrapper.append(workspaceLedger(doc, {
      className: 'bb-jh-ledger',
      ariaLabel: '判断履歴',
      columns: ['日時', '使った参照', '行った判断'],
      rows: makeRows(doc, aggregate, state.selectedKey, (key) => {
        state.lastFocusedKey = key;
        state.selectedKey = key;
        state.detailPhase = 'idle';
        state.detailError = null;
        render();
        const selectedRow = aggregate.rows.find((row) => row.key === key);
        if (selectedRow?.mode === 'normal') void loadDetail(selectedRow);
      }),
      empty: emptyText,
    }));
    const pagination = paginationControls(doc, aggregate, () => {
      if (aggregate.pagination?.nextCursor) {
        state.cursor = aggregate.pagination.nextCursor;
        void load({ cursor: state.cursor, append: true });
      }
    });
    if (pagination) wrapper.append(pagination);
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
    const selectedDetail = selected ? state.details.get(selected.recordId) ?? null : null;
    const railOptions = selected?.mode === 'normal'
      ? {
        detailReady: state.detailPhase === 'ready' && Boolean(selectedDetail),
        detailPhase: state.detailPhase,
        draft: feedbackDraft(selected.recordId),
        onKindChange: (kind) => {
          updateFeedbackDraft(selected.recordId, { kind: feedbackKind(kind) ?? 'feedback' });
          render();
        },
        onSummaryChange: (summary) => updateFeedbackDraft(selected.recordId, { summary: String(summary ?? '') }),
        onOutcomeStatusChange: (outcomeStatus) => updateFeedbackDraft(selected.recordId, { outcomeStatus: String(outcomeStatus ?? '') }),
        onSubmitFeedback: (controls) => void submitFeedback(selected, controls),
        onCopyReference: (payload) => void copyReference(payload),
      }
      : {};
    renderRail(doc, rail, selected, selectedDetail, selected ? closeSelected : null, railOptions);
    if (state.lastFocusedKey) {
      const row = findFirst(root, (node) => attributeValue(node, 'data-key') === state.lastFocusedKey);
      row?.focus?.();
      state.lastFocusedKey = null;
    }
  }

  async function load({ cursor = null, append = false } = {}) {
    if (state.disposed) return null;
    const generation = ++state.generation;
    state.phase = 'loading';
    state.error = null;
    if (!append) {
      state.home = null;
      state.aggregate = null;
    }
    render();
    if (!request) {
      if (generation !== state.generation || state.disposed) return null;
      state.phase = 'error';
      state.error = 'fetch_unavailable';
      render();
      return null;
    }
    try {
      let activePath = normalizedBasePath;
      let response = await request(historyPath(normalizedBasePath, cursor), {
        method: 'GET',
        headers: token ? { 'x-brainbase-review-token': token } : undefined,
      });
      if (generation !== state.generation || state.disposed) return null;
      if (response?.status === 404 && legacyBasePath && !append && !state.project && !state.entrypoint && !state.cursor) {
        activePath = legacyBasePath;
        response = await request(`${legacyBasePath}/home`, {
          method: 'GET',
          headers: token ? { 'x-brainbase-review-token': token } : undefined,
        });
      }
      if (!response || response.ok !== true) throw new Error(`http_${response?.status ?? 0}`);
      const payload = await response.json();
      if (generation !== state.generation || state.disposed) return null;
      const normalized = normalizeJudgmentHistoryHome(payload);
      state.activeBasePath = activePath;
      if (append && state.home?.mode === 'normal' && normalized.mode === 'normal') {
        const records = [...state.home.records];
        const knownRecordIds = new Set(records.map((record) => record.recordId));
        for (const record of normalized.records) {
          if (knownRecordIds.has(record.recordId)) continue;
          knownRecordIds.add(record.recordId);
          records.push(record);
        }
        state.home = { ...normalized, records, coverage: normalized.coverage ?? state.home.coverage };
      } else {
        state.home = normalized;
      }
      if (state.home.mode === 'normal') {
        state.project = state.project ?? state.home.filters?.project ?? null;
        state.entrypoint = state.entrypoint ?? state.home.filters?.entrypoint ?? null;
        state.cursor = state.home.pagination?.nextCursor ?? null;
      }
      state.phase = 'ready';
      state.aggregate = aggregateJudgmentHistory(state.home, { now: readNow(), period: state.period, query: state.query });
      if (state.pendingDecisionId) {
        const pending = state.aggregate.rows.find((row) => row.decisionAttemptId === state.pendingDecisionId || row.recordId === state.pendingDecisionId);
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
    const row = state.aggregate?.rows?.find((candidate) => candidate.decisionAttemptId === id || candidate.recordId === id);
    if (!row) return false;
    state.selectedKey = row.key;
    state.lastFocusedKey = row.key;
    render();
    if (row.mode === 'normal') void loadDetail(row);
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
