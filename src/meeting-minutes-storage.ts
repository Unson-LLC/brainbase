import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
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

export type MeetingMinutesAuthorizationStatus = 'allowed' | 'denied' | 'unknown';

/**
 * The organization boundary must provide a current authorization observation
 * for every registration and read. The filesystem mode bits are not treated
 * as the company's ACL contract.
 */
export interface MeetingMinutesAuthorization {
  readonly status: MeetingMinutesAuthorizationStatus;
  readonly principal?: string;
  readonly checked_at?: string;
  readonly reason?: string;
}

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
}

export interface MeetingMinutesRegisterRequest {
  readonly locator: string;
  readonly authorization: MeetingMinutesAuthorization;
}

export interface MeetingMinutesReadRequest {
  readonly reference: MeetingMinutesExternalReference;
  readonly authorization: MeetingMinutesAuthorization;
}

export interface MeetingMinutesSaveRequest {
  readonly reference?: MeetingMinutesExternalReference;
  readonly body?: string;
}

export interface MeetingMinutesDeleteRequest {
  readonly reference: MeetingMinutesExternalReference;
  readonly authorization: MeetingMinutesAuthorization;
}

export type MeetingMinutesUnavailableStatus = 'not_found' | 'symlink_rejected' | 'unavailable';

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
}

interface ResolvedFileFailure {
  readonly status: MeetingMinutesUnavailableStatus;
  readonly reason: string;
}

type ResolvedFileResult = ResolvedFile | ResolvedFileFailure;

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
    this.root = resolve(options.root);
    this.provider = provider;
  }

  async register(input: MeetingMinutesRegisterRequest): Promise<MeetingMinutesRegisterResult> {
    const authorizationError = authorizationFailure(input?.authorization);
    if (authorizationError) return this.registerFailure('denied', authorizationError);

    const locator = normalizeLocator(input?.locator);
    if (locator.status !== 'ok') return this.registerFailure(locator.status, locator.reason);

    const file = await this.resolveFile(locator.locator);
    if (file.status !== 'ok') return this.registerFailure(file.status, file.reason);

    try {
      const bytes = await readFile(file.path);
      return {
        status: 'registered',
        reference: this.reference(locator.locator, bytes),
        capabilities: this.capabilities,
      };
    } catch (error) {
      return this.registerFailure(...readFailure(error));
    }
  }

  async read(input: MeetingMinutesReadRequest): Promise<MeetingMinutesReadResult> {
    const authorizationError = authorizationFailure(input?.authorization);
    if (authorizationError) return this.readFailure('denied', authorizationError);

    const referenceError = this.referenceFailure(input?.reference);
    if (referenceError) return this.readFailure('invalid_reference', referenceError);

    const locator = normalizeLocator(input.reference.locator);
    if (locator.status !== 'ok') return this.readFailure('invalid_reference', locator.reason);

    const file = await this.resolveFile(locator.locator);
    if (file.status !== 'ok') return this.readFailure(file.status, file.reason);

    try {
      const bytes = await readFile(file.path);
      const observed = this.reference(locator.locator, bytes);
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
        body: bytes.toString('utf8'),
        capabilities: this.capabilities,
      };
    } catch (error) {
      return this.readFailure(...readFailure(error));
    }
  }

  async read_history(input: MeetingMinutesReadRequest): Promise<MeetingMinutesHistoryResult> {
    const authorizationError = authorizationFailure(input?.authorization);
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
    const authorizationError = authorizationFailure(input?.authorization);
    if (authorizationError) {
      return {
        status: 'denied',
        reason: authorizationError,
        capabilities: this.capabilities,
      };
    }
    return this.unsupported('retention_delete', 'retention_delete', 'Retention and deletion remain owned by the external storage policy');
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
    }

    try {
      const realRoot = await realpath(this.root);
      const realFile = await realpath(current);
      const escaped = relative(realRoot, realFile);
      if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
        return { status: 'symlink_rejected', reason: `The external locator escapes the configured root: ${locator}` };
      }
    } catch (error) {
      return fsFailure(error, `The external source cannot be resolved at ${locator}`);
    }

    return { status: 'ok', path: current };
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

function authorizationFailure(authorization: unknown): string | undefined {
  if (!authorization || typeof authorization !== 'object') return 'A current authorization observation is required';
  const candidate = authorization as Partial<MeetingMinutesAuthorization>;
  if (candidate.status !== 'allowed') return candidate.reason ?? 'The current authorization does not allow this operation';
  if (typeof candidate.principal !== 'string' || !candidate.principal.trim()) return 'The current authorization principal is required';
  if (typeof candidate.checked_at !== 'string' || Number.isNaN(Date.parse(candidate.checked_at))) {
    return 'The current authorization timestamp is required';
  }
  return undefined;
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
  if (code === 'EACCES' || code === 'EPERM') return { status: 'unavailable', reason: fallback };
  return { status: 'unavailable', reason: fallback };
}
