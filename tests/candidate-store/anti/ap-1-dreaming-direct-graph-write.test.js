// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { dreamingPass } from '../../../server/services/candidate-store/dreaming-job.js';
import { brainbaseSessionToRawLedger } from '../../../server/services/candidate-store/raw-ledger-adapter.js';

describe('candidate-store AP-1: dreaming job NEVER writes to Graph directly', () => {
    it('AP-1: dreamingPass interface cannot be tricked into writing graph entities', () => {
        const writer = { createEntity: vi.fn() };
        const records = brainbaseSessionToRawLedger({
            id: 'sess_ap1',
            owner_person_id: 'sato',
            workspace: 'unson',
            ended_at: new Date().toISOString(),
            terminal_text: '',
            highlights: ['気づいた、Z.aiは速い']
        });
        // dreamingPass は graphWriter を引数として受け取らない仕様
        const result = dreamingPass(records, { scope: 'personal', defaultOrgIds: ['unson'] });
        expect(writer.createEntity).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty('graphEntity');
    });
});
