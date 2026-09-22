import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OrganizationConnectionError,
  OrganizationConnectionService,
  type OrganizationConnectionAuditEntry,
  type OrganizationConnectionBinding,
  type OrganizationConnectionProviderAdapter,
  type OrganizationConnectionReadback,
  type OrganizationConnectionStateRecord,
  type OrganizationConnectionStateRepository,
} from '../src/organization-connection.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createFixture(options: {
  adapter?: Partial<OrganizationConnectionProviderAdapter>;
  policy?: { deny?: boolean };
  auditFailure?: boolean;
} = {}) {
  const records = new Map<string, { record: OrganizationConnectionStateRecord; consumedAt?: string }>();
  const audits: OrganizationConnectionAuditEntry[] = [];
  const adapterCalls: { action: string; code?: string }[] = [];
  const binding: OrganizationConnectionBinding = {
    tenantId: 'tenant-a',
    personId: 'person-a',
  };
  let now = new Date('2026-09-22T00:00:00.000Z');
  const defaultReadback: OrganizationConnectionReadback = {
    provider: 'slack',
    connectionId: 'connection-1',
    status: 'active',
    displayName: 'Consumer workspace',
    externalId: 'workspace-1',
    scopes: ['channels:read'],
    connectedAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  };
  const repository: OrganizationConnectionStateRepository = {
    async save(record) {
      records.set(record.stateHash, { record: clone(record) });
    },
    async consume({ stateHash, now: current }) {
      const entry = records.get(stateHash);
      if (!entry) return { status: 'missing' };
      if (entry.consumedAt) {
        return { status: 'replayed', record: clone(entry.record) };
      }
      if (Date.parse(current) >= Date.parse(entry.record.expiresAt)) {
        return { status: 'expired', record: clone(entry.record) };
      }
      entry.consumedAt = current;
      return {
        status: 'consumed',
        record: clone(entry.record),
        consumedAt: current,
      };
    },
  };
  const providerAdapter: OrganizationConnectionProviderAdapter = {
    async createAuthorization({ state }) {
      adapterCalls.push({ action: 'authorize' });
      if (options.adapter?.createAuthorization) {
        return options.adapter.createAuthorization({
          provider: 'slack',
          binding,
          state,
          intent: { returnRef: 'connections' },
        });
      }
      return { authorizationUrl: `https://provider.example.test/authorize?state=${state}` };
    },
    async exchangeAuthorizationCode(input) {
      adapterCalls.push({ action: 'exchange', code: input.code });
      if (options.adapter?.exchangeAuthorizationCode) {
        return options.adapter.exchangeAuthorizationCode(input);
      }
      return clone(defaultReadback);
    },
    async readConnection(input) {
      adapterCalls.push({ action: 'read' });
      if (options.adapter?.readConnection) return options.adapter.readConnection(input);
      return clone(defaultReadback);
    },
  };
  const service = new OrganizationConnectionService({
    stateRepository: repository,
    providerAdapter,
    policy: {
      authorize() {
        if (options.policy?.deny) throw new Error('private policy detail');
      },
    },
    audit: {
      async record(entry) {
        if (options.auditFailure) throw new Error('private audit detail');
        audits.push(clone(entry));
      },
    },
    clock: () => new Date(now),
    stateTtlSeconds: 60,
  });
  return {
    service,
    records,
    audits,
    adapterCalls,
    binding,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

describe('OrganizationConnectionService', () => {
  it('issues opaque state with a hashed repository record and a bounded TTL', async () => {
    const fixture = createFixture();
    const started = await fixture.service.startAuthorization({
      provider: 'Slack',
      binding: fixture.binding,
      intent: { returnRef: 'connections', workspaceId: 'workspace-1' },
    });

    expect(started).toMatchObject({
      provider: 'slack',
      binding: fixture.binding,
      expiresAt: '2026-09-22T00:01:00.000Z',
      authorizationUrl: expect.stringContaining('https://provider.example.test/authorize?state='),
    });
    expect(started.state).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
    const stateHash = createHash('sha256').update(started.state).digest('hex');
    const stored = fixture.records.get(stateHash)?.record;
    expect(stored).toMatchObject({
      id: expect.stringMatching(/^org-connection-state-[a-f0-9]{24}$/u),
      stateHash,
      provider: 'slack',
      binding: fixture.binding,
      intent: { returnRef: 'connections', workspaceId: 'workspace-1' },
      issuedAt: '2026-09-22T00:00:00.000Z',
      expiresAt: '2026-09-22T00:01:00.000Z',
    });
    expect(stored).not.toHaveProperty('state');
    expect(JSON.stringify(stored)).not.toContain(started.state);
  });

  it('enforces tenant/person/provider binding and consumes state only once', async () => {
    const fixture = createFixture();
    const started = await fixture.service.startAuthorization({
      provider: 'slack',
      binding: fixture.binding,
      intent: { returnRef: 'connections' },
    });
    const completed = await fixture.service.completeAuthorization({
      provider: 'slack',
      binding: fixture.binding,
      state: started.state,
      code: 'authorization-code',
    });

    expect(completed).toEqual({
      connection: expect.objectContaining({
        provider: 'slack',
        connectionId: 'connection-1',
        status: 'active',
      }),
      consumedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(fixture.adapterCalls).toContainEqual({ action: 'exchange', code: 'authorization-code' });
    expect(fixture.audits[1]).toMatchObject({
      action: 'complete',
      provider: 'slack',
      binding: fixture.binding,
      stateId: expect.stringMatching(/^org-connection-state-/u),
      connectionId: 'connection-1',
      status: 'active',
    });
    expect(fixture.audits[1]).not.toHaveProperty('code');
    expect(fixture.audits[1]).not.toHaveProperty('state');
    expect(JSON.stringify(fixture.audits)).not.toContain('authorization-code');

    await expect(fixture.service.completeAuthorization({
      provider: 'slack',
      binding: fixture.binding,
      state: started.state,
      code: 'authorization-code',
    })).rejects.toMatchObject({
      code: 'oauth_state_replayed',
      status: 409,
      details: {},
    });
    expect(fixture.adapterCalls.filter((call) => call.action === 'exchange')).toHaveLength(1);
  });

  it('rejects a callback from another tenant/person before provider exchange', async () => {
    const fixture = createFixture();
    const started = await fixture.service.startAuthorization({
      provider: 'slack',
      binding: fixture.binding,
    });
    await expect(fixture.service.completeAuthorization({
      provider: 'slack',
      binding: { tenantId: 'tenant-b', personId: 'person-b' },
      state: started.state,
      code: 'authorization-code',
    })).rejects.toMatchObject({ code: 'oauth_state_binding_mismatch', status: 403, details: {} });
    expect(fixture.adapterCalls.filter((call) => call.action === 'exchange')).toHaveLength(0);
  });

  it('rejects an expired state and does not expose the supplied code', async () => {
    const fixture = createFixture();
    const started = await fixture.service.startAuthorization({
      provider: 'slack',
      binding: fixture.binding,
    });
    fixture.setNow('2026-09-22T00:01:00.000Z');
    const error = await fixture.service.completeAuthorization({
      provider: 'slack',
      binding: fixture.binding,
      state: started.state,
      code: 'private-authorization-code',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'oauth_state_expired', status: 400, details: {} });
    expect(String(error)).not.toContain('private-authorization-code');
    expect(fixture.adapterCalls.filter((call) => call.action === 'exchange')).toHaveLength(0);
  });

  it('delegates authorization policy and returns a stable forbidden error', async () => {
    const fixture = createFixture({ policy: { deny: true } });
    await expect(fixture.service.startAuthorization({
      provider: 'slack',
      binding: fixture.binding,
    })).rejects.toMatchObject({
      code: 'connection_forbidden',
      status: 403,
      message: 'Connection operation is not authorized',
      details: {},
    });
    expect(fixture.records.size).toBe(0);
  });

  it('normalizes provider failures without leaking adapter errors', async () => {
    const fixture = createFixture({
      adapter: {
        async createAuthorization() {
          throw new OrganizationConnectionError(
            'provider_internal',
            'provider secret and access_token details',
            500,
            { access_token: 'secret' },
          );
        },
      },
    });
    await expect(fixture.service.startAuthorization({
      provider: 'slack',
      binding: fixture.binding,
    })).rejects.toMatchObject({
      code: 'connection_provider_unavailable',
      status: 503,
      message: 'Connection provider is unavailable',
      details: {},
    });
    await expect(fixture.service.completeAuthorization({
      provider: 'slack',
      binding: fixture.binding,
      state: 'unknown-state',
      code: 'secret-code',
    })).rejects.toMatchObject({ code: 'oauth_state_invalid', details: {} });

    const exchangeFailure = createFixture({
      adapter: {
        async exchangeAuthorizationCode() {
          throw new Error('provider access_token response detail');
        },
      },
    });
    const started = await exchangeFailure.service.startAuthorization({
      provider: 'slack',
      binding: exchangeFailure.binding,
    });
    const exchangeError = await exchangeFailure.service.completeAuthorization({
      provider: 'slack',
      binding: exchangeFailure.binding,
      state: started.state,
      code: 'secret-code',
    }).catch((caught: unknown) => caught);
    expect(exchangeError).toMatchObject({
      code: 'connection_provider_unavailable',
      status: 503,
      details: {},
    });
    expect(String(exchangeError)).not.toContain('access_token');

    const policyFailure = createFixture({ policy: { deny: true } });
    await expect(policyFailure.service.startAuthorization({
      provider: 'slack',
      binding: policyFailure.binding,
    })).rejects.toMatchObject({
      code: 'connection_forbidden',
      status: 403,
      message: 'Connection operation is not authorized',
      details: {},
    });

    const malformedUrl = createFixture({
      adapter: {
        async createAuthorization() {
          return { authorizationUrl: 42 as unknown as string };
        },
      },
    });
    await expect(malformedUrl.service.startAuthorization({
      provider: 'slack',
      binding: malformedUrl.binding,
    })).rejects.toMatchObject({
      code: 'connection_provider_response_invalid',
      status: 502,
      details: {},
    });
  });

  it('projects safe readback and rejects credential-shaped provider fields', async () => {
    const fixture = createFixture();
    const readback = await fixture.service.readConnection({
      provider: 'slack',
      binding: fixture.binding,
      connectionId: 'connection-1',
    });
    expect(readback).toMatchObject({
      provider: 'slack',
      connectionId: 'connection-1',
      status: 'active',
      displayName: 'Consumer workspace',
    });
    expect(readback).not.toHaveProperty('accessToken');
    expect(fixture.audits.at(-1)).toMatchObject({
      action: 'read',
      connectionId: 'connection-1',
      status: 'active',
    });

    const unsafe = createFixture({
      adapter: {
        async readConnection() {
          return { provider: 'slack', connectionId: 'connection-1', status: 'active', access_token: 'secret' };
        },
      },
    });
    await expect(unsafe.service.readConnection({
      provider: 'slack',
      binding: unsafe.binding,
    })).rejects.toMatchObject({
      code: 'connection_provider_response_invalid',
      status: 502,
      details: {},
    });

    const mismatched = createFixture({
      adapter: {
        async readConnection() {
          return { provider: 'slack', connectionId: 'connection-2', status: 'active' };
        },
      },
    });
    await expect(mismatched.service.readConnection({
      provider: 'slack',
      binding: mismatched.binding,
      connectionId: 'connection-1',
    })).rejects.toMatchObject({ code: 'connection_provider_response_invalid', status: 502 });
  });

  it('normalizes audit failures without leaking audit implementation details', async () => {
    const fixture = createFixture({ auditFailure: true });
    await expect(fixture.service.startAuthorization({
      provider: 'slack',
      binding: fixture.binding,
    })).rejects.toMatchObject({
      code: 'connection_audit_unavailable',
      status: 503,
      message: 'Connection audit is unavailable',
      details: {},
    });
    expect(fixture.records.size).toBe(1);
  });

  it('rejects sensitive intent keys before persisting state', async () => {
    const fixture = createFixture();
    await expect(fixture.service.startAuthorization({
      provider: 'slack',
      binding: fixture.binding,
      intent: { returnRef: 'connections', access_token: 'secret' },
    })).rejects.toMatchObject({ code: 'validation_error', status: 400, details: { field: 'intent' } });
    expect(fixture.records.size).toBe(0);
  });

  it('exposes a typed stable error envelope', () => {
    const error = new OrganizationConnectionError('validation_error', 'invalid input', 400, { field: 'state' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'OrganizationConnectionError',
      code: 'validation_error',
      status: 400,
      details: { field: 'state' },
    });
  });
});
