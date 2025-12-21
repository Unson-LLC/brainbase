import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateStore } from '../../lib/state-store.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('StateStore - Migration', () => {
  let testStateFile;
  let stateStore;

  beforeEach(async () => {
    // テスト用の一時ファイルパス
    testStateFile = path.join(__dirname, `test-state-${Date.now()}.json`);
    stateStore = new StateStore(testStateFile);
  });

  afterEach(async () => {
    // テストファイルをクリーンアップ
    try {
      await fs.unlink(testStateFile);
    } catch (err) {
      // ファイルが存在しない場合は無視
    }
  });

  describe('intendedState migration', () => {
    it('should migrate archived:true sessions to intendedState:"archived"', async () => {
      // Arrange: 旧スキーマのデータを作成
      const oldSchema = {
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            archived: true,
            ttydRunning: false,
            path: '/test/path'
          }
        ]
      };
      await fs.writeFile(testStateFile, JSON.stringify(oldSchema));

      // Act: StateStoreを初期化（マイグレーション実行）
      await stateStore.init();

      // Assert: intendedStateが追加されている
      const state = stateStore.get();
      expect(state.sessions[0].intendedState).toBe('archived');
    });

    it('should migrate archived:false sessions to intendedState:"stopped"', async () => {
      // Arrange
      const oldSchema = {
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            archived: false,
            ttydRunning: false,
            path: '/test/path'
          }
        ]
      };
      await fs.writeFile(testStateFile, JSON.stringify(oldSchema));

      // Act
      await stateStore.init();

      // Assert
      const state = stateStore.get();
      expect(state.sessions[0].intendedState).toBe('stopped');
    });

    it('should remove ttydRunning field after migration', async () => {
      // Arrange
      const oldSchema = {
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            archived: false,
            ttydRunning: true,
            path: '/test/path'
          }
        ]
      };
      await fs.writeFile(testStateFile, JSON.stringify(oldSchema));

      // Act
      await stateStore.init();

      // Assert: ttydRunningが削除されている
      const state = stateStore.get();
      expect(state.sessions[0]).not.toHaveProperty('ttydRunning');
    });

    it('should remove runtimeStatus field after migration', async () => {
      // Arrange
      const oldSchema = {
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            archived: false,
            runtimeStatus: { ttydRunning: true },
            path: '/test/path'
          }
        ]
      };
      await fs.writeFile(testStateFile, JSON.stringify(oldSchema));

      // Act
      await stateStore.init();

      // Assert
      const state = stateStore.get();
      expect(state.sessions[0]).not.toHaveProperty('runtimeStatus');
    });

    it('should add hookStatus:null if missing', async () => {
      // Arrange
      const oldSchema = {
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            archived: false,
            path: '/test/path'
          }
        ]
      };
      await fs.writeFile(testStateFile, JSON.stringify(oldSchema));

      // Act
      await stateStore.init();

      // Assert
      const state = stateStore.get();
      expect(state.sessions[0].hookStatus).toBeNull();
    });

    it('should preserve existing intendedState if already present', async () => {
      // Arrange: 新スキーマのデータ
      const newSchema = {
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            intendedState: 'active',
            hookStatus: { status: 'working', timestamp: 1234567890 },
            path: '/test/path'
          }
        ]
      };
      await fs.writeFile(testStateFile, JSON.stringify(newSchema));

      // Act
      await stateStore.init();

      // Assert: intendedStateが保持されている
      const state = stateStore.get();
      expect(state.sessions[0].intendedState).toBe('active');
    });

    it('should persist migrated state to file', async () => {
      // Arrange
      const oldSchema = {
        sessions: [
          {
            id: 'session-1',
            name: 'Test Session',
            archived: true,
            ttydRunning: false,
            path: '/test/path'
          }
        ]
      };
      await fs.writeFile(testStateFile, JSON.stringify(oldSchema));

      // Act
      await stateStore.init();

      // Assert: ファイルが更新されている
      const fileContent = await fs.readFile(testStateFile, 'utf-8');
      const savedState = JSON.parse(fileContent);
      expect(savedState.sessions[0].intendedState).toBe('archived');
      expect(savedState.sessions[0]).not.toHaveProperty('ttydRunning');
    });
  });
});
