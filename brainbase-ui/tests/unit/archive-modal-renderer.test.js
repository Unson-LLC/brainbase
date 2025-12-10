import { describe, it, expect } from 'vitest';
import {
  renderArchivedSessionItemHTML,
  renderArchiveListHTML
} from '../../public/modules/archive-modal-renderer.js';

describe('archive-modal-renderer', () => {
  describe('renderArchivedSessionItemHTML', () => {
    it('should render archived session item', () => {
      const session = {
        id: 'session-archived',
        name: 'Old Session',
        path: '/some/path'
      };

      const html = renderArchivedSessionItemHTML(session);

      expect(html).toContain('archive-session-item');
      expect(html).toContain('Old Session');
      expect(html).toContain('data-id="session-archived"');
    });

    it('should include restore and delete buttons', () => {
      const session = { id: 's1', name: 'Test' };
      const html = renderArchivedSessionItemHTML(session);

      expect(html).toContain('restore-session-btn');
      expect(html).toContain('delete-archived-btn');
    });

    it('should use id as name fallback', () => {
      const session = { id: 'fallback-session' };
      const html = renderArchivedSessionItemHTML(session);

      expect(html).toContain('fallback-session');
    });
  });

  describe('renderArchiveListHTML', () => {
    it('should render list of archived sessions', () => {
      const sessions = [
        { id: 's1', name: 'Session 1', archived: true },
        { id: 's2', name: 'Session 2', archived: true },
        { id: 's3', name: 'Active', archived: false }
      ];

      const html = renderArchiveListHTML(sessions);

      expect(html).toContain('Session 1');
      expect(html).toContain('Session 2');
      expect(html).not.toContain('Active');
    });

    it('should render empty message when no archived sessions', () => {
      const sessions = [
        { id: 's1', name: 'Active', archived: false }
      ];

      const html = renderArchiveListHTML(sessions);

      expect(html).toContain('アーカイブ済みセッションなし');
    });

    it('should handle empty sessions array', () => {
      const html = renderArchiveListHTML([]);

      expect(html).toContain('アーカイブ済みセッションなし');
    });
  });
});
