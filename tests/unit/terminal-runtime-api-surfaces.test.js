import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { HealthController } from '../../server/controllers/health-controller.js';
import { installRuntimeHandlers } from '../../server/controllers/session/runtime-handlers.js';
import { createTerminalRouter } from '../../server/routes/terminal.js';

describe('terminal runtime recovery API surfaces', () => {
  it('CON-7 /api/terminal/reconcile exposes reconnect_ttyd recovery actions', async () => {
    const reconcile = vi.fn(async () => ({
      status: 'degraded',
      actions: [{
        sessionId: 'session-1',
        type: 'reconnect_ttyd',
        reason: 'stale_ttyd_process',
        success: true
      }]
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/terminal', createTerminalRouter({
      terminalRuntimeReconciler: { reconcile }
    }));

    const response = await request(app)
      .post('/api/terminal/reconcile')
      .send({ sessionId: 'session-1', dryRun: false, recover: true })
      .expect(200);

    expect(reconcile).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dryRun: false,
      recover: true
    });
    expect(response.body.actions).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'reconnect_ttyd',
      reason: 'stale_ttyd_process',
      success: true
    }));
  });

  it('CON-7 /api/health/terminal exposes stale_ttyd_process as degraded health', async () => {
    const healthController = new HealthController({
      terminalRuntimeReconciler: {
        getHealth: vi.fn(async () => ({
          status: 'degraded',
          sessions: { degraded: 1 },
          issues: [{
            sessionId: 'session-1',
            type: 'stale_ttyd_process',
            severity: 'critical'
          }]
        }))
      }
    });
    const app = express();
    app.get('/api/health/terminal', healthController.getTerminalHealth);

    const response = await request(app)
      .get('/api/health/terminal')
      .expect(200);

    expect(response.body.status).toBe('degraded');
    expect(response.body.issues).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'stale_ttyd_process',
      severity: 'critical'
    }));
  });

  it('story-brainbase-session-resume-integrity-guard CON-5 getRuntime strips unsafe proxyPath for ttyd_port_conflict', async () => {
    const controller = {
      ownership: {
        getTerminalAccessState: vi.fn(() => ({ state: 'owner' }))
      },
      runtimeRegistry: {
        getSession: vi.fn(() => null)
      },
      runtimeReconciler: {
        reconcile: vi.fn(async () => ({
          health: {
            sessionHealth: [{
              sessionId: 'session-1',
              runtimeState: 'degraded',
              issues: [{
                type: 'ttyd_port_conflict',
                severity: 'critical',
                sessionId: 'session-1'
              }],
              observed: {
                ttyd: {
                  running: true,
                  portConflict: {
                    persistedPort: 40015,
                    observedSessionId: 'session-b'
                  }
                }
              }
            }]
          }
        }))
      },
      _getSessionById: vi.fn(() => ({
        id: 'session-1',
        intendedState: 'active',
        ttydProcess: { pid: 123, port: 40015 },
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: '/console/session-b',
          runtimeState: 'degraded'
        }
      })),
      _resolveViewerLabel: vi.fn(() => 'Local / Mac'),
      _withViewerRuntimeStatus: vi.fn((runtimeStatus) => runtimeStatus),
      _respondError: vi.fn((res, _message, error) => res.status(500).json({ error: error.message }))
    };
    installRuntimeHandlers(controller);

    const req = {
      params: { id: 'session-1' },
      query: { viewerId: 'viewer-1' }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };

    await controller.getRuntime(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.runtimeStatus).toMatchObject({
      ttydRunning: false,
      proxyPath: null,
      interactiveUrl: null,
      inputReady: false
    });
    expect(res.body.runtimeStatus.issues).toContainEqual(expect.objectContaining({
      type: 'ttyd_port_conflict',
      severity: 'critical'
    }));
  });

  it('CON-7 session terminal recovery endpoint exposes reconnect_ttyd actions', async () => {
    const reconcile = vi.fn(async () => ({
      actions: [{
        sessionId: 'session-1',
        type: 'reconnect_ttyd',
        reason: 'stale_ttyd_process',
        success: true
      }]
    }));
    const controller = {
      runtimeReconciler: { reconcile },
      _getSessionById: vi.fn(() => ({ id: 'session-1', intendedState: 'active' })),
      _respondError: vi.fn((res, _message, error) => res.status(500).json({ error: error.message }))
    };
    installRuntimeHandlers(controller);

    const req = {
      params: { id: 'session-1' },
      body: { dryRun: false }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };

    await controller.recoverTerminal(req, res);

    expect(reconcile).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dryRun: false,
      recover: true
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.actions).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'reconnect_ttyd',
      reason: 'stale_ttyd_process',
      success: true
    }));
  });

  it('CON-7 session terminal recovery endpoint exposes failed reconnect actions', async () => {
    const reconcile = vi.fn(async () => ({
      status: 'degraded',
      actions: [{
        sessionId: 'session-1',
        type: 'reconnect_ttyd',
        reason: 'stale_ttyd_process',
        success: false,
        error: 'ttyd startup timeout'
      }]
    }));
    const controller = {
      runtimeReconciler: { reconcile },
      _getSessionById: vi.fn(() => ({ id: 'session-1', intendedState: 'active' })),
      _respondError: vi.fn((res, _message, error) => res.status(500).json({ error: error.message }))
    };
    installRuntimeHandlers(controller);

    const req = {
      params: { id: 'session-1' },
      body: { dryRun: false }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };

    await controller.recoverTerminal(req, res);

    expect(reconcile).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dryRun: false,
      recover: true
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.actions).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'reconnect_ttyd',
      reason: 'stale_ttyd_process',
      success: false,
      error: 'ttyd startup timeout'
    }));
  });

  it('CON-9 session terminal recovery endpoint rejects startup shell sessions', async () => {
    const reconcile = vi.fn();
    const controller = {
      runtimeReconciler: { reconcile },
      _getSessionById: vi.fn(() => ({
        id: 'session-startup-pending',
        intendedState: 'active',
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'Preparing workspace'
      })),
      _respondError: vi.fn((res, _message, error) => res.status(500).json({ error: error.message }))
    };
    installRuntimeHandlers(controller);

    const req = {
      params: { id: 'session-startup-pending' },
      body: { dryRun: false }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };

    await controller.recoverTerminal(req, res);

    expect(reconcile).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: 'Session startup is not ready for terminal recovery.',
      startupStatus: 'pending',
      startupPhase: 'worktree',
      startupMessage: 'Preparing workspace'
    });
  });

  it('CON-9 session terminal recovery endpoint returns 404 for missing sessions', async () => {
    const reconcile = vi.fn();
    const controller = {
      runtimeReconciler: { reconcile },
      _getSessionById: vi.fn(() => null),
      _respondError: vi.fn((res, _message, error) => res.status(500).json({ error: error.message }))
    };
    installRuntimeHandlers(controller);

    const req = {
      params: { id: 'missing' },
      body: { dryRun: false }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };

    await controller.recoverTerminal(req, res);

    expect(reconcile).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });
});
