/*
 * Browser-side guard for the canonical Objective detail response.
 *
 * The canonical host owns source/provenance and exact digest generation and
 * verification. This module checks the digest shape and cross-field
 * agreement, but never recomputes the hash or supplies a source, timestamp,
 * or fallback record.
 */

export const OBJECTIVE_READBACK_CONTRACT_VERSION = 'brainbase.objective-readback.v1';

const STATUSES = new Set(['ready', 'error', 'unknown']);
const PROVENANCE_KINDS = new Set(['candidate', 'document', 'observation', 'decision', 'import']);
const EPISTEMIC_STATES = new Set(['unverified', 'hypothesis', 'supported', 'verified', 'refuted']);
const ADOPTION_STATES = new Set(['draft', 'proposed', 'approved', 'retired']);
const FOUNDATION_USES = new Set(['draft', 'judgment', 'evaluation', 'execution']);
const FOUNDATION_STORAGES = new Set(['candidate', 'ontology', 'evidence', 'execution']);
const VISIBILITIES = new Set(['private', 'project', 'organization', 'public']);
const POSITIVE_REVISION = /^[1-9]\d*$/u;
const FOUNDATION_DIGEST = /^sha256:[0-9a-f]{64}$/u;

function objectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalTimestamp(value) {
  if (!nonEmpty(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function parseRfc3339(value) {
  if (!nonEmpty(value)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return null;
  const zone = match[8];
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  const milliseconds = Number(`${match[7] ?? ''}000`.slice(0, 3));
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds)
    - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => nonEmpty(entry));
}

function scope(value) {
  const object = objectValue(value);
  if (!object || !stringArray(object.subjectIds)) return false;
  const validFrom = parseRfc3339(object.validFrom);
  if (validFrom === null) return false;
  if (object.validUntil === undefined) return true;
  const validUntil = parseRfc3339(object.validUntil);
  return validUntil !== null && validUntil > validFrom;
}

function acl(value) {
  const object = objectValue(value);
  return Boolean(object)
    && nonEmpty(object.ownerId)
    && VISIBILITIES.has(object.visibility)
    && stringArray(object.readerIds)
    && stringArray(object.writerIds);
}

function provenance(value) {
  return Array.isArray(value) && value.every((entry) => {
    const object = objectValue(entry);
    return Boolean(object)
      && nonEmpty(object.sourceId)
      && typeof object.sourceKind === 'string'
      && PROVENANCE_KINDS.has(object.sourceKind)
      && Array.isArray(object.evidenceIds)
      && object.evidenceIds.every((id) => nonEmpty(id));
  });
}

function record(value) {
  const object = objectValue(value);
  const definition = objectValue(object?.definition);
  if (!object || !definition || definition.type !== 'objective'
    || !nonEmpty(definition.id) || typeof definition.revision !== 'string' || !POSITIVE_REVISION.test(definition.revision)
    || !nonEmpty(definition.meaning)
    || !ADOPTION_STATES.has(definition.adoptionState)
    || !Array.isArray(definition.authorizedUses)
    || !definition.authorizedUses.every((use) => FOUNDATION_USES.has(use))
    || !definition.authorizedUses.includes('draft')
    || !acl(definition.acl)
    || !FOUNDATION_STORAGES.has(definition.storage)
    || !scope(definition.scope)
    || !provenance(definition.provenance)
    || (definition.epistemicState !== undefined && !EPISTEMIC_STATES.has(definition.epistemicState))
    || typeof object.digest !== 'string' || !FOUNDATION_DIGEST.test(object.digest)) return null;
  return object;
}

function source(value) {
  const object = objectValue(value);
  if (!object || object.source_type !== 'foundation_revision_store'
    || !nonEmpty(object.source_id) || !nonEmpty(object.source_version)
    || !FOUNDATION_DIGEST.test(object.digest) || !provenance(object.provenance)) return null;
  return object;
}

function reason(value) {
  const object = objectValue(value);
  return object && nonEmpty(object.code) && nonEmpty(object.message) ? object : null;
}

function sameIdentity(left, right) {
  return left?.definition?.id === right?.definition?.id
    && left?.definition?.revision === right?.definition?.revision
    && left?.digest === right?.digest;
}

function matchesExpected(recordValue, expected) {
  if (expected === undefined || expected === null) return true;
  const object = objectValue(expected);
  if (!object || !nonEmpty(object.id)) return false;
  return recordValue.definition.id === object.id
    && (object.revision === undefined || object.revision === null || recordValue.definition.revision === object.revision);
}

/**
 * Returns the original payload only when its status semantics and source
 * metadata are internally consistent.  `null` means the response is unsafe
 * to render as a canonical Objective.
 */
export function normalizeObjectiveReadback(payload, expected) {
  const object = objectValue(payload);
  if (!object
    || object.contract_version !== OBJECTIVE_READBACK_CONTRACT_VERSION
    || !STATUSES.has(object.status)
    || !canonicalTimestamp(object.checked_at)) return null;

  if (object.status === 'ready') {
    const canonicalRecord = record(object.record);
    const objective = record(object.objective);
    const canonicalSource = source(object.source);
    if (object.reason !== null || !canonicalRecord || !objective || !canonicalSource) return null;
    if (!matchesExpected(canonicalRecord, expected)) return null;
    if (!sameIdentity(canonicalRecord, objective)
      || canonicalSource.source_id !== canonicalRecord.definition.id
      || canonicalSource.source_version !== canonicalRecord.definition.revision
      || canonicalSource.digest !== canonicalRecord.digest
      || JSON.stringify(canonicalSource.provenance) !== JSON.stringify(canonicalRecord.definition.provenance)) return null;
    return object;
  }

  return object.source === null
    && object.record === null
    && object.objective === null
    && reason(object.reason)
    ? object
    : null;
}

export default normalizeObjectiveReadback;
