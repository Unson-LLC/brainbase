import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalTaskOperationRepository,
  CanonicalTaskReadiness,
  createCanonicalTaskSourceHeadGuard,
  type CanonicalTaskReadinessRow,
} from '../src/canonical-task-operations.js';

describe('Canonical Task operation and readiness adapters', () => {
  it('keeps mutation coordination disabled until the host explicitly enables the writer', async () => {
    const operations = new CanonicalTaskOperationRepository({ writerToken: 'writer-token' });

    await expect(operations.claimWriter({ sourceHead: 'head' })).rejects.toMatchObject({
      code: 'canonical_task_writer_disabled',
    });
    expect(() => operations.assertWriterEnabled()).toThrow(expect.objectContaining({
      code: 'canonical_task_writer_disabled',
    }));
  });

  it('replays a completed operation and rejects an idempotency fingerprint conflict', async () => {
    let operationInserted = false;
    const completedResult = { task_id: 'task-1', task_version: 2 };
    const clientQuery = vi.fn(async (text: string) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT 1 FROM canonical_task_writer')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO canonical_task_operations')) {
        if (operationInserted) return { rows: [], rowCount: 0 };
        operationInserted = true;
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      if (text.includes('SELECT fingerprint, state, result_json, writer_token')) {
        return {
          rows: [{ fingerprint: 'fingerprint-1', state: 'completed', result_json: completedResult, writer_token: 'writer-token' }],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected operation client query: ${text}`);
    });
    const poolQuery = vi.fn(async (text: string) => {
      if (text.includes('SELECT 1 FROM canonical_task_writer')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      if (text.includes("SET state = 'completed'")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected operation pool query: ${text}`);
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    };
    const operations = new CanonicalTaskOperationRepository({
      pool,
      writerToken: 'writer-token',
      processIdentity: { pid: 42 },
      writerEnabled: true,
    });
    const run = vi.fn().mockResolvedValue(completedResult);

    await expect(operations.execute({
      scope: 'task',
      operationKey: 'operation-1',
      fingerprint: 'fingerprint-1',
      run,
    })).resolves.toEqual(completedResult);
    await expect(operations.execute({
      scope: 'task',
      operationKey: 'operation-1',
      fingerprint: 'fingerprint-1',
      run,
    })).resolves.toEqual(completedResult);
    expect(run).toHaveBeenCalledTimes(1);

    await expect(operations.execute({
      scope: 'task',
      operationKey: 'operation-1',
      fingerprint: 'fingerprint-2',
      run,
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });

  it('requires persisted readiness to match writer, manifest, schema, source head, and evidence', async () => {
    const row: CanonicalTaskReadinessRow = {
      ready: true,
      writer_token: 'writer-token',
      manifest_hash: 'manifest-hash',
      schema_version: '1.0.0',
      source_head: 'head',
      evidence_hash: 'evidence-hash',
      evidence_path: '/tmp/evidence.json',
      reason: null,
      updated_at: '2026-10-18T00:00:00Z',
    };
    const operationRepository = {
      writerToken: 'writer-token',
      async reconcileReadiness(): Promise<CanonicalTaskReadinessRow> { return row; },
      async readReadiness(): Promise<CanonicalTaskReadinessRow> { return row; },
    } as unknown as CanonicalTaskOperationRepository;
    const readiness = new CanonicalTaskReadiness({
      operationRepository,
      manifestHash: 'manifest-hash',
      schemaVersion: '1.0.0',
      sourceHead: 'head',
      logger: null,
    });

    await expect(readiness.refresh()).resolves.toMatchObject({ ready: true });
    expect(readiness.ready).toBe(true);

    const mismatched = new CanonicalTaskReadiness({
      operationRepository,
      manifestHash: 'other-manifest',
      schemaVersion: '1.0.0',
      sourceHead: 'head',
      logger: null,
    });
    await expect(mismatched.refresh()).resolves.toMatchObject({ ready: false, reason: 'persisted_readiness_mismatch' });
    await expect(mismatched.assertMutationReady()).rejects.toMatchObject({
      code: 'canonical_task_mutation_not_ready',
    });
  });

  it('fails closed when a guarded path or locked package changed between releases', async () => {
    const execFile = async (_file: string, args: string[]) => {
      if (args[2] === 'diff') return { stdout: args.includes('src/canonical-task-service.ts') ? 'src/canonical-task-service.ts\n' : '' };
      if (args[2] === 'show') {
        return { stdout: JSON.stringify({ packages: { 'node_modules/@unson/brainbase-mcp': { version: args[0] === 'git' ? '0.44.0' : '0.44.0' } } }) };
      }
      throw new Error('unexpected git command');
    };
    const guard = createCanonicalTaskSourceHeadGuard({
      repoDir: '/repo',
      guardedPaths: ['src/canonical-task-service.ts', 'src/canonical-task-postgres.ts'],
      guardedPackages: ['@unson/brainbase-mcp'],
      execFile,
    });

    await expect(guard({ fromHead: 'old', toHead: 'new' })).resolves.toMatchObject({
      allowed: false,
      reason: 'canonical_task_paths_changed',
      changedPaths: ['src/canonical-task-service.ts'],
    });

    const packageGuard = createCanonicalTaskSourceHeadGuard({
      repoDir: '/repo',
      guardedPaths: ['src/canonical-task-service.ts'],
      guardedPackages: ['@unson/brainbase-mcp'],
      execFile: async (_file, args) => {
        if (args[2] === 'diff') return { stdout: '' };
        return { stdout: JSON.stringify({ packages: { 'node_modules/@unson/brainbase-mcp': { version: args.includes('old:package-lock.json') ? '0.43.0' : '0.44.0' } } }) };
      },
    });
    await expect(packageGuard({ fromHead: 'old', toHead: 'new' })).resolves.toMatchObject({
      allowed: false,
      reason: 'canonical_task_packages_changed',
      changedPackages: ['@unson/brainbase-mcp'],
    });
  });

  it('fails closed when a guarded package lock entry is unreadable or missing on either release', async () => {
    const unreadableGuard = createCanonicalTaskSourceHeadGuard({
      repoDir: '/repo',
      guardedPaths: ['src/canonical-task-service.ts'],
      guardedPackages: ['@unson/brainbase-mcp'],
      execFile: async (_file, args) => {
        if (args[2] === 'diff') return { stdout: '' };
        throw new Error('lockfile unavailable');
      },
    });
    await expect(unreadableGuard({ fromHead: 'old', toHead: 'new' })).resolves.toMatchObject({
      allowed: false,
      reason: 'canonical_task_package_lock_unreadable',
      changedPackages: ['@unson/brainbase-mcp'],
    });

    const missingEntryGuard = createCanonicalTaskSourceHeadGuard({
      repoDir: '/repo',
      guardedPaths: ['src/canonical-task-service.ts'],
      guardedPackages: ['@unson/brainbase-mcp'],
      execFile: async (_file, args) => {
        if (args[2] === 'diff') return { stdout: '' };
        if (args[3] === 'old:package-lock.json') return { stdout: JSON.stringify({ packages: {} }) };
        return { stdout: JSON.stringify({ packages: { 'node_modules/@unson/brainbase-mcp': { version: '0.44.0' } } }) };
      },
    });
    await expect(missingEntryGuard({ fromHead: 'old', toHead: 'new' })).resolves.toMatchObject({
      allowed: false,
      reason: 'canonical_task_package_lock_unreadable',
      changedPackages: ['@unson/brainbase-mcp'],
    });
  });
});
