import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

import { CodexAppServerTranscriptService } from '../../../server/services/codex-app-server-transcript-service.js';

class FakeAdapter extends EventEmitter {
    constructor() {
        super();
        this.start = vi.fn(async () => this);
        this.request = vi.fn(async (method) => {
            if (method === 'thread/resume') return {};
            if (method === 'thread/read') return {
                items: [{ id: 'history-1', role: 'assistant', content: 'History item' }]
            };
            return {};
        });
        this.stop = vi.fn(async () => {});
        this.startThread = vi.fn(async () => ({ thread: { id: 'thread-new' } }));
        this.startTurn = vi.fn(async () => ({ turn: { id: 'turn-1' } }));
    }
}

function createStateStore(sessions) {
    let state = { sessions };
    return {
        get: () => state,
        patchSession: vi.fn(async (sessionId, patch) => {
            state = {
                ...state,
                sessions: state.sessions.map((session) =>
                    session.id === sessionId ? { ...session, ...patch } : session
                )
            };
            return state.sessions.find((session) => session.id === sessionId);
        })
    };
}

function createService({ sessions, adapter = new FakeAdapter(), activityService = null }) {
    const stateStore = createStateStore(sessions);
    const service = new CodexAppServerTranscriptService({
        stateStore,
        activityService,
        adapterFactory: vi.fn(() => adapter),
        codexCommand: 'codex',
        codexArgs: ['app-server', '--listen', 'stdio://']
    });
    return { service, stateStore, adapter };
}

describe('CodexAppServerTranscriptService', () => {
    it('resumes an existing App Server thread and exposes history as timeline items', async () => {
        const { service, stateStore, adapter } = createService({
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        const snapshot = await service.ensureSession('session-codex');

        expect(adapter.start).toHaveBeenCalled();
        expect(adapter.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({
            threadId: 'thread-existing',
            cwd: '/repo'
        }));
        expect(adapter.request).toHaveBeenCalledWith('thread/read', expect.objectContaining({
            threadId: 'thread-existing',
            includeTurns: true
        }), expect.any(Object));
        expect(snapshot).toMatchObject({
            sessionId: 'session-codex',
            threadId: 'thread-existing',
            status: 'ready',
            timeline: [{ id: 'history-1', kind: 'assistant', text: 'History item' }]
        });
        expect(stateStore.patchSession).toHaveBeenCalledWith('session-codex', expect.objectContaining({
            codexAppServer: expect.objectContaining({
                threadId: 'thread-existing',
                lifecycle: 'thread_started',
                lastEventType: 'thread/resume'
            })
        }));
    });

    it('starts a new thread when no App Server thread metadata exists', async () => {
        const { service, adapter } = createService({
            sessions: [{ id: 'session-codex', engine: 'codex', path: '/repo' }]
        });

        const snapshot = await service.ensureSession('session-codex');

        expect(adapter.startThread).toHaveBeenCalledWith({ cwd: '/repo' });
        expect(snapshot.threadId).toBe('thread-new');
    });

    it('passes explicit session policy when starting a new thread', async () => {
        const { service, adapter } = createService({
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: {
                    approvalPolicy: 'on-request',
                    sandboxPolicy: 'workspace-write'
                }
            }]
        });

        await service.ensureSession('session-codex');

        expect(adapter.startThread).toHaveBeenCalledWith(expect.objectContaining({
            cwd: '/repo',
            approvalPolicy: 'on-request',
            sandboxPolicy: 'workspace-write'
        }));
    });

    it('sends turns through App Server and records the optimistic user message', async () => {
        const { service, adapter } = createService({
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        const snapshot = await service.startTurn('session-codex', 'Brainbase を分析して');

        expect(adapter.startTurn).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-existing',
            input: [{ type: 'text', text: 'Brainbase を分析して' }],
            cwd: '/repo'
        }));
        expect(adapter.startTurn.mock.calls[0][0]).not.toMatchObject({
            approvalPolicy: 'never',
            sandboxPolicy: 'danger-full-access'
        });
        expect(snapshot.timeline.map((item) => item.text)).toContain('Brainbase を分析して');
        expect(snapshot.status).toBe('working');
    });

    it('reports App Server turn starts to the activity service for hibernation blockers', async () => {
        const activityService = { reportActivity: vi.fn() };
        const { service } = createService({
            activityService,
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        await service.startTurn('session-codex', 'ハイバネーション中断を防いで');

        expect(activityService.reportActivity).toHaveBeenCalledWith(
            'session-codex',
            'working',
            expect.any(Number),
            expect.objectContaining({
                lifecycle: 'turn_started',
                eventType: 'turn/start',
                turnId: 'turn-1',
                activityKind: 'task_started'
            })
        );
    });

    it('stops and removes a cached session runtime', async () => {
        const { service, adapter } = createService({
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        await service.ensureSession('session-codex');
        const stopped = await service.stopSession('session-codex', { status: 'hibernated' });

        expect(stopped).toBe(true);
        expect(adapter.stop).toHaveBeenCalled();
        expect(service.getSnapshot('session-codex')).toMatchObject({
            sessionId: 'session-codex',
            status: 'not_started',
            timeline: []
        });
        await expect(service.stopSession('session-codex')).resolves.toBe(false);
    });

    it('keeps a cached runtime retryable when adapter stop fails', async () => {
        const adapter = new FakeAdapter();
        adapter.stop
            .mockRejectedValueOnce(new Error('stop failed'))
            .mockResolvedValueOnce();
        const { service } = createService({
            adapter,
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        await service.ensureSession('session-codex');
        await expect(service.stopSession('session-codex', { status: 'hibernated' }))
            .rejects.toThrow('stop failed');
        expect(service.getSnapshot('session-codex')).toMatchObject({
            status: 'hibernated',
            threadId: 'thread-existing'
        });

        await expect(service.stopSession('session-codex', { status: 'hibernated' }))
            .resolves.toBe(true);
        expect(service.getSnapshot('session-codex')).toMatchObject({
            status: 'not_started',
            timeline: []
        });
    });

    it('passes explicit session policy without forcing dangerous defaults', async () => {
        const { service, adapter } = createService({
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: {
                    threadId: 'thread-existing',
                    approvalPolicy: 'on-request',
                    sandboxPolicy: 'workspace-write'
                }
            }]
        });

        await service.startTurn('session-codex', '安全なpolicyで実行して');

        expect(adapter.startTurn).toHaveBeenCalledWith(expect.objectContaining({
            approvalPolicy: 'on-request',
            sandboxPolicy: 'workspace-write'
        }));
    });

    it('persists turn start failures in the server transcript ledger', async () => {
        const adapter = new FakeAdapter();
        adapter.startTurn.mockRejectedValueOnce(new Error('network turn failure'));
        const { service } = createService({
            adapter,
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        await expect(service.startTurn('session-codex', '失敗も見える化して'))
            .rejects.toThrow('network turn failure');

        const snapshot = service.getSnapshot('session-codex');
        expect(snapshot.status).toBe('error');
        expect(snapshot.timeline).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'user', text: '失敗も見える化して' }),
            expect.objectContaining({ kind: 'error', text: 'network turn failure' })
        ]));
    });

    it('persists startup failures during browser turn start in the server transcript ledger', async () => {
        const adapter = new FakeAdapter();
        adapter.request.mockImplementation(async (method) => {
            if (method === 'thread/resume') throw new Error('thread resume failed');
            return {};
        });
        const { service } = createService({
            adapter,
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        await expect(service.startTurn('session-codex', '復旧して'))
            .rejects.toThrow('thread resume failed');

        expect(adapter.stop).toHaveBeenCalled();
        const snapshot = service.getSnapshot('session-codex');
        expect(snapshot.status).toBe('error');
        expect(snapshot.timeline).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'error', text: 'thread resume failed' })
        ]));

        const refreshed = await service.ensureSession('session-codex');
        expect(refreshed.status).toBe('error');
        expect(refreshed.timeline).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'error', text: 'thread resume failed' })
        ]));
    });

    it('stops and discards a startup adapter when thread resume fails', async () => {
        const adapter = new FakeAdapter();
        adapter.request.mockImplementation(async (method) => {
            if (method === 'thread/resume') throw new Error('thread resume failed');
            return {};
        });
        const { service } = createService({
            adapter,
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });

        await expect(service.ensureSession('session-codex'))
            .rejects.toThrow('thread resume failed');

        expect(adapter.start).toHaveBeenCalled();
        expect(adapter.stop).toHaveBeenCalled();
        expect(service.getSnapshot('session-codex')).toMatchObject({
            sessionId: 'session-codex',
            status: 'not_started',
            timeline: []
        });
    });

    it('stops and discards a startup adapter when new thread creation fails', async () => {
        const firstAdapter = new FakeAdapter();
        firstAdapter.startThread.mockRejectedValueOnce(new Error('thread start failed'));
        const secondAdapter = new FakeAdapter();
        const adapterFactory = vi.fn()
            .mockReturnValueOnce(firstAdapter)
            .mockReturnValueOnce(secondAdapter);
        const stateStore = createStateStore([{ id: 'session-codex', engine: 'codex', path: '/repo' }]);
        const service = new CodexAppServerTranscriptService({
            stateStore,
            adapterFactory,
            codexCommand: 'codex',
            codexArgs: ['app-server', '--listen', 'stdio://']
        });

        await expect(service.ensureSession('session-codex'))
            .rejects.toThrow('thread start failed');

        expect(firstAdapter.stop).toHaveBeenCalled();
        const snapshot = await service.ensureSession('session-codex');
        expect(adapterFactory).toHaveBeenCalledTimes(2);
        expect(secondAdapter.startThread).toHaveBeenCalled();
        expect(snapshot.threadId).toBe('thread-new');
    });

    it('normalizes App Server deltas and errors into bounded transcript items', async () => {
        const { service, adapter } = createService({
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });
        await service.ensureSession('session-codex');

        adapter.emit('notification', {
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-1', delta: 'hello' }
        });
        adapter.emit('notification', {
            method: 'item/agentMessage/delta',
            params: { itemId: 'assistant-1', delta: ' world' }
        });
        adapter.emit('notification', {
            method: 'error',
            params: { message: 'unsupported model' }
        });
        adapter.emit('notification', {
            method: 'item/reasoning/delta',
            params: { itemId: 'reasoning-1', delta: 'thinking summary' }
        });
        adapter.emit('notification', {
            method: 'item/command/output',
            params: { item: { id: 'command-1', type: 'command_output', content: 'npm test output' } }
        });
        adapter.emit('notification', {
            method: 'item/fileChange/summary',
            params: { item: { id: 'file-1', type: 'file_change', content: 'modified app.js' } }
        });
        adapter.emit('notification', {
            method: 'item/toolCall/delta',
            params: { itemId: 'tool-1', delta: 'running tool' }
        });
        adapter.emit('notification', {
            method: 'item/inputRequest/created',
            params: { item: { id: 'input-1', type: 'input_request', content: 'approval needed' } }
        });
        adapter.emit('notification', {
            method: 'turn/completed',
            params: { turnId: 'turn-1' }
        });

        const snapshot = service.getSnapshot('session-codex');
        expect(snapshot.timeline).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'assistant-1', kind: 'assistant', text: 'hello world' }),
            expect.objectContaining({ kind: 'error', text: 'unsupported model' }),
            expect.objectContaining({ kind: 'reasoning', text: 'thinking summary' }),
            expect.objectContaining({ kind: 'command', text: 'npm test output' }),
            expect.objectContaining({ kind: 'file_change', text: 'modified app.js' }),
            expect.objectContaining({ kind: 'tool', text: 'running tool' }),
            expect.objectContaining({ kind: 'input_request', text: 'approval needed' }),
            expect.objectContaining({ kind: 'turn', text: 'Turn completed' })
        ]));
    });

    it('clears active turns and reports done activity for failed notifications', async () => {
        const activityService = { reportActivity: vi.fn() };
        const { service, adapter, stateStore } = createService({
            activityService,
            sessions: [{
                id: 'session-codex',
                engine: 'codex',
                path: '/repo',
                codexAppServer: { threadId: 'thread-existing' }
            }]
        });
        await service.ensureSession('session-codex');

        adapter.emit('notification', {
            method: 'turn/started',
            params: { turnId: 'turn-failed' }
        });
        adapter.emit('notification', {
            method: 'turn/failed',
            params: { turnId: 'turn-failed', message: 'model stopped' }
        });

        await vi.waitFor(() => {
            expect(activityService.reportActivity).toHaveBeenLastCalledWith(
                'session-codex',
                'done',
                expect.any(Number),
                expect.objectContaining({
                    lifecycle: 'turn_failed',
                    eventType: 'turn/failed',
                    turnId: 'turn-failed',
                    activityKind: 'task_completed'
                })
            );
        });
        expect(service.getSnapshot('session-codex')).toMatchObject({
            activeTurnId: null,
            status: 'error'
        });
        expect(stateStore.get().sessions[0].codexAppServer).toMatchObject({
            activeTurnId: null,
            lifecycle: 'turn_failed',
            status: 'error'
        });
    });
});
