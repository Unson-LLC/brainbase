// @ts-check
/**
 * X Provider Adapter (SPEC-sns-account-management)
 * SPEC-settings-plugin-contract-v2 の ProviderDefinition を満たす
 */

import { signOAuthState, verifyOAuthState, generateNonce } from '../../account/provider-registry.js';

/**
 * @param {{ xClient: import('./x-client.js').XClient, oauthSecret?: string }} deps
 */
export function buildXProvider({ xClient, oauthSecret = 'test-secret' }) {
    if (!xClient) throw new Error('xClient required');
    return {
        service: 'x',
        authMethods: ['oauth2_pkce'],
        capabilities: ['post', 'read'],
        publicMetadataSchema: { external_handle: 'string', external_account_id: 'string' },
        credentialKeySpec: ['access_token', 'refresh_token'],

        async startOAuth(ctx) {
            // INV-2: state を署名 + one-time nonce
            const nonce = generateNonce();
            const state = signOAuthState({
                actor_person_id: ctx.actor_person_id,
                scope: ctx.scope,
                org_id: ctx.org_id,
                project_id: ctx.project_id,
                return_url: ctx.return_url,
                nonce
            }, oauthSecret);
            const result = await xClient.startOAuth({ ...ctx, state });
            return { url: result.url, state };
        },

        async handleCallback(params) {
            // state を検証してから client.exchangeCallback
            const verified = verifyOAuthState(params.state, oauthSecret);
            if (!verified.valid) {
                const err = new Error(`oauth state invalid: ${verified.reason}`);
                err.code = 'invalid_state';
                throw err;
            }
            const exchange = await xClient.exchangeCallback(params);
            return {
                credentialRef: exchange.credential_metadata,
                externalAccountId: exchange.external_account_id,
                externalHandle: exchange.external_handle,
                statePayload: verified.payload
            };
        },

        async refreshCredential(credential_ref) {
            const { credential_metadata } = await xClient.refresh(credential_ref);
            return credential_metadata;
        },

        async revokeCredential(credential_ref) {
            await xClient.revoke(credential_ref);
        },

        async healthCheck(credential_ref) {
            return xClient.healthCheck(credential_ref);
        },

        async getRateLimitStatus(credential_ref) {
            return xClient.getRateLimitStatus(credential_ref);
        },

        async post(credential_ref, payload) {
            return xClient.postTweet(credential_ref, payload);
        },

        async fetchMetrics(credential_ref, tweet_id) {
            return xClient.fetchTweetMetrics(credential_ref, tweet_id);
        }
    };
}
