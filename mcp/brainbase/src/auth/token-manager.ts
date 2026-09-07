/**
 * Token Manager
 * Manages JWT + Refresh Token for Graph SSOT API
 */

import { readFile, writeFile, chmod } from 'fs/promises';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

export interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  issued_at?: number;
}

export interface TokenManagerOptions {
  allowEnvironmentToken?: boolean;
  requireEnvironmentToken?: boolean;
  /** Maximum time allowed for one CSRF + refresh handshake. */
  refreshTimeoutMs?: number;
}

export interface TokenRequestOptions {
  /** Abort the underlying request when the caller's operation is cancelled. */
  signal?: AbortSignal;
  /** Maximum time this caller waits for a refresh handshake. */
  timeoutMs?: number;
}

interface RefreshOperationOptions extends TokenRequestOptions {
  onCommitStart?: () => void;
}

const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;
const REFRESH_TIMEOUT_ENV = 'BRAINBASE_GRAPH_TOKEN_REFRESH_TIMEOUT_MS';

export class TokenManagerTimeoutError extends Error {
  readonly code = 'token_refresh_timeout';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TokenManagerTimeoutError';
  }
}

function positiveTimeout(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number of milliseconds`);
  }
  return Math.max(1, Math.floor(value));
}

function configuredTimeout(value: number | undefined, fallback: number, envName: string): number {
  if (value !== undefined) return positiveTimeout(value, fallback, envName);
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return positiveTimeout(parsed, fallback, envName);
}

function createDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: string,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`${operation} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

export function createConnectionTokenManager(apiUrl?: string, tokenFilePath?: string): {
  mode: 'interactive' | 'service';
  tokenManager: TokenManager;
} {
  const configuredMode = process.env.BRAINBASE_AUTH_MODE?.trim();
  const mode = configuredMode || (process.env.BRAINBASE_GRAPH_API_TOKEN?.trim() ? 'service' : 'interactive');
  if (mode !== 'interactive' && mode !== 'service') {
    throw new Error('BRAINBASE_AUTH_MODE must be interactive or service');
  }
  return {
    mode,
    tokenManager: new TokenManager(apiUrl, tokenFilePath, {
      allowEnvironmentToken: mode === 'service',
      requireEnvironmentToken: mode === 'service',
    }),
  };
}

/**
 * TokenManager
 * Loads, stores, and refreshes JWT tokens
 */
export class TokenManager {
  private tokenFilePath: string;
  private tokenData: TokenData | null = null;
  private apiUrl: string;
  private refreshState: {
    promise: Promise<void>;
    controller: AbortController;
    waiters: number;
    commitStarted: boolean;
  } | null = null;
  private allowEnvironmentToken: boolean;
  private requireEnvironmentToken: boolean;
  private refreshTimeoutMs: number;

  constructor(apiUrl?: string, tokenFilePath?: string, options: TokenManagerOptions = {}) {
    this.tokenFilePath = tokenFilePath || join(homedir(), '.brainbase', 'tokens.json');
    this.apiUrl = apiUrl || process.env.BRAINBASE_GRAPH_API_URL || 'http://localhost:31013';
    this.allowEnvironmentToken = options.allowEnvironmentToken ?? true;
    this.requireEnvironmentToken = options.requireEnvironmentToken ?? false;
    this.refreshTimeoutMs = configuredTimeout(
      options.refreshTimeoutMs,
      DEFAULT_REFRESH_TIMEOUT_MS,
      REFRESH_TIMEOUT_ENV,
    );
  }

  /**
   * Get the current access token
   * Dedicated service runtimes must not be shadowed by a persisted user token.
   */
  async getToken(options: TokenRequestOptions = {}): Promise<string> {
    if (options.signal?.aborted) {
      throw new TokenManagerTimeoutError('Token acquisition was cancelled by the caller');
    }
    const envToken = this.allowEnvironmentToken
      ? process.env.BRAINBASE_GRAPH_API_TOKEN?.trim()
      : undefined;
    if (envToken) {
      return envToken;
    }
    if (this.requireEnvironmentToken) {
      throw new Error('Service authentication requires BRAINBASE_GRAPH_API_TOKEN; persisted user credentials are not used');
    }

    // Try loading from file
    if (!this.tokenData) {
      try {
        await this.loadTokens();
      } catch {
        if (options.signal?.aborted) {
          throw new TokenManagerTimeoutError('Token acquisition was cancelled by the caller');
        }
        throw new Error('No token found. Run `npm run mcp-setup` to obtain tokens.');
      }
    }

    if (!this.tokenData) {
      throw new Error('Failed to load tokens');
    }

    // Check if token is expired (with 5 minute buffer)
    if (this.isTokenExpired(this.tokenData)) {
      console.error('[TokenManager] Token expired, refreshing...');
      await this.refresh(options);
    }

    return this.tokenData!.access_token;
  }

  /**
   * Load tokens from file
   */
  private async loadTokens(): Promise<void> {
    const content = await readFile(this.tokenFilePath, 'utf-8');
    this.tokenData = JSON.parse(content);
  }

  /**
   * Check if token is expired
   */
  private isTokenExpired(token: TokenData): boolean {
    const jwtTiming = this.decodeJwtTiming(token.access_token);
    const issuedAt = token.issued_at ?? jwtTiming?.issuedAt;
    const expiresIn = token.expires_in ?? jwtTiming?.expiresIn;
    if (!expiresIn || !issuedAt) return false;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + expiresIn;
    const bufferSeconds = 5 * 60; // 5 minutes

    return now >= (expiresAt - bufferSeconds);
  }

  /**
   * Refresh the access token using refresh_token
   */
  async refresh(options: TokenRequestOptions = {}): Promise<void> {
    if (options.signal?.aborted) {
      throw new TokenManagerTimeoutError('Graph token refresh cancelled by the caller');
    }
    const timeoutMs = configuredTimeout(options.timeoutMs, this.refreshTimeoutMs, REFRESH_TIMEOUT_ENV);
    let state = this.refreshState;
    if (!state) {
      const controller = new AbortController();
      const nextState: {
        promise: Promise<void>;
        controller: AbortController;
        waiters: number;
        commitStarted: boolean;
      } = {
        promise: Promise.resolve(),
        controller,
        waiters: 0,
        commitStarted: false,
      };
      const operation = this.performRefresh({
        signal: controller.signal,
        timeoutMs: this.refreshTimeoutMs,
        onCommitStart: () => {
          nextState.commitStarted = true;
        },
      });
      const promise = operation.finally(() => {
        if (this.refreshState?.promise === promise) {
          this.refreshState = null;
        }
      });
      // A caller can cancel after all waiters have detached. Keep the
      // manager-owned operation rejection handled while its request aborts.
      promise.catch(() => {});
      nextState.promise = promise;
      state = nextState;
      this.refreshState = nextState;
    }

    return this.waitForRefresh(state, options, timeoutMs);
  }

  private waitForRefresh(
    state: NonNullable<TokenManager['refreshState']>,
    options: TokenRequestOptions,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = createDeadlineSignal(options.signal, timeoutMs, 'Graph token refresh');
    state.waiters += 1;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => deadline.cleanup();
      const release = () => {
        if (settled) return;
        settled = true;
        cleanup();
        state.waiters -= 1;
        if (state.waiters === 0 && this.refreshState === state && !state.commitStarted) {
          this.refreshState = null;
          state.controller.abort(new Error('Graph token refresh has no remaining callers'));
        }
      };
      const onAbort = () => {
        release();
        const reason = options.signal?.aborted
          ? 'cancelled by the caller'
          : `timed out after ${timeoutMs}ms`;
        reject(new TokenManagerTimeoutError(`Graph token refresh ${reason}`));
      };
      if (deadline.signal.aborted) {
        onAbort();
        return;
      }
      deadline.signal.addEventListener('abort', onAbort, { once: true });
      state.promise.then(
        () => {
          release();
          resolve();
        },
        error => {
          release();
          reject(error);
        },
      );
    });
  }

  private async performRefresh(options: RefreshOperationOptions = {}): Promise<void> {
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available. Please re-authenticate.');
    }

    console.error('[TokenManager] Refreshing token...');

    const sessionId = `brainbase-mcp-${randomUUID()}`;
    const timeoutMs = configuredTimeout(options.timeoutMs, this.refreshTimeoutMs, REFRESH_TIMEOUT_ENV);
    const deadline = createDeadlineSignal(options.signal, timeoutMs, 'Graph token refresh');

    try {
      if (deadline.signal.aborted) {
        throw new TokenManagerTimeoutError('Graph token refresh cancelled by the caller');
      }
      const csrfResponse = await fetch(`${this.apiUrl}/api/csrf-token`, {
        headers: {
          'X-Session-Id': sessionId,
        },
        signal: deadline.signal,
      });

      if (!csrfResponse.ok) {
        throw new Error(`CSRF token request failed: ${csrfResponse.status} ${csrfResponse.statusText}`);
      }

      const csrfData = await csrfResponse.json() as Record<string, unknown>;
      const csrfToken = typeof csrfData.token === 'string' ? csrfData.token.trim() : '';
      if (!csrfToken) {
        throw new Error('CSRF token response did not include a token');
      }

      const response = await fetch(`${this.apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          refresh_token: this.tokenData.refresh_token,
        }),
        signal: deadline.signal,
      });

      if (!response.ok) {
        const errorCode = await this.readServerErrorCode(response);
        const detail = errorCode ? ` (${errorCode})` : '';
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}${detail}`);
      }

      const responseData = await response.json() as Record<string, unknown>;
      const accessTokenCandidate = responseData.token ?? responseData.access_token;
      const accessToken = typeof accessTokenCandidate === 'string' ? accessTokenCandidate.trim() : '';
      if (!accessToken) {
        throw new Error('Token refresh response did not include an access token');
      }

      const jwtTiming = this.decodeJwtTiming(accessToken);
      const responseExpiresIn = typeof responseData.expires_in === 'number' && responseData.expires_in > 0
        ? responseData.expires_in
        : undefined;
      const expiresIn = responseExpiresIn ?? jwtTiming?.expiresIn;
      if (!expiresIn) {
        throw new Error('Token refresh response did not include usable expiry metadata');
      }

      const refreshTokenCandidate = responseData.refresh_token;
      const refreshToken = typeof refreshTokenCandidate === 'string' && refreshTokenCandidate.trim()
        ? refreshTokenCandidate
        : this.tokenData.refresh_token;

      const nextTokenData: TokenData = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn,
        issued_at: jwtTiming?.issuedAt ?? Math.floor(Date.now() / 1000),
      };

      // A cancelled shared refresh must not let a late response overwrite a
      // newer refresh that started after all of its callers detached.
      if (deadline.signal.aborted) {
        throw new Error('Graph token refresh aborted before persisting refreshed token');
      }

      // Persist validated data before replacing the in-memory token.
      options.onCommitStart?.();
      await this.saveTokens(nextTokenData);
      this.tokenData = nextTokenData;

      console.error('[TokenManager] Token refreshed successfully');
    } catch (error) {
      if (deadline.signal.aborted) {
        const callerCancelled = options.signal?.aborted;
        const reason = callerCancelled
          ? 'cancelled by the caller'
          : `timed out after ${timeoutMs}ms`;
        throw new TokenManagerTimeoutError(`Graph token refresh ${reason}`, { cause: error });
      }
      throw error;
    } finally {
      deadline.cleanup();
    }
  }

  private decodeJwtTiming(token: string): { issuedAt: number; expiresIn: number } | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<string, unknown>;
      const issuedAt = typeof payload.iat === 'number' ? payload.iat : NaN;
      const expiresAt = typeof payload.exp === 'number' ? payload.exp : NaN;
      if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
        return null;
      }
      return { issuedAt, expiresIn: expiresAt - issuedAt };
    } catch {
      return null;
    }
  }

  private async readServerErrorCode(response: Response): Promise<string> {
    try {
      const data = await response.json() as Record<string, unknown>;
      const candidate = data.error ?? data.error_description;
      return typeof candidate === 'string' ? candidate.trim().slice(0, 200) : '';
    } catch {
      return '';
    }
  }

  /**
   * Save tokens to file (with permission 600)
   */
  private async saveTokens(tokenData: TokenData): Promise<void> {
    const content = JSON.stringify(tokenData, null, 2);
    await writeFile(this.tokenFilePath, content, 'utf-8');
    await chmod(this.tokenFilePath, 0o600);
  }
}
