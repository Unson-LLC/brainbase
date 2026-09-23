import {
  ConstraintError,
  type ConstraintAuthorizationContext,
  type ConstraintExceptionQuery,
  type ConstraintExceptionRecord,
  validateConstraintExceptionRecord,
} from './constraint-resolution.js';
import type { ConstraintExceptionStore } from './foundation-constraint-store.js';
import { mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';

/** The shared SSOT evidence area used for rich exception metadata. */
export const CONSTRAINT_EXCEPTION_EVIDENCE_PATH = 'evidence/constraint-exceptions.jsonl' as const;

export interface AtomicConstraintExceptionStoreOptions {
  readonly dataDir: string;
  readonly evidencePath?: string;
}

/**
 * Durable exception evidence stored through the common SSOT transaction
 * writer.  Constraint definitions remain in GraphFoundationRevisionStore;
 * this evidence adapter only supplies the approval metadata missing from the
 * shared ontology reference.  Authorization is intentionally performed by
 * ConstraintService's injected provider before this storage port is called.
 */
export class AtomicConstraintExceptionStore implements ConstraintExceptionStore {
  private readonly dataDir: string;
  private readonly evidencePath: string;

  constructor(options: AtomicConstraintExceptionStoreOptions) {
    if (!options.dataDir) {
      throw new ConstraintError('constraint_store_unavailable', 'exception evidence dataDir is required', 503);
    }
    this.dataDir = options.dataDir;
    this.evidencePath = options.evidencePath ?? CONSTRAINT_EXCEPTION_EVIDENCE_PATH;
  }

  async append(
    exception: ConstraintExceptionRecord,
    _context: ConstraintAuthorizationContext,
  ): Promise<ConstraintExceptionRecord> {
    validateConstraintExceptionRecord(exception);
    try {
      const stored = await mutatePersonalOsWithSidecar(this.dataDir, this.evidencePath, async (current, existingContent) => {
        const records = parseEvidence(existingContent ?? '');
        if (records.some((record) => record.id === exception.id)) {
          throw new ConstraintError('revision_conflict', 'exception id already exists', 409, { id: exception.id });
        }
        const next = [...records, clone(exception)].sort((left, right) => left.id.localeCompare(right.id, 'en'));
        return {
          next: current,
          sidecarContent: serializeEvidence(next),
          result: clone(exception),
        };
      });
      return stored;
    } catch (error) {
      if (error instanceof ConstraintError) throw error;
      throw new ConstraintError('constraint_store_unavailable', 'exception evidence could not be persisted', 503, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async list(
    query: ConstraintExceptionQuery,
    _context: ConstraintAuthorizationContext,
  ): Promise<readonly ConstraintExceptionRecord[]> {
    let content: string | undefined;
    try {
      content = await readPersonalOsSidecar(this.dataDir, this.evidencePath);
    } catch (error) {
      if (error instanceof ConstraintError) throw error;
      throw new ConstraintError('constraint_store_unavailable', 'exception evidence could not be read', 503, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (content === undefined) return [];
    return parseEvidence(content)
      .filter((record) => query.constraintId === undefined || record.constraintRef.id === query.constraintId)
      .filter((record) => query.constraintRevision === undefined || record.constraintRef.revision === query.constraintRevision)
      .map(clone);
  }
}

export function createAtomicConstraintExceptionStore(
  options: AtomicConstraintExceptionStoreOptions,
): ConstraintExceptionStore {
  return new AtomicConstraintExceptionStore(options);
}

function parseEvidence(content: string): ConstraintExceptionRecord[] {
  const records: ConstraintExceptionRecord[] = [];
  for (const [index, line] of content.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new ConstraintError('constraint_store_corrupt', `exception evidence line ${index + 1} is not valid JSON`, 500, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      validateConstraintExceptionRecord(parsed as ConstraintExceptionRecord);
    } catch (error) {
      if (error instanceof ConstraintError) throw error;
      throw new ConstraintError('constraint_store_corrupt', `exception evidence line ${index + 1} is invalid`, 500, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    records.push(clone(parsed as ConstraintExceptionRecord));
  }
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new ConstraintError('constraint_store_corrupt', 'exception evidence contains duplicate ids', 500, { id: record.id });
    }
    ids.add(record.id);
  }
  return records;
}

function serializeEvidence(records: readonly ConstraintExceptionRecord[]): string {
  return records.length === 0 ? '' : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
