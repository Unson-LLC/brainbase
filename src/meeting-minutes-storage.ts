import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

/** The first real provider adapter. Its root is supplied by the customer. */
export const FILESYSTEM_MEETING_MINUTES_ADAPTER = 'filesystem' as const;

export interface MeetingMinutesStorageCapabilities {
  readonly save: false;
  readonly read: true;
  readonly read_only: true;
  readonly history: false;
  /** ACL is supplied by the organization boundary for every operation. */
  readonly current_acl: 'injected';
  readonly retention_delete: false;
}

const FILESYSTEM_CAPABILITIES: MeetingMinutesStorageCapabilities = Object.freeze({
  save: false,
  read: true,
  read_only: true,
  history: false,
  current_acl: 'injected',
  retention_delete: false,
});

export type MeetingMinutesStorageAuthorizationOperation = 'register' | 'read' | 'read_history' | 'retention_delete';

/** Context resolved by the host before calling the adapter. */
export interface MeetingMinutesStorageRequestContext {
  readonly principal_id: string;
}

export type MeetingMinutesAuthorizationTarget =
  | { readonly locator: string; readonly reference?: never }
  | { readonly reference: MeetingMinutesExternalReference; readonly locator?: never };

/** Result produced by the host-injected authorization callback. */
export interface MeetingMinutesAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly checked_at?: string;
}

export type MeetingMinutesAuthorize = (
  context: MeetingMinutesStorageRequestContext,
  operation: MeetingMinutesStorageAuthorizationOperation,
  target: MeetingMinutesAuthorizationTarget,
) => MeetingMinutesAuthorizationDecision | boolean | Promise<MeetingMinutesAuthorizationDecision | boolean>;

export interface MeetingMinutesExternalProvenance {
  readonly source: 'external';
  readonly adapter: typeof FILESYSTEM_MEETING_MINUTES_ADAPTER;
  readonly observed_at: string;
}

/** A locator and exact source version; it never contains the external body. */
export interface MeetingMinutesExternalReference {
  readonly provider: string;
  /** Root-relative POSIX path for the filesystem adapter. */
  readonly locator: string;
  /** Content-addressed revision because a plain filesystem has no history API. */
  readonly revision: string;
  readonly digest: string;
  readonly provenance: MeetingMinutesExternalProvenance;
}

export interface FilesystemMeetingMinutesAdapterOptions {
  /** Absolute customer-configured root. No default is inferred. */
  readonly root: string;
  readonly provider?: string;
  /** Host-owned ACL check; called before every register/read/history/delete operation. */
  readonly authorize: MeetingMinutesAuthorize;
  /** Maximum external source size accepted by the read-only adapter. */
  readonly max_bytes?: number;
}

export interface MeetingMinutesRegisterRequest {
  readonly locator: string;
  readonly request_context: MeetingMinutesStorageRequestContext;
}

export interface MeetingMinutesReadRequest {
  readonly reference: MeetingMinutesExternalReference;
  readonly request_context: MeetingMinutesStorageRequestContext;
}

export interface MeetingMinutesSaveRequest {
  readonly reference?: MeetingMinutesExternalReference;
  readonly body?: string;
}

export interface MeetingMinutesDeleteRequest {
  readonly reference: MeetingMinutesExternalReference;
  readonly request_context: MeetingMinutesStorageRequestContext;
}

export type MeetingMinutesUnavailableStatus =
  | 'not_found'
  | 'symlink_rejected'
  | 'unavailable'
  | 'too_large'
  | 'invalid_encoding';

export interface MeetingMinutesRegisterResultBase {
  readonly capabilities: MeetingMinutesStorageCapabilities;
}

export type MeetingMinutesRegisterResult = MeetingMinutesRegisterResultBase & (
  | {
      readonly status: 'registered';
      readonly reference: MeetingMinutesExternalReference;
    }
  | {
      readonly status: 'denied' | 'invalid_locator' | MeetingMinutesUnavailableStatus;
      readonly reason: string;
    }
);

export type MeetingMinutesReadResult = MeetingMinutesRegisterResultBase & (
  | {
      readonly status: 'available';
      readonly reference: MeetingMinutesExternalReference;
      readonly body: string;
    }
  | {
      readonly status: 'denied' | 'invalid_reference' | MeetingMinutesUnavailableStatus;
      readonly reason: string;
    }
  | {
      readonly status: 'integrity_mismatch';
      readonly reason: string;
      /** Metadata only; the changed body is deliberately not returned. */
      readonly observed_reference: MeetingMinutesExternalReference;
    }
);

export type MeetingMinutesUnsupportedOperation = MeetingMinutesRegisterResultBase & {
  readonly status: 'unsupported';
  readonly operation: 'save' | 'read_history' | 'retention_delete';
  readonly capability: 'save' | 'history' | 'retention_delete';
  readonly reason: string;
};

export type MeetingMinutesHistoryResult = MeetingMinutesUnsupportedOperation | (MeetingMinutesRegisterResultBase & {
  readonly status: 'denied';
  readonly reason: string;
});

export type MeetingMinutesDeleteResult = MeetingMinutesUnsupportedOperation | (MeetingMinutesRegisterResultBase & {
  readonly status: 'denied';
  readonly reason: string;
});

export interface MeetingMinutesStorageAdapter {
  readonly capabilities: MeetingMinutesStorageCapabilities;
  register(input: MeetingMinutesRegisterRequest): Promise<MeetingMinutesRegisterResult>;
  read(input: MeetingMinutesReadRequest): Promise<MeetingMinutesReadResult>;
  read_history(input: MeetingMinutesReadRequest): Promise<MeetingMinutesHistoryResult>;
  save(input: MeetingMinutesSaveRequest): Promise<MeetingMinutesUnsupportedOperation>;
  delete(input: MeetingMinutesDeleteRequest): Promise<MeetingMinutesDeleteResult>;
}

interface ResolvedFile {
  readonly status: 'ok';
  readonly path: string;
  readonly real_path: string;
  readonly device: number;
  readonly inode: number;
}

interface ResolvedFileFailure {
  readonly status: MeetingMinutesUnavailableStatus;
  readonly reason: string;
}

type ResolvedFileResult = ResolvedFile | ResolvedFileFailure;

interface ReadBytes {
  readonly status: 'ok';
  readonly bytes: Buffer;
  readonly body: string;
}

type ReadBytesResult = ReadBytes | ResolvedFileFailure;

interface BoundedBytes {
  readonly status: 'ok';
  readonly bytes: Buffer;
}

type BoundedBytesResult = BoundedBytes | ResolvedFileFailure;

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

interface NormalizedLocator {
  readonly status: 'ok';
  readonly locator: string;
}

interface InvalidLocator {
  readonly status: 'invalid_locator';
  readonly reason: string;
}

type LocatorResult = NormalizedLocator | InvalidLocator;

/**
 * Read-only adapter for a customer-selected filesystem root.
 *
 * The adapter keeps no native copy and performs no external write. A plain
 * filesystem has no historical version contract, so old references fail with
 * an integrity mismatch when the current file changes.
 */
export class FilesystemMeetingMinutesAdapter implements MeetingMinutesStorageAdapter {
  readonly capabilities = FILESYSTEM_CAPABILITIES;

  private readonly root: string;
  private readonly provider: string;
  private readonly authorize: MeetingMinutesAuthorize;
  private readonly maxBytes: number;

  constructor(options: FilesystemMeetingMinutesAdapterOptions) {
    if (!options || typeof options.root !== 'string' || !options.root.trim()) {
      throw new MeetingMinutesStorageError('invalid_configuration', 'An absolute customer filesystem root is required');
    }
    if (!isAbsolute(options.root)) {
      throw new MeetingMinutesStorageError('invalid_configuration', 'The filesystem root must be absolute');
    }
    const provider = options.provider ?? FILESYSTEM_MEETING_MINUTES_ADAPTER;
    if (typeof provider !== 'string' || !provider.trim()) {
      throw new MeetingMinutesStorageError('invalid_configuration', 'The provider identifier must not be empty');
    }
    if (typeof options.authorize !== 'function') {
      throw new MeetingMinutesStorageError('invalid_configuration', 'A host authorization callback is required');
    }
    const maxBytes = options.max_bytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new MeetingMinutesStorageError('invalid_configuration', 'max_bytes must be a positive safe integer');
    }
    this.root = resolve(options.root);
    this.provider = provider;
    this.authorize = options.authorize;
    this.maxBytes = maxBytes;
  }

  async register(input: MeetingMinutesRegisterRequest): Promise<MeetingMinutesRegisterResult> {
    const authorizationError = await this.authorizationFailure(
      input?.request_context,
      'register',
      { locator: typeof input?.locator === 'string' ? input.locator : '' },
    );
    if (authorizationError) return this.registerFailure('denied', authorizationError);

    const locator = normalizeLocator(input?.locator);
    if (locator.status !== 'ok') return this.registerFailure(locator.status, locator.reason);

    const file = await this.resolveFile(locator.locator);
    if (file.status !== 'ok') return this.registerFailure(file.status, file.reason);

    const content = await this.readStableFile(file);
    if (content.status !== 'ok') return this.registerFailure(content.status, content.reason);
    try {
      return {
        status: 'registered',
        reference: this.reference(locator.locator, content.bytes),
        capabilities: this.capabilities,
      };
    } catch (error) {
      return this.registerFailure(...readFailure(error));
    }
  }

  async read(input: MeetingMinutesReadRequest): Promise<MeetingMinutesReadResult> {
    const referenceError = this.referenceFailure(input?.reference);
    if (referenceError) return this.readFailure('invalid_reference', referenceError);

    const authorizationError = await this.authorizationFailure(
      input?.request_context,
      'read',
      { reference: input.reference },
    );
    if (authorizationError) return this.readFailure('denied', authorizationError);

    const locator = normalizeLocator(input.reference.locator);
    if (locator.status !== 'ok') return this.readFailure('invalid_reference', locator.reason);

    const file = await this.resolveFile(locator.locator);
    if (file.status !== 'ok') return this.readFailure(file.status, file.reason);

    const content = await this.readStableFile(file);
    if (content.status !== 'ok') return this.readFailure(content.status, content.reason);
    const observed = this.reference(locator.locator, content.bytes);
    if (observed.revision !== input.reference.revision || observed.digest !== input.reference.digest) {
      return {
        status: 'integrity_mismatch',
        reason: 'The external source changed; the requested historical revision is unavailable',
        observed_reference: observed,
        capabilities: this.capabilities,
      };
    }
    return {
      status: 'available',
      reference: observed,
      body: content.body,
      capabilities: this.capabilities,
    };
  }

  async read_history(input: MeetingMinutesReadRequest): Promise<MeetingMinutesHistoryResult> {
    const authorizationError = await this.authorizationFailure(
      input?.request_context,
      'read_history',
      { reference: input?.reference as MeetingMinutesExternalReference },
    );
    if (authorizationError) {
      return {
        status: 'denied',
        reason: authorizationError,
        capabilities: this.capabilities,
      };
    }
    return this.unsupported('read_history', 'history', 'This filesystem adapter has no historical version provider');
  }

  async save(_input: MeetingMinutesSaveRequest): Promise<MeetingMinutesUnsupportedOperation> {
    return this.unsupported('save', 'save', 'The external filesystem is read-only through Brainbase');
  }

  async delete(input: MeetingMinutesDeleteRequest): Promise<MeetingMinutesDeleteResult> {
    const authorizationError = await this.authorizationFailure(
      input?.request_context,
      'retention_delete',
      { reference: input?.reference as MeetingMinutesExternalReference },
    );
    if (authorizationError) {
      return {
        status: 'denied',
        reason: authorizationError,
        capabilities: this.capabilities,
      };
    }
    return this.unsupported('retention_delete', 'retention_delete', 'Retention and deletion remain owned by the external storage policy');
  }

  private async authorizationFailure(
    context: unknown,
    operation: MeetingMinutesStorageAuthorizationOperation,
    target: MeetingMinutesAuthorizationTarget,
  ): Promise<string | undefined> {
    if (!context || typeof context !== 'object') return 'A host request context is required';
    const requestContext = context as Partial<MeetingMinutesStorageRequestContext>;
    if (typeof requestContext.principal_id !== 'string' || !requestContext.principal_id.trim()) {
      return 'A host request principal is required';
    }
    let decision: MeetingMinutesAuthorizationDecision | boolean;
    try {
      decision = await this.authorize(
        { principal_id: requestContext.principal_id },
        operation,
        target,
      );
    } catch {
      return 'The host authorization check could not be completed';
    }
    if (typeof decision === 'boolean') {
      return decision ? undefined : 'The current host authorization does not allow this operation';
    }
    if (!decision || typeof decision !== 'object' || typeof decision.allowed !== 'boolean') {
      return 'The host authorization check returned an invalid decision';
    }
    if (!decision.allowed) return decision.reason ?? 'The current host authorization does not allow this operation';
    if (decision.checked_at !== undefined && Number.isNaN(Date.parse(decision.checked_at))) {
      return 'The host authorization decision timestamp is invalid';
    }
    return undefined;
  }

  private async readStableFile(file: ResolvedFile): Promise<ReadBytesResult> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const noFollow = fsConstants.O_NOFOLLOW;
      if (typeof noFollow !== 'number') {
        return { status: 'unavailable', reason: 'The host does not provide O_NOFOLLOW for safe external reads' };
      }
      handle = await open(file.path, fsConstants.O_RDONLY | noFollow);
      const opened = await handle.stat();
      if (!sameFileIdentity(opened, file) || !opened.isFile()) {
        return { status: 'unavailable', reason: 'The external source changed before it could be read safely' };
      }
      const openedRealPath = await realpath(file.path);
      if (openedRealPath !== file.real_path) {
        return { status: 'symlink_rejected', reason: 'The external source path changed outside the configured root' };
      }
      if (!Number.isSafeInteger(opened.size) || opened.size > this.maxBytes) {
        return { status: 'too_large', reason: `The external source exceeds the ${this.maxBytes}-byte limit` };
      }
      const content = await readBounded(handle, this.maxBytes);
      if (content.status !== 'ok') return content;
      const closedStat = await handle.stat();
      if (!sameFileIdentity(closedStat, file) || closedStat.size !== opened.size) {
        return { status: 'unavailable', reason: 'The external source changed while it was being read' };
      }
      const closedRealPath = await realpath(file.path);
      if (closedRealPath !== file.real_path) {
        return { status: 'symlink_rejected', reason: 'The external source path changed outside the configured root' };
      }
      let body: string;
      try {
        body = decodeUtf8(content.bytes);
      } catch {
        return { status: 'invalid_encoding', reason: 'The external source is not valid UTF-8' };
      }
      return { status: 'ok', bytes: content.bytes, body };
    } catch (error) {
      const [status, reason] = readFailure(error);
      return { status, reason };
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
  }

  private registerFailure(
    status: MeetingMinutesRegisterResult['status'],
    reason: string,
  ): MeetingMinutesRegisterResult {
    if (status === 'registered') throw new Error('A registration failure cannot be registered');
    return { status, reason, capabilities: this.capabilities } as MeetingMinutesRegisterResult;
  }

  private readFailure(
    status: Exclude<MeetingMinutesReadResult['status'], 'available' | 'integrity_mismatch'>,
    reason: string,
  ): MeetingMinutesReadResult {
    return { status, reason, capabilities: this.capabilities } as MeetingMinutesReadResult;
  }

  private unsupported(
    operation: MeetingMinutesUnsupportedOperation['operation'],
    capability: MeetingMinutesUnsupportedOperation['capability'],
    reason: string,
  ): MeetingMinutesUnsupportedOperation {
    return { status: 'unsupported', operation, capability, reason, capabilities: this.capabilities };
  }

  private reference(locator: string, bytes: Buffer): MeetingMinutesExternalReference {
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    return Object.freeze({
      provider: this.provider,
      locator,
      revision: digest,
      digest,
      provenance: Object.freeze({
        source: 'external',
        adapter: FILESYSTEM_MEETING_MINUTES_ADAPTER,
        observed_at: new Date().toISOString(),
      }),
    });
  }

  private referenceFailure(reference: unknown): string | undefined {
    if (!reference || typeof reference !== 'object') return 'An external reference is required';
    const candidate = reference as Partial<MeetingMinutesExternalReference>;
    if (candidate.provider !== this.provider) return 'The reference belongs to a different provider';
    if (typeof candidate.locator !== 'string') return 'The reference locator is invalid';
    if (!isSha256(candidate.revision) || !isSha256(candidate.digest)) return 'The reference must include exact SHA-256 revision and digest';
    if (candidate.revision !== candidate.digest) return 'The filesystem revision must equal the source digest';
    const provenance = candidate.provenance;
    if (!provenance || typeof provenance !== 'object') return 'The external reference provenance is required';
    const candidateProvenance = provenance as Partial<MeetingMinutesExternalProvenance>;
    if (candidateProvenance.source !== 'external' || candidateProvenance.adapter !== FILESYSTEM_MEETING_MINUTES_ADAPTER) {
      return 'The external reference provenance is invalid';
    }
    if (typeof candidateProvenance.observed_at !== 'string' || Number.isNaN(Date.parse(candidateProvenance.observed_at))) {
      return 'The external reference observation timestamp is invalid';
    }
    return undefined;
  }

  private async resolveFile(locator: string): Promise<ResolvedFileResult> {
    let rootStat;
    try {
      rootStat = await lstat(this.root);
    } catch (error) {
      return fsFailure(error, `The configured filesystem root is unavailable: ${this.root}`);
    }
    if (rootStat.isSymbolicLink()) {
      return { status: 'symlink_rejected', reason: 'The configured filesystem root must not be a symlink' };
    }
    if (!rootStat.isDirectory()) {
      return { status: 'not_found', reason: 'The configured filesystem root is not a directory' };
    }

    let current = this.root;
    let finalStat;
    const parts = locator.split('/');
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      let stat;
      try {
        stat = await lstat(current);
      } catch (error) {
        return fsFailure(error, `The external source does not exist at ${locator}`);
      }
      if (stat.isSymbolicLink()) {
        return { status: 'symlink_rejected', reason: `Symlink path components are not allowed: ${locator}` };
      }
      if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
        return { status: 'not_found', reason: `The external source is not a regular file: ${locator}` };
      }
      if (index === parts.length - 1) finalStat = stat;
    }

    let realFile: string;
    try {
      const realRoot = await realpath(this.root);
      realFile = await realpath(current);
      const escaped = relative(realRoot, realFile);
      if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
        return { status: 'symlink_rejected', reason: `The external locator escapes the configured root: ${locator}` };
      }
    } catch (error) {
      return fsFailure(error, `The external source cannot be resolved at ${locator}`);
    }

    if (!finalStat) return { status: 'not_found', reason: `The external source is not a regular file: ${locator}` };
    return {
      status: 'ok',
      path: current,
      real_path: realFile,
      device: finalStat.dev,
      inode: finalStat.ino,
    };
  }
}

export class MeetingMinutesStorageError extends Error {
  readonly code: 'invalid_configuration';

  constructor(code: 'invalid_configuration', message: string) {
    super(message);
    this.name = 'MeetingMinutesStorageError';
    this.code = code;
  }
}

export function createFilesystemMeetingMinutesAdapter(
  options: FilesystemMeetingMinutesAdapterOptions,
): FilesystemMeetingMinutesAdapter {
  return new FilesystemMeetingMinutesAdapter(options);
}

function normalizeLocator(locator: unknown): LocatorResult {
  if (typeof locator !== 'string' || !locator.trim()) {
    return { status: 'invalid_locator', reason: 'A root-relative locator is required' };
  }
  if (locator.includes('\0') || locator.includes('\\') || locator.startsWith('/') || posix.isAbsolute(locator)) {
    return { status: 'invalid_locator', reason: 'The locator must be a root-relative POSIX path' };
  }
  const segments = locator.split('/');
  if (segments.some((segment) => segment === '..')) {
    return { status: 'invalid_locator', reason: 'Parent path segments are not allowed in an external locator' };
  }
  const normalized = posix.normalize(locator);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return { status: 'invalid_locator', reason: 'The locator must resolve to a file inside the configured root' };
  }
  return { status: 'ok', locator: normalized };
}

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
): Promise<BoundedBytesResult> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const chunkSize = Math.min(READ_CHUNK_BYTES, maxBytes - total + 1);
    const chunk = Buffer.allocUnsafe(chunkSize);
    const result = await handle.read(chunk, 0, chunkSize, null);
    if (result.bytesRead === 0) break;
    total += result.bytesRead;
    if (total > maxBytes) {
      return { status: 'too_large', reason: `The external source exceeds the ${maxBytes}-byte limit` };
    }
    chunks.push(chunk.subarray(0, result.bytesRead));
  }
  return { status: 'ok', bytes: Buffer.concat(chunks, total) };
}

function sameFileIdentity(
  stat: { readonly dev: number; readonly ino: number },
  file: ResolvedFile,
): boolean {
  return stat.dev === file.device && stat.ino === file.inode;
}

function decodeUtf8(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function readFailure(error: unknown): [MeetingMinutesUnavailableStatus, string] {
  const failure = fsFailure(error, 'The external source could not be read');
  return [failure.status, failure.reason];
}

function fsFailure(error: unknown, fallback: string): ResolvedFileFailure {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'not_found', reason: fallback };
  if (code === 'ELOOP') return { status: 'symlink_rejected', reason: fallback };
  if (code === 'EACCES' || code === 'EPERM') return { status: 'unavailable', reason: fallback };
  return { status: 'unavailable', reason: fallback };
}
