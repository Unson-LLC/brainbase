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
  let originalFetch: typeof global.fetch;

  function createJwt(issuedAt: number, expiresAt: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: issuedAt, exp: expiresAt })).toString('base64url');
    return `${header}.${payload}.signature`;
  }

  beforeEach(async () => {
    // Backup original env
    originalEnv = { ...process.env };
    originalFetch = global.fetch;

    // Create temporary tokens file
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-test-'));
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
    global.fetch = originalFetch;

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

    it('should prefer the dedicated environment token over a persisted user token', async () => {
      process.env.BRAINBASE_GRAPH_API_TOKEN = 'service-env-token';

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      const token = await tokenManager.getToken();

      assert.strictEqual(token, 'service-env-token');
    });

    it('should ignore the service environment token for owner-scoped requests', async () => {
      process.env.BRAINBASE_GRAPH_API_TOKEN = 'service-env-token';

      const tokenManager = new TokenManager(
        'http://localhost:31013',
        testTokensPath,
        { allowEnvironmentToken: false },
      );
      const token = await tokenManager.getToken();

      assert.strictEqual(token, 'mock-access-token');
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

      const issuedAt = Math.floor(Date.now() / 1000);
      const refreshedJwt = createJwt(issuedAt, issuedAt + 3600);

      // Mock the production CSRF + refresh contract.
      const mockFetch = mock.fn(async (url: string, options: any) => {
        if (url === 'http://localhost:31013/api/csrf-token') {
          return {
            ok: true,
            json: async () => ({ token: 'csrf-token' }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            token: refreshedJwt,
            refresh_token: 'new-refresh-token',
          }),
        };
      });

      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      const token = await tokenManager.getToken();

      // Should have refreshed
      assert.strictEqual(token, refreshedJwt);
      assert.strictEqual(mockFetch.mock.callCount(), 2);

      // Verify the CSRF token and refresh endpoints use the same session.
      const [csrfUrl, csrfOptions] = mockFetch.mock.calls[0].arguments;
      assert.strictEqual(csrfUrl, 'http://localhost:31013/api/csrf-token');
      assert.ok(csrfOptions.headers['X-Session-Id']);

      const [url, options] = mockFetch.mock.calls[1].arguments;
      assert.strictEqual(url, 'http://localhost:31013/api/auth/refresh');
      assert.strictEqual(options.method, 'POST');
      assert.strictEqual(options.headers['X-CSRF-Token'], 'csrf-token');
      assert.strictEqual(options.headers['X-Session-Id'], csrfOptions.headers['X-Session-Id']);

      const body = JSON.parse(options.body);
      assert.strictEqual(body.refresh_token, 'mock-refresh-token');

      const savedTokens = JSON.parse(await fs.readFile(testTokensPath, 'utf-8'));
      assert.strictEqual(savedTokens.issued_at, issuedAt);
      assert.strictEqual(savedTokens.expires_in, 3600);
    });

    it('should collapse concurrent expired-token refreshes into one handshake', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      await fs.writeFile(testTokensPath, JSON.stringify({
        access_token: 'expired-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        issued_at: nowSeconds - 7200,
      }, null, 2));

      const refreshedJwt = createJwt(nowSeconds, nowSeconds + 3600);
      const mockFetch = mock.fn(async (url: string) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return url.endsWith('/api/csrf-token')
          ? { ok: true, json: async () => ({ token: 'csrf-token' }) }
          : { ok: true, json: async () => ({ token: refreshedJwt, refresh_token: 'next-refresh-token' }) };
      });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      const tokens = await Promise.all([
        tokenManager.getToken(),
        tokenManager.getToken(),
        tokenManager.getToken(),
      ]);

      assert.deepStrictEqual(tokens, [refreshedJwt, refreshedJwt, refreshedJwt]);
      assert.strictEqual(mockFetch.mock.callCount(), 2);
    });
  });

  describe('refresh', () => {
    it('should abort the CSRF handshake when token refresh exceeds its deadline', async () => {
      const signals: AbortSignal[] = [];
      const mockFetch = mock.fn(async (_url: string, options: any) => {
        const signal = options.signal as AbortSignal;
        signals.push(signal);
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
      });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager(
        'http://localhost:31013',
        testTokensPath,
        { refreshTimeoutMs: 20 },
      );
      await tokenManager.getToken();

      await assert.rejects(
        tokenManager.refresh(),
        (error: any) => {
          assert.strictEqual(error.code, 'token_refresh_timeout');
          assert.match(error.message, /Graph token refresh timed out after 20ms/);
          return true;
        },
      );
      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0].aborted, true);
    });

    it('should skip the refresh request when the caller has already cancelled', async () => {
      const mockFetch = mock.fn(async () => {
        throw new Error('refresh should not start');
      });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      await tokenManager.getToken();
      const controller = new AbortController();
      controller.abort(new Error('cancelled by test'));

      await assert.rejects(
        tokenManager.refresh({ signal: controller.signal }),
        (error: any) => {
          assert.strictEqual(error.code, 'token_refresh_timeout');
          assert.match(error.message, /Graph token refresh cancelled by the caller/);
          return true;
        },
      );
      assert.strictEqual(mockFetch.mock.callCount(), 0);
    });

    it('should keep a shared refresh alive for callers with longer deadlines', async () => {
      const refreshedJwt = createJwt(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600);
      const signals: AbortSignal[] = [];
      const mockFetch = mock.fn(async (url: string, options: any) => {
        const signal = options.signal as AbortSignal;
        signals.push(signal);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, 50);
          const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        return url.endsWith('/api/csrf-token')
          ? { ok: true, json: async () => ({ token: 'csrf-token' }) }
          : { ok: true, json: async () => ({ token: refreshedJwt, refresh_token: 'next-refresh-token' }) };
      });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      await tokenManager.getToken();

      const shortWait = tokenManager.refresh({ timeoutMs: 20 });
      const longWait = tokenManager.refresh({ timeoutMs: 1_000 });
      await assert.rejects(
        shortWait,
        (error: any) => {
          assert.strictEqual(error.code, 'token_refresh_timeout');
          assert.match(error.message, /Graph token refresh timed out after 20ms/);
          return true;
        },
      );
      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0].aborted, false);

      await longWait;
      assert.strictEqual(mockFetch.mock.callCount(), 2);
      assert.strictEqual(signals.every(signal => !signal.aborted), true);
    });

    it('should abort the shared refresh when all callers cancel', async () => {
      const signals: AbortSignal[] = [];
      const mockFetch = mock.fn(async (_url: string, options: any) => {
        const signal = options.signal as AbortSignal;
        signals.push(signal);
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        });
        throw new Error('unreachable');
      });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      await tokenManager.getToken();
      const firstController = new AbortController();
      const secondController = new AbortController();
      const firstWait = tokenManager.refresh({ signal: firstController.signal, timeoutMs: 1_000 });
      const secondWait = tokenManager.refresh({ signal: secondController.signal, timeoutMs: 1_000 });
      const firstRejected = assert.rejects(firstWait, /Graph token refresh cancelled by the caller/);
      const secondRejected = assert.rejects(secondWait, /Graph token refresh cancelled by the caller/);

      firstController.abort(new Error('first caller cancelled'));
      secondController.abort(new Error('second caller cancelled'));
      await Promise.all([firstRejected, secondRejected]);

      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0].aborted, true);
    });

    it('should serialize a refresh re-invocation while token persistence is in progress', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const firstJwt = createJwt(nowSeconds, nowSeconds + 3600);
      const secondJwt = createJwt(nowSeconds, nowSeconds + 7200);
      let refreshCallCount = 0;
      const mockFetch = mock.fn(async (url: string) => url.endsWith('/api/csrf-token')
        ? { ok: true, json: async () => ({ token: 'csrf-token' }) }
        : {
            ok: true,
            json: async () => ({
              token: refreshCallCount++ === 0 ? firstJwt : secondJwt,
              refresh_token: 'next-refresh-token',
            }),
          });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      await tokenManager.getToken();

      let resolveSaveStarted!: () => void;
      const saveStarted = new Promise<void>(resolve => {
        resolveSaveStarted = resolve;
      });
      let resolveSave!: () => void;
      const saveGate = new Promise<void>(resolve => {
        resolveSave = resolve;
      });
      const originalSaveTokens = (tokenManager as any).saveTokens.bind(tokenManager);
      let saveCallCount = 0;
      (tokenManager as any).saveTokens = async (tokenData: unknown) => {
        saveCallCount += 1;
        if (saveCallCount === 1) {
          resolveSaveStarted();
          await saveGate;
        }
        return originalSaveTokens(tokenData);
      };

      const firstController = new AbortController();
      const firstWait = tokenManager.refresh({ signal: firstController.signal, timeoutMs: 1_000 });
      await saveStarted;
      firstController.abort(new Error('first caller cancelled during save'));
      await assert.rejects(firstWait, /Graph token refresh cancelled by the caller/);

      const secondWait = tokenManager.refresh({ timeoutMs: 1_000 });
      assert.strictEqual(mockFetch.mock.callCount(), 2);
      resolveSave();
      await secondWait;

      assert.strictEqual(mockFetch.mock.callCount(), 2);
      const savedTokens = JSON.parse(await fs.readFile(testTokensPath, 'utf-8'));
      assert.strictEqual(savedTokens.access_token, firstJwt);
    });

    it('should refresh token and save to file', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const refreshedJwt = createJwt(nowSeconds, nowSeconds + 7200);
      const mockFetch = mock.fn(async (url: string) => url.endsWith('/api/csrf-token')
        ? { ok: true, json: async () => ({ token: 'csrf-token' }) }
        : {
            ok: true,
            json: async () => ({
              token: refreshedJwt,
              refresh_token: 'new-refresh-token',
            }),
          });

      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      // Load token first to have refresh_token available
      await tokenManager.getToken();

      await tokenManager.refresh();

      // Verify new token is saved
      const newToken = await tokenManager.getToken();
      assert.strictEqual(newToken, refreshedJwt);

      // Verify file was updated
      const savedTokens = JSON.parse(await fs.readFile(testTokensPath, 'utf-8'));
      assert.strictEqual(savedTokens.access_token, refreshedJwt);
      assert.strictEqual(savedTokens.refresh_token, 'new-refresh-token');
      assert.strictEqual(savedTokens.issued_at, nowSeconds);
      assert.strictEqual(savedTokens.expires_in, 7200);
      assert.strictEqual((await fs.stat(testTokensPath)).mode & 0o777, 0o600);
    });

    it('should preserve the token file when the CSRF request fails', async () => {
      const before = await fs.readFile(testTokensPath, 'utf-8');
      const mockFetch = mock.fn(async () => ({
        ok: false,
        status: 503,
        statusText: 'Unavailable',
      }));

      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      // Load token first to have refresh_token available
      await tokenManager.getToken();

      await assert.rejects(
        async () => await tokenManager.refresh(),
        /CSRF token request failed: 503 Unavailable/
      );
      assert.strictEqual(mockFetch.mock.callCount(), 1);
      assert.strictEqual(await fs.readFile(testTokensPath, 'utf-8'), before);
    });

    it('should reject a malformed success response without overwriting tokens', async () => {
      const before = await fs.readFile(testTokensPath, 'utf-8');
      const mockFetch = mock.fn(async (url: string) => url.endsWith('/api/csrf-token')
        ? { ok: true, json: async () => ({ token: 'csrf-token' }) }
        : { ok: true, json: async () => ({ refresh_token: 'rotated-without-access-token' }) });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      await tokenManager.getToken();

      await assert.rejects(
        async () => await tokenManager.refresh(),
        /Token refresh response did not include an access token/
      );
      assert.strictEqual(await fs.readFile(testTokensPath, 'utf-8'), before);
    });

    it('should surface the server error code without exposing the response body', async () => {
      const mockFetch = mock.fn(async (url: string) => url.endsWith('/api/csrf-token')
        ? { ok: true, json: async () => ({ token: 'csrf-token' }) }
        : {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ error: 'Access is not granted', refresh_token: 'must-not-leak' }),
          });
      global.fetch = mockFetch as any;

      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);
      await tokenManager.getToken();

      await assert.rejects(
        async () => await tokenManager.refresh(),
        (error: Error) => {
          assert.match(error.message, /401 Unauthorized \(Access is not granted\)/);
          assert.doesNotMatch(error.message, /must-not-leak/);
          return true;
        }
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

    it('should derive expiration from JWT when file metadata is missing', () => {
      const tokenManager = new TokenManager('http://localhost:31013', testTokensPath);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const tokenWithoutExpiry = {
        access_token: createJwt(nowSeconds - 7200, nowSeconds - 3600),
        refresh_token: 'refresh',
      };

      // @ts-ignore - accessing private method for testing
      const isExpired = tokenManager.isTokenExpired(tokenWithoutExpiry);
      assert.strictEqual(isExpired, true);
    });
  });
});
