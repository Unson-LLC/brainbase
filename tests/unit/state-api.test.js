import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchState,
  saveState,
  updateSession,
  removeSession,
  addSession
} from '../../public/modules/state-api.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('state-api', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('fetchState', () => {
    it('should fetch state from /api/state', async () => {
      const mockState = { sessions: [{ id: 'test-1' }] };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockState)
      });

      const result = await fetchState();

      expect(mockFetch).toHaveBeenCalledWith('/api/state');
      expect(result).toEqual(mockState);
    });

    it('should return empty state on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchState();

      expect(result).toEqual({ sessions: [] });
    });
  });

  describe('saveState', () => {
    it('should POST state to /api/state', async () => {
      const newState = { sessions: [{ id: 'new-session' }] };
      mockFetch.mockResolvedValueOnce({ ok: true });

      await saveState(newState);

      expect(mockFetch).toHaveBeenCalledWith('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newState)
      });
    });
  });

  describe('updateSession', () => {
    it('should update a specific session', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await updateSession('session-1', { name: 'New Name' });

      expect(mockFetch).toHaveBeenCalledWith('/api/state/sessions/session-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' })
      });
    });
  });

  describe('removeSession', () => {
    it('should remove a session by id', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await removeSession('session-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/state/sessions/session-1', {
        method: 'DELETE'
      });
    });
  });

  describe('addSession', () => {
    it('should add a new session', async () => {
      const newSession = { id: 'session-2', name: 'New' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newSession)
      });

      await addSession(newSession);

      expect(mockFetch).toHaveBeenCalledWith('/api/state/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSession)
      });
    });
  });
});
