/**
 * Jibble OAuth2.0 Authentication Module
 * Handles token acquisition and refresh
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from workspace root
config({ path: resolve(process.cwd(), '.env') });
// Also try workspace root explicitly
config({ path: '/Users/ksato/workspace/.env' });

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  organizationId: string;
  personId: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
  organizationId: string;
  personId: string;
}

const TOKEN_ENDPOINT = 'https://identity.prod.jibble.io/connect/token';
const TOKEN_BUFFER_SECONDS = 300; // Refresh 5 minutes before expiry

let tokenCache: TokenCache | null = null;

export async function getAccessToken(): Promise<string> {
  // Check if cached token is still valid
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  // Get credentials from environment
  const clientId = process.env.JIBBLE_CLIENT_ID;
  const clientSecret = process.env.JIBBLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('JIBBLE_CLIENT_ID and JIBBLE_CLIENT_SECRET must be set');
  }

  // Request new token
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${response.status} ${error}`);
  }

  const data: TokenResponse = await response.json();

  // Cache the token
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - TOKEN_BUFFER_SECONDS) * 1000,
    organizationId: data.organizationId,
    personId: data.personId,
  };

  return tokenCache.token;
}

export function getOrganizationId(): string | null {
  return tokenCache?.organizationId ?? null;
}

export function getPersonId(): string | null {
  return tokenCache?.personId ?? null;
}

export function clearTokenCache(): void {
  tokenCache = null;
}
