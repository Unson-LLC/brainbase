/*
 * Browser-side guard for the canonical Objective detail response.
 *
 * The canonical host owns source/provenance.  This module only accepts the
 * envelope; it never supplies a source, timestamp, or fallback record.
 */

export const OBJECTIVE_READBACK_CONTRACT_VERSION = 'brainbase.objective-readback.v1';

const STATUSES = new Set(['ready', 'error', 'unknown']);
const PROVENANCE_KINDS = new Set(['candidate', 'document', 'observation', 'decision', 'import']);

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

function provenance(value) {
  return Array.isArray(value) && value.every((entry) => {
    const object = objectValue(entry);
    return Boolean(object)
      && nonEmpty(object.sourceId)
      && typeof object.sourceKind === 'string'
      && PROVENANCE_KINDS.has(object.sourceKind)
      && Array.isArray(object.evidenceIds)
      && object.evidenceIds.every((id) => typeof id === 'string');
  });
}

function record(value) {
  const object = objectValue(value);
  const definition = objectValue(object?.definition);
  if (!object || !definition || definition.type !== 'objective'
    || !nonEmpty(definition.id) || !nonEmpty(definition.revision)
    || !nonEmpty(object.digest) || !provenance(definition.provenance)) return null;
  return object;
}

function source(value) {
  const object = objectValue(value);
  if (!object || object.source_type !== 'foundation_revision_store'
    || !nonEmpty(object.source_id) || !nonEmpty(object.source_version)
    || !nonEmpty(object.digest) || !provenance(object.provenance)) return null;
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

/**
 * Returns the original payload only when its status semantics and source
 * metadata are internally consistent.  `null` means the response is unsafe
 * to render as a canonical Objective.
 */
export function normalizeObjectiveReadback(payload) {
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
