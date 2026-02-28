import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadTasksFromAPI,
  completeTask,
  deferTaskPriority,
  updateTask,
  deleteTaskById
} from '../../public/modules/task-controller.js';

// Mock fetch
global.fetch = vi.fn();

describe('task-controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadTasksFromAPI', () => {
    it('should fetch and return tasks', async () => {
      const mockTasks = [
        { id: 't1', name: 'Task 1' },
        { id: 't2', name: 'Task 2' }
      ];
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTasks)
      });

      const tasks = await loadTasksFromAPI();

      expect(fetch).toHaveBeenCalledWith('/api/tasks');
      expect(tasks).toEqual(mockTasks);
    });

    it('should return empty array on error', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const tasks = await loadTasksFromAPI();

      expect(tasks).toEqual([]);
    });
  });

  describe('completeTask', () => {
    it('should call API with completed status', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await completeTask('task-123');

      expect(fetch).toHaveBeenCalledWith('/api/tasks/task-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
    });
  });

  describe('deferTaskPriority', () => {
    it('should lower priority from high to medium', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await deferTaskPriority('task-123', 'high');

      expect(fetch).toHaveBeenCalledWith('/api/tasks/task-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'medium', status: 'todo' })
      });
    });

    it('should lower priority from medium to low', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await deferTaskPriority('task-123', 'medium');

      expect(fetch).toHaveBeenCalledWith('/api/tasks/task-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'low', status: 'todo' })
      });
    });

    it('should keep low priority as low', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await deferTaskPriority('task-123', 'low');

      expect(fetch).toHaveBeenCalledWith('/api/tasks/task-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'low', status: 'todo' })
      });
    });
  });

  describe('updateTask', () => {
    it('should call API with task updates', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await updateTask('task-123', { name: 'Updated', priority: 'high' });

      expect(fetch).toHaveBeenCalledWith('/api/tasks/task-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated', priority: 'high' })
      });
    });
  });

  describe('deleteTaskById', () => {
    it('should call DELETE API', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await deleteTaskById('task-123');

      expect(fetch).toHaveBeenCalledWith('/api/tasks/task-123', {
        method: 'DELETE'
      });
    });
  });
});
