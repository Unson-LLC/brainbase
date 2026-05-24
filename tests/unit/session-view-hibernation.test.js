import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHibernationFailureMessage, classifySessionsForGroupedList, formatHibernationBlockers } from '../../public/modules/ui/views/session-view.js';
import { SessionView } from '../../public/modules/ui/views/session-view.js';
import { renderSessionRowHTML } from '../../public/modules/session-list-renderer.js';
import { appStore } from '../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';

describe('SessionView hibernation grouping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps hibernated and broken sessions visible in grouped list mode', () => {
    const grouped = classifySessionsForGroupedList([
      { id: 'active', intendedState: 'active' },
      { id: 'paused', intendedState: 'paused' },
      { id: 'hibernated', intendedState: 'hibernated' },
      { id: 'broken', intendedState: 'broken' },
      { id: 'archived', intendedState: 'archived' }
    ]);

    expect(grouped.activeSessions.map(session => session.id)).toEqual(['active']);
    expect(grouped.pausedSessions.map(session => session.id)).toEqual(['paused']);
    expect(grouped.hibernatedSessions.map(session => session.id)).toEqual(['hibernated', 'broken']);
  });

  it('wires hibernate and resume-runtime buttons through the SessionView action surface', async () => {
    const hibernateSession = vi.fn(async () => ({ success: true }));
    const resumeRuntime = vi.fn(async () => ({ success: true }));
    const view = new SessionView({
      sessionService: { hibernateSession, resumeRuntime },
      fileViewerService: {}
    });
    view._logSessionMenuDebug = () => {};
    const activeSession = {
      id: 'session-codex',
      name: 'Codex',
      engine: 'codex',
      intendedState: 'active'
    };
    const hibernatedSession = {
      id: 'session-hibernated',
      name: 'Hibernated',
      engine: 'codex',
      intendedState: 'hibernated'
    };
    appStore.setState({ sessions: [activeSession, hibernatedSession] });
    const container = document.createElement('div');
    container.innerHTML = [
      renderSessionRowHTML(activeSession, { project: 'brainbase' }),
      renderSessionRowHTML(hibernatedSession, { project: 'brainbase' })
    ].join('');

    view.attachActionHandlersToContainer(container, { enableDrag: false });
    const hibernateButtons = container.querySelectorAll('[data-id="session-codex"] .hibernate-session-btn');
    expect(hibernateButtons.length).toBeGreaterThan(0);
    hibernateButtons[hibernateButtons.length - 1].click();
    const resumeButtons = container.querySelectorAll('[data-id="session-hibernated"] .resume-runtime-btn');
    expect(resumeButtons.length).toBeGreaterThan(1);
    resumeButtons[resumeButtons.length - 1].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(hibernateSession).toHaveBeenCalledWith('session-codex');
    expect(resumeRuntime).toHaveBeenCalledWith('session-hibernated');
  });

  it('shows immediate and rejected sleep feedback with blocker reasons', async () => {
    const hibernateSession = vi.fn(async () => {
      throw { blockers: ['unknown_process_ownership', 'weak_process_ownership'] };
    });
    const view = new SessionView({
      sessionService: { hibernateSession, resumeRuntime: vi.fn() },
      fileViewerService: {}
    });
    view._logSessionMenuDebug = () => {};
    const activeSession = {
      id: 'session-codex',
      name: 'Codex',
      engine: 'codex',
      intendedState: 'active'
    };
    appStore.setState({ sessions: [activeSession] });
    const container = document.createElement('div');
    container.innerHTML = renderSessionRowHTML(activeSession, { project: 'brainbase' });

    view.attachActionHandlersToContainer(container, { enableDrag: false });
    const hibernateButtons = container.querySelectorAll('[data-id="session-codex"] .hibernate-session-btn');
    expect(hibernateButtons.length).toBeGreaterThan(1);
    hibernateButtons[0].click();

    expect(document.body.textContent).toContain('スリープ判定中');
    hibernateButtons.forEach((button) => {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(document.body.textContent).toContain('スリープできません');
    expect(document.body.textContent).not.toContain('スリープ判定中');
    expect(document.body.textContent).toContain('所有者不明のプロセス');
    expect(document.body.textContent).toContain('所有判定が弱い');
    expect(document.body.textContent).toContain('再試行してください');
    hibernateButtons.forEach((button) => {
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute('aria-busy')).toBe(false);
    });

    document.body.innerHTML = '';
    container.innerHTML = renderSessionRowHTML(activeSession, { project: 'brainbase' });
    view.attachActionHandlersToContainer(container, { enableDrag: false });
    const rowActionButtons = container.querySelectorAll('[data-id="session-codex"] .hibernate-session-btn');
    rowActionButtons[rowActionButtons.length - 1].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(hibernateSession).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('スリープできません');
  });

  it('adds next-step guidance to hibernation failure messages', () => {
    expect(buildHibernationFailureMessage('所有者不明のプロセス')).toContain('再試行してください');
    expect(buildHibernationFailureMessage('')).toContain('確認: 入力中の端末');
  });

  it('formats hibernation blockers as human-readable text', () => {
    const text = formatHibernationBlockers(['pending_input', 'unsupported_engine', 'missing_restore_metadata']);

    expect(text).toContain('未送信の入力があります');
    expect(text).toContain('このエンジンはまだスリープに対応していません');
    expect(text).toContain('再開に必要なCodex復元情報がありません');
    expect(text).not.toContain('pending_input');
  });

  it('falls back to a full render when UI state events do not name target session ids', async () => {
    const view = new SessionView({
      sessionService: { hibernateSession: vi.fn(), resumeRuntime: vi.fn() },
      fileViewerService: {}
    });
    view.container = document.createElement('div');
    view._scheduleRender = vi.fn();
    view._refreshSessionRows = vi.fn();
    view._reorderTimelineRows = vi.fn();
    appStore.setState({
      ui: {
        ...appStore.getState().ui,
        sessionListView: 'timeline'
      }
    });

    view._setupEventListeners();
    try {
      await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, {});
      await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: [] });
      await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: 'session-codex' });
      await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: ['session-codex'] });

      expect(view._scheduleRender).toHaveBeenCalledTimes(3);
      expect(view._refreshSessionRows).toHaveBeenCalledTimes(1);
      expect(view._refreshSessionRows).toHaveBeenCalledWith(['session-codex']);
      expect(view._reorderTimelineRows).toHaveBeenCalledTimes(4);
    } finally {
      view.unmount();
    }
  });
});
