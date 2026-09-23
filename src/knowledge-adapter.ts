import { createHash } from 'node:crypto';
import {
  DecisionAdapterError,
  validateDecisionAdapterConditions,
  type DecisionAdapterConditions,
  type DecisionAdapterContext
} from './decision-adapter.js';
import {
  initializePersonalOs,
  loadPersonalOs,
  mutatePersonalOsWithSidecar,
  readPersonalOsSidecar
} from './ssot.js';
import type { PersonalOs } from './types.js';

/** Common contract for attaching exact judgment conditions to old knowledge records. */
export const KNOWLEDGE_ADAPTER_VERSION = 'knowledge-condition-adapter.v1' as const;
export const KNOWLEDGE_ADAPTER_SIDECAR = 'evidence/knowledge-condition-adapter.json' as const;

export type KnowledgeRecordKind =
  | 'knowledge_event'
  | 'knowledge_feedback'
  | 'candidate'
  | 'candidate_promotion'
  | 'graph_maintenance_plan'
  | 'human_gate_receipt'
  | 'graph_maintenance_receipt'
  | 'meeting_bridge_event'
  | 'meeting_bridge_candidate';

/** A locator only. The adapter never stores a source record body. */
export interface LegacyKnowledgeRecordRef {
  readonly kind: KnowledgeRecordKind;
  readonly id: string;
  readonly revision?: string;
  readonly digest?: string;
}

/** A provenance locator only. It is intentionally independent of source ACL. */
export interface KnowledgeEvidenceReference {
  readonly kind: string;
  readonly id: string;
  readonly revision?: string;
  readonly digest?: string;
}

export interface KnowledgeAdoptionReference {
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
}

export type KnowledgeSourceStatus = 'present' | 'quarantined' | 'retracted' | 'not_found' | 'denied';
export type KnowledgeConditionStatus = 'recorded' | 'unrecorded' | 'denied' | 'unavailable' | 'integrity_mismatch';
export type KnowledgeAclStatus = 'allowed' | 'denied' | 'unknown';
export type KnowledgeAdoptionStatus = 'recorded' | 'unrecorded' | 'denied' | 'unavailable';

/**
 * Host-owned providers return metadata and exact locators, never a knowledge
 * body. The provider is responsible for current ACL and source ownership.
 */
export interface LegacyKnowledgeRecordRead {
  readonly source_status: KnowledgeSourceStatus;
  readonly acl_status: KnowledgeAclStatus;
  readonly source?: LegacyKnowledgeRecordRef;
  readonly provenance?: readonly KnowledgeEvidenceReference[];
}

export interface LegacyKnowledgeRecordPort {
  read(input: {
    readonly source: LegacyKnowledgeRecordRef;
    readonly context: DecisionAdapterContext;
  }): Promise<LegacyKnowledgeRecordRead>;
}

/** Read-only boundary for host-owned adoption records. No adoption body crosses this port. */
export interface KnowledgeAdoptionReadPort {
  read(input: {
    readonly source: LegacyKnowledgeRecordRef;
    readonly context: DecisionAdapterContext;
  }): Promise<{
    readonly status: KnowledgeAdoptionStatus;
    readonly adoption?: KnowledgeAdoptionReference;
  }>;
}

export interface KnowledgeConditionAdapterOptions {
  readonly dataDir: string;
  readonly recordPort: LegacyKnowledgeRecordPort;
  /** Optional host-owned read-only adoption port. It is never used for writes. */
  readonly adoptionPort?: KnowledgeAdoptionReadPort;
  readonly sidecarPath?: string;
}

export interface KnowledgeConditionAttachOptions {
  /** Caller supplied idempotency key; source kind/id is the default key. */
  readonly idempotency_key?: string;
}

export interface KnowledgeConditionReadResult {
  readonly source: LegacyKnowledgeRecordRef;
  readonly resolved_source?: LegacyKnowledgeRecordRef;
  readonly source_status: KnowledgeSourceStatus;
  readonly acl_status: KnowledgeAclStatus;
  readonly condition_status: KnowledgeConditionStatus;
  readonly conditions?: DecisionAdapterConditions;
  readonly provenance: readonly KnowledgeEvidenceReference[];
  readonly adoption_status: KnowledgeAdoptionStatus;
  readonly adoption?: KnowledgeAdoptionReference;
}

export interface KnowledgeConditionAttachReceipt extends KnowledgeConditionReadResult {
  readonly binding_id: string;
  readonly operation: 'created' | 'existing';
}

export interface KnowledgeConditionReferenceAdapter {
  attach(
    source: LegacyKnowledgeRecordRef,
    conditions: DecisionAdapterConditions,
    context: DecisionAdapterContext,
    options?: KnowledgeConditionAttachOptions,
  ): Promise<KnowledgeConditionAttachReceipt>;
  read(
    source: LegacyKnowledgeRecordRef,
    context: DecisionAdapterContext,
  ): Promise<KnowledgeConditionReadResult>;
}

export type KnowledgeAdapterErrorCode =
  | 'validation_error'
  | 'authorization_denied'
  | 'source_unavailable'
  | 'condition_conflict'
  | 'condition_not_found'
  | 'integrity_mismatch'
  | 'store_corrupt'
  | 'readback_mismatch';

export class KnowledgeAdapterError extends Error {
  readonly code: KnowledgeAdapterErrorCode;

  constructor(code: KnowledgeAdapterErrorCode, message: string) {
    super(message);
    this.name = 'KnowledgeAdapterError';
    this.code = code;
  }
}

interface StoredKnowledgeBinding {
  readonly binding_id: string;
  readonly idempotency_key: string;
  readonly source: LegacyKnowledgeRecordRef;
  readonly source_status_at_attach: Exclude<KnowledgeSourceStatus, 'not_found' | 'denied' | 'retracted'>;
  readonly conditions: DecisionAdapterConditions;
  readonly provenance: readonly KnowledgeEvidenceReference[];
  readonly adoption?: KnowledgeAdoptionReference;
  readonly attached_at: string;
}

interface KnowledgeAdapterSidecar {
  readonly version: typeof KNOWLEDGE_ADAPTER_VERSION;
  readonly bindings: Readonly<Record<string, StoredKnowledgeBinding>>;
}

interface KnowledgeAdapterSnapshot {
  readonly current: PersonalOs;
  readonly sidecarContent?: string;
}

interface NormalizedSourceRead {
  readonly source_status: KnowledgeSourceStatus;
  readonly acl_status: KnowledgeAclStatus;
  readonly source?: LegacyKnowledgeRecordRef;
  readonly provenance: readonly KnowledgeEvidenceReference[];
}

/**
 * Personal canonical implementation. Knowledge records remain owned by the
 * host provider; this store only keeps exact condition/provenance references in
 * a transactional sidecar next to the canonical aggregate.
 */
export class GraphKnowledgeConditionAdapter implements KnowledgeConditionReferenceAdapter {
  private readonly dataDir: string;
  private readonly recordPort: LegacyKnowledgeRecordPort;
  private readonly adoptionPort?: KnowledgeAdoptionReadPort;
  private readonly sidecarPath: string;

  constructor(options: KnowledgeConditionAdapterOptions) {
    if (!options || !options.dataDir) throw new KnowledgeAdapterError('validation_error', 'dataDir is required');
    if (!options.recordPort || typeof options.recordPort.read !== 'function') {
      throw new KnowledgeAdapterError('validation_error', 'recordPort with read is required');
    }
    this.dataDir = options.dataDir;
    this.recordPort = options.recordPort;
    this.adoptionPort = options.adoptionPort;
    this.sidecarPath = options.sidecarPath ?? KNOWLEDGE_ADAPTER_SIDECAR;
    assertSidecarPath(this.sidecarPath);
  }

  async attach(
    source: LegacyKnowledgeRecordRef,
    conditions: DecisionAdapterConditions,
    context: DecisionAdapterContext,
    options: KnowledgeConditionAttachOptions = {},
  ): Promise<KnowledgeConditionAttachReceipt> {
    const requestedSource = normalizeSourceReference(source, 'source');
    const normalizedConditions = normalizeConditions(conditions);
    assertContext(context);
    const idempotencyKey = normalizeText(
      options.idempotency_key ?? `knowledge:${requestedSource.kind}:${requestedSource.id}`,
      'idempotency_key',
      512
    );
    await initializePersonalOs(this.dataDir);
    const snapshot = await this.loadSnapshot();
    const sourceRead = await this.readSource(requestedSource, context, 'attach');
    if (sourceRead.source_status === 'denied' || sourceRead.acl_status !== 'allowed') {
      throw new KnowledgeAdapterError('authorization_denied', `Knowledge source ${sourceKey(requestedSource)} is not readable`);
    }
    if (sourceRead.source_status === 'not_found' || sourceRead.source_status === 'retracted') {
      throw new KnowledgeAdapterError('source_unavailable', `Knowledge source ${sourceKey(requestedSource)} cannot receive a binding`);
    }
    if (sourceRead.source_status !== 'present' && sourceRead.source_status !== 'quarantined') {
      throw new KnowledgeAdapterError('source_unavailable', `Knowledge source ${sourceKey(requestedSource)} cannot receive a binding`);
    }
    const sourceStatusAtAttach: 'present' | 'quarantined' = sourceRead.source_status;
    const exactSource = sourceRead.source;
    if (!exactSource || !hasExactSourceLocator(exactSource)) {
      throw new KnowledgeAdapterError(
        'source_unavailable',
        `Knowledge source ${sourceKey(requestedSource)} did not provide an exact revision and digest`
      );
    }
    assertExpectedSourceLocator(requestedSource, exactSource);

    const adoption = await this.readAdoption(exactSource, context, 'attach');
    if (adoption.status === 'denied') {
      throw new KnowledgeAdapterError('authorization_denied', `Adoption record for ${sourceKey(exactSource)} is not readable`);
    }
    const attachedAt = new Date().toISOString();
    const bindingId = bindingIdFor(exactSource);

    try {
      return await mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, (current, sidecarContent) => {
        assertSnapshotUnchanged(snapshot, current, sidecarContent);
        const sidecar = parseSidecar(sidecarContent);
        const key = sourceKey(exactSource);
        const existing = sidecar.bindings[key];
        if (existing) {
          if (!sameBindingPayload(existing, {
            idempotency_key: idempotencyKey,
            source: exactSource,
            conditions: normalizedConditions,
            provenance: sourceRead.provenance,
            ...(adoption.adoption ? { adoption: adoption.adoption } : {})
          })) {
            throw new KnowledgeAdapterError('condition_conflict', `Knowledge source ${key} already has a different condition binding`);
          }
          return {
            next: current,
            sidecarContent: serializeSidecar(sidecar),
            result: makeAttachReceipt(existing, sourceRead, adoption, 'existing')
          };
        }
        const conflictingKey = Object.keys(sidecar.bindings).find((candidate) => (
          sidecar.bindings[candidate]?.idempotency_key === idempotencyKey
        ));
        if (conflictingKey !== undefined) {
          throw new KnowledgeAdapterError('condition_conflict', `Idempotency key ${idempotencyKey} is already bound to ${conflictingKey}`);
        }
        const stored: StoredKnowledgeBinding = {
          binding_id: bindingId,
          idempotency_key: idempotencyKey,
          source: clone(exactSource),
          source_status_at_attach: sourceStatusAtAttach,
          conditions: clone(normalizedConditions),
          provenance: clone(sourceRead.provenance),
          ...(adoption.adoption ? { adoption: clone(adoption.adoption) } : {}),
          attached_at: attachedAt
        };
        const nextSidecar: KnowledgeAdapterSidecar = {
          ...sidecar,
          bindings: { ...sidecar.bindings, [key]: stored }
        };
        assertStagedBinding(nextSidecar, key, stored);
        return {
          next: current,
          sidecarContent: serializeSidecar(nextSidecar),
          result: makeAttachReceipt(stored, sourceRead, adoption, 'created')
        };
      });
    } catch (error) {
      if (error instanceof KnowledgeAdapterError) throw error;
      throw new KnowledgeAdapterError('store_corrupt', formatError(error));
    }
  }

  async read(
    source: LegacyKnowledgeRecordRef,
    context: DecisionAdapterContext,
  ): Promise<KnowledgeConditionReadResult> {
    const requestedSource = normalizeSourceReference(source, 'source');
    assertContext(context);
    await initializePersonalOs(this.dataDir);
    let sourceRead: NormalizedSourceRead;
    try {
      sourceRead = await this.readSource(requestedSource, context, 'read');
    } catch (error) {
      if (error instanceof KnowledgeAdapterError) throw error;
      throw new KnowledgeAdapterError('source_unavailable', formatError(error));
    }
    if (sourceRead.source_status === 'denied' || sourceRead.acl_status === 'denied') {
      return {
        source: requestedSource,
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'denied',
        provenance: [],
        adoption_status: 'denied'
      };
    }
    if (sourceRead.acl_status === 'unknown') {
      return {
        source: requestedSource,
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'unavailable',
        provenance: [],
        adoption_status: 'unavailable'
      };
    }
    if (sourceRead.source_status === 'not_found' || sourceRead.source_status === 'retracted' || !sourceRead.source) {
      return {
        source: requestedSource,
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'unavailable',
        provenance: [],
        adoption_status: 'unavailable'
      };
    }
    const exactSource = sourceRead.source;
    if (!hasExactSourceLocator(exactSource)) {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'unavailable',
        provenance: clone(sourceRead.provenance),
        adoption_status: 'unavailable'
      };
    }
    try {
      assertExpectedSourceLocator(requestedSource, exactSource);
    } catch {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'integrity_mismatch',
        provenance: clone(sourceRead.provenance),
        adoption_status: 'unavailable'
      };
    }

    const sidecar = await this.loadSidecar();
    const stored = sidecar.bindings[sourceKey(exactSource)];
    if (!stored) {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'unrecorded',
        provenance: clone(sourceRead.provenance),
        adoption_status: this.adoptionPort ? 'unrecorded' : 'unavailable'
      };
    }
    validateStoredBinding(stored, sourceKey(exactSource));
    if (!sameJson(stored.source, exactSource) || !sameJson(stored.provenance, sourceRead.provenance)) {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'integrity_mismatch',
        provenance: clone(sourceRead.provenance),
        adoption_status: 'unavailable'
      };
    }
    const adoption = await this.readAdoption(exactSource, context, 'read');
    if (stored.adoption && adoption.status === 'denied') {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'denied',
        provenance: clone(stored.provenance),
        adoption_status: 'denied'
      };
    }
    if (stored.adoption && adoption.status === 'unavailable') {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'unavailable',
        provenance: clone(stored.provenance),
        adoption_status: 'unavailable'
      };
    }
    if (stored.adoption && adoption.status === 'unrecorded') {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'integrity_mismatch',
        provenance: clone(stored.provenance),
        adoption_status: 'unrecorded'
      };
    }
    if (stored.adoption && adoption.status === 'recorded'
      && (!adoption.adoption || !sameJson(stored.adoption, adoption.adoption))) {
      return {
        source: requestedSource,
        resolved_source: clone(exactSource),
        source_status: sourceRead.source_status,
        acl_status: sourceRead.acl_status,
        condition_status: 'integrity_mismatch',
        provenance: clone(stored.provenance),
        adoption_status: adoption.status
      };
    }
    return {
      source: requestedSource,
      resolved_source: clone(exactSource),
      source_status: sourceRead.source_status,
      acl_status: sourceRead.acl_status,
      condition_status: 'recorded',
      conditions: clone(stored.conditions),
      provenance: clone(stored.provenance),
      adoption_status: adoption.status,
      ...(adoption.adoption ? { adoption: clone(adoption.adoption) } : {})
    };
  }

  private async readSource(
    source: LegacyKnowledgeRecordRef,
    context: DecisionAdapterContext,
    operation: 'attach' | 'read',
  ): Promise<NormalizedSourceRead> {
    try {
      const result = await this.recordPort.read({ source: clone(source), context: clone(context) });
      return normalizeSourceRead(result, source);
    } catch (error) {
      if (error instanceof KnowledgeAdapterError) throw error;
      throw new KnowledgeAdapterError('source_unavailable', formatError(error));
    }
  }

  private async readAdoption(
    source: LegacyKnowledgeRecordRef,
    context: DecisionAdapterContext,
    operation: 'attach' | 'read',
  ): Promise<{ readonly status: KnowledgeAdoptionStatus; readonly adoption?: KnowledgeAdoptionReference }> {
    if (!this.adoptionPort) return { status: 'unavailable' };
    try {
      const result = await this.adoptionPort.read({ source: clone(source), context: clone(context) });
      if (!result || typeof result !== 'object') return { status: 'unavailable' };
      if (result.status !== 'recorded' && result.status !== 'unrecorded'
        && result.status !== 'denied' && result.status !== 'unavailable') {
        return { status: 'unavailable' };
      }
      if (result.adoption === undefined) {
        return result.status === 'recorded' ? { status: 'unavailable' } : { status: result.status };
      }
      if (result.status !== 'recorded') return { status: 'unavailable' };
      return { status: 'recorded', adoption: normalizeAdoptionReference(result.adoption, 'adoption') };
    } catch (error) {
      if (operation === 'read') return { status: 'unavailable' };
      if (error instanceof KnowledgeAdapterError) throw error;
      return { status: 'unavailable' };
    }
  }

  private async loadSnapshot(): Promise<KnowledgeAdapterSnapshot> {
    try {
      return {
        current: await loadPersonalOs(this.dataDir),
        sidecarContent: await readPersonalOsSidecar(this.dataDir, this.sidecarPath)
      };
    } catch (error) {
      throw new KnowledgeAdapterError('store_corrupt', formatError(error));
    }
  }

  private async loadSidecar(): Promise<KnowledgeAdapterSidecar> {
    try {
      return parseSidecar(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    } catch (error) {
      if (error instanceof KnowledgeAdapterError) throw error;
      throw new KnowledgeAdapterError('store_corrupt', formatError(error));
    }
  }
}

export function createKnowledgeConditionAdapter(options: KnowledgeConditionAdapterOptions): KnowledgeConditionReferenceAdapter {
  return new GraphKnowledgeConditionAdapter(options);
}

function normalizeSourceReference(value: unknown, field: string): LegacyKnowledgeRecordRef {
  if (!value || typeof value !== 'object') throw new KnowledgeAdapterError('validation_error', `${field} is required`);
  const input = value as Record<string, unknown>;
  if (!KNOWLEDGE_RECORD_KINDS.includes(input.kind as KnowledgeRecordKind)) {
    throw new KnowledgeAdapterError('validation_error', `${field}.kind is unsupported`);
  }
  const normalized: LegacyKnowledgeRecordRef = {
    kind: input.kind as KnowledgeRecordKind,
    id: normalizeText(input.id, `${field}.id`, 512),
    ...(input.revision === undefined ? {} : { revision: normalizeRevision(input.revision, `${field}.revision`) }),
    ...(input.digest === undefined ? {} : { digest: normalizeDigest(input.digest, `${field}.digest`) })
  };
  return normalized;
}

function normalizeEvidenceReference(value: unknown, field: string): KnowledgeEvidenceReference {
  if (!value || typeof value !== 'object') throw new KnowledgeAdapterError('store_corrupt', `${field} is invalid`);
  const input = value as Record<string, unknown>;
  return {
    kind: normalizeText(input.kind, `${field}.kind`, 256),
    id: normalizeText(input.id, `${field}.id`, 2_048),
    ...(input.revision === undefined ? {} : { revision: normalizeRevision(input.revision, `${field}.revision`) }),
    ...(input.digest === undefined ? {} : { digest: normalizeDigest(input.digest, `${field}.digest`) })
  };
}

function normalizeAdoptionReference(value: unknown, field: string): KnowledgeAdoptionReference {
  if (!value || typeof value !== 'object') throw new KnowledgeAdapterError('source_unavailable', `${field} is invalid`);
  const input = value as Record<string, unknown>;
  return {
    id: normalizeText(input.id, `${field}.id`, 512),
    revision: normalizeRevision(input.revision, `${field}.revision`),
    digest: normalizeDigest(input.digest, `${field}.digest`)
  };
}

function normalizeConditions(value: unknown): DecisionAdapterConditions {
  if (!value || typeof value !== 'object') throw new KnowledgeAdapterError('validation_error', 'conditions are required');
  const input = value as Record<string, unknown>;
  const snapshot = input.problem_snapshot as Record<string, unknown> | undefined;
  const method = input.method as Record<string, unknown> | undefined;
  const refs = input.objective_refs;
  const normalized: DecisionAdapterConditions = {
    problem_snapshot: {
      snapshot_id: normalizeSnapshotId(snapshot?.snapshot_id, 'conditions.problem_snapshot.snapshot_id'),
      problem_id: String(snapshot?.problem_id ?? ''),
      revision: String(snapshot?.revision ?? '')
    },
    method: {
      id: String(method?.id ?? ''),
      version: String(method?.version ?? '')
    },
    objective_refs: Array.isArray(refs) ? refs.map((value) => {
      const ref = value as Record<string, unknown>;
      return {
        id: String(ref?.id ?? ''),
        type: 'objective' as const,
        revision: String(ref?.revision ?? '')
      };
    }) : []
  };
  try {
    validateDecisionAdapterConditions(normalized);
  } catch (error) {
    if (error instanceof DecisionAdapterError) {
      throw new KnowledgeAdapterError('validation_error', error.message);
    }
    throw error;
  }
  return normalized;
}

function normalizeSnapshotId(value: unknown, field: string): DecisionAdapterConditions['problem_snapshot']['snapshot_id'] {
  const snapshotId = normalizeText(value, field, 128);
  if (!/^sha256:[0-9a-f]{64}$/u.test(snapshotId)) {
    throw new KnowledgeAdapterError('validation_error', `${field} must be sha256:<64 lowercase hex>`);
  }
  return snapshotId as DecisionAdapterConditions['problem_snapshot']['snapshot_id'];
}

function normalizeSourceRead(value: unknown, requested: LegacyKnowledgeRecordRef): NormalizedSourceRead {
  if (!value || typeof value !== 'object') throw new KnowledgeAdapterError('source_unavailable', 'Knowledge provider returned an invalid result');
  const input = value as Record<string, unknown>;
  const sourceStatus = input.source_status;
  if (!KNOWLEDGE_SOURCE_STATUSES.includes(sourceStatus as KnowledgeSourceStatus)) {
    throw new KnowledgeAdapterError('source_unavailable', 'Knowledge provider returned an invalid source status');
  }
  const aclStatus = input.acl_status;
  if (!KNOWLEDGE_ACL_STATUSES.includes(aclStatus as KnowledgeAclStatus)) {
    throw new KnowledgeAdapterError('source_unavailable', 'Knowledge provider returned an invalid ACL status');
  }
  const source = input.source === undefined ? undefined : normalizeSourceReference(input.source, 'provider.source');
  if (source && (source.kind !== requested.kind || source.id !== requested.id)) {
    throw new KnowledgeAdapterError('integrity_mismatch', 'Knowledge provider returned a different source identity');
  }
  const rawProvenance = input.provenance;
  if (rawProvenance !== undefined && !Array.isArray(rawProvenance)) {
    throw new KnowledgeAdapterError('source_unavailable', 'Knowledge provider returned invalid provenance');
  }
  const provenance = (rawProvenance ?? []).map((entry, index) => normalizeEvidenceReference(entry, `provider.provenance[${index}]`));
  return {
    source_status: sourceStatus as KnowledgeSourceStatus,
    acl_status: aclStatus as KnowledgeAclStatus,
    ...(source ? { source } : {}),
    provenance
  };
}

function assertExpectedSourceLocator(requested: LegacyKnowledgeRecordRef, resolved: LegacyKnowledgeRecordRef): void {
  if (requested.revision !== undefined && requested.revision !== resolved.revision) {
    throw new KnowledgeAdapterError('integrity_mismatch', 'Knowledge source revision changed');
  }
  if (requested.digest !== undefined && requested.digest !== resolved.digest) {
    throw new KnowledgeAdapterError('integrity_mismatch', 'Knowledge source digest changed');
  }
}

function hasExactSourceLocator(source: LegacyKnowledgeRecordRef): boolean {
  return source.revision !== undefined && source.digest !== undefined;
}

function sourceKey(source: LegacyKnowledgeRecordRef): string {
  return `${source.kind}\u0000${source.id}`;
}

function bindingIdFor(source: LegacyKnowledgeRecordRef): string {
  return `sha256:${createHash('sha256').update(sourceKey(source), 'utf8').digest('hex')}`;
}

function assertSnapshotUnchanged(snapshot: KnowledgeAdapterSnapshot, current: PersonalOs, sidecarContent: string | undefined): void {
  if (!sameJson(snapshot.current, current) || snapshot.sidecarContent !== sidecarContent) {
    throw new KnowledgeAdapterError('condition_conflict', 'Canonical aggregate or knowledge sidecar changed while the provider was read');
  }
}

function assertStagedBinding(sidecar: KnowledgeAdapterSidecar, key: string, expected: StoredKnowledgeBinding): void {
  const staged = sidecar.bindings[key];
  if (!staged || !sameBindingPayload(staged, expected)) {
    throw new KnowledgeAdapterError('readback_mismatch', `Staged knowledge binding ${key} is incomplete`);
  }
}

type ComparableKnowledgeBinding = Pick<StoredKnowledgeBinding, 'idempotency_key' | 'source' | 'conditions' | 'provenance' | 'adoption'>;

function sameBindingPayload(left: ComparableKnowledgeBinding, right: ComparableKnowledgeBinding): boolean {
  return left.idempotency_key === right.idempotency_key
    && sameJson(left.source, right.source)
    && sameJson(left.conditions, right.conditions)
    && sameJson(left.provenance, right.provenance)
    && sameJson(left.adoption, right.adoption);
}

function makeAttachReceipt(
  binding: StoredKnowledgeBinding,
  sourceRead: NormalizedSourceRead,
  adoption: { readonly status: KnowledgeAdoptionStatus; readonly adoption?: KnowledgeAdoptionReference },
  operation: 'created' | 'existing',
): KnowledgeConditionAttachReceipt {
  return {
    binding_id: binding.binding_id,
    operation,
    source: clone(binding.source),
    resolved_source: clone(binding.source),
    source_status: sourceRead.source_status,
    acl_status: sourceRead.acl_status,
    condition_status: 'recorded',
    conditions: clone(binding.conditions),
    provenance: clone(binding.provenance),
    adoption_status: adoption.status,
    ...(adoption.adoption ? { adoption: clone(adoption.adoption) } : {})
  };
}

function parseSidecar(content: string | undefined): KnowledgeAdapterSidecar {
  if (content === undefined || content.trim() === '') return { version: KNOWLEDGE_ADAPTER_VERSION, bindings: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new KnowledgeAdapterError('store_corrupt', `Knowledge adapter sidecar is not valid JSON: ${formatError(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new KnowledgeAdapterError('store_corrupt', 'Knowledge adapter sidecar must be an object');
  }
  const value = parsed as Record<string, unknown>;
  if (value.version !== KNOWLEDGE_ADAPTER_VERSION || !value.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings)) {
    throw new KnowledgeAdapterError('store_corrupt', 'Knowledge adapter sidecar has an unsupported schema');
  }
  const bindings: Record<string, StoredKnowledgeBinding> = {};
  for (const [key, raw] of Object.entries(value.bindings as Record<string, unknown>)) {
    validateStoredBinding(raw as StoredKnowledgeBinding, key);
    bindings[key] = clone(raw as StoredKnowledgeBinding);
  }
  return { version: KNOWLEDGE_ADAPTER_VERSION, bindings };
}

function validateStoredBinding(value: StoredKnowledgeBinding, key: string): void {
  if (!value || typeof value !== 'object' || value.binding_id !== bindingIdFor(value.source) || key !== sourceKey(value.source)) {
    throw new KnowledgeAdapterError('store_corrupt', `Knowledge adapter binding ${key} has an invalid identity`);
  }
  normalizeText(value.idempotency_key, `bindings.${key}.idempotency_key`, 512);
  const source = normalizeSourceReference(value.source, `bindings.${key}.source`);
  if (!hasExactSourceLocator(source)) throw new KnowledgeAdapterError('store_corrupt', `Knowledge adapter binding ${key} has no exact source locator`);
  if (value.source_status_at_attach !== 'present' && value.source_status_at_attach !== 'quarantined') {
    throw new KnowledgeAdapterError('store_corrupt', `Knowledge adapter binding ${key} has an invalid source status`);
  }
  normalizeConditions(value.conditions);
  if (!Array.isArray(value.provenance)) throw new KnowledgeAdapterError('store_corrupt', `Knowledge adapter binding ${key} has invalid provenance`);
  value.provenance.forEach((entry, index) => normalizeEvidenceReference(entry, `bindings.${key}.provenance[${index}]`));
  if (value.adoption !== undefined) normalizeAdoptionReference(value.adoption, `bindings.${key}.adoption`);
  normalizeTimestamp(value.attached_at, `bindings.${key}.attached_at`);
}

function serializeSidecar(sidecar: KnowledgeAdapterSidecar): string {
  const bindings = Object.fromEntries(Object.entries(sidecar.bindings).sort(([left], [right]) => left.localeCompare(right, 'en')));
  return `${JSON.stringify({ version: KNOWLEDGE_ADAPTER_VERSION, bindings }, null, 2)}\n`;
}

function normalizeRevision(value: unknown, field: string): string {
  const revision = normalizeText(value, field, 512);
  if (!/^[1-9][0-9]*$/u.test(revision)) throw new KnowledgeAdapterError('validation_error', `${field} must be a positive decimal revision`);
  return revision;
}

function normalizeDigest(value: unknown, field: string): string {
  const digest = normalizeText(value, field, 128);
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw new KnowledgeAdapterError('validation_error', `${field} must be sha256:<64 lowercase hex>`);
  return digest;
}

function normalizeTimestamp(value: unknown, field: string): string {
  const timestamp = normalizeText(value, field, 64);
  if (!Number.isFinite(Date.parse(timestamp))) throw new KnowledgeAdapterError('store_corrupt', `${field} must be an ISO timestamp`);
  return timestamp;
}

function normalizeText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new KnowledgeAdapterError('validation_error', `${field} is required`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new KnowledgeAdapterError('validation_error', `${field} must be bounded text`);
  }
  return normalized;
}

function assertContext(context: DecisionAdapterContext): void {
  normalizeText(context?.principal, 'context.principal', 512);
}

function assertSidecarPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new KnowledgeAdapterError('validation_error', 'sidecarPath must remain relative to the SSOT root');
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const KNOWLEDGE_RECORD_KINDS: readonly KnowledgeRecordKind[] = [
  'knowledge_event',
  'knowledge_feedback',
  'candidate',
  'candidate_promotion',
  'graph_maintenance_plan',
  'human_gate_receipt',
  'graph_maintenance_receipt',
  'meeting_bridge_event',
  'meeting_bridge_candidate'
];

const KNOWLEDGE_SOURCE_STATUSES: readonly KnowledgeSourceStatus[] = ['present', 'quarantined', 'retracted', 'not_found', 'denied'];
const KNOWLEDGE_ACL_STATUSES: readonly KnowledgeAclStatus[] = ['allowed', 'denied', 'unknown'];
