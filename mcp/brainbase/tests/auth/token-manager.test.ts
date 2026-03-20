/**
 * TokenManager Test
 * JWT + Refresh Token管理のテスト
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TokenManager } from '../../src/auth/token-manager.js';

describe('TokenManager', () => {
  let testTokensPath: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // Backup original env
    originalEnv = { ...process.env };

    // Create temporary tokens file
    const testDir = path.join(os.tmpdir(), 'brainbase-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    testTokensPath = path.join(testDir, 'tokens.json');

    const mockTokens = {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      issued_at: Math.floor(Date.now() / 1000),
    };

    await fs.writeFile(testTokensPath, JSON.stringify(mockTokens, null, 2));

    // Override env to use test tokens path
    process.env.HOME = path.dirname(testDir);
    delete process.env.BRAINBASE_GRAPH_API_TOKEN;
  });

  afterEach(async () => {
    // Restore original env
    process.env = originalEnv;

    // Clean up test tokens file
    try {
      await fs.unlink(testTokensPath);
      await fs.rmdir(path.dirname(testTokensPath));
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('getToken', () => {
    it('should load token from file', async () => {
      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      const token = await tokenManager.getToken();

      assert.strictEqual(token, 'mock-access-token');
    });

    it('should use environment variable if available', async () => {
      // Delete the tokens file so environment variable is used
      await fs.unlink(testTokensPath);

      process.env.BRAINBASE_GRAPH_API_TOKEN = 'env-token';

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      const token = await tokenManager.getToken();

      assert.strictEqual(token, 'env-token');
    });

    it('should auto-refresh if token is expired', async () => {
      // Create expired token
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiredTokens = {
        access_token: 'expired-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        issued_at: nowSeconds - 7200, // Issued 2 hours ago, expired 1 hour ago
      };

      await fs.writeFile(testTokensPath, JSON.stringify(expiredTokens, null, 2));

      // Mock fetch for refresh
      const mockFetch = mock.fn(async (url: string, options: any) => {
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        };
      });

      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      const token = await tokenManager.getToken();

      // Should have refreshed
      assert.strictEqual(token, 'new-access-token');
      assert.strictEqual(mockFetch.mock.callCount(), 1);

      // Verify refresh endpoint was called
      const [url, options] = mockFetch.mock.calls[0].arguments;
      assert.strictEqual(url, 'http://localhost:31013/auth/refresh');
      assert.strictEqual(options.method, 'POST');

      const body = JSON.parse(options.body);
      assert.strictEqual(body.refresh_token, 'mock-refresh-token');
    });
  });

  describe('refresh', () => {
    it('should refresh token and save to file', async () => {
      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'refreshed-token',
          refresh_token: 'new-refresh-token',
          expires_in: 7200,
        }),
      }));

      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      // Load token first to have refresh_token available
      await tokenManager.getToken();

      await tokenManager.refresh();

      // Verify new token is saved
      const newToken = await tokenManager.getToken();
      assert.strictEqual(newToken, 'refreshed-token');

      // Verify file was updated
      const savedTokens = JSON.parse(await fs.readFile(testTokensPath, 'utf-8'));
      assert.strictEqual(savedTokens.access_token, 'refreshed-token');
      assert.strictEqual(savedTokens.refresh_token, 'new-refresh-token');
    });

    it('should handle refresh failure gracefully', async () => {
      const mockFetch = mock.fn(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }));

      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      // Load token first to have refresh_token available
      await tokenManager.getToken();

      await assert.rejects(
        async () => await tokenManager.refresh(),
        /Token refresh failed: 401 Unauthorized/
      );
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired token', () => {
      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiredToken = {
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
        issued_at: nowSeconds - 7200, // Issued 2 hours ago, expires in 1 hour = expired 1 hour ago
      };

      // @ts-ignore - accessing private method for testing
      const isExpired = tokenManager.isTokenExpired(expiredToken);
      assert.strictEqual(isExpired, true);
    });

    it('should return false for valid token', () => {
      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const validToken = {
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
        issued_at: nowSeconds, // Issued now, expires in 1 hour
      };

      // @ts-ignore - accessing private method for testing
      const isExpired = tokenManager.isTokenExpired(validToken);
      assert.strictEqual(isExpired, false);
    });

    it('should treat token as valid if expires_in/issued_at is missing', () => {
      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      const tokenWithoutExpiry = {
        access_token: 'token',
        refresh_token: 'refresh',
      };

      // @ts-ignore - accessing private method for testing
      const isExpired = tokenManager.isTokenExpired(tokenWithoutExpiry);
      assert.strictEqual(isExpired, false); // Assume valid when no expiration data
    });
  });
});
