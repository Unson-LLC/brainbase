import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { planApply, type ApplyCandidate } from './import-extract.js';
import { applyCanonicalWrites } from './canonical-edge-builder.js';
import { initializePersonalOs, loadPersonalOs, mutatePersonalOsWithSidecar } from './ssot.js';

const LEDGER_SCHEMA_VERSION = 'connected_onboarding.v1';
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_ITEMS = 50;
const MAX_PERMISSION_BYTES = 8192;
const SECRET_KEY = /(?:^|_)(?:tokens?|access_?tokens?|refresh_?tokens?|id_?tokens?|oauth_?tokens?|api_?keys?|private_?keys?|client_?secrets?|secrets?|passwords?|credentials?|authorization|cookies?)(?:$|_)/i;
const RAW_CONTENT_KEY = /^(?:raw(?:_body|_content|_text)?|body|content|document|message_?body|answer)$/i;
const SECRET_VALUE = /(?:^|\s)Bearer\s+[A-Za-z0-9._~+/-]+=*|\bsk-[A-Za-z0-9_-]{16,}\b/i;
const SECRET_ASSIGNMENT = /(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|secret|password|credential|authorization|cookie)\s*(?:=|:)\s*[^\s&#;,]+/i;
const URI_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*:[^@/?#\s]+@/i;
const PERMISSION_KEYS = new Set([
  'visibility', 'collectedBy', 'provider', 'connectionId', 'grantId', 'accountId',
  'folderId', 'projectCode', 'roleMin', 'sensitivity', 'scope', 'scopes', 'roles',
  'clearance', 'authorizedAt', 'expiresAt'
]);
const WORKFLOW_STATES = [
  'initialized',
  'source_ready',
  'candidates_ready',
  'promotion_reviewed',
  'first_value_ready',
  'first_value_answer_reviewed'
] as const;

export type SourceMode = 'mcp' | 'drive' | 'gmail' | 'local_folder' | 'single_document';
export type SourceStatus = 'ready' | 'waiting_for_authorization' | 'unavailable' | 'error' | 'unconfirmed';
export type ObservationClass = 'observed' | 'inferred';
export type ReviewDecision = 'approve' | 'edit' | 'reject' | 'merge';
export type WorkflowState = typeof WORKFLOW_STATES[number];

export interface SourceInventoryInput {
  id: string;
  mode: SourceMode;
  status: SourceStatus;
  evidencePointer?: string;
  permissionScope?: string[];
  detail?: string;
}

export interface SourceInventory extends SourceInventoryInput {
  id: string;
  permissionScope: string[];
}

export interface SourceReceiptInput {
  sourceId: string;
  evidencePointer: string;
  contentHash: string;
  permissionSnapshot: Record<string, unknown>;
  collectionStatus: 'collected';
}

export interface CandidateInput {
  kind: string;
  payload: Record<string, unknown>;
  observationClass: ObservationClass;
  evidenceId: string;
}

export interface ConnectedCandidate extends CandidateInput {
  id: string;
  ingestedPayloadHash: string;
  sourceId: string;
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'merged';
  reviewDecision?: ReviewDecision;
  reviewReason?: string;
  mergedIntoCandidateId?: string;
  promotedCanonicalIds: string[];
}

export interface SourceReceipt extends SourceReceiptInput {
  mode: SourceMode;
  collectedAt: string;
  candidateIds: string[];
}

export interface FirstValueReceipt {
  answerHash: string;
  usedCanonicalIds: string[];
  missingContext: string[];
  recordedAt: string;
}

export interface FirstValueReview {
  verdict: 'useful' | 'not_useful';
  missingContext: string[];
  reviewedAt: string;
  elapsedSeconds: number;
  withinTargetSeconds: boolean;
}

export interface ConnectedOnboardingRun {
  id: string;
  valueTarget: string;
  path: 'warm' | 'fallback' | 'blocked';
  state: WorkflowState;
  startedAt: string;
  updatedAt: string;
  sourceReadyAt?: string;
  sources: SourceInventory[];
  selectedSourceIds: string[];
  receipts: SourceReceipt[];
  candidates: ConnectedCandidate[];
  promotedCanonicalIds: string[];
  firstValueReceipt?: FirstValueReceipt;
  firstValueReview?: FirstValueReview;
}

interface Ledger {
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  runs: ConnectedOnboardingRun[];
}

export interface ConnectedOnboardingOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export interface ReviewAction {
  candidateId: string;
  decision: ReviewDecision;
  reason: string;
  payload?: Record<string, unknown>;
  mergeIntoCandidateId?: string;
}

export type FirstValueInput =
  | { action: 'record'; answerHash: string; usedCanonicalIds: string[]; missingContext?: string[] }
  | { action: 'review'; verdict: 'useful' | 'not_useful'; missingContext?: string[] };

export class ConnectedOnboardingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ConnectedOnboardingError';
  }
}

export class ConnectedOnboardingRuntime {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly dataDir: string, options: ConnectedOnboardingOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `onb_${randomUUID()}`);
  }

  async start(input: { valueTarget: string; sources: SourceInventoryInput[] }): Promise<ConnectedOnboardingRun> {
    assertSafePersistentValue(input);
    const valueTarget = requireString(input.valueTarget, 'valueTarget', 500);
    const sources = normalizeSourceInventory(input.sources);
    await initializePersonalOs(this.dataDir);
    const readyPrimary = sources.filter((source) => source.status === 'ready' && source.mode !== 'single_document');
    const readyFallback = sources.filter((source) => source.status === 'ready' && source.mode === 'single_document');
    const path = readyPrimary.length > 0 ? 'warm' : readyFallback.length > 0 ? 'fallback' : 'blocked';
    const selectedSourceIds = path === 'warm'
      ? [readyPrimary[0].id]
      : path === 'fallback' ? [readyFallback[0].id] : [];
    const timestamp = this.timestamp();
    const run: ConnectedOnboardingRun = {
      id: this.idFactory(),
      valueTarget,
      path,
      state: path === 'blocked' ? 'initialized' : 'source_ready',
      startedAt: timestamp,
      updatedAt: timestamp,
      sourceReadyAt: path === 'blocked' ? undefined : timestamp,
      sources,
      selectedSourceIds,
      receipts: [],
      candidates: [],
      promotedCanonicalIds: []
    };
    return this.mutateLedger((ledger) => {
      if (ledger.runs.some((item) => item.id === run.id)) {
        throw new ConnectedOnboardingError('run_conflict', `onboarding run already exists: ${run.id}`);
      }
      ledger.runs.push(run);
      return clone(run);
    });
  }

  async get(runId: string): Promise<ConnectedOnboardingRun> {
    await initializePersonalOs(this.dataDir);
    return withLedgerLock(this.dataDir, async () => {
      const ledger = await loadLedger(this.dataDir);
      const os = await loadPersonalOs(this.dataDir);
      assertLedgerCanonicalReferences(ledger, os);
      const run = requireRun(ledger, runId);
      return clone(run);
    });
  }

  async ingest(runId: string, input: { source: SourceReceiptInput; candidates: CandidateInput[] }): Promise<ConnectedOnboardingRun> {
    assertSafePersistentValue(input);
    return this.mutateLedger((ledger) => {
      const run = requireRun(ledger, runId);
      if (run.path === 'blocked') {
        throw new ConnectedOnboardingError('source_not_ready', 'onboarding run is not ready because no source is available');
      }
      const sourceId = requireString(input.source?.sourceId, 'source.sourceId', 1000);
      const source = run.sources.find((item) => item.id === sourceId);
      if (!source || source.status !== 'ready' || !run.selectedSourceIds.includes(sourceId)) {
        throw new ConnectedOnboardingError('source_not_ready', `source '${sourceId}' is not ready or selected`);
      }
      const receipt = normalizeReceipt(source, input.source, this.timestamp());
      const existingReceipt = run.receipts.find((item) => item.sourceId === sourceId);
      if (existingReceipt && receiptIdentity(existingReceipt) !== receiptIdentity(receipt)) {
        throw new ConnectedOnboardingError('source_receipt_conflict', 'source identity cannot be changed after ingestion');
      }
      const candidates = normalizeCandidates(run.id, sourceId, input.candidates);
      const existingById = new Map(run.candidates.map((candidate) => [candidate.id, candidate]));
      const existingByEvidence = new Map(run.candidates.map((candidate) => [`${candidate.sourceId}\0${candidate.evidenceId}`, candidate]));
      for (const candidate of candidates) {
        const existing = existingByEvidence.get(`${candidate.sourceId}\0${candidate.evidenceId}`);
        if (existing && candidateIdentity(existing) !== candidateIdentity(candidate)) {
          throw new ConnectedOnboardingError('candidate_retry_conflict', 'candidate evidence identity already has a different payload');
        }
      }

      if (!existingReceipt) run.receipts.push(receipt);
      for (const candidate of candidates) {
        if (!existingById.has(candidate.id)) run.candidates.push(candidate);
      }
      const storedReceipt = run.receipts.find((item) => item.sourceId === sourceId)!;
      storedReceipt.candidateIds = unique([...storedReceipt.candidateIds, ...candidates.map((candidate) => candidate.id)]);
      run.state = advanceState(run.state, run.candidates.length > 0 ? 'candidates_ready' : 'source_ready');
      run.updatedAt = this.timestamp();
      return clone(run);
    });
  }

  async review(runId: string, actions: ReviewAction[]): Promise<ConnectedOnboardingRun> {
    assertSafePersistentValue(actions);
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_ITEMS) {
      throw new ConnectedOnboardingError('input_invalid', `review actions must contain 1..${MAX_ITEMS} items`);
    }
    await initializePersonalOs(this.dataDir);
    return withLedgerLock(this.dataDir, async () => {
      const ledger = await loadLedger(this.dataDir);
      return mutatePersonalOsWithSidecar(this.dataDir, 'runs/connected-onboarding.json', (os) => {
        if (os.graph.version !== 2) {
          throw new ConnectedOnboardingError(
            'migration_required',
            'Graph v1 cannot store canonical ID edges; migrate graph.json to Graph v2 before writing'
          );
        }
        assertLedgerCanonicalReferences(ledger, os);
        const run = requireRun(ledger, runId);
        const prepared = prepareReview(run, actions);
        if (prepared.promotions.length === 0 && prepared.updates.length === 0) {
          return { next: os, sidecarContent: serializeLedger(ledger), result: clone(run) };
        }
        const result = planApply(prepared.promotions, { ids: new Set(), all: true }, {
          graphEntities: [...os.graph.entities],
          graphEdges: [...os.graph.edges],
          relationships: [...os.relationships.relationships],
          personalKg: os.personalKg,
          decisions: os.decisions,
          ownerName: os.graph.owner?.name,
          provenanceSourceKind: 'onboarding'
        }, this.timestamp());
        if (result.skipped.length > 0 || result.applied.length !== prepared.promotions.length) {
          throw new ConnectedOnboardingError('candidate_not_promotable', result.skipped[0]?.reason ?? 'candidate was not promoted');
        }
        const applied = result.applied;
        for (const item of applied) {
          const candidate = run.candidates.find((entry) => entry.id === item.id)!;
          candidate.promotedCanonicalIds = unique([...candidate.promotedCanonicalIds, ...item.canonicalIds]);
        }
        for (const update of prepared.updates) {
          const candidate = run.candidates.find((item) => item.id === update.candidateId)!;
          Object.assign(candidate, update.patch);
        }
        run.promotedCanonicalIds = unique(run.candidates.flatMap((candidate) => candidate.promotedCanonicalIds));
        run.state = advanceState(run.state, 'promotion_reviewed');
        run.updatedAt = this.timestamp();
        const sidecarContent = serializeLedger(ledger);
        const graph = applyCanonicalWrites(os.graph, result.canonicalWrites);
        return {
          next: {
            ...os,
            graph: {
              ...graph,
              owner: result.ownerName ? { ...graph.owner, name: result.ownerName } : graph.owner
            },
            relationships: { version: 1, relationships: result.relationships },
            personalKg: mergeById(os.personalKg, result.personalKgAdditions),
            decisions: mergeById(os.decisions, result.decisionAdditions)
          },
          sidecarContent,
          result: clone(run)
        };
      });
    });
  }

  async firstValue(runId: string, input: FirstValueInput): Promise<ConnectedOnboardingRun> {
    assertSafePersistentValue(input);
    return this.mutateLedger(async (ledger) => {
      const run = requireRun(ledger, runId);
      assertCanonicalReferences(run, await loadPersonalOs(this.dataDir));
      if (input.action === 'record') {
        if (!SHA256.test(input.answerHash)) {
          throw new ConnectedOnboardingError('input_invalid', 'answerHash must be sha256:<hex>');
        }
        const usedIds = unique(boundedStrings(input.usedCanonicalIds, 'usedCanonicalIds', 200));
        if (usedIds.length === 0) throw new ConnectedOnboardingError('input_invalid', 'usedCanonicalIds must not be empty');
        if (usedIds.some((id) => !run.promotedCanonicalIds.includes(id))) {
          throw new ConnectedOnboardingError('unpromoted_reference', 'first value references an id not promoted by this run');
        }
        const nextReceipt: FirstValueReceipt = {
          answerHash: input.answerHash,
          usedCanonicalIds: usedIds,
          missingContext: boundedStrings(input.missingContext ?? [], 'missingContext', 200),
          recordedAt: this.timestamp()
        };
        if (run.firstValueReceipt) {
          const sameReceipt = run.firstValueReceipt.answerHash === nextReceipt.answerHash
            && stableJson(run.firstValueReceipt.usedCanonicalIds) === stableJson(nextReceipt.usedCanonicalIds)
            && stableJson(run.firstValueReceipt.missingContext) === stableJson(nextReceipt.missingContext);
          if (sameReceipt) return clone(run);
          throw new ConnectedOnboardingError('first_value_terminal', 'first value receipt is already recorded');
        }
        run.firstValueReceipt = nextReceipt;
        run.state = advanceState(run.state, 'first_value_ready');
      } else {
        if (!run.firstValueReceipt || !run.sourceReadyAt) {
          throw new ConnectedOnboardingError('first_value_not_ready', 'first value must be recorded before review');
        }
        const missingContext = boundedStrings(input.missingContext ?? [], 'missingContext', 200);
        if (run.firstValueReview) {
          const sameReview = run.firstValueReview.verdict === input.verdict
            && stableJson(run.firstValueReview.missingContext) === stableJson(missingContext);
          if (sameReview) return clone(run);
          throw new ConnectedOnboardingError('first_value_terminal', 'first value review is already completed');
        }
        const reviewedAt = this.timestamp();
        const elapsedSeconds = Math.max(0, Math.floor((Date.parse(reviewedAt) - Date.parse(run.sourceReadyAt)) / 1000));
        run.firstValueReview = {
          verdict: input.verdict,
          missingContext,
          reviewedAt,
          elapsedSeconds,
          withinTargetSeconds: elapsedSeconds <= 600
        };
        run.state = 'first_value_answer_reviewed';
      }
      run.updatedAt = this.timestamp();
      return clone(run);
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async readLedger(): Promise<Ledger> {
    await initializePersonalOs(this.dataDir);
    return withLedgerLock(this.dataDir, () => loadLedger(this.dataDir));
  }

  private async mutateLedger<T>(mutator: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    await initializePersonalOs(this.dataDir);
    return withLedgerLock(this.dataDir, async () => {
      const ledger = await loadLedger(this.dataDir);
      const os = await loadPersonalOs(this.dataDir);
      assertLedgerCanonicalReferences(ledger, os);
      const result = await mutator(ledger);
      await persistLedger(this.dataDir, ledger);
      return result;
    });
  }
}

export function normalizeSourceInventory(raw: SourceInventoryInput[]): SourceInventory[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) {
    throw new ConnectedOnboardingError('input_invalid', `sources must contain 1..${MAX_ITEMS} items`);
  }
  const seen = new Set<string>();
  return raw.map((source, index) => {
    const id = requireString(source?.id, `sources.${index}.id`, 500);
    if (seen.has(id)) throw new ConnectedOnboardingError('input_invalid', `duplicate source id: ${id}`);
    seen.add(id);
    if (!['mcp', 'drive', 'gmail', 'local_folder', 'single_document'].includes(source.mode)) {
      throw new ConnectedOnboardingError('input_invalid', `unsupported source mode: ${source.mode}`);
    }
    if (!['ready', 'waiting_for_authorization', 'unavailable', 'error', 'unconfirmed'].includes(source.status)) {
      throw new ConnectedOnboardingError('input_invalid', `unsupported source status: ${source.status}`);
    }
    return {
      id,
      mode: source.mode,
      status: source.status,
      evidencePointer: optionalString(source.evidencePointer, `sources.${index}.evidencePointer`, 1000),
      permissionScope: unique(boundedStrings(source.permissionScope ?? [], `sources.${index}.permissionScope`, 500)),
      detail: optionalString(source.detail, `sources.${index}.detail`, 500)
    };
  });
}

export function assertSafePersistentValue(value: unknown, trail: string[] = []): void {
  if (typeof value === 'string') {
    let candidate = value.trim();
    for (let pass = 0; pass < 8; pass += 1) {
      if (SECRET_VALUE.test(candidate) || SECRET_ASSIGNMENT.test(candidate) || URI_USERINFO.test(candidate)) {
        throw new ConnectedOnboardingError('secret_or_raw_content_rejected', `secret-like value rejected at ${trail.join('.') || 'input'}`);
      }
      const decoded = candidate.replaceAll('+', ' ').replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16))).trim();
      if (decoded === candidate) return;
      candidate = decoded;
    }
    throw new ConnectedOnboardingError('secret_or_raw_content_rejected', `over-encoded value rejected at ${trail.join('.') || 'input'}`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) throw new ConnectedOnboardingError('input_invalid', `${trail.join('.')} exceeds ${MAX_ITEMS} items`);
    value.forEach((item, index) => assertSafePersistentValue(item, [...trail, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key) || RAW_CONTENT_KEY.test(key)) {
      throw new ConnectedOnboardingError('secret_or_raw_content_rejected', `forbidden field rejected at ${[...trail, key].join('.')}`);
    }
    assertSafePersistentValue(child, [...trail, key]);
  }
}

function isSecretKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .toLowerCase();
  return SECRET_KEY.test(normalized);
}

function normalizeReceipt(source: SourceInventory, input: SourceReceiptInput, collectedAt: string): SourceReceipt {
  if (input.collectionStatus !== 'collected') throw new ConnectedOnboardingError('source_unavailable', 'source was not collected');
  const evidencePointer = requireString(input.evidencePointer, 'source.evidencePointer', 1000);
  if (source.evidencePointer && source.evidencePointer !== evidencePointer) {
    throw new ConnectedOnboardingError('source_receipt_conflict', 'receipt pointer differs from inventory pointer');
  }
  if (!SHA256.test(input.contentHash)) throw new ConnectedOnboardingError('input_invalid', 'contentHash must be sha256:<hex>');
  const permissionSnapshot = validatePermissionSnapshot(input.permissionSnapshot, source.permissionScope);
  return {
    sourceId: source.id,
    mode: source.mode,
    evidencePointer,
    contentHash: input.contentHash,
    permissionSnapshot,
    collectionStatus: 'collected',
    collectedAt,
    candidateIds: []
  };
}

function validatePermissionSnapshot(value: Record<string, unknown>, allowedScope: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectedOnboardingError('permission_snapshot_invalid', 'permissionSnapshot must be an object');
  }
  assertSafePersistentValue(value, ['permissionSnapshot']);
  const forbidden = Object.keys(value).find((key) => !PERMISSION_KEYS.has(key));
  if (forbidden) throw new ConnectedOnboardingError('permission_snapshot_invalid', `permissionSnapshot field is not allowed: ${forbidden}`);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PERMISSION_BYTES) {
    throw new ConnectedOnboardingError('permission_snapshot_invalid', 'permissionSnapshot is too large');
  }
  for (const [key, child] of Object.entries(value)) {
    const scalar = child === null || ['string', 'number', 'boolean'].includes(typeof child);
    const array = Array.isArray(child) && child.length <= MAX_ITEMS && child.every((item) => typeof item === 'string' && item.length <= 500);
    if (!scalar && !array) throw new ConnectedOnboardingError('permission_snapshot_invalid', `permissionSnapshot.${key} must be scalar or bounded strings`);
  }
  const authorityKeys = ['grantId', 'accountId', 'folderId', 'projectCode', 'roleMin', 'scope', 'scopes', 'roles', 'clearance'];
  for (const key of authorityKeys) {
    const child = value[key];
    if (child !== undefined && child !== null
      && typeof child !== 'string'
      && !(Array.isArray(child) && child.every((item) => typeof item === 'string'))) {
      throw new ConnectedOnboardingError('permission_snapshot_invalid', `permissionSnapshot.${key} must be a string or bounded strings`);
    }
  }
  const authorities = authorityKeys.flatMap((key) => {
    const child = value[key];
    return (Array.isArray(child) ? child : child === undefined || child === null ? [] : [child])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => ({ key, item }));
  });
  if (authorities.some(({ key, item }) => !allowedScope.includes(item) && !allowedScope.includes(`${key}:${item}`))) {
    throw new ConnectedOnboardingError('permission_scope_denied', 'permissionSnapshot exceeds the selected source scope');
  }
  return clone(value);
}

function normalizeCandidates(runId: string, sourceId: string, raw: CandidateInput[]): ConnectedCandidate[] {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) throw new ConnectedOnboardingError('input_invalid', `candidates must contain at most ${MAX_ITEMS} items`);
  const candidates = raw.map((candidate, index) => {
    const evidenceId = requireString(candidate.evidenceId, `candidates.${index}.evidenceId`, 1000);
    if (!['observed', 'inferred'].includes(candidate.observationClass)) throw new ConnectedOnboardingError('input_invalid', 'unsupported observationClass');
    if (!candidate.payload || typeof candidate.payload !== 'object' || Array.isArray(candidate.payload)) throw new ConnectedOnboardingError('input_invalid', 'candidate payload must be an object');
    const ingestedPayloadHash = sha256(stableJson(candidate.payload));
    const normalized: ConnectedCandidate = {
      id: stableId('onb_cand', runId, sourceId, evidenceId, candidate.kind, ingestedPayloadHash),
      ingestedPayloadHash,
      sourceId,
      kind: requireString(candidate.kind, `candidates.${index}.kind`, 100),
      payload: clone(candidate.payload),
      observationClass: candidate.observationClass,
      evidenceId,
      reviewStatus: 'pending',
      promotedCanonicalIds: []
    };
    assertPromotable(normalized);
    return normalized;
  });
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new ConnectedOnboardingError('input_invalid', 'candidate evidenceId values must be unique within a source batch');
  }
  return candidates;
}

function prepareReview(run: ConnectedOnboardingRun, actions: ReviewAction[]): {
  promotions: ApplyCandidate[];
  updates: Array<{ candidateId: string; patch: Partial<ConnectedCandidate> }>;
} {
  actions.forEach(validateReviewActionShape);
  if (new Set(actions.map((action) => action.candidateId)).size !== actions.length) {
    throw new ConnectedOnboardingError('input_invalid', 'each candidate may appear only once in a review batch');
  }
  const directCandidateIds = new Set(actions.map((action) => action.candidateId));
  const mergeTargets = actions
    .filter((action) => action.decision === 'merge')
    .map((action) => action.mergeIntoCandidateId!);
  if (mergeTargets.some((targetId) => directCandidateIds.has(targetId))) {
    throw new ConnectedOnboardingError('review_batch_conflict', 'a merge target cannot also have a direct action in the same review batch');
  }
  if (new Set(mergeTargets).size !== mergeTargets.length) {
    throw new ConnectedOnboardingError('review_batch_conflict', 'a merge target may be used only once in a review batch');
  }
  const promotions = new Map<string, ApplyCandidate>();
  const updates: Array<{ candidateId: string; patch: Partial<ConnectedCandidate> }> = [];
  for (const action of actions) {
    const candidate = run.candidates.find((item) => item.id === action.candidateId);
    if (!candidate) throw new ConnectedOnboardingError('candidate_not_found', `candidate does not belong to run: ${action.candidateId}`);
    const reason = requireString(action.reason, 'review.reason', 500);
    if (candidate.reviewStatus !== 'pending') {
      if (isSameTerminalReview(candidate, action, reason)) continue;
      throw new ConnectedOnboardingError('candidate_terminal', `candidate is already ${candidate.reviewStatus}`);
    }
    if (action.decision === 'approve') {
      if (candidate.observationClass === 'inferred') {
        throw new ConnectedOnboardingError(
          'inferred_not_promotable',
          'inferred candidates cannot be approved; review the source, then use decision "edit" with a human-confirmed payload, or use "reject"'
        );
      }
      promotions.set(candidate.id, toApplyCandidate(candidate));
      updates.push({ candidateId: candidate.id, patch: { reviewStatus: 'approved', reviewDecision: 'approve', reviewReason: reason } });
    } else if (action.decision === 'edit') {
      if (!action.payload || typeof action.payload !== 'object' || Array.isArray(action.payload)) throw new ConnectedOnboardingError('input_invalid', 'edit requires payload');
      assertSafePersistentValue(action.payload, ['review', 'payload']);
      const edited = { ...candidate, payload: clone(action.payload), observationClass: 'observed' as const };
      assertPromotable(edited);
      promotions.set(candidate.id, toApplyCandidate(edited));
      updates.push({ candidateId: candidate.id, patch: { payload: clone(action.payload), observationClass: 'observed', reviewStatus: 'approved', reviewDecision: 'edit', reviewReason: reason } });
    } else if (action.decision === 'reject') {
      updates.push({ candidateId: candidate.id, patch: { reviewStatus: 'rejected', reviewDecision: 'reject', reviewReason: reason, promotedCanonicalIds: [] } });
    } else if (action.decision === 'merge') {
      if (candidate.observationClass === 'inferred') throw new ConnectedOnboardingError('inferred_not_promotable', 'inferred candidates cannot be merged');
      const targetId = requireString(action.mergeIntoCandidateId, 'mergeIntoCandidateId', 200);
      const target = run.candidates.find((item) => item.id === targetId);
      if (!target || target.id === candidate.id) throw new ConnectedOnboardingError('merge_target_invalid', 'merge target must be another candidate in this run');
      if (target.observationClass === 'inferred') throw new ConnectedOnboardingError('inferred_not_promotable', 'inferred merge target cannot be approved');
      if (target.kind !== candidate.kind) throw new ConnectedOnboardingError('merge_target_invalid', 'merge candidates must have the same kind');
      if (target.reviewStatus !== 'pending') throw new ConnectedOnboardingError('merge_target_invalid', 'merge target must still be pending');
      const merged = { ...target, payload: { ...candidate.payload, ...target.payload } };
      assertPromotable(merged);
      promotions.set(target.id, toApplyCandidate(merged));
      updates.push({ candidateId: candidate.id, patch: { reviewStatus: 'merged', reviewDecision: 'merge', reviewReason: reason, mergedIntoCandidateId: target.id, promotedCanonicalIds: [] } });
      updates.push({ candidateId: target.id, patch: { payload: merged.payload, reviewStatus: 'approved', reviewDecision: 'merge', reviewReason: reason } });
    } else {
      throw new ConnectedOnboardingError('input_invalid', `unsupported review decision: ${String(action.decision)}`);
    }
  }
  return { promotions: [...promotions.values()], updates };
}

function validateReviewActionShape(action: ReviewAction): void {
  if (!isRecord(action)) throw new ConnectedOnboardingError('input_invalid', 'review action must be an object');
  requireString(action.candidateId, 'review.candidateId', 200);
  requireString(action.reason, 'review.reason', 500);
  if (!['approve', 'edit', 'reject', 'merge'].includes(action.decision)) {
    throw new ConnectedOnboardingError('input_invalid', `unsupported review decision: ${String(action.decision)}`);
  }
  if (action.decision === 'edit') {
    if (!hasOnlyKeys(action, ['candidateId', 'decision', 'reason', 'payload'])
      || !action.payload || !isRecord(action.payload) || action.mergeIntoCandidateId !== undefined) {
      throw new ConnectedOnboardingError('input_invalid', 'edit requires payload and forbids mergeIntoCandidateId');
    }
    return;
  }
  if (action.decision === 'merge') {
    requireString(action.mergeIntoCandidateId, 'mergeIntoCandidateId', 200);
    if (!hasOnlyKeys(action, ['candidateId', 'decision', 'reason', 'mergeIntoCandidateId']) || action.payload !== undefined) {
      throw new ConnectedOnboardingError('input_invalid', 'merge forbids payload and extra fields');
    }
    return;
  }
  if (!hasOnlyKeys(action, ['candidateId', 'decision', 'reason']) || action.payload !== undefined || action.mergeIntoCandidateId !== undefined) {
    throw new ConnectedOnboardingError('input_invalid', `${action.decision} forbids payload and mergeIntoCandidateId`);
  }
}

function isSameTerminalReview(candidate: ConnectedCandidate, action: ReviewAction, reason: string): boolean {
  if (candidate.reviewDecision !== action.decision || candidate.reviewReason !== reason) return false;
  if (action.decision === 'edit') {
    return action.payload !== undefined && stableJson(candidate.payload) === stableJson(action.payload);
  }
  if (action.decision === 'merge') return candidate.mergedIntoCandidateId === action.mergeIntoCandidateId;
  return action.payload === undefined && action.mergeIntoCandidateId === undefined;
}

function assertPromotable(candidate: Pick<ConnectedCandidate, 'id' | 'kind' | 'payload'>): void {
  const validation = candidateValidationContext(candidate, true);
  const result = planApply([validation.candidate], { ids: new Set(), all: true }, validation.base, '2000-01-01T00:00:00.000Z');
  if (result.skipped.length > 0 || result.applied.length !== 1) {
    throw new ConnectedOnboardingError('candidate_not_promotable', result.skipped[0]?.reason ?? 'candidate is not promotable');
  }
}

function toApplyCandidate(candidate: Pick<ConnectedCandidate, 'id' | 'kind' | 'payload'>): ApplyCandidate {
  return { id: candidate.id, kind: candidate.kind, payload: candidate.payload };
}

function advanceState(current: WorkflowState, target: WorkflowState): WorkflowState {
  return WORKFLOW_STATES.indexOf(current) >= WORKFLOW_STATES.indexOf(target) ? current : target;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\0')).digest('hex');
  return `${prefix}_${digest.slice(0, 32)}`;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function receiptIdentity(receipt: SourceReceipt): string {
  return stableJson({
    sourceId: receipt.sourceId,
    mode: receipt.mode,
    evidencePointer: receipt.evidencePointer,
    contentHash: receipt.contentHash,
    permissionSnapshot: receipt.permissionSnapshot,
    collectionStatus: receipt.collectionStatus
  });
}

function candidateIdentity(candidate: ConnectedCandidate): string {
  return stableJson({
    id: candidate.id,
    ingestedPayloadHash: candidate.ingestedPayloadHash,
    sourceId: candidate.sourceId,
    kind: candidate.kind,
    payload: candidate.payload,
    observationClass: candidate.observationClass,
    evidenceId: candidate.evidenceId
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function requireRun(ledger: Ledger, runId: string): ConnectedOnboardingRun {
  const id = requireString(runId, 'runId', 200);
  const run = ledger.runs.find((item) => item.id === id);
  if (!run) throw new ConnectedOnboardingError('run_not_found', `onboarding run not found: ${id}`);
  return run;
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new ConnectedOnboardingError('input_invalid', `${field} must be 1..${max} characters`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  return value === undefined ? undefined : requireString(value, field, max);
}

function boundedStrings(value: unknown[], field: string, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new ConnectedOnboardingError('input_invalid', `${field} must contain at most ${MAX_ITEMS} items`);
  return value.map((item, index) => requireString(item, `${field}.${index}`, maxLength));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function mergeById<T extends { id: string }>(current: T[], additions: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of additions) byId.set(item.id, item);
  return [...byId.values()];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function ledgerPath(dataDir: string): string {
  return join(dataDir, 'runs', 'connected-onboarding.json');
}

async function loadLedger(dataDir: string): Promise<Ledger> {
  try {
    const parsed = JSON.parse(await readFile(ledgerPath(dataDir), 'utf8')) as Partial<Ledger>;
    if (parsed.schemaVersion !== LEDGER_SCHEMA_VERSION || !Array.isArray(parsed.runs)) {
      throw new ConnectedOnboardingError('ledger_schema_unsupported', `unsupported connected onboarding ledger schema: ${String(parsed.schemaVersion ?? 'missing')}`);
    }
    assertSafePersistentValue(parsed);
    validateLedgerRuns(parsed.runs);
    return parsed as Ledger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: LEDGER_SCHEMA_VERSION, runs: [] };
    throw error;
  }
}

function validateLedgerRuns(runs: unknown[]): void {
  const runIds = new Set<string>();
  for (const run of runs) {
    if (!isRecord(run)
      || !hasOnlyKeys(run, ['id', 'valueTarget', 'path', 'state', 'startedAt', 'updatedAt', 'sourceReadyAt', 'sources', 'selectedSourceIds', 'receipts', 'candidates', 'promotedCanonicalIds', 'firstValueReceipt', 'firstValueReview'])
      || !isBoundedString(run.id, 200) || runIds.has(run.id)
      || !isBoundedString(run.valueTarget, 500)
      || !['warm', 'fallback', 'blocked'].includes(String(run.path))
      || !WORKFLOW_STATES.includes(run.state as WorkflowState)
      || !isIsoTimestamp(run.startedAt) || !isIsoTimestamp(run.updatedAt)
      || (run.sourceReadyAt !== undefined && !isIsoTimestamp(run.sourceReadyAt))
      || !Array.isArray(run.sources) || run.sources.length === 0 || run.sources.length > MAX_ITEMS
      || !isBoundedStringArray(run.selectedSourceIds, 500)
      || !Array.isArray(run.receipts) || run.receipts.length > MAX_ITEMS
      || !Array.isArray(run.candidates) || run.candidates.length > MAX_ITEMS
      || !isBoundedStringArray(run.promotedCanonicalIds, 200)) throwInvalidLedger();
    runIds.add(run.id);

    const sources = run.sources as unknown[];
    if (!sources.every(isValidLedgerSource)) throwInvalidLedger();
    const sourceIds = new Set(sources.map((source) => (source as Record<string, unknown>).id as string));
    const sourceById = new Map(sources.map((source) => {
      const item = source as Record<string, unknown>;
      return [item.id as string, item] as const;
    }));
    if (sourceIds.size !== sources.length || !(run.selectedSourceIds as string[]).every((id) => sourceIds.has(id))) throwInvalidLedger();

    const candidates = run.candidates as unknown[];
    if (!candidates.every((candidate) => isValidLedgerCandidate(candidate, run.id as string, sourceIds))) throwInvalidLedger();
    const candidateIds = new Set(candidates.map((candidate) => (candidate as Record<string, unknown>).id as string));
    if (candidateIds.size !== candidates.length) throwInvalidLedger();
    if (candidates.some((candidate) => {
      const targetId = (candidate as Record<string, unknown>).mergedIntoCandidateId;
      return typeof targetId === 'string' && !candidateIds.has(targetId);
    })) throwInvalidLedger();
    const candidateById = new Map(candidates.map((candidate) => {
      const item = candidate as Record<string, unknown>;
      return [item.id as string, item] as const;
    }));
    const mergeSourcesByTarget = new Map<string, Record<string, unknown>[]>();
    for (const candidate of candidates) {
      const item = candidate as Record<string, unknown>;
      if (item.reviewStatus !== 'merged') continue;
      const targetId = item.mergedIntoCandidateId as string;
      const target = candidateById.get(targetId);
      if (!target
        || targetId === item.id
        || item.observationClass !== 'observed'
        || item.kind !== target.kind
        || target.reviewStatus !== 'approved'
        || target.reviewDecision !== 'merge'
        || target.observationClass !== 'observed'
        || target.mergedIntoCandidateId !== undefined
        || (target.promotedCanonicalIds as string[]).length === 0
        || target.reviewReason !== item.reviewReason) throwInvalidLedger();
      mergeSourcesByTarget.set(targetId, [...(mergeSourcesByTarget.get(targetId) ?? []), item]);
    }
    if (candidates.some((candidate) => {
      const item = candidate as Record<string, unknown>;
      return item.reviewStatus === 'approved'
        && item.reviewDecision === 'merge'
        && (mergeSourcesByTarget.get(item.id as string)?.length ?? 0) !== 1;
    })) throwInvalidLedger();

    const receipts = run.receipts as unknown[];
    if (!receipts.every((receipt) => isValidLedgerReceipt(receipt, sourceById, candidates))) throwInvalidLedger();
    if (new Set(receipts.map((receipt) => (receipt as Record<string, unknown>).sourceId)).size !== receipts.length) throwInvalidLedger();
    const receiptBySourceId = new Map(receipts.map((receipt) => {
      const item = receipt as Record<string, unknown>;
      return [item.sourceId as string, item] as const;
    }));
    if (candidates.some((candidate) => {
      const item = candidate as Record<string, unknown>;
      const receipt = receiptBySourceId.get(item.sourceId as string);
      return !receipt || !(receipt.candidateIds as string[]).includes(item.id as string);
    })) throwInvalidLedger();

    const promoted = new Set(run.promotedCanonicalIds as string[]);
    const candidatePromoted = new Set(candidates.flatMap((candidate) => (candidate as Record<string, unknown>).promotedCanonicalIds as string[]));
    if ([...promoted].some((id) => !candidatePromoted.has(id)) || [...candidatePromoted].some((id) => !promoted.has(id))) throwInvalidLedger();
    if (!isValidFirstValueReceipt(run.firstValueReceipt, promoted) || !isValidFirstValueReview(run.firstValueReview, run.firstValueReceipt !== undefined)) throwInvalidLedger();
  }
}

function isValidLedgerSource(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'mode', 'status', 'evidencePointer', 'permissionScope', 'detail'])
    && isBoundedString(value.id, 500)
    && ['mcp', 'drive', 'gmail', 'local_folder', 'single_document'].includes(String(value.mode))
    && ['ready', 'waiting_for_authorization', 'unavailable', 'error', 'unconfirmed'].includes(String(value.status))
    && (value.evidencePointer === undefined || isBoundedString(value.evidencePointer, 1000))
    && isBoundedStringArray(value.permissionScope, 500)
    && (value.detail === undefined || isBoundedString(value.detail, 500));
}

function isValidLedgerReceipt(value: unknown, sourceById: Map<string, Record<string, unknown>>, candidates: unknown[]): boolean {
  if (!isRecord(value)) return false;
  const source = typeof value.sourceId === 'string' ? sourceById.get(value.sourceId) : undefined;
  if (!source || value.mode !== source.mode || !isRecord(value.permissionSnapshot)) return false;
  try {
    validatePermissionSnapshot(value.permissionSnapshot, source.permissionScope as string[]);
  } catch {
    return false;
  }
  const candidatesById = new Map(candidates.map((candidate) => {
    const item = candidate as Record<string, unknown>;
    return [item.id as string, item] as const;
  }));
  return hasOnlyKeys(value, ['sourceId', 'mode', 'evidencePointer', 'contentHash', 'permissionSnapshot', 'collectionStatus', 'collectedAt', 'candidateIds'])
    && isBoundedString(value.sourceId, 500)
    && ['mcp', 'drive', 'gmail', 'local_folder', 'single_document'].includes(String(value.mode))
    && isBoundedString(value.evidencePointer, 1000)
    && typeof value.contentHash === 'string' && SHA256.test(value.contentHash)
    && value.collectionStatus === 'collected'
    && isIsoTimestamp(value.collectedAt)
    && isBoundedStringArray(value.candidateIds, 200)
    && (value.candidateIds as string[]).every((id) => candidatesById.get(id)?.sourceId === value.sourceId);
}

function isValidLedgerCandidate(value: unknown, runId: string, sourceIds: Set<string>): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['id', 'ingestedPayloadHash', 'sourceId', 'kind', 'payload', 'observationClass', 'evidenceId', 'reviewStatus', 'reviewDecision', 'reviewReason', 'mergedIntoCandidateId', 'promotedCanonicalIds'])
    || !isBoundedString(value.id, 200) || !isBoundedString(value.sourceId, 500) || !sourceIds.has(value.sourceId)
    || typeof value.ingestedPayloadHash !== 'string' || !SHA256.test(value.ingestedPayloadHash)
    || !isBoundedString(value.kind, 100) || !isRecord(value.payload)
    || !['observed', 'inferred'].includes(String(value.observationClass))
    || !isBoundedString(value.evidenceId, 1000)
    || !['pending', 'approved', 'rejected', 'merged'].includes(String(value.reviewStatus))
    || !isBoundedStringArray(value.promotedCanonicalIds, 200)
    || value.id !== stableId('onb_cand', runId, value.sourceId, value.evidenceId, value.kind, value.ingestedPayloadHash)) return false;
  const reviewedPayloadMayDiffer = value.reviewStatus === 'approved'
    && (value.reviewDecision === 'edit' || value.reviewDecision === 'merge');
  if (!reviewedPayloadMayDiffer && sha256(stableJson(value.payload)) !== value.ingestedPayloadHash) return false;
  if (value.reviewStatus === 'pending') return value.reviewDecision === undefined
    && value.reviewReason === undefined
    && value.mergedIntoCandidateId === undefined
    && value.promotedCanonicalIds.length === 0;
  if (!['approve', 'edit', 'reject', 'merge'].includes(String(value.reviewDecision)) || !isBoundedString(value.reviewReason, 500)) return false;
  if (value.reviewStatus === 'merged') return value.reviewDecision === 'merge'
    && isBoundedString(value.mergedIntoCandidateId, 200)
    && value.promotedCanonicalIds.length === 0;
  if (value.reviewStatus === 'rejected') return value.reviewDecision === 'reject'
    && value.mergedIntoCandidateId === undefined
    && value.promotedCanonicalIds.length === 0;
  if (value.observationClass !== 'observed'
    || !['approve', 'edit', 'merge'].includes(String(value.reviewDecision))
    || value.mergedIntoCandidateId !== undefined
    || value.promotedCanonicalIds.length === 0) return false;
  return stableJson(value.promotedCanonicalIds) === stableJson(expectedCanonicalIds({
    id: String(value.id),
    kind: String(value.kind),
    payload: value.payload
  }));
}

function expectedCanonicalIds(candidate: Pick<ConnectedCandidate, 'id' | 'kind' | 'payload'>): string[] {
  const validation = candidateValidationContext(candidate, false);
  const result = planApply([validation.candidate], { ids: new Set(), all: true }, validation.base, '2000-01-01T00:00:00.000Z');
  return result.skipped.length === 0 && result.applied.length === 1 ? result.applied[0].canonicalIds : [];
}

function candidateValidationContext(
  candidate: Pick<ConnectedCandidate, 'id' | 'kind' | 'payload'>,
  fillMissingProject: boolean
): { candidate: ApplyCandidate; base: Parameters<typeof planApply>[2] } {
  const payload = { ...candidate.payload };
  const requiresProject = ['person', 'relationship', 'decision'].includes(candidate.kind);
  const explicitProjectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
  const projectId = explicitProjectId || (requiresProject && fillMissingProject ? 'project-validation-only' : '');
  if (projectId && !explicitProjectId) payload.projectId = projectId;
  const supersedes = Array.isArray(payload.supersedes)
    ? payload.supersedes.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  return {
    candidate: { id: candidate.id, kind: candidate.kind, payload },
    base: {
      graphEntities: [
        ...(projectId ? [{ id: projectId, type: 'project' as const, name: projectId }] : []),
        ...supersedes.map((id) => ({ id, type: 'decision' as const, name: id }))
      ],
      graphEdges: [],
      relationships: [],
      personalKg: [],
      decisions: [],
      provenanceSourceKind: 'onboarding'
    }
  };
}

function isValidFirstValueReceipt(value: unknown, promoted: Set<string>): boolean {
  if (value === undefined) return true;
  return isRecord(value)
    && hasOnlyKeys(value, ['answerHash', 'usedCanonicalIds', 'missingContext', 'recordedAt'])
    && typeof value.answerHash === 'string' && SHA256.test(value.answerHash)
    && isBoundedStringArray(value.usedCanonicalIds, 200) && value.usedCanonicalIds.length > 0
    && (value.usedCanonicalIds as string[]).every((id) => promoted.has(id))
    && isBoundedStringArray(value.missingContext, 200)
    && isIsoTimestamp(value.recordedAt);
}

function isValidFirstValueReview(value: unknown, hasReceipt: boolean): boolean {
  if (value === undefined) return true;
  return hasReceipt && isRecord(value)
    && hasOnlyKeys(value, ['verdict', 'missingContext', 'reviewedAt', 'elapsedSeconds', 'withinTargetSeconds'])
    && ['useful', 'not_useful'].includes(String(value.verdict))
    && isBoundedStringArray(value.missingContext, 200)
    && isIsoTimestamp(value.reviewedAt)
    && typeof value.elapsedSeconds === 'number' && Number.isFinite(value.elapsedSeconds) && value.elapsedSeconds >= 0
    && typeof value.withinTargetSeconds === 'boolean';
}

function assertCanonicalReferences(run: ConnectedOnboardingRun, os: Awaited<ReturnType<typeof loadPersonalOs>>): void {
  const canonicalIds = new Set([
    ...os.graph.entities.map((item) => item.id),
    ...(os.graph.version === 2 ? os.graph.edges.map((item) => item.id) : []),
    ...os.relationships.relationships.map((item) => item.id),
    ...os.personalKg.map((item) => item.id),
    ...os.decisions.map((item) => item.id)
  ]);
  if (run.promotedCanonicalIds.some((id) => !canonicalIds.has(id))) {
    throwInvalidLedger();
  }
}

function assertLedgerCanonicalReferences(
  ledger: Ledger,
  os: Awaited<ReturnType<typeof loadPersonalOs>>
): void {
  for (const run of ledger.runs) assertCanonicalReferences(run, os);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isBoundedStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every((item) => isBoundedString(item, max));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function throwInvalidLedger(): never {
  throw new ConnectedOnboardingError('ledger_schema_unsupported', 'connected onboarding ledger contains invalid or incomplete data');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function persistLedger(dataDir: string, ledger: Ledger): Promise<void> {
  const serialized = serializeLedger(ledger);
  const runsDir = join(dataDir, 'runs');
  await mkdir(runsDir, { recursive: true });
  const target = ledgerPath(dataDir);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serialized, { mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function serializeLedger(ledger: Ledger): string {
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_LEDGER_BYTES) throw new ConnectedOnboardingError('ledger_too_large', 'connected onboarding ledger exceeds 1 MiB');
  return serialized;
}

async function withLedgerLock<T>(dataDir: string, operation: () => Promise<T>): Promise<T> {
  const runsDir = join(dataDir, 'runs');
  const lockDir = join(runsDir, '.connected-onboarding.lock');
  await mkdir(runsDir, { recursive: true });
  const owner = { pid: process.pid, hostname: hostname(), token: randomUUID() };
  for (let attempt = 0; ; attempt += 1) {
    let created = false;
    try {
      await mkdir(lockDir);
      created = true;
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
      break;
    } catch (error) {
      if (created) await rm(lockDir, { recursive: true, force: true }).catch(() => {});
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt >= 200) throw new ConnectedOnboardingError('ledger_lock_timeout', `timed out waiting for connected onboarding ledger lock in ${dataDir}`);
      await clearDeadSameHostLock(lockDir);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    return await operation();
  } finally {
    try {
      const current = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as { token?: string };
      if (current.token === owner.token) await rm(lockDir, { recursive: true, force: true });
    } catch {
      // A missing or foreign owner is not removed by this process.
    }
  }
}

async function clearDeadSameHostLock(lockDir: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as { pid?: number; hostname?: string };
    if (current.hostname !== hostname() || typeof current.pid !== 'number' || isProcessAlive(current.pid)) return;
    const staleDir = `${lockDir}.stale-${randomUUID()}`;
    await rename(lockDir, staleDir);
    await rm(staleDir, { recursive: true, force: true });
  } catch {
    // Incomplete, live, or concurrently claimed locks are left for bounded retry.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
