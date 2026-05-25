import { describe, expect, it } from 'vitest';
import {
  buildActivityReportPayload,
  buildActivityReportFailureWarning,
  buildCodexAppServerStatePatch,
  classifyAppServerNotification,
  createActivityReportFailureWarner,
  resolveAppServerThreadId,
  resolveAppServerTurnId
} from '../../scripts/lib/codex-app-server-activity-client.mjs';

describe('codex app-server activity client', () => {
  it('builds structured working activity for turn/started', () => {
    const result = buildActivityReportPayload({
      sessionId: 'session-codex',
      method: 'turn/started',
      reportedAt: 1779688449000,
      params: {
        thread: { id: 'thread-app-1' },
        turn: { id: 'turn-app-1' }
      }
    });

    expect(result).toMatchObject({
      mutates: true,
      payload: {
        sessionId: 'session-codex',
        status: 'working',
        reportedAt: 1779688449000,
        lifecycle: 'turn_started',
        eventType: 'turn/started',
        turnId: 'turn-app-1',
        activityKind: 'task_started',
        currentStep: 'Codex App Serverで作業開始',
        latestEvidence: 'codex app-server notification'
      }
    });
  });

  it('builds structured done activity using the active fallback turn id', () => {
    const result = buildActivityReportPayload({
      sessionId: 'session-codex',
      method: 'turn/completed',
      reportedAt: 1779688459000,
      fallbackTurnId: 'turn-app-1',
      params: {}
    });

    expect(result).toMatchObject({
      mutates: true,
      payload: {
        status: 'done',
        lifecycle: 'turn_completed',
        eventType: 'turn/completed',
        turnId: 'turn-app-1',
        activityKind: 'task_completed',
        currentStep: 'Codex App Serverのターンが完了'
      }
    });
  });

  it('persists App Server thread and active turn metadata on start', () => {
    const result = buildCodexAppServerStatePatch({
      sessionId: 'session-codex',
      method: 'turn/started',
      reportedAt: 1779688449000,
      params: {
        thread: { id: 'thread-app-1' },
        turn: { id: 'turn-app-1' }
      }
    });

    expect(result).toMatchObject({
      mutates: true,
      sessionId: 'session-codex',
      patch: {
        codexAppServer: {
          source: 'codex_app_server',
          threadId: 'thread-app-1',
          activeTurnId: 'turn-app-1',
          lastTurnId: 'turn-app-1',
          lifecycle: 'turn_started',
          status: 'working',
          lastEventType: 'turn/started',
          restore: {
            strategy: 'codex_app_server_thread',
            threadId: 'thread-app-1'
          }
        }
      }
    });
  });

  it('clears App Server active turn metadata on completion', () => {
    const result = buildCodexAppServerStatePatch({
      sessionId: 'session-codex',
      method: 'turn/completed',
      reportedAt: 1779688459000,
      fallbackThreadId: 'thread-app-1',
      fallbackTurnId: 'turn-app-1'
    });

    expect(result).toMatchObject({
      mutates: true,
      patch: {
        codexAppServer: {
          threadId: 'thread-app-1',
          activeTurnId: null,
          lastTurnId: 'turn-app-1',
          lifecycle: 'turn_completed',
          status: 'done',
          lastEventType: 'turn/completed'
        }
      }
    });
  });

  it('does not mutate without a Brainbase session id', () => {
    expect(buildActivityReportPayload({
      method: 'turn/started',
      params: { turn: { id: 'turn-app-1' } }
    })).toEqual({ mutates: false, reason: 'missing_session_id' });

    expect(buildCodexAppServerStatePatch({
      method: 'turn/started',
      params: { turn: { id: 'turn-app-1' } }
    })).toEqual({ mutates: false, reason: 'missing_session_id' });
  });

  it('resolves aliases used by Codex app-server notifications', () => {
    expect(classifyAppServerNotification('codex/event/task_complete')).toMatchObject({
      supported: true,
      lifecycle: 'turn_completed'
    });
    expect(resolveAppServerTurnId({ task: { turn_id: 'turn-task' } })).toBe('turn-task');
    expect(resolveAppServerThreadId({ turn: { thread: { id: 'thread-nested' } } })).toBe('thread-nested');
  });

  it('warns once per activity report endpoint and method when HTTP reporting fails', () => {
    const messages = [];
    const warn = createActivityReportFailureWarner((message) => messages.push(message));

    expect(warn('31013', '/api/sessions/report_activity', 'POST', 'HTTP 500')).toBe(true);
    expect(warn('31013', '/api/sessions/report_activity', 'POST', 'HTTP 500')).toBe(false);
    expect(warn('31013', '/api/state/sessions/session-codex', 'PATCH', 'fetch failed')).toBe(true);

    expect(messages).toEqual([
      buildActivityReportFailureWarning({
        port: '31013',
        pathname: '/api/sessions/report_activity',
        method: 'POST',
        reason: 'HTTP 500'
      }),
      buildActivityReportFailureWarning({
        port: '31013',
        pathname: '/api/state/sessions/session-codex',
        method: 'PATCH',
        reason: 'fetch failed'
      })
    ]);
  });
});
