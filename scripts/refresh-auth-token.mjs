#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function decodeJwtTiming(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.exp <= payload.iat) {
            return null;
        }
        return { issuedAt: payload.iat, expiresIn: payload.exp - payload.iat };
    } catch {
        return null;
    }
}

async function readErrorCode(response) {
    try {
        const data = await response.json();
        const candidate = data.error || data.error_description;
        return typeof candidate === 'string' ? candidate.slice(0, 200) : '';
    } catch {
        return '';
    }
}

export async function refreshStoredTokens({ apiUrl, tokenFilePath, fetchImpl = fetch }) {
    const current = JSON.parse(await fs.readFile(tokenFilePath, 'utf8'));
    if (typeof current.refresh_token !== 'string' || !current.refresh_token.trim()) {
        throw new Error('refresh token is unavailable');
    }

    const sessionId = `brainbase-launcher-${crypto.randomUUID()}`;
    const csrfResponse = await fetchImpl(`${apiUrl}/api/csrf-token`, {
        headers: { 'X-Session-Id': sessionId }
    });
    if (!csrfResponse.ok) {
        throw new Error(`CSRF token request failed: ${csrfResponse.status}`);
    }
    const csrfData = await csrfResponse.json();
    if (typeof csrfData.token !== 'string' || !csrfData.token.trim()) {
        throw new Error('CSRF token response did not include a token');
    }

    const refreshResponse = await fetchImpl(`${apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfData.token,
            'X-Session-Id': sessionId
        },
        body: JSON.stringify({ refresh_token: current.refresh_token })
    });
    if (!refreshResponse.ok) {
        const code = await readErrorCode(refreshResponse);
        throw new Error(`token refresh failed: ${refreshResponse.status}${code ? ` (${code})` : ''}`);
    }

    const refreshed = await refreshResponse.json();
    const accessToken = typeof refreshed.token === 'string' && refreshed.token.trim()
        ? refreshed.token.trim()
        : typeof refreshed.access_token === 'string' && refreshed.access_token.trim()
            ? refreshed.access_token.trim()
            : '';
    if (!accessToken) throw new Error('token refresh response did not include an access token');

    const jwtTiming = decodeJwtTiming(accessToken);
    const expiresIn = Number.isFinite(refreshed.expires_in) && refreshed.expires_in > 0
        ? refreshed.expires_in
        : jwtTiming?.expiresIn;
    if (!expiresIn) throw new Error('token refresh response did not include expiry metadata');

    const next = {
        access_token: accessToken,
        refresh_token: typeof refreshed.refresh_token === 'string' && refreshed.refresh_token.trim()
            ? refreshed.refresh_token.trim()
            : current.refresh_token,
        expires_in: expiresIn,
        issued_at: jwtTiming?.issuedAt ?? Math.floor(Date.now() / 1000)
    };
    const temporaryPath = path.join(
        path.dirname(tokenFilePath),
        `.${path.basename(tokenFilePath)}.${crypto.randomUUID()}.tmp`
    );
    let replaced = false;
    try {
        await fs.writeFile(temporaryPath, JSON.stringify(next, null, 2), { mode: 0o600 });
        await fs.rename(temporaryPath, tokenFilePath);
        replaced = true;
        await fs.chmod(tokenFilePath, 0o600);
    } finally {
        if (!replaced) await fs.rm(temporaryPath, { force: true });
    }
    return next;
}

async function main() {
    const apiUrl = process.env.BRAINBASE_API_URL || 'http://localhost:31013';
    const tokenFilePath = process.env.BRAINBASE_TOKEN_FILE;
    if (!tokenFilePath) throw new Error('BRAINBASE_TOKEN_FILE is required');
    await refreshStoredTokens({ apiUrl, tokenFilePath: path.resolve(tokenFilePath) });
    console.log('Growin専用Brainbaseの認証を自動更新しました。');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        console.error(`認証の自動更新に失敗しました: ${error.message}`);
        process.exitCode = 1;
    });
}
