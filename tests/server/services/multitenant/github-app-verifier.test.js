import { generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createGitHubAppVerifierFromEnv } from '../../../../server/services/multitenant/github-app-verifier.js';

function fixture(overrides = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            id: 123,
            app_id: 456,
            app_slug: 'brainbase-app',
            account: { id: 789, login: 'Unson-LLC', type: 'Organization' },
            permissions: { contents: 'read' },
            suspended_at: null
        })
    }));
    const verifier = createGitHubAppVerifierFromEnv({
        env: {
            GITHUB_APP_ID: '456',
            GITHUB_APP_SLUG: 'brainbase-app',
            GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
            ...overrides
        },
        fetchImpl,
        now: () => new Date('2026-09-20T00:00:00.000Z')
    });
    return { verifier, fetchImpl, publicKey };
}

describe('GitHub App verifier', () => {
    it('verifies an organization installation and returns only an opaque descriptor', async () => {
        const { verifier, fetchImpl, publicKey } = fixture();

        const result = await verifier.verifyInstallation({
            installation_id: '123',
            expected_app_slug: 'brainbase-app'
        });

        expect(result.installation).toMatchObject({
            installation_id: '123',
            app_id: '456',
            account: { id: '789', login: 'Unson-LLC', type: 'Organization' }
        });
        expect(JSON.parse(result.credential_material)).toEqual({
            version: 1, provider: 'github', app_id: '456', installation_id: '123'
        });
        const authorization = fetchImpl.mock.calls[0][1].headers.authorization;
        const [, token] = authorization.split(' ');
        const [header, payload, signature] = token.split('.');
        expect(verifySignature(
            'RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')
        )).toBe(true);
    });

    it('rejects mismatched credential descriptors before provider readback', async () => {
        const { verifier, fetchImpl } = fixture();

        await expect(verifier.readInstallation({
            installation_id: '123',
            expected_app_slug: 'brainbase-app',
            credential_material: JSON.stringify({
                version: 1, provider: 'github', app_id: '456', installation_id: '999'
            })
        })).rejects.toMatchObject({ code: 'GITHUB_INSTALLATION_VERIFICATION_FAILED' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('finds an existing installation by its server-authorized organization login', async () => {
        const { verifier, fetchImpl } = fixture();

        const result = await verifier.verifyOrganizationInstallation({
            organization_login: 'Unson-LLC',
            expected_app_slug: 'brainbase-app'
        });

        expect(result.installation).toMatchObject({
            installation_id: '123', account: { login: 'Unson-LLC' }
        });
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/orgs/Unson-LLC/installation');
    });

    it('returns null when the authorized organization has no installation', async () => {
        const noInstallation = createGitHubAppVerifierFromEnv({
            env: {
                GITHUB_APP_ID: '456', GITHUB_APP_SLUG: 'brainbase-app',
                GITHUB_APP_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048 })
                    .privateKey.export({ type: 'pkcs8', format: 'pem' })
            },
            fetchImpl: vi.fn(async () => ({ ok: false, status: 404 })),
            now: () => new Date('2026-09-20T00:00:00.000Z')
        });

        await expect(noInstallation.verifyOrganizationInstallation({
            organization_login: 'Unson-LLC', expected_app_slug: 'brainbase-app'
        })).resolves.toBeNull();
    });

    it('fails closed for incomplete or invalid GitHub App configuration', () => {
        expect(createGitHubAppVerifierFromEnv({ env: {} })).toBeNull();
        expect(createGitHubAppVerifierFromEnv({
            env: { GITHUB_APP_ID: '456', GITHUB_APP_SLUG: 'brainbase-app', GITHUB_APP_PRIVATE_KEY: 'not-a-key' }
        })).toBeNull();
    });
});
