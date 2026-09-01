import { describe, it, expect } from 'vitest';
import {
  PROJECT_PATH_MAP,
  getProjectPath,
  getProjectFromPath,
  WORKSPACE_ROOT,
  isProjectSelectableForAccess
} from '../../public/modules/project-mapping.js';

describe('project-mapping', () => {
  describe('WORKSPACE_ROOT', () => {
    it('should be exported and accessible', () => {
      expect(WORKSPACE_ROOT).toBeDefined();
      expect(typeof WORKSPACE_ROOT).toBe('string');
      expect(WORKSPACE_ROOT).toBe('/tmp/brainbase-test-workspace');
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
      expect(getProjectPath('unson')).toBe(`${WORKSPACE_ROOT}/projects/unson`);
      expect(getProjectPath('tech-knight')).toBe(`${WORKSPACE_ROOT}/projects/tech-knight`);
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
      expect(getProjectPath('new-project')).toBe(`${WORKSPACE_ROOT}/new-project`);
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
      expect(getProjectFromPath('/path/to/workspace/.worktrees/session-123-back_office')).toBe('back-office');
      expect(getProjectFromPath('/Volumes/UNSON-DRIVE/brainbase-worktrees/session-123-brainbase-ui')).toBe('brainbase');
    });
  });

  describe('isProjectSelectableForAccess', () => {
    it('allows exact project code access', () => {
      expect(isProjectSelectableForAccess('salestailor', ['salestailor'])).toBe(true);
      expect(isProjectSelectableForAccess('salestailor', ['brainbase'])).toBe(false);
    });

    it('does not infer app parent access without explicit metadata', () => {
      expect(isProjectSelectableForAccess('salestailor-app', ['salestailor'])).toBe(false);
    });

    it('does not remove hyphens to infer access', () => {
      expect(isProjectSelectableForAccess('tech-knight', ['techknight'])).toBe(false);
      expect(isProjectSelectableForAccess('ncom-catalyst', ['ncomcatalyst'])).toBe(false);
    });

    it('does not expand a short grant to an unconfigured project prefix', () => {
      expect(isProjectSelectableForAccess('ncom-catalyst', ['ncom'])).toBe(false);
    });

    it('allows an explicitly configured project alias', () => {
      expect(isProjectSelectableForAccess(
        'ncom-catalyst',
        ['ncom'],
        { aliases: ['ncom'] }
      )).toBe(true);
    });

    it('allows project when github repository code is granted', () => {
      expect(isProjectSelectableForAccess(
        'salestailor-app',
        ['salestailor'],
        { github: { repo: 'salestailor' } }
      )).toBe(true);
    });

    it('treats empty project code list as unrestricted access', () => {
      expect(isProjectSelectableForAccess('salestailor-app', [])).toBe(true);
      expect(isProjectSelectableForAccess('salestailor-app', null)).toBe(true);
    });
  });
});
