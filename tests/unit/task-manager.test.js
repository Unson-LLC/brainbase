import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFocusTask,
  sortTasksByPriority,
  filterTasks,
  getNextPriority
} from '../../public/modules/task-manager.js';

describe('task-manager', () => {
  describe('getFocusTask', () => {
    it('should return in-progress task first', () => {
      const tasks = [
        { id: '1', status: 'todo', priority: 'high' },
        { id: '2', status: 'in-progress', priority: 'low' },
        { id: '3', status: 'todo', priority: 'high' }
      ];

      const result = getFocusTask(tasks);
      expect(result.id).toBe('2');
    });

    it('should return high priority with due date second', () => {
      const tasks = [
        { id: '1', status: 'todo', priority: 'high', due: '2025-12-15' },
        { id: '2', status: 'todo', priority: 'high', due: '2025-12-10' },
        { id: '3', status: 'todo', priority: 'medium' }
      ];

      const result = getFocusTask(tasks);
      expect(result.id).toBe('2'); // Earlier due date
    });

    it('should return any high priority if no due dates', () => {
      const tasks = [
        { id: '1', status: 'todo', priority: 'medium' },
        { id: '2', status: 'todo', priority: 'high' },
        { id: '3', status: 'todo', priority: 'low' }
      ];

      const result = getFocusTask(tasks);
      expect(result.id).toBe('2');
    });

    it('should return first non-low priority if no high priority', () => {
      const tasks = [
        { id: '1', status: 'todo', priority: 'low' },
        { id: '2', status: 'todo', priority: 'medium' },
        { id: '3', status: 'todo', priority: 'low' }
      ];

      const result = getFocusTask(tasks);
      expect(result.id).toBe('2');
    });

    it('should return null if no active tasks', () => {
      const tasks = [
        { id: '1', status: 'done', priority: 'high' }
      ];

      const result = getFocusTask(tasks);
      expect(result).toBeNull();
    });

    it('should exclude done tasks', () => {
      const tasks = [
        { id: '1', status: 'done', priority: 'high' },
        { id: '2', status: 'todo', priority: 'low' }
      ];

      const result = getFocusTask(tasks);
      expect(result.id).toBe('2');
    });
  });

  describe('sortTasksByPriority', () => {
    it('should sort by priority then due date', () => {
      const tasks = [
        { id: '1', priority: 'low', due: '2025-12-10' },
        { id: '2', priority: 'high', due: '2025-12-15' },
        { id: '3', priority: 'high', due: '2025-12-10' },
        { id: '4', priority: 'medium' }
      ];

      const result = sortTasksByPriority(tasks);
      expect(result[0].id).toBe('3'); // high + earlier due
      expect(result[1].id).toBe('2'); // high + later due
      expect(result[2].id).toBe('4'); // medium
      expect(result[3].id).toBe('1'); // low
    });

    it('should handle tasks without priority', () => {
      const tasks = [
        { id: '1' },
        { id: '2', priority: 'high' }
      ];

      const result = sortTasksByPriority(tasks);
      expect(result[0].id).toBe('2');
    });
  });

  describe('filterTasks', () => {
    it('should filter by name', () => {
      const tasks = [
        { id: '1', name: 'Fix bug', project: 'proj-a' },
        { id: '2', name: 'Add feature', project: 'proj-b' }
      ];

      const result = filterTasks(tasks, 'bug');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should filter by project', () => {
      const tasks = [
        { id: '1', name: 'Fix bug', project: 'proj-a' },
        { id: '2', name: 'Add feature', project: 'proj-b' }
      ];

      const result = filterTasks(tasks, 'proj-b');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should be case-insensitive', () => {
      const tasks = [
        { id: '1', name: 'Fix BUG', project: 'proj-a' }
      ];

      const result = filterTasks(tasks, 'bug');
      expect(result).toHaveLength(1);
    });

    it('should return all tasks if filter is empty', () => {
      const tasks = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' }
      ];

      const result = filterTasks(tasks, '');
      expect(result).toHaveLength(2);
    });
  });

  describe('getNextPriority', () => {
    it('should lower priority by one level', () => {
      expect(getNextPriority('high')).toBe('medium');
      expect(getNextPriority('medium')).toBe('low');
      expect(getNextPriority('low')).toBe('low'); // Already lowest
    });

    it('should default to medium if undefined', () => {
      expect(getNextPriority(undefined)).toBe('low');
      expect(getNextPriority(null)).toBe('low');
    });
  });
});
