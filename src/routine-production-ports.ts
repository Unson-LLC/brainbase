import type { Awaitable } from './runtime-host.js';

/**
 * Consumer-owned operations used by the routine endpoints.
 *
 * The implementation belongs to the application that owns Graph, tenant,
 * credentials, and persistence. This public contract keeps the routine
 * cycle independent from those details while giving each consumer one
 * explicit seam to validate at composition time.
 */
export interface RoutineProductionPorts {
  reconcile(input?: unknown, context?: unknown): Awaitable<unknown>;
  compress(input?: unknown, context?: unknown): Awaitable<unknown>;
  buildNightOutput(input?: unknown, context?: unknown): Awaitable<unknown>;
  verify(input?: unknown, context?: unknown): Awaitable<unknown>;
  recallGraph(input?: unknown, context?: unknown): Awaitable<unknown>;
  recallPersonalKg(input?: unknown, context?: unknown): Awaitable<unknown>;
  generate(input?: unknown, context?: unknown): Awaitable<unknown>;
  recordUsage(input?: unknown, context?: unknown): Awaitable<unknown>;
  evaluateMetrics(input?: unknown, context?: unknown): Awaitable<unknown>;
  createImprovementCandidates(input?: unknown, context?: unknown): Awaitable<unknown>;
  listKnowledgeReviews(input?: unknown, context?: unknown): Awaitable<unknown>;
}

const REQUIRED_ROUTINE_PRODUCTION_PORTS = [
  'reconcile',
  'compress',
  'buildNightOutput',
  'verify',
  'recallGraph',
  'recallPersonalKg',
  'generate',
  'recordUsage',
  'evaluateMetrics',
  'createImprovementCandidates',
  'listKnowledgeReviews'
] as const satisfies readonly (keyof RoutineProductionPorts)[];

/**
 * Validate a consumer's routine endpoint port set without resolving any
 * consumer-specific dependency. The same instance is returned so class
 * methods retain their receiver and injected state.
 */
export function assertRoutineProductionPorts(value: unknown): RoutineProductionPorts {
  if (!value || typeof value !== 'object') {
    throw new Error('routine production ports are required');
  }
  const ports = value as Record<string, unknown>;
  for (const name of REQUIRED_ROUTINE_PRODUCTION_PORTS) {
    if (typeof ports[name] !== 'function') {
      throw new Error(`routine production port ${name} must be a function`);
    }
  }
  return value as RoutineProductionPorts;
}

/** Alias used by composition roots that prefer a constructor-shaped API. */
export function createRoutineProductionPorts(value: unknown): RoutineProductionPorts {
  return assertRoutineProductionPorts(value);
}
