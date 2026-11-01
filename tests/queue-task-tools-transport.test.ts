import assert from 'node:assert/strict';
import { describe, it, expect } from 'vitest';
import { QUEUE_TASK_CONTRACT_SCENARIO_NAMES, runQueueTaskContractScenario, createQueueReferenceSeed } from '../src/testing/queue-task-tools-contract.js';
import { createStdioQueueAdapter, createHttpQueueAdapter, createQueueHttpFixture } from './helpers/queue-task-transport-adapters.js';
const adapterFor = (transport: string) => transport === 'stdio' ? createStdioQueueAdapter() : createHttpQueueAdapter();
describe.each(['stdio', 'http'] as const)('queue task tools over %s', transport => {
    for (const name of QUEUE_TASK_CONTRACT_SCENARIO_NAMES)
        it(name, () => runQueueTaskContractScenario(name, adapterFor(transport), assert), 30000);
});
it('AC-10 runs the same queue contract over stdio and Streamable HTTP', async () => {
    const transcripts = [];
    for (const transport of ['stdio', 'http']) {
        const results = [];
        for (const name of QUEUE_TASK_CONTRACT_SCENARIO_NAMES)
            results.push(await runQueueTaskContractScenario(name, adapterFor(transport), assert));
        transcripts.push(results);
    }
    expect(transcripts[0]).toEqual(transcripts[1]);
}, 120000);
it('AC-11 rejects cross-agent HTTP sessions and cleans up transports', async () => {
    const f = await createQueueHttpFixture({ state: createQueueReferenceSeed(), agent: { agentId: 'A', credential: 'synthetic' } });
    let id = 1;
    const request = (token?: string, session?: string, method = 'initialize', verb = 'POST') => fetch(f.url, { method: verb, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(session ? { 'mcp-session-id': session } : {}) }, ...(verb === 'POST' ? { body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic', version: '0' } } : method === 'tools/call' ? { name: 'list_my_tasks', arguments: {} } : {} }) } : {}) });
    const result = async (r: Response) => { const t = await r.text(); return t.startsWith('event:') ? JSON.parse(t.split('\n').find(x => x.startsWith('data:'))!.slice(5)) : JSON.parse(t); };
    try {
        for (const token of [undefined, 'unknown']) {
            const r = await request(token);
            expect(r.status).toBe(401);
            expect(r.headers.get('www-authenticate')).toBe('Bearer');
        }
        expect(f.created).toBe(0);
        expect(f.backend.snapshot().calls).toHaveLength(0);
        const init = await request('synthetic-A');
        const session = init.headers.get('mcp-session-id')!;
        await init.text();
        expect(session).toBeTruthy();
        const denied = await result(await request('synthetic-B', session, 'tools/call'));
        expect(denied.result.isError).toBe(true);
        expect(JSON.parse(denied.result.content[0].text).error.code).toBe('task_auth_unavailable');
        expect(f.backend.snapshot().calls).toHaveLength(0);
        expect((await result(await request('synthetic-A', session, 'tools/call'))).result.isError).not.toBe(true);
        f.tokens.delete('synthetic-A');
        expect((await request('synthetic-A', session, 'tools/call')).status).toBe(401);
        f.tokens.set('synthetic-A', { token: 'synthetic-A', clientId: 'A', scopes: [] });
        expect((await request('synthetic-A', session, '', 'DELETE')).status).toBe(200);
        expect(f.handler.activeSessionCount).toBe(0);
        expect(f.closed).toBeGreaterThan(0);
        expect((await request('synthetic-A', session, 'tools/call')).status).toBe(404);
        const remaining = await request('synthetic-A');
        await remaining.text();
        expect(f.handler.activeSessionCount).toBe(1);
        await f.handler.close();
        expect(f.handler.activeSessionCount).toBe(0);
    }
    finally {
        await f.close();
    }
}, 30000);
