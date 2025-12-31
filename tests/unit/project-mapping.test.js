import { describe, it, expect } from 'vitest';
import {
  PROJECT_PATH_MAP,
  getProjectPath,
  getProjectFromPath,
  WORKSPACE_ROOT
} from '../../public/modules/project-mapping.js';

describe('project-mapping', () => {
  describe('WORKSPACE_ROOT', () => {
    it('should be exported and accessible', () => {
      expect(WORKSPACE_ROOT).toBeDefined();
      expect(typeof WORKSPACE_ROOT).toBe('string');
      expect(WORKSPACE_ROOT).toBe('/path/to/workspace');
    });
  });

  describe('PROJECT_PATH_MAP', () => {
    it('should have mappings for core projects', () => {
      expect(PROJECT_PATH_MAP).toHaveProperty('unson');
      expect(PROJECT_PATH_MAP).toHaveProperty('tech-knight');
      expect(PROJECT_PATH_MAP).toHaveProperty('brainbase');
      expect(PROJECT_PATH_MAP).toHaveProperty('salestailor');
    });
  });

  describe('getProjectPath', () => {
    it('should return mapped path for known project', () => {
      expect(getProjectPath('unson')).toBe('/path/to/workspace/projects/unson');
      expect(getProjectPath('tech-knight')).toBe('/path/to/workspace/projects/tech-knight');
    });

    it('should return workspace root for general project', () => {
      expect(getProjectPath('General')).toBe(WORKSPACE_ROOT);
      expect(getProjectPath('general')).toBe(WORKSPACE_ROOT);
    });

    it('should handle case-insensitive General project', () => {
      // Fix: 大文字小文字統一（General → general）
      expect(getProjectPath('general')).toBe(getProjectPath('General'));
    });

    it('should return constructed path for unknown project', () => {
      expect(getProjectPath('new-project')).toBe('/path/to/workspace/new-project');
    });

    it('should return workspace root for null/undefined', () => {
      expect(getProjectPath(null)).toBe(WORKSPACE_ROOT);
      expect(getProjectPath(undefined)).toBe(WORKSPACE_ROOT);
    });
  });

  describe('getProjectFromPath', () => {
    it('should extract project name from path', () => {
      expect(getProjectFromPath('/path/to/workspace/unson')).toBe('unson');
      expect(getProjectFromPath('/path/to/workspace/tech-knight/src')).toBe('tech-knight');
    });

    it('should return general for workspace root', () => {
      expect(getProjectFromPath('/path/to/workspace')).toBe('general');
      expect(getProjectFromPath('/path/to/workspace/')).toBe('general');
    });

    it('should return general for null/undefined path', () => {
      expect(getProjectFromPath(null)).toBe('general');
      expect(getProjectFromPath(undefined)).toBe('general');
    });

    it('should handle worktree paths', () => {
      expect(getProjectFromPath('/path/to/workspace/.worktrees/session-123-brainbase-ui')).toBe('brainbase');
    });
  });
});
