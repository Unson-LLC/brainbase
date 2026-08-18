import { describe, expect, it, vi } from 'vitest';

import {
    SlackInstallationControlPlane,
    redactSlackInstallationExchange,
    validateSlackInstallationBinding
} from '../../../../server/services/multitenant/slack-installation-control-plane.js';
import { expectContractErrorAsync } from './test-helpers.js';

const IDS = Object.freeze({
    intent: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    tenant: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX',
    person: 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY'
});
const binding = Object.freeze({
    installation_intent_id: IDS.intent,
    tenant_id: IDS.tenant,
    app_id: 'A0123456789',
    expected_workspace_id: 'T0123456789',
    initiated_by_person_id: IDS.person,
    expected_connection_revision: '2'
});
const now = new Date('2026-08-19T00:00:00.000Z');

function createControlPlane(overrides = {}) {
    const repository = {
        createSlackInstallationIntent: vi.fn(async (input) => input),
        readSlackInstallationResult: vi.fn(async () => null),
        registerSlackInstallation: vi.fn(async ({ intent, exchange, credential }) => ({
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            connection_revision: '3',
            tenant_id: intent.tenant_id,
            installation_id: exchange.installation_id,
            workspace_id: exchange.workspace_id,
            app_id: intent.app_id,
            installer_id: exchange.installer_id,
            granted_scopes: exchange.granted_scopes,
            status: 'active',
            credential_mode: credential.credential_mode,
            contract_revision: '11'
        })),
        ...overrides.repository
    };
    const oauthClient = {
        exchangeCode: vi.fn(async () => ({
            app_id: binding.app_id,
            team_id: binding.expected_workspace_id,
            authed_user_id: 'U0123456789',
            installation_id: 'I0123456789',
            scope: 'chat:write,commands',
            credential_material: 'raw-token-never-persisted',
            credential_refresh_material: 'raw-refresh-never-persisted'
        })),
        ...overrides.oauthClient
    };
    const credentialStore = {
        store: vi.fn(async () => ({
            credential_ref: 'opaque-ref:tenant-a:connection-1',
            credential_mode: 'customer_oauth',
            refresh_revision: 1
        })),
        revoke: vi.fn(),
        ...overrides.credentialStore
    };
    const controlPlane = new SlackInstallationControlPlane({
        repository,
        oauthClient,
        credentialStore,
        authorizeInstallation: vi.fn(async () => binding),
        now: () => now,
        ttlSeconds: overrides.ttlSeconds ?? 600
    });
    return { controlPlane, repository, oauthClient, credentialStore };
}

describe('Slack installation control plane', () => {
    it('authorizes an admin binding and persists only the bounded installation intent', async () => {
        const { controlPlane, repository } = createControlPlane();

        await expect(controlPlane.authorize({ tenant_id: IDS.tenant })).resolves.toEqual(binding);

        expect(repository.createSlackInstallationIntent).toHaveBeenCalledWith({
            ...binding,
            issued_at: now.toISOString(),
            expires_at: '2026-08-19T00:10:00.000Z'
        });
    });

    it('exchanges, validates Slack app/workspace identity, stores opaque credentials, and registers atomically', async () => {
        const { controlPlane, repository, oauthClient, credentialStore } = createControlPlane();

        const result = await controlPlane.exchange_and_register({
            authorization_code: 'oauth-code-from-slack',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        });

        expect(result).toMatchObject({
            tenant_id: IDS.tenant,
            workspace_id: binding.expected_workspace_id,
            status: 'active'
        });
        expect(oauthClient.exchangeCode).toHaveBeenCalledWith({
            authorization_code: 'oauth-code-from-slack',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback'
        });
        expect(credentialStore.store).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: IDS.tenant,
            idempotency_key: IDS.intent,
            credential_material: 'raw-token-never-persisted'
        }));
        const registerInput = repository.registerSlackInstallation.mock.calls[0][0];
        expect(registerInput.credential).toEqual({
            credential_ref: 'opaque-ref:tenant-a:connection-1',
            credential_mode: 'customer_oauth',
            refresh_revision: 1
        });
        expect(JSON.stringify(registerInput)).not.toContain('raw-token-never-persisted');
        expect(JSON.stringify(registerInput)).not.toContain('raw-refresh-never-persisted');
    });

    it('returns the completed ledger result before exchanging a replayed OAuth code', async () => {
        const previous = { connection_id: 'wsc_previous', status: 'active', tenant_id: IDS.tenant };
        const { controlPlane, repository, oauthClient, credentialStore } = createControlPlane({
            repository: {
                readSlackInstallationResult: vi.fn(async () => previous)
            }
        });

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'replayed-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).resolves.toEqual(previous);
        expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
        expect(credentialStore.store).not.toHaveBeenCalled();
        expect(repository.registerSlackInstallation).not.toHaveBeenCalled();
    });

    it('fails closed on app mismatch before the credential boundary', async () => {
        const { controlPlane, oauthClient, credentialStore, repository } = createControlPlane({
            oauthClient: {
                exchangeCode: vi.fn(async () => ({
                    app_id: 'different-app',
                    team_id: binding.expected_workspace_id,
                    authed_user_id: 'U0123456789',
                    scope: 'chat:write',
                    credential_material: 'must-not-cross-boundary'
                }))
            }
        });

        await expectContractErrorAsync(
            () => controlPlane.exchange_and_register({
                authorization_code: 'oauth-code',
                redirect_uri: 'https://mana.example.test/slack/oauth/callback',
                intent: binding
            }),
            { code: 'WORKSPACE_CONNECTION_CONFLICT', status: 409 }
        );
        expect(credentialStore.store).not.toHaveBeenCalled();
        expect(repository.registerSlackInstallation).not.toHaveBeenCalled();
    });

    it('revokes an opaque credential reference when the transactional registration fails', async () => {
        const { controlPlane, credentialStore } = createControlPlane({
            repository: {
                registerSlackInstallation: vi.fn(async () => {
                    throw new Error('database unavailable');
                })
            }
        });

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).rejects.toThrow('database unavailable');
        expect(credentialStore.revoke).toHaveBeenCalledWith({
            tenant_id: IDS.tenant,
            credential_ref: 'opaque-ref:tenant-a:connection-1',
            reason: 'registration_failed'
        });
    });

    it('redacts authorization code and credential material from diagnostics', () => {
        const redacted = redactSlackInstallationExchange({
            authorization_code: 'oauth-code',
            intent: binding
        });
        expect(redacted).toMatchObject({ installation_intent_id: IDS.intent, tenant_id: IDS.tenant });
        expect(JSON.stringify(redacted)).not.toContain('oauth-code');
        expect(JSON.stringify(redacted)).not.toContain('credential');
    });

    it('accepts only canonical installation identity and tenant binding fields', () => {
        expect(validateSlackInstallationBinding(binding)).toEqual(binding);
        expect(() => validateSlackInstallationBinding({ ...binding, installation_intent_id: 'intent-a' }))
            .toThrow(/INSTALLATION_BINDING_MISMATCH/);
    });
});
