import { describe, expect, it } from 'vitest';

import { createSlackInstallationOAuthFlow } from '../../../../server/services/multitenant/slack-installation-oauth-flow.js';

const binding = {
    installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX',
    app_id: 'A0123456789',
    expected_workspace_id: 'T0123456789',
    initiated_by_person_id: 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY'
};

const now = new Date('2026-09-05T00:00:00.000Z');

function flow(overrides = {}) {
    return createSlackInstallationOAuthFlow({
        clientId: '7349615796725.10064501020500',
        redirectUri: 'https://bb.unson.jp/api/v1/slack-installations:callback',
        stateSecret: 'state-secret-long-enough-for-production-tests',
        botScopes: 'chat:write,commands',
        now: () => now,
        ...overrides
    });
}

describe('Slack installation OAuth browser flow', () => {
    it('creates a bounded Slack authorization URL and verifies its signed state', () => {
        const authorization = flow().createAuthorization(binding);
        const url = new URL(authorization.authorization_url);

        expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
        expect(url.searchParams.get('client_id')).toBe('7349615796725.10064501020500');
        expect(url.searchParams.get('redirect_uri')).toBe(authorization.redirect_uri);
        expect(url.searchParams.get('scope')).toBe('chat:write,commands');
        expect(url.searchParams.get('team')).toBe(binding.expected_workspace_id);
        expect(authorization).not.toHaveProperty('client_secret');
        expect(flow().open(authorization.oauth_state)).toEqual({
            intent: binding,
            redirect_uri: authorization.redirect_uri
        });
    });

    it.each([
        ['tampered', (state) => `${state.slice(0, -1)}${state.endsWith('a') ? 'b' : 'a'}`, () => now],
        ['expired', (state) => state, () => new Date(now.getTime() + 11 * 60_000)]
    ])('rejects %s state without returning its contents', (_label, mutate, callbackNow) => {
        const state = flow().createAuthorization(binding).oauth_state;
        const open = () => flow({ now: callbackNow }).open(mutate(state));
        expect(open).toThrow(expect.objectContaining({ code: 'INSTALLATION_STATE_INVALID' }));
        expect(open).not.toThrow(/ten_01ARZ3NDEKTSV4RRFFQ69G5FAX/u);
    });
});
