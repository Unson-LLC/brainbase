import { describe, expect, it } from 'vitest';

import {
  buildHibernationFailureMessage,
  classifySessionsForGroupedList,
  formatHibernationBlockers
} from '../../public/modules/ui/views/session-view.js';

// After Phase K3b the vanilla session renderer + its action handlers were retired
// (the React island owns rendering, and hibernate is dispatched via the island menu ->
// app bridge -> sessionService.hibernateSession). The surviving, still-exported surface
// is the grouped-list classifier and the hibernation message helpers, covered here.

describe('SessionView surviving surface (post K3b)', () => {
  it('keeps hibernated and broken sessions visible in grouped list mode', () => {
    const grouped = classifySessionsForGroupedList([
      { id: 'active', intendedState: 'active' },
      { id: 'paused', intendedState: 'paused' },
      { id: 'hibernated', intendedState: 'hibernated' },
      { id: 'broken', intendedState: 'broken' },
      { id: 'archived', intendedState: 'archived' }
    ]);

    expect(grouped.activeSessions.map(s => s.id)).toEqual(['active']);
    expect(grouped.pausedSessions.map(s => s.id)).toEqual(['paused']);
    expect(grouped.hibernatedSessions.map(s => s.id)).toEqual(['hibernated', 'broken']);
  });

  it('treats sessions with no intendedState as active', () => {
    const grouped = classifySessionsForGroupedList([{ id: 'fresh' }]);
    expect(grouped.activeSessions.map(s => s.id)).toEqual(['fresh']);
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

  it('returns empty string for no blockers', () => {
    expect(formatHibernationBlockers([])).toBe('');
    expect(formatHibernationBlockers()).toBe('');
  });
});
