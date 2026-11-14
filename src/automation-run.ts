import { createHash } from 'node:crypto';

import {
  normalizeRunReceipt,
  type NormalizedRunReceipt
} from './run-receipt.js';
import {
  assertRunReceiptPort,
  type RunReceiptPersistenceInput,
  type RunReceiptPort
} from './run-receipt-port.js';
import {
  resolveRuntimeHostContext,
  type Awaitable,
  type RuntimeHostContext,
  type RuntimeHostPorts,
  type RuntimePortInput
} from './runtime-host.js';

export type AutomationRunOperation = 'automation.start' | 'automation.retry';
export type AutomationRunPhase =
  | 'claimed'
  | 'runner_started'
  | 'receipt_persisted'
  | 'completed'
  | 'retryable'
  | 'uncertain'
  | 'unknown';

export interface AutomationRunRequest {
  workflowId: string;
  automationId?: string;
  projectId?: string;
  organizationId?: string;
  orgId?: string;
  actorId?: string;
  sourceType?: string;
  /** Stable source identity used for the durable claim. */
  externalRunId: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AutomationRunNamespace {
  tenantId: string;
  projectId: string;
  organizationId: string;
  actorId: string;
}

export interface AutomationRunIdentity {
  operation: AutomationRunOperation;
  key: string;
  fingerprint: string;
  runnerIdempotencyKey: string;
  namespace: AutomationRunNamespace;
}

export interface AutomationRunnerStartInput {
  request: AutomationRunRequest;
  context: RuntimeHostContext;
  /** External runner must use this key for its own idempotent execution. */
  idempotencyKey: string;
}

export interface AutomationRunnerRetryInput extends AutomationRunnerStartInput {
  previousRunId: string;
}

export interface AutomationRunnerResult {
  /** Canonical run_receipt.v1 payload. */
  receipt: unknown;
  result?: unknown;
}

export interface AutomationRunnerPort {
  start(input: AutomationRunnerStartInput): Awaitable<AutomationRunnerResult>;
  retry?(input: AutomationRunnerRetryInput): Awaitable<AutomationRunnerResult>;
}

export type AutomationReceiptPersistenceInput = RunReceiptPersistenceInput<RuntimeHostContext>;

export type AutomationReceiptPort = RunReceiptPort<AutomationRunRequest, RuntimeHostContext>;

export type AutomationRunClaim =
  | {
      status: 'claimed';
      claimToken: string;
      attempt?: number;
      phase: 'claimed';
    }
  | {
      status: 'replay';
      payload: unknown;
      normalized?: NormalizedRunReceipt;
      runnerResult?: unknown;
      persistedReceipt?: unknown;
      phase: 'completed';
    }
  | {
      status: 'in_progress';
      claimToken?: string;
      attempt?: number;
      phase: Exclude<AutomationRunPhase, 'completed' | 'retryable'>;
    }
  | {
      status: 'conflict';
      reason: 'identity_mismatch' | 'uncertain';
      phase?: AutomationRunPhase;
    };

export interface AutomationRunStoreClaimInput extends AutomationRunIdentity {
  request: AutomationRunRequest;
  context: RuntimeHostContext;
}

export interface AutomationRunStoreCompletionInput extends AutomationRunStoreClaimInput {
  claimToken: string;
  payload: unknown;
  normalized: NormalizedRunReceipt;
  runnerResult: unknown;
  persistedReceipt: unknown;
}

export interface AutomationRunStoreRunnerStartedInput extends AutomationRunStoreClaimInput {
  claimToken: string;
}

export interface AutomationRunStoreReceiptPersistedInput extends AutomationRunStoreClaimInput {
  claimToken: string;
  payload: unknown;
  normalized: NormalizedRunReceipt;
  runnerResult: unknown;
  persistedReceipt: unknown;
}

export interface AutomationRunStoreReleaseInput extends AutomationRunStoreClaimInput {
  claimToken: string;
  /** retryable is safe only before runner invocation; uncertain is fail-closed. */
  outcome: 'retryable' | 'uncertain';
  phase: AutomationRunPhase;
  error: unknown;
}

export interface AutomationRunStoreReadInput extends AutomationRunStoreClaimInput {}

export type AutomationRunStoredState =
  | {
      status: 'completed';
      phase: 'completed';
      payload: unknown;
      normalized?: NormalizedRunReceipt;
      runnerResult?: unknown;
      persistedReceipt?: unknown;
    }
  | {
      status: 'in_progress' | 'retryable' | 'uncertain' | 'missing';
      phase: Exclude<AutomationRunPhase, 'completed'>;
      attempt?: number;
      error?: unknown;
    };

/**
 * Durable consumer-owned store for the external run identity. The claim and
 * every phase transition must be atomic in the backing store; a process-local
 * mutex is insufficient. The store compares key, namespace, operation, and
 * fingerprint before accepting a claim, and must never turn uncertain into a
 * retryable record automatically.
 */
export interface AutomationRunStorePort {
  claim(input: AutomationRunStoreClaimInput): Awaitable<AutomationRunClaim>;
  markRunnerStarted(input: AutomationRunStoreRunnerStartedInput): Awaitable<unknown>;
  markReceiptPersisted(input: AutomationRunStoreReceiptPersistedInput): Awaitable<unknown>;
  complete(input: AutomationRunStoreCompletionInput): Awaitable<unknown>;
  release(input: AutomationRunStoreReleaseInput): Awaitable<unknown>;
  read(input: AutomationRunStoreReadInput): Awaitable<AutomationRunStoredState>;
}

/**
 * Host-owned workflow composition around the portable run state machine.
 *
 * The consumer keeps workflow lookup, authorization/design policy, HITL and
 * database persistence in its own repository. The OSS core only invokes the
 * supplied ports in a deterministic order around the durable run phases.
 */
export type AutomationWorkflowGateDecision =
  | true
  | false
  | {
      allowed: boolean;
      context?: unknown;
      reason?: string;
    };

export type AutomationWorkflowLifecyclePhase =
  | 'prepared'
  | 'claimed'
  | 'runner_started'
  | 'receipt_persisted'
  | 'completed';

export interface AutomationWorkflowLifecycleInput {
  request: AutomationRunRequest;
  context: RuntimeHostContext;
  identity: AutomationRunIdentity;
  phase: AutomationWorkflowLifecyclePhase;
  workflow?: unknown;
  claimToken?: string;
  previousRunId?: string;
}

export interface AutomationWorkflowTransitionInput extends AutomationWorkflowLifecycleInput {
  from: AutomationWorkflowLifecyclePhase;
  to: AutomationWorkflowLifecyclePhase;
}

export interface AutomationWorkflowLifecyclePort {
  /** Consumer-owned lookup. A nullish result is a failed lookup. */
  lookup?(input: AutomationWorkflowLifecycleInput): Awaitable<unknown>;
  /** Consumer-owned workflow design/authorization decision. */
  designGate?(input: AutomationWorkflowLifecycleInput): Awaitable<AutomationWorkflowGateDecision>;
  /** Consumer-owned durable checkpoint (usually a DB write). */
  checkpoint?(input: AutomationWorkflowLifecycleInput): Awaitable<unknown>;
  /** Consumer-owned human approval/HITL decision. */
  humanGate?(input: AutomationWorkflowLifecycleInput): Awaitable<AutomationWorkflowGateDecision>;
  /** Consumer-owned transition record or state update. */
  transition?(input: AutomationWorkflowTransitionInput): Awaitable<unknown>;
}

export interface AutomationRunPorts extends RuntimeHostPorts {
  runner: AutomationRunnerPort;
  receipt: AutomationReceiptPort;
  runStore: AutomationRunStorePort;
  /** Optional until a consumer opts its existing workflow ports into the core. */
  lifecycle?: AutomationWorkflowLifecyclePort;
}

export interface AutomationRunResult {
  runnerResult: unknown;
  normalizedReceipt: NormalizedRunReceipt;
  persistedReceipt: unknown;
  context: RuntimeHostContext;
  replayed?: boolean;
}

type IdentityRecord = Record<string, unknown>;

function assertRequest(request: AutomationRunRequest): void {
  if (!request || typeof request !== 'object') {
    throw new Error('automation run request is required');
  }
  if (typeof request.workflowId !== 'string' || request.workflowId.trim() === '') {
    throw new Error('automation run request workflowId must be a non-empty string');
  }
  if (typeof request.externalRunId !== 'string' || request.externalRunId.trim() === '') {
    throw new Error('automation run request externalRunId must be a non-empty string');
  }
}

function assertPorts(ports: AutomationRunPorts): void {
  if (!ports.runner || typeof ports.runner !== 'object' || typeof ports.runner.start !== 'function') {
    throw new Error('automation runner port with start is required');
  }
  assertRunReceiptPort(ports.receipt, 'automation receipt');
  if (!ports.runStore || typeof ports.runStore !== 'object'
    || typeof ports.runStore.claim !== 'function'
    || typeof ports.runStore.markRunnerStarted !== 'function'
    || typeof ports.runStore.markReceiptPersisted !== 'function'
    || typeof ports.runStore.complete !== 'function'
    || typeof ports.runStore.release !== 'function'
    || typeof ports.runStore.read !== 'function') {
    throw new Error('automation runStore port with atomic claim, phase checkpoints, complete, release, and read is required');
  }
  if (ports.lifecycle !== undefined) {
    if (!ports.lifecycle || typeof ports.lifecycle !== 'object') {
      throw new Error('automation lifecycle port must be an object');
    }
    for (const [name, value] of [
      ['lookup', ports.lifecycle.lookup],
      ['designGate', ports.lifecycle.designGate],
      ['checkpoint', ports.lifecycle.checkpoint],
      ['humanGate', ports.lifecycle.humanGate],
      ['transition', ports.lifecycle.transition]
    ] as const) {
      if (value !== undefined && typeof value !== 'function') {
        throw new Error(`automation lifecycle port ${name} must be a function`);
      }
    }
  }
}

function stableValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { __type: 'number', value: 'NaN' };
    if (value === Infinity) return { __type: 'number', value: 'Infinity' };
    if (value === -Infinity) return { __type: 'number', value: '-Infinity' };
    return value;
  }
  if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() };
  if (typeof value === 'undefined') return { __type: 'undefined' };
  if (typeof value === 'function' || typeof value === 'symbol') {
    return { __type: typeof value, value: String(value) };
  }
  if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) throw new Error('automation run request contains a cyclic identity value');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => stableValue(entry, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = stableValue((value as IdentityRecord)[key], seen);
  }
  seen.delete(value);
  return result;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function stringFromRecord(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as IdentityRecord;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return undefined;
}

function requiredNamespaceValue(name: string, ...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  throw new Error(`automation run namespace ${name} must be explicit`);
}

function runNamespace(request: AutomationRunRequest, context: RuntimeHostContext): AutomationRunNamespace {
  const identity = context.identity;
  const graph = context.graph;
  return {
    tenantId: requiredNamespaceValue('tenantId', context.tenantId),
    projectId: requiredNamespaceValue('projectId', request.projectId),
    organizationId: requiredNamespaceValue(
      'organizationId',
      request.organizationId,
      request.orgId,
      stringFromRecord(identity, ['organizationId', 'organization_id', 'orgId', 'org_id']),
      stringFromRecord(graph, ['organizationId', 'organization_id', 'orgId', 'org_id'])
    ),
    actorId: requiredNamespaceValue(
      'actorId',
      request.actorId,
      stringFromRecord(identity, ['actorId', 'actor_id', 'userId', 'user_id', 'subject', 'sub'])
    )
  };
}

function buildRunIdentity(
  operation: AutomationRunOperation,
  request: AutomationRunRequest,
  context: RuntimeHostContext,
  previousRunId?: string
): AutomationRunIdentity {
  const namespace = runNamespace(request, context);
  const base = {
    operation,
    namespace,
    workflowId: request.workflowId,
    automationId: request.automationId || null,
    sourceType: request.sourceType || null,
    externalRunId: request.externalRunId,
    previousRunId: previousRunId || null,
    payload: request.payload === undefined ? null : request.payload,
    metadata: request.metadata === undefined ? null : request.metadata
  };
  const fingerprint = digest(base);
  const key = `automation-run:${digest({
    operation,
    namespace,
    workflowId: request.workflowId,
    externalRunId: request.externalRunId
  })}`;
  return {
    operation,
    key,
    fingerprint,
    runnerIdempotencyKey: `automation-run:${fingerprint}`,
    namespace
  };
}

function conflictError(request: AutomationRunRequest, phase?: AutomationRunPhase): Error {
  const error = new Error(`automation run '${request.externalRunId}' is already in progress`);
  Object.assign(error, {
    code: 'automation_run_in_progress',
    status: 409,
    statusCode: 409,
    externalRunId: request.externalRunId,
    ...(phase ? { phase } : {})
  });
  return error;
}

function identityConflictError(request: AutomationRunRequest): Error {
  const error = new Error(`automation run '${request.externalRunId}' conflicts with an existing identity`);
  Object.assign(error, {
    code: 'automation_run_identity_conflict',
    status: 409,
    statusCode: 409,
    externalRunId: request.externalRunId
  });
  return error;
}

function uncertainError(request: AutomationRunRequest, phase?: AutomationRunPhase): Error {
  const error = new Error(`automation run '${request.externalRunId}' has an uncertain durable outcome`);
  Object.assign(error, {
    code: 'automation_run_uncertain',
    status: 409,
    statusCode: 409,
    externalRunId: request.externalRunId,
    ...(phase ? { phase } : {})
  });
  return error;
}

function invalidClaimError(): Error {
  return new Error('automation runStore claim returned an invalid state');
}

function replayResult(
  stored: Extract<AutomationRunStoredState, { status: 'completed' }>,
  context: RuntimeHostContext
): AutomationRunResult {
  return {
    runnerResult: stored.runnerResult,
    normalizedReceipt: stored.normalized || normalizeRunReceipt(stored.payload),
    persistedReceipt: stored.persistedReceipt,
    context,
    replayed: true
  };
}

function workflowLifecycleError(
  code: string,
  request: AutomationRunRequest,
  reason?: unknown
): Error {
  const suffix = typeof reason === 'string' && reason.trim() !== '' ? `: ${reason}` : '';
  const error = new Error(`${code}${suffix}`);
  Object.assign(error, {
    code,
    status: 409,
    statusCode: 409,
    externalRunId: request.externalRunId
  });
  return error;
}

function requireWorkflowGate(
  decision: AutomationWorkflowGateDecision,
  code: string,
  request: AutomationRunRequest
): void {
  const allowed = decision === true
    || (typeof decision === 'object'
      && decision !== null
      && decision.allowed === true);
  if (!allowed) {
    const reason = typeof decision === 'object' && decision !== null ? decision.reason : undefined;
    throw workflowLifecycleError(code, request, reason);
  }
}

export class AutomationRunService {
  private readonly ports: AutomationRunPorts;

  constructor(ports: AutomationRunPorts) {
    assertPorts(ports);
    this.ports = ports;
  }

  async start(request: AutomationRunRequest): Promise<AutomationRunResult> {
    return this.execute('automation.start', request, (context, idempotencyKey) =>
      this.ports.runner.start({ request, context, idempotencyKey }));
  }

  async run(request: AutomationRunRequest): Promise<AutomationRunResult> {
    return this.start(request);
  }

  async retry(request: AutomationRunRequest, previousRunId: string): Promise<AutomationRunResult> {
    assertRequest(request);
    if (typeof previousRunId !== 'string' || previousRunId.trim() === '') {
      throw new Error('previousRunId must be a non-empty string');
    }
    if (typeof this.ports.runner.retry !== 'function') {
      throw new Error('automation runner retry port is required');
    }
    return this.execute('automation.retry', request, (context, idempotencyKey) =>
      this.ports.runner.retry!({ request, context, previousRunId, idempotencyKey }), previousRunId);
  }

  async rerun(request: AutomationRunRequest, previousRunId: string): Promise<AutomationRunResult> {
    return this.retry(request, previousRunId);
  }

  async history(request: AutomationRunRequest): Promise<unknown> {
    assertRequest(request);
    const input: RuntimePortInput = {
      operation: 'automation.history',
      automationId: request.automationId,
      runId: request.externalRunId,
      request
    };
    const context = await resolveRuntimeHostContext(this.ports, input);
    return this.ports.receipt.query({ request, context });
  }

  async getRun(request: AutomationRunRequest): Promise<unknown> {
    return this.history(request);
  }

  private async execute(
    operation: AutomationRunOperation,
    request: AutomationRunRequest,
    run: (context: RuntimeHostContext, idempotencyKey: string) => Awaitable<AutomationRunnerResult>,
    previousRunId?: string
  ): Promise<AutomationRunResult> {
    assertRequest(request);
    const input: RuntimePortInput = {
      operation,
      automationId: request.automationId,
      runId: request.externalRunId,
      request
    };
    const context = await resolveRuntimeHostContext(this.ports, input);
    const identity = buildRunIdentity(operation, request, context, previousRunId);
    const claimInput = { ...identity, request, context };
    const lifecycle = this.ports.lifecycle;
    let workflow: unknown;
    const preparedLifecycleInput = (): AutomationWorkflowLifecycleInput => ({
      request,
      context,
      identity,
      phase: 'prepared',
      workflow,
      previousRunId
    });

    // Workflow lookup and policy gates are host-owned. They run before the
    // durable claim so a denied design/HITL decision cannot leave a retryable
    // record behind, while the core still fixes their order before the runner.
    if (lifecycle?.lookup) {
      workflow = await lifecycle.lookup(preparedLifecycleInput());
      if (workflow === null || workflow === undefined) {
        throw workflowLifecycleError('automation_workflow_lookup_failed', request);
      }
    }
    if (lifecycle?.designGate) {
      requireWorkflowGate(
        await lifecycle.designGate(preparedLifecycleInput()),
        'automation_workflow_design_gate_denied',
        request
      );
    }
    if (lifecycle?.humanGate) {
      requireWorkflowGate(
        await lifecycle.humanGate(preparedLifecycleInput()),
        'automation_workflow_human_gate_denied',
        request
      );
    }

    // A rejected claim is not safe to release: the backing store may have
    // committed it while the response was lost. Fail closed and let a durable
    // reconciliation worker inspect the record.
    const claim = await this.ports.runStore.claim(claimInput);
    if (!claim || typeof claim !== 'object' || typeof claim.status !== 'string') {
      throw invalidClaimError();
    }
    if (claim.status === 'conflict') {
      if (claim.reason === 'identity_mismatch') throw identityConflictError(request);
      throw uncertainError(request, claim.phase);
    }
    if (claim.status === 'replay') {
      const stored = await this.ports.runStore.read(claimInput);
      if (stored.status === 'completed') {
        if (lifecycle?.transition) {
          try {
            await lifecycle.transition({
              ...preparedLifecycleInput(),
              phase: 'completed',
              from: 'receipt_persisted',
              to: 'completed'
            });
          } catch {
            // The runStore has already committed the external side effect;
            // retrying the runner is forbidden while the host transition is
            // reconciled separately.
            throw uncertainError(request, 'completed');
          }
        }
        return replayResult(stored, context);
      }
      if (stored.status === 'uncertain') throw uncertainError(request, stored.phase);
      throw new Error(`automation runStore replay readback was not completed for ${request.externalRunId}`);
    }
    if (claim.status === 'in_progress') {
      const stored = await this.ports.runStore.read(claimInput);
      if (stored.status === 'completed') {
        if (lifecycle?.transition) {
          try {
            await lifecycle.transition({
              ...preparedLifecycleInput(),
              phase: 'completed',
              from: 'receipt_persisted',
              to: 'completed'
            });
          } catch {
            throw uncertainError(request, 'completed');
          }
        }
        return replayResult(stored, context);
      }
      if (stored.status === 'uncertain') throw uncertainError(request, stored.phase);
      throw conflictError(request, stored.phase || claim.phase);
    }
    if (claim.status !== 'claimed' || typeof claim.claimToken !== 'string' || claim.claimToken.trim() === '') {
      throw invalidClaimError();
    }

    let phase: AutomationRunPhase = 'claimed';
    try {
      if (lifecycle?.checkpoint) {
        phase = 'unknown';
        await lifecycle.checkpoint({
          ...preparedLifecycleInput(),
          phase: 'claimed',
          claimToken: claim.claimToken
        });
        phase = 'claimed';
      }

      // The marker is durable and precedes the external call. If it fails, the
      // state is unknown and must never be made retryable automatically.
      phase = 'unknown';
      await this.ports.runStore.markRunnerStarted({ ...claimInput, claimToken: claim.claimToken });
      phase = 'runner_started';
      if (lifecycle?.transition) {
        phase = 'unknown';
        await lifecycle.transition({
          ...preparedLifecycleInput(),
          phase: 'runner_started',
          claimToken: claim.claimToken,
          from: 'claimed',
          to: 'runner_started'
        });
        phase = 'runner_started';
      }

      const runnerResult = await run(context, identity.runnerIdempotencyKey);
      if (!runnerResult || typeof runnerResult !== 'object' || !('receipt' in runnerResult)) {
        throw new Error(`automation runner ${operation} must return a receipt`);
      }
      const result = runnerResult as AutomationRunnerResult;
      const normalizedReceipt = normalizeRunReceipt(result.receipt);
      const persistedReceipt = await this.ports.receipt.persist({
        payload: result.receipt,
        normalized: normalizedReceipt,
        context
      });

      phase = 'unknown';
      await this.ports.runStore.markReceiptPersisted({
        ...claimInput,
        claimToken: claim.claimToken,
        payload: result.receipt,
        normalized: normalizedReceipt,
        runnerResult: result.result,
        persistedReceipt
      });
      phase = 'receipt_persisted';
      if (lifecycle?.transition) {
        phase = 'unknown';
        await lifecycle.transition({
          ...preparedLifecycleInput(),
          phase: 'receipt_persisted',
          claimToken: claim.claimToken,
          from: 'runner_started',
          to: 'receipt_persisted'
        });
        phase = 'receipt_persisted';
      }

      phase = 'unknown';
      await this.ports.runStore.complete({
        ...claimInput,
        claimToken: claim.claimToken,
        payload: result.receipt,
        normalized: normalizedReceipt,
        runnerResult: result.result,
        persistedReceipt
      });
      phase = 'completed';

      // Readback is part of the contract. A lost response after complete must
      // not cause a caller to invoke the runner again.
      phase = 'unknown';
      const stored = await this.ports.runStore.read(claimInput);
      if (!stored || stored.status !== 'completed') {
        throw uncertainError(request, stored?.phase || 'unknown');
      }
      if (lifecycle?.transition) {
        phase = 'unknown';
        await lifecycle.transition({
          ...preparedLifecycleInput(),
          phase: 'completed',
          claimToken: claim.claimToken,
          from: 'receipt_persisted',
          to: 'completed'
        });
        phase = 'completed';
      }
      phase = 'completed';
      return {
        runnerResult: stored.runnerResult,
        normalizedReceipt: stored.normalized || normalizeRunReceipt(stored.payload),
        persistedReceipt: stored.persistedReceipt,
        context
      };
    } catch (error) {
      const outcome = phase === 'claimed' ? 'retryable' : 'uncertain';
      const releasePhase: AutomationRunPhase = outcome === 'retryable' ? 'retryable' : phase;
      await Promise.resolve(this.ports.runStore.release({
        ...claimInput,
        claimToken: claim.claimToken,
        outcome,
        phase: releasePhase,
        error
      })).catch(() => undefined);
      throw error;
    }
  }
}

/** Thin compatibility facade for hosts that previously composed a control runtime. */
export class AutomationControlRuntime {
  constructor(private readonly service: AutomationRunService) {}

  start(request: AutomationRunRequest): Promise<AutomationRunResult> {
    return this.service.start(request);
  }

  retry(request: AutomationRunRequest, previousRunId: string): Promise<AutomationRunResult> {
    return this.service.retry(request, previousRunId);
  }

  history(request: AutomationRunRequest): Promise<unknown> {
    return this.service.history(request);
  }

  getRun(request: AutomationRunRequest): Promise<unknown> {
    return this.service.getRun(request);
  }
}

export function createAutomationRunService(ports: AutomationRunPorts): AutomationRunService {
  return new AutomationRunService(ports);
}
