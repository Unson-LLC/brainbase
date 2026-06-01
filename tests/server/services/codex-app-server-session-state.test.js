import { describe, expect, it, vi } from 'vitest';

import {
    buildCodexAppServerRestoreMetadata,
    getCodexResumeId,
    recordCodexAppServerSessionState
} from '../../../server/services/codex-app-server-session-state.js';

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

describe('Codex App Server session state', () => {
    it('persists App Server thread and active turn metadata only for Codex sessions', async () => {
        const stateStore = createStateStore([
            { id: 'session-codex', engine: 'codex' },
            { id: 'session-claude', engine: 'claude' }
        ]);

        await expect(recordCodexAppServerSessionState({
            stateStore,
            sessionId: 'session-codex',
            threadId: 'thread-app-1',
            turnId: 'turn-app-1',
            lifecycle: 'turn_started',
            eventType: 'turn/started',
            reportedAt: Date.parse('2026-05-25T00:00:00.000Z'),
            status: 'working'
        })).resolves.toMatchObject({
            updated: true,
            sessionId: 'session-codex',
            codexAppServer: {
                threadId: 'thread-app-1',
                activeTurnId: 'turn-app-1',
                lastTurnId: 'turn-app-1',
                lifecycle: 'turn_started',
                lastEventType: 'turn/started',
                status: 'working',
                source: 'codex_app_server'
            }
        });

        await expect(recordCodexAppServerSessionState({
            stateStore,
            sessionId: 'session-claude',
            threadId: 'thread-claude-leak',
            turnId: 'turn-claude-leak',
            lifecycle: 'turn_started'
        })).resolves.toEqual({
            updated: false,
            reason: 'unsupported_engine'
        });

        expect(stateStore.get().sessions.find((session) => session.id === 'session-claude')).not.toHaveProperty('codexAppServer');
    });

    it('clears the active App Server turn when the matching turn completes', async () => {
        const stateStore = createStateStore([{
            id: 'session-codex',
            engine: 'codex',
            codexAppServer: {
                schemaVersion: 1,
                source: 'codex_app_server',
                threadId: 'thread-app-1',
                activeTurnId: 'turn-app-1'
            }
        }]);

        await recordCodexAppServerSessionState({
            stateStore,
            sessionId: 'session-codex',
            turnId: 'turn-app-1',
            lifecycle: 'turn_completed',
            eventType: 'turn/completed',
            status: 'done'
        });

        expect(stateStore.get().sessions[0].codexAppServer).toMatchObject({
            threadId: 'thread-app-1',
            activeTurnId: null,
            lastTurnId: 'turn-app-1',
            lifecycle: 'turn_completed',
            status: 'done'
        });
    });

    it('clears active App Server turns when a turn fails or is cancelled', async () => {
        const stateStore = createStateStore([{
            id: 'session-codex',
            engine: 'codex',
            codexAppServer: {
                schemaVersion: 1,
                source: 'codex_app_server',
                threadId: 'thread-app-1',
                activeTurnId: 'turn-app-1'
            }
        }]);

        await recordCodexAppServerSessionState({
            stateStore,
            sessionId: 'session-codex',
            turnId: 'turn-app-1',
            lifecycle: 'turn_failed',
            eventType: 'turn/failed',
            status: 'error'
        });

        expect(stateStore.get().sessions[0].codexAppServer).toMatchObject({
            activeTurnId: null,
            lastTurnId: 'turn-app-1',
            lifecycle: 'turn_failed',
            status: 'error'
        });

        await recordCodexAppServerSessionState({
            stateStore,
            sessionId: 'session-codex',
            lifecycle: 'turn_cancelled',
            eventType: 'turn/cancelled',
            status: 'error'
        });

        expect(stateStore.get().sessions[0].codexAppServer).toMatchObject({
            activeTurnId: null,
            lifecycle: 'turn_cancelled',
            status: 'error'
        });
    });

    it('uses App Server thread metadata before legacy Codex resume sources', () => {
        const session = {
            id: 'session-codex',
            engine: 'codex',
            codexThreadId: 'legacy-thread',
            codexAppServer: {
                threadId: 'app-server-thread'
            }
        };

        expect(getCodexResumeId(session)).toBe('app-server-thread');
        expect(buildCodexAppServerRestoreMetadata(session)).toMatchObject({
            restoreStrategy: 'codex_app_server_thread',
            codexResumeId: 'app-server-thread',
            codexAppServerThreadId: 'app-server-thread',
            source: 'codex_app_server',
            blocker: null
        });
    });

    it('does not expose App Server restore metadata for Claude Code sessions', () => {
        const session = {
            id: 'session-claude',
            engine: 'claude',
            codexAppServer: {
                threadId: 'must-not-use'
            },
            codexThreadId: 'legacy-must-not-use'
        };

        expect(getCodexResumeId(session)).toBeNull();
        expect(buildCodexAppServerRestoreMetadata(session)).toMatchObject({
            restoreStrategy: 'unsupported',
            codexResumeId: null,
            codexAppServerThreadId: null,
            blocker: 'unsupported_engine'
        });
    });

    it('surfaces missing restore metadata as an explicit blocker', () => {
        expect(buildCodexAppServerRestoreMetadata({
            id: 'session-codex',
            engine: 'codex'
        })).toMatchObject({
            restoreStrategy: 'codex_resume',
            codexResumeId: null,
            codexAppServerThreadId: null,
            source: 'legacy_codex_resume',
            blocker: 'missing_restore_metadata'
        });
    });

    it('does not use stale App Server thread metadata for restore', () => {
        const session = {
            id: 'session-codex',
            engine: 'codex',
            codexThreadId: 'legacy-thread',
            codexAppServer: {
                threadId: 'stale-app-server-thread',
                stale: true
            }
        };

        expect(getCodexResumeId(session)).toBe('legacy-thread');
        expect(buildCodexAppServerRestoreMetadata(session)).toMatchObject({
            restoreStrategy: 'codex_resume',
            codexResumeId: 'legacy-thread',
            codexAppServerThreadId: null,
            source: 'legacy_codex_resume',
            blocker: 'stale_app_server_metadata'
        });
    });

    it('returns explicit non-mutating outcomes when the session cannot be resolved', async () => {
        const stateStore = createStateStore([{ id: 'session-codex', engine: 'codex' }]);

        await expect(recordCodexAppServerSessionState({
            stateStore,
            sessionId: '',
            threadId: 'thread-app-missing'
        })).resolves.toEqual({
            updated: false,
            reason: 'missing_session_id'
        });

        await expect(recordCodexAppServerSessionState({
            stateStore,
            sessionId: 'session-unknown',
            threadId: 'thread-app-unknown'
        })).resolves.toEqual({
            updated: false,
            reason: 'session_not_found'
        });

        expect(stateStore.get().sessions[0]).not.toHaveProperty('codexAppServer');
        expect(stateStore.patchSession).not.toHaveBeenCalled();
    });
});
