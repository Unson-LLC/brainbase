import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../cli/config.js', () => ({
    getAuth: () => ({ token: 'signed-token', server_url: 'https://brainbase.example' }),
    getConfig: () => ({ server_url: 'https://unused.example' })
}));

import { runProjectProvisioning } from '../../cli/project-provisioning.js';

describe('project provisioning CLI', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mockCsrfAndRequest(payload) {
        return vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => payload });
    }

    it('records Human Gate approval through the dedicated approve endpoint', async () => {
        const fetchMock = mockCsrfAndRequest({ run_id: 'run-1', state: 'planned' });
        vi.spyOn(console, 'log').mockImplementation(() => {});

        await runProjectProvisioning('approve', [
            'run-1',
            '--gates',
            'repository_create,public_repository',
            '--review-ref',
            'review-123'
        ]);

        expect(fetchMock).toHaveBeenNthCalledWith(2,
            'https://brainbase.example/api/project-provisioning/runs/run-1/approve',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer signed-token',
                    'x-csrf-token': 'csrf-token',
                    'x-session-id': expect.stringMatching(/^project-provisioning-/u)
                }),
                body: JSON.stringify({
                    approved_gates: ['repository_create', 'public_repository'],
                    review_ref: 'review-123'
                })
            })
        );
    });

    it('rejects approval flags on apply instead of silently ignoring them', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        await expect(runProjectProvisioning('apply', ['run-1', '--gates', 'repository_create']))
            .rejects.toThrow('Unsupported option: --gates');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('manual interventionを非zero相当で示し、approve後のresumeを案内する', async () => {
        mockCsrfAndRequest({
            run_id: 'run-1',
            state: 'manual_intervention_required',
            missing_gates: ['manifest_plan_approval', 'repository_create']
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});

        await expect(runProjectProvisioning('apply', ['run-1'])).rejects.toThrow(
            'manual_intervention_required: approve exactly these gates, then run resume: manifest_plan_approval,repository_create'
        );
    });

    it('check CLIはURLへManifestを送りwrites_performed 0とauthority/collision detailsを表示する', async () => {
        const manifest = { project_code: 'growin-ai', display_name: 'Growin AI' };
        const responsePayload = {
            ok: false,
            manifest,
            authority: { organization_exists: true, owner_person_exists: false },
            collisions: [{ field: 'owner_person_id', value: false, source: 'authority_readback' }],
            writes_performed: 0
        };
        const fetchMock = mockCsrfAndRequest(responsePayload);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(manifest));
        const logMock = vi.spyOn(console, 'log').mockImplementation(() => {});

        await runProjectProvisioning('check', ['--manifest', 'project.json']);

        expect(fetchMock).toHaveBeenNthCalledWith(2,
            'https://brainbase.example/api/project-provisioning/check',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify(manifest),
                headers: expect.objectContaining({
                    Authorization: 'Bearer signed-token',
                    'x-csrf-token': 'csrf-token',
                    'x-session-id': expect.stringMatching(/^project-provisioning-/u)
                })
            })
        );
        expect(JSON.parse(logMock.mock.calls.at(-1)[0])).toMatchObject({
            writes_performed: 0,
            authority: responsePayload.authority,
            collisions: responsePayload.collisions
        });
    });

    it('plan CLIはURLへManifestとIdempotency-Keyを送り、plan detailsを表示する', async () => {
        const manifest = { project_code: 'growin-ai', display_name: 'Growin AI' };
        const idempotencyKey = 'project-plan-1';
        const responsePayload = {
            run_id: 'ppr_1',
            manifest,
            idempotency_key: idempotencyKey,
            plan: { required_human_gates: ['manifest_plan_approval'] }
        };
        const fetchMock = mockCsrfAndRequest(responsePayload);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(manifest));
        const logMock = vi.spyOn(console, 'log').mockImplementation(() => {});

        await runProjectProvisioning('plan', [
            '--manifest', 'project.json', '--idempotency-key', idempotencyKey
        ]);

        expect(fetchMock).toHaveBeenNthCalledWith(2,
            'https://brainbase.example/api/project-provisioning/plan',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify(manifest),
                headers: expect.objectContaining({
                    Authorization: 'Bearer signed-token',
                    'x-csrf-token': 'csrf-token',
                    'x-session-id': expect.stringMatching(/^project-provisioning-/u),
                    'Idempotency-Key': idempotencyKey
                })
            })
        );
        expect(JSON.parse(logMock.mock.calls.at(-1)[0])).toMatchObject({
            manifest,
            idempotency_key: idempotencyKey,
            plan: responsePayload.plan
        });
    });

    it('documents approve as a separate command in the root help', () => {
        const help = fs.readFileSync(path.join(process.cwd(), 'cli', 'index.js'), 'utf8');
        expect(help).toContain('project provision approve RUN_ID --gates GATE,... --review-ref RECEIPT');
        expect(help).toContain('[check|plan|approve|apply|status|verify|resume]');
        expect(help).not.toContain('apply|resume RUN_ID [--approve');
    });
});
