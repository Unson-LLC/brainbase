import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  filterArchivedSessions,
  sortByCreatedDate,
  getUniqueProjects
} from '../../public/modules/archive-modal-controller.js';

describe('archive-modal-controller', () => {
  describe('filterArchivedSessions', () => {
    const sessions = [
      { id: 's1', name: 'Alpha Session', path: '/brainbase/project', archived: true },
      { id: 's2', name: 'Beta Session', path: '/unson/project', archived: true },
      { id: 's3', name: 'Gamma Session', path: '/brainbase/other', archived: true },
      { id: 's4', name: 'Active', archived: false }
    ];

    it('should return only archived sessions', () => {
      const result = filterArchivedSessions(sessions, '', '');

      expect(result).toHaveLength(3);
      expect(result.every(s => s.archived)).toBe(true);
    });

    it('should filter by search term (case insensitive)', () => {
      const result = filterArchivedSessions(sessions, 'alpha', '');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alpha Session');
    });

    it('should filter by project', () => {
      const result = filterArchivedSessions(sessions, '', 'brainbase');

      expect(result).toHaveLength(2);
      expect(result.every(s => s.path.includes('brainbase'))).toBe(true);
    });

    it('should filter by both search and project', () => {
      const result = filterArchivedSessions(sessions, 'gamma', 'brainbase');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Gamma Session');
    });

    it('should handle General project filter', () => {
      const sessionsWithGeneral = [
        ...sessions,
        { id: 's5', name: 'General Session', archived: true }
      ];

      const result = filterArchivedSessions(sessionsWithGeneral, '', 'General');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('General Session');
    });
  });

  describe('sortByCreatedDate', () => {
    it('should sort by created date descending (newest first)', () => {
      const sessions = [
        { id: 's1', created: '2025-01-01' },
        { id: 's2', created: '2025-03-01' },
        { id: 's3', created: '2025-02-01' }
      ];

      const sorted = sortByCreatedDate(sessions);

      expect(sorted[0].id).toBe('s2');
      expect(sorted[1].id).toBe('s3');
      expect(sorted[2].id).toBe('s1');
    });

    it('should handle missing created dates', () => {
      const sessions = [
        { id: 's1', created: '2025-01-01' },
        { id: 's2' },
        { id: 's3', created: '2025-02-01' }
      ];

      const sorted = sortByCreatedDate(sessions);

      expect(sorted[0].id).toBe('s3');
      expect(sorted[1].id).toBe('s1');
      expect(sorted[2].id).toBe('s2');
    });

    it('should not mutate original array', () => {
      const sessions = [
        { id: 's1', created: '2025-01-01' },
        { id: 's2', created: '2025-03-01' }
      ];

      sortByCreatedDate(sessions);

      expect(sessions[0].id).toBe('s1');
    });
  });

  describe('getUniqueProjects', () => {
    it('should return unique projects from archived sessions', () => {
      const sessions = [
        { path: '/brainbase/a', archived: true },
        { path: '/unson/b', archived: true },
        { path: '/brainbase/c', archived: true },
        { path: '/tech-knight/d', archived: false }
      ];

      const projects = getUniqueProjects(sessions);

      expect(projects).toContain('brainbase');
      expect(projects).toContain('unson');
      expect(projects).not.toContain('tech-knight');
    });

    it('should return General for sessions without path', () => {
      const sessions = [
        { archived: true },
        { path: '/brainbase/a', archived: true }
      ];

      const projects = getUniqueProjects(sessions);

      expect(projects).toContain('General');
      expect(projects).toContain('brainbase');
    });

    it('should return sorted unique list', () => {
      const sessions = [
        { path: '/zeims/a', archived: true },
        { path: '/brainbase/b', archived: true }
      ];

      const projects = getUniqueProjects(sessions);

      expect(projects[0]).toBe('brainbase');
      expect(projects[1]).toBe('zeims');
    });
  });
});
