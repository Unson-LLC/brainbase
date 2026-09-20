export const CANONICAL_TASK_STATUSES = [
  'pending',
  'in_progress',
  'waiting',
  'completed',
  'cancelled',
] as const;

export type CanonicalTaskStatus = typeof CANONICAL_TASK_STATUSES[number];

export const CANONICAL_TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type CanonicalTaskPriority = typeof CANONICAL_TASK_PRIORITIES[number];

const STATUS_SET = new Set<string>(CANONICAL_TASK_STATUSES);
const PRIORITY_SET = new Set<string>(CANONICAL_TASK_PRIORITIES);

const TRANSITIONS: Readonly<Record<CanonicalTaskStatus, ReadonlySet<CanonicalTaskStatus>>> =
  Object.freeze({
    pending: new Set<CanonicalTaskStatus>(['in_progress', 'waiting', 'completed', 'cancelled']),
    in_progress: new Set<CanonicalTaskStatus>(['waiting', 'completed', 'cancelled']),
    waiting: new Set<CanonicalTaskStatus>(['in_progress', 'completed', 'cancelled']),
    completed: new Set<CanonicalTaskStatus>(),
    cancelled: new Set<CanonicalTaskStatus>(['pending']),
  });

export function isCanonicalTaskStatus(value: unknown): value is CanonicalTaskStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

export function isCanonicalTaskPriority(value: unknown): value is CanonicalTaskPriority {
  return typeof value === 'string' && PRIORITY_SET.has(value);
}

export function normalizeCanonicalTaskProjectCodes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return [...new Set(values.flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean))];
}

export function hasInvalidCanonicalTaskProjectCode(value: unknown): boolean {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return values.some((item) => typeof item !== 'string'
    || item.split(',').some((code) => !code.trim() || code.trim().length > 100));
}

export function canTransitionCanonicalTaskStatus(from: unknown, to: unknown): boolean {
  return isCanonicalTaskStatus(from)
    && isCanonicalTaskStatus(to)
    && TRANSITIONS[from].has(to);
}
