import { describe, expect, it } from 'vitest';
import {
    deriveSessionDisplayRoute,
    resolveCodexAppServerThreadId,
    SESSION_DISPLAY_MODES
} from '../../../public/modules/domain/session/session-display-route.js';

describe('session-display-route', () => {
    it('routes Codex sessions with App Server thread metadata to the App Server display mode', () => {
        const route = deriveSessionDisplayRoute({
            id: 'session-codex',
            engine: 'codex',
            codexAppServer: {
                threadId: ' thread-123 '
            }
        });

        expect(route).toEqual({
            mode: SESSION_DISPLAY_MODES.CODEX_APP_SERVER,
            reason: 'codex_app_server_thread',
            codexAppServerThreadId: 'thread-123',
            terminalFallback: true
        });
    });

    it('uses restore thread metadata when the active thread id is absent', () => {
        expect(resolveCodexAppServerThreadId({
            engine: 'codex',
            codexAppServer: {
                restore: {
                    threadId: 'thread-restore'
                }
            }
        })).toBe('thread-restore');
    });

    it('keeps Codex sessions without App Server metadata on xterm fallback', () => {
        expect(deriveSessionDisplayRoute({
            id: 'session-codex',
            engine: 'codex'
        })).toMatchObject({
            mode: SESSION_DISPLAY_MODES.TERMINAL_XTERM,
            reason: 'codex_app_server_thread_missing',
            terminalFallback: false
        });
    });

    it('never routes Claude Code sessions through Codex App Server metadata', () => {
        expect(deriveSessionDisplayRoute({
            id: 'session-claude',
            engine: 'claude',
            codexAppServer: {
                threadId: 'thread-should-not-be-used'
            }
        })).toMatchObject({
            mode: SESSION_DISPLAY_MODES.TERMINAL_XTERM,
            reason: 'non_codex_session',
            codexAppServerThreadId: null
        });
    });

    it('ignores stale App Server metadata and uses a distinct xterm fallback reason', () => {
        expect(deriveSessionDisplayRoute({
            id: 'session-codex',
            engine: 'codex',
            codexAppServer: {
                threadId: 'thread-stale',
                stale: true
            }
        })).toMatchObject({
            mode: SESSION_DISPLAY_MODES.TERMINAL_XTERM,
            reason: 'codex_app_server_thread_stale',
            codexAppServerThreadId: null
        });
    });
});
