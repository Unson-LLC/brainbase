import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StateStore } from '../../lib/state-store.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('POST /api/state - Sanitization', () => {
  let app;
  let testStateFile;
  let stateStore;

  beforeEach(async () => {
    // テスト用アプリケーションのセットアップ
    app = express();
    app.use(express.json());

    // テスト用の一時ファイルパス
    testStateFile = path.join(__dirname, `test-state-${Date.now()}.json`);
    stateStore = new StateStore(testStateFile);

    // POST /api/state エンドポイント実装（サニタイズあり）
    app.post('/api/state', async (req, res) => {
      // Remove computed fields from sessions before persisting
      const sanitizedState = {
        ...req.body,
        sessions: (req.body.sessions || []).map(session => {
          // Remove runtime-only fields
          const { ttydRunning, runtimeStatus, ...persistentFields } = session;
          return persistentFields;
        })
      };

      const newState = await stateStore.update(sanitizedState);
      res.json(newState);
    });

    // 初期化
    await stateStore.init();
  });

  afterEach(async () => {
    // クリーンアップ
    try {
      await fs.unlink(testStateFile);
    } catch (err) {
      // ファイルが存在しない場合は無視
    }
  });

  it('should remove ttydRunning field when saving state', async () => {
    // Arrange: ttydRunningを含むデータ
    const stateWithComputed = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: null,
          path: '/test/path',
          ttydRunning: true  // これは削除されるべき
        }
      ]
    };

    // Act
    await request(app)
      .post('/api/state')
      .send(stateWithComputed)
      .expect(200);

    // Assert: ファイルにttydRunningが保存されていないこと
    const fileContent = await fs.readFile(testStateFile, 'utf-8');
    const savedState = JSON.parse(fileContent);
    expect(savedState.sessions[0]).not.toHaveProperty('ttydRunning');
  });

  it('should remove runtimeStatus field when saving state', async () => {
    // Arrange
    const stateWithComputed = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: null,
          path: '/test/path',
          runtimeStatus: {  // これは削除されるべき
            ttydRunning: true,
            needsRestart: false
          }
        }
      ]
    };

    // Act
    await request(app)
      .post('/api/state')
      .send(stateWithComputed)
      .expect(200);

    // Assert
    const fileContent = await fs.readFile(testStateFile, 'utf-8');
    const savedState = JSON.parse(fileContent);
    expect(savedState.sessions[0]).not.toHaveProperty('runtimeStatus');
  });

  it('should preserve all other session fields', async () => {
    // Arrange
    const stateWithComputed = {
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: { status: 'working', timestamp: 1234567890 },
          path: '/test/path',
          icon: 'test-icon',
          archived: false,
          ttydRunning: true,
          runtimeStatus: { ttydRunning: true, needsRestart: false }
        }
      ]
    };

    // Act
    await request(app)
      .post('/api/state')
      .send(stateWithComputed)
      .expect(200);

    // Assert: 他のフィールドは保持されていること
    const fileContent = await fs.readFile(testStateFile, 'utf-8');
    const savedState = JSON.parse(fileContent);
    expect(savedState.sessions[0].id).toBe('session-1');
    expect(savedState.sessions[0].name).toBe('Test Session');
    expect(savedState.sessions[0].intendedState).toBe('active');
    expect(savedState.sessions[0].hookStatus).toEqual({ status: 'working', timestamp: 1234567890 });
    expect(savedState.sessions[0].path).toBe('/test/path');
    expect(savedState.sessions[0].icon).toBe('test-icon');
  });

  it('should preserve non-session fields in state', async () => {
    // Arrange
    const stateWithOtherFields = {
      lastOpenTaskId: 'task-123',
      filters: { archived: false },
      readNotifications: ['notif-1', 'notif-2'],
      focusSession: 'session-1',
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          intendedState: 'active',
          hookStatus: null,
          path: '/test/path',
          ttydRunning: true
        }
      ]
    };

    // Act
    await request(app)
      .post('/api/state')
      .send(stateWithOtherFields)
      .expect(200);

    // Assert: sessions以外のフィールドは影響を受けないこと
    const fileContent = await fs.readFile(testStateFile, 'utf-8');
    const savedState = JSON.parse(fileContent);
    expect(savedState.lastOpenTaskId).toBe('task-123');
    expect(savedState.filters).toEqual({ archived: false });
    expect(savedState.readNotifications).toEqual(['notif-1', 'notif-2']);
    expect(savedState.focusSession).toBe('session-1');
  });
});
