import { describe, expect, it, vi } from 'vitest';

import {
    SlackInstallationControlPlane,
    redactSlackInstallationExchange,
    validateSlackInstallationBinding
} from '../../../../server/services/multitenant/slack-installation-control-plane.js';
import { ContractError } from '../../../../server/services/multitenant/errors.js';
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
        claimSlackInstallationExchange: vi.fn(async () => ({ status: 'claimed', attempt: 1 })),
        reserveSlackInstallationConnection: vi.fn(async ({ proposed_connection_id: proposedConnectionId }) => ({
            status: 'reserved',
            connection_id: proposedConnectionId,
            connection_revision: '1'
        })),
        failSlackInstallationExchange: vi.fn(async () => true),
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
        revoke: vi.fn(async () => ({ status: 'revoked' })),
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

    it('persists an authorized binding through the caller transaction when supplied', async () => {
        const { controlPlane, repository } = createControlPlane();
        const client = { query: vi.fn() };

        await expect(controlPlane.authorizeBinding(binding, { client })).resolves.toEqual(binding);

        expect(repository.createSlackInstallationIntent).toHaveBeenCalledWith(
            expect.objectContaining(binding), { client }
        );
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
            connection_revision: '1',
            credential_material: 'raw-token-never-persisted'
        }));
        const registerInput = repository.registerSlackInstallation.mock.calls[0][0];
        expect(registerInput.connection_id).toBe(credentialStore.store.mock.calls[0][0].connection_id);
        expect(registerInput.connection_revision).toBe('1');
        expect(registerInput.credential).toEqual({
            credential_ref: 'opaque-ref:tenant-a:connection-1',
            credential_mode: 'customer_oauth',
            refresh_revision: 1
        });
        expect(JSON.stringify(registerInput)).not.toContain('raw-token-never-persisted');
        expect(JSON.stringify(registerInput)).not.toContain('raw-refresh-never-persisted');
        expect(registerInput.claim_token).toEqual(expect.any(String));
        expect(registerInput.request_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it('returns the completed ledger result before exchanging a replayed OAuth code', async () => {
        const previous = { connection_id: 'wsc_previous', status: 'active', tenant_id: IDS.tenant };
        const { controlPlane, repository, oauthClient, credentialStore } = createControlPlane({
            repository: {
                claimSlackInstallationExchange: vi.fn(async () => ({
                    status: 'completed',
                    response_payload: previous
                }))
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
        expect(repository.failSlackInstallationExchange).not.toHaveBeenCalled();
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
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            failure_stage: 'exchange_normalize',
            failure_code: 'WORKSPACE_CONNECTION_CONFLICT'
        }));
    });

    it.each([
        ['connection_reserve', 'CONNECTION_RESERVATION_FAILED', {
            repository: { reserveSlackInstallationConnection: vi.fn(async () => { throw new Error('database reserve detail'); }) }
        }]
    ])('records %s with its stage-specific generic code', async (failureStage, failureCode, overrides) => {
        const { controlPlane, repository } = createControlPlane(overrides);
        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).rejects.toThrow();
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            failure_stage: failureStage,
            failure_code: failureCode,
            cleanup_status: 'not_needed'
        }));
    });

    it('records cleanup as not needed when credential storage fails before returning a reference', async () => {
        const { controlPlane, credentialStore, repository } = createControlPlane({
            credentialStore: { store: vi.fn(async () => { throw new Error('secret store detail'); }) }
        });

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).rejects.toThrow('secret store detail');
        expect(credentialStore.revoke).not.toHaveBeenCalled();
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            failure_stage: 'credential_store',
            failure_code: 'CREDENTIAL_STORE_FAILED',
            cleanup_status: 'not_needed'
        }));
    });

    it('does not attempt cleanup when the credential store returns no valid reference', async () => {
        const { controlPlane, credentialStore, repository } = createControlPlane({
            credentialStore: { store: vi.fn(async () => ({ credential_ref: '' })) }
        });

        await expectContractErrorAsync(
            () => controlPlane.exchange_and_register({
                authorization_code: 'oauth-code',
                redirect_uri: 'https://mana.example.test/slack/oauth/callback',
                intent: binding
            }),
            { code: 'CREDENTIAL_REF_INVALID', status: 503 }
        );
        expect(credentialStore.revoke).not.toHaveBeenCalled();
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            failure_stage: 'credential_store',
            failure_code: 'CREDENTIAL_REF_INVALID',
            cleanup_status: 'not_needed'
        }));
    });

    it('revokes an opaque credential reference when the transactional registration fails', async () => {
        const { controlPlane, credentialStore, repository } = createControlPlane({
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
        expect(credentialStore.revoke).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: IDS.tenant,
            connection_revision: '1',
            provider: 'slack',
            credential_ref: 'opaque-ref:tenant-a:connection-1',
            reason: 'registration_failed'
        }));
        expect(credentialStore.revoke.mock.calls[0][0].connection_id)
            .toBe(credentialStore.store.mock.calls[0][0].connection_id);
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            failure_stage: 'db_register',
            failure_code: 'DB_REGISTRATION_FAILED',
            cleanup_status: 'revoked'
        }));
    });

    it('records the exact failure stage and ignores forged error codes', async () => {
        const forged = Object.assign(new Error('raw upstream body'), { code: 'EVIL_RAW_CODE' });
        const { controlPlane, repository } = createControlPlane({
            oauthClient: { exchangeCode: vi.fn(async () => { throw forged; }) }
        });

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).rejects.toBe(forged);
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            failure_stage: 'oauth_exchange',
            failure_code: 'OAUTH_EXCHANGE_FAILED',
            cleanup_status: 'not_needed'
        }));
        expect(JSON.stringify(repository.failSlackInstallationExchange.mock.calls[0][0]))
            .not.toContain('raw upstream body');
    });

    it('does not preserve a known failure code from a different stage', async () => {
        const mismatched = new ContractError('CREDENTIAL_STORE_UNAVAILABLE', { status: 503 });
        const { controlPlane, repository } = createControlPlane({
            oauthClient: { exchangeCode: vi.fn(async () => { throw mismatched; }) }
        });

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).rejects.toBe(mismatched);
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            failure_stage: 'oauth_exchange',
            failure_code: 'OAUTH_EXCHANGE_FAILED'
        }));
    });

    it('records cleanup failure without exposing the opaque credential reference', async () => {
        const { controlPlane, credentialStore, repository } = createControlPlane({
            repository: { registerSlackInstallation: vi.fn(async () => { throw new Error('database unavailable'); }) },
            credentialStore: { revoke: vi.fn(async () => { throw new Error('revoke unavailable'); }) }
        });

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).rejects.toThrow('database unavailable');
        expect(credentialStore.revoke).toHaveBeenCalledOnce();
        const diagnostic = repository.failSlackInstallationExchange.mock.calls[0][0];
        expect(diagnostic).toMatchObject({
            failure_stage: 'db_register',
            failure_code: 'DB_REGISTRATION_FAILED',
            cleanup_status: 'failed'
        });
        expect(JSON.stringify(diagnostic)).not.toContain('opaque-ref');
    });

    it('does not mark cleanup revoked without an explicit revoke receipt', async () => {
        const { controlPlane, repository } = createControlPlane({
            repository: { registerSlackInstallation: vi.fn(async () => { throw new Error('database unavailable'); }) },
            credentialStore: { revoke: vi.fn(async () => undefined) }
        });

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        })).rejects.toThrow('database unavailable');
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledWith(expect.objectContaining({
            cleanup_status: 'failed'
        }));
    });

    it('claims before OAuth and suppresses a concurrent callback', async () => {
        let releaseFirst;
        const firstExchange = new Promise((resolve) => { releaseFirst = resolve; });
        const { controlPlane, oauthClient, credentialStore, repository } = createControlPlane({
            oauthClient: {
                exchangeCode: vi.fn()
                    .mockImplementationOnce(() => firstExchange)
                    .mockResolvedValueOnce({
                        app_id: binding.app_id,
                        team_id: binding.expected_workspace_id,
                        authed_user_id: 'U0123456789',
                        scope: 'chat:write',
                        credential_material: 'second-token'
                    })
            },
            repository: {
                claimSlackInstallationExchange: vi.fn()
                    .mockResolvedValueOnce({ status: 'claimed', attempt: 1 })
                    .mockRejectedValueOnce(Object.assign(new Error('in progress'), {
                        code: 'INSTALLATION_IN_PROGRESS', status: 409
                    }))
            }
        });
        const input = {
            authorization_code: 'oauth-code-one',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        };
        const first = controlPlane.exchange_and_register(input);
        await vi.waitFor(() => expect(repository.claimSlackInstallationExchange).toHaveBeenCalledTimes(1));
        await expect(controlPlane.exchange_and_register({ ...input, authorization_code: 'oauth-code-two' }))
            .rejects.toMatchObject({ code: 'INSTALLATION_IN_PROGRESS' });
        expect(oauthClient.exchangeCode).toHaveBeenCalledTimes(1);
        expect(credentialStore.store).not.toHaveBeenCalled();
        releaseFirst({
            app_id: binding.app_id,
            team_id: binding.expected_workspace_id,
            authed_user_id: 'U0123456789',
            scope: 'chat:write',
            credential_material: 'first-token'
        });
        await first;
    });

    it('marks failed claims retryable and fences stale completion', async () => {
        let registerCalls = 0;
        const { controlPlane, repository, oauthClient, credentialStore } = createControlPlane({
            repository: {
                claimSlackInstallationExchange: vi.fn()
                    .mockResolvedValueOnce({ status: 'claimed', attempt: 1 })
                    .mockResolvedValueOnce({ status: 'claimed', attempt: 2 }),
                registerSlackInstallation: vi.fn()
                    .mockImplementation(async ({ claim_token }) => {
                        registerCalls += 1;
                        if (registerCalls === 1) {
                            throw Object.assign(new Error('stale claim'), { code: 'INSTALLATION_CLAIM_STALE' });
                        }
                        return { status: 'active', connection_revision: '1', claim_token_seen: claim_token };
                    })
            }
        });
        const input = {
            authorization_code: 'oauth-code-one',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        };
        await expect(controlPlane.exchange_and_register(input)).rejects.toThrow('stale claim');
        expect(repository.failSlackInstallationExchange).toHaveBeenCalledTimes(1);
        await expect(controlPlane.exchange_and_register({ ...input, authorization_code: 'oauth-code-two' }))
            .resolves.toMatchObject({ status: 'active' });
        expect(oauthClient.exchangeCode).toHaveBeenCalledTimes(2);
        expect(credentialStore.store).toHaveBeenCalledTimes(2);
        expect(credentialStore.revoke).toHaveBeenCalledTimes(1);
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
