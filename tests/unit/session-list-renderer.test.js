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
      expect(html).toContain('draggable="false"');
    });

    it('should move draggable attribute to drag handle only', () => {
      const session = {
        id: 'session-drag',
        name: 'Drag Session'
      };

      const draggableHtml = renderSessionRowHTML(session, {
        isActive: false,
        project: 'general',
        isDraggable: true
      });
      const nonDraggableHtml = renderSessionRowHTML(session, {
        isActive: false,
        project: 'general',
        isDraggable: false
      });

      expect(draggableHtml).toContain('<span class="drag-handle" title="Drag to reorder" draggable="true">');
      expect(draggableHtml).toContain('class="session-child-row');
      expect(nonDraggableHtml).toContain('<span class="drag-handle" title="Drag to reorder" draggable="false">');
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

      expect(html).toContain('has-worktree');
      expect(html).toContain('git-merge');
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

    it('should not render paused labels for paused sessions', () => {
      const session = {
        id: 'session-paused',
        name: 'Paused Session',
        intendedState: 'paused',
        pausedReason: 'manual'
      };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).toContain('session-child-row paused');
      expect(html).not.toContain('paused-label');
    });

    it('should not render auto pause wording for tmux restore pauses', () => {
      const session = {
        id: 'session-auto-paused',
        name: 'Auto Paused Session',
        intendedState: 'paused',
        pausedReason: 'tmux_missing_on_restore'
      };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).not.toContain('Auto pause');
      expect(html).not.toContain('paused-label');
    });

    it('should render summary chips and transport badge when sessionUiState is provided', () => {
      const session = {
        id: 'session-rich',
        name: 'Rich Session'
      };

      const html = renderSessionRowHTML(session, {
        isActive: true,
        project: 'general',
        sessionUiState: {
          activity: 'working',
          transport: 'reconnecting',
          attention: 'needs-focus',
          summary: {
            repo: 'brainbase',
            baseBranch: 'develop',
            dirty: true,
            changesNotPushed: 2,
            prStatus: 'open_or_pending'
          },
          recentFile: {
            path: 'src/app.js',
            label: 'app.js'
          }
        }
      });

      expect(html).toContain('brainbase/develop');
      expect(html).toContain('dirty');
      expect(html).toContain('↑2');
      expect(html).toContain('pending');
      expect(html).toContain('file: app.js');
      expect(html).toContain('Reconnecting');
      expect(html).not.toContain('session-attention-badge');
    });

    it('should render context remaining chip when token usage is available', () => {
      const session = {
        id: 'session-token',
        name: 'Token Session',
        conversationSummary: {
          totalConversations: 1,
          tokenUsage: {
            source: 'codex',
            contextWindow: 258400,
            usedTokens: 169200,
            remainingTokens: 89200,
            remainingPercent: 34.52
          }
        }
      };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).toContain('ctx 35%');
      expect(html).toContain('chip-token-warn');
      expect(html).toContain('Context remaining 89K / 258K');
    });

    it('should render waiting indicator when session is waiting for input', () => {
      const session = {
        id: 'session-waiting',
        name: 'Waiting Session'
      };

      const html = renderSessionRowHTML(session, {
        isActive: false,
        project: 'general',
        sessionUiState: {
          activity: 'waiting',
          transport: 'connected',
          attention: 'needs-input'
        }
      });

      expect(html).toContain('session-activity-indicator waiting');
      expect(html).toContain('Waiting for input');
      expect(html).toContain('session-attention-badge');
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
