import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Canonical Task mutation tools.
 *
 * Thin client over the companion task API (/api/companion/tasks) on the
 * Canonical Task store (Lightsail). Business rules (validation, versioning,
 * transitions) live server-side; this module only shapes requests and
 * preserves structured error states.
 *
 * Delete is intentionally NOT exposed: desk agents may create, update, and
 * transition tasks but never destroy them.
 */

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TaskToolDependencies {
  /** Canonical Task API base URL (e.g. https://bb.unson.jp) */
  apiUrl: string;
  /** bbsvc_ service token for the companion task API. Missing token → unavailable. */
  token?: string;
  fetch?: FetchLike;
  requestId?: () => string;
}

export interface TaskToolResult {
  status: 'ok' | 'unavailable' | 'error';
  task?: Record<string, unknown>;
  error?: { code: string; message: string; http_status?: number; details?: unknown };
}

const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const TASK_TRANSITION_STATUSES = new Set(['pending', 'in_progress', 'waiting', 'completed']);
const RESERVED_IDEMPOTENCY_PREFIXES = ['api:', 'workflow:'];

export const taskTools: Tool[] = [
  {
    name: 'create_task',
    description:
      'Create a Canonical Task in the Brainbase task store via the companion task API. '
      + 'This is the canonical write path for desk agents; do not mint tokens or call the API directly. '
      + 'Assignee resolution is server-side and intentionally not exposed here. Deletion is not available.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title (required, max 200 chars).' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_at: { type: 'string', description: 'Due date-time in ISO 8601 format.' },
        source_refs: {
          type: 'array',
          items: { type: 'object' },
          description: 'Optional source reference objects linking the task to its origin.',
        },
        idempotency_key: {
          type: 'string',
          description:
            'Optional idempotency key. Reuse the same key to make the create retry-safe. '
            + 'Prefixes "api:" and "workflow:" are reserved and rejected. Defaults to a generated mcp: key.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description:
      'Update fields (title, description, priority, due_at) of an existing Canonical Task. '
      + 'Requires expected_version for optimistic concurrency; a version conflict returns a structured error. '
      + 'Status changes must use transition_task instead.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Canonical Task ID (ct1....).' },
        expected_version: { type: 'integer', minimum: 1 },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_at: { type: 'string', description: 'Due date-time in ISO 8601 format.' },
        idempotency_key: { type: 'string', description: 'Optional idempotency key ("api:"/"workflow:" prefixes reserved).' },
      },
      required: ['task_id', 'expected_version'],
    },
  },
  {
    name: 'transition_task',
    description:
      'Transition a Canonical Task to pending, in_progress, waiting, or completed. '
      + 'Requires expected_version for optimistic concurrency. waiting_on / review_at annotate waiting states. '
      + 'There is no delete transition and no delete tool.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Canonical Task ID (ct1....).' },
        expected_version: { type: 'integer', minimum: 1 },
        to_status: { type: 'string', enum: ['pending', 'in_progress', 'waiting', 'completed'] },
        waiting_on: { type: 'string' },
        review_at: { type: 'string', description: 'Review date-time in ISO 8601 format.' },
        idempotency_key: { type: 'string', description: 'Optional idempotency key ("api:"/"workflow:" prefixes reserved).' },
      },
      required: ['task_id', 'expected_version', 'to_status'],
    },
  },
];

function optionalString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (value === null) throw new Error(`${key} is required`);
  return value;
}

function optionalEnum(args: Record<string, unknown>, key: string, allowed: Set<string>): string | null {
  const value = optionalString(args, key);
  if (value === null) return null;
  if (!allowed.has(value)) {
    throw new Error(`${key} must be one of: ${[...allowed].join(', ')}`);
  }
  return value;
}

function requiredVersion(args: Record<string, unknown>): number {
  const value = args.expected_version;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('expected_version must be a positive integer');
  }
  return value;
}

function idempotencyKey(args: Record<string, unknown>, dependencies: TaskToolDependencies): string {
  const provided = optionalString(args, 'idempotency_key');
  if (provided !== null) {
    const reserved = RESERVED_IDEMPOTENCY_PREFIXES.find((prefix) => provided.startsWith(prefix));
    if (reserved) {
      throw new Error(`idempotency_key must not use the reserved prefix "${reserved}"`);
    }
    return provided;
  }
  return `mcp:${dependencies.requestId?.() || globalThis.crypto.randomUUID()}`;
}

interface TaskRequest {
  path: string;
  body: Record<string, unknown>;
}

function createTaskRequest(args: Record<string, unknown>): TaskRequest {
  const title = requiredString(args, 'title');
  if (title.length > 200) throw new Error('title must be 200 characters or less');
  const description = optionalString(args, 'description');
  const priority = optionalEnum(args, 'priority', TASK_PRIORITIES);
  const dueAt = optionalString(args, 'due_at');
  const sourceRefs = args.source_refs;
  if (
    sourceRefs !== undefined
    && (!Array.isArray(sourceRefs) || sourceRefs.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))
  ) {
    throw new Error('source_refs must be an array of objects');
  }
  return {
    path: '/api/companion/tasks',
    body: {
      title,
      ...(description ? { description } : {}),
      ...(priority ? { priority } : {}),
      ...(dueAt ? { due_at: dueAt } : {}),
      ...(sourceRefs ? { source_refs: sourceRefs } : {}),
    },
  };
}

function updateTaskRequest(args: Record<string, unknown>): TaskRequest {
  const taskId = requiredString(args, 'task_id');
  const expectedVersion = requiredVersion(args);
  const title = optionalString(args, 'title');
  if (title !== null && title.length > 200) throw new Error('title must be 200 characters or less');
  const description = optionalString(args, 'description');
  const priority = optionalEnum(args, 'priority', TASK_PRIORITIES);
  const dueAt = optionalString(args, 'due_at');
  if (title === null && description === null && priority === null && dueAt === null) {
    throw new Error('update_task requires at least one of: title, description, priority, due_at');
  }
  return {
    path: `/api/companion/tasks/${encodeURIComponent(taskId)}`,
    body: {
      expected_version: expectedVersion,
      ...(title !== null ? { title } : {}),
      ...(description !== null ? { description } : {}),
      ...(priority !== null ? { priority } : {}),
      ...(dueAt !== null ? { due_at: dueAt } : {}),
    },
  };
}

function transitionTaskRequest(args: Record<string, unknown>): TaskRequest {
  const taskId = requiredString(args, 'task_id');
  const expectedVersion = requiredVersion(args);
  const toStatus = optionalEnum(args, 'to_status', TASK_TRANSITION_STATUSES);
  if (!toStatus) throw new Error('to_status is required');
  const waitingOn = optionalString(args, 'waiting_on');
  const reviewAt = optionalString(args, 'review_at');
  return {
    path: `/api/companion/tasks/${encodeURIComponent(taskId)}/transitions`,
    body: {
      expected_version: expectedVersion,
      to_status: toStatus,
      ...(waitingOn ? { waiting_on: waitingOn } : {}),
      ...(reviewAt ? { review_at: reviewAt } : {}),
    },
  };
}

export async function handleTaskToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: TaskToolDependencies,
): Promise<TaskToolResult | null> {
  if (name !== 'create_task' && name !== 'update_task' && name !== 'transition_task') {
    return null;
  }

  const token = dependencies.token?.trim();
  if (!token) {
    return {
      status: 'unavailable',
      error: {
        code: 'task_store_not_configured',
        message: 'Canonical Task API token is not configured (BRAINBASE_TASK_API_TOKEN)',
      },
    };
  }

  let request: TaskRequest;
  let method: string;
  let key: string;
  try {
    key = idempotencyKey(args, dependencies);
    if (name === 'create_task') {
      request = createTaskRequest(args);
      method = 'POST';
    } else if (name === 'update_task') {
      request = updateTaskRequest(args);
      method = 'PATCH';
    } else {
      request = transitionTaskRequest(args);
      method = 'POST';
    }
  } catch (error) {
    return {
      status: 'error',
      error: {
        code: 'task_input_invalid',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const url = `${dependencies.apiUrl.replace(/\/+$/, '')}${request.path}`;
  let response: Response;
  try {
    response = await (dependencies.fetch || globalThis.fetch)(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    return {
      status: 'unavailable',
      error: {
        code: 'task_api_unavailable',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  let payload: unknown = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = payload as { code?: string; message?: string } | null;
    const unavailable = response.status >= 500;
    return {
      status: unavailable ? 'unavailable' : 'error',
      error: {
        code: body?.code || (unavailable ? 'task_api_unavailable' : 'task_api_error'),
        message: body?.message || `${response.status} ${response.statusText}`.trim(),
        http_status: response.status,
        ...(payload !== null ? { details: payload } : {}),
      },
    };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      status: 'error',
      error: {
        code: 'task_contract_error',
        message: 'Expected a Canonical Task object response',
      },
    };
  }

  return { status: 'ok', task: payload as Record<string, unknown> };
}
