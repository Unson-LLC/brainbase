// This is a contract-test fixture, not a persistent queue.
import type { QueueTaskBackend, QueueTask } from '../queue-task-tools.js';
export const QUEUE_REFERENCE_CODES = Object.fromEntries(['agent_scope_denied', 'task_not_found', 'claim_not_held', 'version_conflict', 'completion_gate_unmet', 'task_already_completed', 'idempotency_conflict'].map(x => [x, x])) as Record<'agent_scope_denied' | 'task_not_found' | 'claim_not_held' | 'version_conflict' | 'completion_gate_unmet' | 'task_already_completed' | 'idempotency_conflict', string>;
export interface QueueReferenceState {
    tasks: (QueueTask & {
        assignee: string;
        title: string;
    })[];
    assignable: Record<string, string[]>;
    claims: Record<string, {
        agent: string;
        claimed_until: string;
    }>;
    evidence: {
        task_id: string;
        kind: string;
        ref: Record<string, unknown>;
    }[];
    completions: string[];
    audit: string[];
    calls: {
        operation: string;
        agentId: string;
        input: Record<string, any>;
    }[];
    operations: Record<string, {
        fingerprint: string;
        result: any;
        task_id?: string;
    }>;
    scripted: {
        at: number;
        type: 'result' | 'throw' | 'reject' | 'malformed';
        result?: unknown;
    }[];
}
export function createQueueReferenceSeed(): QueueReferenceState {
    return { tasks: [1, 2, 3, 4].map(n => ({ id: `t${n}`, version: 1, status: 'pending', assignee: n === 4 ? 'B' : 'A', title: `synthetic-task-${n}` })), assignable: {}, claims: {}, evidence: [], completions: [], audit: [], calls: [], operations: {}, scripted: [] };
}
const canonical = (v: any): string => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map(x => JSON.parse(canonical(x))) : Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(canonical(v[k]))])) : v);
export function createQueueReferenceBackend(initial: QueueReferenceState, options: {
    onChange?: (state: QueueReferenceState) => void;
} = {}): QueueTaskBackend & {
    snapshot(): QueueReferenceState;
} {
    const state = structuredClone(initial);
    const snapshot = () => structuredClone(state);
    const notify = () => options.onChange?.(snapshot());
    const error = (code: string): any => ({ status: 'error', error: { code, message: code } });
    const ok = (queue: any): any => ({ status: 'ok', queue: structuredClone(queue) });
    const visible = (t: QueueTask & {
        assignee: string;
    }, a: string) => t.assignee === a || state.assignable[t.id]?.includes(a);
    async function execute(operation: string, context: {
        agentId: string;
    }, input: any): Promise<any> {
        const agent = context.agentId;
        state.calls.push({ operation, agentId: agent, input: structuredClone(input) });
        try {
            const script = state.scripted.find(x => x.at === state.calls.length);
            if (script) {
                if (script.type === 'throw' || script.type === 'reject')
                    throw new Error('exception-sentinel');
                return structuredClone(script.result);
            }
            if (operation === 'list') {
                const items = state.tasks.filter(t => visible(t, agent) && (!input.statuses || input.statuses.includes(t.status)));
                const offset = input.cursor ? Number(input.cursor.slice('page/opaque:'.length)) : 0;
                const limit = input.limit ?? 50;
                return ok({ items: items.slice(offset, offset + limit), next_cursor: offset + limit < items.length ? `page/opaque:${offset + limit}` : null });
            }
            const namespace = JSON.stringify([agent, input.idempotency_key]);
            const fingerprint = canonical({ operation, input });
            const prior = input.idempotency_key ? state.operations[namespace] : undefined;
            if (prior && prior.fingerprint !== fingerprint)
                return error(QUEUE_REFERENCE_CODES.idempotency_conflict);
            let taskId = input.task_id ?? prior?.task_id;
            if (operation === 'claim' && input.mode === 'next' && !taskId)
                taskId = state.tasks.find(t => visible(t, agent) && !state.claims[t.id] && t.status !== 'completed')?.id;
            if (operation === 'claim' && !taskId)
                return ok({ status: 'no_claimable_task' });
            const t = state.tasks.find(t => t.id === taskId);
            if (!t)
                return error(QUEUE_REFERENCE_CODES.task_not_found);
            if (!visible(t, agent))
                return error(QUEUE_REFERENCE_CODES.agent_scope_denied);
            if (operation === 'get')
                return ok({ task: t });
            const claim = state.claims[t.id];
            if (operation !== 'claim' && (!claim || claim.agent !== agent || Date.parse(claim.claimed_until) <= Date.parse('2026-01-01T00:00:00Z')))
                return error(QUEUE_REFERENCE_CODES.claim_not_held);
            if (operation === 'claim' && claim && claim.agent !== agent)
                return error(QUEUE_REFERENCE_CODES.claim_not_held);
            if (prior) {
                if (operation === 'claim' && (!claim || Date.parse(claim.claimed_until) <= Date.parse('2026-01-01T00:00:00Z')))
                    return error(QUEUE_REFERENCE_CODES.claim_not_held);
                const result = structuredClone(prior.result);
                if (operation === 'claim')
                    result.queue.replayed = true;
                return result;
            }
            let result: any;
            if (operation === 'claim') {
                if (t.status === 'completed')
                    return error(QUEUE_REFERENCE_CODES.task_already_completed);
                state.claims[t.id] = { agent, claimed_until: '2026-01-01T00:30:00.000Z' };
                result = ok({ status: 'claimed', task: t, claimed_until: state.claims[t.id].claimed_until, replayed: false, renew_interval_minutes: 10 });
            }
            else if (operation === 'renew') {
                claim.claimed_until = new Date(Date.parse(claim.claimed_until) + 600000).toISOString();
                result = ok({ task: t, claimed_until: claim.claimed_until });
            }
            else {
                if (t.status === 'completed')
                    return error(QUEUE_REFERENCE_CODES.task_already_completed);
                if (input.expected_version !== t.version)
                    return error(QUEUE_REFERENCE_CODES.version_conflict);
                if (operation === 'evidence')
                    state.evidence.push({ task_id: t.id, kind: input.kind, ref: structuredClone(input.ref) });
                else {
                    if (input.to_status === 'done' && !state.evidence.some(e => e.task_id === t.id))
                        return error(QUEUE_REFERENCE_CODES.completion_gate_unmet);
                    t.status = input.to_status === 'done' ? 'completed' : input.to_status === 'started' ? 'in_progress' : 'waiting';
                    if (t.status === 'completed') {
                        state.completions.push(t.id);
                        state.audit.push(t.id);
                    }
                }
                t.version++;
                result = ok({ task: t });
            }
            state.operations[namespace] = { fingerprint, result: structuredClone(result), task_id: t.id };
            return result;
        }
        finally {
            notify();
        }
    }
    return { snapshot, ...Object.fromEntries(['list', 'get', 'claim', 'renew', 'evidence', 'status'].map(op => [op, (context: any, input: any) => execute(op, context, input)])) } as QueueTaskBackend & {
        snapshot(): QueueReferenceState;
    };
}
