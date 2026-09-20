import { afterEach, describe, expect, it, vi } from 'vitest';

const configMocks = vi.hoisted(() => ({
    getAuth: vi.fn(),
    getConfig: vi.fn(() => ({ server_url: 'https://brainbase.example' })),
    saveAuth: vi.fn(),
    clearAuth: vi.fn(),
    CONFIG_DIR: '/tmp/brainbase-cli-auth-test'
}));

vi.mock('../../cli/config.js', () => configMocks);

import { login, status } from '../../cli/auth.js';
import { getHeaders } from '../../cli/learning.js';
import { authHeaders } from '../../cli/project-provisioning.js';

describe('CLI authentication safety boundary', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        configMocks.getAuth.mockReset();
        configMocks.getConfig.mockReset();
        configMocks.getConfig.mockReturnValue({ server_url: 'https://brainbase.example' });
        configMocks.saveAuth.mockReset();
        configMocks.clearAuth.mockReset();
    });

    it('fails closed when the server does not expose Slack Device Code Flow', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            text: async () => ''
        }));

        await expect(login()).rejects.toThrow(
            'Slack Device Code Flow is unavailable on https://brainbase.example (HTTP 404)'
        );
        expect(configMocks.saveAuth).not.toHaveBeenCalled();
    });

    it('fails closed with login guidance when the server cannot be reached', async () => {
        const connectionError = Object.assign(new Error('connect refused'), {
            cause: { code: 'ECONNREFUSED' }
        });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connectionError));

        await expect(login()).rejects.toThrow(
            'Cannot connect to https://brainbase.example'
        );
        expect(configMocks.saveAuth).not.toHaveBeenCalled();
    });

    it('fails closed with login guidance for other Device Code Flow errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            text: async () => 'temporarily unavailable'
        }));

        await expect(login()).rejects.toThrow(
            'Verify the Brainbase server and run `brainbase auth login` again. No credentials were saved.'
        );
        expect(configMocks.saveAuth).not.toHaveBeenCalled();
    });

    it('stores only the bearer token after a successful Device Code Flow', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    device_code: 'device-code',
                    user_code: 'ABCD-EFGH',
                    verification_uri: 'https://brainbase.example/device',
                    interval: -1,
                    expires_in: 1
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'signed-token',
                    expires_at: '2030-01-01T00:00:00.000Z'
                })
            }));

        await login();

        expect(configMocks.saveAuth).toHaveBeenCalledWith({
            token: 'signed-token',
            expires_at: '2030-01-01T00:00:00.000Z',
            server_url: 'https://brainbase.example'
        });
    });

    it('rejects a legacy insecure_header auth record instead of sending authority headers', () => {
        const legacyAuth = {
            mode: 'insecure_header',
            role: 'ceo',
            projects: ['brainbase'],
            clearance: ['restricted']
        };

        expect(() => getHeaders(legacyAuth)).toThrow(
            'Saved legacy insecure_header authentication is no longer supported'
        );
        expect(() => authHeaders(legacyAuth)).toThrow(
            'Saved legacy insecure_header authentication is no longer supported'
        );
    });

    it('continues to send bearer authentication to existing CLI consumers', () => {
        expect(getHeaders({ token: 'signed-token' })).toEqual({
            'Content-Type': 'application/json',
            Authorization: 'Bearer signed-token'
        });
        expect(authHeaders({ token: 'signed-token' })).toEqual({
            Authorization: 'Bearer signed-token'
        });
    });

    it('does not present a legacy auth record as an active logged-in session', () => {
        configMocks.getAuth.mockReturnValue({
            mode: 'insecure_header',
            role: 'ceo',
            projects: ['brainbase'],
            clearance: ['restricted'],
            server_url: 'https://brainbase.example'
        });
        const output = [];
        vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));

        status();

        expect(output.join('\n')).toContain('insecure header mode is no longer supported');
        expect(output.join('\n')).toContain('brainbase auth login');
        expect(output.join('\n')).not.toContain('Logged in:');
        expect(output.join('\n')).not.toContain('Role:');
        expect(output.join('\n')).not.toContain('Projects:');
    });
});
