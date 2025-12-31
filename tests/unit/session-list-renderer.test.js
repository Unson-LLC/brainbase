import { describe, it, expect } from 'vitest';
import {
  renderSessionRowHTML,
  renderSessionGroupHeaderHTML
} from '../../public/modules/session-list-renderer.js';

describe('session-list-renderer', () => {
  describe('renderSessionRowHTML', () => {
    it('should render basic session row', () => {
      const session = {
        id: 'session-123',
        name: 'Test Session',
        path: '/some/path'
      };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).toContain('session-child-row');
      expect(html).toContain('Test Session');
      expect(html).toContain('data-id="session-123"');
    });

    it('should add active class when isActive is true', () => {
      const session = { id: 's1', name: 'Active' };

      const html = renderSessionRowHTML(session, { isActive: true, project: 'general' });

      expect(html).toContain('active');
    });

    it('should show worktree badge when session has worktree', () => {
      const session = {
        id: 's1',
        name: 'With Worktree',
        worktree: { path: '/worktree/path' }
      };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).toContain('worktree-badge');
      expect(html).toContain('git-branch');
    });

    it('should not show worktree badge when no worktree', () => {
      const session = { id: 's1', name: 'No Worktree' };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).not.toContain('worktree-badge');
    });

    it('should use session.id as name fallback', () => {
      const session = { id: 'fallback-id' };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).toContain('fallback-id');
    });
  });

  describe('renderSessionGroupHeaderHTML', () => {
    it('should render project group header', () => {
      const html = renderSessionGroupHeaderHTML('brainbase', { isExpanded: true });

      expect(html).toContain('session-group-header');
      expect(html).toContain('brainbase');
      expect(html).toContain('folder-open');
    });

    it('should show closed folder icon when collapsed', () => {
      const html = renderSessionGroupHeaderHTML('unson', { isExpanded: false });

      expect(html).toContain('folder"');
      expect(html).not.toContain('folder-open');
    });

    it('should include add button with project title', () => {
      const html = renderSessionGroupHeaderHTML('tech-knight', { isExpanded: true });

      expect(html).toContain('add-project-session-btn');
      expect(html).toContain('New Session in tech-knight');
    });
  });
});
