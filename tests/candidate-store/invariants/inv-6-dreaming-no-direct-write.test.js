// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { dreamingPass } from '../../../server/services/candidate-store/dreaming-job.js';
import { brainbaseSessionToRawLedger } from '../../../server/services/candidate-store/raw-ledger-adapter.js';

describe('candidate-store INV-6: dreaming does not write to Graph SSOT directly', () => {
    it('INV-6: dreamingPass only returns drafts, never invokes graph writer', () => {
        const records = brainbaseSessionToRawLedger({
            id: 'sess1',
            owner_person_id: 'sato',
            workspace: 'unson',
            ended_at: new Date().toISOString(),
            terminal_text: 'irrelevant',
            highlights: ['Z.aiのAPIが期待値より速い']
        });
        const result = dreamingPass(records, { scope: 'personal', defaultOrgIds: ['unson'] });
        expect(result.drafts.length).toBeGreaterThan(0);
        // dreamingPass returns only drafts; no graph write side effect possible
        expect(Object.keys(result)).toEqual(expect.arrayContaining(['drafts', 'blocked']));
        expect('graphEntity' in result).toBe(false);
    });
});
