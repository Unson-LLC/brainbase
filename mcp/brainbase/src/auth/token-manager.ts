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
  private refreshPromise: Promise<void> | null = null;
  private allowEnvironmentToken: boolean;
  private requireEnvironmentToken: boolean;

  constructor(apiUrl?: string, tokenFilePath?: string, options: TokenManagerOptions = {}) {
    this.tokenFilePath = tokenFilePath || join(homedir(), '.brainbase', 'tokens.json');
    this.apiUrl = apiUrl || process.env.BRAINBASE_GRAPH_API_URL || 'http://localhost:31013';
    this.allowEnvironmentToken = options.allowEnvironmentToken ?? true;
    this.requireEnvironmentToken = options.requireEnvironmentToken ?? false;
  }

  /**
   * Get the current access token
   * Dedicated service runtimes must not be shadowed by a persisted user token.
   */
  async getToken(): Promise<string> {
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
        throw new Error('No token found. Run `npm run mcp-setup` to obtain tokens.');
      }
    }

    if (!this.tokenData) {
      throw new Error('Failed to load tokens');
    }

    // Check if token is expired (with 5 minute buffer)
    if (this.isTokenExpired(this.tokenData)) {
      console.error('[TokenManager] Token expired, refreshing...');
      await this.refresh();
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
  async refresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  private async performRefresh(): Promise<void> {
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available. Please re-authenticate.');
    }

    console.error('[TokenManager] Refreshing token...');

    const sessionId = `brainbase-mcp-${randomUUID()}`;
    const csrfResponse = await fetch(`${this.apiUrl}/api/csrf-token`, {
      headers: {
        'X-Session-Id': sessionId,
      },
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

    // Persist validated data before replacing the in-memory token.
    await this.saveTokens(nextTokenData);
    this.tokenData = nextTokenData;

    console.error('[TokenManager] Token refreshed successfully');
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
