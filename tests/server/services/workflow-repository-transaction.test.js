import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    InMemoryWorkflowRepository,
    JsonFileWorkflowRepository
} from '../../../server/services/workflow/workflow-repository.js';

const tempDirs = [];

function createTempLedger() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-workflow-transaction-'));
    tempDirs.push(dir);
    return {
        dir,
        filePath: path.join(dir, 'workflow-ledger.json')
    };
}

function createRun(id) {
    return {
        id,
        workflow_id: 'workflow-1',
        workspace_id: 'default',
        project_id: 'project-1'
    };
}

function createDeferred() {
    let resolve;
    const promise = new Promise((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

describe('WorkflowRepository transaction boundary', () => {
    it('unrelated writers serialize instead of overlapping shared-ledger mutation', async () => {
        const repository = new InMemoryWorkflowRepository();
        const firstEntered = createDeferred();
        const releaseFirst = createDeferred();
        const order = [];

        const first = repository.transaction(async () => {
            order.push('first:start');
            firstEntered.resolve();
            await releaseFirst.promise;
            repository.createRun(createRun('run-first'));
            order.push('first:end');
        });
        await firstEntered.promise;

        const second = repository.transaction(async () => {
            order.push('second:start');
            repository.createRun(createRun('run-second'));
            order.push('second:end');
        });
        await Promise.resolve();

        expect(order).toEqual(['first:start']);
        releaseFirst.resolve();
        await Promise.all([first, second]);

        expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
        expect(repository.listRuns({ limit: null }).map((run) => run.id).sort()).toEqual([
            'run-first',
            'run-second'
        ]);
    });

    it('same-owner nested transactions join without deadlocking', async () => {
        const repository = new InMemoryWorkflowRepository();

        await repository.transaction(async () => {
            repository.createRun(createRun('run-outer'));
            await repository.transaction(async () => {
                repository.createRun(createRun('run-inner'));
            });
        });

        expect(repository.listRuns({ limit: null }).map((run) => run.id).sort()).toEqual([
            'run-inner',
            'run-outer'
        ]);
    });

    it('keeps the outer transaction rollback-only when a nested failure is caught', async () => {
        const repository = new InMemoryWorkflowRepository();

        await expect(repository.transaction(async () => {
            repository.createRun(createRun('run-before-failure'));
            try {
                await repository.transaction(async () => {
                    repository.createRun(createRun('run-nested-failure'));
                    throw new Error('nested write failed');
                });
            } catch {
                // The caller may catch the nested error, but cannot commit partial state.
            }
            repository.createRun(createRun('run-after-failure'));
        })).rejects.toThrow(/rollback-only/i);

        expect(repository.listRuns({ limit: null })).toEqual([]);
    });

    it('rejects Json ledger mutation before memory or disk changes outside a transaction', () => {
        const { filePath } = createTempLedger();
        const repository = new JsonFileWorkflowRepository({ filePath });
        const beforeMemory = repository.listRuns({ limit: null });
        const beforeDisk = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

        expect(() => repository.createRun(createRun('run-outside-transaction')))
            .toThrow(/transaction/i);

        expect(repository.listRuns({ limit: null })).toEqual(beforeMemory);
        expect(fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null).toBe(beforeDisk);
    });

    it('serializes Json writers across repository instances and preserves both commits', async () => {
        const { filePath } = createTempLedger();
        const firstRepository = new JsonFileWorkflowRepository({ filePath });
        const secondRepository = new JsonFileWorkflowRepository({ filePath });
        const firstEntered = createDeferred();
        const releaseFirst = createDeferred();
        let secondEntered = false;

        const first = firstRepository.transaction(async () => {
            firstRepository.createRun(createRun('run-first'));
            firstEntered.resolve();
            await releaseFirst.promise;
        });
        await firstEntered.promise;

        const second = secondRepository.transaction(async () => {
            secondEntered = true;
            secondRepository.createRun(createRun('run-second'));
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(secondEntered).toBe(false);
        releaseFirst.resolve();
        await Promise.all([first, second]);

        const reloaded = new JsonFileWorkflowRepository({ filePath });
        expect(reloaded.listRuns({ limit: null }).map((run) => run.id).sort()).toEqual([
            'run-first',
            'run-second'
        ]);
    });

    it('writes a Json ledger once for a transaction with multiple mutations', async () => {
        const { filePath } = createTempLedger();

        class CountingJsonRepository extends JsonFileWorkflowRepository {
            writeCount = 0;

            _writeLedgerFile() {
                this.writeCount += 1;
                return super._writeLedgerFile();
            }
        }

        const repository = new CountingJsonRepository({ filePath });
        await repository.transaction(async () => {
            repository.createRun(createRun('run-one'));
            repository.createRun(createRun('run-two'));
            repository.writeAuditLog({ action: 'transaction.test' });
        });

        expect(repository.writeCount).toBe(1);
    });

    it('does not reacquire the Json lease for same-owner nested transactions', async () => {
        const { filePath } = createTempLedger();

        class CountingLeaseRepository extends JsonFileWorkflowRepository {
            leaseCount = 0;

            _createTransactionLease(ownerId) {
                this.leaseCount += 1;
                return super._createTransactionLease(ownerId);
            }
        }

        const repository = new CountingLeaseRepository({ filePath });
        await repository.transaction(async () => {
            repository.createRun(createRun('run-outer-json'));
            await repository.transaction(async () => {
                repository.createRun(createRun('run-inner-json'));
            });
        });

        expect(repository.leaseCount).toBe(1);
    });

    it('never lets a failed Json rollback overwrite another committed transaction', async () => {
        const { filePath } = createTempLedger();
        const failingRepository = new JsonFileWorkflowRepository({ filePath });
        const committingRepository = new JsonFileWorkflowRepository({ filePath });
        const failingEntered = createDeferred();
        const releaseFailure = createDeferred();

        const failing = failingRepository.transaction(async () => {
            failingRepository.createRun(createRun('run-rolled-back'));
            failingEntered.resolve();
            await releaseFailure.promise;
            throw new Error('rollback fixture');
        });
        await failingEntered.promise;
        const committing = committingRepository.transaction(async () => {
            committingRepository.createRun(createRun('run-committed'));
        });

        releaseFailure.resolve();
        await expect(failing).rejects.toThrow('rollback fixture');
        await committing;

        const reloaded = new JsonFileWorkflowRepository({ filePath });
        expect(reloaded.listRuns({ limit: null }).map((run) => run.id)).toEqual(['run-committed']);
    });

    it('keeps pending ledger memory intact while identity locks are acquired and released', async () => {
        const { filePath } = createTempLedger();
        const repository = new JsonFileWorkflowRepository({ filePath });

        await repository.transaction(async () => {
            repository.createRun(createRun('run-before-identity-lock'));
            const lock = repository.acquireWorkflowLock({
                workspace_id: 'default',
                workflow_id: 'workflow-1',
                locked_by: 'identity-owner'
            });
            expect(lock).not.toBeNull();
            repository.releaseWorkflowLock({
                workspace_id: 'default',
                workflow_id: 'workflow-1',
                locked_by: 'identity-owner'
            });
            expect(repository.getRun('run-before-identity-lock')).not.toBeNull();
        });

        expect(new JsonFileWorkflowRepository({ filePath }).getRun('run-before-identity-lock')).not.toBeNull();
    });

    it('expired identity lock owned by a live local process cannot be stolen', () => {
        const { filePath } = createTempLedger();
        const ownerRepository = new JsonFileWorkflowRepository({ filePath });
        const competingRepository = new JsonFileWorkflowRepository({ filePath });

        expect(ownerRepository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'live-owner',
            ttl_ms: -1
        })).not.toBeNull();

        expect(competingRepository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'competing-owner',
            ttl_ms: 60000
        })).toBeNull();
        expect(ownerRepository.releaseWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'live-owner'
        })).toBe(true);
    });

    it('stale dead-owner identity lock reclaim never deletes a fresh lock won by another repository', () => {
        const { filePath } = createTempLedger();
        const seedRepository = new JsonFileWorkflowRepository({ filePath });
        const competingRepository = new JsonFileWorkflowRepository({ filePath });
        let competingLock = null;

        class InterleavingRepository extends JsonFileWorkflowRepository {
            _quarantineWorkflowLock(lockPath) {
                const quarantinePath = super._quarantineWorkflowLock(lockPath);
                competingLock = competingRepository.acquireWorkflowLock({
                    workspace_id: 'default',
                    workflow_id: 'workflow-1',
                    locked_by: 'fresh-owner',
                    ttl_ms: 60000
                });
                return quarantinePath;
            }
        }

        expect(seedRepository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'expired-owner',
            ttl_ms: -1
        })).not.toBeNull();
        const expiredLockPath = seedRepository._workflowLockPath({
            workspace_id: 'default',
            workflow_id: 'workflow-1'
        });
        const expiredLock = JSON.parse(fs.readFileSync(expiredLockPath, 'utf8'));
        fs.writeFileSync(expiredLockPath, `${JSON.stringify({
            ...expiredLock,
            pid: 2147483647
        }, null, 2)}\n`);

        const reclaimingRepository = new InterleavingRepository({ filePath });
        const reclaimed = reclaimingRepository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'reclaiming-owner',
            ttl_ms: 60000
        });

        expect(competingLock?.locked_by).toBe('fresh-owner');
        expect(reclaimed).toBeNull();
        expect(competingRepository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'unexpected-owner',
            ttl_ms: 60000
        })).toBeNull();
        expect(competingRepository.releaseWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'fresh-owner'
        })).toBe(true);
    });

    it('identity lock release removes only the quarantined owner lock and preserves a fresh winner', () => {
        const { filePath } = createTempLedger();
        const seedRepository = new JsonFileWorkflowRepository({ filePath });
        const competingRepository = new JsonFileWorkflowRepository({ filePath });
        let competingLock = null;

        class InterleavingReleaseRepository extends JsonFileWorkflowRepository {
            _quarantineWorkflowLock(lockPath) {
                const quarantinePath = super._quarantineWorkflowLock(lockPath);
                competingLock = competingRepository.acquireWorkflowLock({
                    workspace_id: 'default',
                    workflow_id: 'workflow-1',
                    locked_by: 'fresh-after-release',
                    ttl_ms: 60000
                });
                return quarantinePath;
            }
        }

        expect(seedRepository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'releasing-owner',
            ttl_ms: 60000
        })).not.toBeNull();

        const releasingRepository = new InterleavingReleaseRepository({ filePath });
        expect(releasingRepository.releaseWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'releasing-owner'
        })).toBe(true);
        expect(competingLock?.locked_by).toBe('fresh-after-release');
        expect(seedRepository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'unexpected-owner',
            ttl_ms: 60000
        })).toBeNull();
        expect(competingRepository.releaseWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'fresh-after-release'
        })).toBe(true);
    });

    it('reclaims a stale ownerless identity-lock mutation artifact after a crashed writer', () => {
        const { filePath } = createTempLedger();
        const repository = new JsonFileWorkflowRepository({
            filePath,
            workflowLockMutationTtlMs: 1000
        });
        const lockPath = repository._workflowLockPath({
            workspace_id: 'default',
            workflow_id: 'workflow-1'
        });
        const mutationPath = `${lockPath}.mutation`;
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, `${JSON.stringify({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'crashed-owner',
            expires_at: new Date(Date.now() - 5000).toISOString()
        })}\n`);
        fs.mkdirSync(mutationPath);
        const staleAt = new Date(Date.now() - 5000);
        fs.utimesSync(mutationPath, staleAt, staleAt);

        const lock = repository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'recovered-owner',
            ttl_ms: 60000
        });

        expect(lock?.locked_by).toBe('recovered-owner');
        expect(fs.existsSync(mutationPath)).toBe(false);
    });

    it('stale mutation observer cannot replace a fresh mutation guard won by another repository', () => {
        const { filePath } = createTempLedger();
        const firstRepository = new JsonFileWorkflowRepository({
            filePath,
            workflowLockMutationTtlMs: 1000
        });
        const secondRepository = new JsonFileWorkflowRepository({
            filePath,
            workflowLockMutationTtlMs: 1000
        });
        const lockPath = firstRepository._workflowLockPath({
            workspace_id: 'default',
            workflow_id: 'workflow-1'
        });
        const mutationPath = `${lockPath}.mutation`;
        const ownerPath = path.join(mutationPath, 'owner.json');
        fs.mkdirSync(mutationPath, { recursive: true });
        fs.writeFileSync(ownerPath, `${JSON.stringify({
            owner_id: 'stale-owner',
            pid: 99999999,
            expires_at: new Date(Date.now() - 5000).toISOString()
        })}\n`);
        const staleAt = new Date(Date.now() - 5000);
        fs.utimesSync(mutationPath, staleAt, staleAt);

        const originalReadFileSync = fs.readFileSync.bind(fs);
        let interleaved = false;
        let secondGuard = null;
        const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((target, ...args) => {
            if (!interleaved && String(target) === ownerPath) {
                interleaved = true;
                secondGuard = secondRepository._acquireWorkflowLockMutation(lockPath);
                const error = new Error('observed owner disappeared');
                error.code = 'ENOENT';
                throw error;
            }
            return originalReadFileSync(target, ...args);
        });

        try {
            const firstGuard = firstRepository._acquireWorkflowLockMutation(lockPath);

            expect([firstGuard, secondGuard].filter(Boolean)).toHaveLength(1);
            expect(fs.existsSync(mutationPath)).toBe(true);
        } finally {
            readSpy.mockRestore();
        }
    });

    it('mutation guard release removes only the matching owner token', () => {
        const { filePath } = createTempLedger();
        const repository = new JsonFileWorkflowRepository({ filePath });
        const lockPath = repository._workflowLockPath({
            workspace_id: 'default',
            workflow_id: 'workflow-1'
        });
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        const mutationGuard = repository._acquireWorkflowLockMutation(lockPath);

        expect(mutationGuard).toBeTruthy();
        expect(repository._releaseWorkflowLockMutation(lockPath, {
            ...mutationGuard,
            owner_id: 'different-owner'
        })).toBe(false);
        expect(fs.existsSync(`${lockPath}.mutation`)).toBe(true);

        expect(repository._releaseWorkflowLockMutation(lockPath, mutationGuard)).toBe(true);
        expect(fs.existsSync(`${lockPath}.mutation`)).toBe(false);
    });

    it('reclaims a malformed identity lock left by a partial legacy write', () => {
        const { filePath } = createTempLedger();
        const repository = new JsonFileWorkflowRepository({ filePath });
        const lockPath = repository._workflowLockPath({
            workspace_id: 'default',
            workflow_id: 'workflow-1'
        });
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, '{"locked_by":"partial');

        const lock = repository.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'workflow-1',
            locked_by: 'recovered-owner',
            ttl_ms: 60000
        });

        expect(lock?.locked_by).toBe('recovered-owner');
        expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).locked_by).toBe('recovered-owner');
    });

    it('never steals an expired lease from a live local owner but reclaims one from a dead pid', async () => {
        const { filePath } = createTempLedger();
        const leasePath = `${filePath}.transaction-lock.json`;
        const repository = new JsonFileWorkflowRepository({
            filePath,
            leaseAcquireTimeoutMs: 30,
            leaseRetryMs: 5
        });
        fs.writeFileSync(leasePath, `${JSON.stringify({
            owner_id: 'live-owner',
            pid: process.pid,
            expires_at: new Date(Date.now() - 1000).toISOString()
        })}\n`);

        await expect(repository.transaction(async () => {})).rejects.toThrow(/lease/i);
        expect(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owner_id).toBe('live-owner');

        fs.writeFileSync(leasePath, `${JSON.stringify({
            owner_id: 'dead-owner',
            pid: 99999999,
            expires_at: new Date(Date.now() - 1000).toISOString()
        })}\n`);
        await repository.transaction(async () => {
            repository.createRun(createRun('run-after-stale-lease'));
        });

        expect(fs.existsSync(leasePath)).toBe(false);
        expect(new JsonFileWorkflowRepository({ filePath }).getRun('run-after-stale-lease')).not.toBeNull();
    });

    it('serializes concurrent stale recovery without deleting a fresh live lease', async () => {
        const { filePath } = createTempLedger();
        const leasePath = `${filePath}.transaction-lock.json`;
        fs.writeFileSync(leasePath, `${JSON.stringify({
            owner_id: 'dead-owner',
            pid: 99999999,
            expires_at: new Date(Date.now() - 1000).toISOString()
        })}\n`);
        const firstRepository = new JsonFileWorkflowRepository({
            filePath,
            leaseAcquireTimeoutMs: 1000,
            leaseRetryMs: 1
        });
        const secondRepository = new JsonFileWorkflowRepository({
            filePath,
            leaseAcquireTimeoutMs: 1000,
            leaseRetryMs: 1
        });
        const firstEntered = createDeferred();
        const releaseFirst = createDeferred();

        const first = firstRepository.transaction(async () => {
            firstRepository.createRun(createRun('run-stale-recovery-first'));
            firstEntered.resolve();
            await releaseFirst.promise;
        });
        await firstEntered.promise;
        let secondEntered = false;
        const second = secondRepository.transaction(async () => {
            secondEntered = true;
            secondRepository.createRun(createRun('run-stale-recovery-second'));
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(secondEntered).toBe(false);
        releaseFirst.resolve();
        await Promise.all([first, second]);

        expect(new JsonFileWorkflowRepository({ filePath })
            .listRuns({ limit: null })
            .map((run) => run.id)
            .sort()).toEqual([
            'run-stale-recovery-first',
            'run-stale-recovery-second'
        ]);
    });

    it('initializes seed workflows under the same cross-process lease as runtime writers', async () => {
        const { filePath } = createTempLedger();
        const repositoryModuleUrl = pathToFileURL(path.resolve(
            'server/services/workflow/workflow-repository.js'
        )).href;
        const childScript = `
            const [repositoryModuleUrl, filePath] = process.argv.slice(1);
            const { JsonFileWorkflowRepository } = await import(repositoryModuleUrl);
            const repository = new JsonFileWorkflowRepository({ filePath });
            await repository.transaction(async () => {
                repository.createRun({
                    id: 'run-concurrent-with-seed',
                    workspace_id: 'default',
                    project_id: 'general',
                    workflow_id: 'runtime-workflow',
                    status: 'running'
                });
                process.stdout.write('READY\\n');
                await new Promise((resolve) => setTimeout(resolve, 150));
            });
        `;
        const child = spawn(process.execPath, [
            '--input-type=module',
            '-e',
            childScript,
            repositoryModuleUrl,
            filePath
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let childError = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            childError += chunk;
        });
        await new Promise((resolve, reject) => {
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                if (chunk.includes('READY')) resolve();
            });
            child.once('exit', (code) => {
                if (code !== 0) reject(new Error(childError || `child exited ${code}`));
            });
        });

        const seeded = new JsonFileWorkflowRepository({
            filePath,
            leaseAcquireTimeoutMs: 2000,
            leaseRetryMs: 5,
            seedWorkflows: [{
                id: 'seed-workflow',
                workspace_id: 'default',
                project_id: 'general',
                name: 'Seed workflow'
            }]
        });
        if (child.exitCode === null) {
            await new Promise((resolve, reject) => {
                child.once('exit', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(childError || `child exited ${code}`));
                });
            });
        } else if (child.exitCode !== 0) {
            throw new Error(childError || `child exited ${child.exitCode}`);
        }
        seeded.reload();

        expect(seeded.getWorkflow('seed-workflow')).not.toBeNull();
        expect(seeded.getRun('run-concurrent-with-seed')).not.toBeNull();
    });
});
