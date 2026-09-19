import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createTenantRuntimeServicesFromEnv } from '../../../../server/services/multitenant/tenant-runtime-services.js';

function createServices(override = {}) {
    const { privateKey } = generateKeyPairSync('ed25519');
    return createTenantRuntimeServicesFromEnv({
        env: {
            BRAINBASE_TENANT_RUNTIME_ENABLED: '1',
            BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN: 'test-service-token',
            BRAINBASE_SERVICE_TOKEN_SECRET: 'test-service-secret',
            BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_PROFILE: 'shared_cloud',
            BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_ID: 'test-key',
            BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_JWK: JSON.stringify(privateKey.export({ format: 'jwk' })),
            ...override
        },
        pool: { query: vi.fn(async () => ({ rows: [] })) }
    });
}

describe('trusted Slack channel authority runtime wiring', () => {
    it('exposes Outcome profile, tenant, and connection adapters through normal startup', () => {
        const services = createServices();

        expect(services.outcomeServiceContextAdapters).toMatchObject({
            resolveProfile: expect.any(Function),
            resolveTenant: expect.any(Function),
            resolveConnection: expect.any(Function)
        });
    });

    it('loads the repository-owned channel manifest on the actual production construction path', () => {
        const services = createServices();
        expect(services.companyAuthority.routeRepository.resolveSlackChannelAuthority).toBeTypeOf('function');
    });

    it('accepts an explicit empty policy set for rollback without changing personal authority', async () => {
        const services = createServices({ BRAINBASE_SLACK_CHANNEL_AUTHORITY_JSON: JSON.stringify({
            version: 'slack-channel-authority.v1', policies: []
        }) });
        const value = await services.companyAuthority.routeRepository.resolveSlackChannelAuthority({
            provider_identity: { provider: 'slack' }, slack: { channel_id: 'D-private' },
            requested_action: { capability_id: 'personal_read', resource_ref: 'personal://owner' }
        });
        expect(value).toBeNull();
    });

    it.each(['{}', '{"version":"wrong","policies":[]}', '{"version":"slack-channel-authority.v1"}', 'null'])('rejects malformed administrator policy %s at startup', (value) => {
        expect(() => createServices({ BRAINBASE_SLACK_CHANNEL_AUTHORITY_JSON: value })).toThrow();
    });

    it('bounds the initial rollout to the two incident channels with no per-user grant list', () => {
        const manifest = JSON.parse(readFileSync('config/manifests/slack-channel-authority.json', 'utf8'));
        expect(manifest.policies.map((policy) => [policy.channel_id, policy.projects.map((p) => p.project_code)]))
            .toEqual([['C0BKS6RL99T', ['back-office']], ['C0BMNSP6C80', ['mana']]]);
        expect(manifest.policies.every((policy) => policy.capability_id === 'runtime.execute')).toBe(true);
        expect(JSON.stringify(manifest)).not.toMatch(/authenticated_subject_id|allowedUserIds|U0BKP8D3KPD/);
    });
});
