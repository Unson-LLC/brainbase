import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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
        expect(repository.listRuns({ limit: null }).map((run) => run.id)).toEqual([
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

        expect(repository.listRuns({ limit: null }).map((run) => run.id)).toEqual([
            'run-outer',
            'run-inner'
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
});
