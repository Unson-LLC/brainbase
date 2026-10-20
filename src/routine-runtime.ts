import fs from 'node:fs';
import path from 'node:path';

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

export type RoutineScheduleKind = 'daily' | 'weekly';

export interface RoutineExpectationSchedule {
  kind: RoutineScheduleKind;
  hour: number;
  minute: number;
  day_of_week?: number;
}

export interface RoutineExpectation {
  routine: string;
  automation_id: string;
  source_type: string;
  project_id: string;
  timezone: string;
  schedule: RoutineExpectationSchedule;
  grace_minutes: number;
  required_artifacts: string[];
}

export interface RoutineExpectationConstraints {
  sourceType?: string;
  projectId?: string;
  timezone?: string;
}

function fail(index: number, field: string, message: string): never {
  throw new Error(`expectations[${index}].${field} ${message}`);
}

function requireString(value: unknown, index: number, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    fail(index, field, 'must be a non-empty trimmed string');
  }
  return value;
}

function requireInteger(value: unknown, index: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(index, field, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

/**
 * Parse a routine expectation document without assuming an organization,
 * tenant, timezone, or scheduler. Consumers that need those constraints pass
 * them explicitly, which keeps the common package portable.
 */
export function parseRoutineExpectations(
  value: unknown,
  constraints: RoutineExpectationConstraints = {}
): RoutineExpectation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('expectations must be a non-empty array');
  }

  const routines = new Set<string>();
  const automationIds = new Set<string>();

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`expectations[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const routine = requireString(record.routine, index, 'routine');
    const automationId = requireString(record.automation_id, index, 'automation_id');
    if (routines.has(routine)) fail(index, 'routine', 'must be unique');
    if (automationIds.has(automationId)) fail(index, 'automation_id', 'must be unique');
    routines.add(routine);
    automationIds.add(automationId);

    const sourceType = requireString(record.source_type, index, 'source_type');
    const projectId = requireString(record.project_id, index, 'project_id');
    const timezone = requireString(record.timezone, index, 'timezone');
    if (constraints.sourceType !== undefined && sourceType !== constraints.sourceType) {
      fail(index, 'source_type', `must be ${constraints.sourceType}`);
    }
    if (constraints.projectId !== undefined && projectId !== constraints.projectId) {
      fail(index, 'project_id', `must be ${constraints.projectId}`);
    }
    if (constraints.timezone !== undefined && timezone !== constraints.timezone) {
      fail(index, 'timezone', `must be ${constraints.timezone}`);
    }

    const scheduleValue = record.schedule;
    if (!scheduleValue || typeof scheduleValue !== 'object' || Array.isArray(scheduleValue)) {
      fail(index, 'schedule', 'must be an object');
    }
    const scheduleRecord = scheduleValue as Record<string, unknown>;
    const kind = requireString(scheduleRecord.kind, index, 'schedule.kind');
    if (kind !== 'daily' && kind !== 'weekly') {
      fail(index, 'schedule.kind', 'must be daily or weekly');
    }
    const schedule: RoutineExpectationSchedule = {
      kind,
      hour: requireInteger(scheduleRecord.hour, index, 'schedule.hour', 0, 23),
      minute: requireInteger(scheduleRecord.minute, index, 'schedule.minute', 0, 59)
    };
    if (kind === 'weekly') {
      schedule.day_of_week = requireInteger(
        scheduleRecord.day_of_week,
        index,
        'schedule.day_of_week',
        0,
        6
      );
    }

    const graceMinutes = requireInteger(record.grace_minutes, index, 'grace_minutes', 1, 24 * 60);
    if (!Array.isArray(record.required_artifacts) || record.required_artifacts.length === 0) {
      fail(index, 'required_artifacts', 'must be a non-empty array');
    }
    const requiredArtifacts = record.required_artifacts.map((artifact, artifactIndex) =>
      requireString(artifact, index, `required_artifacts[${artifactIndex}]`));
    if (new Set(requiredArtifacts).size !== requiredArtifacts.length) {
      fail(index, 'required_artifacts', 'must not contain duplicates');
    }

    return {
      routine,
      automation_id: automationId,
      source_type: sourceType,
      project_id: projectId,
      timezone,
      schedule,
      grace_minutes: graceMinutes,
      required_artifacts: requiredArtifacts
    };
  });
}

export function loadRoutineExpectations(
  filePath: string,
  constraints: RoutineExpectationConstraints = {}
): RoutineExpectation[] {
  return parseRoutineExpectations(
    JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown,
    constraints
  );
}

export interface RoutineDeadLetter {
  automation_id: string;
  created_at: string;
  path: string;
}

/** Read routine dead-letter files without interpreting organization data. */
export async function listRoutineDeadLetters({
  directory
}: {
  directory: string;
}): Promise<RoutineDeadLetter[]> {
  if (!fs.existsSync(directory)) return [];

  const items: RoutineDeadLetter[] = [];
  for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.json')).sort()) {
    const filePath = path.resolve(directory, name);
    const receipt = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      source?: { workflow_id?: unknown; name?: unknown };
    };
    const workflowId = receipt.source?.workflow_id;
    const automationId = workflowId && workflowId !== '__connector_observation__'
      ? workflowId
      : receipt.source?.name;
    if (typeof automationId !== 'string' || automationId.trim() === '') continue;
    items.push({
      automation_id: automationId,
      created_at: fs.statSync(filePath).mtime.toISOString(),
      path: name
    });
  }

  return items.sort((left, right) => right.created_at.localeCompare(left.created_at)
    || left.automation_id.localeCompare(right.automation_id));
}

export async function countRoutineOutbox({ directory }: { directory: string }): Promise<number> {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory).filter((entry) => entry.endsWith('.json')).length;
}

export interface RoutineRunRequest {
  routine: string;
  automationId: string;
  projectId?: string;
  sourceType?: string;
  externalRunId?: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface RoutineRunnerStartInput {
  request: RoutineRunRequest;
  context: RuntimeHostContext;
}

export interface RoutineRunnerRetryInput extends RoutineRunnerStartInput {
  previousRunId: string;
}

export interface RoutineRunnerResult {
  /** Canonical run_receipt.v1 payload. The host persists it through the receipt port. */
  receipt: unknown;
  result?: unknown;
}

export interface RoutineRunnerPort {
  start(input: RoutineRunnerStartInput): Awaitable<RoutineRunnerResult>;
  retry?(input: RoutineRunnerRetryInput): Awaitable<RoutineRunnerResult>;
}

export type RoutineReceiptPersistenceInput = RunReceiptPersistenceInput<RuntimeHostContext>;

export type RoutineReceiptPort = RunReceiptPort<RoutineRunRequest, RuntimeHostContext>;

export interface RoutineRuntimePorts extends RuntimeHostPorts {
  runner: RoutineRunnerPort;
  receipt: RoutineReceiptPort;
}

export interface RoutineRunResult {
  runnerResult: unknown;
  normalizedReceipt: NormalizedRunReceipt;
  persistedReceipt: unknown;
  context: RuntimeHostContext;
}

function assertRoutineRequest(request: RoutineRunRequest): void {
  if (!request || typeof request !== 'object') {
    throw new Error('routine request is required');
  }
  for (const [name, value] of [
    ['routine', request.routine],
    ['automationId', request.automationId]
  ] as const) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`routine request ${name} must be a non-empty string`);
    }
  }
}

function assertRoutinePorts(ports: RoutineRuntimePorts): void {
  if (!ports.runner || typeof ports.runner !== 'object' || typeof ports.runner.start !== 'function') {
    throw new Error('routine runner port with start is required');
  }
  assertRunReceiptPort(ports.receipt, 'routine receipt');
}

export class RoutineRuntimeService {
  private readonly ports: RoutineRuntimePorts;

  constructor(ports: RoutineRuntimePorts) {
    assertRoutinePorts(ports);
    this.ports = ports;
  }

  async start(request: RoutineRunRequest): Promise<RoutineRunResult> {
    return this.execute('routine.start', request, (context) =>
      this.ports.runner.start({ request, context }));
  }

  async retry(request: RoutineRunRequest, previousRunId: string): Promise<RoutineRunResult> {
    assertRoutineRequest(request);
    if (typeof previousRunId !== 'string' || previousRunId.trim() === '') {
      throw new Error('previousRunId must be a non-empty string');
    }
    if (typeof this.ports.runner.retry !== 'function') {
      throw new Error('routine runner retry port is required');
    }
    return this.execute('routine.retry', request, (context) =>
      this.ports.runner.retry!({ request, context, previousRunId }));
  }

  async history(request: RoutineRunRequest): Promise<unknown> {
    assertRoutineRequest(request);
    const input: RuntimePortInput = {
      operation: 'routine.history',
      routine: request.routine,
      automationId: request.automationId,
      request
    };
    const context = await resolveRuntimeHostContext(this.ports, input);
    return this.ports.receipt.query({ request, context });
  }

  private async execute(
    operation: string,
    request: RoutineRunRequest,
    run: (context: RuntimeHostContext) => Awaitable<RoutineRunnerResult>
  ): Promise<RoutineRunResult> {
    assertRoutineRequest(request);
    const input: RuntimePortInput = {
      operation,
      routine: request.routine,
      automationId: request.automationId,
      request
    };
    const context = await resolveRuntimeHostContext(this.ports, input);
    const runnerResult = await run(context);
    if (!runnerResult || typeof runnerResult !== 'object' || !('receipt' in runnerResult)) {
      throw new Error(`routine runner ${operation} must return a receipt`);
    }
    const result = runnerResult as RoutineRunnerResult;
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

export function createRoutineRuntime(ports: RoutineRuntimePorts): RoutineRuntimeService {
  return new RoutineRuntimeService(ports);
}

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

/** Return whether an expectation's scheduled minute matches the supplied instant. */
export function routineScheduleMatches(
  expectation: RoutineExpectation,
  instant: Date
): boolean {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error('instant must be a valid Date');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: expectation.timezone,
    hour12: false,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (hour !== expectation.schedule.hour || minute !== expectation.schedule.minute) return false;
  if (expectation.schedule.kind === 'daily') return true;
  return WEEKDAY_TO_NUMBER[values.weekday] === expectation.schedule.day_of_week;
}
