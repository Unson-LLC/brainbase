import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FilesystemMeetingMinutesAdapter,
  type MeetingMinutesAuthorization,
  type MeetingMinutesExternalReference,
} from '../src/meeting-minutes-storage.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-storage-'));
  temporaryRoots.push(root);
  return root;
}

function authorization(overrides: Partial<MeetingMinutesAuthorization> = {}): MeetingMinutesAuthorization {
  return {
    status: 'allowed',
    principal: 'person-1',
    checked_at: '2026-10-06T06:00:00.000Z',
    ...overrides,
  };
}

async function register(
  adapter: FilesystemMeetingMinutesAdapter,
  locator = 'meetings/meeting-1.md',
): Promise<MeetingMinutesExternalReference> {
  const result = await adapter.register({ locator, authorization: authorization() });
  expect(result.status).toBe('registered');
  if (result.status !== 'registered') throw new Error('fixture registration failed');
  return result.reference;
}

describe('FilesystemMeetingMinutesAdapter', () => {
  it('exposes a real read-only filesystem capability contract', async () => {
    const root = await makeRoot();
    const adapter = new FilesystemMeetingMinutesAdapter({ root });

    expect(adapter.capabilities).toEqual({
      save: false,
      read: true,
      read_only: true,
      history: false,
      current_acl: 'injected',
      retention_delete: false,
    });
  });

  it('registers and reads the current file with exact locator, revision, digest, and provenance', async () => {
    const root = await makeRoot();
    const locator = 'meetings/meeting-1.md';
    await mkdir(join(root, 'meetings'), { recursive: true });
    await writeFile(join(root, locator), '# Meeting 1\n\nDecision: ship.\n', 'utf8');
    const adapter = new FilesystemMeetingMinutesAdapter({ root, provider: 'customer-files' });

    const reference = await register(adapter, locator);
    expect(reference).toMatchObject({
      provider: 'customer-files',
      locator,
      revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      provenance: {
        source: 'external',
        adapter: 'filesystem',
      },
    });
    expect(reference.revision).toBe(reference.digest);

    await expect(adapter.read({ reference, authorization: authorization() })).resolves.toMatchObject({
      status: 'available',
      reference: {
        provider: 'customer-files',
        locator,
        revision: reference.revision,
        digest: reference.digest,
      },
      body: '# Meeting 1\n\nDecision: ship.\n',
    });
  });

  it('requires a fresh injected authorization for registration and every read', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'minutes', 'utf8');
    const adapter = new FilesystemMeetingMinutesAdapter({ root });

    await expect(adapter.register({
      locator,
      authorization: authorization({ status: 'denied', reason: 'revoked' }),
    })).resolves.toMatchObject({ status: 'denied' });

    const reference = await register(adapter, locator);
    await expect(adapter.read({
      reference,
      authorization: authorization({ status: 'denied', reason: 'revoked' }),
    })).resolves.toMatchObject({ status: 'denied', reason: 'revoked' });
    await expect(adapter.read({
      reference,
      authorization: { status: 'allowed' },
    })).resolves.toMatchObject({ status: 'denied' });

    const invalidReference = { ...reference, provenance: undefined } as unknown as MeetingMinutesExternalReference;
    await expect(adapter.read({ reference: invalidReference, authorization: authorization() }))
      .resolves.toMatchObject({ status: 'invalid_reference' });
  });

  it('never substitutes the current body for a changed source revision', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'version one', 'utf8');
    const adapter = new FilesystemMeetingMinutesAdapter({ root });
    const first = await register(adapter, locator);

    await writeFile(join(root, locator), 'version two', 'utf8');
    const mismatch = await adapter.read({ reference: first, authorization: authorization() });
    expect(mismatch).toMatchObject({
      status: 'integrity_mismatch',
      observed_reference: {
        locator,
        revision: expect.not.stringMatching(first.revision),
        digest: expect.not.stringMatching(first.digest),
      },
    });
    expect(mismatch).not.toHaveProperty('body');

    const second = await register(adapter, locator);
    expect(second.revision).not.toBe(first.revision);
    expect(second.digest).not.toBe(first.digest);
    await expect(adapter.read({ reference: second, authorization: authorization() })).resolves.toMatchObject({
      status: 'available',
      body: 'version two',
    });
  });

  it('returns the same exact reference for an unchanged re-import without writing a copy', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    const body = 'same source';
    await writeFile(join(root, locator), body, 'utf8');
    const adapter = new FilesystemMeetingMinutesAdapter({ root });

    const first = await register(adapter, locator);
    const second = await register(adapter, locator);
    expect(second).toMatchObject({
      provider: first.provider,
      locator: first.locator,
      revision: first.revision,
      digest: first.digest,
    });
    expect(await readFile(join(root, locator), 'utf8')).toBe(body);
  });

  it('rejects root escape, absolute locators, and symlink aliases', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, 'outside.md'), 'outside', 'utf8');
    await writeFile(join(root, 'inside.md'), 'inside', 'utf8');
    await symlink(join(outside, 'outside.md'), join(root, 'alias.md'));
    const adapter = new FilesystemMeetingMinutesAdapter({ root });

    await expect(adapter.register({ locator: '../outside.md', authorization: authorization() }))
      .resolves.toMatchObject({ status: 'invalid_locator' });
    await expect(adapter.register({ locator: join(outside, 'outside.md'), authorization: authorization() }))
      .resolves.toMatchObject({ status: 'invalid_locator' });
    await expect(adapter.register({ locator: 'alias.md', authorization: authorization() }))
      .resolves.toMatchObject({ status: 'symlink_rejected' });
  });

  it('reports rename, deletion, and disconnected roots instead of claiming migration', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'minutes', 'utf8');
    const adapter = new FilesystemMeetingMinutesAdapter({ root });
    const reference = await register(adapter, locator);

    await rm(join(root, locator));
    await expect(adapter.read({ reference, authorization: authorization() })).resolves.toMatchObject({
      status: 'not_found',
    });

    await rm(root, { recursive: true, force: true });
    await expect(adapter.read({ reference, authorization: authorization() })).resolves.toMatchObject({
      status: 'not_found',
    });
  });

  it('explains unsupported history, save, and retention deletion without touching the provider', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'minutes', 'utf8');
    const adapter = new FilesystemMeetingMinutesAdapter({ root });
    const reference = await register(adapter, locator);

    await expect(adapter.read_history({ reference, authorization: authorization() })).resolves.toMatchObject({
      status: 'unsupported',
      operation: 'read_history',
      capability: 'history',
    });
    await expect(adapter.save({ reference, body: 'must not write' })).resolves.toMatchObject({
      status: 'unsupported',
      operation: 'save',
      capability: 'save',
    });
    await expect(adapter.delete({ reference, authorization: authorization() })).resolves.toMatchObject({
      status: 'unsupported',
      operation: 'retention_delete',
      capability: 'retention_delete',
    });
    expect(await readFile(join(root, locator), 'utf8')).toBe('minutes');
  });
});
