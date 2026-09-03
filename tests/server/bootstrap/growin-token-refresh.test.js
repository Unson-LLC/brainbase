import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshStoredTokens } from '../../../scripts/refresh-auth-token.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
    ));
});

function jwt(issuedAt, expiresAt) {
    const payload = Buffer.from(JSON.stringify({ iat: issuedAt, exp: expiresAt })).toString('base64url');
    return `header.${payload}.signature`;
}

describe('Growin launcher token refresh', () => {
    it('uses the stored refresh token and atomically saves the rotated session', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'growin-token-refresh-'));
        temporaryDirectories.push(directory);
        const tokenFilePath = path.join(directory, 'tokens.json');
        await fs.writeFile(tokenFilePath, JSON.stringify({
            access_token: 'expired-access',
            refresh_token: 'stored-refresh',
            expires_in: 3600,
            issued_at: 1
        }));
        const now = Math.floor(Date.now() / 1000);
        const nextAccess = jwt(now, now + 3600);
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ token: nextAccess, refresh_token: 'rotated-refresh' })
            });

        await refreshStoredTokens({ apiUrl: 'https://brainbase.example', tokenFilePath, fetchImpl });

        expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://brainbase.example/api/csrf-token', {
            headers: { 'X-Session-Id': expect.stringMatching(/^brainbase-launcher-/) }
        });
        const refreshRequest = fetchImpl.mock.calls[1];
        expect(refreshRequest[0]).toBe('https://brainbase.example/api/auth/refresh');
        expect(JSON.parse(refreshRequest[1].body)).toEqual({ refresh_token: 'stored-refresh' });
        expect(refreshRequest[1].headers['X-Session-Id']).toBe(fetchImpl.mock.calls[0][1].headers['X-Session-Id']);
        expect(JSON.parse(await fs.readFile(tokenFilePath, 'utf8'))).toEqual({
            access_token: nextAccess,
            refresh_token: 'rotated-refresh',
            expires_in: 3600,
            issued_at: now
        });
        expect((await fs.stat(tokenFilePath)).mode & 0o777).toBe(0o600);
    });

    it('does not overwrite the stored session when refresh is rejected', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'growin-token-refresh-'));
        temporaryDirectories.push(directory);
        const tokenFilePath = path.join(directory, 'tokens.json');
        const original = JSON.stringify({ access_token: 'old', refresh_token: 'revoked' });
        await fs.writeFile(tokenFilePath, original);
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
            .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'invalid token' }) });

        await expect(refreshStoredTokens({
            apiUrl: 'https://brainbase.example',
            tokenFilePath,
            fetchImpl
        })).rejects.toThrow('token refresh failed: 401');
        expect(await fs.readFile(tokenFilePath, 'utf8')).toBe(original);
    });
});
