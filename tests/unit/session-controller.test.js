import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSession,
  archiveSessionAPI,
  checkWorktreeStatus
} from '../../public/modules/session-controller.js';

// Mock fetch
global.fetch = vi.fn();

describe('session-controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('should call API to create session', async () => {
      const sessionData = {
        id: 'session-123',
        name: 'New Session',
        path: '/brainbase/project'
      };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await createSession(sessionData);

      expect(fetch).toHaveBeenCalledWith('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData)
      });
    });
  });

  describe('archiveSessionAPI', () => {
    it('should call archive API endpoint', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, needsMerge: false })
      });

      const result = await archiveSessionAPI('session-123');

      expect(fetch).toHaveBeenCalledWith('/api/sessions/session-123/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipMergeCheck: false })
      });
      expect(result.success).toBe(true);
    });

    it('should return needsMerge status', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          needsMerge: true,
          status: { commitsAhead: 3, hasUncommittedChanges: true }
        })
      });

      const result = await archiveSessionAPI('session-123');

      expect(result.needsMerge).toBe(true);
      expect(result.status.commitsAhead).toBe(3);
    });
  });

  describe('checkWorktreeStatus', () => {
    it('should call worktree status API', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          hasUnmergedChanges: true,
          commitsAhead: 2
        })
      });

      const result = await checkWorktreeStatus('session-123');

      expect(fetch).toHaveBeenCalledWith('/api/sessions/session-123/worktree-status');
      expect(result.hasUnmergedChanges).toBe(true);
    });

    it('should return null on error', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await checkWorktreeStatus('session-123');

      expect(result).toBeNull();
    });
  });
});
