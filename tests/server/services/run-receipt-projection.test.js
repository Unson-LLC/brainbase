import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    InMemoryWorkflowRepository,
    JsonFileWorkflowRepository
} from '../../../server/services/workflow/workflow-repository.js';

const tempDirs = [];

function receiptRun(id, effectiveAt, sourceWorkflowId = 'daily-secretary') {
    return {
        id,
        project_id: 'brainbase',
        workflow_id: `receipt-${sourceWorkflowId}`,
        created_at: effectiveAt,
        finished_at: effectiveAt,
        metadata: {
            contract_version: 'run_receipt.v1',
            run_receipt: {
                source: { type: 'mana', workflow_id: sourceWorkflowId },
                source_status: 'success',
                evidence_state: 'confirmed'
            }
        }
    };
}

afterEach(() => {
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('latest Run Receipt projection', () => {
    it('receipt update時もidentityごとのlatestを再計算する', async () => {
        const repository = new InMemoryWorkflowRepository();
        await repository.transaction(() => {
            repository.createRun(receiptRun('old', '2026-07-15T01:00:00Z'));
            repository.createRun(receiptRun('new', '2026-07-15T02:00:00Z'));
            repository.updateRun('new', { finished_at: '2026-07-15T00:00:00Z' });
        });

        expect(repository.listLatestRunReceipts().map((run) => run.id)).toEqual(['old']);
    });

    it('新しい不完全receiptが古い有効receiptを隠さない', () => {
        const repository = new InMemoryWorkflowRepository();
        const incomplete = receiptRun('incomplete', '2026-07-15T02:00:00Z');
        delete incomplete.metadata.run_receipt.evidence_state;

        repository.createRun(receiptRun('valid', '2026-07-15T01:00:00Z'));
        repository.createRun(incomplete);

        expect(repository.listLatestRunReceipts().map((run) => run.id)).toEqual(['valid']);
    });

    it('空projectionを持つ移行途中のJSON ledgerもrunsから再構築する', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-run-receipt-projection-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'workflow-ledger.json');
        fs.writeFileSync(filePath, JSON.stringify({
            schema_version: '0.1.0',
            latest_run_receipts: [],
            runs: [
                receiptRun('old', '2026-07-15T01:00:00Z'),
                receiptRun('new', '2026-07-15T02:00:00Z'),
                { id: 'ordinary', project_id: 'brainbase', workflow_id: 'ordinary' }
            ]
        }));

        const repository = new JsonFileWorkflowRepository({ filePath });

        expect(repository.listLatestRunReceipts().map((run) => run.id)).toEqual(['new']);
    });

    it('旧writerがrunsだけ更新した後もstale projectionを正本にしない', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-run-receipt-projection-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'workflow-ledger.json');
        const old = receiptRun('old', '2026-07-15T01:00:00Z');
        const newer = receiptRun('new', '2026-07-15T02:00:00Z');
        fs.writeFileSync(filePath, JSON.stringify({
            schema_version: '0.1.0',
            runs: [old, newer],
            latest_run_receipts: [old]
        }));

        const repository = new JsonFileWorkflowRepository({ filePath });

        expect(repository.listLatestRunReceipts().map((run) => run.id)).toEqual(['new']);
    });

    it('transaction rollback時にrunとprojectionを同時に戻す', async () => {
        const repository = new InMemoryWorkflowRepository();

        await expect(repository.transaction(() => {
            repository.createRun(receiptRun('rolled-back', '2026-07-15T01:00:00Z'));
            throw new Error('rollback');
        })).rejects.toThrow('rollback');

        expect(repository.listRuns({ limit: null })).toEqual([]);
        expect(repository.listLatestRunReceipts()).toEqual([]);
    });

    it('JSON commitとrollback後の再読込でrunとprojectionが一致する', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-run-receipt-projection-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'workflow-ledger.json');
        const repository = new JsonFileWorkflowRepository({ filePath });

        await repository.transaction(() => {
            repository.createRun(receiptRun('committed', '2026-07-15T01:00:00Z'));
        });
        const afterCommit = new JsonFileWorkflowRepository({ filePath });
        expect(afterCommit.listLatestRunReceipts().map((run) => run.id)).toEqual(['committed']);

        await expect(repository.transaction(() => {
            repository.createRun(receiptRun('rolled-back', '2026-07-15T02:00:00Z'));
            throw new Error('rollback');
        })).rejects.toThrow('rollback');

        const afterRollback = new JsonFileWorkflowRepository({ filePath });
        expect(afterRollback.listRuns({ limit: null }).map((run) => run.id)).toEqual(['committed']);
        expect(afterRollback.listLatestRunReceipts().map((run) => run.id)).toEqual(['committed']);
    });
});
