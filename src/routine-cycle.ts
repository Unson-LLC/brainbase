/**
 * Portable lifecycle for a routine cycle.
 *
 * The consumer owns each routine's Graph, tenant, credentials, storage, and
 * systemd behavior. This core only selects the injected handler, converts a
 * thrown handler error into the consumer's error result, and invokes the same
 * finalizer for both success and failure. That keeps the cycle boundary
 * reusable without moving Brainbase policy into the OSS package.
 */

export type RoutineCycleInput = Record<string, unknown>;
export type RoutineCycleHandler = (input: RoutineCycleInput, context?: unknown) => unknown | PromiseLike<unknown>;
export type RoutineCycleErrorResult = (error: unknown, routine: string) => unknown;
export type RoutineCycleSummary = (routine: string, result: unknown) => unknown;
export type RoutineCycleContentAvailability = (
  routine: string,
  result: unknown
) => boolean | undefined;
export type RoutineCycleContentEmptyAnomaly = (routine: string) => Record<string, unknown>;
export type RoutineCyclePostprocessor = (routine: string, result: unknown) => unknown;

export interface RoutineCycleRuntimeOptions {
  handlers: Record<string, RoutineCycleHandler>;
  onError?: RoutineCycleErrorResult;
  summarize?: RoutineCycleSummary;
  /** Consumer may report whether a completed routine produced usable content. */
  contentAvailable?: RoutineCycleContentAvailability;
  /** Consumer may preserve its public wording for an empty completed result. */
  contentEmptyAnomaly?: RoutineCycleContentEmptyAnomaly;
  /** Consumer-specific decoration runs after the portable finalizer. */
  postprocess?: RoutineCyclePostprocessor;
}

export interface RoutineCycleFinalizeOptions {
  /** A consumer may report that a completed routine had no usable content. */
  contentAvailable?: boolean;
  contentEmptyAnomaly?: Record<string, unknown>;
}

function unsupportedRoutine(routine: string): Error {
  return new Error(`unsupported routine: ${routine}`);
}

function defaultErrorResult(error: unknown, stage = 'routine_execution'): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 'failed',
    anomalies: [{ code: 'routine_execution_failed', stage, summary: message }]
  };
}

function errorWithStage(error: unknown, stage: string): unknown {
  if (error && typeof error === 'object') {
    try {
      const existingStage = (error as { stage?: unknown }).stage;
      if (typeof existingStage !== 'string' || existingStage.trim() === '') {
        Object.assign(error, { stage });
      }
      return error;
    } catch {
      // A frozen host error still gets a stable wrapper below.
    }
  }
  const wrapped = new Error(error instanceof Error ? error.message : String(error));
  Object.assign(wrapped, { stage, cause: error });
  return wrapped;
}

function safeErrorResult(
  onError: RoutineCycleErrorResult,
  error: unknown,
  routine: string,
  stage: string
): unknown {
  const staged = errorWithStage(error, stage);
  try {
    return onError(staged, routine);
  } catch (handlerError) {
    return defaultErrorResult(handlerError, stage);
  }
}

/**
 * Normalize the lifecycle fields shared by every routine consumer.
 *
 * Consumer code remains responsible for redacting and shaping its domain
 * output. This function owns the portable status/coverage/anomaly contract so
 * a consumer cannot accidentally drop an anomaly while adding its own summary.
 */
export function finalizeRoutineCycleResult(
  routine: string,
  result: unknown,
  options: RoutineCycleFinalizeOptions = {}
): Record<string, unknown> {
  const source = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : {};
  let status = typeof source.status === 'string' ? source.status : 'failed';
  const anomalies = Array.isArray(source.anomalies) ? [...source.anomalies] : [];
  if (status === 'completed' && options.contentAvailable === false) {
    status = 'partial';
    anomalies.push(options.contentEmptyAnomaly || {
      code: 'routine_content_empty',
      routine,
      summary: 'routine completed without usable content'
    });
  }
  const coverage = options.contentAvailable === false
    ? 'partial'
    : typeof source.coverage === 'string'
    ? source.coverage
    : status === 'failed'
      ? 'unavailable'
      : anomalies.length > 0 || status === 'partial' ? 'partial' : 'confirmed';
  return {
    ...source,
    status,
    anomalies,
    coverage,
    summary: {
      routine,
      status,
      coverage,
      anomaly_count: anomalies.length
    }
  };
}

export class RoutineCycleRuntime {
  private readonly handlers: Record<string, RoutineCycleHandler>;
  private readonly onError: RoutineCycleErrorResult;
  private readonly summarize: RoutineCycleSummary;
  private readonly contentAvailable?: RoutineCycleContentAvailability;
  private readonly contentEmptyAnomaly?: RoutineCycleContentEmptyAnomaly;
  private readonly postprocess?: RoutineCyclePostprocessor;

  constructor(options: RoutineCycleRuntimeOptions) {
    if (!options || typeof options !== 'object' || !options.handlers || typeof options.handlers !== 'object') {
      throw new Error('routine cycle handlers are required');
    }
    this.handlers = options.handlers;
    this.onError = options.onError || ((error) => defaultErrorResult(error));
    this.summarize = options.summarize || ((_routine, result) => result);
    this.contentAvailable = options.contentAvailable;
    this.contentEmptyAnomaly = options.contentEmptyAnomaly;
    this.postprocess = options.postprocess;
  }

  async execute(input: RoutineCycleInput = {}, context?: unknown): Promise<unknown> {
    const routine = typeof input?.routine === 'string' ? input.routine : String(input?.routine || '');
    let result: unknown;
    try {
      const handler = this.handlers[routine];
      if (typeof handler !== 'function') throw unsupportedRoutine(routine);
      result = await handler(input, context);
    } catch (error) {
      result = safeErrorResult(this.onError, error, routine, 'routine_execution');
    }
    let summarized: unknown;
    try {
      summarized = await this.summarize(routine, result);
    } catch (error) {
      summarized = safeErrorResult(this.onError, error, routine, 'summary');
    }

    let finalized: Record<string, unknown>;
    try {
      finalized = finalizeRoutineCycleResult(routine, summarized, {
        contentAvailable: this.contentAvailable?.(routine, summarized),
        contentEmptyAnomaly: this.contentEmptyAnomaly?.(routine) || {
          code: 'routine_content_empty',
          routine,
          summary: 'routine completed without usable content'
        }
      });
    } catch (error) {
      finalized = finalizeRoutineCycleResult(
        routine,
        safeErrorResult(this.onError, error, routine, 'finalize')
      );
    }
    if (!this.postprocess) return finalized;
    try {
      return await this.postprocess(routine, finalized);
    } catch (error) {
      // Decoration is consumer-owned, but it remains inside the portable
      // cycle boundary so a decoration failure cannot escape as an untracked
      // successful routine.
      return finalizeRoutineCycleResult(
        routine,
        safeErrorResult(this.onError, error, routine, 'postprocess')
      );
    }
  }
}

export function createRoutineCycleRuntime(options: RoutineCycleRuntimeOptions): RoutineCycleRuntime {
  return new RoutineCycleRuntime(options);
}
