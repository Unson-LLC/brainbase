import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { queueTaskToolDefinitions, QUEUE_TASK_TOOL_NAMES } from '../queue-task-tools.js';
import {
    createQueueReferenceSeed,
    QUEUE_REFERENCE_CODES as C,
    type QueueReferenceState,
} from './queue-task-reference-backend.js';
export const QUEUE_TASK_CONTRACT_SCENARIO_NAMES = [
    'AC-2 reads only visible tasks and forwards opaque cursors one page per call',
    'AC-2 reads an approved task by id',
    'AC-3 binds every call and replay to the authenticated agent',
    'AC-4 claims next and renews without duplicate claims',
    'AC-4 claims an approved task by id without duplicates',
    'AC-5 attaches evidence once for the same operation',
    'AC-6 completes through queue status without bypassing gates',
    'AC-7 validates inputs before calling the queue backend',
    'AC-8 preserves structured failures without leaking credentials',
    'AC-9 advertises conservative queue tool annotations',
] as const;
export interface QueueTaskContractAssert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
}
export interface QueueTaskContractConnectOptions {
    agent: {
        agentId: string;
        credential: string;
    } | null; // null は「agent の資格情報が無い host」
    sharedServiceToken?: string; // host に共有 token があっても使われないことを AC-3 で見る
    state: QueueReferenceState; // seed、または前の snapshot（agent を切り替えるため）
    generatedKeys?: string[]; // generateKey の決まった列（AC-10 で比較するため）
}
export interface QueueTaskContractConnection {
    listTools(): Promise<Tool[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
    snapshot(): Promise<QueueReferenceState>; // tasks / claims / evidence / completions / calls / operations
    close(): Promise<void>;
}
export interface QueueTaskContractAdapter {
    readonly transport: string;
    connect(options: QueueTaskContractConnectOptions): Promise<QueueTaskContractConnection>;
}
export interface QueueTaskContractTranscript {
    scenario: string;
    steps: unknown[];
} // 正規化した結果と状態差分
export {
    createQueueReferenceBackend,
    createQueueReferenceSeed,
    QUEUE_REFERENCE_CODES,
    type QueueReferenceState,
} from './queue-task-reference-backend.js';
export async function runQueueTaskContractScenario(
    name: (typeof QUEUE_TASK_CONTRACT_SCENARIO_NAMES)[number],
    adapter: QueueTaskContractAdapter,
    assert: QueueTaskContractAssert,
): Promise<QueueTaskContractTranscript> {
    const steps: unknown[] = [];
    const connections: QueueTaskContractConnection[] = [];
    async function connect(
        state = createQueueReferenceSeed(),
        agent: QueueTaskContractConnectOptions['agent'] = { agentId: 'A', credential: 'credential-sentinel' },
        generatedKeys = ['generated-1', 'generated-2', 'generated-3', 'generated-4'],
    ) {
        const c = await adapter.connect({
            state,
            agent,
            sharedServiceToken: 'shared-sentinel',
            generatedKeys,
        });
        connections.push(c);
        return c;
    }
    async function call(
        c: QueueTaskContractConnection,
        n: string,
        args: Record<string, unknown>,
        code?: string,
    ) {
        const r = await c.callTool(n, args);
        assert.equal(r.content[0].type, 'text');
        assert.equal(r.structuredContent, undefined);
        const text = (
            r.content[0] as {
                text: string;
            }
        ).text;
        assert.ok(!text.includes('credential-sentinel'));
        assert.ok(!text.includes('exception-sentinel'));
        assert.ok(!text.includes('shared-sentinel'));
        const v = JSON.parse(text);
        assert.equal(!!r.isError, v.status !== 'ok');
        if (code) assert.equal(v.error?.code, code);
        else assert.equal(v.status, 'ok');
        steps.push(v);
        return v.queue;
    }
    try {
        const c = await connect();
        const index = QUEUE_TASK_CONTRACT_SCENARIO_NAMES.indexOf(name);
        if (index === 0) {
            const p = await call(c, 'list_my_tasks', { limit: 2 });
            assert.equal(p.items.length, 2);
            assert.ok(p.next_cursor);
            const q = await call(c, 'list_my_tasks', { cursor: p.next_cursor, limit: 2 });
            assert.equal(q.items.length, 1);
            assert.equal(q.next_cursor, null);
            await call(c, 'list_my_tasks', { statuses: ['pending'] });
            const s = await c.snapshot();
            assert.equal(s.calls.length, 3);
            assert.equal(s.calls[1].input.cursor, p.next_cursor);
            assert.ok(!JSON.stringify(steps).includes('synthetic-task-4'));
            const empty = await connect(s, { agentId: 'Z', credential: 'agent-credential-sentinel' });
            assert.deepEqual(await call(empty, 'list_my_tasks', {}), { items: [], next_cursor: null });
        } else if (index === 1) {
            const q = await call(c, 'get_task', { task_id: 't1' });
            assert.equal(q.task.title, 'synthetic-task-1');
            assert.equal(q.task.version, 1);
            await call(c, 'get_task', { task_id: 't4' }, C.agent_scope_denied);
            await call(c, 'get_task', { task_id: 'missing' }, C.task_not_found);
            for (const x of (await c.snapshot()).calls) {
                assert.equal(x.operation, 'get');
                assert.equal(x.agentId, 'A');
                assert.deepEqual(Object.keys(x.input), ['task_id']);
            }
        } else if (index === 2) {
            const args = [
                {},
                { task_id: 't1' },
                { task_id: 't1' },
                {},
                { task_id: 't1' },
                { task_id: 't1', expected_version: 1, kind: 'ci', ref: {} },
                { task_id: 't1', expected_version: 1, to_status: 'done' },
            ];
            for (const agent of [
                null,
                { agentId: 'A', credential: '' },
                { agentId: 'A', credential: '  ' },
            ]) {
                const x = await connect(createQueueReferenceSeed(), agent);
                for (let i = 0; i < 7; i++) {
                    await call(x, QUEUE_TASK_TOOL_NAMES[i], args[i], 'task_auth_unavailable');
                    if (i >= 2)
                        assert.deepEqual((steps.at(-1) as any).error.details, { outcome: 'not_sent' });
                }
                assert.equal((await x.snapshot()).calls.length, 0);
            }
            for (const field of ['agent_id', 'assignee', 'scope'])
                await call(c, 'claim_next', { [field]: '*' }, 'task_input_invalid');
            assert.equal((await c.snapshot()).calls.length, 0);
            await call(c, 'claim_next', { idempotency_key: 'k' });
            const s = await c.snapshot();
            assert.ok(s.calls.every((x) => x.agentId === 'A' && x.credentialMatchesAgent));
            const b = await connect(s, { agentId: 'B', credential: 'agent-credential-sentinel' });
            const q = await call(b, 'claim_next', { idempotency_key: 'k' });
            assert.equal(q.task.id, 't4');
            assert.ok((await b.snapshot()).calls.every((x) => x.credentialMatchesAgent));
            s.tasks.forEach((t) => {
                t.assignee = 'B';
            });
            const revoked = await connect(s);
            await call(revoked, 'claim_next', { idempotency_key: 'k' }, C.agent_scope_denied);
        } else if (index === 3 || index === 4) {
            const tool = index === 3 ? 'claim_next' : 'claim_task';
            const args = index === 3 ? { idempotency_key: 'k' } : { task_id: 't1', idempotency_key: 'k' };
            const q = await call(c, tool, args);
            assert.equal(q.replayed, false);
            assert.ok(q.claimed_until);
            assert.equal(q.renew_interval_minutes, 10);
            const replay = await call(c, tool, args);
            assert.equal(replay.task.id, q.task.id);
            assert.equal(replay.replayed, true);
            assert.equal(Object.keys((await c.snapshot()).claims).length, 1);
            if (index === 4) {
                assert.deepEqual((await c.snapshot()).calls[0].input, {
                    mode: 'by_id',
                    task_id: 't1',
                    idempotency_key: 'k',
                });
                await call(c, tool, { task_id: 't2', idempotency_key: 'k' }, C.idempotency_conflict);
                await call(c, tool, { task_id: 't4' }, C.agent_scope_denied);
                const s = await c.snapshot();
                s.claims.t2 = { agent: 'B', claimed_until: q.claimed_until };
                const x = await connect(s);
                await call(x, tool, { task_id: 't2' }, C.claim_not_held);
            } else {
                await call(c, tool, {});
                await call(c, tool, {});
                const s = await c.snapshot();
                assert.equal(s.calls[2].input.idempotency_key, 'mcp:generated-1');
                assert.equal(s.calls[3].input.idempotency_key, 'mcp:generated-2');
                assert.equal((await call(c, tool, {})).status, 'no_claimable_task');
                const renewed = await call(c, 'renew_claim', { task_id: 't1', idempotency_key: 'renew' });
                assert.ok(renewed.claimed_until > q.claimed_until);
                assert.equal((await c.snapshot()).claims.t1.claimed_until, renewed.claimed_until);
                await call(c, 'renew_claim', { task_id: 't4' }, C.agent_scope_denied);
                await call(
                    c,
                    'renew_claim',
                    { task_id: 't2', idempotency_key: 'renew' },
                    C.idempotency_conflict,
                );
                const competing = createQueueReferenceSeed();
                competing.claims.t1 = { agent: 'B', claimed_until: q.claimed_until };
                const competitor = await connect(competing);
                const next = await call(competitor, 'claim_next', {});
                assert.equal(next.task.id, 't2');
                assert.equal((await competitor.snapshot()).claims.t1.agent, 'B');
                const unclaimed = await connect();
                await call(unclaimed, 'renew_claim', { task_id: 't1' }, C.claim_not_held);
            }
        } else if (index === 5 || index === 6) {
            await call(c, 'claim_task', { task_id: 't1' });
            let version = 1;
            if (index === 6) {
                await call(c, 'update_status', {
                    task_id: 't1',
                    expected_version: version++,
                    to_status: 'started',
                    idempotency_key: 'start',
                });
                const before = (await c.snapshot()).calls.length;
                await call(
                    c,
                    'update_status',
                    { task_id: 't1', expected_version: version, to_status: 'blocked' },
                    'task_input_invalid',
                );
                assert.equal((await c.snapshot()).calls.length, before);
                await call(c, 'update_status', {
                    task_id: 't1',
                    expected_version: version++,
                    to_status: 'blocked',
                    waiting_on: 'synthetic dependency',
                });
                await call(
                    c,
                    'update_status',
                    { task_id: 't1', expected_version: version, to_status: 'done', waiting_on: 'x' },
                    'task_input_invalid',
                );
                await call(
                    c,
                    'update_status',
                    { task_id: 't1', expected_version: version, to_status: 'done' },
                    C.completion_gate_unmet,
                );
                await call(
                    c,
                    'update_status',
                    { task_id: 't1', expected_version: 1, to_status: 'started' },
                    C.version_conflict,
                );
            }
            for (const kind of ['pull_request', 'ci', 'production_readback']) {
                const args = {
                    task_id: 't1',
                    expected_version: version,
                    kind,
                    ref: { a: 1, b: 2 },
                    idempotency_key: `e-${kind}`,
                };
                const q = await call(c, 'attach_evidence', args);
                assert.equal(q.task.version, ++version);
                assert.deepEqual(await call(c, 'attach_evidence', { ...args, ref: { b: 2, a: 1 } }), q);
                await call(c, 'attach_evidence', { ...args, ref: { a: 2 } }, C.idempotency_conflict);
            }
            assert.equal((await c.snapshot()).evidence.length, 3);
            await call(
                c,
                'attach_evidence',
                { task_id: 't1', expected_version: 1, kind: 'ci', ref: {} },
                C.version_conflict,
            );
            await call(
                c,
                'attach_evidence',
                { task_id: 't2', expected_version: 1, kind: 'ci', ref: {} },
                C.claim_not_held,
            );
            if (index === 6) {
                const args = {
                    task_id: 't1',
                    expected_version: version,
                    to_status: 'done',
                    idempotency_key: 'done',
                };
                const q = await call(c, 'update_status', args);
                assert.equal(q.task.status, 'completed');
                assert.deepEqual(await call(c, 'update_status', args), q);
                await call(
                    c,
                    'update_status',
                    { ...args, idempotency_key: 'done-again' },
                    C.task_already_completed,
                );
                const s = await c.snapshot();
                assert.equal(s.completions.length, 1);
                assert.equal(s.audit.length, 1);
                assert.equal(s.tasks[0].version, version + 1);
            }
        } else if (index === 7) {
            const valid: Record<string, unknown>[] = [
                {},
                { task_id: 't1' },
                { task_id: 't1' },
                {},
                { task_id: 't1' },
                { task_id: 't1', expected_version: 1, kind: 'ci', ref: {} },
                { task_id: 't1', expected_version: 1, to_status: 'started' },
            ];
            for (let i = 0; i < 7; i++) {
                await call(c, QUEUE_TASK_TOOL_NAMES[i], { ...valid[i], unknown: true }, 'task_input_invalid');
                await call(c, QUEUE_TASK_TOOL_NAMES[i], { task_id: 7 }, 'task_input_invalid');
                if (i !== 0 && i !== 3) await call(c, QUEUE_TASK_TOOL_NAMES[i], {}, 'task_input_invalid');
            }
            for (let i = 0; i < 7; i++) {
                const required = queueTaskToolDefinitions[i].inputSchema.required ?? [];
                for (const field of required) {
                    const missing = { ...valid[i] };
                    delete missing[field];
                    await call(c, QUEUE_TASK_TOOL_NAMES[i], missing, 'task_input_invalid');
                    await call(
                        c,
                        QUEUE_TASK_TOOL_NAMES[i],
                        { ...valid[i], [field]: false },
                        'task_input_invalid',
                    );
                }
            }
            for (const task_id of ['', '   ', '😀'.repeat(257)])
                await call(c, 'get_task', { task_id }, 'task_input_invalid');
            for (const limit of [0, 51, 1.5]) await call(c, 'list_my_tasks', { limit }, 'task_input_invalid');
            await call(c, 'list_my_tasks', { statuses: ['unknown'] }, 'task_input_invalid');
            for (const expected_version of [0, -1, 1.2])
                await call(c, 'attach_evidence', { ...valid[5], expected_version }, 'task_input_invalid');
            for (const ref of [[], null, 'text'])
                await call(c, 'attach_evidence', { ...valid[5], ref }, 'task_input_invalid');
            await call(c, 'attach_evidence', { ...valid[5], kind: 'unknown' }, 'task_input_invalid');
            for (const waiting_on of [' ', 'x'.repeat(2001)])
                await call(
                    c,
                    'update_status',
                    { ...valid[6], to_status: 'blocked', waiting_on },
                    'task_input_invalid',
                );
            for (const idempotency_key of ['  ', 'api:x', 'workflow:x'])
                await call(c, 'claim_next', { idempotency_key }, 'task_input_invalid');
            assert.equal((await c.snapshot()).calls.length, 0);
            for (const task_id of ['😀'.repeat(256), 'a/b'])
                await call(c, 'get_task', { task_id }, C.task_not_found);
            for (const limit of [1, 50]) await call(c, 'list_my_tasks', { limit });
            await call(c, 'claim_task', { task_id: 't1' });
            await call(c, 'update_status', {
                ...valid[6],
                to_status: 'blocked',
                waiting_on: 'x'.repeat(2000),
            });
            const s = await c.snapshot();
            assert.equal(s.calls[0].input.task_id, '😀'.repeat(256));
            assert.equal(s.calls[1].input.task_id, 'a/b');
            assert.equal(s.calls[4].input.mode, 'by_id');
        } else if (index === 8) {
            const keyFailure = await connect(createQueueReferenceSeed(), undefined, ['invalid/key']);
            await call(keyFailure, 'claim_next', {}, 'task_contract_error');
            assert.deepEqual((steps.at(-1) as any).error.details, { outcome: 'not_sent' });
            assert.equal((await keyFailure.snapshot()).calls.length, 0);

            const cases: {
                tool: string;
                result?: unknown;
                type?: 'throw' | 'reject';
                code: string;
            }[] = [
                ...['get_task', 'claim_next'].flatMap((tool) => [
                    {
                        tool,
                        result: {
                            status: 'error',
                            error: {
                                code: 'synthetic_denied',
                                message: 'denied',
                                details: { body: { auth: 'credential-sentinel' } },
                            },
                        },
                        code: 'task_contract_error',
                    },
                    {
                        tool,
                        result: {
                            status: 'error',
                            error: { code: 'synthetic_denied', message: 'credential-sentinel' },
                        },
                        code: 'task_contract_error',
                    },
                    {
                        tool,
                        result: {
                            status: 'unavailable',
                            error: {
                                code: 'unexpected',
                                message: 'unavailable',
                                details: { outcome: 'unknown' },
                            },
                        },
                        code: 'task_contract_error',
                    },
                ]),
                { tool: 'claim_next', result: null, code: 'task_contract_error' },
                {
                    tool: 'get_task',
                    result: {
                        status: 'error',
                        error: {
                            code: 'synthetic_denied',
                            message: 'denied',
                            http_status: 409,
                            details: { reason: 'synthetic' },
                        },
                    },
                    code: 'synthetic_denied',
                },
                ...['not_sent', 'unknown'].map((outcome) => ({
                    tool: 'claim_next',
                    result: {
                        status: 'unavailable',
                        error: { code: 'task_api_unavailable', message: 'unavailable', details: { outcome } },
                    },
                    code: 'task_api_unavailable',
                })),
                {
                    tool: 'claim_next',
                    result: {
                        status: 'unavailable',
                        error: { code: 'task_api_unavailable', message: 'unavailable' },
                    },
                    code: 'task_contract_error',
                },
                {
                    tool: 'claim_next',
                    result: {
                        status: 'unavailable',
                        error: {
                            code: 'task_auth_unavailable',
                            message: 'unavailable',
                            details: { outcome: 'unknown' },
                        },
                    },
                    code: 'task_auth_unavailable',
                },
                ...(['throw', 'reject'] as const).map((type) => ({
                    tool: 'claim_next',
                    type,
                    code: 'task_api_unavailable',
                })),
                ...[
                    { items: [] },
                    { items: [{ id: 't1', version: 0, status: 'pending' }], next_cursor: null },
                    null,
                ].map((queue) => ({
                    tool: 'list_my_tasks',
                    result: { status: 'ok', queue },
                    code: 'task_contract_error',
                })),
                {
                    tool: 'claim_next',
                    result: { status: 'ok', queue: { status: 'unknown' } },
                    code: 'task_contract_error',
                },
                {
                    tool: 'renew_claim',
                    result: { status: 'ok', queue: { task: { id: 't1', version: 1, status: 'pending' } } },
                    code: 'task_contract_error',
                },
                ...[{ code: 'x' }, { code: 1, message: 'x' }].map((error) => ({
                    tool: 'claim_next',
                    result: { status: 'error', error },
                    code: 'task_contract_error',
                })),
            ];
            for (const test of cases) {
                const state = createQueueReferenceSeed();
                state.scripted = [{ at: 1, type: test.type ?? 'result', result: test.result }];
                const x = await connect(state);
                await call(
                    x,
                    test.tool,
                    test.tool === 'get_task' || test.tool === 'renew_claim' ? { task_id: 't1' } : {},
                    test.code,
                );
                const last = steps.at(-1) as any;
                if (
                    test.result &&
                    (test.result as any).status !== 'ok' &&
                    test.code !== 'task_contract_error'
                )
                    assert.deepEqual(last, test.result);
                if (
                    (test.type || test.code === 'task_contract_error') &&
                    test.tool !== 'list_my_tasks' &&
                    test.tool !== 'get_task'
                )
                    assert.deepEqual(last.error.details, { outcome: 'unknown' });
                assert.equal((await x.snapshot()).calls.length, 1);
            }
        } else {
            const tools = await c.listTools();
            assert.deepEqual(tools, queueTaskToolDefinitions);
            assert.deepEqual(
                tools.map((t) => t.name),
                QUEUE_TASK_TOOL_NAMES,
            );
            const expectedAnnotations = {
                list_my_tasks: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                    openWorldHint: true,
                },
                get_task: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                    openWorldHint: true,
                },
                claim_task: {
                    readOnlyHint: false,
                    destructiveHint: true,
                    idempotentHint: false,
                    openWorldHint: true,
                },
                claim_next: {
                    readOnlyHint: false,
                    destructiveHint: true,
                    idempotentHint: false,
                    openWorldHint: true,
                },
                renew_claim: {
                    readOnlyHint: false,
                    destructiveHint: true,
                    idempotentHint: false,
                    openWorldHint: true,
                },
                attach_evidence: {
                    readOnlyHint: false,
                    destructiveHint: true,
                    idempotentHint: false,
                    openWorldHint: true,
                },
                update_status: {
                    readOnlyHint: false,
                    destructiveHint: true,
                    idempotentHint: false,
                    openWorldHint: true,
                },
            };
            for (let i = 0; i < tools.length; i++) {
                assert.deepEqual(
                    tools[i].annotations,
                    expectedAnnotations[tools[i].name as keyof typeof expectedAnnotations],
                );
                assert.equal(tools[i].inputSchema.additionalProperties, false);
                for (const key of ['agent_id', 'assignee', 'principal', 'scope', 'token', 'api_url'])
                    assert.ok(!(key in (tools[i].inputSchema.properties ?? {})));
            }
            assert.deepEqual(
                tools.map((t) => t.inputSchema.required),
                [
                    [],
                    ['task_id'],
                    ['task_id'],
                    [],
                    ['task_id'],
                    ['task_id', 'expected_version', 'kind', 'ref'],
                    ['task_id', 'expected_version', 'to_status'],
                ],
            );
            const properties = tools.map((t) => t.inputSchema.properties as Record<string, any>);
            assert.deepEqual(properties[0].statuses.items.enum, [
                'pending',
                'in_progress',
                'waiting',
                'completed',
                'cancelled',
            ]);
            assert.deepEqual(properties[5].kind.enum, ['pull_request', 'ci', 'production_readback']);
            assert.deepEqual(properties[6].to_status.enum, [
                'started',
                'waiting_for_review',
                'blocked',
                'done',
            ]);
            steps.push(tools);
        }
        steps.push(await c.snapshot());
        return { scenario: name, steps };
    } finally {
        await Promise.all(connections.map((c) => c.close()));
    }
}
