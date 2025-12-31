import { describe, it, expect } from 'vitest';
import {
  PROJECT_PATH_MAP,
  getProjectPath,
  getProjectFromPath,
  WORKSPACE_ROOT
} from '../../public/modules/project-mapping.js';

describe('project-mapping', () => {
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
      expect(getProjectPath('unson')).toBe('/Users/ksato/workspace/projects/unson');
      expect(getProjectPath('tech-knight')).toBe('/Users/ksato/workspace/projects/tech-knight');
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
      expect(getProjectPath('new-project')).toBe('/Users/ksato/workspace/new-project');
    });

    it('should return workspace root for null/undefined', () => {
      expect(getProjectPath(null)).toBe(WORKSPACE_ROOT);
      expect(getProjectPath(undefined)).toBe(WORKSPACE_ROOT);
    });
  });

  describe('getProjectFromPath', () => {
    it('should extract project name from path', () => {
      expect(getProjectFromPath('/Users/ksato/workspace/unson')).toBe('unson');
      expect(getProjectFromPath('/Users/ksato/workspace/tech-knight/src')).toBe('tech-knight');
    });

    it('should return general for workspace root', () => {
      expect(getProjectFromPath('/Users/ksato/workspace')).toBe('general');
      expect(getProjectFromPath('/Users/ksato/workspace/')).toBe('general');
    });

    it('should return general for null/undefined path', () => {
      expect(getProjectFromPath(null)).toBe('general');
      expect(getProjectFromPath(undefined)).toBe('general');
    });

    it('should handle worktree paths', () => {
      expect(getProjectFromPath('/Users/ksato/workspace/.worktrees/session-123-brainbase-ui')).toBe('brainbase');
    });
  });
});
