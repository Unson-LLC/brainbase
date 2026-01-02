import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  groupSessionsByProject,
  createSessionId,
  buildSessionObject
} from '../../public/modules/session-manager.js';

// Mock project-mapping to provide CORE_PROJECTS
vi.mock('../../public/modules/project-mapping.js', () => ({
  CORE_PROJECTS: ['unson', 'tech-knight', 'baao'],
  getProjectFromPath: (path) => {
    if (!path) return 'general';
    // Extract project name from path like /path/to/workspace/PROJECT_NAME/...
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return 'general';

    // Find 'workspace' in path and return the next segment
    const workspaceIndex = parts.findIndex(p => p === 'workspace');
    if (workspaceIndex !== -1 && workspaceIndex < parts.length - 1) {
      return parts[workspaceIndex + 1];
    }

    // Fallback: return the last non-empty segment
    return parts[parts.length - 1] || 'general';
  }
}));

describe('session-manager', () => {
  describe('groupSessionsByProject', () => {
    it('should group sessions by project path', () => {
      const sessions = [
        { id: '1', path: '/path/to/workspace/unson/src' },
        { id: '2', path: '/path/to/workspace/tech-knight' },
        { id: '3', path: '/path/to/workspace/unson' }
      ];

      const result = groupSessionsByProject(sessions);

      expect(result['unson']).toHaveLength(2);
      expect(result['tech-knight']).toHaveLength(1);
    });

    it('should put sessions without path in general', () => {
      const sessions = [
        { id: '1', path: null },
        { id: '2' } // no path
      ];

      const result = groupSessionsByProject(sessions);

      expect(result['general']).toHaveLength(2);
    });

    it('should filter out archived sessions', () => {
      const sessions = [
        { id: '1', path: '/path/to/workspace/unson', intendedState: 'stopped' },
        { id: '2', path: '/path/to/workspace/unson', intendedState: 'archived' }
      ];

      const result = groupSessionsByProject(sessions, { excludeArchived: true });

      expect(result['unson']).toHaveLength(1);
    });

    it('should include empty core projects', () => {
      const sessions = [];

      const result = groupSessionsByProject(sessions, { includeEmptyProjects: true });

      expect(result).toHaveProperty('unson');
      expect(result).toHaveProperty('tech-knight');
      expect(result['unson']).toHaveLength(0);
    });
  });

  describe('createSessionId', () => {
    it('should create unique session id with prefix', async () => {
      const id1 = createSessionId('session');
      await new Promise(r => setTimeout(r, 10)); // 10ms delay to ensure different timestamp
      const id2 = createSessionId('session');

      expect(id1).toMatch(/^session-\d+$/);
      expect(id1).not.toBe(id2);
    });

    it('should create task session id', () => {
      const id = createSessionId('task', 'TASK-123');

      expect(id).toMatch(/^task-TASK-123-\d+$/);
    });
  });

  describe('buildSessionObject', () => {
    it('should build session object with required fields', () => {
      const result = buildSessionObject({
        id: 'test-session',
        name: 'Test Session',
        path: '/some/path'
      });

      expect(result.id).toBe('test-session');
      expect(result.name).toBe('Test Session');
      expect(result.path).toBe('/some/path');
      expect(result.intendedState).toBe('paused');
      expect(result.created).toBeDefined();
    });

    it('should include optional fields', () => {
      const result = buildSessionObject({
        id: 'test-session',
        name: 'Test',
        path: '/path',
        initialCommand: '/task 123',
        taskId: 'TASK-123',
        worktree: { path: '/worktree' }
      });

      expect(result.initialCommand).toBe('/task 123');
      expect(result.taskId).toBe('TASK-123');
      expect(result.worktree).toEqual({ path: '/worktree' });
    });
  });
});
