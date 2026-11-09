import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationMemberInviteError,
  OrganizationMemberInviteService,
  createInMemoryOrganizationMemberInviteRepository,
  createOrganizationMemberInviteId,
  normalizeOrganizationMemberInviteEmail,
  type OrganizationMemberInviteAcceptBinding,
  type OrganizationMemberInviteAudit,
  type OrganizationMemberInviteDelivery,
  type OrganizationMemberInviteEnvelope,
  type OrganizationMemberInvitePolicy,
  type OrganizationMemberInviteRepository,
  type OrganizationMemberInviteAcceptUrlBuilder,
} from '../src/organization-member-invite.js';
import {
  createOrganizationMemberInviteHttpHandler,
  type TrustedOrganizationMemberInviteRequestContext,
} from '../src/organization-member-invite-http.js';

const admin = { tenantId: 'tenant-a', personId: 'admin-1' };
const invitee = { personId: 'person-9', email: 'Hanako@Example.COM', emailVerified: true };

function setup(overrides: {
  policy?: Partial<OrganizationMemberInvitePolicy>;
  bind?: OrganizationMemberInviteAcceptBinding['bind'];
  delivery?: OrganizationMemberInviteDelivery['send'];
  audit?: OrganizationMemberInviteAudit['record'];
  repository?: OrganizationMemberInviteRepository;
  buildAcceptUrl?: OrganizationMemberInviteAcceptUrlBuilder;
} = {}) {
  let now = new Date('2026-11-08T00:00:00.000Z');
  const repository = overrides.repository ?? createInMemoryOrganizationMemberInviteRepository();
  const sent: OrganizationMemberInviteEnvelope[] = [];
  const auditEntries: unknown[] = [];
  const bind = vi.fn(overrides.bind ?? (async () => ({ outcome: 'bound' as const })));
  const authorize = vi.fn(overrides.policy?.authorize ?? (() => {}));
  const service = new OrganizationMemberInviteService({
    repository,
    policy: { ...overrides.policy, authorize },
    acceptBinding: { bind },
    delivery: {
      send: overrides.delivery ?? (async (envelope) => {
        sent.push(envelope);
      }),
    },
    audit: {
      record: overrides.audit ?? (async (entry) => {
        auditEntries.push(entry);
      }),
    },
    buildAcceptUrl: overrides.buildAcceptUrl ?? (({ token }) => `https://org.example.test/invites/accept#token=${token}`),
    clock: () => now,
  });
  return {
    service,
    repository,
    sent,
    auditEntries,
    bind,
    authorize,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(OrganizationMemberInviteError);
  expect((error as OrganizationMemberInviteError).code).toBe(code);
  if (status !== undefined) expect((error as OrganizationMemberInviteError).status).toBe(status);
  return error as OrganizationMemberInviteError;
}

describe('organization member invite kernel', () => {
  it('issues an opaque token, stores only its SHA-256 hash, and delivers a non-secret envelope', async () => {
    const ctx = setup();
    const result = await ctx.service.createInvite({
      actor: admin,
      inviteeEmail: '  Hanako@Example.COM ',
      role: 'member',
      inviterDisplayName: 'Admin One',
      metadata: { note: 'design team' },
    });

    expect(result.invite.inviteId).toMatch(/^omi_/u);
    expect(result.invite.inviteeEmail).toBe('hanako@example.com');
    expect(result.invite.status).toBe('pending');
    expect(result.invite.expiresAt).toBe('2026-11-15T00:00:00.000Z');
    expect(result.acceptUrl).toContain(result.token);
    expect(result.delivered).toBe(true);

    const [stored] = ctx.repository.snapshot();
    expect(stored.tokenHash).toBe(createHash('sha256').update(result.token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(JSON.stringify(result.invite)).not.toContain(stored.tokenHash);
    expect(result.invite).not.toHaveProperty('tokenHash');
    expect(result.invite).not.toHaveProperty('reservation');

    expect(ctx.sent).toEqual([{
      kind: 'invite',
      inviteId: result.invite.inviteId,
      tenantId: 'tenant-a',
      to: 'hanako@example.com',
      acceptUrl: result.acceptUrl,
      inviterDisplayName: 'Admin One',
      expiresAt: result.invite.expiresAt,
      role: 'member',
    }]);
    expect(Object.keys(ctx.sent[0])).not.toContain('token');
    expect(JSON.stringify(ctx.auditEntries)).not.toContain(result.token);
    expect(JSON.stringify(ctx.auditEntries)).not.toContain('hanako@example.com');
  });

  it('normalizes email and rejects secret-shaped metadata', async () => {
    expect(normalizeOrganizationMemberInviteEmail(' A@B.Example ')).toBe('a@b.example');
    const ctx = setup();
    await expectCode(ctx.service.createInvite({
      actor: admin, inviteeEmail: 'x@example.com', role: 'member', metadata: { nested: { client_secret: 'x' } },
    }), 'validation_error', 400);
    await expectCode(ctx.service.createInvite({
      actor: admin, inviteeEmail: 'not-an-email', role: 'member',
    }), 'validation_error', 400);
    expect(ctx.repository.snapshot()).toHaveLength(0);
  });

  it('delegates authorization to policy and does nothing when denied', async () => {
    const ctx = setup({ policy: { authorize: () => { throw new Error('nope: raw detail'); } } });
    const error = await expectCode(ctx.service.createInvite({
      actor: admin, inviteeEmail: 'x@example.com', role: 'owner',
    }), 'invite_forbidden', 403);
    expect(error.message).not.toContain('raw detail');
    expect(ctx.repository.snapshot()).toHaveLength(0);
    expect(ctx.sent).toHaveLength(0);
    expect(ctx.authorize).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', tenantId: 'tenant-a', actorPersonId: 'admin-1', role: 'owner',
    }));
  });

  it('checks the accepted role and releases a fresh reservation on policy denial', async () => {
    let deny = true;
    const ctx = setup({ policy: { authorize: (request) => {
      if (deny && request.action === 'accept' && request.role === 'owner') throw new Error('private');
    } } });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'owner' });
    await expectCode(ctx.service.acceptInvite({ tenantId: admin.tenantId, token: issued.token, person: invitee }), 'invite_forbidden');
    expect(ctx.bind).not.toHaveBeenCalled();
    expect(ctx.repository.snapshot()[0].status).toBe('pending');
    deny = false;
    expect((await ctx.service.acceptInvite({ tenantId: admin.tenantId, token: issued.token, person: invitee })).invite.status).toBe('accepted');
  });

  it('releases a fresh reservation when link-holder policy throws', async () => {
    const ctx = setup({ policy: { allowLinkHolderAccept: () => { throw new Error('private'); } } });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: 'other@example.com', role: 'member' });
    await expectCode(ctx.service.acceptInvite({ tenantId: admin.tenantId, token: issued.token, person: invitee }), 'invite_forbidden');
    expect(ctx.repository.snapshot()[0].status).toBe('pending');
    expect(ctx.bind).not.toHaveBeenCalled();
  });

  it('accepts once with a matching verified email and binds the role to the tenant', async () => {
    const ctx = setup();
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const accepted = await ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee });

    expect(accepted.invite.status).toBe('accepted');
    expect(accepted.invite.acceptedByPersonId).toBe('person-9');
    expect(ctx.bind).toHaveBeenCalledTimes(1);
    expect(ctx.bind).toHaveBeenCalledWith({
      inviteId: issued.invite.inviteId, tenantId: 'tenant-a', personId: 'person-9', role: 'member',
    });

    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      'invite_consumed', 409);
    await expectCode(ctx.service.acceptInvite({
      tenantId: 'tenant-a', token: issued.token, person: { ...invitee, personId: 'other' },
    }), 'invite_consumed', 409);
    expect(ctx.bind).toHaveBeenCalledTimes(1);
  });

  it('rejects a second person while the first acceptance is in progress (replayed)', async () => {
    let release!: () => void;
    const ctx = setup({
      policy: { allowLinkHolderAccept: () => true },
      bind: () => new Promise((resolve) => { release = () => resolve({ outcome: 'bound' }); }),
    });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const first = ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee });
    await vi.waitFor(() => expect(ctx.bind).toHaveBeenCalledTimes(1));
    await expectCode(ctx.service.acceptInvite({
      tenantId: 'tenant-a', token: issued.token, person: { personId: 'intruder' },
    }), 'invite_replayed', 409);
    await expectCode(ctx.service.revokeInvite({ actor: admin, inviteId: issued.invite.inviteId }),
      'accept_in_progress', 409);
    await expectCode(ctx.service.reissue({ actor: admin, inviteId: issued.invite.inviteId }),
      'accept_in_progress', 409);
    release();
    await expect(first).resolves.toMatchObject({ invite: { status: 'accepted' } });
    expect(ctx.bind).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched or unverified email by default and releases the reservation', async () => {
    const ctx = setup();
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    await expectCode(ctx.service.acceptInvite({
      tenantId: 'tenant-a', token: issued.token, person: { personId: 'p2', email: 'other@example.com', emailVerified: true },
    }), 'email_mismatch', 403);
    await expectCode(ctx.service.acceptInvite({
      tenantId: 'tenant-a', token: issued.token, person: { ...invitee, emailVerified: false },
    }), 'email_mismatch', 403);
    expect(ctx.bind).not.toHaveBeenCalled();
    expect(ctx.repository.snapshot()[0].status).toBe('pending');
    await expect(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }))
      .resolves.toMatchObject({ invite: { status: 'accepted' } });
  });

  it('allows a link holder only when policy explicitly allows it', async () => {
    const allow = vi.fn(() => true);
    const ctx = setup({ policy: { allowLinkHolderAccept: allow } });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'viewer' });
    await ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: { personId: 'holder' } });
    expect(allow).toHaveBeenCalledWith({
      tenantId: 'tenant-a', inviteId: issued.invite.inviteId, role: 'viewer', personId: 'holder',
    });
    expect(JSON.stringify(allow.mock.calls)).not.toContain('example.com');
  });

  it('rejects expired invites for accept and resend, and reopens them through reissue', async () => {
    const ctx = setup();
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    ctx.advance(7 * 24 * 60 * 60 * 1000);
    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      'invite_expired', 410);
    await expectCode(ctx.service.resendInvite({ actor: admin, inviteId: issued.invite.inviteId, token: issued.token }),
      'invite_expired', 410);
    expect((await ctx.service.readInvite({ actor: admin, inviteId: issued.invite.inviteId })).status).toBe('expired');

    const reissued = await ctx.service.reissue({ actor: admin, inviteId: issued.invite.inviteId });
    expect(reissued.previous).toMatchObject({ status: 'revoked', supersededByInviteId: reissued.invite.inviteId });
    expect(reissued.token).not.toBe(issued.token);
    expect(ctx.sent.at(-1)).toMatchObject({ kind: 'reissue', inviteId: reissued.invite.inviteId });
    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      'invite_revoked', 410);
    await expect(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: reissued.token, person: invitee }))
      .resolves.toMatchObject({ invite: { status: 'accepted' } });
  });

  it('revokes pending invites, rejects later accepts, and keeps accepted invites unchanged', async () => {
    const ctx = setup();
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const revoked = await ctx.service.revokeInvite({ actor: admin, inviteId: issued.invite.inviteId });
    expect(revoked.status).toBe('revoked');
    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      'invite_revoked', 410);
    expect(ctx.bind).not.toHaveBeenCalled();

    const second = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    await ctx.service.acceptInvite({ tenantId: 'tenant-a', token: second.token, person: invitee });
    await expectCode(ctx.service.revokeInvite({ actor: admin, inviteId: second.invite.inviteId }), 'invite_consumed', 409);
    expect((await ctx.service.readInvite({ actor: admin, inviteId: second.invite.inviteId })).status).toBe('accepted');
  });

  it('lets only one of a concurrent revoke and accept reservation win', async () => {
    const ctx = setup();
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const results = await Promise.allSettled([
      ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      ctx.service.revokeInvite({ actor: admin, inviteId: issued.invite.inviteId }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const final = ctx.repository.snapshot()[0];
    if (final.status === 'revoked') expect(ctx.bind).not.toHaveBeenCalled();
    else expect(final.status).toBe('accepted');
  });

  it('releases the reservation after a side-effect-free binding rejection so the invite can be retried', async () => {
    let attempt = 0;
    const ctx = setup({ bind: async () => (++attempt === 1 ? { outcome: 'rejected' } : { outcome: 'bound' }) });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      'invite_binding_rejected', 409);
    expect(ctx.repository.snapshot()[0].status).toBe('pending');
    await expect(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }))
      .resolves.toMatchObject({ invite: { status: 'accepted' } });
  });

  it('keeps the reservation on an unknown binding outcome and recovers idempotently for the same person', async () => {
    let attempt = 0;
    const ctx = setup({
      policy: { allowLinkHolderAccept: () => true },
      bind: async () => {
        if (++attempt === 1) throw new Error('timeout talking to membership store');
        return { outcome: 'bound' };
      },
    });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const error = await expectCode(
      ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      'invite_accept_recovery_required', 503,
    );
    expect(error.message).not.toContain('timeout');
    expect(ctx.repository.snapshot()[0]).toMatchObject({ status: 'accepting', reservation: { personId: 'person-9' } });

    await expectCode(ctx.service.acceptInvite({
      tenantId: 'tenant-a', token: issued.token, person: { personId: 'someone-else' },
    }), 'invite_replayed', 409);

    ctx.advance(30 * 24 * 60 * 60 * 1000); // TTL does not release an unknown-outcome reservation.
    await expect(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }))
      .resolves.toMatchObject({ invite: { status: 'accepted', acceptedByPersonId: 'person-9' } });
    expect(ctx.bind).toHaveBeenCalledTimes(2);
    expect(ctx.bind.mock.calls.every(([call]) => call.inviteId === issued.invite.inviteId)).toBe(true);
  });

  it('keeps the reservation when finalize fails after binding and finishes on retry', async () => {
    const base = createInMemoryOrganizationMemberInviteRepository();
    let failFinalize = true;
    const repository: OrganizationMemberInviteRepository = {
      ...base,
      async finalizeAccept(input) {
        if (failFinalize) {
          failFinalize = false;
          throw new Error('db down');
        }
        return base.finalizeAccept(input);
      },
    };
    const ctx = setup({ repository });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }),
      'invite_accept_recovery_required', 503);
    expect(base.snapshot()[0].status).toBe('accepting');
    await expect(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }))
      .resolves.toMatchObject({ invite: { status: 'accepted' } });
  });

  it('does not overturn an accepted invite when the audit fails, and records the audit failure', async () => {
    const entries: Array<{ action: string }> = [];
    const ctx = setup({
      audit: async (entry) => {
        if (entry.action === 'accept') throw new Error('audit sink down');
        entries.push(entry);
      },
    });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    await expect(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }))
      .resolves.toMatchObject({ invite: { status: 'accepted' } });
    expect(entries.map((entry) => entry.action)).toEqual(['create', 'audit_failed']);
  });

  it('isolates tenants for read, revoke, reissue, resend and accept', async () => {
    const ctx = setup();
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const outsider = { tenantId: 'tenant-b', personId: 'admin-b' };
    const inviteId = issued.invite.inviteId;
    await expectCode(ctx.service.readInvite({ actor: outsider, inviteId }), 'invite_not_found', 404);
    await expectCode(ctx.service.revokeInvite({ actor: outsider, inviteId }), 'invite_not_found', 404);
    await expectCode(ctx.service.reissue({ actor: outsider, inviteId }), 'invite_not_found', 404);
    await expectCode(ctx.service.resendInvite({ actor: outsider, inviteId, token: issued.token }), 'invite_not_found', 404);
    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-b', token: issued.token, person: invitee }),
      'invite_invalid', 404);
    expect(ctx.bind).not.toHaveBeenCalled();
    expect(ctx.repository.snapshot()[0].status).toBe('pending');
  });

  it('never reserves another tenant\'s invite, even when release would fail', async () => {
    const repository = createInMemoryOrganizationMemberInviteRepository();
    const releaseReservation = vi.spyOn(repository, 'releaseReservation')
      .mockRejectedValue(new Error('store down'));
    const ctx = setup({ repository });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    await expectCode(ctx.service.acceptInvite({
      tenantId: 'tenant-b', token: issued.token, person: { personId: 'outsider', email: 'x@b.example', emailVerified: true },
    }), 'invite_invalid', 404);
    expect(ctx.repository.snapshot()[0]).toMatchObject({ status: 'pending', reservation: null });
    expect(releaseReservation).not.toHaveBeenCalled();
    releaseReservation.mockRestore();
    await expect(ctx.service.acceptInvite({ tenantId: 'tenant-a', token: issued.token, person: invitee }))
      .resolves.toMatchObject({ invite: { status: 'accepted' } });
  });

  it('treats a repository that ignores the tenant scope as unavailable', async () => {
    const inner = createInMemoryOrganizationMemberInviteRepository();
    const leaky: OrganizationMemberInviteRepository = {
      ...inner,
      reserveForAccept: (input) => inner.reserveForAccept({ ...input, tenantId: 'tenant-a' }),
    };
    const ctx = setup({ repository: leaky });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    await expectCode(ctx.service.acceptInvite({ tenantId: 'tenant-b', token: issued.token, person: invitee }),
      'invite_store_unavailable', 503);
    expect(ctx.bind).not.toHaveBeenCalled();
  });

  it('resends a pending invite only with its own raw token', async () => {
    const ctx = setup();
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const resent = await ctx.service.resendInvite({ actor: admin, inviteId: issued.invite.inviteId, token: issued.token });
    expect(resent.acceptUrl).toBe(issued.acceptUrl);
    expect(ctx.sent.map((envelope) => envelope.kind)).toEqual(['invite', 'resend']);
    await expectCode(ctx.service.resendInvite({
      actor: admin, inviteId: issued.invite.inviteId, token: 'not-the-token',
    }), 'invite_token_mismatch', 400);
  });

  it('detects duplicate pending invites and lets policy decide', async () => {
    const strict = setup();
    const first = await strict.service.createInvite({ actor: admin, inviteeEmail: 'dup@example.com', role: 'member' });
    const error = await expectCode(strict.service.createInvite({
      actor: admin, inviteeEmail: ' DUP@example.com', role: 'member',
    }), 'invite_duplicate', 409);
    expect(error.details).toEqual({ existingInviteIds: [first.invite.inviteId] });

    const lenient = setup({ policy: { onDuplicatePending: () => 'allow' } });
    await lenient.service.createInvite({ actor: admin, inviteeEmail: 'dup@example.com', role: 'member' });
    await lenient.service.createInvite({ actor: admin, inviteeEmail: 'dup@example.com', role: 'admin' });
    expect(lenient.repository.snapshot()).toHaveLength(2);
  });

  it('normalizes delivery and store failures into stable errors without raw messages', async () => {
    const ctx = setup({ delivery: async () => { throw new Error('SMTP 550 hanako@example.com'); } });
    const error = await expectCode(ctx.service.createInvite({
      actor: admin, inviteeEmail: invitee.email, role: 'member',
    }), 'invite_delivery_unavailable', 503);
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain('example.com');

    const broken = setup({
      repository: {
        ...createInMemoryOrganizationMemberInviteRepository(),
        async save() { throw new Error('connection string postgres://u:p@h'); },
      },
    });
    const storeError = await expectCode(broken.service.createInvite({
      actor: admin, inviteeEmail: invitee.email, role: 'member',
    }), 'invite_store_unavailable', 503);
    expect(storeError.message).not.toContain('postgres');
  });

  it('does not interpret an unknown duplicate lookup as an empty list', async () => {
    const repository = createInMemoryOrganizationMemberInviteRepository();
    vi.spyOn(repository, 'findPendingByEmail').mockResolvedValue(undefined as never);
    const ctx = setup({ repository });
    await expectCode(ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' }),
      'invite_store_unavailable', 503);
    expect(repository.snapshot()).toEqual([]);
    expect(ctx.sent).toEqual([]);
  });

  it.each([
    { expiresAt: 'not-a-date' }, { issuedAt: 'not-a-date' }, { status: 'unknown' },
    { tokenHash: 'bad-hash' }, { metadata: { access_token: 'private' } },
  ])('rejects corrupted stored invitation readback: %j', async (patch) => {
    const repository = createInMemoryOrganizationMemberInviteRepository();
    const ctx = setup({ repository });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const record = repository.snapshot()[0];
    vi.spyOn(repository, 'get').mockResolvedValue({ ...record, ...patch } as never);
    await expectCode(ctx.service.readInvite({ actor: admin, inviteId: record.inviteId }), 'invite_store_unavailable', 503);
    expect(ctx.bind).not.toHaveBeenCalled();
  });

  it('rejects a reservation for a different token before calling membership binding', async () => {
    const repository = createInMemoryOrganizationMemberInviteRepository();
    const ctx = setup({ repository });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const reserve = repository.reserveForAccept.bind(repository);
    vi.spyOn(repository, 'reserveForAccept').mockImplementation(async input => {
      const result = await reserve(input);
      if (result.status !== 'reserved') return result;
      return { ...result, record: { ...result.record, tokenHash: 'a'.repeat(64) } };
    });
    await expectCode(ctx.service.acceptInvite({ tenantId: admin.tenantId, token: issued.token, person: invitee }),
      'invite_store_unavailable', 503);
    expect(ctx.bind).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant finalization readback after binding without releasing recovery state', async () => {
    const repository = createInMemoryOrganizationMemberInviteRepository();
    const ctx = setup({ repository });
    const issued = await ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' });
    const finalize = repository.finalizeAccept.bind(repository);
    const release = vi.spyOn(repository, 'releaseReservation');
    vi.spyOn(repository, 'finalizeAccept').mockImplementation(async input => {
      const result = await finalize(input);
      if (result.status !== 'accepted') return result;
      return { ...result, record: { ...result.record, tenantId: 'tenant-b' } };
    });
    await expectCode(ctx.service.acceptInvite({ tenantId: admin.tenantId, token: issued.token, person: invitee }),
      'invite_accept_recovery_required', 503);
    expect(ctx.bind).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it.each(['javascript:', 'http:', 'data:'])('rejects unsafe accept URL protocol %s before delivery', async protocol => {
    const ctx = setup({ buildAcceptUrl: ({ token }) => `${protocol}//example.test/#${token}` });
    await expectCode(ctx.service.createInvite({ actor: admin, inviteeEmail: invitee.email, role: 'member' }),
      'invite_accept_url_invalid', 500);
    expect(ctx.sent).toEqual([]);
  });

  it('issues omi_ ids and has no real mail transport in the kernel', () => {
    expect(createOrganizationMemberInviteId()).toMatch(/^omi_[A-Za-z0-9_-]{16,}$/u);
    for (const file of ['src/organization-member-invite.ts', 'src/organization-member-invite-http.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/nodemailer|smtp\.|sendgrid|@aws-sdk|createTransport/iu);
    }
  });

  it('exports the kernel and HTTP subpaths from the package manifest', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.exports['./organization-member-invite']).toEqual({
      types: './dist/organization-member-invite.d.ts',
      import: './dist/organization-member-invite.js',
    });
    expect(manifest.exports['./organization-member-invite-http']).toEqual({
      types: './dist/organization-member-invite-http.d.ts',
      import: './dist/organization-member-invite-http.js',
    });
  });
});

describe('organization member invite HTTP routes', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  async function start(context: { current: TrustedOrganizationMemberInviteRequestContext | null }) {
    const ctx = setup();
    const handler = createOrganizationMemberInviteHttpHandler({ service: ctx.service });
    server = createServer((request, response) => {
      void handler(request, response, context.current).then((handled) => {
        if (!handled) {
          response.statusCode = 404;
          response.end();
        }
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/organization-member-invites${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    return { ctx, call };
  }

  const adminContext: TrustedOrganizationMemberInviteRequestContext = {
    tenantId: 'tenant-a', personId: 'admin-1', inviterDisplayName: 'Admin One', verifiedMutationOrigin: 'https://org.example.test',
  };
  const inviteeContext: TrustedOrganizationMemberInviteRequestContext = {
    tenantId: 'tenant-a', personId: 'person-9', email: 'hanako@example.com', emailVerified: true,
    verifiedMutationOrigin: 'https://org.example.test',
  };

  it('creates, reads, accepts, and replays through the routes with stable error envelopes', async () => {
    const context = { current: adminContext as TrustedOrganizationMemberInviteRequestContext | null };
    const { call } = await start(context);

    const created = await call('POST', '', { inviteeEmail: 'hanako@example.com', role: 'member' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('token');
    const inviteId = created.body.invite.inviteId as string;
    const token = new URL(created.body.acceptUrl).hash.replace('#token=', '');

    const read = await call('GET', `/${inviteId}`);
    expect(read.status).toBe(200);
    expect(read.body.invite).toMatchObject({ inviteId, status: 'pending', inviteeEmail: 'hanako@example.com' });
    expect(read.body.invite).not.toHaveProperty('tokenHash');

    context.current = inviteeContext;
    const accepted = await call('POST', '/accept', { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.invite.status).toBe('accepted');

    const replay = await call('POST', '/accept', { token });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toEqual({ code: 'invite_consumed', status: 409, message: 'Invite has already been accepted' });
  });

  it('revokes and reissues through the routes', async () => {
    const context = { current: adminContext as TrustedOrganizationMemberInviteRequestContext | null };
    const { call } = await start(context);
    const first = await call('POST', '', { inviteeEmail: 'a@example.com', role: 'member' });
    const revoked = await call('POST', `/${first.body.invite.inviteId}/revoke`);
    expect(revoked.body.invite.status).toBe('revoked');

    const second = await call('POST', '', { inviteeEmail: 'b@example.com', role: 'member' });
    const reissued = await call('POST', `/${second.body.invite.inviteId}/reissue`);
    expect(reissued.status).toBe(201);
    expect(reissued.body.previous.supersededByInviteId).toBe(reissued.body.invite.inviteId);
  });

  it('rejects missing auth, body identity, unverified origin, and wrong methods', async () => {
    const context = { current: null as TrustedOrganizationMemberInviteRequestContext | null };
    const { call } = await start(context);
    expect((await call('POST', '', { inviteeEmail: 'a@example.com', role: 'member' })).status).toBe(401);

    context.current = adminContext;
    const spoof = await call('POST', '', { inviteeEmail: 'a@example.com', role: 'member', tenantId: 'tenant-b' });
    expect(spoof.status).toBe(400);
    expect((await call('GET', '/accept')).status).toBe(405);

    context.current = { tenantId: 'tenant-a', personId: 'admin-1' };
    const unverified = await call('POST', '', { inviteeEmail: 'a@example.com', role: 'member' });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('mutation_origin_unverified');
  });
});
