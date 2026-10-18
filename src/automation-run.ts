import {
  normalizeRunReceipt,
  type NormalizedRunReceipt
} from './run-receipt.js';
import {
  resolveRuntimeHostContext,
  type Awaitable,
  type RuntimeHostContext,
  type RuntimeHostPorts,
  type RuntimePortInput
} from './runtime-host.js';

export interface AutomationRunRequest {
  workflowId: string;
  automationId?: string;
  projectId?: string;
  sourceType?: string;
  externalRunId?: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AutomationRunnerStartInput {
  request: AutomationRunRequest;
  context: RuntimeHostContext;
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

export interface AutomationReceiptPersistenceInput {
  payload: unknown;
  normalized: NormalizedRunReceipt;
  context: RuntimeHostContext;
}

export interface AutomationReceiptPort {
  persist(input: AutomationReceiptPersistenceInput): Awaitable<unknown>;
  query(input: {
    request: AutomationRunRequest;
    context: RuntimeHostContext;
  }): Awaitable<unknown>;
}

export interface AutomationRunPorts extends RuntimeHostPorts {
  runner: AutomationRunnerPort;
  receipt: AutomationReceiptPort;
}

export interface AutomationRunResult {
  runnerResult: unknown;
  normalizedReceipt: NormalizedRunReceipt;
  persistedReceipt: unknown;
  context: RuntimeHostContext;
}

function assertRequest(request: AutomationRunRequest): void {
  if (!request || typeof request !== 'object') {
    throw new Error('automation run request is required');
  }
  if (typeof request.workflowId !== 'string' || request.workflowId.trim() === '') {
    throw new Error('automation run request workflowId must be a non-empty string');
  }
}

function assertPorts(ports: AutomationRunPorts): void {
  if (!ports.runner || typeof ports.runner !== 'object' || typeof ports.runner.start !== 'function') {
    throw new Error('automation runner port with start is required');
  }
  if (!ports.receipt || typeof ports.receipt !== 'object'
    || typeof ports.receipt.persist !== 'function'
    || typeof ports.receipt.query !== 'function') {
    throw new Error('automation receipt port with persist and query is required');
  }
}

export class AutomationRunService {
  private readonly ports: AutomationRunPorts;

  constructor(ports: AutomationRunPorts) {
    assertPorts(ports);
    this.ports = ports;
  }

  async start(request: AutomationRunRequest): Promise<AutomationRunResult> {
    return this.execute('automation.start', request, (context) =>
      this.ports.runner.start({ request, context }));
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
    return this.execute('automation.retry', request, (context) =>
      this.ports.runner.retry!({ request, context, previousRunId }));
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
    operation: string,
    request: AutomationRunRequest,
    run: (context: RuntimeHostContext) => Awaitable<AutomationRunnerResult>
  ): Promise<AutomationRunResult> {
    assertRequest(request);
    const input: RuntimePortInput = {
      operation,
      automationId: request.automationId,
      runId: request.externalRunId,
      request
    };
    const context = await resolveRuntimeHostContext(this.ports, input);
    const runnerResult = await run(context);
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
    return {
      runnerResult: result.result,
      normalizedReceipt,
      persistedReceipt,
      context
    };
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
