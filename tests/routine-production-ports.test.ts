import { describe, expect, it } from 'vitest';

import {
  assertRoutineProductionPorts,
  createRoutineProductionPorts,
  type RoutineProductionPorts
} from '../src/routines.js';

const portNames: (keyof RoutineProductionPorts)[] = [
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
];

function completePorts(): RoutineProductionPorts {
  return Object.fromEntries(portNames.map((name) => [name, () => name])) as RoutineProductionPorts;
}

describe('routine production port contract', () => {
  it('accepts a complete consumer port set and preserves identity', () => {
    const ports = completePorts();

    expect(assertRoutineProductionPorts(ports)).toBe(ports);
    expect(createRoutineProductionPorts(ports)).toBe(ports);
  });

  it('accepts class instances without losing their receiver', async () => {
    class Ports {
      value = 'host-state';

      reconcile() { return this.value; }
    }
    const instance = new Ports();
    const ports = Object.assign(
      instance,
      Object.fromEntries(portNames
        .filter((name) => name !== 'reconcile')
        .map((name) => [name, () => name]))
    ) as Ports & RoutineProductionPorts;

    expect(assertRoutineProductionPorts(ports)).toBe(ports);
    expect(await ports.reconcile()).toBe('host-state');
  });

  it('rejects an incomplete or non-object value', () => {
    expect(() => assertRoutineProductionPorts(null)).toThrow('routine production ports are required');
    const missing = completePorts();
    delete (missing as Partial<RoutineProductionPorts>).compress;
    expect(() => assertRoutineProductionPorts(missing)).toThrow(
      'routine production port compress must be a function'
    );
  });
});
