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
      const existingState = {
        sessions: [
          { id: 'session-1', name: 'Old Name' },
          { id: 'session-2', name: 'Other' }
        ]
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(existingState)
        })
        .mockResolvedValueOnce({ ok: true });

      await updateSession('session-1', { name: 'New Name' });

      const saveCall = mockFetch.mock.calls[1];
      const savedState = JSON.parse(saveCall[1].body);
      expect(savedState.sessions[0].name).toBe('New Name');
      expect(savedState.sessions[1].name).toBe('Other');
    });
  });

  describe('removeSession', () => {
    it('should remove a session by id', async () => {
      const existingState = {
        sessions: [
          { id: 'session-1' },
          { id: 'session-2' }
        ]
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(existingState)
        })
        .mockResolvedValueOnce({ ok: true });

      await removeSession('session-1');

      const saveCall = mockFetch.mock.calls[1];
      const savedState = JSON.parse(saveCall[1].body);
      expect(savedState.sessions).toHaveLength(1);
      expect(savedState.sessions[0].id).toBe('session-2');
    });
  });

  describe('addSession', () => {
    it('should add a new session', async () => {
      const existingState = { sessions: [{ id: 'session-1' }] };
      const newSession = { id: 'session-2', name: 'New' };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(existingState)
        })
        .mockResolvedValueOnce({ ok: true });

      await addSession(newSession);

      const saveCall = mockFetch.mock.calls[1];
      const savedState = JSON.parse(saveCall[1].body);
      expect(savedState.sessions).toHaveLength(2);
      expect(savedState.sessions[1]).toEqual(newSession);
    });
  });
});
