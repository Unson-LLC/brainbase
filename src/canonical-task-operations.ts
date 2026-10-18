import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { CanonicalTaskPgClient, CanonicalTaskPgPool } from './canonical-task-postgres.js';

type JsonRecord = Record<string, unknown>;

export type CanonicalTaskOperationError = Error & { code: string; status: number; details: JsonRecord };

export function canonicalTaskOperationError(code: string, message: string, status = 503, details: JsonRecord = {}): CanonicalTaskOperationError {
  const error = new Error(message) as CanonicalTaskOperationError;
  error.name = 'CanonicalTaskOperationError';
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function writerDisabled() {
  return canonicalTaskOperationError('canonical_task_writer_disabled', 'Canonical Task writer is disabled for this process');
}

function isUnboundProcessIdentity(value: unknown): boolean {
  return !value || typeof value !== 'object' || Object.keys(value).length === 0;
}

function sameProcessIdentity(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => Object.fromEntries(
    Object.entries((value as JsonRecord) || {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export interface CanonicalTaskOperationRepositoryOptions {
  pool?: CanonicalTaskPgPool | null;
  writerToken?: string | null;
  processIdentity?: JsonRecord | null;
  writerEnabled?: boolean;
  operationWaitTimeoutMs?: number;
  operationPollIntervalMs?: number;
}

export interface CanonicalTaskReadinessRow {
  ready: boolean;
  writer_token: string | null;
  manifest_hash: string | null;
  schema_version: string | null;
  source_head: string | null;
  evidence_hash: string | null;
  evidence_path: string | null;
  reason: string | null;
  updated_at: unknown;
}

const READINESS_COLUMNS = `ready, writer_token, manifest_hash, schema_version, source_head,
                    evidence_hash, evidence_path, reason, updated_at`;

/**
 * Single-writer coordination for Canonical Task mutations
 * (`contracts/canonical-task/operation-schema.sql`). One process owns the
 * writer token; every mutation is recorded by scope and operation key so a
 * retry with the same input replays and a different input conflicts.
 */
export class CanonicalTaskOperationRepository {
  /**
   * A PostgreSQL coordinator is a durable mutation boundary. Callers must
   * bind it to the release readiness gate before exposing mutations.
   */
  readonly requiresReadiness = true;
  readonly pool: CanonicalTaskPgPool | null;
  readonly writerToken: string | null;
  readonly processIdentity: JsonRecord | null;
  readonly writerEnabled: boolean;
  readonly operationWaitTimeoutMs: number;
  readonly operationPollIntervalMs: number;
  writerClaimed = false;
  activeOperations = 0;

  constructor({
    pool = null,
    writerToken = null,
    processIdentity = null,
    writerEnabled = false,
    operationWaitTimeoutMs = 5000,
    operationPollIntervalMs = 10,
  }: CanonicalTaskOperationRepositoryOptions = {}) {
    this.pool = pool;
    this.writerToken = writerToken;
    this.processIdentity = processIdentity;
    this.writerEnabled = writerEnabled === true;
    this.operationWaitTimeoutMs = operationWaitTimeoutMs;
    this.operationPollIntervalMs = operationPollIntervalMs;
  }

  private identityJson(): string {
    return JSON.stringify(this.processIdentity || {});
  }

  private async connect(): Promise<CanonicalTaskPgClient> {
    if (typeof this.pool?.connect !== 'function') {
      throw canonicalTaskOperationError('canonical_task_coordination_unavailable', 'Canonical Task coordination database is not configured');
    }
    return this.pool.connect();
  }

  async waitForCompletedOperation({ scope, operationKey, fingerprint }: { scope: string; operationKey: string; fingerprint: string }): Promise<unknown> {
    const deadline = Date.now() + this.operationWaitTimeoutMs;
    while (Date.now() <= deadline) {
      await this.assertWriter();
      const existing = await this.pool!.query(
        `SELECT fingerprint, state, result_json, error_json, writer_token
         FROM canonical_task_operations
         WHERE scope = $1 AND operation_key = $2`,
        [scope, operationKey],
      );
      const row = existing.rows[0];
      if (!row || row.fingerprint !== fingerprint) {
        throw canonicalTaskOperationError('idempotency_conflict', 'Idempotency key was reused with different input', 409);
      }
      if (row.state === 'completed') return row.result_json;
      if (row.state === 'failed') {
        throw canonicalTaskOperationError('canonical_task_operation_failed', 'Concurrent Canonical Task operation failed', 503, {
          cause: row.error_json || null,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, this.operationPollIntervalMs));
    }
    throw canonicalTaskOperationError('canonical_task_operation_timeout', 'Timed out waiting for the concurrent Canonical Task operation', 503);
  }

  assertConfigured(): void {
    if (!this.pool || !this.writerToken) {
      throw canonicalTaskOperationError('canonical_task_coordination_unavailable', 'Canonical Task coordination database is not configured');
    }
  }

  assertWriterEnabled(): void {
    if (this.writerEnabled !== true) throw writerDisabled();
  }

  async claimWriter({ sourceHead }: { sourceHead?: string | null } = {}): Promise<JsonRecord> {
    this.assertWriterEnabled();
    this.assertConfigured();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO canonical_task_writer (
            singleton_id, writer_token, process_identity, source_head, claimed_at, updated_at
         ) VALUES (TRUE, $1, $2::jsonb, $3, NOW(), NOW())
         ON CONFLICT (singleton_id) DO NOTHING`,
        [this.writerToken, this.identityJson(), sourceHead || null],
      );
      const current = await client.query(
        `SELECT writer_token, process_identity, source_head
         FROM canonical_task_writer
         WHERE singleton_id = TRUE
         FOR UPDATE`,
      );
      const row = current.rows[0];
      const canBindProcess = row
        && row.writer_token === this.writerToken
        && (isUnboundProcessIdentity(row.process_identity) || sameProcessIdentity(row.process_identity, this.processIdentity));
      if (!canBindProcess) {
        throw canonicalTaskOperationError('canonical_task_writer_unavailable', 'Canonical Task writer is owned by another process', 503, {
          active_writer: row?.process_identity || null,
          source_head: row?.source_head || null,
        });
      }
      const claimed = await client.query(
        `UPDATE canonical_task_writer
         SET process_identity = $2::jsonb, source_head = $3, updated_at = NOW()
         WHERE singleton_id = TRUE AND writer_token = $1
           AND (process_identity = '{}'::jsonb OR process_identity = $2::jsonb)
         RETURNING writer_token, process_identity, source_head`,
        [this.writerToken, this.identityJson(), sourceHead || null],
      );
      if (claimed.rowCount !== 1) {
        throw canonicalTaskOperationError('canonical_task_writer_unavailable', 'Canonical Task writer process binding changed during claim');
      }
      await client.query('COMMIT');
      this.writerClaimed = true;
      return claimed.rows[0] || row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async assertWriter(client: CanonicalTaskPgClient | null = this.pool): Promise<void> {
    this.assertWriterEnabled();
    this.assertConfigured();
    const result = await client!.query(
      `SELECT 1 FROM canonical_task_writer
       WHERE singleton_id = TRUE AND writer_token = $1
         AND process_identity = $2::jsonb`,
      [this.writerToken, this.identityJson()],
    );
    if (!result.rowCount) {
      this.writerClaimed = false;
      throw canonicalTaskOperationError('canonical_task_writer_unavailable', 'This process does not own the Canonical Task writer token');
    }
  }

  async readReadiness(): Promise<CanonicalTaskReadinessRow | null> {
    this.assertConfigured();
    const result = await this.pool!.query(
      `SELECT ${READINESS_COLUMNS}
       FROM canonical_task_readiness
       WHERE singleton_id = TRUE`,
    );
    return result.rows[0] || null;
  }

  async reconcileReadiness({ manifestHash, schemaVersion, sourceHead, allowWriterRebind = false }: {
    manifestHash?: string | null; schemaVersion?: string | null; sourceHead?: string | null; allowWriterRebind?: boolean;
  } = {}): Promise<CanonicalTaskReadinessRow | null> {
    this.assertWriterEnabled();
    this.assertConfigured();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const writer = await client.query(
        `SELECT writer_token, process_identity FROM canonical_task_writer
         WHERE singleton_id = TRUE FOR UPDATE`,
      );
      if (!writer.rowCount
        || writer.rows[0].writer_token !== this.writerToken
        || !sameProcessIdentity(writer.rows[0].process_identity, this.processIdentity)) {
        throw canonicalTaskOperationError('canonical_task_writer_unavailable', 'This process does not own the Canonical Task writer token');
      }
      const readiness = await client.query(
        `SELECT ${READINESS_COLUMNS}
         FROM canonical_task_readiness
         WHERE singleton_id = TRUE
         FOR UPDATE`,
      );
      let row = readiness.rows[0] || null;
      const releaseMatches = Boolean(
        row?.ready
        && row.manifest_hash === manifestHash
        && row.schema_version === schemaVersion
        && row.source_head === sourceHead
        && row.evidence_hash,
      );
      if (allowWriterRebind && releaseMatches && row.writer_token !== this.writerToken) {
        const rebound = await client.query(
          `UPDATE canonical_task_readiness
           SET writer_token = $1, updated_at = NOW()
           WHERE singleton_id = TRUE
           RETURNING ${READINESS_COLUMNS}`,
          [this.writerToken],
        );
        row = rebound.rows[0] || row;
      }
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async rebindReadinessSourceHead({ manifestHash, schemaVersion, fromHead, toHead }: {
    manifestHash?: string | null; schemaVersion?: string | null; fromHead?: string | null; toHead?: string | null;
  } = {}): Promise<CanonicalTaskReadinessRow> {
    this.assertWriterEnabled();
    this.assertConfigured();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await this.assertWriter(client);
      const rebound = await client.query(
        `UPDATE canonical_task_readiness
         SET source_head = $4, writer_token = $5, updated_at = NOW()
         WHERE singleton_id = TRUE
           AND ready = TRUE
           AND manifest_hash = $1
           AND schema_version = $2
           AND source_head = $3
           AND evidence_hash IS NOT NULL
         RETURNING ${READINESS_COLUMNS}`,
        [manifestHash, schemaVersion, fromHead, toHead, this.writerToken],
      );
      if (rebound.rowCount !== 1) {
        throw canonicalTaskOperationError('canonical_task_readiness_rebind_conflict', 'Persisted readiness changed while rebinding source head');
      }
      await client.query('COMMIT');
      return rebound.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  async releaseWriter(): Promise<boolean> {
    if (!this.pool || !this.writerToken || !this.writerClaimed || this.activeOperations > 0) return false;
    const result = await this.pool.query(
      `DELETE FROM canonical_task_writer
       WHERE singleton_id = TRUE AND writer_token = $1
         AND process_identity = $2::jsonb`,
      [this.writerToken, this.identityJson()],
    );
    this.writerClaimed = false;
    return result.rowCount === 1;
  }

  async execute<T>(args: CanonicalTaskCoordinatedRequest<T>): Promise<T> {
    this.activeOperations += 1;
    try {
      return await this.executeCoordinated(args);
    } finally {
      this.activeOperations -= 1;
    }
  }

  async executeCoordinated<T>({ scope, operationKey, fingerprint, recover = null, projectResult = (value) => value, run }: CanonicalTaskCoordinatedRequest<T>): Promise<T> {
    this.assertWriterEnabled();
    this.assertConfigured();
    await this.assertWriter();
    let shouldRecover = false;
    let completedNeedsRehydrate = false;
    let waitForExisting = false;
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await this.assertWriter(client);
      const inserted = await client.query(
        `INSERT INTO canonical_task_operations (scope, operation_key, fingerprint, state, writer_token)
         VALUES ($1, $2, $3, 'running', $4)
         ON CONFLICT (scope, operation_key) DO NOTHING
         RETURNING id`,
        [scope, operationKey, fingerprint, this.writerToken],
      );
      if (!inserted.rowCount) {
        const existing = await client.query(
          `SELECT fingerprint, state, result_json, writer_token FROM canonical_task_operations
           WHERE scope = $1 AND operation_key = $2 FOR UPDATE`,
          [scope, operationKey],
        );
        const row = existing.rows[0];
        if (row?.state === 'failed' && (row.fingerprint === fingerprint || scope === 'task-version')) {
          const reclaimed = await client.query(
            `UPDATE canonical_task_operations
             SET fingerprint = $3, state = 'running', writer_token = $4,
                 result_json = NULL, error_json = NULL, updated_at = NOW()
             WHERE scope = $1 AND operation_key = $2 AND state = 'failed'`,
            [scope, operationKey, fingerprint, this.writerToken],
          );
          if (reclaimed.rowCount !== 1) {
            throw canonicalTaskOperationError('canonical_task_operation_in_progress', 'Canonical Task operation changed while it was being retried', 409);
          }
          shouldRecover = typeof recover === 'function';
          await client.query('COMMIT');
        } else if (row?.fingerprint !== fingerprint) {
          throw canonicalTaskOperationError('idempotency_conflict', 'Idempotency key was reused with different input', 409);
        } else if (row?.state === 'completed') {
          await client.query('COMMIT');
          if (typeof recover !== 'function') return row.result_json;
          completedNeedsRehydrate = true;
        } else if (row?.state === 'running' && row.writer_token && row.writer_token !== this.writerToken && typeof recover === 'function') {
          const reclaimed = await client.query(
            `UPDATE canonical_task_operations
             SET writer_token = $3, updated_at = NOW()
             WHERE scope = $1 AND operation_key = $2
               AND state = 'running' AND writer_token = $4`,
            [scope, operationKey, this.writerToken, row.writer_token],
          );
          if (reclaimed.rowCount !== 1) {
            throw canonicalTaskOperationError('canonical_task_operation_in_progress', 'Canonical Task operation is already in progress', 409);
          }
          shouldRecover = true;
          await client.query('COMMIT');
        } else {
          waitForExisting = true;
          await client.query('COMMIT');
        }
      } else {
        await client.query('COMMIT');
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }

    if (completedNeedsRehydrate) {
      const recovery = await recover!();
      if (recovery?.recovered) return recovery.result as T;
      throw canonicalTaskOperationError('canonical_task_operation_result_unavailable', 'Completed Canonical Task operation could not be rehydrated from the canonical store');
    }

    if (waitForExisting) {
      const persistedResult = await this.waitForCompletedOperation({ scope, operationKey, fingerprint });
      if (typeof recover === 'function') {
        const recovery = await recover();
        if (recovery?.recovered) return recovery.result as T;
        throw canonicalTaskOperationError('canonical_task_operation_result_unavailable', 'Completed Canonical Task operation could not be rehydrated from the canonical store');
      }
      return persistedResult as T;
    }

    try {
      const recovery = shouldRecover ? await recover!() : null;
      const result = recovery?.recovered ? recovery.result as T : await run();
      await this.assertWriter();
      await this.pool!.query(
        `UPDATE canonical_task_operations
         SET state = 'completed', result_json = $3::jsonb, updated_at = NOW()
         WHERE scope = $1 AND operation_key = $2 AND writer_token = $4`,
        [scope, operationKey, JSON.stringify(projectResult(result)), this.writerToken],
      );
      return result;
    } catch (error: any) {
      await this.pool!.query(
        `UPDATE canonical_task_operations
         SET state = 'failed', error_json = $3::jsonb, updated_at = NOW()
         WHERE scope = $1 AND operation_key = $2 AND writer_token = $4`,
        [scope, operationKey, JSON.stringify({ code: error?.code || null, message: error?.message || String(error) }), this.writerToken],
      ).catch(() => {});
      throw error;
    }
  }

  async executePreparedDelete<T>(args: CanonicalTaskPreparedDeleteCoordination<T>): Promise<T> {
    this.activeOperations += 1;
    try {
      return await this.executePreparedDeleteCoordinated(args);
    } finally {
      this.activeOperations -= 1;
    }
  }

  async executePreparedDeleteCoordinated<T>({
    operationKey, versionClaimKey, fingerprint, versionFingerprint, principalNamespace, prepare, findTask, removeTask,
    authorizeReplay,
  }: CanonicalTaskPreparedDeleteCoordination<T>): Promise<T> {
    this.assertWriterEnabled();
    this.assertConfigured();
    await this.assertWriter();

    const existing = await this.pool!.query(
      `SELECT fingerprint, state, result_json, authorization_snapshot
       FROM canonical_task_operations
       WHERE scope = 'task-delete' AND operation_key = $1`,
      [operationKey],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.fingerprint !== fingerprint) {
        throw canonicalTaskOperationError('idempotency_conflict', 'Idempotency key was reused with different input', 409);
      }
      if (row.state === 'completed') {
        if (typeof authorizeReplay !== 'function') {
          throw canonicalTaskOperationError(
            'canonical_task_authorization_snapshot_unavailable',
            'Completed Canonical Task delete operation cannot be replayed without authorization revalidation',
            503,
          );
        }
        await authorizeReplay(row.authorization_snapshot, row.result_json as T);
        return row.result_json;
      }
      if (row.state !== 'prepared') {
        throw canonicalTaskOperationError('canonical_task_operation_in_progress', 'Canonical Task delete operation is already in progress', 409);
      }
      return this.completePreparedDelete({ operationKey, versionClaimKey, row, findTask, removeTask, authorizeReplay });
    }

    const versionClaim = await this.pool!.query(
      `SELECT authorization_snapshot
       FROM canonical_task_operations
       WHERE scope = 'task-version' AND operation_key = $1`,
      [versionClaimKey],
    );
    if (versionClaim.rowCount && versionClaim.rows[0]?.authorization_snapshot?.principal_namespace === principalNamespace) {
      throw canonicalTaskOperationError('version_conflict', 'Task version was already claimed by another operation', 409);
    }

    const prepared = await prepare();
    const authorizationSnapshot = { ...prepared.authorizationSnapshot, principal_namespace: principalNamespace };
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await this.assertWriter(client);
      const claimed = await client.query(
        `INSERT INTO canonical_task_operations (
            scope, operation_key, fingerprint, state, writer_token,
            result_json, authorization_snapshot, recovery_checkpoint
         ) VALUES ('task-version', $1, $2, 'prepared', $3, $4::jsonb, $5::jsonb, $6::jsonb)
         ON CONFLICT (scope, operation_key) DO NOTHING
         RETURNING id`,
        [
          versionClaimKey,
          versionFingerprint,
          this.writerToken,
          JSON.stringify(prepared.result),
          JSON.stringify(authorizationSnapshot),
          JSON.stringify({ phase: 'prepared', task_present: true }),
        ],
      );
      if (!claimed.rowCount) {
        throw canonicalTaskOperationError('version_conflict', 'Task version was already claimed by another operation', 409);
      }
      const intent = await client.query(
        `INSERT INTO canonical_task_operations (
            scope, operation_key, fingerprint, state, writer_token,
            result_json, authorization_snapshot, recovery_checkpoint
         ) VALUES ('task-delete', $1, $2, 'prepared', $3, $4::jsonb, $5::jsonb, $6::jsonb)
         ON CONFLICT (scope, operation_key) DO NOTHING
         RETURNING id`,
        [
          operationKey,
          fingerprint,
          this.writerToken,
          JSON.stringify(prepared.result),
          JSON.stringify(authorizationSnapshot),
          JSON.stringify({ phase: 'prepared', task_present: true, version_claim_key: versionClaimKey }),
        ],
      );
      if (!intent.rowCount) {
        throw canonicalTaskOperationError('canonical_task_operation_in_progress', 'Canonical Task delete operation is already in progress', 409);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }

    return this.completePreparedDelete({
      operationKey,
      versionClaimKey,
      row: { fingerprint, result_json: prepared.result, authorization_snapshot: authorizationSnapshot },
      findTask,
      removeTask,
      authorizeReplay,
    });
  }

  async completePreparedDelete<T>({ operationKey, versionClaimKey, row, findTask, removeTask, authorizeReplay }: {
    operationKey: string;
    versionClaimKey: string;
    row: { fingerprint: string; result_json: unknown; authorization_snapshot?: unknown };
    findTask: () => Promise<unknown>;
    removeTask: (task: any) => Promise<void>;
    authorizeReplay?: (authorizationSnapshot: JsonRecord, result: T) => Promise<void>;
  }): Promise<T> {
    await this.assertWriter();
    const authorizationSnapshot = row.authorization_snapshot;
    const snapshotRecord = authorizationSnapshot && typeof authorizationSnapshot === 'object'
      && !Array.isArray(authorizationSnapshot)
      ? authorizationSnapshot as JsonRecord
      : null;
    if (!snapshotRecord || !snapshotRecord.task || typeof snapshotRecord.task !== 'object'
      || Array.isArray(snapshotRecord.task)) {
      throw canonicalTaskOperationError(
        'canonical_task_authorization_snapshot_unavailable',
        'Prepared Canonical Task delete operation has no authorization snapshot',
        503,
      );
    }
    const task = await findTask();
    if (task) {
      await removeTask(task);
    } else {
      if (typeof authorizeReplay !== 'function') {
        throw canonicalTaskOperationError(
          'canonical_task_authorization_snapshot_unavailable',
          'Prepared Canonical Task delete operation cannot be resumed without authorization revalidation',
          503,
        );
      }
      await authorizeReplay(authorizationSnapshot as JsonRecord, row.result_json as T);
    }

    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await this.assertWriter(client);
      const completed = await client.query(
        `UPDATE canonical_task_operations
         SET state = 'completed', writer_token = $3,
             recovery_checkpoint = $4::jsonb, error_json = NULL, updated_at = NOW()
         WHERE scope = 'task-delete' AND operation_key = $1
           AND fingerprint = $2 AND state = 'prepared'`,
        [
          operationKey,
          row.fingerprint,
          this.writerToken,
          JSON.stringify({ phase: 'completed', task_present: false, version_claim_key: versionClaimKey }),
        ],
      );
      if (!completed.rowCount) {
        const replay = await client.query(
          `SELECT fingerprint, state, result_json, authorization_snapshot
           FROM canonical_task_operations
           WHERE scope = 'task-delete' AND operation_key = $1 FOR UPDATE`,
          [operationKey],
        );
        if (replay.rows[0]?.fingerprint !== row.fingerprint || replay.rows[0]?.state !== 'completed') {
          throw canonicalTaskOperationError('canonical_task_operation_in_progress', 'Canonical Task delete completion could not be claimed', 409);
        }
        if (typeof authorizeReplay !== 'function') {
          throw canonicalTaskOperationError(
            'canonical_task_authorization_snapshot_unavailable',
            'Completed Canonical Task delete operation cannot be replayed without authorization revalidation',
            503,
          );
        }
        const replaySnapshot = replay.rows[0].authorization_snapshot;
        if (!replaySnapshot || typeof replaySnapshot !== 'object' || Array.isArray(replaySnapshot)) {
          throw canonicalTaskOperationError(
            'canonical_task_authorization_snapshot_unavailable',
            'Completed Canonical Task delete operation cannot be replayed without authorization revalidation',
            503,
          );
        }
        await authorizeReplay(replaySnapshot as JsonRecord, replay.rows[0].result_json as T);
        await client.query('COMMIT');
        return replay.rows[0].result_json;
      }
      await client.query(
        `UPDATE canonical_task_operations
         SET state = 'completed', writer_token = $2,
             recovery_checkpoint = $3::jsonb, error_json = NULL, updated_at = NOW()
         WHERE scope = 'task-version' AND operation_key = $1 AND state = 'prepared'`,
        [
          versionClaimKey,
          this.writerToken,
          JSON.stringify({ phase: 'completed', task_present: false, delete_operation_key: operationKey }),
        ],
      );
      await client.query('COMMIT');
      return row.result_json as T;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }
}

export interface CanonicalTaskCoordinatedRequest<T> {
  scope: string;
  operationKey: string;
  fingerprint: string;
  recover?: (() => Promise<{ recovered: boolean; result?: T }>) | null;
  projectResult?: (value: T) => unknown;
  run: () => Promise<T>;
}

export interface CanonicalTaskPreparedDeleteCoordination<T> {
  operationKey: string;
  versionClaimKey: string;
  fingerprint: string;
  versionFingerprint: string;
  principalNamespace: string;
  prepare: () => Promise<{ result: T; authorizationSnapshot?: JsonRecord; task?: unknown }>;
  findTask: () => Promise<unknown>;
  removeTask: (task: any) => Promise<void>;
  /** Reauthorize a completed or already-applied delete from its durable snapshot. */
  authorizeReplay?: (authorizationSnapshot: JsonRecord, result: T) => Promise<void>;
}

export class CanonicalTaskReadinessError extends Error {
  readonly code: string;
  readonly status = 503;
  details?: JsonRecord;

  constructor(code = 'canonical_task_mutation_not_ready', message = 'Canonical Task mutation is not ready') {
    super(message);
    this.name = 'CanonicalTaskReadinessError';
    this.code = code;
  }
}

export type CanonicalTaskSourceHeadRebindGuard = (input: { fromHead?: string | null; toHead?: string | null }) => Promise<{
  allowed: boolean;
  reason?: string;
  changedPaths?: string[];
  changedPackages?: string[];
  error?: string;
}>;

interface CanonicalTaskReadinessLogger {
  warn?(message: string): void;
}

/**
 * Opens Canonical Task mutation only while the persisted readiness row was
 * blessed for this release: the same writer, manifest, schema and source head.
 */
export class CanonicalTaskReadiness {
  readonly operationRepository: CanonicalTaskOperationRepository | null;
  readonly expected: { manifestHash: string | null; schemaVersion: string | null; sourceHead: string | null };
  readonly sourceHeadRebindGuard: CanonicalTaskSourceHeadRebindGuard | null;
  readonly logger: CanonicalTaskReadinessLogger | null;
  ready = false;
  reason: string | null = 'readiness_not_verified';
  evidence: JsonRecord | null = null;

  constructor({
    operationRepository = null,
    manifestHash = null,
    schemaVersion = null,
    sourceHead = null,
    sourceHeadRebindGuard = null,
    logger = console,
  }: {
    operationRepository?: CanonicalTaskOperationRepository | null;
    manifestHash?: string | null;
    schemaVersion?: string | null;
    sourceHead?: string | null;
    sourceHeadRebindGuard?: CanonicalTaskSourceHeadRebindGuard | null;
    logger?: CanonicalTaskReadinessLogger | null;
  } = {}) {
    this.operationRepository = operationRepository;
    this.expected = { manifestHash, schemaVersion, sourceHead };
    this.sourceHeadRebindGuard = sourceHeadRebindGuard;
    this.logger = logger;
  }

  open(evidence: JsonRecord | null = null): void {
    this.ready = true;
    this.reason = null;
    this.evidence = evidence;
  }

  close(reason = 'readiness_disabled'): void {
    this.ready = false;
    this.reason = reason;
    this.evidence = null;
  }

  matches(row: CanonicalTaskReadinessRow | null): boolean {
    return Boolean(
      row?.ready
      && row.writer_token === this.operationRepository?.writerToken
      && row.manifest_hash === this.expected.manifestHash
      && row.schema_version === this.expected.schemaVersion
      && row.source_head === this.expected.sourceHead
      && row.evidence_hash,
    );
  }

  async refresh({ allowWriterRebind = false } = {}): Promise<{ ready: boolean; reason?: string | null; evidence?: JsonRecord | null }> {
    const row = await this.operationRepository!.reconcileReadiness({
      manifestHash: this.expected.manifestHash,
      schemaVersion: this.expected.schemaVersion,
      sourceHead: this.expected.sourceHead,
      allowWriterRebind,
    });
    if (!this.matches(row)) {
      this.close(row?.ready ? 'persisted_readiness_mismatch' : (row?.reason || 'persisted_readiness_missing'));
      return { ready: false, reason: this.reason };
    }
    this.open({ evidence_hash: row!.evidence_hash, evidence_path: row!.evidence_path, updated_at: row!.updated_at });
    return { ready: true, evidence: this.evidence };
  }

  // Readiness rows are blessed for one source_head. When a deploy restarts the
  // process on a newer HEAD, mutation stays fail-closed unless the guard proves
  // that nothing Canonical-Task-relevant changed between the two heads.
  async attemptSourceHeadRebind(): Promise<boolean> {
    if (!this.sourceHeadRebindGuard || typeof this.operationRepository?.rebindReadinessSourceHead !== 'function') return false;
    const row = await this.operationRepository.readReadiness();
    const rebindCandidate = Boolean(
      row?.ready
      && row.manifest_hash === this.expected.manifestHash
      && row.schema_version === this.expected.schemaVersion
      && row.evidence_hash
      && row.source_head
      && row.source_head !== this.expected.sourceHead,
    );
    if (!rebindCandidate) return false;
    const verdict = await this.sourceHeadRebindGuard({ fromHead: row!.source_head, toHead: this.expected.sourceHead });
    if (!verdict?.allowed) {
      const changed = [...(verdict?.changedPaths ?? []), ...(verdict?.changedPackages ?? [])];
      this.logger?.warn?.(
        `[canonical-task] source_head rebind refused (${verdict?.reason || 'unknown'}): `
        + `${row!.source_head} -> ${this.expected.sourceHead}`
        + (changed.length ? ` changed=${changed.join(',')}` : ''),
      );
      return false;
    }
    await this.operationRepository.rebindReadinessSourceHead({
      manifestHash: this.expected.manifestHash,
      schemaVersion: this.expected.schemaVersion,
      fromHead: row!.source_head,
      toHead: this.expected.sourceHead,
    });
    this.logger?.warn?.(
      `[canonical-task] readiness source_head rebound after guarded diff check: ${row!.source_head} -> ${this.expected.sourceHead}`,
    );
    return true;
  }

  async initialize(): Promise<{ ready: boolean; reason?: string | null; evidence?: JsonRecord | null; error?: unknown }> {
    this.close('readiness_not_verified');
    if (!this.operationRepository) {
      this.close('coordination_repository_unavailable');
      return { ready: false, reason: this.reason };
    }
    try {
      await this.operationRepository.claimWriter({ sourceHead: this.expected.sourceHead });
      const result = await this.refresh({ allowWriterRebind: true });
      if (result.ready || this.reason !== 'persisted_readiness_mismatch') return result;
      if (await this.attemptSourceHeadRebind()) return await this.refresh({ allowWriterRebind: true });
      return result;
    } catch (error: any) {
      this.close(error?.code || 'readiness_reconcile_failed');
      return { ready: false, reason: this.reason, error };
    }
  }

  async assertMutationReady(): Promise<void> {
    try {
      await this.refresh({ allowWriterRebind: false });
    } catch (error: any) {
      this.close(error?.code || 'readiness_reconcile_failed');
    }
    if (!this.ready) {
      const error = new CanonicalTaskReadinessError();
      error.details = { reason: this.reason };
      throw error;
    }
  }
}

type ExecFile = (file: string, args: string[]) => Promise<{ stdout: string | Buffer }>;

export interface CanonicalTaskSourceHeadGuardOptions {
  repoDir?: string | null;
  /** Repository paths whose change can alter Canonical Task mutation semantics. Tenant configuration. */
  guardedPaths: string[];
  /**
   * Installed packages whose locked version can alter Canonical Task mutation
   * semantics (for example this package). A change of the locked entry blocks
   * the rebind even when no guarded path changed.
   */
  guardedPackages?: string[];
  lockfilePath?: string;
  execFile?: ExecFile;
}

const execFileAsync = promisify(execFileCallback) as unknown as ExecFile;

/**
 * Decides whether readiness blessed for one source head may follow a deploy
 * to another head. It allows the rebind only when git proves that no guarded
 * path and no guarded package changed between them; anything unknown stays
 * fail-closed.
 */
export function createCanonicalTaskSourceHeadGuard({
  repoDir,
  guardedPaths,
  guardedPackages = [],
  lockfilePath = 'package-lock.json',
  execFile = execFileAsync,
}: CanonicalTaskSourceHeadGuardOptions): CanonicalTaskSourceHeadRebindGuard {
  if (!Array.isArray(guardedPaths) || guardedPaths.length === 0 || guardedPaths.some((path) => typeof path !== 'string' || !path)) {
    throw new Error('Canonical Task source head guard requires guarded paths');
  }
  const lockedEntry = async (head: string, name: string) => {
    try {
      const text = String((await execFile('git', ['-C', repoDir!, 'show', `${head}:${lockfilePath}`])).stdout);
      const lock = JSON.parse(text);
      const entry = lock?.packages?.[`node_modules/${name}`] ?? lock?.dependencies?.[name] ?? null;
      return entry ? { version: entry.version ?? null, resolved: entry.resolved ?? null, integrity: entry.integrity ?? null } : null;
    } catch {
      return null;
    }
  };
  return async function canRebindSourceHead({ fromHead, toHead } = {}) {
    if (!repoDir) return { allowed: false, reason: 'source_head_guard_repo_missing' };
    if (!fromHead || !toHead) return { allowed: false, reason: 'source_head_guard_head_missing' };
    if (fromHead === toHead) return { allowed: true, changedPaths: [] };
    try {
      const { stdout } = await execFile('git', ['-C', repoDir, 'diff', '--name-only', `${fromHead}..${toHead}`, '--', ...guardedPaths]);
      const changedPaths = String(stdout).split('\n').map((line) => line.trim()).filter(Boolean);
      if (changedPaths.length > 0) return { allowed: false, reason: 'canonical_task_paths_changed', changedPaths };
      const changedPackages: string[] = [];
      for (const name of guardedPackages) {
        const [before, after] = [await lockedEntry(fromHead, name), await lockedEntry(toHead, name)];
        if (!before || !after) {
          return {
            allowed: false,
            reason: 'canonical_task_package_lock_unreadable',
            changedPaths: [],
            changedPackages: [name],
          };
        }
        if (JSON.stringify(before) !== JSON.stringify(after)) changedPackages.push(name);
      }
      if (changedPackages.length > 0) {
        return { allowed: false, reason: 'canonical_task_packages_changed', changedPaths: [], changedPackages };
      }
      return { allowed: true, changedPaths: [] };
    } catch (error: any) {
      // Unknown commits (shallow clone, rewritten history) or an unreadable
      // lockfile must stay fail-closed.
      return { allowed: false, reason: 'source_head_diff_failed', error: error?.message || String(error) };
    }
  };
}
