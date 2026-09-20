import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

function unsignedJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.unsigned`;
}

describe('CLI auth.json expiry compatibility', () => {
    const originalHome = homedir();
    let testHome;
    let authFile;
    let tokensFile;
    let getAuth;

    beforeAll(async () => {
        testHome = mkdtempSync(join(tmpdir(), 'brainbase-cli-auth-'));
        process.env.HOME = testHome;
        vi.resetModules();
        ({ getAuth } = await import('../../cli/config.js'));
        authFile = join(testHome, '.brainbase', 'auth.json');
        tokensFile = join(testHome, '.brainbase', 'tokens.json');
    });

    afterAll(() => {
        process.env.HOME = originalHome;
        rmSync(testHome, { recursive: true, force: true });
    });

    it('rejects auth.json whose 30-day fallback outlives the JWT', () => {
        mkdirSync(join(testHome, '.brainbase'), { recursive: true });
        writeFileSync(authFile, JSON.stringify({
            token: unsignedJwt({ exp: Date.now() / 1000 - 1 }),
            expires_at: '2030-01-31T00:00:00.000Z',
            server_url: 'https://brainbase.example'
        }));

        expect(getAuth()).toBeNull();
    });

    it('keeps a valid auth.json and the existing tokens.json fallback readable', () => {
        writeFileSync(authFile, JSON.stringify({
            token: unsignedJwt({ exp: Date.now() / 1000 + 3600 }),
            expires_at: '2030-01-31T00:00:00.000Z',
            refresh_token: 'refresh-token',
            server_url: 'https://brainbase.example'
        }));
        expect(getAuth()).toMatchObject({
            refresh_token: 'refresh-token',
            server_url: 'https://brainbase.example'
        });

        rmSync(authFile);
        writeFileSync(tokensFile, JSON.stringify({ access_token: 'ui-access-token' }));
        expect(getAuth()).toEqual({
            token: 'ui-access-token',
            server_url: 'http://localhost:31013'
        });
        expect(readFileSync(tokensFile, 'utf8')).toContain('ui-access-token');
    });
});
