// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
    AuthProviderNotFoundError,
    AuthProviderRegistry,
    AuthProviderValidationError,
    normalizeExternalIdentity
} from '../../server/services/auth/auth-provider-registry.js';

function provider(overrides = {}) {
    return {
        id: 'example',
        displayName: 'Example Login',
        authMethods: ['oidc'],
        capabilities: ['login'],
        resolveIdentity: vi.fn(),
        ...overrides
    };
}

describe('AuthProviderRegistry', () => {
    it('registers and resolves a provider by stable id', () => {
        const registry = new AuthProviderRegistry();
        const definition = provider();

        expect(registry.register(definition)).toBe(definition);
        expect(registry.get('example')).toBe(definition);
        expect(registry.has('example')).toBe(true);
        expect(registry.list()).toEqual([definition]);
    });

    it('rejects malformed provider definitions before they enter the registry', () => {
        const registry = new AuthProviderRegistry();

        expect(() => registry.register(provider({ id: 'Bad ID' })))
            .toThrow(AuthProviderValidationError);
        expect(() => registry.register(provider({ authMethods: [] })))
            .toThrow(AuthProviderValidationError);
        expect(() => registry.register(provider({ capabilities: 'login' })))
            .toThrow(AuthProviderValidationError);
        expect(() => registry.register(provider({ resolveIdentity: undefined })))
            .toThrow(AuthProviderValidationError);
        expect(registry.list()).toEqual([]);
    });

    it('supports non-OAuth providers without forcing an OAuth implementation', () => {
        const registry = new AuthProviderRegistry();
        const passkey = provider({
            id: 'passkey',
            displayName: 'Passkey',
            authMethods: ['passkey'],
            verifyAssertion: vi.fn()
        });

        registry.register(passkey);

        expect(registry.require('passkey')).toBe(passkey);
    });

    it('warns and replaces a duplicate provider explicitly', () => {
        const warn = vi.fn();
        const registry = new AuthProviderRegistry({ logger: { warn } });
        const first = provider();
        const second = provider({ displayName: 'Updated Example' });

        registry.register(first);
        registry.register(second);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(registry.get('example')).toBe(second);
    });

    it('returns null for an unknown provider and throws from require', () => {
        const registry = new AuthProviderRegistry();

        expect(registry.get('missing')).toBeNull();
        expect(() => registry.require('missing')).toThrow(AuthProviderNotFoundError);
    });
});

describe('normalizeExternalIdentity', () => {
    it('normalizes the provider-neutral identity while retaining provider aliases', () => {
        expect(normalizeExternalIdentity({
            provider: 'slack',
            subject: ' U123 ',
            tenantId: ' T123 ',
            email: 'sato@example.com',
            name: 'Sato'
        })).toEqual({
            provider: 'slack',
            subject: 'U123',
            tenantId: 'T123',
            externalSubjectId: 'U123',
            externalTenantId: 'T123',
            email: 'sato@example.com',
            name: 'Sato'
        });
    });

    it('rejects an identity without a provider or external subject', () => {
        expect(() => normalizeExternalIdentity({ subject: 'U123' }))
            .toThrow(AuthProviderValidationError);
        expect(() => normalizeExternalIdentity({ provider: 'slack' }))
            .toThrow(AuthProviderValidationError);
    });
});
