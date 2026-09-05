import { describe, expect, it } from 'vitest';

import { parseProvisionTenantProjectAccessArgs, runProvisionTenantProjectAccess } from '../../../scripts/provision-tenant-project-access.js';

describe('fixed two-user tenant project access script', () => {
    it('keeps apply behind explicit approval and actor attribution', () => {
        expect(() => parseProvisionTenantProjectAccessArgs(['--apply']))
            .toThrow(/approve-apply/u);
        expect(parseProvisionTenantProjectAccessArgs(['--apply', '--approve-apply'], { BRAINBASE_PROVISIONING_ACTOR: 'keigo' }))
            .toMatchObject({ mode: 'apply', actorId: 'keigo' });
    });

    it('rejects arbitrary target arguments', () => {
        expect(() => parseProvisionTenantProjectAccessArgs(['--dry-run', '--manifest', 'access.json']))
            .toThrow(/does not accept target arguments/u);
    });

    it('checks the compiled target without a database connection', async () => {
        await expect(runProvisionTenantProjectAccess({ argv: ['--check'] }))
            .resolves.toMatchObject({ ok: true, mode: 'check', persisted: false, target: { project_code: 'brainbase', workspace_id: 'T0882T8N9UH', app_id: 'A0BPM2J33SN' } });
    });
});
