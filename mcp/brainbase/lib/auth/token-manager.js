/**
 * Token Manager
 * Manages JWT + Refresh Token for Graph SSOT API
 */
import { readFile, writeFile, chmod } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
/**
 * TokenManager
 * Loads, stores, and refreshes JWT tokens
 */
export class TokenManager {
    tokenFilePath;
    tokenData = null;
    apiUrl;
    constructor(apiUrl, tokenFilePath) {
        this.tokenFilePath = tokenFilePath || join(homedir(), '.brainbase', 'tokens.json');
        this.apiUrl = apiUrl
            || process.env.BRAINBASE_GRAPH_API_URL
            || process.env.BRAINBASE_API_BASE_URL
            || 'https://graph.brain-base.work';
    }
    /**
     * Get the current access token
     * Falls back to environment variable if file doesn't exist
     */
    async getToken() {
        // Try loading from file
        if (!this.tokenData) {
            try {
                await this.loadTokens();
            }
            catch {
                // File doesn't exist, try environment variable
                const envToken = process.env.BRAINBASE_GRAPH_API_TOKEN;
                if (!envToken) {
                    throw new Error('No token found. Run `npm run mcp-setup` to obtain tokens.');
                }
                return envToken;
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
        return this.tokenData.access_token;
    }
    /**
     * Load tokens from file
     */
    async loadTokens() {
        const content = await readFile(this.tokenFilePath, 'utf-8');
        this.tokenData = JSON.parse(content);
    }
    /**
     * Check if token is expired
     */
    isTokenExpired(token) {
        if (!token.expires_in || !token.issued_at) {
            // No expiration data, assume valid
            return false;
        }
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = token.issued_at + token.expires_in;
        const bufferSeconds = 5 * 60; // 5 minutes
        return now >= (expiresAt - bufferSeconds);
    }
    /**
     * Refresh the access token using refresh_token
     */
    async refresh() {
        if (!this.tokenData?.refresh_token) {
            throw new Error('No refresh token available. Please re-authenticate.');
        }
        console.error('[TokenManager] Refreshing token...');
        const response = await fetch(`${this.apiUrl}/api/auth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                refresh_token: this.tokenData.refresh_token,
            }),
        });
        if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
        }
        const newTokenData = await response.json();
        const nextAccessToken = newTokenData.access_token || newTokenData.token;
        if (!nextAccessToken) {
            throw new Error('Token refresh response did not include access_token/token');
        }
        // Update token data
        this.tokenData = {
            access_token: nextAccessToken,
            refresh_token: newTokenData.refresh_token || this.tokenData.refresh_token,
            expires_in: newTokenData.expires_in || this.tokenData.expires_in || 3600,
            issued_at: Math.floor(Date.now() / 1000),
        };
        // Save to file
        await this.saveTokens();
        console.error('[TokenManager] Token refreshed successfully');
    }
    /**
     * Save tokens to file (with permission 600)
     */
    async saveTokens() {
        if (!this.tokenData)
            return;
        const content = JSON.stringify(this.tokenData, null, 2);
        await writeFile(this.tokenFilePath, content, 'utf-8');
        await chmod(this.tokenFilePath, 0o600);
    }
}
