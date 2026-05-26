import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchState,
  saveState,
  updateSession,
  removeSession,
  addSession
} from '../../public/modules/state-api.js';

vi.mock('../../public/modules/core/http-client.js', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

const { httpClient } = await import('../../public/modules/core/http-client.js');

describe('state-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchState', () => {
    it('should fetch state from /api/state', async () => {
      const mockState = { sessions: [{ id: 'test-1' }] };
      httpClient.get.mockResolvedValueOnce(mockState);

      const result = await fetchState();

      expect(httpClient.get).toHaveBeenCalledWith('/api/state');
      expect(result).toEqual(mockState);
    });

    it('should return empty state on error', async () => {
      httpClient.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchState();

      expect(result).toEqual({ sessions: [] });
    });
  });

  describe('saveState', () => {
    it('should POST state to /api/state', async () => {
      const newState = { sessions: [{ id: 'new-session' }] };
      httpClient.post.mockResolvedValueOnce(newState);

      await saveState(newState);

      expect(httpClient.post).toHaveBeenCalledWith('/api/state', newState);
    });
  });

  describe('updateSession', () => {
    it('should update a specific session', async () => {
      httpClient.patch.mockResolvedValueOnce({ id: 'session-1', name: 'New Name' });

      await updateSession('session-1', { name: 'New Name' });

      expect(httpClient.patch).toHaveBeenCalledWith('/api/state/sessions/session-1', { name: 'New Name' });
    });
  });

  describe('removeSession', () => {
    it('should remove a session by id', async () => {
      httpClient.delete.mockResolvedValueOnce({ success: true });

      await removeSession('session-1');

      expect(httpClient.delete).toHaveBeenCalledWith('/api/state/sessions/session-1');
    });
  });

  describe('addSession', () => {
    it('should add a new session', async () => {
      const newSession = { id: 'session-2', name: 'New' };
      httpClient.post.mockResolvedValueOnce(newSession);

      await addSession(newSession);

      expect(httpClient.post).toHaveBeenCalledWith('/api/state/sessions', newSession);
    });
  });
});
