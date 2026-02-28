/**
 * Token Manager
 * Manages JWT + Refresh Token for Graph SSOT API
 */
export interface TokenData {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    issued_at?: number;
}
/**
 * TokenManager
 * Loads, stores, and refreshes JWT tokens
 */
export declare class TokenManager {
    private tokenFilePath;
    private tokenData;
    private apiUrl;
    constructor(apiUrl?: string, tokenFilePath?: string);
    /**
     * Get the current access token
     * Falls back to environment variable if file doesn't exist
     */
    getToken(): Promise<string>;
    /**
     * Load tokens from file
     */
    private loadTokens;
    /**
     * Check if token is expired
     */
    private isTokenExpired;
    /**
     * Refresh the access token using refresh_token
     */
    refresh(): Promise<void>;
    /**
     * Save tokens to file (with permission 600)
     */
    private saveTokens;
}
