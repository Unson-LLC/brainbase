import { randomUUID } from 'node:crypto';
import {
  JudgmentDAGProblemSnapshotReference,
  JudgmentDAGVersionReference
} from './judgment-dag-composition.js';
import type { CanonicalEntity, DecisionRecord, GraphFile, PersonalOs } from './types.js';
import type { FoundationRevision } from './ontology-foundation.js';
import {
  initializePersonalOs,
  loadPersonalOs,
  mutatePersonalOsWithSidecar,
  readPersonalOsSidecar
} from './ssot.js';

/** Public version of the adapter contract. It is independent from the old organization route. */
export const DECISION_ADAPTER_VERSION = 'decision-adapter.v1' as const;

/** The sidecar contains references and compatibility metadata, never canonical definitions. */
export const DECISION_ADAPTER_SIDECAR = 'evidence/decision-adapter.json' as const;

export type DecisionAdapterAction = 'create' | 'read';

export interface DecisionAdapterContext {
  /** Identity resolved by a trusted host boundary; it is never taken from a request body. */
  readonly principal: string;
}

export interface DecisionAdapterObjectiveReference extends FoundationRevision {
  readonly type: 'objective';
}

/**
 * Conditions required for a newly recorded Decision. All three references are
 * immutable locators; the adapter does not copy their definitions.
 */
export interface DecisionAdapterConditions {
  readonly problem_snapshot: JudgmentDAGProblemSnapshotReference;
  readonly method: JudgmentDAGVersionReference;
  readonly objective_refs: readonly DecisionAdapterObjectiveReference[];
}

export interface DecisionAdapterDecisionRequest {
  readonly decision_id?: string;
  readonly title: string;
  readonly decision: string;
  readonly topic?: string;
  readonly rationale?: string;
  readonly effectiveAt?: string;
  readonly tags?: readonly string[];
  readonly conditions: DecisionAdapterConditions;
}

export interface DecisionAdapterAiDecisionLogRequest {
  /** Canonical Decision ID to which this AI log is attached. */
  readonly decision_id?: string;
  /** Compatibility alias used by some legacy callers. */
  readonly related_decision_id?: string;
  readonly summary: string;
  readonly decision_type?: string;
  readonly rationale?: string;
  readonly confidence?: number;
  readonly related_entity_id?: string;
  readonly references?: readonly string[];
  readonly conditions: DecisionAdapterConditions;
}

/** Required old response keys. Additional organization guard fields are intentionally not synthesized. */
export interface DecisionAdapterLegacyDecisionResponse {
  readonly decision_id: string;
  readonly event_id: string;
}

export interface DecisionAdapterLegacyAiDecisionResponse {
  readonly ai_decision_id: string;
  readonly event_id: string;
}

export interface DecisionAdapterAiLogRecord {
  readonly ai_decision_id: string;
  readonly event_id: string;
  readonly summary: string;
  readonly decision_type?: string;
  readonly rationale?: string;
  readonly confidence?: number;
  readonly related_entity_id?: string;
  readonly references?: readonly string[];
  readonly conditions: DecisionAdapterConditions;
  readonly created_at: string;
}

export interface DecisionAdapterReadResult {
  readonly decision: DecisionRecord;
  /** Missing for a legacy record that predates a canonical Graph entity. */
  readonly graph_entity?: CanonicalEntity;
  readonly condition_status: 'recorded' | 'unrecorded';
  readonly conditions?: DecisionAdapterConditions;
  /** This adapter never infers authority from a Decision or its conditions. */
  readonly authority_status: 'unrecorded';
  readonly ai_logs: readonly DecisionAdapterAiLogRecord[];
}

export interface DecisionAdapterConditionValidator {
  /**
   * Resolve exact Problem/Objective references against the current trusted
   * ACL and canonical store. Returning false is a fail-closed denial.
   */
  validate(input: {
    readonly conditions: DecisionAdapterConditions;
    readonly context: DecisionAdapterContext;
  }): void | boolean | Promise<void | boolean>;
}

export interface DecisionAdapterAuthorizationRequest {
  readonly action: DecisionAdapterAction;
  readonly context: DecisionAdapterContext;
  readonly current: PersonalOs;
  readonly decision?: DecisionRecord;
  readonly graph_entity?: CanonicalEntity;
}

export interface DecisionAdapterAuthorizationPolicy {
  authorize(input: DecisionAdapterAuthorizationRequest): void | boolean | Promise<void | boolean>;
}

export interface DecisionAdapterStoreOptions {
  readonly dataDir: string;
  readonly sidecarPath?: string;
  /** Trusted reference provider. The store only validates shape when omitted. */
  readonly conditionValidator?: DecisionAdapterConditionValidator;
  /** Organization-specific policy is injected here; no tenant/RACI is in OSS. */
  readonly authorization?: DecisionAdapterAuthorizationPolicy;
}

export interface DecisionAdapterStore {
  createDecision(
    input: DecisionAdapterDecisionRequest,
    context: DecisionAdapterContext,
  ): Promise<DecisionAdapterLegacyDecisionResponse>;
  createAiDecisionLog(
    input: DecisionAdapterAiDecisionLogRequest,
    context: DecisionAdapterContext,
  ): Promise<DecisionAdapterLegacyAiDecisionResponse>;
  readDecision(
    input: { readonly decision_id: string },
    context: DecisionAdapterContext,
  ): Promise<DecisionAdapterReadResult>;
}

/** The public port is deliberately the same small surface as the store. */
export interface DecisionAdapterPort extends DecisionAdapterStore {}

export type DecisionAdapterErrorCode =
  | 'validation_error'
  | 'authorization_denied'
  | 'condition_unavailable'
  | 'decision_conflict'
  | 'decision_not_found'
  | 'graph_unsupported'
  | 'store_corrupt'
  | 'readback_mismatch';

export class DecisionAdapterError extends Error {
  readonly code: DecisionAdapterErrorCode;

  constructor(code: DecisionAdapterErrorCode, message: string) {
    super(message);
    this.name = 'DecisionAdapterError';
    this.code = code;
  }
}

interface StoredDecisionRecord {
  readonly decision_id: string;
  readonly conditions: DecisionAdapterConditions;
  readonly created_at: string;
  readonly ai_logs: readonly DecisionAdapterAiLogRecord[];
}

interface DecisionAdapterSidecar {
  readonly version: typeof DECISION_ADAPTER_VERSION;
  readonly decisions: Readonly<Record<string, StoredDecisionRecord>>;
}

/**
 * Personal canonical implementation. It never creates a second Decision
 * store: `decisions.jsonl` and the Graph entity remain the canonical records.
 */
export class GraphDecisionAdapterStore implements DecisionAdapterPort {
  private readonly dataDir: string;
  private readonly sidecarPath: string;
  private readonly conditionValidator?: DecisionAdapterConditionValidator;
  private readonly authorization?: DecisionAdapterAuthorizationPolicy;

  constructor(options: DecisionAdapterStoreOptions) {
    if (!options.dataDir) throw new DecisionAdapterError('validation_error', 'dataDir is required');
    this.dataDir = options.dataDir;
    this.sidecarPath = options.sidecarPath ?? DECISION_ADAPTER_SIDECAR;
    assertSidecarPath(this.sidecarPath);
    this.conditionValidator = options.conditionValidator;
    this.authorization = options.authorization;
  }

  async createDecision(
    input: DecisionAdapterDecisionRequest,
    context: DecisionAdapterContext,
  ): Promise<DecisionAdapterLegacyDecisionResponse> {
    const request = normalizeDecisionRequest(input);
    assertContext(context);
    await this.validateConditions(request.conditions, context);
    await initializePersonalOs(this.dataDir);

    const decisionId = request.decision_id ?? `dec-${randomUUID()}`;
    const eventId = `evt-${randomUUID()}`;
    const now = new Date().toISOString();
    const decision = omitUndefined({
      id: decisionId,
      title: request.title,
      decision: request.decision,
      topic: request.topic,
      rationale: request.rationale,
      effectiveAt: request.effectiveAt,
      tags: request.tags === undefined ? undefined : [...request.tags],
      updatedAt: now
    });
    const entity: CanonicalEntity = omitUndefined({
      id: decisionId,
      type: 'decision' as const,
      name: request.title,
      summary: request.decision,
      tags: request.tags === undefined ? undefined : [...request.tags]
    });

    const result = await this.mutateSidecar(async (current, sidecarContent) => {
      if (current.graph.version !== 2) {
        throw new DecisionAdapterError('graph_unsupported', 'New Decision writes require canonical Graph v2');
      }
      if (current.decisions.some((candidate) => candidate.id === decisionId)
        || current.graph.entities.some((candidate) => candidate.id === decisionId)) {
        throw new DecisionAdapterError('decision_conflict', `Decision ${decisionId} already exists`);
      }
      const sidecar = parseSidecar(sidecarContent);
      if (Object.prototype.hasOwnProperty.call(sidecar.decisions, decisionId)) {
        throw new DecisionAdapterError('decision_conflict', `Decision sidecar entry ${decisionId} already exists`);
      }
      await this.authorize({ action: 'create', context, current, decision, graph_entity: entity });
      const stored: StoredDecisionRecord = {
        decision_id: decisionId,
        conditions: clone(request.conditions),
        created_at: now,
        ai_logs: []
      };
      const nextSidecar = {
        ...sidecar,
        decisions: { ...sidecar.decisions, [decisionId]: stored }
      } satisfies DecisionAdapterSidecar;
      const nextGraph = {
        ...current.graph,
        entities: [...current.graph.entities, entity]
      };
      const next = {
        ...current,
        decisions: [...current.decisions, decision],
        graph: nextGraph
      };
      return {
        next,
        sidecarContent: serializeSidecar(nextSidecar),
        result: { decision_id: decisionId, event_id: eventId }
      };
    });

    await this.assertReadback(decisionId, context, request.conditions);
    return result;
  }

  async createAiDecisionLog(
    input: DecisionAdapterAiDecisionLogRequest,
    context: DecisionAdapterContext,
  ): Promise<DecisionAdapterLegacyAiDecisionResponse> {
    const request = normalizeAiDecisionLogRequest(input);
    assertContext(context);
    await this.validateConditions(request.conditions, context);
    await initializePersonalOs(this.dataDir);

    const aiDecisionId = `aid-${randomUUID()}`;
    const eventId = `evt-${randomUUID()}`;
    const now = new Date().toISOString();
    const aiLog: DecisionAdapterAiLogRecord = omitUndefined({
      ai_decision_id: aiDecisionId,
      event_id: eventId,
      summary: request.summary,
      decision_type: request.decision_type,
      rationale: request.rationale,
      confidence: request.confidence,
      related_entity_id: request.related_entity_id,
      references: request.references === undefined ? undefined : [...request.references],
      conditions: clone(request.conditions),
      created_at: now
    });

    const result = await this.mutateSidecar(async (current, sidecarContent) => {
      const decision = current.decisions.find((candidate) => candidate.id === request.decision_id);
      if (!decision) {
        throw new DecisionAdapterError('decision_not_found', `Decision ${request.decision_id} was not found`);
      }
      if (current.graph.version !== 2) {
        throw new DecisionAdapterError('graph_unsupported', 'AI decision-log writes require canonical Graph v2');
      }
      const graphEntity = current.graph.entities.find((candidate) => candidate.id === request.decision_id);
      if (!graphEntity || graphEntity.type !== 'decision') {
        throw new DecisionAdapterError('readback_mismatch', `Canonical Graph entity ${request.decision_id} is missing`);
      }
      const sidecar = parseSidecar(sidecarContent);
      const existing = sidecar.decisions[request.decision_id];
      if (existing && !sameConditions(existing.conditions, request.conditions)) {
        throw new DecisionAdapterError('condition_unavailable', `Decision ${request.decision_id} has different recorded conditions`);
      }
      await this.authorize({ action: 'create', context, current, decision, graph_entity: graphEntity });
      const stored: StoredDecisionRecord = existing ?? {
        decision_id: request.decision_id,
        conditions: clone(request.conditions),
        created_at: now,
        ai_logs: []
      };
      const nextStored: StoredDecisionRecord = {
        ...stored,
        ai_logs: [...stored.ai_logs, aiLog]
      };
      const nextSidecar = {
        ...sidecar,
        decisions: { ...sidecar.decisions, [request.decision_id]: nextStored }
      } satisfies DecisionAdapterSidecar;
      return {
        next: current,
        sidecarContent: serializeSidecar(nextSidecar),
        result: { ai_decision_id: aiDecisionId, event_id: eventId }
      };
    });

    await this.assertReadback(request.decision_id, context, request.conditions);
    return result;
  }

  async readDecision(
    input: { readonly decision_id: string },
    context: DecisionAdapterContext,
  ): Promise<DecisionAdapterReadResult> {
    const decisionId = normalizeIdentifier(input?.decision_id, 'decision_id');
    assertContext(context);
    await initializePersonalOs(this.dataDir);
    const current = await this.loadCurrent();
    const decision = current.decisions.find((candidate) => candidate.id === decisionId);
    if (!decision) throw new DecisionAdapterError('decision_not_found', `Decision ${decisionId} was not found`);
    const graphEntity = current.graph.version === 2
      ? current.graph.entities.find((candidate) => candidate.id === decisionId)
      : undefined;
    if (graphEntity && graphEntity.type !== 'decision') {
      throw new DecisionAdapterError('store_corrupt', `Canonical Graph ID ${decisionId} is not a Decision`);
    }
    await this.authorize({ action: 'read', context, current, decision, graph_entity: graphEntity });
    const sidecar = parseSidecar(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    const stored = sidecar.decisions[decisionId];
    if (!stored) {
      return {
        decision: clone(decision),
        ...(graphEntity ? { graph_entity: clone(graphEntity) } : {}),
        condition_status: 'unrecorded',
        authority_status: 'unrecorded',
        ai_logs: []
      };
    }
    validateStoredDecision(stored, decisionId);
    await this.validateConditions(stored.conditions, context);
    return {
      decision: clone(decision),
      ...(graphEntity ? { graph_entity: clone(graphEntity) } : {}),
      condition_status: 'recorded',
      conditions: clone(stored.conditions),
      authority_status: 'unrecorded',
      ai_logs: stored.ai_logs.map(clone)
    };
  }

  private async mutateSidecar<T>(
    mutator: Parameters<typeof mutatePersonalOsWithSidecar<T>>[2]
  ): Promise<T> {
    try {
      return await mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, mutator);
    } catch (error) {
      if (error instanceof DecisionAdapterError) throw error;
      throw new DecisionAdapterError('store_corrupt', formatError(error));
    }
  }

  private async loadCurrent(): Promise<PersonalOs> {
    try {
      return await loadPersonalOs(this.dataDir);
    } catch (error) {
      throw new DecisionAdapterError('store_corrupt', formatError(error));
    }
  }

  private async validateConditions(
    conditions: DecisionAdapterConditions,
    context: DecisionAdapterContext,
  ): Promise<void> {
    validateDecisionAdapterConditions(conditions);
    if (!this.conditionValidator) return;
    try {
      const allowed = await this.conditionValidator.validate({ conditions: clone(conditions), context });
      if (allowed === false) {
        throw new DecisionAdapterError('condition_unavailable', 'A trusted condition provider denied the references');
      }
    } catch (error) {
      if (error instanceof DecisionAdapterError) throw error;
      throw new DecisionAdapterError('condition_unavailable', formatError(error));
    }
  }

  private async authorize(request: DecisionAdapterAuthorizationRequest): Promise<void> {
    assertContext(request.context);
    if (this.authorization) {
      try {
        const allowed = await this.authorization.authorize({
          ...request,
          current: clone(request.current),
          ...(request.decision ? { decision: clone(request.decision) } : {}),
          ...(request.graph_entity ? { graph_entity: clone(request.graph_entity) } : {})
        });
        if (allowed === false) {
          throw new DecisionAdapterError('authorization_denied', 'Decision adapter policy denied the operation');
        }
      } catch (error) {
        if (error instanceof DecisionAdapterError) throw error;
        throw new DecisionAdapterError('authorization_denied', formatError(error));
      }
      return;
    }
    const ownerId = request.current.graph.version === 2 ? request.current.graph.owner?.id : undefined;
    if (ownerId && ownerId !== request.context.principal) {
      throw new DecisionAdapterError('authorization_denied', 'The personal canonical Graph owner denied the operation');
    }
  }

  private async assertReadback(
    decisionId: string,
    context: DecisionAdapterContext,
    expectedConditions: DecisionAdapterConditions,
  ): Promise<void> {
    let read: DecisionAdapterReadResult;
    try {
      read = await this.readDecision({ decision_id: decisionId }, context);
    } catch (error) {
      if (error instanceof DecisionAdapterError) throw error;
      throw new DecisionAdapterError('readback_mismatch', formatError(error));
    }
    if (read.condition_status !== 'recorded'
      || read.conditions === undefined
      || !sameConditions(read.conditions, expectedConditions)
      || !read.graph_entity
      || read.graph_entity.id !== decisionId
      || read.graph_entity.type !== 'decision') {
      throw new DecisionAdapterError('readback_mismatch', `Decision ${decisionId} did not read back with its canonical references`);
    }
  }
}

export function createDecisionAdapter(options: DecisionAdapterStoreOptions): DecisionAdapterPort {
  return new GraphDecisionAdapterStore(options);
}

export const createGraphDecisionAdapter = createDecisionAdapter;

export function validateDecisionAdapterConditions(value: DecisionAdapterConditions): void {
  if (!value || typeof value !== 'object') {
    throw new DecisionAdapterError('validation_error', 'conditions are required');
  }
  const conditions = value as unknown as Record<string, unknown>;
  const snapshot = conditions.problem_snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new DecisionAdapterError('validation_error', 'conditions.problem_snapshot is required');
  }
  const snapshotRecord = snapshot as Record<string, unknown>;
  const snapshotId = normalizeIdentifier(snapshotRecord.snapshot_id, 'conditions.problem_snapshot.snapshot_id');
  if (!/^sha256:[0-9a-f]{64}$/u.test(snapshotId)) {
    throw new DecisionAdapterError('validation_error', 'conditions.problem_snapshot.snapshot_id must be sha256:<64 lowercase hex>');
  }
  normalizeIdentifier(snapshotRecord.problem_id, 'conditions.problem_snapshot.problem_id');
  assertRevision(snapshotRecord.revision, 'conditions.problem_snapshot.revision');

  const method = conditions.method;
  if (!method || typeof method !== 'object') {
    throw new DecisionAdapterError('validation_error', 'conditions.method is required');
  }
  const methodRecord = method as Record<string, unknown>;
  normalizeIdentifier(methodRecord.id, 'conditions.method.id');
  normalizeIdentifier(methodRecord.version, 'conditions.method.version');

  if (!Array.isArray(conditions.objective_refs) || conditions.objective_refs.length === 0) {
    throw new DecisionAdapterError('validation_error', 'conditions.objective_refs must contain at least one Objective revision');
  }
  const seen = new Set<string>();
  for (const [index, ref] of conditions.objective_refs.entries()) {
    if (!ref || typeof ref !== 'object') {
      throw new DecisionAdapterError('validation_error', `conditions.objective_refs[${index}] must be an object`);
    }
    const record = ref as Record<string, unknown>;
    const id = normalizeIdentifier(record.id, `conditions.objective_refs[${index}].id`);
    if (record.type !== 'objective') {
      throw new DecisionAdapterError('validation_error', `conditions.objective_refs[${index}].type must be objective`);
    }
    const revision = assertRevision(record.revision, `conditions.objective_refs[${index}].revision`);
    const key = `${id}@${revision}`;
    if (seen.has(key)) throw new DecisionAdapterError('validation_error', `Duplicate Objective reference ${key}`);
    seen.add(key);
  }
}

function normalizeDecisionRequest(input: DecisionAdapterDecisionRequest): DecisionAdapterDecisionRequest {
  if (!input || typeof input !== 'object') throw new DecisionAdapterError('validation_error', 'Decision request is required');
  const request = input as unknown as Record<string, unknown>;
  return {
    ...(request.decision_id === undefined ? {} : { decision_id: normalizeIdentifier(request.decision_id, 'decision_id') }),
    title: normalizeText(request.title, 'title'),
    decision: normalizeText(request.decision, 'decision'),
    ...(request.topic === undefined ? {} : { topic: normalizeText(request.topic, 'topic') }),
    ...(request.rationale === undefined ? {} : { rationale: normalizeText(request.rationale, 'rationale', 8_192) }),
    ...(request.effectiveAt === undefined ? {} : { effectiveAt: normalizeTimestamp(request.effectiveAt, 'effectiveAt') }),
    ...(request.tags === undefined ? {} : { tags: normalizeStringArray(request.tags, 'tags') }),
    conditions: normalizeConditions(request.conditions)
  };
}

function normalizeAiDecisionLogRequest(input: DecisionAdapterAiDecisionLogRequest): DecisionAdapterAiDecisionLogRequest & { decision_id: string } {
  if (!input || typeof input !== 'object') throw new DecisionAdapterError('validation_error', 'AI decision-log request is required');
  const request = input as unknown as Record<string, unknown>;
  const decisionId = request.decision_id === undefined
    ? request.related_decision_id
    : request.related_decision_id === undefined
      ? request.decision_id
      : normalizeIdentifier(request.decision_id, 'decision_id') === normalizeIdentifier(request.related_decision_id, 'related_decision_id')
        ? request.decision_id
        : undefined;
  if (decisionId === undefined) throw new DecisionAdapterError('validation_error', 'decision_id or related_decision_id is required and must match');
  return {
    decision_id: normalizeIdentifier(decisionId, 'decision_id'),
    summary: normalizeText(request.summary, 'summary'),
    ...(request.decision_type === undefined ? {} : { decision_type: normalizeText(request.decision_type, 'decision_type') }),
    ...(request.rationale === undefined ? {} : { rationale: normalizeText(request.rationale, 'rationale', 8_192) }),
    ...(request.confidence === undefined ? {} : { confidence: normalizeConfidence(request.confidence) }),
    ...(request.related_entity_id === undefined ? {} : { related_entity_id: normalizeIdentifier(request.related_entity_id, 'related_entity_id') }),
    ...(request.references === undefined ? {} : { references: normalizeStringArray(request.references, 'references') }),
    conditions: normalizeConditions(request.conditions)
  };
}

function normalizeConditions(value: unknown): DecisionAdapterConditions {
  if (!value || typeof value !== 'object') throw new DecisionAdapterError('validation_error', 'conditions are required');
  const input = value as Record<string, unknown>;
  const snapshot = input.problem_snapshot as Record<string, unknown> | undefined;
  const method = input.method as Record<string, unknown> | undefined;
  const objectives = input.objective_refs;
  const normalized = {
    problem_snapshot: {
      snapshot_id: String(snapshot?.snapshot_id ?? ''),
      problem_id: String(snapshot?.problem_id ?? ''),
      revision: String(snapshot?.revision ?? '')
    } as JudgmentDAGProblemSnapshotReference,
    method: {
      id: String(method?.id ?? ''),
      version: String(method?.version ?? '')
    } as JudgmentDAGVersionReference,
    objective_refs: Array.isArray(objectives)
      ? objectives.map((ref) => {
        const record = ref as Record<string, unknown>;
        return {
          id: String(record?.id ?? ''),
          type: 'objective' as const,
          revision: String(record?.revision ?? '')
        };
      })
      : []
  } satisfies DecisionAdapterConditions;
  validateDecisionAdapterConditions(normalized);
  return normalized;
}

function normalizeText(value: unknown, field: string, max = 2_048): string {
  if (typeof value !== 'string') throw new DecisionAdapterError('validation_error', `${field} is required`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new DecisionAdapterError('validation_error', `${field} must be bounded text`);
  }
  return normalized;
}

function normalizeIdentifier(value: unknown, field: string): string {
  return normalizeText(value, field, 512);
}

function assertRevision(value: unknown, field: string): string {
  const revision = normalizeIdentifier(value, field);
  if (!/^[1-9][0-9]*$/u.test(revision)) {
    throw new DecisionAdapterError('validation_error', `${field} must be a positive decimal revision`);
  }
  return revision;
}

function normalizeTimestamp(value: unknown, field: string): string {
  const timestamp = normalizeText(value, field, 64);
  if (!Number.isFinite(Date.parse(timestamp))) throw new DecisionAdapterError('validation_error', `${field} must be an ISO timestamp`);
  return timestamp;
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new DecisionAdapterError('validation_error', `${field} must be an array`);
  return value.map((entry, index) => normalizeText(entry, `${field}[${index}]`, 512));
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DecisionAdapterError('validation_error', 'confidence must be a number between 0 and 1');
  }
  return value;
}

function assertContext(context: DecisionAdapterContext): void {
  normalizeIdentifier(context?.principal, 'context.principal');
}

function assertSidecarPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new DecisionAdapterError('validation_error', 'sidecarPath must remain relative to the SSOT root');
  }
}

function parseSidecar(content: string | undefined): DecisionAdapterSidecar {
  if (content === undefined || content.trim() === '') return { version: DECISION_ADAPTER_VERSION, decisions: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new DecisionAdapterError('store_corrupt', `Decision adapter sidecar is not valid JSON: ${formatError(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DecisionAdapterError('store_corrupt', 'Decision adapter sidecar must be an object');
  }
  const value = parsed as Record<string, unknown>;
  if (value.version !== DECISION_ADAPTER_VERSION || !value.decisions || typeof value.decisions !== 'object' || Array.isArray(value.decisions)) {
    throw new DecisionAdapterError('store_corrupt', 'Decision adapter sidecar has an unsupported schema');
  }
  const decisions: Record<string, StoredDecisionRecord> = {};
  for (const [key, candidate] of Object.entries(value.decisions as Record<string, unknown>)) {
    validateStoredDecision(candidate as StoredDecisionRecord, key);
    decisions[key] = clone(candidate as StoredDecisionRecord);
  }
  return { version: DECISION_ADAPTER_VERSION, decisions };
}

function validateStoredDecision(value: StoredDecisionRecord, key: string): void {
  if (!value || typeof value !== 'object' || value.decision_id !== key) {
    throw new DecisionAdapterError('store_corrupt', `Decision adapter sidecar entry ${key} has an invalid ID`);
  }
  validateDecisionAdapterConditions(value.conditions);
  normalizeTimestamp(value.created_at, `decisions.${key}.created_at`);
  if (!Array.isArray(value.ai_logs)) throw new DecisionAdapterError('store_corrupt', `Decision adapter sidecar entry ${key} has invalid ai_logs`);
  const ids = new Set<string>();
  for (const log of value.ai_logs) {
    if (!log || typeof log !== 'object') throw new DecisionAdapterError('store_corrupt', `Decision adapter sidecar entry ${key} has an invalid AI log`);
    normalizeIdentifier(log.ai_decision_id, 'ai_decision_id');
    normalizeIdentifier(log.event_id, 'event_id');
    normalizeText(log.summary, 'summary');
    if (log.decision_type !== undefined) normalizeText(log.decision_type, 'decision_type');
    if (log.rationale !== undefined) normalizeText(log.rationale, 'rationale', 8_192);
    if (log.confidence !== undefined) normalizeConfidence(log.confidence);
    if (log.related_entity_id !== undefined) normalizeIdentifier(log.related_entity_id, 'related_entity_id');
    if (log.references !== undefined) normalizeStringArray(log.references, 'references');
    validateDecisionAdapterConditions(log.conditions);
    if (!sameConditions(log.conditions, value.conditions)) {
      throw new DecisionAdapterError('store_corrupt', `AI log ${log.ai_decision_id} has conditions different from ${key}`);
    }
    normalizeTimestamp(log.created_at, 'created_at');
    if (ids.has(log.ai_decision_id)) throw new DecisionAdapterError('store_corrupt', `Duplicate AI log ${log.ai_decision_id}`);
    ids.add(log.ai_decision_id);
  }
}

function serializeSidecar(sidecar: DecisionAdapterSidecar): string {
  return `${JSON.stringify({
    version: DECISION_ADAPTER_VERSION,
    decisions: Object.fromEntries(Object.entries(sidecar.decisions).sort(([left], [right]) => left.localeCompare(right, 'en')))
  }, null, 2)}\n`;
}

function sameConditions(left: DecisionAdapterConditions, right: DecisionAdapterConditions): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined)) as T;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
