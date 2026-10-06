import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FilesystemMeetingMinutesAdapter,
  type FilesystemMeetingMinutesAdapterOptions,
  type MeetingMinutesAuthorize,
  type MeetingMinutesExternalReference,
  type MeetingMinutesStorageRequestContext,
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

function requestContext(): MeetingMinutesStorageRequestContext {
  return { principal_id: 'person-1' };
}

function allowAll(): MeetingMinutesAuthorize {
  return async () => true;
}

function makeAdapter(
  root: string,
  authorize: MeetingMinutesAuthorize = allowAll(),
  options: Pick<FilesystemMeetingMinutesAdapterOptions, 'provider' | 'max_bytes'> = {},
): FilesystemMeetingMinutesAdapter {
  return new FilesystemMeetingMinutesAdapter({ root, authorize, ...options });
}

async function register(
  adapter: FilesystemMeetingMinutesAdapter,
  locator = 'meetings/meeting-1.md',
): Promise<MeetingMinutesExternalReference> {
  const result = await adapter.register({ locator, request_context: requestContext() });
  expect(result.status).toBe('registered');
  if (result.status !== 'registered') throw new Error('fixture registration failed');
  return result.reference;
}

describe('FilesystemMeetingMinutesAdapter', () => {
  it('exposes a real read-only filesystem capability contract', async () => {
    const root = await makeRoot();
    const adapter = makeAdapter(root);

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
    const adapter = makeAdapter(root, allowAll(), { provider: 'customer-files' });

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

    await expect(adapter.read({ reference, request_context: requestContext() })).resolves.toMatchObject({
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

  it('requires a fresh host authorization for registration and every read', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'minutes', 'utf8');
    const calls: Array<{
      context: MeetingMinutesStorageRequestContext;
      operation: string;
      target: unknown;
    }> = [];
    let currentAllowed = false;
    const adapter = makeAdapter(root, async (context, operation, target) => {
      calls.push({ context, operation, target });
      return currentAllowed;
    });

    const untrustedContext = { principal_id: 'person-1', role: 'stale-admin' } as unknown as MeetingMinutesStorageRequestContext;

    await expect(adapter.register({
      locator,
      request_context: untrustedContext,
    })).resolves.toMatchObject({ status: 'denied' });

    currentAllowed = true;
    const reference = await register(adapter, locator);
    currentAllowed = false;
    await expect(adapter.read({
      reference,
      request_context: requestContext(),
    })).resolves.toMatchObject({ status: 'denied' });

    expect(calls.map(({ operation }) => operation)).toEqual(['register', 'register', 'read']);
    expect(calls[0].context).toEqual({ principal_id: 'person-1' });
    expect(calls[0].target).toEqual({ locator });
    expect(calls[2].target).toEqual({ reference });

    const invalidReference = { ...reference, provenance: undefined } as unknown as MeetingMinutesExternalReference;
    await expect(adapter.read({ reference: invalidReference, request_context: requestContext() }))
      .resolves.toMatchObject({ status: 'invalid_reference' });
    expect(calls).toHaveLength(3);
  });

  it('never substitutes the current body for a changed source revision', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'version one', 'utf8');
    const adapter = makeAdapter(root);
    const first = await register(adapter, locator);

    await writeFile(join(root, locator), 'version two', 'utf8');
    const mismatch = await adapter.read({ reference: first, request_context: requestContext() });
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
    await expect(adapter.read({ reference: second, request_context: requestContext() })).resolves.toMatchObject({
      status: 'available',
      body: 'version two',
    });
  });

  it('returns the same exact reference for an unchanged re-import without writing a copy', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    const body = 'same source';
    await writeFile(join(root, locator), body, 'utf8');
    const adapter = makeAdapter(root);

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
    const adapter = makeAdapter(root);

    await expect(adapter.register({ locator: '../outside.md', request_context: requestContext() }))
      .resolves.toMatchObject({ status: 'invalid_locator' });
    await expect(adapter.register({ locator: join(outside, 'outside.md'), request_context: requestContext() }))
      .resolves.toMatchObject({ status: 'invalid_locator' });
    await expect(adapter.register({ locator: 'alias.md', request_context: requestContext() }))
      .resolves.toMatchObject({ status: 'symlink_rejected' });
  });

  it('reports rename, deletion, and disconnected roots instead of claiming migration', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'minutes', 'utf8');
    const adapter = makeAdapter(root);
    const reference = await register(adapter, locator);

    await rm(join(root, locator));
    await expect(adapter.read({ reference, request_context: requestContext() })).resolves.toMatchObject({
      status: 'not_found',
    });

    await rm(root, { recursive: true, force: true });
    await expect(adapter.read({ reference, request_context: requestContext() })).resolves.toMatchObject({
      status: 'not_found',
    });
  });

  it('explains unsupported history, save, and retention deletion without touching the provider', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), 'minutes', 'utf8');
    const adapter = makeAdapter(root);
    const reference = await register(adapter, locator);

    await expect(adapter.read_history({ reference, request_context: requestContext() })).resolves.toMatchObject({
      status: 'unsupported',
      operation: 'read_history',
      capability: 'history',
    });
    await expect(adapter.save({ reference, body: 'must not write' })).resolves.toMatchObject({
      status: 'unsupported',
      operation: 'save',
      capability: 'save',
    });
    await expect(adapter.delete({ reference, request_context: requestContext() })).resolves.toMatchObject({
      status: 'unsupported',
      operation: 'retention_delete',
      capability: 'retention_delete',
    });
    expect(await readFile(join(root, locator), 'utf8')).toBe('minutes');
  });

  it('rejects sources beyond the configured byte limit while accepting the exact boundary', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    const body = '12345';
    await writeFile(join(root, locator), body, 'utf8');

    const exact = makeAdapter(root, allowAll(), { max_bytes: Buffer.byteLength(body) });
    const reference = await register(exact, locator);
    await expect(exact.read({ reference, request_context: requestContext() })).resolves.toMatchObject({
      status: 'available',
      body,
    });

    const limited = makeAdapter(root, allowAll(), { max_bytes: Buffer.byteLength(body) - 1 });
    await expect(limited.register({ locator, request_context: requestContext() })).resolves.toMatchObject({
      status: 'too_large',
    });
  });

  it('rejects invalid UTF-8 instead of decoding a lossy body', async () => {
    const root = await makeRoot();
    const locator = 'meeting.md';
    await writeFile(join(root, locator), Buffer.from([0xc3, 0x28]));
    const adapter = makeAdapter(root);

    await expect(adapter.register({ locator, request_context: requestContext() })).resolves.toMatchObject({
      status: 'invalid_encoding',
    });
  });
});
