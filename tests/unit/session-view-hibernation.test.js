import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifySessionsForGroupedList, formatHibernationBlockers } from '../../public/modules/ui/views/session-view.js';
import { SessionView } from '../../public/modules/ui/views/session-view.js';
import { renderSessionRowHTML } from '../../public/modules/session-list-renderer.js';
import { appStore } from '../../public/modules/core/store.js';

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
    container.querySelector('[data-id="session-codex"] .hibernate-session-btn').click();
    container.querySelector('[data-id="session-hibernated"] .resume-runtime-btn').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(hibernateSession).toHaveBeenCalledWith('session-codex');
    expect(resumeRuntime).toHaveBeenCalledWith('session-hibernated');
  });

  it('formats hibernation blockers as human-readable text', () => {
    const text = formatHibernationBlockers(['pending_input', 'missing_restore_metadata']);

    expect(text).toContain('未送信の入力があります');
    expect(text).toContain('再開に必要なCodex復元情報がありません');
    expect(text).not.toContain('pending_input');
  });
});
