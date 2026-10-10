/**
 * Saves a team document into its owning repository through a caller-supplied
 * provider. The adapter validates the request, forwards both CAS values and the
 * idempotency key, and reports success only after the provider's readback
 * matches the requested content and write revision.
 *
 * Moved unchanged from brainbase-unson server/services/canonical-document-writer-adapter.js
 * (story-document-and-meeting-source-exits-v1).
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

const SOURCE_CLASS = 'owning_repo';
const CONTENT_TYPE = 'team_document';

type Revision = string | number;

export interface CanonicalDocumentResolution {
  status?: unknown;
  source_class?: unknown;
  content_type?: unknown;
  project_code?: unknown;
  canonical_location?: { repository?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface CanonicalDocumentSaveInput {
  project_code?: unknown;
  resolution?: CanonicalDocumentResolution | null;
  content?: unknown;
  path?: unknown;
  repository_path?: unknown;
  base_hash?: unknown;
  expected_hash?: unknown;
  base_revision?: unknown;
  expected_revision?: unknown;
  idempotency_key?: unknown;
  access?: unknown;
  [key: string]: unknown;
}

export interface CanonicalDocumentWriteRequest {
  project_code: string;
  path: string;
  content: string;
  content_hash: string;
  base_hash: string | null;
  base_revision: string;
  idempotency_key: string;
  request_fingerprint: string;
  resolution: CanonicalDocumentResolution;
  access: unknown;
}

export interface CanonicalDocumentWriteResult {
  path?: string;
  canonical_url?: string | null;
  revision?: Revision;
  idempotency_replayed?: boolean;
  [key: string]: unknown;
}

export interface CanonicalDocumentReadResult {
  path?: string;
  content?: unknown;
  content_hash?: unknown;
  revision?: Revision;
  canonical_url?: string | null;
  [key: string]: unknown;
}

export interface CanonicalDocumentProvider {
  write(request: CanonicalDocumentWriteRequest): Promise<CanonicalDocumentWriteResult> | CanonicalDocumentWriteResult;
  read(request: {
    project_code: string;
    path: string;
    canonical_url: string | null;
    resolution: CanonicalDocumentResolution;
    access: unknown;
  }): Promise<CanonicalDocumentReadResult> | CanonicalDocumentReadResult;
}

export interface CanonicalDocumentSaveResult {
  status: 'saved';
  project_code: string;
  source_class: typeof SOURCE_CLASS;
  content_type: typeof CONTENT_TYPE;
  path: string;
  canonical_url: string | null;
  content_hash: string;
  revision: string;
  readback: { path: string; content_hash: string; revision: string; canonical_url: string | null };
  search_indexed: 'unknown';
  idempotency_key: string;
  idempotency_replayed: boolean;
  request_fingerprint: string;
}

export interface CanonicalDocumentReceiptStore {
  find?(request: CanonicalDocumentWriteRequest): Promise<{ request_fingerprint: string; result: CanonicalDocumentSaveResult } | null | undefined>;
  put?(record: CanonicalDocumentWriteRequest & { result: CanonicalDocumentSaveResult }): Promise<unknown>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
  }
  return value;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CanonicalDocumentWriterError(
      'canonical_document_input_invalid',
      `${name} is required`,
      400,
      { field: name },
    );
  }
  return value.trim();
}

function normalizeRevision(value: unknown, name: string): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  return requiredString(value, name);
}

function errorField(error: unknown, field: 'code' | 'message' | 'status'): unknown {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[field] : undefined;
}

export class CanonicalDocumentWriterError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CanonicalDocumentWriterError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Canonical document provider contract.
 *
 * A provider is intentionally supplied by the caller. It must implement:
 *   write({ project_code, path, content, base_hash, base_revision,
 *           idempotency_key, request_fingerprint, resolution, access })
 *     -> { path?, canonical_url?, revision? }
 *   read({ project_code, path, canonical_url?, resolution, access })
 *     -> { path?, content, content_hash?, revision, canonical_url? }
 *
 * The provider owns the atomic CAS and durable idempotency boundary. This
 * adapter validates the request, forwards both CAS values, and verifies the
 * provider's post-write readback before reporting success.
 */
export class CanonicalDocumentWriterAdapter {
  provider: CanonicalDocumentProvider | null;
  receiptStore: CanonicalDocumentReceiptStore | null;
  completed: Map<string, { request_fingerprint: string; result: CanonicalDocumentSaveResult }>;

  constructor({ provider = null, receiptStore = null }: {
    provider?: CanonicalDocumentProvider | null;
    receiptStore?: CanonicalDocumentReceiptStore | null;
  } = {}) {
    this.provider = provider;
    this.receiptStore = receiptStore;
    this.completed = new Map();
  }

  async save(input: CanonicalDocumentSaveInput = {}): Promise<CanonicalDocumentSaveResult> {
    const request = this.normalizeRequest(input);
    this.assertProvider();

    let durable: { request_fingerprint: string; result: CanonicalDocumentSaveResult } | null | undefined = null;
    if (typeof this.receiptStore?.find === 'function') {
      try {
        durable = await this.receiptStore.find(request);
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === 'CanonicalDocumentWriterError') throw error;
        throw new CanonicalDocumentWriterError(
          'canonical_document_receipt_unavailable',
          'canonical document write receipt could not be read',
          503,
          { cause: errorField(error, 'code') || errorField(error, 'message') || 'unknown' },
        );
      }
    }
    if (durable) {
      if (durable.request_fingerprint !== request.request_fingerprint) {
        throw new CanonicalDocumentWriterError(
          'canonical_document_idempotency_conflict',
          'idempotency_key was already used with different document content',
          409,
          { idempotency_key: request.idempotency_key },
        );
      }
      return { ...durable.result, idempotency_replayed: true };
    }

    const previous = this.completed.get(request.idempotency_key);
    if (previous) {
      if (previous.request_fingerprint !== request.request_fingerprint) {
        throw new CanonicalDocumentWriterError(
          'canonical_document_idempotency_conflict',
          'idempotency_key was already used with different document content',
          409,
          { idempotency_key: request.idempotency_key },
        );
      }
      return { ...previous.result, idempotency_replayed: true };
    }

    const provider = this.provider as CanonicalDocumentProvider;
    let result: CanonicalDocumentSaveResult;
    try {
      const writeResult = await provider.write(request);
      if (!writeResult || typeof writeResult !== 'object' || !writeResult.revision) {
        throw new CanonicalDocumentWriterError(
          'canonical_document_write_invalid',
          'canonical document provider did not return the write revision',
          503,
        );
      }
      const readback = await this.readback(request, writeResult);
      result = {
        ...readback,
        idempotency_key: request.idempotency_key,
        idempotency_replayed: Boolean(writeResult.idempotency_replayed),
        request_fingerprint: request.request_fingerprint,
      };
    } catch (error) {
      throw this.normalizeProviderError(error);
    }

    if (typeof this.receiptStore?.put === 'function') {
      try {
        await this.receiptStore.put({
          ...request,
          result,
        });
      } catch (error) {
        throw this.normalizeProviderError(new CanonicalDocumentWriterError(
          'canonical_document_receipt_unavailable',
          'canonical document write receipt could not be stored',
          503,
          { cause: errorField(error, 'code') || errorField(error, 'message') || 'unknown' },
        ));
      }
    }
    this.completed.set(request.idempotency_key, {
      request_fingerprint: request.request_fingerprint,
      result,
    });
    return result;
  }

  normalizeRequest(input: CanonicalDocumentSaveInput): CanonicalDocumentWriteRequest {
    const projectCode = requiredString(input.project_code, 'project_code');
    const resolution = input.resolution;
    this.assertOwningRepositoryResolution(resolution, projectCode);

    const content = input.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new CanonicalDocumentWriterError(
        'canonical_document_input_invalid',
        'content is required',
        400,
        { field: 'content' },
      );
    }

    const repositoryPath = normalizeRepositoryRelativePath(input.path ?? input.repository_path);
    const rawBaseHash = input.base_hash ?? input.expected_hash;
    const baseHash = rawBaseHash === undefined || rawBaseHash === null || rawBaseHash === ''
      ? null
      : requiredString(rawBaseHash, 'base_hash');
    const baseRevision = normalizeRevision(input.base_revision ?? input.expected_revision, 'base_revision');
    const idempotencyKey = requiredString(input.idempotency_key, 'idempotency_key');
    const contentHash = digest(content);
    const fingerprint = digest(JSON.stringify(stableValue({
      project_code: projectCode,
      path: repositoryPath,
      content_hash: contentHash,
      base_hash: baseHash,
      base_revision: baseRevision,
      idempotency_key: idempotencyKey,
      source_class: SOURCE_CLASS,
      content_type: CONTENT_TYPE,
      canonical_location: resolution.canonical_location || null,
    })));

    return {
      project_code: projectCode,
      path: repositoryPath,
      content,
      content_hash: contentHash,
      base_hash: baseHash,
      base_revision: baseRevision,
      idempotency_key: idempotencyKey,
      request_fingerprint: fingerprint,
      resolution,
      access: input.access || null,
    };
  }

  assertProvider(): void {
    if (!this.provider || typeof this.provider.write !== 'function' || typeof this.provider.read !== 'function') {
      throw new CanonicalDocumentWriterError(
        'canonical_document_writer_not_configured',
        'canonical document writer is not configured',
        503,
      );
    }
  }

  assertOwningRepositoryResolution(
    resolution: CanonicalDocumentResolution | null | undefined,
    projectCode: string,
  ): asserts resolution is CanonicalDocumentResolution {
    if (!resolution
      || resolution.status !== 'resolved'
      || resolution.source_class !== SOURCE_CLASS
      || resolution.content_type !== CONTENT_TYPE
      || resolution.project_code !== projectCode) {
      throw new CanonicalDocumentWriterError(
        'canonical_document_route_invalid',
        'team_document must resolve to the owning repository before it can be saved',
        422,
        { required_source_class: SOURCE_CLASS, required_content_type: CONTENT_TYPE },
      );
    }

    const expectedRepository = `project:${projectCode}`;
    const repository = resolution.canonical_location?.repository;
    if (repository && repository !== expectedRepository) {
      throw new CanonicalDocumentWriterError(
        'canonical_document_route_invalid',
        'resolution repository does not match project_code',
        422,
        { expected_repository: expectedRepository, repository },
      );
    }
  }

  async readback(
    request: CanonicalDocumentWriteRequest,
    writeResult: CanonicalDocumentWriteResult = {},
  ): Promise<Omit<CanonicalDocumentSaveResult, 'idempotency_key' | 'idempotency_replayed' | 'request_fingerprint'>> {
    if (!writeResult || typeof writeResult !== 'object') {
      throw new CanonicalDocumentWriterError(
        'canonical_document_write_invalid',
        'canonical document provider returned an invalid write result',
        503,
      );
    }
    const pathFromWrite = normalizeRepositoryRelativePath(writeResult.path ?? request.path);
    const readback = await (this.provider as CanonicalDocumentProvider).read({
      project_code: request.project_code,
      path: pathFromWrite,
      canonical_url: writeResult.canonical_url || null,
      resolution: request.resolution,
      access: request.access,
    });
    if (!readback || typeof readback !== 'object' || typeof readback.content !== 'string') {
      throw new CanonicalDocumentWriterError(
        'canonical_document_readback_unavailable',
        'canonical document could not be read back after save',
        503,
      );
    }

    const readbackPath = normalizeRepositoryRelativePath(readback.path ?? pathFromWrite);
    const readbackHash = digest(readback.content);
    const declaredReadbackHash = typeof readback.content_hash === 'string' ? readback.content_hash.trim() : null;
    if (readbackPath !== request.path
      || (declaredReadbackHash && declaredReadbackHash !== readbackHash)
      || readbackHash !== request.content_hash
      || readback.content !== request.content) {
      throw new CanonicalDocumentWriterError(
        'canonical_document_readback_mismatch',
        'canonical document readback does not match the requested content',
        502,
        {
          path: request.path,
          expected_content_hash: request.content_hash,
          actual_content_hash: readbackHash,
          ...(declaredReadbackHash ? { declared_content_hash: declaredReadbackHash } : {}),
          actual_path: readbackPath,
        },
      );
    }

    const writeRevision = normalizeRevision(writeResult.revision, 'writeResult.revision');
    const revision = normalizeRevision(readback.revision, 'readback.revision');
    if (revision !== writeRevision) {
      throw new CanonicalDocumentWriterError(
        'canonical_document_readback_revision_mismatch',
        'canonical document readback revision does not match the write commit',
        502,
        { expected_revision: writeRevision, actual_revision: revision },
      );
    }
    return {
      status: 'saved',
      project_code: request.project_code,
      source_class: SOURCE_CLASS,
      content_type: CONTENT_TYPE,
      path: request.path,
      canonical_url: readback.canonical_url || writeResult.canonical_url || null,
      content_hash: request.content_hash,
      revision,
      readback: {
        path: readbackPath,
        content_hash: readbackHash,
        revision,
        canonical_url: readback.canonical_url || writeResult.canonical_url || null,
      },
      search_indexed: 'unknown',
    };
  }

  normalizeProviderError(error: unknown): CanonicalDocumentWriterError {
    if (error instanceof CanonicalDocumentWriterError) return error;
    const rawStatus = errorField(error, 'status');
    const status = Number.isInteger(rawStatus) ? rawStatus as number : 503;
    const rawCode = errorField(error, 'code');
    const code = typeof rawCode === 'string' && rawCode
      ? rawCode
      : 'canonical_document_writer_failed';
    return new CanonicalDocumentWriterError(
      code,
      status === 409 ? 'canonical document write conflicts with the current version' : 'canonical document writer is unavailable',
      status,
      status === 409 ? { provider_code: code } : {},
    );
  }
}

export function normalizeRepositoryRelativePath(value: unknown): string {
  const raw = requiredString(value, 'path');
  if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new CanonicalDocumentWriterError(
      'canonical_document_path_invalid',
      'path must be a repository-relative POSIX path',
      400,
      { field: 'path' },
    );
  }
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new CanonicalDocumentWriterError(
      'canonical_document_path_invalid',
      'path must not contain empty, dot, or parent segments',
      400,
      { field: 'path' },
    );
  }
  const normalized = path.posix.normalize(raw);
  if (normalized !== raw || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new CanonicalDocumentWriterError(
      'canonical_document_path_invalid',
      'path must be a normalized repository-relative path',
      400,
      { field: 'path' },
    );
  }
  return normalized;
}

export const canonicalDocumentWriterInternals = { digest, stableValue };
