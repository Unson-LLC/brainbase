import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
    Tool,
    CallToolResult,
    ServerRequest,
    ServerNotification,
} from '@modelcontextprotocol/sdk/types.js';
import type { LocalMcpRuntimeTool } from './mcp-runtime.js';
export const QUEUE_TASK_TOOLS_CONTRACT_VERSION = 'queue_task_tools.v1' as const;
export const QUEUE_TASK_TOOL_NAMES = [
    'list_my_tasks',
    'get_task',
    'claim_task',
    'claim_next',
    'renew_claim',
    'attach_evidence',
    'update_status',
] as const; // AC-1 / AC-9 はこの順序で assert する
export type QueueTaskToolName = (typeof QUEUE_TASK_TOOL_NAMES)[number];
export type QueueTaskStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
export type QueueTargetStatus = 'started' | 'waiting_for_review' | 'blocked' | 'done';
export type QueueEvidenceKind = 'pull_request' | 'ci' | 'production_readback';
export interface QueueAgentContext {
    readonly kind: 'agent'; // person principal とは別物だと明示する。canonical-task-principal は変えない
    readonly agentId: string; // host が認証した agent 自身。空や空白だけなら拒否する
    readonly credential: unknown; // agent 専用の資格情報。host が持つ不透明な値。null / undefined / '' なら task_auth_unavailable
}
export type QueueAgentResolver = (
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => QueueAgentContext | null | Promise<QueueAgentContext | null>;
// null を返す、throw する、shape が不正 → unavailable / task_auth_unavailable。backend は呼ばない
type ResolvedKey = {
    readonly idempotency_key: string;
}; // 解決済み（明示されたキー、または `mcp:<opaque>`）
export interface QueueListInput {
    statuses?: QueueTaskStatus[];
    limit?: number;
    cursor?: string;
}
export interface QueueGetInput {
    task_id: string;
}
export type QueueClaimInput = (
    | {
          mode: 'next';
      }
    | {
          mode: 'by_id';
          task_id: string;
      }
) &
    ResolvedKey;
export interface QueueRenewInput extends ResolvedKey {
    task_id: string;
}
export interface QueueEvidenceInput extends ResolvedKey {
    task_id: string;
    expected_version: number;
    kind: QueueEvidenceKind;
    ref: Record<string, unknown>;
}
export interface QueueStatusInput extends ResolvedKey {
    task_id: string;
    expected_version: number;
    to_status: QueueTargetStatus;
    waiting_on?: string;
}
export interface QueueTask {
    id: string;
    version: number;
    status: QueueTaskStatus;
    [field: string]: unknown;
}
export interface QueueTaskPage {
    items: QueueTask[];
    next_cursor: string | null;
    [field: string]: unknown;
}
export interface QueueTaskRead {
    task: QueueTask;
    [field: string]: unknown;
}
export type QueueClaimResult =
    | {
          status: 'claimed';
          task: QueueTask;
          claimed_until: string;
          replayed?: boolean;
          renew_interval_minutes?: number;
          [field: string]: unknown;
      }
    | {
          status: 'no_claimable_task';
          [field: string]: unknown;
      };
export interface QueueRenewResult {
    task: QueueTask;
    claimed_until: string;
    [field: string]: unknown;
}
export type QueueWriteOutcome = 'not_sent' | 'unknown';
export interface QueueTaskError {
    code: string; // 公開側が出す code は §3.5。backend の code は文字列のまま保持する
    message: string;
    http_status?: number;
    details?: Record<string, unknown>; // write の unavailable では details.outcome が必須
}
export type QueueTaskResult<T> =
    | {
          status: 'ok';
          queue: T;
      }
    | {
          status: 'error';
          error: QueueTaskError;
      }
    | {
          status: 'unavailable';
          error: QueueTaskError;
      };
export interface QueueTaskBackend {
    list(context: QueueAgentContext, input: QueueListInput): Promise<QueueTaskResult<QueueTaskPage>>;
    get(context: QueueAgentContext, input: QueueGetInput): Promise<QueueTaskResult<QueueTaskRead>>;
    claim(context: QueueAgentContext, input: QueueClaimInput): Promise<QueueTaskResult<QueueClaimResult>>;
    renew(context: QueueAgentContext, input: QueueRenewInput): Promise<QueueTaskResult<QueueRenewResult>>;
    evidence(context: QueueAgentContext, input: QueueEvidenceInput): Promise<QueueTaskResult<QueueTaskRead>>;
    status(context: QueueAgentContext, input: QueueStatusInput): Promise<QueueTaskResult<QueueTaskRead>>;
}
export interface CreateQueueTaskToolsOptions {
    backend?: QueueTaskBackend;
    resolveAgent?: QueueAgentResolver;
    generateKey?: () => string;
}
export class QueueTaskToolsConfigError extends Error {
    readonly code = 'queue_task_tools_config_invalid';
}
const statuses = ['pending', 'in_progress', 'waiting', 'completed', 'cancelled'] as const;
const targets = ['started', 'waiting_for_review', 'blocked', 'done'] as const;
const kinds = ['pull_request', 'ci', 'production_readback'] as const;
const text = (max: number) => z.string().refine((s) => !!s.trim() && [...s].length <= max);
const key = z
    .string()
    .refine((s) => !!s.trim() && !/^(api:|workflow:)/.test(s))
    .optional();
const task_id = text(256);
const expected_version = z.number().int().min(1);
const str = { type: 'string' };
const id = { ...str, minLength: 1, maxLength: 256 };
const version = { type: 'integer', minimum: 1 };
interface ToolConfig {
    schema: z.ZodType;
    properties: Record<string, object>;
    required: string[];
    write: boolean;
    description: string;
    execute(backend: QueueTaskBackend, context: QueueAgentContext, input: any): Promise<unknown>;
}
const toolConfigs: Record<QueueTaskToolName, ToolConfig> = {
    list_my_tasks: {
        schema: z.strictObject({
            statuses: z.array(z.enum(statuses)).optional(),
            limit: z.number().int().min(1).max(50).optional(),
            cursor: z.string().optional(),
        }),
        properties: {
            statuses: { type: 'array', items: { type: 'string', enum: statuses } },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
            cursor: str,
        },
        required: [],
        write: false,
        description: 'List tasks visible to the authenticated agent.',
        execute: (backend, context, input) => backend.list(context, input),
    },
    get_task: {
        schema: z.strictObject({ task_id }),
        properties: { task_id: id },
        required: ['task_id'],
        write: false,
        description: 'Read a task visible to the authenticated agent.',
        execute: (backend, context, input) => backend.get(context, input),
    },
    claim_task: {
        schema: z.strictObject({ task_id, idempotency_key: key }),
        properties: { task_id: id, idempotency_key: str },
        required: ['task_id'],
        write: true,
        description:
            'Claim a task by id. Supply and reuse an explicit idempotency_key when retrying the same operation.',
        execute: (backend, context, input) => backend.claim(context, { ...input, mode: 'by_id' }),
    },
    claim_next: {
        schema: z.strictObject({ idempotency_key: key }),
        properties: { idempotency_key: str },
        required: [],
        write: true,
        description:
            'Claim the next available task. Supply and reuse an explicit idempotency_key when retrying the same operation.',
        execute: (backend, context, input) => backend.claim(context, { ...input, mode: 'next' }),
    },
    renew_claim: {
        schema: z.strictObject({ task_id, idempotency_key: key }),
        properties: { task_id: id, idempotency_key: str },
        required: ['task_id'],
        write: true,
        description:
            'Renew an existing claim. Supply and reuse an explicit idempotency_key when retrying the same operation.',
        execute: (backend, context, input) => backend.renew(context, input),
    },
    attach_evidence: {
        schema: z.strictObject({
            task_id,
            expected_version,
            kind: z.enum(kinds),
            ref: z.record(z.string(), z.unknown()),
            idempotency_key: key,
        }),
        properties: {
            task_id: id,
            expected_version: version,
            kind: { type: 'string', enum: kinds },
            ref: { type: 'object' },
            idempotency_key: str,
        },
        required: ['task_id', 'expected_version', 'kind', 'ref'],
        write: true,
        description:
            'Attach evidence to a claimed task. Supply and reuse an explicit idempotency_key when retrying the same operation.',
        execute: (backend, context, input) => backend.evidence(context, input),
    },
    update_status: {
        schema: z
            .strictObject({
                task_id,
                expected_version,
                to_status: z.enum(targets),
                waiting_on: text(2000).optional(),
                idempotency_key: key,
            })
            .refine((x) => (x.to_status === 'blocked') === (x.waiting_on !== undefined)),
        properties: {
            task_id: id,
            expected_version: version,
            to_status: { type: 'string', enum: targets },
            waiting_on: { ...str, minLength: 1, maxLength: 2000 },
            idempotency_key: str,
        },
        required: ['task_id', 'expected_version', 'to_status'],
        write: true,
        description:
            'Update task status; close with to_status done. Supply and reuse an explicit idempotency_key when retrying the same operation.',
        execute: (backend, context, input) => backend.status(context, input),
    },
};
export const queueTaskToolDefinitions: readonly Tool[] = QUEUE_TASK_TOOL_NAMES.map((name) => {
    const config = toolConfigs[name];
    return {
        name,
        description: config.description,
        inputSchema: {
            type: 'object',
            properties: config.properties,
            required: config.required,
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: !config.write,
            destructiveHint: config.write,
            idempotentHint: !config.write,
            openWorldHint: true,
        },
    };
});
const object = (v: unknown): v is Record<string, any> =>
    !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const nonempty = (v: unknown) => typeof v === 'string' && !!v.trim();
const task = (v: unknown) =>
    object(v) &&
    nonempty(v.id) &&
    Number.isInteger(v.version) &&
    v.version >= 1 &&
    statuses.includes(v.status);
// Public proposed minimum shape; actual API responses remain unverified.
function isJson(value: unknown, ancestors = new Set<unknown>()): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if ((!Array.isArray(value) && !object(value)) || ancestors.has(value)) return false;
    ancestors.add(value);
    const result = Object.values(value).every((child) => isJson(child, ancestors));
    ancestors.delete(value);
    return result;
}
function valid(v: unknown, name: QueueTaskToolName): boolean {
    if (!object(v) || !isJson(v)) return false;
    if (v.status === 'error' || v.status === 'unavailable')
        return (
            object(v.error) &&
            nonempty(v.error.code) &&
            typeof v.error.message === 'string' &&
            (v.error.http_status === undefined || Number.isInteger(v.error.http_status)) &&
            (v.error.details === undefined || object(v.error.details)) &&
            (v.status !== 'unavailable' ||
                ['task_api_unavailable', 'task_auth_unavailable'].includes(v.error.code)) &&
            !(
                toolConfigs[name].write &&
                v.status === 'unavailable' &&
                !['not_sent', 'unknown'].includes(v.error.details?.outcome)
            )
        );
    if (v.status !== 'ok' || !object(v.queue)) return false;
    const q = v.queue;
    if (name === 'list_my_tasks')
        return (
            Array.isArray(q.items) &&
            q.items.every(task) &&
            (q.next_cursor === null || typeof q.next_cursor === 'string')
        );
    if (name === 'claim_task' || name === 'claim_next')
        return (
            q.status === 'no_claimable_task' ||
            (q.status === 'claimed' &&
                task(q.task) &&
                nonempty(q.claimed_until) &&
                (q.replayed === undefined || typeof q.replayed === 'boolean') &&
                (q.renew_interval_minutes === undefined ||
                    (typeof q.renew_interval_minutes === 'number' &&
                        Number.isFinite(q.renew_interval_minutes) &&
                        q.renew_interval_minutes > 0)))
        );
    return task(q.task) && (name !== 'renew_claim' || nonempty(q.claimed_until));
}
function failure(
    status: 'error' | 'unavailable',
    code: string,
    write = false,
    outcome: QueueWriteOutcome = 'unknown',
): QueueTaskResult<never> {
    return { status, error: { code, message: code, ...(write ? { details: { outcome } } : {}) } };
}
function encode(result: QueueTaskResult<unknown>): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        ...(result.status === 'ok' ? {} : { isError: true }),
    };
}
export function createQueueTaskTools(options: CreateQueueTaskToolsOptions): readonly LocalMcpRuntimeTool[] {
    const backend = options.backend;
    if (!backend) return [];
    if (typeof options.resolveAgent !== 'function')
        throw new QueueTaskToolsConfigError('Agent resolver required');
    return queueTaskToolDefinitions.map((definition) => {
        const name = definition.name as QueueTaskToolName;
        const config = toolConfigs[name];
        return {
            definition: structuredClone(definition),
            handler: async (args, extra) => {
                const parsed = config.schema.safeParse(args);
                if (!parsed.success) return encode(failure('error', 'task_input_invalid'));
                let context: QueueAgentContext | null;
                try {
                    context = await options.resolveAgent!(extra);
                } catch {
                    context = null;
                }
                if (
                    !context ||
                    context.kind !== 'agent' ||
                    !nonempty(context.agentId) ||
                    context.credential === null ||
                    context.credential === undefined ||
                    (typeof context.credential === 'string' && !context.credential.trim())
                )
                    return encode(failure('unavailable', 'task_auth_unavailable'));
                const input: any = { ...(parsed.data as Record<string, unknown>) };
                if (config.write && input.idempotency_key === undefined) {
                    try {
                        const opaque = (options.generateKey ?? randomUUID)();
                        if (typeof opaque !== 'string' || !/^[A-Za-z0-9_-]+$/.test(opaque)) throw new Error();
                        input.idempotency_key = `mcp:${opaque}`;
                    } catch {
                        return encode(failure('error', 'task_contract_error', true, 'not_sent'));
                    }
                }
                let result: unknown;
                try {
                    result = await config.execute(backend, context, input);
                } catch {
                    return encode(failure('unavailable', 'task_api_unavailable', config.write));
                }
                try {
                    if (
                        valid(result, name) &&
                        !(
                            typeof context.credential === 'string' &&
                            JSON.stringify(result).includes(JSON.stringify(context.credential).slice(1, -1))
                        )
                    )
                        return encode(result as QueueTaskResult<unknown>);
                } catch {
                    /* malformed/non-JSON result */
                }
                return encode(failure('error', 'task_contract_error', config.write));
            },
        };
    });
}
