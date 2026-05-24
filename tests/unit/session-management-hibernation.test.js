import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applySessionManagementMixin } from '../../public/modules/app/session-management-mixin.js';
import { appStore } from '../../public/modules/core/store.js';

describe('session management hibernation resume path', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resumes a suspended runtime before continuing the open-session flow', async () => {
    class TestApp {}
    applySessionManagementMixin(TestApp);
    const session = {
      id: 'session-hibernated',
      name: 'Hibernated',
      engine: 'codex',
      intendedState: 'hibernated'
    };
    const app = new TestApp();
    app.sessionService = {
      resumeRuntime: vi.fn(async () => {
        appStore.setState({
          sessions: [{ ...session, intendedState: 'active', runtimeState: 'hot' }]
        });
      })
    };
    app._getSessionById = (sessionId) => (appStore.getState().sessions || []).find(candidate => candidate.id === sessionId) || null;
    app._setCurrentSessionUiState = vi.fn();
    appStore.setState({ sessions: [session] });

    const result = await app._resumeSuspendedRuntimeIfNeeded(session);

    expect(app.sessionService.resumeRuntime).toHaveBeenCalledWith('session-hibernated');
    expect(result).toMatchObject({
      ok: true,
      session: {
        intendedState: 'active',
        runtimeState: 'hot'
      }
    });
  });

  it('does not auto-resume broken runtimes on open-session flow', async () => {
    class TestApp {}
    applySessionManagementMixin(TestApp);
    const session = {
      id: 'session-broken',
      name: 'Broken',
      engine: 'codex',
      intendedState: 'broken'
    };
    const app = new TestApp();
    app.sessionService = {
      resumeRuntime: vi.fn()
    };

    const result = await app._resumeSuspendedRuntimeIfNeeded(session);

    expect(app.sessionService.resumeRuntime).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('requires explicit recovery');
  });


  it('resumes a suspended runtime before opening the mobile live terminal', async () => {
    class TestApp {}
    applySessionManagementMixin(TestApp);
    const calls = [];
    const session = {
      id: 'session-hibernated',
      name: 'Hibernated',
      engine: 'codex',
      intendedState: 'hibernated'
    };
    const app = new TestApp();
    app.viewerLabel = 'Reviewer';
    app.isMobile = () => true;
    app.mobileLiveTerminalModalEl = document.createElement('div');
    app.mobileLiveTerminalFrameEl = document.createElement('iframe');
    app.sessionService = {
      resumeRuntime: vi.fn(async () => {
        calls.push('resume');
        appStore.setState({
          sessions: [{ ...session, intendedState: 'active', runtimeState: 'hot' }]
        });
      })
    };
    app._getSessionById = (sessionId) => (appStore.getState().sessions || []).find(candidate => candidate.id === sessionId) || null;
    app._openSessionInTtydFrame = vi.fn(async () => {
      calls.push('open');
      return { ok: true, terminalAccess: { state: 'owner' } };
    });
    app._stopMobileSnapshotPolling = vi.fn();
    app._repairTerminalGeometry = vi.fn(async () => null);
    app.scheduleTerminalFrameLayoutSync = vi.fn();
    app._updateTerminalInputStatus = vi.fn();
    app.reconnectManager = { setCurrentSession: vi.fn() };
    appStore.setState({ sessions: [session] });

    await app.openMobileLiveTerminal('session-hibernated');

    expect(app.sessionService.resumeRuntime).toHaveBeenCalledWith('session-hibernated');
    expect(app._openSessionInTtydFrame).toHaveBeenCalledWith(
      'session-hibernated',
      app.mobileLiveTerminalFrameEl,
      { forceTtyd: true }
    );
    expect(calls).toEqual(['resume', 'open']);
  });

  it('shows a visible error when mobile suspended runtime resume fails', async () => {
    class TestApp {}
    applySessionManagementMixin(TestApp);
    const session = {
      id: 'session-hibernated',
      name: 'Hibernated',
      engine: 'codex',
      intendedState: 'hibernated'
    };
    const app = new TestApp();
    app.isMobile = () => true;
    app.mobileLiveTerminalModalEl = document.createElement('div');
    app.mobileLiveTerminalFrameEl = document.createElement('iframe');
    app.sessionService = {
      resumeRuntime: vi.fn(async () => {
        throw new Error('resume failed');
      })
    };
    app._getSessionById = (sessionId) => (appStore.getState().sessions || []).find(candidate => candidate.id === sessionId) || null;
    app._setCurrentSessionUiState = vi.fn();
    app._openSessionInTtydFrame = vi.fn();
    appStore.setState({ sessions: [session] });

    await app.openMobileLiveTerminal('session-hibernated');

    expect(app._openSessionInTtydFrame).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Runtime再開に失敗しました');
    expect(document.body.textContent).toContain('resume failed');
  });
});
