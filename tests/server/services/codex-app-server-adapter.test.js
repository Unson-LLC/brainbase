import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerAdapter } from '../../../server/services/codex-app-server-adapter.js';

function createFakeProcess() {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.killed = false;
    proc.kill = vi.fn(() => {
        proc.killed = true;
        proc.emit('exit', 0, 'SIGTERM');
    });
    return proc;
}

function createHarness() {
    const proc = createFakeProcess();
    const writes = [];
    proc.stdin.on('data', (chunk) => {
        const lines = chunk.toString().trim().split('\n').filter(Boolean);
        for (const line of lines) {
            writes.push(JSON.parse(line));
        }
    });
    const spawnFn = vi.fn(() => proc);
    const adapter = new CodexAppServerAdapter({
        spawnFn,
        codexCommand: 'codex',
        codexArgs: ['app-server'],
        cwd: '/repo',
        env: { ...process.env },
        requestTimeoutMs: 100
    });

    return { adapter, proc, writes, spawnFn };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

describe('CodexAppServerAdapter', () => {
    it('starts codex app-server and completes initialize handshake', async () => {
        const { adapter, proc, writes, spawnFn } = createHarness();
        const started = adapter.start();

        await flush();
        expect(spawnFn).toHaveBeenCalledWith('codex', ['app-server'], expect.objectContaining({
            cwd: '/repo',
            stdio: ['pipe', 'pipe', 'pipe']
        }));
        expect(writes[0]).toMatchObject({
            method: 'initialize',
            id: 1,
            params: {
                clientInfo: {
                    name: 'brainbase',
                    title: 'Brainbase'
                }
            }
        });

        proc.stdout.write(`${JSON.stringify({ id: 1, result: { platformFamily: 'unix' } })}\n`);
        await started;

        expect(adapter.initialized).toBe(true);
        expect(writes[1]).toEqual({
            method: 'initialized',
            params: {}
        });
    });

    it('matches JSON-RPC responses to pending requests', async () => {
        const { adapter, proc } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const request = adapter.request('model/list', { includeHidden: true });
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 2, result: { models: ['gpt-5.4'] } })}\n`);

        await expect(request).resolves.toEqual({ models: ['gpt-5.4'] });
    });

    it('rejects JSON-RPC error responses', async () => {
        const { adapter, proc } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const request = adapter.request('thread/read', { threadId: 'missing' });
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 2, error: { code: 404, message: 'missing thread' } })}\n`);

        await expect(request).rejects.toThrow('missing thread');
    });

    it('emits notifications without resolving pending requests', async () => {
        const { adapter, proc } = createHarness();
        const notification = vi.fn();
        const turnStarted = vi.fn();
        adapter.on('notification', notification);
        adapter.on('notification:turn/started', turnStarted);

        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn_1' } } })}\n`);
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        expect(notification).toHaveBeenCalledWith({
            method: 'turn/started',
            params: { turn: { id: 'turn_1' } }
        });
        expect(turnStarted).toHaveBeenCalledWith({ turn: { id: 'turn_1' } });
    });

    it('startThread and startTurn send Codex App Server methods', async () => {
        const { adapter, proc, writes } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const thread = adapter.startThread({
            model: 'gpt-5.4',
            cwd: '/repo',
            approvalPolicy: 'on-request',
            sandboxPolicy: 'workspace-write'
        });
        await flush();
        expect(writes[2]).toEqual({
            method: 'thread/start',
            id: 2,
            params: {
                model: 'gpt-5.4',
                cwd: '/repo',
                approvalPolicy: 'on-request',
                sandboxPolicy: 'workspace-write'
            }
        });
        proc.stdout.write(`${JSON.stringify({ id: 2, result: { thread: { id: 'thr_1' } } })}\n`);
        await expect(thread).resolves.toEqual({ thread: { id: 'thr_1' } });

        const turn = adapter.startTurn({
            threadId: 'thr_1',
            input: [{ type: 'text', text: 'Summarize this repo.' }]
        });
        await flush();
        expect(writes[3]).toEqual({
            method: 'turn/start',
            id: 3,
            params: {
                threadId: 'thr_1',
                input: [{ type: 'text', text: 'Summarize this repo.' }]
            }
        });
        proc.stdout.write(`${JSON.stringify({ id: 3, result: { turn: { id: 'turn_1' } } })}\n`);
        await expect(turn).resolves.toEqual({ turn: { id: 'turn_1' } });
    });

    it('reuses the in-flight start promise while initialization is pending', async () => {
        const { adapter, proc, spawnFn } = createHarness();
        const firstStart = adapter.start();
        const secondStart = adapter.start();
        await flush();

        expect(spawnFn).toHaveBeenCalledTimes(1);

        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await expect(firstStart).resolves.toBe(adapter);
        await expect(secondStart).resolves.toBe(adapter);
    });

    it('does not spawn a second process when start is called after initialization', async () => {
        const { adapter, proc, spawnFn } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        await expect(adapter.start()).resolves.toBe(adapter);

        expect(spawnFn).toHaveBeenCalledTimes(1);
    });

    it('rejects requests before initialization and before the process is running', async () => {
        const { adapter } = createHarness();

        await expect(adapter.request('thread/start', {})).rejects.toThrow('not initialized');
        await expect(adapter.request('initialize', {}, { allowBeforeInitialized: true })).rejects.toThrow('not running');
    });

    it('cleans up pending requests on timeout', async () => {
        const { adapter, proc } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const request = adapter.request('model/list', {}, { timeoutMs: 1 });

        await expect(request).rejects.toThrow('timed out');
        expect(adapter.pending.size).toBe(0);
    });

    it('interruptTurn sends turn/interrupt params', async () => {
        const { adapter, proc, writes } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const interrupt = adapter.interruptTurn({ threadId: 'thr_1', turnId: 'turn_1' });
        await flush();

        expect(writes[2]).toEqual({
            method: 'turn/interrupt',
            id: 2,
            params: {
                threadId: 'thr_1',
                turnId: 'turn_1'
            }
        });
        proc.stdout.write(`${JSON.stringify({ id: 2, result: { interrupted: true } })}\n`);
        await expect(interrupt).resolves.toEqual({ interrupted: true });
    });

    it('rejects invalid helper params before sending requests', async () => {
        const { adapter, proc, writes } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        await expect(adapter.startTurn({ input: [] })).rejects.toThrow('threadId is required');
        await expect(adapter.startTurn({ threadId: 'thr_1' })).rejects.toThrow('input is required');
        await expect(adapter.interruptTurn({ turnId: 'turn_1' })).rejects.toThrow('threadId is required');
        await expect(adapter.interruptTurn({ threadId: 'thr_1' })).rejects.toThrow('turnId is required');

        expect(writes).toHaveLength(2);
    });

    it('stop rejects pending requests and clears running state', async () => {
        const { adapter, proc } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const request = adapter.request('thread/start', {});
        await flush();
        await adapter.stop();

        await expect(request).rejects.toThrow('adapter stopped');
        expect(adapter.running).toBe(false);
        expect(adapter.initialized).toBe(false);
        expect(adapter.pending.size).toBe(0);
    });

    it('rejects pending requests on child process error without an error listener', async () => {
        const { adapter, proc } = createHarness();
        const childError = vi.fn();
        adapter.on('child_error', childError);
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const request = adapter.request('thread/start', {});
        await flush();
        proc.emit('error', new Error('spawn codex ENOENT'));

        await expect(request).rejects.toThrow('spawn codex ENOENT');
        expect(childError).toHaveBeenCalledWith(expect.objectContaining({
            message: 'spawn codex ENOENT'
        }));
        expect(adapter.running).toBe(false);
        expect(adapter.initialized).toBe(false);
        expect(adapter.pending.size).toBe(0);
    });

    it('clears process state when initialization fails so start can be retried', async () => {
        const { adapter, proc, spawnFn } = createHarness();
        const started = adapter.start();
        await flush();

        proc.stdout.write(`${JSON.stringify({ id: 1, error: { message: 'init failed' } })}\n`);

        await expect(started).rejects.toThrow('init failed');
        expect(adapter.running).toBe(false);
        expect(adapter.initialized).toBe(false);
        expect(adapter.proc).toBeNull();

        const retryProc = createFakeProcess();
        retryProc.stdin.on('data', () => {});
        spawnFn.mockReturnValueOnce(retryProc);
        const retried = adapter.start();
        await flush();
        retryProc.stdout.write(`${JSON.stringify({ id: 2, result: {} })}\n`);

        await expect(retried).resolves.toBe(adapter);
        expect(spawnFn).toHaveBeenCalledTimes(2);
        await adapter.stop();
    });

    it('emits parse_error for malformed stdout lines', async () => {
        const { adapter, proc } = createHarness();
        const parseError = vi.fn();
        adapter.on('parse_error', parseError);

        const started = adapter.start();
        await flush();
        proc.stdout.write('not-json\n');
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        expect(parseError).toHaveBeenCalledWith(expect.objectContaining({
            line: 'not-json'
        }));
    });

    it('rejects pending requests when the process exits', async () => {
        const { adapter, proc } = createHarness();
        const started = adapter.start();
        await flush();
        proc.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        await started;

        const request = adapter.request('thread/start', {});
        await flush();
        proc.emit('exit', 1, null);

        await expect(request).rejects.toThrow('Codex App Server exited');
        expect(adapter.running).toBe(false);
        expect(adapter.initialized).toBe(false);
    });
});
