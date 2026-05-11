// @ts-check
import { describe, it, expect } from 'vitest';
import { brainbaseSessionToRawLedger } from '../../../server/services/candidate-store/raw-ledger-adapter.js';
import { dreamingPass } from '../../../server/services/candidate-store/dreaming-job.js';
import { makeService } from '../_helpers.js';

describe('candidate-store S-1: brainbase session → observation candidate', () => {
    it('S-1: ended session + highlight becomes observation candidate with evidence_ref', async () => {
        const { service, repository } = makeService();
        const records = brainbaseSessionToRawLedger({
            id: 'sess_s1',
            owner_person_id: 'sato_keigo',
            workspace: 'unson',
            project_code: 'brainbase',
            ended_at: new Date().toISOString(),
            terminal_text: 'foo',
            highlights: ['Z.aiのAPIが期待値より速い']
        });
        const { drafts } = dreamingPass(records, { scope: 'personal', defaultOrgIds: ['unson'] });
        expect(drafts.length).toBeGreaterThan(0);
        const observation = drafts.find((d) => d.cognitive_type === 'observation');
        expect(observation).toBeTruthy();
        const result = await service.createCandidate(observation);
        expect(result.blocked).toBeFalsy();
        const stored = repository.list()[0];
        expect(stored.cognitive_type).toBe('observation');
        expect(stored.owner_person_id).toBe('sato_keigo');
        expect(stored.visibility).toBe('owner');
        expect(stored.evidence_ids[0].hash).toMatch(/^sha256:/);
    });
});
