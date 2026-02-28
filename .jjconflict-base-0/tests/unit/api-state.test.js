import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StateStore } from '../../lib/state-store.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('GET /api/state - Response Structure', () => {
  let app;
  let testStateFile;
  let stateStore;
  let activeSessions;

  beforeEach(async () => {
    // テスト用アプリケーションのセットアップ
    app = express();
    app.use(express.json());

    // テスト用の一時ファイルパス
    testStateFile = path.join(__dirname, `test-state-${Date.now()}.json`);
    stateStore = new StateStore(testStateFile);

    // activeSessions（メモリ上）のモック
    activeSessions = new Map();

    // GET /api/state エンドポイント実装
    app.get('/api/state', (req, res) => {
      const state = stateStore.get();

      const sessionsWithStatus = (state.sessions || []).map(session => {
        const ttydRunning = activeSessions.has(session.id);
        const needsRestart = session.intendedState === 'active' && !ttydRunning;

        return {
          ...session,
          // 後方互換性のためttydRunningも残す（将来削除予定）
          ttydRunning,
          // 新しいruntimeStatus
          runtimeStatus: {
            ttydRunning,
            needsRestart
          }
        };
      });

      res.json({
        ...state,
        sessions: sessionsWithStatus
      });
    });
  });

  afterEach(async () => {
    // クリーンアップ
    try {
      await fs.unlink(testStateFile);
    } catch (err) {
      // ファイルが存在しない場合は無視
    }
  });

  it('should add runtimeStatus to each session', async () => {
    // Arrange
    const testState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: null,
          path: '/test/path'
        }
      ]
    };
    await fs.writeFile(testStateFile, JSON.stringify(testState));
    await stateStore.init();

    // Act
    const response = await request(app).get('/api/state');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.sessions[0]).toHaveProperty('runtimeStatus');
    expect(response.body.sessions[0].runtimeStatus).toHaveProperty('ttydRunning');
    expect(response.body.sessions[0].runtimeStatus).toHaveProperty('needsRestart');
  });

  it('should set needsRestart=true when intendedState=active and ttyd not running', async () => {
    // Arrange
    const testState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: null,
          path: '/test/path'
        }
      ]
    };
    await fs.writeFile(testStateFile, JSON.stringify(testState));
    await stateStore.init();
    // activeSessions is empty (ttyd not running)

    // Act
    const response = await request(app).get('/api/state');

    // Assert
    expect(response.body.sessions[0].runtimeStatus.ttydRunning).toBe(false);
    expect(response.body.sessions[0].runtimeStatus.needsRestart).toBe(true);
  });

  it('should set needsRestart=false when intendedState=active and ttyd running', async () => {
    // Arrange
    const testState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: null,
          path: '/test/path'
        }
      ]
    };
    await fs.writeFile(testStateFile, JSON.stringify(testState));
    await stateStore.init();
    activeSessions.set('session-1', { port: 3001, process: {} });

    // Act
    const response = await request(app).get('/api/state');

    // Assert
    expect(response.body.sessions[0].runtimeStatus.ttydRunning).toBe(true);
    expect(response.body.sessions[0].runtimeStatus.needsRestart).toBe(false);
  });

  it('should set needsRestart=false when intendedState=stopped', async () => {
    // Arrange
    const testState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'stopped',
          hookStatus: null,
          path: '/test/path'
        }
      ]
    };
    await fs.writeFile(testStateFile, JSON.stringify(testState));
    await stateStore.init();

    // Act
    const response = await request(app).get('/api/state');

    // Assert
    expect(response.body.sessions[0].runtimeStatus.needsRestart).toBe(false);
  });

  it('should set needsRestart=false when intendedState=archived', async () => {
    // Arrange
    const testState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'archived',
          hookStatus: null,
          path: '/test/path'
        }
      ]
    };
    await fs.writeFile(testStateFile, JSON.stringify(testState));
    await stateStore.init();

    // Act
    const response = await request(app).get('/api/state');

    // Assert
    expect(response.body.sessions[0].runtimeStatus.needsRestart).toBe(false);
  });

  it('should maintain backward compatibility with ttydRunning field', async () => {
    // Arrange
    const testState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: null,
          path: '/test/path'
        }
      ]
    };
    await fs.writeFile(testStateFile, JSON.stringify(testState));
    await stateStore.init();
    activeSessions.set('session-1', { port: 3001, process: {} });

    // Act
    const response = await request(app).get('/api/state');

    // Assert: ttydRunningフィールドが存在し、runtimeStatus.ttydRunningと一致
    expect(response.body.sessions[0]).toHaveProperty('ttydRunning');
    expect(response.body.sessions[0].ttydRunning).toBe(
      response.body.sessions[0].runtimeStatus.ttydRunning
    );
  });
});
