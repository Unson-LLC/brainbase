import crypto from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';

const MAX_BYTES = 128 * 1024;
const MAX_ENTITIES = 80;
const MAX_TASKS = 50;
const MAX_MINUTES = 3;
const GRAPH_ENTITY_TYPES = 'project,person,org,brand,decision,glossary_term,document';
const GRAPH_CONTEXT_ENTITY_TYPES = GRAPH_ENTITY_TYPES.split(',');
const MENTION_ENTITY_TYPES = ['person', 'org', 'brand', 'glossary_term'];
const DEFAULT_MENTION_ENTITY_TYPES = [...MENTION_ENTITY_TYPES];
const MAX_MENTION_CANDIDATES = 12;
const MAX_MENTION_QUERY_LENGTH = 160;
const MAX_RESULTS_PER_MENTION = 8;
const MAX_RETRIEVAL_ATTEMPTS = 48;
const ENTITY_TYPE_PRIORITY = new Map([
  ['project', 0],
  ['decision', 1],
  ['document', 2],
  ['org', 3],
  ['glossary_term', 4],
  ['person', 5],
  ['brand', 6],
]);
const ENTITY_TYPE_QUOTAS = new Map([
  ['project', 1],
  ['decision', 16],
  ['document', 5],
  ['org', 8],
  ['glossary_term', 24],
  ['person', 16],
  ['brand', 6],
]);
const SEARCHABLE_PAYLOAD_KEYS = new Set([
  'aliases',
  'canonical_name',
  'code',
  'correct_form',
  'display_name',
  'incorrect_forms',
  'label',
  'name',
  'person_id',
  'reading',
  'term',
  'title',
]);

function boundedString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeEntityTypes(value) {
  const values = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
  const allowed = new Set(MENTION_ENTITY_TYPES);
  const normalized = values
    .map((type) => boundedString(type, 40).toLowerCase())
    .filter((type) => allowed.has(type));
  return [...new Set(normalized)];
}

function normalizeMentionEntityTypes(rawEntityTypes) {
  if (rawEntityTypes === undefined) return [...DEFAULT_MENTION_ENTITY_TYPES];

  const values = Array.isArray(rawEntityTypes)
    ? rawEntityTypes
    : (typeof rawEntityTypes === 'string' ? rawEntityTypes.split(',') : [rawEntityTypes]);
  const normalized = normalizeEntityTypes(rawEntityTypes);
  const invalid = values
    .filter((type) => !MENTION_ENTITY_TYPES.includes(boundedString(type, 40).toLowerCase()))
    .map((type) => (typeof type === 'string' ? boundedString(type, 40) : String(type).slice(0, 40)));
  if (invalid.length || !normalized.length) {
    throw new MeetingMinutesContextReceiptError(
      'meeting_minutes_context_input_invalid',
      'entity_types contains unsupported values',
      400,
      {
        field: 'retrieval_context.mention_candidates.entity_types',
        invalid_entity_types: invalid,
        allowed_entity_types: [...MENTION_ENTITY_TYPES]
      }
    );
  }
  return normalized;
}

function normalizeMentionCandidate(candidate) {
  if (typeof candidate === 'string') {
    const surfaceForm = boundedString(candidate, MAX_MENTION_QUERY_LENGTH);
    return surfaceForm ? { surface_form: surfaceForm, entity_types: [...DEFAULT_MENTION_ENTITY_TYPES] } : null;
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const surfaceForm = boundedString(
    candidate.surface_form ?? candidate.surfaceForm ?? candidate.text ?? candidate.term ?? candidate.value,
    MAX_MENTION_QUERY_LENGTH,
  );
  if (!surfaceForm) return null;

  const rawEntityTypes = candidate.entity_types !== undefined
    ? candidate.entity_types
    : candidate.entityTypes !== undefined
      ? candidate.entityTypes
      : candidate.types;
  const entityTypes = normalizeMentionEntityTypes(rawEntityTypes);
  return {
    surface_form: surfaceForm,
    entity_types: entityTypes,
    ...(boundedString(candidate.source_ref ?? candidate.sourceRef, 200)
      ? { source_ref: boundedString(candidate.source_ref ?? candidate.sourceRef, 200) }
      : {}),
    ...(boundedString(candidate.context, 240)
      ? { context: boundedString(candidate.context, 240) }
      : {}),
  };
}

function normalizeRetrievalContext(input = {}) {
  const retrievalContext = input.retrieval_context ?? input.retrievalContext ?? {};
  const rawCandidates = retrievalContext && typeof retrievalContext === 'object'
    ? retrievalContext.mention_candidates ?? retrievalContext.mentionCandidates ?? retrievalContext.mentions
    : undefined;
  const candidates = Array.isArray(rawCandidates)
    ? rawCandidates.map(normalizeMentionCandidate).filter(Boolean)
    : [];
  const seen = new Set();
  const mentionCandidates = candidates.filter((candidate) => {
    const key = `${candidate.surface_form.toLocaleLowerCase('ja-JP')}|${candidate.entity_types.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_MENTION_CANDIDATES);
  return { mentionCandidates };
}

function recordKey(record, entityType) {
  const id = record?.id ?? record?.entity_id ?? record?.uuid;
  if (id !== undefined && id !== null && String(id)) return `${entityType}:${String(id)}`;
  return `${entityType}:${JSON.stringify(record ?? {})}`;
}

function isRecordInProjectScope(record, entityType, projectCode) {
  const recordProjectCode = record?.project_code ?? record?.projectCode;
  const membershipCodes = record?.member_of_project_codes ?? record?.memberOfProjectCodes;
  const memberships = Array.isArray(membershipCodes)
    ? membershipCodes.map((value) => String(value)).filter(Boolean)
    : [];
  if (recordProjectCode && String(recordProjectCode) !== projectCode) {
    return entityType === 'person' && memberships.includes(projectCode);
  }
  return !memberships.length || memberships.includes(projectCode);
}

function addEntityRecord(groups, entityType, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  const targetType = boundedString(entityType, 40);
  if (!GRAPH_CONTEXT_ENTITY_TYPES.includes(targetType)) return;
  if (!Array.isArray(groups[targetType])) groups[targetType] = [];
  const key = recordKey(record, targetType);
  if (groups[targetType].some((existing) => recordKey(existing, targetType) === key)) return;
  const { entity_type: _entityType, ...withoutEntityType } = record;
  groups[targetType].push(withoutEntityType);
}

function flattenEntities(groups = {}) {
  const buckets = new Map(
    Object.entries(groups)
      .filter(([, records]) => Array.isArray(records))
      .map(([type, records]) => [type, records]),
  );
  const orderedTypes = [...buckets.keys()].sort((left, right) => (
    (ENTITY_TYPE_PRIORITY.get(left) ?? 99) - (ENTITY_TYPE_PRIORITY.get(right) ?? 99)
  ));
  const selected = [];
  const seen = new Set();

  const take = (type, count) => {
    const records = buckets.get(type) ?? [];
    let taken = 0;
    for (const record of records) {
      if (selected.length >= MAX_ENTITIES || taken >= count) break;
      const key = recordKey(record, type);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ entity_type: type, ...compact(record) });
      taken += 1;
    }
  };

  for (const type of orderedTypes) {
    const quota = ENTITY_TYPE_QUOTAS.get(type) ?? 0;
    if (quota > 0) take(type, quota);
  }

  let changed = true;
  while (selected.length < MAX_ENTITIES && changed) {
    changed = false;
    for (const type of orderedTypes) {
      const records = buckets.get(type) ?? [];
      const next = records.find((record) => !seen.has(recordKey(record, type)));
      if (!next) continue;
      seen.add(recordKey(next, type));
      selected.push({ entity_type: type, ...compact(next) });
      changed = true;
      if (selected.length >= MAX_ENTITIES) break;
    }
  }
  return selected;
}

function searchableRecordValues(record) {
  const values = [];
  const add = (value) => {
    if (typeof value === 'string' || typeof value === 'number') values.push(String(value));
    if (Array.isArray(value)) value.forEach(add);
  };
  add(record?.id);
  add(record?.name);
  add(record?.title);
  add(record?.term);
  add(record?.label);
  add(record?.correct_form);
  add(record?.reading);
  add(record?.aliases);
  if (record?.payload && typeof record.payload === 'object') {
    Object.entries(record.payload)
      .filter(([key]) => SEARCHABLE_PAYLOAD_KEYS.has(key))
      .forEach(([, value]) => add(value));
  }
  return values;
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function scoreMentionCandidate(record, mention) {
  const surfaceForm = normalizeSearchText(mention.surface_form);
  if (!surfaceForm) return 0;
  const values = searchableRecordValues(record).map(normalizeSearchText).filter(Boolean);
  let score = 0;
  for (const value of values) {
    if (value === surfaceForm) score = Math.max(score, 100);
    else if (value.includes(surfaceForm)) score = Math.max(score, 70);
  }
  if (score === 0) return 0;
  const contextWords = boundedString(mention.context, 240)
    .split(/[\s、。,.，]+/u)
    .map(normalizeSearchText)
    .filter((word) => word.length >= 2);
  for (const word of contextWords) {
    if (values.some((value) => value.includes(word))) score += 2;
  }
  return score;
}

function sanitizeErrorCode(error) {
  return error?.code || error?.name || 'query_failed';
}

function buildRetrievalMetadata({
  mode,
  mentions,
  attempts,
  gaps,
  skippedQueries = [],
  baseEntityTypes = ['project', 'decision', 'document'],
}) {
  return {
    mode,
    mention_count: mentions.length,
    mention_candidates: mentions.map((mention) => ({ ...mention })),
    base_entity_types: [...baseEntityTypes],
    searched_entity_types: [...new Set(attempts.map((attempt) => attempt.entityType))],
    max_results_per_query: MAX_RESULTS_PER_MENTION,
    max_retrieval_attempts: MAX_RETRIEVAL_ATTEMPTS,
    query_count: attempts.length,
    queries: attempts.map((attempt) => ({
      surface_form: attempt.mention?.surface_form,
      entity_type: attempt.entityType,
      query: attempt.query,
      result_count: attempt.records?.length ?? 0,
      scope_result_count: attempt.scopeRecords?.length ?? attempt.records?.length ?? 0,
      excluded_result_count: Math.max(
        0,
        (attempt.records?.length ?? 0) - (attempt.scopeRecords?.length ?? attempt.records?.length ?? 0),
      ),
      matched_result_count: (attempt.matchedRecords ?? []).length,
      matched_ids: (attempt.matchedRecords ?? [])
        .map((record) => record?.id ?? record?.entity_id)
        .filter(Boolean)
        .slice(0, 12),
      status: attempt.error
        ? 'failed'
        : ((attempt.matchedRecords ?? []).length ? 'matched' : ((attempt.records?.length ?? 0) ? 'unmatched' : 'empty')),
      ...(attempt.error ? { error_code: sanitizeErrorCode(attempt.error) } : {}),
    })),
    skipped_queries: skippedQueries.map((request) => ({
      surface_form: request.mention?.surface_form,
      entity_type: request.entityType,
      query: request.query,
    })),
    gaps,
  };
}

export class MeetingMinutesContextReceiptError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = 'MeetingMinutesContextReceiptError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function normalizeIdentity(input = {}) {
    const identity = {
        run_id: typeof input.run_id === 'string' ? input.run_id.trim() : '',
        project_code: typeof input.project_code === 'string' ? input.project_code.trim() : '',
        transcript_sha256: typeof input.transcript_sha256 === 'string'
            ? input.transcript_sha256.trim().toLowerCase()
            : ''
    };
    if (!identity.run_id || !/^[a-zA-Z0-9._:-]{1,200}$/.test(identity.run_id)) {
        throw new MeetingMinutesContextReceiptError('meeting_minutes_context_input_invalid', 'run_id is invalid');
    }
    if (!identity.project_code || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(identity.project_code)) {
        throw new MeetingMinutesContextReceiptError('meeting_minutes_context_input_invalid', 'project_code is invalid');
    }
    if (!/^[a-f0-9]{64}$/.test(identity.transcript_sha256)) {
        throw new MeetingMinutesContextReceiptError(
            'meeting_minutes_context_input_invalid',
            'transcript_sha256 must be a lowercase SHA-256 digest'
        );
    }
    return identity;
}

function projectCodes(actor = {}) {
    return Array.isArray(actor.projectCodes)
        ? actor.projectCodes.map((value) => String(value).trim()).filter(Boolean)
        : [];
}

function assertProjectAccess(actor, projectCode) {
    const allowed = projectCodes(actor);
    const privileged = actor?.role === 'ceo' || actor?.authType === 'internal_api';
    if (!privileged && !allowed.includes(projectCode)) {
        throw new MeetingMinutesContextReceiptError(
            'project_not_accessible',
            `project '${projectCode}' is not accessible`,
            403
        );
    }
}

function assertTenantIdentity(actor) {
    const identity = resolveCanonicalTenantIdentity(actor);
    if (identity.state === 'ambiguous') {
        throw new MeetingMinutesContextReceiptError(
            'tenant_identity_ambiguous',
            'organization and tenant identity claims conflict',
            403
        );
    }
    return identity;
}

function graphAccess(actor, projectCode) {
    const tenantIdentity = assertTenantIdentity(actor);
    const tenantScope = tenantIdentity.state === 'confirmed'
        ? {
            // Info SSOT currently accepts both names while the canonical
            // identity helper treats them as aliases. Forward the confirmed
            // value under both names so generic Graph calls still establish
            // the tenant session context without choosing a contradictory
            // claim with `||`.
            organizationId: tenantIdentity.organizationId,
            tenantId: tenantIdentity.organizationId
        }
        : {};
    return {
        role: ['member', 'gm', 'ceo'].includes(String(actor?.role || '').toLowerCase())
            ? String(actor.role).toLowerCase()
            : 'ceo',
        projectCodes: Array.from(new Set([...projectCodes(actor), projectCode])),
        clearance: Array.isArray(actor?.clearance) && actor.clearance.length ? actor.clearance : ['internal'],
        personId: actor?.person_id || actor?.personId || actor?.sub || null,
        ...tenantScope
    };
}

function canonicalTaskContext(actor, projectCode) {
    const serviceId = actor?.sub || 'meeting-minutes-context-receipt';
    return {
        principal: { type: 'service', id: 'meeting-minutes-context-receipt' },
        authSource: 'service-internal',
        auditPrincipal: { type: 'service', id: serviceId },
        auditAuthSource: actor?.authType || 'meeting-minutes-context-receipt',
        access: {
            role: actor?.role || 'member',
            projectCodes: Array.from(new Set([...projectCodes(actor), projectCode])),
            clearance: Array.isArray(actor?.clearance) && actor.clearance.length
                ? actor.clearance
                : ['internal'],
            personId: actor?.person_id || actor?.personId || actor?.sub || null
        }
    };
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function compact(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.slice(0, 4000);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 4) return String(value).slice(0, 500);
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => compact(item, depth + 1));
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).slice(0, 40).map(([key, item]) => [key, compact(item, depth + 1)])
        );
    }
    return String(value).slice(0, 500);
}

function approvedMinutes(entities) {
    return entities
        .filter((entity) => entity.entity_type === 'document')
        .filter((entity) => String(entity.status || entity.review_status || '').toLowerCase() === 'approved')
        .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
        .slice(0, MAX_MINUTES)
        .map((entity) => ({
            id: entity.id || entity.entity_id || null,
            name: entity.name || entity.title || null,
            source_ref: entity.source_ref || entity.url || null,
            updated_at: entity.updated_at || null
        }));
}

function sourceRefs(entities, tasks, minutes) {
    return [
        ...entities.map((item) => ({ type: 'graph_entity', id: item.id || item.entity_id || null })),
        ...tasks.map((item) => ({ type: 'canonical_task', id: item.id || item.task_id || null })),
        ...minutes.map((item) => ({ type: 'approved_minutes', id: item.id, ref: item.source_ref }))
    ].filter((item) => item.id);
}

function boundedReceipt(receipt) {
    const candidate = structuredClone(receipt);
    while (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_BYTES) {
        if (candidate.context.entities.length) candidate.context.entities.pop();
        else if (candidate.context.open_tasks.length) candidate.context.open_tasks.pop();
        else if (candidate.context.source_refs.length) candidate.context.source_refs.pop();
        else {
            throw new MeetingMinutesContextReceiptError(
                'meeting_minutes_context_too_large',
                'meeting minutes context receipt exceeds 128 KiB',
                503
            );
        }
    }
    return candidate;
}

export class JsonFileMeetingMinutesContextReceiptRepository {
    constructor({ filePath }) {
        this.filePath = filePath;
    }

    async readAll() {
        try {
            const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
            return Array.isArray(parsed.receipts) ? parsed.receipts : [];
        } catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }
    }

    async put(receipt, scope = null) {
        const receipts = await this.readAll();
        const scopedReceipt = scope ? { ...receipt, _tenant_scope: scope } : receipt;
        const sameScope = (item) => JSON.stringify(item._tenant_scope ?? null) === JSON.stringify(scope);
        const next = [...receipts.filter((item) => item.receipt_id !== receipt.receipt_id || !sameScope(item)), scopedReceipt];
        const dir = path.dirname(this.filePath);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
        const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await writeFile(tempPath, `${JSON.stringify({ version: 1, receipts: next }, null, 2)}\n`, { mode: 0o600 });
        await chmod(tempPath, 0o600);
        await rename(tempPath, this.filePath);
        await chmod(this.filePath, 0o600);
        return receipt;
    }

    async get(receiptId, scope = null) {
        const stored = (await this.readAll()).find((item) => item.receipt_id === receiptId
            && JSON.stringify(item._tenant_scope ?? null) === JSON.stringify(scope));
        if (!stored) return null;
        const { _tenant_scope: _scope, ...receipt } = stored;
        return receipt;
    }
}

function tenantProjectScope(actor) {
    if (typeof actor?.tenant_id !== 'string' || !actor.tenant_id
        || typeof actor?.project_id !== 'string' || !actor.project_id) return null;
    return { tenant_id: actor.tenant_id, project_id: actor.project_id };
}

function buildMentionSearchRequests(mentions) {
  const requests = [];
  const skipped = [];
  for (const mention of mentions) {
    for (const entityType of mention.entity_types) {
      const request = {
        mention,
        entityType,
        query: mention.surface_form
      };
      if (requests.length >= MAX_RETRIEVAL_ATTEMPTS) {
        skipped.push(request);
        continue;
      }
      requests.push(request);
    }
  }
  return { requests, skipped };
}

function normalizeGraphRecords(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.items)) return result.items;
    if (Array.isArray(result?.records)) return result.records;
    return [];
}

function graphPartialErrors(attempts) {
    const failedAttempts = attempts.filter((attempt) => attempt.error);
    if (!failedAttempts.length) return [];
    return [{
        source: 'graph',
        code: 'graph_context_partial',
        message: 'Graph entity retrieval completed with failed scoped queries',
        details: {
            failed_queries: failedAttempts.map((attempt) => ({
                kind: attempt.kind,
                surface_form: attempt.mention?.surface_form || null,
                entity_type: attempt.entityType,
                query: attempt.query || null,
                error_code: sanitizeErrorCode(attempt.error)
            }))
        }
    }];
}

function buildLegacyRetrievalMetadata(mentions) {
    const gaps = mentions.length
        ? [{
            code: 'mention_search_unsupported',
            reason: 'Info SSOT does not expose query-scoped Graph entity search'
        }]
        : [{
            code: 'mention_context_unavailable',
            reason: 'retrieval_context.mention_candidates was not provided'
        }];
    return buildRetrievalMetadata({
        mode: 'project_scoped_legacy',
        mentions,
        attempts: [],
        gaps,
        baseEntityTypes: GRAPH_CONTEXT_ENTITY_TYPES
    });
}

async function retrieveGraphContext(infoSSOTService, access, projectCode, retrievalContext) {
    const mentions = retrievalContext.mentionCandidates;
    if (typeof infoSSOTService?.listGraphEntities !== 'function') {
        const graph = await infoSSOTService.getContext(access, {
            projectCode,
            entityTypes: GRAPH_ENTITY_TYPES,
            limit: MAX_ENTITIES,
            humanReadable: false,
            includeEdges: false,
            includePhilosophy: false,
            scope: 'meeting_minutes_generation'
        });
        return {
            graph,
            retrieval: buildLegacyRetrievalMetadata(mentions),
            status: 'resolved',
            errors: []
        };
    }

    const baseRequests = [
        { kind: 'base', entityType: 'project', limit: 1 },
        { kind: 'base', entityType: 'decision', limit: ENTITY_TYPE_QUOTAS.get('decision') },
        { kind: 'base', entityType: 'document', limit: ENTITY_TYPE_QUOTAS.get('document') }
    ];
    const { requests: mentionRequests, skipped: skippedMentionSearches } = buildMentionSearchRequests(mentions);
    const requests = [
        ...baseRequests.map((request) => ({
            ...request,
            options: { projectCode, entityType: request.entityType, limit: request.limit }
        })),
        ...mentionRequests.map((request) => ({
            ...request,
            kind: 'mention',
            options: {
                projectCode,
                entityType: request.entityType,
                query: request.query,
                limit: MAX_RESULTS_PER_MENTION
            }
        }))
    ];
    const settled = await Promise.all(requests.map(async (request) => {
        try {
            const result = await infoSSOTService.listGraphEntities(access, request.options);
            return { ...request, records: normalizeGraphRecords(result) };
        } catch (error) {
            return { ...request, records: [], error };
        }
    }));

    const baseAttempts = settled.filter((attempt) => attempt.kind === 'base');
    const baseFailures = baseAttempts.filter((attempt) => attempt.error);
    if (baseAttempts.length && baseFailures.length === baseAttempts.length) {
        throw baseFailures[0].error;
    }
    const partialErrors = graphPartialErrors(settled);

    const groups = {};
    for (const attempt of baseAttempts) {
        if (attempt.error) continue;
        for (const record of attempt.records) {
            if (isRecordInProjectScope(record, attempt.entityType, projectCode)) {
                addEntityRecord(groups, attempt.entityType, record);
            }
        }
    }

    const mentionAttempts = settled.filter((attempt) => attempt.kind === 'mention');
    const contextualCandidates = new Map();
    const matchedByMention = new Map();
    for (const attempt of mentionAttempts) {
        attempt.scopeRecords = attempt.records.filter((record) => {
            const recordType = record?.entity_type || attempt.entityType;
            return recordType === attempt.entityType
                && GRAPH_CONTEXT_ENTITY_TYPES.includes(recordType)
                && isRecordInProjectScope(record, recordType, projectCode);
        });
        attempt.matchedRecords = attempt.scopeRecords.filter((record) => scoreMentionCandidate(record, attempt.mention) > 0);
        for (const record of attempt.matchedRecords) {
            const recordType = record?.entity_type || attempt.entityType;
            const key = recordKey(record, recordType);
            const score = scoreMentionCandidate(record, attempt.mention);
            if (!matchedByMention.has(attempt.mention)) matchedByMention.set(attempt.mention, []);
            matchedByMention.get(attempt.mention).push({ record, entityType: recordType, score });
            const previous = contextualCandidates.get(key);
            if (!previous || score > previous.score) {
                contextualCandidates.set(key, { record, entityType: recordType, score });
            }
        }
    }
    const contextualByType = new Map();
    for (const candidate of contextualCandidates.values()) {
        if (!contextualByType.has(candidate.entityType)) contextualByType.set(candidate.entityType, []);
        contextualByType.get(candidate.entityType).push(candidate);
    }
    for (const [entityType, candidates] of contextualByType.entries()) {
        candidates
            .sort((left, right) => right.score - left.score
                || String(right.record?.updated_at || '').localeCompare(String(left.record?.updated_at || ''))
                || recordKey(left.record, entityType).localeCompare(recordKey(right.record, entityType)))
            .slice(0, ENTITY_TYPE_QUOTAS.get(entityType) ?? MAX_RESULTS_PER_MENTION)
            .forEach((candidate) => addEntityRecord(groups, entityType, candidate.record));
    }

    const gaps = [];
    if (skippedMentionSearches.length) {
        gaps.push({
            code: 'mention_search_scope_capped',
            max_retrieval_attempts: MAX_RETRIEVAL_ATTEMPTS,
            skipped: skippedMentionSearches.map((request) => ({
                surface_form: request.mention.surface_form,
                entity_type: request.entityType
            }))
        });
    }
    if (!mentions.length) {
        gaps.push({
            code: 'mention_context_unavailable',
            reason: 'retrieval_context.mention_candidates was not provided'
        });
    }
    for (const baseAttempt of baseAttempts.filter((attempt) => attempt.error)) {
        gaps.push({
            code: 'base_entity_query_failed',
            entity_type: baseAttempt.entityType,
            error_code: sanitizeErrorCode(baseAttempt.error)
        });
    }
    for (const mention of mentions) {
        const attempts = mentionAttempts.filter((attempt) => attempt.mention === mention);
        const skippedTypes = skippedMentionSearches
            .filter((request) => request.mention === mention)
            .map((request) => request.entityType);
        const hasResults = attempts.some((attempt) => attempt.matchedRecords.length > 0);
        const matches = matchedByMention.get(mention) ?? [];
        const topScore = matches.length ? Math.max(...matches.map((match) => match.score)) : 0;
        const topCandidateIds = [...new Set(matches
            .filter((match) => match.score === topScore)
            .map((match) => match.record?.id ?? match.record?.entity_id)
            .filter(Boolean))];
        if (attempts.length && attempts.every((attempt) => attempt.error)) {
            gaps.push({
                code: 'mention_search_failed',
                surface_form: mention.surface_form,
                entity_types: mention.entity_types,
                error_codes: [...new Set(attempts.map((attempt) => sanitizeErrorCode(attempt.error)))]
            });
        } else if (topCandidateIds.length > 1) {
            gaps.push({
                code: 'mention_ambiguous',
                surface_form: mention.surface_form,
                entity_types: mention.entity_types,
                candidate_ids: topCandidateIds.slice(0, 12)
            });
        } else if (!hasResults && !skippedTypes.length) {
            gaps.push({
                code: 'mention_unresolved',
                surface_form: mention.surface_form,
                entity_types: mention.entity_types
            });
        }
    }

    const graph = {
        entities: groups,
        edges: [],
        meta: {
            retrieval_mode: mentions.length ? 'mention_scoped' : 'project_scoped',
            base_entity_types: baseRequests.map((request) => request.entityType)
        }
    };
    return {
        graph,
        retrieval: buildRetrievalMetadata({
            mode: mentions.length ? 'mention_scoped' : 'project_scoped',
            mentions,
            attempts: mentionAttempts,
            gaps,
            skippedQueries: skippedMentionSearches
        }),
        status: partialErrors.length ? 'partial' : 'resolved',
        errors: partialErrors
    };
}

export class MeetingMinutesContextReceiptService {
    constructor({ infoSSOTService, canonicalTaskService, repository, clock = () => new Date() }) {
        this.infoSSOTService = infoSSOTService;
        this.canonicalTaskService = canonicalTaskService;
        this.repository = repository;
        this.clock = clock;
    }

    async create(input, actor = {}) {
        const identity = normalizeIdentity(input);
        const retrievalContext = normalizeRetrievalContext(input);
        assertTenantIdentity(actor);
        assertProjectAccess(actor, identity.project_code);
        const scope = tenantProjectScope(actor);
        const errors = [];
        let graph = null;
        let retrieval = null;
        let graphStatus = 'unavailable';
        let tasks = null;
        try {
            const graphResolution = await retrieveGraphContext(
                this.infoSSOTService,
                graphAccess(actor, identity.project_code),
                identity.project_code,
                retrievalContext
            );
            graph = graphResolution.graph;
            retrieval = graphResolution.retrieval;
            graphStatus = graphResolution.status || 'resolved';
            if (Array.isArray(graphResolution.errors)) errors.push(...graphResolution.errors);
        } catch (error) {
            errors.push({ source: 'graph', code: 'graph_context_unavailable', message: error?.message || String(error) });
        }
        try {
            tasks = await this.canonicalTaskService.listTasks({
                project_code: identity.project_code,
                status: ['pending', 'in_progress', 'waiting'],
                limit: MAX_TASKS
            }, canonicalTaskContext(actor, identity.project_code));
        } catch (error) {
            errors.push({ source: 'tasks', code: 'canonical_tasks_unavailable', message: error?.message || String(error) });
        }
        if (!retrieval) {
            retrieval = buildRetrievalMetadata({
                mode: 'unavailable',
                mentions: retrievalContext.mentionCandidates,
                attempts: [],
                gaps: [{
                    code: 'graph_context_unavailable',
                    reason: 'Graph entity retrieval did not complete'
                }, ...(retrievalContext.mentionCandidates.length ? [] : [{
                    code: 'mention_context_unavailable',
                    reason: 'retrieval_context.mention_candidates was not provided'
                }])]
            });
        }
        const entities = flattenEntities(graph?.entities || {});
        const openTasks = (Array.isArray(tasks?.items) ? tasks.items : [])
            .filter((task) => task.status !== 'completed')
            .slice(0, MAX_TASKS)
            .map((task) => compact(task));
        const minutes = approvedMinutes(entities);
        const context = {
            project: entities.filter((item) => item.entity_type === 'project'),
            people: entities.filter((item) => item.entity_type === 'person'),
            organizations: entities.filter((item) => item.entity_type === 'org'),
            glossary: entities.filter((item) => item.entity_type === 'glossary_term'),
            decisions: entities.filter((item) => item.entity_type === 'decision'),
            entities,
            edges: compact(graph?.edges || []),
            open_tasks: openTasks,
            approved_minutes_refs: minutes,
            source_refs: sourceRefs(entities, openTasks, minutes),
            retrieval
        };
        const sourceStatus = {
            graph: graph ? graphStatus : 'unavailable',
            tasks: tasks ? 'resolved' : 'unavailable'
        };
        const isEmpty = entities.length === 0 && openTasks.length === 0;
        const status = errors.length === 2
            ? 'unavailable'
            : errors.length
                ? 'partial'
                : isEmpty ? 'confirmed_empty' : 'resolved';
        const resolvedAt = this.clock().toISOString();
        const receiptId = `mmctx_${digest(scope ? { identity, scope } : identity).slice(0, 32)}`;
        const base = {
            schema_version: 'meeting_minutes_context_receipt.v1',
            receipt_id: receiptId,
            identity,
            status,
            source_status: sourceStatus,
            searched_scope: {
                project_code: identity.project_code,
                entity_types: GRAPH_ENTITY_TYPES.split(','),
                entity_limit: MAX_ENTITIES,
                task_limit: MAX_TASKS,
                approved_minutes_limit: MAX_MINUTES,
                retrieval: {
                    mode: retrieval.mode,
                    mention_count: retrieval.mention_count,
                    base_entity_types: retrieval.base_entity_types,
                    searched_entity_types: retrieval.searched_entity_types,
                    max_results_per_query: retrieval.max_results_per_query,
                    max_retrieval_attempts: retrieval.max_retrieval_attempts,
                    query_count: retrieval.query_count,
                    queries: retrieval.queries,
                    skipped_queries: retrieval.skipped_queries,
                    gaps: retrieval.gaps
                }
            },
            resolved_at: resolvedAt,
            context,
            errors
        };
        const receipt = boundedReceipt({ ...base, checksum: digest(base) });
        receipt.checksum = digest({ ...receipt, checksum: undefined });
        return this.repository.put(receipt, scope);
    }

    async get(receiptId, input, actor = {}) {
        const identity = normalizeIdentity(input);
        assertTenantIdentity(actor);
        assertProjectAccess(actor, identity.project_code);
        const receipt = await this.repository.get(receiptId, tenantProjectScope(actor));
        if (!receipt) {
            throw new MeetingMinutesContextReceiptError(
                'meeting_minutes_context_receipt_not_found',
                'meeting minutes context receipt was not found',
                404
            );
        }
        if (JSON.stringify(receipt.identity) !== JSON.stringify(identity)) {
            throw new MeetingMinutesContextReceiptError(
                'meeting_minutes_context_identity_mismatch',
                'meeting minutes context receipt identity does not match',
                409
            );
        }
        return receipt;
    }
}
