import { describe, it, expect } from 'vitest';
import { projectMappingReady } from '../../public/modules/project-mapping.js';
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

    it('should render favorite state as an accessible menu action', () => {
      const session = { id: 's1', name: 'Favorite' };

      const html = renderSessionRowHTML(session, {
        isActive: false,
        project: 'general',
        isFavorite: true
      });

      expect(html).toContain('favorite');
      expect(html).toContain('favorite-session-btn active');
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('data-lucide="star"');
      expect(html).not.toContain('session-favorite-btn');
    });

    it('should show worktree badge when session has worktree', () => {
      const session = {
        id: 's1',
        name: 'With Worktree',
        worktree: { path: '/worktree/path' }
      };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).toContain('has-worktree');
      expect(html).not.toContain('merge-session-btn');
      expect(html).not.toContain('Merge to base branch');
    });

    it('should render only current session management actions in overflow menu', () => {
      const session = {
        id: 's-actions',
        name: 'Action Session',
        worktree: { path: '/worktree/path' }
      };

      const html = renderSessionRowHTML(session, {
        isActive: false,
        project: 'general',
        isFavorite: false
      });

      expect(html).toContain('名前を変更');
      expect(html).toContain('お気に入りに追加');
      expect(html).not.toContain('一時停止');
      expect(html).not.toContain('pause-session-btn');
      expect(html).toContain('アーカイブ');
      expect(html).toContain('削除');
      expect(html).not.toContain('Commit tree');
      expect(html).not.toContain('commit-tree-btn');
      expect(html).not.toContain('Merge to base branch');
      expect(html).not.toContain('merge-session-btn');
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

    it('should render hibernated sessions with explicit resume-runtime action', () => {
      const session = {
        id: 'session-hibernated',
        name: 'Hibernated Session',
        intendedState: 'hibernated',
        hibernatedAt: new Date().toISOString()
      };

      const html = renderSessionRowHTML(session, { isActive: false, project: 'general' });

      expect(html).toContain('session-child-row hibernated');
      expect(html).toContain('スリープ中');
      expect(html).toContain('再開');
      expect(html).toContain('resume-runtime-btn');
      expect(html).not.toContain('hibernate-session-btn');
    });

    it('should render manual sleep action only for active Codex sessions', () => {
      const codexSession = {
        id: 'session-codex',
        name: 'Codex Session',
        engine: 'codex',
        intendedState: 'active'
      };
      const claudeSession = {
        id: 'session-claude',
        name: 'Claude Session',
        engine: 'claude',
        intendedState: 'active'
      };

      const codexHtml = renderSessionRowHTML(codexSession, { isActive: false, project: 'general' });
      expect(codexHtml).toContain('hibernate-session-btn');
      expect(codexHtml).toContain('session-lifecycle-action');
      expect(codexHtml).toContain('スリープ');
      expect(renderSessionRowHTML(claudeSession, { isActive: false, project: 'general' })).not.toContain('hibernate-session-btn');
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
            unpushed: true,
            unmerged: true,
            conflict: true,
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
      expect(html).toContain('title="Working copy has uncommitted changes"');
      expect(html).toContain('unpushed');
      expect(html).toContain('title="Local commits are not pushed"');
      expect(html).toContain('unmerged');
      expect(html).toContain('title="Changes are not integrated into the base branch"');
      expect(html).toContain('conflict');
      expect(html).toContain('title="Working copy has unresolved conflicts"');
      expect(html).toContain('pending');
      expect(html).toContain('file: app.js');
      expect(html).toContain('Reconnecting');
      expect(html).not.toContain('session-attention-badge');
    });

    it('should render unpushed without dirty when only local commits are pending', () => {
      const session = {
        id: 'session-unpushed',
        name: 'Unpushed Session'
      };

      const html = renderSessionRowHTML(session, {
        isActive: false,
        project: 'general',
        sessionUiState: {
          summary: {
            repo: 'brainbase',
            baseBranch: 'develop',
            dirty: false,
            unpushed: true,
            changesNotPushed: 1
          }
        }
      });

      expect(html).toContain('unpushed');
      expect(html).toContain('chip-unpushed');
      expect(html).not.toContain('chip-dirty');
      expect(html).not.toContain('>dirty<');
    });

    it('should not render token usage chip in session list', () => {
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

      expect(html).not.toContain('context used');
      expect(html).not.toContain('ctx ');
      expect(html).not.toContain('chip-token');
    });

    it('should render runtime memory posture from diagnostics summary', () => {
      const session = {
        id: 'session-runtime-memory',
        name: 'Runtime Memory Session'
      };

      const html = renderSessionRowHTML(session, {
        isActive: false,
        project: 'general',
        sessionUiState: {
          summary: {
            runtimeInventory: {
              runtimePresence: 'hot',
              rssKb: 15360,
              processCount: 3,
              processesByCategory: {
                codex: 1,
                mcp: 2
              }
            }
          }
        }
      });

      expect(html).toContain('hot 15 MB');
      expect(html).toContain('chip-runtime-memory');
      expect(html).toContain('Runtime hot, RSS 15 MB, processes 3');
      expect(html).toContain('codex:1');
      expect(html).toContain('mcp:2');
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

    it('should prefer the project icon configured in config.yml for session rows', async () => {
      await projectMappingReady;
      const session = {
        id: 'session-brainbase',
        name: 'Brainbase Design'
      };

      const html = renderSessionRowHTML(session, {
        isActive: false,
        project: 'brainbase',
        showProjectEmoji: true
      });

      expect(html).toContain('session-config-icon');
      expect(html).toContain('BB');
      expect(html).not.toContain('data-lucide="palette"');
      expect(html).not.toContain('session-project-emoji"');
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
