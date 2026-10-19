import type { Awaitable } from './runtime-host.js';
import type { RoutineExpectation } from './routine-runtime.js';

export interface RoutineReceiptHistoryQuery {
  projectId: string;
  sourceType: string;
  sourceIdentity: string;
  limit: number;
}

export interface RoutineReceiptHistoryPort {
  listHistory(
    input: RoutineReceiptHistoryQuery,
    context?: unknown
  ): Awaitable<{ items?: unknown[] } | unknown>;
}

export interface RoutineLivenessExceptionPort {
  (context?: unknown): Awaitable<unknown[]>;
}

export interface RoutineLivenessRuntimeOptions {
  expectations: RoutineExpectation[];
  runReceiptQueryService: RoutineReceiptHistoryPort;
  listDeadLetters?: RoutineLivenessExceptionPort;
  listKnowledgeEventDeadLetters?: RoutineLivenessExceptionPort;
  listKnowledgeEventOutboxExceptions?: RoutineLivenessExceptionPort;
  listRuntimeIdentityExceptions?: RoutineLivenessExceptionPort;
  /** Consumers may add domain-specific priorities without moving them here. */
  priority?: Readonly<Record<string, number>>;
  now?: () => Date;
}

const DEFAULT_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  dead_letter: 1,
  missing_receipt: 2,
  required_artifact_missing: 3,
  blocked_receipt: 4
});

function asDate(value: unknown, fieldName: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} must be a valid date`);
  return date;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0
  );
  return localAsUtc - date.getTime();
}

/** Convert a recurring local wall-clock schedule to an instant. */
export function scheduledAtFor(expectation: RoutineExpectation, now: Date): Date {
  const current = asDate(now, 'now');
  const local = zonedParts(current, expectation.timezone);
  const localNowMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
  const scheduled = new Date(localNowMs);
  scheduled.setUTCHours(expectation.schedule.hour, expectation.schedule.minute, 0, 0);

  if (expectation.schedule.kind === 'daily') {
    if (scheduled.getTime() > localNowMs) scheduled.setUTCDate(scheduled.getUTCDate() - 1);
  } else if (expectation.schedule.kind === 'weekly') {
    const dayOfWeek = expectation.schedule.day_of_week;
    if (dayOfWeek === undefined) {
      throw new Error('weekly routine schedule day_of_week is required');
    }
    const weekday = new Date(localNowMs).getUTCDay();
    const daysSinceSchedule = (weekday - dayOfWeek + 7) % 7;
    scheduled.setUTCDate(scheduled.getUTCDate() - daysSinceSchedule);
    if (scheduled.getTime() > localNowMs) scheduled.setUTCDate(scheduled.getUTCDate() - 7);
  } else {
    throw new Error(`Unsupported routine schedule kind: ${String(expectation.schedule.kind)}`);
  }

  // Resolve the offset at the candidate date. Two iterations cover DST
  // transitions while keeping the core independent of a timezone library.
  let instantMs = scheduled.getTime();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instantMs = scheduled.getTime() - timezoneOffsetMs(new Date(instantMs), expectation.timezone);
  }
  return new Date(instantMs);
}

function isBlockedReceipt(receipt: Record<string, unknown>): boolean {
  return ['blocked', 'failed', 'waiting_human'].includes(String(receipt.source_status))
    || ['no_data', 'unconfirmed'].includes(String(receipt.evidence_state));
}

function normalizeArtifactName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function missingRequiredArtifacts(
  expectation: RoutineExpectation,
  receipt: Record<string, unknown>
): string[] {
  const evidenceRefs = Array.isArray(receipt.evidence_refs) ? receipt.evidence_refs : [];
  return expectation.required_artifacts.filter((requiredArtifact) => !evidenceRefs.some((evidence) => {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
    const item = evidence as Record<string, unknown>;
    if (item.kind !== 'artifact_ref') return false;
    if (normalizeArtifactName(item.label) === normalizeArtifactName(requiredArtifact)) return true;
    if (requiredArtifact === 'routine_summary') {
      const ref = String(item.ref || '').toLowerCase();
      return /(?:^|[/:_-])routine(?:[/:_-])summary(?:$|[/:_-])/.test(ref)
        || /(?:^|[/:_-])summary(?:$|[/:_-])/.test(ref);
    }
    return false;
  }));
}

function exceptionOverdueMs(exceptionItem: Record<string, unknown>, now: Date): number {
  const reference = exceptionItem.grace_deadline_at
    || exceptionItem.finished_at
    || exceptionItem.created_at;
  return reference ? Math.max(0, now.getTime() - asDate(reference, 'exception timestamp').getTime()) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Portable liveness/reconciliation over routine expectations and receipts.
 * Graph, tenant, storage and dead-letter sources remain injected consumer
 * ports; only schedule, receipt and required-artifact semantics live here.
 */
export class RoutineLivenessRuntime {
  private readonly expectations: RoutineExpectation[];
  private readonly runReceiptQueryService: RoutineReceiptHistoryPort;
  private readonly listDeadLetters: RoutineLivenessExceptionPort;
  private readonly listKnowledgeEventDeadLetters: RoutineLivenessExceptionPort;
  private readonly listKnowledgeEventOutboxExceptions: RoutineLivenessExceptionPort;
  private readonly listRuntimeIdentityExceptions: RoutineLivenessExceptionPort;
  private readonly priority: Readonly<Record<string, number>>;
  private readonly now: () => Date;

  constructor(options: RoutineLivenessRuntimeOptions) {
    if (!options || !Array.isArray(options.expectations)) {
      throw new Error('routine liveness expectations must be an array');
    }
    if (!options.runReceiptQueryService || typeof options.runReceiptQueryService.listHistory !== 'function') {
      throw new Error('routine liveness runReceiptQueryService.listHistory is required');
    }
    this.expectations = options.expectations;
    this.runReceiptQueryService = options.runReceiptQueryService;
    this.listDeadLetters = options.listDeadLetters || (async () => []);
    this.listKnowledgeEventDeadLetters = options.listKnowledgeEventDeadLetters || (async () => []);
    this.listKnowledgeEventOutboxExceptions = options.listKnowledgeEventOutboxExceptions || (async () => []);
    this.listRuntimeIdentityExceptions = options.listRuntimeIdentityExceptions || (async () => []);
    this.priority = { ...DEFAULT_PRIORITY, ...(options.priority || {}) };
    this.now = options.now || (() => new Date());
  }

  async listExceptions({ limit = 3 }: { limit?: number } = {}, context?: unknown): Promise<unknown[]> {
    const current = asDate(this.now(), 'now');
    const [deadLetters, knowledgeEventDeadLetters, knowledgeEventOutboxExceptions, runtimeIdentityExceptions] = await Promise.all([
      this.listDeadLetters(context),
      this.listKnowledgeEventDeadLetters(context),
      this.listKnowledgeEventOutboxExceptions(context),
      this.listRuntimeIdentityExceptions(context)
    ]);
    const deadLettersByAutomation = new Map<string, Record<string, unknown>>();
    for (const item of Array.isArray(deadLetters) ? deadLetters : []) {
      const value = record(item);
      const automationId = typeof value.automation_id === 'string' ? value.automation_id : '';
      if (automationId && !deadLettersByAutomation.has(automationId)) deadLettersByAutomation.set(automationId, value);
    }

    const exceptions: Record<string, unknown>[] = [
      ...(Array.isArray(runtimeIdentityExceptions) ? runtimeIdentityExceptions : []),
      ...(Array.isArray(knowledgeEventDeadLetters) ? knowledgeEventDeadLetters : []),
      ...(Array.isArray(knowledgeEventOutboxExceptions) ? knowledgeEventOutboxExceptions : [])
    ].map((item) => {
      const value = record(item);
      return {
        ...value,
        ...(value.path ? { path: String(value.path).split(/[\\/]/).pop() } : {})
      };
    });

    for (const expectation of this.expectations) {
      const scheduledAt = scheduledAtFor(expectation, current);
      const graceDeadline = new Date(scheduledAt.getTime() + expectation.grace_minutes * 60 * 1000);
      const deadLetter = deadLettersByAutomation.get(expectation.automation_id);
      if (deadLetter) {
        exceptions.push({
          code: 'dead_letter',
          automation_id: expectation.automation_id,
          created_at: deadLetter.created_at,
          path: deadLetter.path,
          scheduled_at: scheduledAt.toISOString(),
          grace_deadline_at: graceDeadline.toISOString()
        });
      }

      const historyInput: RoutineReceiptHistoryQuery = {
        projectId: expectation.project_id,
        sourceType: expectation.source_type,
        sourceIdentity: expectation.automation_id,
        limit: 1
      };
      const history = record(await this.runReceiptQueryService.listHistory(historyInput, context));
      const items = Array.isArray(history.items) ? history.items : [];
      const latest = record(items[0]);
      const latestFinishedAt = latest.finished_at ? asDate(latest.finished_at, 'receipt.finished_at') : null;
      const receiptForSchedule = latestFinishedAt && latestFinishedAt >= scheduledAt ? latest : null;

      if (!receiptForSchedule) {
        if (current.getTime() > graceDeadline.getTime()) {
          exceptions.push({
            code: 'missing_receipt',
            automation_id: expectation.automation_id,
            scheduled_at: scheduledAt.toISOString(),
            grace_deadline_at: graceDeadline.toISOString()
          });
        }
        continue;
      }

      const missingArtifacts = missingRequiredArtifacts(expectation, receiptForSchedule);
      if (isBlockedReceipt(receiptForSchedule) || missingArtifacts.length > 0) {
        exceptions.push({
          code: isBlockedReceipt(receiptForSchedule) ? 'blocked_receipt' : 'required_artifact_missing',
          automation_id: expectation.automation_id,
          source_status: receiptForSchedule.source_status,
          evidence_state: receiptForSchedule.evidence_state,
          ...(missingArtifacts.length > 0 ? { missing_required_artifacts: missingArtifacts } : {}),
          finished_at: receiptForSchedule.finished_at,
          scheduled_at: scheduledAt.toISOString(),
          grace_deadline_at: graceDeadline.toISOString()
        });
      }
    }

    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    return exceptions
      .map((item) => ({ item, overdueMs: exceptionOverdueMs(item, current) }))
      .sort((left, right) => (this.priority[String(left.item.code)] ?? Number.MAX_SAFE_INTEGER)
        - (this.priority[String(right.item.code)] ?? Number.MAX_SAFE_INTEGER)
        || right.overdueMs - left.overdueMs
        || String(left.item.automation_id || left.item.event_id || '')
          .localeCompare(String(right.item.automation_id || right.item.event_id || '')))
      .slice(0, safeLimit)
      .map(({ item }) => item);
  }
}

export function createRoutineLivenessRuntime(
  options: RoutineLivenessRuntimeOptions
): RoutineLivenessRuntime {
  return new RoutineLivenessRuntime(options);
}
