// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
    createPostingBridgeHealthCheck,
    createSnsAccountHealthProvider,
    hasPostingBridgeCredentials,
    postingBridgeRateLimitUnavailable
} from '../../../server/services/sns/sns-posting-auth-health.js';

const postingEnv = {
    X_CONSUMER_KEY: 'present',
    X_CONSUMER_SECRET: 'present',
    X_ACCESS_TOKEN: 'present',
    X_ACCESS_TOKEN_SECRET: 'present'
};

describe('SNS posting auth health', () => {
    it('INV-4: verifies posting bridge credentials without posting', async () => {
        const execFileImpl = vi.fn(async () => ({ stdout: 'Authenticated as @AIBizNavigator' }));
        const healthCheck = createPostingBridgeHealthCheck({
            env: postingEnv,
            pythonPath: '/python',
            scriptPath: '/ops/scripts/sns_post.py',
            execFileImpl
        });

        await expect(healthCheck()).resolves.toEqual({
            ok: true,
            reason: null,
            credential_mode: 'posting_bridge_oauth1'
        });
        expect(execFileImpl).toHaveBeenCalledWith('/python', ['/ops/scripts/x_client.py', '--verify'], expect.objectContaining({
            env: postingEnv
        }));
    });

    it('S-3: reports missing posting bridge credentials without shelling out', async () => {
        const execFileImpl = vi.fn();
        const healthCheck = createPostingBridgeHealthCheck({
            env: { X_ACCESS_TOKEN: 'oauth1-user-token' },
            execFileImpl
        });

        await expect(healthCheck()).resolves.toMatchObject({
            ok: false,
            reason: 'missing_posting_bridge_credentials',
            credential_mode: 'posting_bridge_oauth1'
        });
        expect(execFileImpl).not.toHaveBeenCalled();
    });

    it('S-2: lets the posting script discover its .env when using the default process env', async () => {
        const execFileImpl = vi.fn(async () => ({ stdout: 'Authenticated as @AIBizNavigator' }));
        const originalValues = {
            X_CONSUMER_KEY: process.env.X_CONSUMER_KEY,
            X_CONSUMER_SECRET: process.env.X_CONSUMER_SECRET,
            X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
            X_ACCESS_TOKEN_SECRET: process.env.X_ACCESS_TOKEN_SECRET
        };
        for (const key of Object.keys(originalValues)) delete process.env[key];
        try {
            const healthCheck = createPostingBridgeHealthCheck({
                pythonPath: '/python',
                scriptPath: '/ops/scripts/sns_post.py',
                execFileImpl
            });

            await expect(healthCheck()).resolves.toEqual({
                ok: true,
                reason: null,
                credential_mode: 'posting_bridge_oauth1'
            });
            expect(execFileImpl).toHaveBeenCalledWith('/python', ['/ops/scripts/x_client.py', '--verify'], expect.objectContaining({
                env: process.env
            }));
        } finally {
            for (const [key, value] of Object.entries(originalValues)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('S-2: falls back to posting bridge health when explicit OAuth2 env is absent', async () => {
        const xProvider = {
            healthCheck: vi.fn(async () => ({ ok: true })),
            getRateLimitStatus: vi.fn(async () => ({ remaining: 299, resetAt: '2026-05-15T12:15:00.000Z' }))
        };
        const postingBridgeHealthCheck = vi.fn(async () => ({
            ok: true,
            reason: null,
            credential_mode: 'posting_bridge_oauth1'
        }));
        const provider = createSnsAccountHealthProvider({
            xProvider,
            postingBridgeHealthCheck,
            env: postingEnv
        });

        await expect(provider.healthCheck({ provider: 'env', path: 'SNS_X_ACCESS_TOKEN', env: 'SNS_X_ACCESS_TOKEN' })).resolves.toEqual({
            ok: true,
            reason: null,
            credential_mode: 'posting_bridge_oauth1'
        });
        expect(xProvider.healthCheck).not.toHaveBeenCalled();
        await expect(provider.getRateLimitStatus({ env: 'SNS_X_ACCESS_TOKEN' })).resolves.toEqual(postingBridgeRateLimitUnavailable());
    });

    it('INV-3: treats explicit OAuth1 X_ACCESS_TOKEN refs as posting bridge credentials', async () => {
        const xProvider = {
            healthCheck: vi.fn(async () => ({ ok: true })),
            getRateLimitStatus: vi.fn(async () => ({ remaining: 299, resetAt: '2026-05-15T12:15:00.000Z' }))
        };
        const postingBridgeHealthCheck = vi.fn(async () => ({
            ok: true,
            reason: null,
            credential_mode: 'posting_bridge_oauth1'
        }));
        const provider = createSnsAccountHealthProvider({
            xProvider,
            postingBridgeHealthCheck,
            env: postingEnv
        });

        await expect(provider.healthCheck({ env: 'X_ACCESS_TOKEN' })).resolves.toEqual({
            ok: true,
            reason: null,
            credential_mode: 'posting_bridge_oauth1'
        });
        expect(xProvider.healthCheck).not.toHaveBeenCalled();
    });

    it('S-1: uses OAuth2 health when the explicit credential env exists', async () => {
        const xProvider = {
            healthCheck: vi.fn(async () => ({ ok: true })),
            getRateLimitStatus: vi.fn(async () => ({ remaining: 299, resetAt: '2026-05-15T12:15:00.000Z' }))
        };
        const provider = createSnsAccountHealthProvider({
            xProvider,
            postingBridgeHealthCheck: vi.fn(),
            env: { ...postingEnv, SNS_X_ACCESS_TOKEN: 'oauth2-token' }
        });

        await expect(provider.healthCheck({ env: 'SNS_X_ACCESS_TOKEN' })).resolves.toEqual({
            ok: true,
            credential_mode: 'x_api_oauth2'
        });
        await expect(provider.getRateLimitStatus({ env: 'SNS_X_ACCESS_TOKEN' })).resolves.toEqual({
            remaining: 299,
            resetAt: '2026-05-15T12:15:00.000Z'
        });
    });

    it('INV-3: identifies a complete OAuth1 posting env set', () => {
        expect(hasPostingBridgeCredentials(postingEnv)).toBe(true);
        expect(hasPostingBridgeCredentials({ ...postingEnv, X_ACCESS_TOKEN_SECRET: '' })).toBe(false);
    });
});
