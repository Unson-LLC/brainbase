import { createHash } from 'node:crypto';
import type { FoundationScope } from './ontology-foundation.js';
import type {
  OutcomeCaseCanonicalSource,
  OutcomeCaseConditions,
  OutcomeCaseConditionValue,
  OutcomeCaseOwnerReference,
  OutcomeCasePort,
  OutcomeCaseRead,
  OutcomeCaseReference
} from './company-os-evaluation.js';
import {
  initializePersonalOs,
  mutatePersonalOsWithSidecar,
  readPersonalOsSidecar
} from './ssot.js';

export const COMPANY_OS_RECEIPT_ADAPTER_CONTRACT_VERSION = '0.1.1' as const;
export const COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION = 2 as const;
export const COMPANY_OS_RECEIPT_LINK_SIDECAR = 'evidence/company-os-receipt-links.json' as const;

export type ReceiptSourceKind =
  | 'run_receipt'
  | 'outcome_case'
  | 'meeting_context_receipt'
  | 'decision_event';

export type ReceiptUnknownOwnerReason = 'not_recorded' | 'legacy_untyped' | 'source_unavailable';

export interface ReceiptEntityReference {
  readonly id: string;
  readonly type: string;
  readonly revision?: string;
  readonly digest?: string;
}

export interface ReceiptTypedOwnerReference {
  readonly status: 'typed';
  readonly ref: ReceiptEntityReference;
}

export interface ReceiptUnknownOwnerReference {
  readonly status: 'unknown';
  readonly reason: ReceiptUnknownOwnerReason;
}

export type ReceiptOwnerReference = ReceiptTypedOwnerReference | ReceiptUnknownOwnerReference;

export type ReceiptSourceConditionValue =
  | string
  | number
  | boolean
  | null
  | readonly ReceiptSourceConditionValue[]
  | { readonly [key: string]: ReceiptSourceConditionValue };

export type ReceiptSourceConditions = Readonly<Record<string, ReceiptSourceConditionValue>>;

/**
 * The source's original identity and state.  `hash: null` means the source
 * did not record a hash; the adapter never computes one as a replacement.
 */
export interface ReceiptSourceReference {
  readonly kind: ReceiptSourceKind;
  readonly id: string;
  readonly revision?: string;
  readonly hash: string | null;
  readonly state: string;
  readonly owner_refs: readonly ReceiptOwnerReference[];
  /** Optional source-owned conditions that are part of the stable identity. */
  readonly conditions?: ReceiptSourceConditions;
}

export type ReceiptJudgmentReferenceKind =
  | 'problem'
  | 'objective'
  | 'model'
  | 'constraint'
  | 'dag'
  | 'decision'
  | 'evaluation'
  | 'evidence';

export interface ReceiptJudgmentReference {
  readonly kind: ReceiptJudgmentReferenceKind;
  readonly id: string;
  readonly revision?: string;
  readonly digest?: string;
}

export interface ReceiptAccessContext {
  /** Identity resolved by a trusted caller boundary. */
  readonly principal: string;
  readonly scope?: FoundationScope;
}

/** A source-owner read port. It must enforce its current ACL before returning. */
export interface ReceiptSourcePort {
  read(
    reference: ReceiptSourceReference,
    access: ReceiptAccessContext
  ): Promise<ReceiptSourceProjection | null>;
}

export interface ReceiptSourceProjection {
  /** Current source identity/state; the stored link remains immutable. */
  readonly reference: ReceiptSourceReference;
}

export interface ReceiptLinkRequest {
  readonly id: string;
  readonly source: ReceiptSourceReference;
  readonly judgment_refs: readonly ReceiptJudgmentReference[];
  readonly recorded_at: string;
  readonly access: ReceiptAccessContext;
}

export interface ReceiptLinkRecord {
  readonly version: typeof COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION;
  readonly id: string;
  /** The source reference captured at link time, not a mutable source copy. */
  readonly source: ReceiptSourceReference;
  /** Digest of the immutable source snapshot; source.hash remains source-owned metadata. */
  readonly source_digest: string;
  readonly judgment_refs: readonly ReceiptJudgmentReference[];
  readonly recorded_at: string;
  /** These statuses are intentionally not derived from source execution state. */
  readonly objective_status: 'unrecorded';
  readonly judgment_quality_status: 'unrecorded';
}

export interface ReceiptSourceRead {
  readonly reference: ReceiptSourceReference;
  readonly state_changed: boolean;
}

export interface ReceiptProjection {
  readonly link: ReceiptLinkRecord;
  readonly source_read: ReceiptSourceRead;
}

export interface ReceiptAdapterPort {
  link(request: ReceiptLinkRequest): Promise<ReceiptProjection>;
  read(id: string, access: ReceiptAccessContext): Promise<ReceiptProjection | null>;
  list(access: ReceiptAccessContext): Promise<readonly ReceiptProjection[]>;
}

export interface CompanyOsReceiptAdapterOptions {
  readonly dataDir: string;
  readonly sourcePorts: Partial<Record<ReceiptSourceKind, ReceiptSourcePort>>;
}

export type ReceiptAdapterErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'authorization_denied'
  | 'source_unavailable'
  | 'source_not_found'
  | 'integrity_mismatch'
  | 'revision_conflict'
  | 'corrupt_record'
  | 'readback_mismatch';

export class CompanyOsReceiptAdapterError extends Error {
  readonly code: ReceiptAdapterErrorCode;

  constructor(code: ReceiptAdapterErrorCode, message: string) {
    super(message);
    this.name = 'CompanyOsReceiptAdapterError';
    this.code = code;
  }
}

interface ReceiptLinkCatalog {
  readonly version: typeof COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION;
  readonly records: readonly ReceiptLinkRecord[];
}

export function createCompanyOsReceiptAdapter(
  options: CompanyOsReceiptAdapterOptions
): ReceiptAdapterPort {
  assertOptions(options);
  return new GraphCompanyOsReceiptAdapter(options);
}

/**
 * Reuses the existing read-only OutcomeCasePort without importing any
 * organization runtime. OutcomeCase closure and evaluation remain owned by
 * that provider; this adapter only exposes a source projection.
 */
export function createOutcomeCaseReceiptSourcePort(port: OutcomeCasePort): ReceiptSourcePort {
  if (!port || typeof port.read !== 'function') {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'OutcomeCase port with read is required');
  }
  return {
    async read(reference, access) {
      const normalizedAccess = normalizeAccess(access);
      assertSourceReference(reference, 'OutcomeCase source reference');
      if (reference.kind !== 'outcome_case') {
        throw new CompanyOsReceiptAdapterError('invalid_input', 'OutcomeCase source port received a different source kind');
      }
      const outcomeReference: OutcomeCaseReference = {
        id: reference.id,
        ...(reference.revision === undefined ? {} : { revision: reference.revision }),
        ...(reference.hash === null ? {} : { digest: reference.hash })
      };
      let resolved: OutcomeCaseRead;
      try {
        resolved = await port.read(outcomeReference, {
          principal: normalizedAccess.principal,
          ...(normalizedAccess.scope === undefined ? {} : { scope: normalizedAccess.scope })
        });
      } catch (error) {
        throw mapSourceError(error, `OutcomeCase ${reference.id}`);
      }
      if (!resolved || !resolved.reference
        || !isNonEmptyString(resolved.reference.id)
        || !isNonEmptyString(resolved.reference.revision)
        || !isNonEmptyString(resolved.reference.digest)) {
        throw new CompanyOsReceiptAdapterError('source_unavailable', `OutcomeCase ${reference.id} returned invalid canonical metadata`);
      }
      assertOutcomeCaseSourceProjection(resolved.source, `OutcomeCase ${reference.id}`);
      return {
        reference: {
          kind: 'outcome_case',
          id: resolved.reference.id,
          revision: resolved.reference.revision,
          hash: resolved.reference.digest,
          state: resolved.source.state,
          owner_refs: resolved.source.owner_refs.map(cloneOutcomeCaseOwnerReference),
          ...(resolved.source.conditions === undefined
            ? {}
            : { conditions: cloneOutcomeCaseConditions(resolved.source.conditions) })
        }
      };
    }
  };
}

function assertOutcomeCaseSourceProjection(
  value: unknown,
  label: string
): asserts value is OutcomeCaseCanonicalSource {
  if (!isRecord(value) || !isNonEmptyString(value.state) || !Array.isArray(value.owner_refs)) {
    throw new CompanyOsReceiptAdapterError('source_unavailable', `${label} returned invalid canonical source metadata`);
  }
  value.owner_refs.forEach((owner, index) => assertOutcomeCaseOwnerReference(owner, `${label}.source.owner_refs[${index}]`));
  if (value.conditions !== undefined) {
    assertOutcomeCaseConditions(value.conditions, `${label}.source.conditions`);
  }
}

function assertOutcomeCaseOwnerReference(value: unknown, label: string): asserts value is OutcomeCaseOwnerReference {
  if (!isRecord(value) || (value.status !== 'typed' && value.status !== 'unknown')) {
    throw new CompanyOsReceiptAdapterError('source_unavailable', `${label} has an invalid status`);
  }
  if (value.status === 'unknown') {
    if (!['not_recorded', 'legacy_untyped', 'source_unavailable'].includes(String(value.reason))) {
      throw new CompanyOsReceiptAdapterError('source_unavailable', `${label} has an invalid unknown reason`);
    }
    return;
  }
  if (!isRecord(value.ref)
    || !isNonEmptyString(value.ref.id)
    || !isNonEmptyString(value.ref.type)
    || (value.ref.revision !== undefined && !isNonEmptyString(value.ref.revision))
    || (value.ref.digest !== undefined && !isNonEmptyString(value.ref.digest))) {
    throw new CompanyOsReceiptAdapterError('source_unavailable', `${label}.ref has an invalid shape`);
  }
}

function assertOutcomeCaseConditions(
  value: unknown,
  label: string
): asserts value is OutcomeCaseConditions {
  if (!isRecord(value)) {
    throw new CompanyOsReceiptAdapterError('source_unavailable', `${label} must be an object`);
  }
  assertOutcomeCaseConditionValue(value, label);
}

function assertOutcomeCaseConditionValue(
  value: unknown,
  label: string
): asserts value is OutcomeCaseConditionValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new CompanyOsReceiptAdapterError('source_unavailable', `${label} contains a non-finite number`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOutcomeCaseConditionValue(item, `${label}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!isNonEmptyString(key)) {
        throw new CompanyOsReceiptAdapterError('source_unavailable', `${label} contains an empty key`);
      }
      assertOutcomeCaseConditionValue(item, `${label}.${key}`);
    }
    return;
  }
  throw new CompanyOsReceiptAdapterError('source_unavailable', `${label} contains a non-JSON value`);
}

function cloneOutcomeCaseOwnerReference(owner: OutcomeCaseOwnerReference): ReceiptOwnerReference {
  return owner.status === 'typed'
    ? {
        status: 'typed',
        ref: {
          id: owner.ref.id,
          type: owner.ref.type,
          ...(owner.ref.revision === undefined ? {} : { revision: owner.ref.revision }),
          ...(owner.ref.digest === undefined ? {} : { digest: owner.ref.digest })
        }
      }
    : { status: 'unknown', reason: owner.reason };
}

function cloneOutcomeCaseConditions(conditions: OutcomeCaseConditions): ReceiptSourceConditions {
  return cloneOutcomeCaseConditionValue(conditions) as ReceiptSourceConditions;
}

function cloneOutcomeCaseConditionValue(value: OutcomeCaseConditionValue): ReceiptSourceConditionValue {
  if (Array.isArray(value)) return value.map(cloneOutcomeCaseConditionValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneOutcomeCaseConditionValue(child as OutcomeCaseConditionValue)])
    );
  }
  return value;
}

class GraphCompanyOsReceiptAdapter implements ReceiptAdapterPort {
  constructor(private readonly options: CompanyOsReceiptAdapterOptions) {}

  async link(request: ReceiptLinkRequest): Promise<ReceiptProjection> {
    const normalized = normalizeLinkRequest(request);
    await initializePersonalOs(this.options.dataDir);

    // External reads happen before the SSOT lock. The transaction callback
    // below must remain pure so a provider cannot deadlock on the same lock.
    const currentSource = await this.readCurrentSource(normalized.source, normalized.access, 'link');
    // The request is only a lookup locator.  The source owner's canonical
    // projection is the trusted snapshot that must be persisted.
    const record = makeLinkRecord(normalized, currentSource.reference);
    const stored = await mutatePersonalOsWithSidecar(
      this.options.dataDir,
      COMPANY_OS_RECEIPT_LINK_SIDECAR,
      (current, sidecarContent) => {
        const catalog = parseCatalog(sidecarContent);
        const existing = catalog.records.find((candidate) => candidate.id === record.id);
        if (existing !== undefined) {
          if (!sameLinkPayload(existing, record)) {
            throw new CompanyOsReceiptAdapterError(
              'revision_conflict',
              `Receipt link ${record.id} already exists with different content`
            );
          }
          return { next: current, sidecarContent: serializeCatalog(catalog), result: existing };
        }
        const nextCatalog: ReceiptLinkCatalog = {
          version: COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION,
          records: [...catalog.records, record]
        };
        return { next: current, sidecarContent: serializeCatalog(nextCatalog), result: record };
      }
    );
    return makeProjection(stored, currentSource);
  }

  async read(id: string, access: ReceiptAccessContext): Promise<ReceiptProjection | null> {
    if (!isNonEmptyString(id)) {
      throw new CompanyOsReceiptAdapterError('invalid_input', 'Receipt link id is required');
    }
    const normalizedAccess = normalizeAccess(access);
    await initializePersonalOs(this.options.dataDir);
    const catalog = parseCatalog(await readPersonalOsSidecar(this.options.dataDir, COMPANY_OS_RECEIPT_LINK_SIDECAR));
    const record = catalog.records.find((candidate) => candidate.id === id);
    if (record === undefined) return null;
    const currentSource = await this.readCurrentSource(record.source, normalizedAccess);
    return makeProjection(record, currentSource);
  }

  async list(access: ReceiptAccessContext): Promise<readonly ReceiptProjection[]> {
    const normalizedAccess = normalizeAccess(access);
    await initializePersonalOs(this.options.dataDir);
    const catalog = parseCatalog(await readPersonalOsSidecar(this.options.dataDir, COMPANY_OS_RECEIPT_LINK_SIDECAR));
    const projections: ReceiptProjection[] = [];
    for (const record of catalog.records) {
      const currentSource = await this.readCurrentSource(record.source, normalizedAccess);
      projections.push(makeProjection(record, currentSource));
    }
    return projections;
  }

  private async readCurrentSource(
    reference: ReceiptSourceReference,
    access: ReceiptAccessContext,
    mode: 'link' | 'stored' = 'stored'
  ): Promise<ReceiptSourceRead> {
    const port = this.options.sourcePorts[reference.kind];
    if (!port || typeof port.read !== 'function') {
      throw new CompanyOsReceiptAdapterError(
        'source_unavailable',
        `No source provider is configured for ${reference.kind}`
      );
    }
    let projection: ReceiptSourceProjection | null;
    try {
      projection = await port.read(cloneSourceReference(reference), access);
    } catch (error) {
      throw mapSourceError(error, `${reference.kind}/${reference.id}`);
    }
    if (projection === null) {
      throw new CompanyOsReceiptAdapterError(
        'source_not_found',
        `Source ${reference.kind}/${reference.id} was not found`
      );
    }
    try {
      assertSourceProjection(projection);
    } catch (error) {
      if (error instanceof CompanyOsReceiptAdapterError) throw error;
      throw new CompanyOsReceiptAdapterError('source_unavailable', formatError(error));
    }
    if (mode === 'link') {
      assertSourceLocator(reference, projection.reference);
    } else {
      assertSourceIdentity(reference, projection.reference);
    }
    return {
      reference: cloneSourceReference(projection.reference),
      state_changed: projection.reference.state !== reference.state
    };
  }
}

function assertOptions(options: CompanyOsReceiptAdapterOptions): void {
  if (!options || !isNonEmptyString(options.dataDir)) {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'dataDir is required');
  }
  if (!options.sourcePorts || typeof options.sourcePorts !== 'object') {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'sourcePorts are required');
  }
}

function normalizeLinkRequest(request: ReceiptLinkRequest): Required<Pick<ReceiptLinkRequest, 'id' | 'recorded_at'>> & {
  readonly source: ReceiptSourceReference;
  readonly judgment_refs: readonly ReceiptJudgmentReference[];
  readonly access: ReceiptAccessContext;
} {
  if (!request || typeof request !== 'object') {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'Receipt link request is required');
  }
  if (!isNonEmptyString(request.id)) {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'Receipt link id is required');
  }
  if (!isStrictRfc3339(request.recorded_at)) {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'Receipt recorded_at must be RFC3339');
  }
  assertSourceReference(request.source, 'Receipt source');
  if (!Array.isArray(request.judgment_refs)) {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'judgment_refs must be an array');
  }
  const judgmentRefs = request.judgment_refs.map((reference, index) => {
    assertJudgmentReference(reference, `judgment_refs[${index}]`);
    return cloneJudgmentReference(reference);
  });
  const keys = new Set(judgmentRefs.map(judgmentReferenceKey));
  if (keys.size !== judgmentRefs.length) {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'judgment_refs must not contain duplicates');
  }
  return {
    id: request.id,
    source: cloneSourceReference(request.source),
    judgment_refs: judgmentRefs,
    recorded_at: request.recorded_at,
    access: normalizeAccess(request.access)
  };
}

function makeLinkRecord(
  request: ReturnType<typeof normalizeLinkRequest>,
  canonicalSource: ReceiptSourceReference
): ReceiptLinkRecord {
  return {
    version: COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION,
    id: request.id,
    source: cloneSourceReference(canonicalSource),
    source_digest: sourceSnapshotDigest(canonicalSource),
    judgment_refs: request.judgment_refs.map(cloneJudgmentReference),
    recorded_at: request.recorded_at,
    objective_status: 'unrecorded',
    judgment_quality_status: 'unrecorded'
  };
}

function makeProjection(record: ReceiptLinkRecord, sourceRead: ReceiptSourceRead): ReceiptProjection {
  return {
    link: cloneLinkRecord(record),
    source_read: {
      reference: cloneSourceReference(sourceRead.reference),
      // Always compare against the persisted snapshot.  In particular, a
      // link request may contain caller-supplied state that the provider
      // correctly replaces with its canonical current state.
      state_changed: sourceRead.reference.state !== record.source.state
    }
  };
}

function parseCatalog(content: string | undefined): ReceiptLinkCatalog {
  if (content === undefined) return { version: COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION, records: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', `Receipt link sidecar is not valid JSON: ${formatError(error)}`);
  }
  if (!isRecord(parsed) || parsed.version !== COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION || !Array.isArray(parsed.records)) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', 'Receipt link sidecar has an unsupported catalog shape');
  }
  const records = parsed.records.map((record, index) => parseStoredRecord(record, `records[${index}]`));
  const ids = new Set(records.map((record) => record.id));
  if (ids.size !== records.length) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', 'Receipt link sidecar contains duplicate IDs');
  }
  return { version: COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION, records };
}

function parseStoredRecord(value: unknown, label: string): ReceiptLinkRecord {
  if (!isRecord(value)) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', `${label} must be an object`);
  }
  if (value.version !== COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION
    || value.objective_status !== 'unrecorded'
    || value.judgment_quality_status !== 'unrecorded') {
    throw new CompanyOsReceiptAdapterError('corrupt_record', `${label} has invalid status or version`);
  }
  if (!isNonEmptyString(value.id) || !isStrictRfc3339(value.recorded_at)) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', `${label} has invalid id or recorded_at`);
  }
  assertSourceReference(value.source, `${label}.source`, 'corrupt_record');
  if (!isSourceDigest(value.source_digest)
    || value.source_digest !== sourceSnapshotDigest(value.source)) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', `${label}.source_digest does not match the source snapshot`);
  }
  if (!Array.isArray(value.judgment_refs)) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', `${label}.judgment_refs must be an array`);
  }
  const judgmentRefs = value.judgment_refs.map((reference, index) => {
    assertJudgmentReference(reference, `${label}.judgment_refs[${index}]`, 'corrupt_record');
    return cloneJudgmentReference(reference);
  });
  const keys = new Set(judgmentRefs.map(judgmentReferenceKey));
  if (keys.size !== judgmentRefs.length) {
    throw new CompanyOsReceiptAdapterError('corrupt_record', `${label}.judgment_refs contains duplicates`);
  }
  return {
    version: COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION,
    id: value.id,
    source: cloneSourceReference(value.source),
    source_digest: value.source_digest,
    judgment_refs: judgmentRefs,
    recorded_at: value.recorded_at,
    objective_status: 'unrecorded',
    judgment_quality_status: 'unrecorded'
  };
}

function serializeCatalog(catalog: ReceiptLinkCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function assertSourceReference(
  value: unknown,
  label: string,
  code: ReceiptAdapterErrorCode = 'invalid_input'
): asserts value is ReceiptSourceReference {
  if (!isRecord(value)
    || !['run_receipt', 'outcome_case', 'meeting_context_receipt', 'decision_event'].includes(String(value.kind))
    || !isNonEmptyString(value.id)
    || (value.revision !== undefined && !isNonEmptyString(value.revision))
    || (value.hash !== null && !isNonEmptyString(value.hash))
    || !isNonEmptyString(value.state)
    || !Array.isArray(value.owner_refs)) {
    throw new CompanyOsReceiptAdapterError(code, `${label} has an invalid shape`);
  }
  value.owner_refs.forEach((owner, index) => assertOwnerReference(owner, `${label}.owner_refs[${index}]`, code));
  if (value.conditions !== undefined) {
    assertSourceConditions(value.conditions, `${label}.conditions`, code);
  }
}

function assertOwnerReference(value: unknown, label: string, code: ReceiptAdapterErrorCode): void {
  if (!isRecord(value) || (value.status !== 'typed' && value.status !== 'unknown')) {
    throw new CompanyOsReceiptAdapterError(code, `${label} has an invalid status`);
  }
  if (value.status === 'unknown') {
    if (!['not_recorded', 'legacy_untyped', 'source_unavailable'].includes(String(value.reason))) {
      throw new CompanyOsReceiptAdapterError(code, `${label} has an invalid unknown reason`);
    }
    return;
  }
  if (!isRecord(value.ref)
    || !isNonEmptyString(value.ref.id)
    || !isNonEmptyString(value.ref.type)
    || (value.ref.revision !== undefined && !isNonEmptyString(value.ref.revision))
    || (value.ref.digest !== undefined && !isNonEmptyString(value.ref.digest))) {
    throw new CompanyOsReceiptAdapterError(code, `${label}.ref has an invalid shape`);
  }
}

function assertSourceConditions(
  value: unknown,
  label: string,
  code: ReceiptAdapterErrorCode
): asserts value is ReceiptSourceConditions {
  if (!isRecord(value)) {
    throw new CompanyOsReceiptAdapterError(code, `${label} must be an object`);
  }
  assertSourceConditionValue(value, label, code);
}

function assertSourceConditionValue(
  value: unknown,
  label: string,
  code: ReceiptAdapterErrorCode
): asserts value is ReceiptSourceConditionValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new CompanyOsReceiptAdapterError(code, `${label} contains a non-finite number`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSourceConditionValue(item, `${label}[${index}]`, code));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!isNonEmptyString(key)) {
        throw new CompanyOsReceiptAdapterError(code, `${label} contains an empty key`);
      }
      assertSourceConditionValue(item, `${label}.${key}`, code);
    }
    return;
  }
  throw new CompanyOsReceiptAdapterError(code, `${label} contains a non-JSON value`);
}

function assertSourceProjection(value: unknown): asserts value is ReceiptSourceProjection {
  if (!isRecord(value)) {
    throw new CompanyOsReceiptAdapterError('source_unavailable', 'Source provider returned an invalid projection');
  }
  assertSourceReference(value.reference, 'Source projection.reference', 'source_unavailable');
}

function assertSourceLocator(expected: ReceiptSourceReference, actual: ReceiptSourceReference): void {
  if (expected.kind !== actual.kind || expected.id !== actual.id) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned a different kind or ID');
  }
  if (expected.revision !== undefined && expected.revision !== actual.revision) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned a different revision');
  }
  if (expected.hash !== null && expected.hash !== actual.hash) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned a different hash');
  }
  if (expected.conditions !== undefined && !sameJson(expected.conditions, actual.conditions)) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned different conditions');
  }
}

/**
 * Verifies the stable identity of a saved source snapshot against its current
 * owner projection.  State is deliberately excluded: a source may transition
 * after linking and is reported through `state_changed` instead.
 */
function assertSourceIdentity(expected: ReceiptSourceReference, actual: ReceiptSourceReference): void {
  assertSourceLocator(expected, actual);
  if (expected.revision !== actual.revision) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned a different revision');
  }
  if (expected.hash !== actual.hash) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned a different hash');
  }
  if (!sameJson(expected.owner_refs, actual.owner_refs)) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned different owner references');
  }
  if (!sameJson(expected.conditions, actual.conditions)) {
    throw new CompanyOsReceiptAdapterError('integrity_mismatch', 'Source provider returned different conditions');
  }
}

function assertJudgmentReference(
  value: unknown,
  label: string,
  code: ReceiptAdapterErrorCode = 'invalid_input'
): asserts value is ReceiptJudgmentReference {
  if (!isRecord(value)
    || !['problem', 'objective', 'model', 'constraint', 'dag', 'decision', 'evaluation', 'evidence'].includes(String(value.kind))
    || !isNonEmptyString(value.id)
    || (value.revision !== undefined && !isNonEmptyString(value.revision))
    || (value.digest !== undefined && !isNonEmptyString(value.digest))) {
    throw new CompanyOsReceiptAdapterError(code, `${label} has an invalid shape`);
  }
}

function normalizeAccess(value: ReceiptAccessContext): ReceiptAccessContext {
  if (!value || typeof value !== 'object' || !isNonEmptyString(value.principal)) {
    throw new CompanyOsReceiptAdapterError('invalid_input', 'Receipt access principal is required');
  }
  return {
    principal: value.principal,
    ...(value.scope === undefined ? {} : { scope: value.scope })
  };
}

function mapSourceError(error: unknown, label: string): CompanyOsReceiptAdapterError {
  if (error instanceof CompanyOsReceiptAdapterError) return error;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'authorization_denied' || code === 'scope_violation') {
      return new CompanyOsReceiptAdapterError('authorization_denied', `${label} read was denied`);
    }
    if (code === 'not_found') return new CompanyOsReceiptAdapterError('source_not_found', `${label} was not found`);
    if (code === 'integrity_mismatch') return new CompanyOsReceiptAdapterError('integrity_mismatch', `${label} identity did not match`);
  }
  return new CompanyOsReceiptAdapterError('source_unavailable', `${label} read was unavailable: ${formatError(error)}`);
}

function cloneSourceReference(reference: ReceiptSourceReference): ReceiptSourceReference {
  return {
    kind: reference.kind,
    id: reference.id,
    ...(reference.revision === undefined ? {} : { revision: reference.revision }),
    hash: reference.hash,
    state: reference.state,
    owner_refs: reference.owner_refs.map((owner) => owner.status === 'typed'
      ? {
          status: 'typed',
          ref: {
            id: owner.ref.id,
            type: owner.ref.type,
            ...(owner.ref.revision === undefined ? {} : { revision: owner.ref.revision }),
            ...(owner.ref.digest === undefined ? {} : { digest: owner.ref.digest })
          }
        }
      : { status: 'unknown', reason: owner.reason }),
    ...(reference.conditions === undefined ? {} : { conditions: cloneSourceConditions(reference.conditions) })
  };
}

function cloneSourceConditions(conditions: ReceiptSourceConditions): ReceiptSourceConditions {
  return cloneSourceConditionValue(conditions) as ReceiptSourceConditions;
}

function cloneSourceConditionValue(value: ReceiptSourceConditionValue): ReceiptSourceConditionValue {
  if (Array.isArray(value)) return value.map(cloneSourceConditionValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneSourceConditionValue(child as ReceiptSourceConditionValue)])
    );
  }
  return value;
}

function cloneJudgmentReference(reference: ReceiptJudgmentReference): ReceiptJudgmentReference {
  return {
    kind: reference.kind,
    id: reference.id,
    ...(reference.revision === undefined ? {} : { revision: reference.revision }),
    ...(reference.digest === undefined ? {} : { digest: reference.digest })
  };
}

function cloneLinkRecord(record: ReceiptLinkRecord): ReceiptLinkRecord {
  return {
    version: COMPANY_OS_RECEIPT_LINK_CATALOG_VERSION,
    id: record.id,
    source: cloneSourceReference(record.source),
    source_digest: record.source_digest,
    judgment_refs: record.judgment_refs.map(cloneJudgmentReference),
    recorded_at: record.recorded_at,
    objective_status: 'unrecorded',
    judgment_quality_status: 'unrecorded'
  };
}

function judgmentReferenceKey(reference: ReceiptJudgmentReference): string {
  return `${reference.kind}:${reference.id}:${reference.revision ?? ''}:${reference.digest ?? ''}`;
}

function sameLinkPayload(left: ReceiptLinkRecord, right: ReceiptLinkRecord): boolean {
  return left.id === right.id
    && left.recorded_at === right.recorded_at
    && sameSourceIdentity(left.source, right.source)
    && sameJson(left.judgment_refs, right.judgment_refs);
}

function sameSourceIdentity(left: ReceiptSourceReference, right: ReceiptSourceReference): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && left.revision === right.revision
    && left.hash === right.hash
    && sameJson(left.owner_refs, right.owner_refs)
    && sameJson(left.conditions, right.conditions);
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function sourceSnapshotDigest(source: ReceiptSourceReference): string {
  return `sha256:${createHash('sha256').update(stableJson(source), 'utf8').digest('hex')}`;
}

function isSourceDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalizeJson(child)])
    );
  }
  return value;
}

function isStrictRfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[8].slice(1, 3));
    const offsetMinute = Number(match[8].slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
