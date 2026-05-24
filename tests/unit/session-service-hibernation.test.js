import { describe, expect, it, vi } from 'vitest';

import { SessionService } from '../../public/modules/domain/session/session-service.js';

describe('SessionService hibernation actions', () => {
  it('posts manual hibernate and updates local display state without a second persistence PATCH', async () => {
    const service = new SessionService();
    service.store = {
      getState: vi.fn(() => ({
        sessions: [{
          id: 'session-alpha',
          name: 'Alpha',
          intendedState: 'active',
          hibernateFailureReason: 'old failure',
          hibernatePartialStop: true
        }]
      })),
      setState: vi.fn()
    };
    service.httpClient = {
      post: vi.fn(async () => ({
        intendedState: 'hibernated',
        runtimeState: 'hibernated',
        hibernatedAt: '2026-05-23T00:00:00.000Z',
        runtimeInventorySummary: { processCount: 2 },
        restoreMetadata: {
          restoreStrategy: 'codex_resume',
          restoreCommand: 'codex resume thread-alpha'
        }
      }))
    };
    service.updateSession = vi.fn(async () => ({ success: true }));
    service.refreshSessionUiSummaries = vi.fn(async () => ({}));
    service.eventBus = { emit: vi.fn(async () => ({})) };

    const result = await service.hibernateSession('session-alpha');

    expect(service.httpClient.post).toHaveBeenCalledWith('/api/sessions/session-alpha/hibernate', {
      reason: 'manual'
    });
    expect(service.updateSession).not.toHaveBeenCalled();
    expect(service.store.setState).toHaveBeenCalledWith({
      sessions: [expect.objectContaining({
        id: 'session-alpha',
        intendedState: 'hibernated',
        runtimeState: 'hibernated',
        restoreStrategy: 'codex_resume',
        restoreCommand: 'codex resume thread-alpha',
        hibernateFailureReason: null,
        hibernatePartialStop: false
      })]
    });
    expect(service.refreshSessionUiSummaries).toHaveBeenCalledWith(['session-alpha']);
    expect(service.eventBus.emit).toHaveBeenCalledWith('session:updated', {
      sessionId: 'session-alpha',
      updates: expect.objectContaining({ intendedState: 'hibernated' })
    });
    expect(result).toMatchObject({ success: true, sessionId: 'session-alpha' });
  });

  it('posts resume-runtime with viewer identity and updates local display state without a second persistence PATCH', async () => {
    const service = new SessionService();
    service.viewerId = 'viewer-1';
    service.viewerLabel = 'Reviewer';
    service.store = {
      getState: vi.fn(() => ({
        sessions: [{
          id: 'session-alpha',
          name: 'Alpha',
          intendedState: 'hibernated',
          hibernateFailureReason: 'old failure',
          hibernatePartialStop: true
        }]
      })),
      setState: vi.fn()
    };
    service.httpClient = {
      post: vi.fn(async () => ({
        success: true,
        intendedState: 'active',
        runtimeState: 'hot',
        proxyPath: '/console/session-alpha/?viewerId=viewer-1'
      }))
    };
    service.updateSession = vi.fn(async () => ({ success: true }));
    service.refreshSessionUiSummaries = vi.fn(async () => ({}));
    service.eventBus = { emit: vi.fn(async () => ({})) };

    const result = await service.resumeRuntime('session-alpha');

    expect(service.httpClient.post).toHaveBeenCalledWith('/api/sessions/session-alpha/resume-runtime', {
      viewerId: 'viewer-1',
      viewerLabel: 'Reviewer'
    });
    expect(service.updateSession).not.toHaveBeenCalled();
    expect(service.store.setState).toHaveBeenCalledWith({
      sessions: [expect.objectContaining({
        id: 'session-alpha',
        intendedState: 'active',
        runtimeState: 'hot',
        resumeFailureReason: null,
        hibernateFailureReason: null,
        hibernatePartialStop: false
      })]
    });
    expect(result).toMatchObject({ success: true, sessionId: 'session-alpha' });
  });

  it('marks local display state broken when resume-runtime returns broken failure metadata', async () => {
    const service = new SessionService();
    service.viewerId = 'viewer-1';
    service.viewerLabel = 'Reviewer';
    service.store = {
      getState: vi.fn(() => ({
        sessions: [{ id: 'session-alpha', name: 'Alpha', intendedState: 'hibernated' }]
      })),
      setState: vi.fn()
    };
    const error = new Error('Failed to resume hibernated runtime');
    Object.assign(error, {
      intendedState: 'broken',
      runtimeState: 'broken',
      resumeFailureReason: 'tmux session did not become ready',
      resumeFailedAt: '2026-05-23T00:00:00.000Z'
    });
    service.httpClient = {
      post: vi.fn(async () => {
        throw error;
      })
    };
    service.refreshSessionUiSummaries = vi.fn(async () => ({}));
    service.eventBus = { emit: vi.fn(async () => ({})) };

    await expect(service.resumeRuntime('session-alpha')).rejects.toThrow('Failed to resume hibernated runtime');

    expect(service.store.setState).toHaveBeenCalledWith({
      sessions: [expect.objectContaining({
        id: 'session-alpha',
        intendedState: 'broken',
        runtimeState: 'broken',
        resumeFailureReason: 'tmux session did not become ready'
      })]
    });
    expect(service.refreshSessionUiSummaries).toHaveBeenCalledWith(['session-alpha']);
    expect(service.eventBus.emit).toHaveBeenCalledWith('session:updated', {
      sessionId: 'session-alpha',
      updates: expect.objectContaining({ intendedState: 'broken' })
    });
  });

  it('keeps local display state active when hibernate stop returns retryable failure metadata', async () => {
    const service = new SessionService();
    service.store = {
      getState: vi.fn(() => ({
        sessions: [{ id: 'session-alpha', name: 'Alpha', intendedState: 'active' }]
      })),
      setState: vi.fn()
    };
    const error = new Error('Failed to hibernate session');
    Object.assign(error, {
      intendedState: 'active',
      runtimeState: 'hot',
      hibernateFailureReason: 'EPERM',
      hibernateFailedAt: '2026-05-23T00:00:00.000Z',
      hibernatePartialStop: false
    });
    service.httpClient = {
      post: vi.fn(async () => {
        throw error;
      })
    };
    service.refreshSessionUiSummaries = vi.fn(async () => ({}));
    service.eventBus = { emit: vi.fn(async () => ({})) };

    await expect(service.hibernateSession('session-alpha')).rejects.toThrow('Failed to hibernate session');

    expect(service.store.setState).toHaveBeenCalledWith({
      sessions: [expect.objectContaining({
        id: 'session-alpha',
        intendedState: 'active',
        runtimeState: 'hot',
        hibernateFailureReason: 'EPERM',
        hibernatePartialStop: false
      })]
    });
    expect(service.refreshSessionUiSummaries).toHaveBeenCalledWith(['session-alpha']);
    expect(service.eventBus.emit).toHaveBeenCalledWith('session:updated', {
      sessionId: 'session-alpha',
      updates: expect.objectContaining({ intendedState: 'active' })
    });
  });

  it('marks local display state broken when hibernate stop partially killed runtime processes', async () => {
    const service = new SessionService();
    service.store = {
      getState: vi.fn(() => ({
        sessions: [{ id: 'session-alpha', name: 'Alpha', intendedState: 'active' }]
      })),
      setState: vi.fn()
    };
    const error = new Error('Failed to hibernate session');
    Object.assign(error, {
      intendedState: 'broken',
      runtimeState: 'broken',
      hibernateFailureReason: 'partial stop',
      hibernateFailedAt: '2026-05-23T00:00:00.000Z',
      hibernatePartialStop: true
    });
    service.httpClient = {
      post: vi.fn(async () => {
        throw error;
      })
    };
    service.refreshSessionUiSummaries = vi.fn(async () => ({}));
    service.eventBus = { emit: vi.fn(async () => ({})) };

    await expect(service.hibernateSession('session-alpha')).rejects.toThrow('Failed to hibernate session');

    expect(service.store.setState).toHaveBeenCalledWith({
      sessions: [expect.objectContaining({
        id: 'session-alpha',
        intendedState: 'broken',
        runtimeState: 'broken',
        hibernateFailureReason: 'partial stop',
        hibernatePartialStop: true
      })]
    });
    expect(service.refreshSessionUiSummaries).toHaveBeenCalledWith(['session-alpha']);
    expect(service.eventBus.emit).toHaveBeenCalledWith('session:updated', {
      sessionId: 'session-alpha',
      updates: expect.objectContaining({ intendedState: 'broken' })
    });
  });

  it('keeps hibernate failure metadata in the stale session cache', () => {
    const writes = new Map();
    const originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: vi.fn((key, value) => writes.set(key, value)),
        getItem: vi.fn((key) => writes.get(key) || null)
      }
    });

    try {
      const service = new SessionService();
      service.store = {
        getState: vi.fn(() => ({
          sessions: [{
            id: 'session-alpha',
            name: 'Alpha',
            intendedState: 'broken',
            runtimeState: 'broken',
            hibernateFailureReason: 'partial stop',
            hibernateFailedAt: '2026-05-23T00:00:00.000Z',
            hibernatePartialStop: true
          }],
          testMode: false,
          preferences: {},
          currentSessionId: 'session-alpha'
        }))
      };

      service._saveToCache();

      const cached = JSON.parse(writes.get('bb:session-state-cache:v1'));
      expect(cached.sessions[0]).toMatchObject({
        id: 'session-alpha',
        intendedState: 'broken',
        runtimeState: 'broken',
        hibernateFailureReason: 'partial stop',
        hibernateFailedAt: '2026-05-23T00:00:00.000Z',
        hibernatePartialStop: true
      });
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage
      });
    }
  });
});
