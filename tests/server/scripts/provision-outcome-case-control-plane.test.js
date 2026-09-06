import { describe, expect, it, vi } from 'vitest';

import {
    parseProvisionOutcomeCaseControlPlaneArgs,
    runProvisionOutcomeCaseControlPlane
} from '../../../scripts/provision-outcome-case-control-plane.js';

describe('provision-outcome-case-control-plane CLI', () => {
    it('permits only one explicit mode and requires approval plus actor for apply', () => {
        expect(parseProvisionOutcomeCaseControlPlaneArgs(['--check'], {})).toEqual({ mode: 'check', actorPersonId: null });
        expect(parseProvisionOutcomeCaseControlPlaneArgs(['--dry-run'], {})).toEqual({ mode: 'dry-run', actorPersonId: null });
        expect(() => parseProvisionOutcomeCaseControlPlaneArgs(['--apply'], {}))
            .toThrow(expect.objectContaining({ code: 'APPLY_APPROVAL_REQUIRED' }));
        expect(() => parseProvisionOutcomeCaseControlPlaneArgs(['--apply', '--approve-apply'], {}))
            .toThrow(expect.objectContaining({ code: 'ACTOR_REQUIRED' }));
        expect(parseProvisionOutcomeCaseControlPlaneArgs(['--apply', '--approve-apply'], {
            BRAINBASE_PROVISIONING_ACTOR: 'per_01KGYC7NNS0VXADK7NP48W4VR5'
        })).toEqual({ mode: 'apply', actorPersonId: 'per_01KGYC7NNS0VXADK7NP48W4VR5' });
    });

    it('exposes the fixed target for an offline check without database access', async () => {
        await expect(runProvisionOutcomeCaseControlPlane({ argv: ['--check'], env: {} })).resolves.toMatchObject({
            ok: true,
            mode: 'check',
            persisted: false,
            target: {
                project_code: 'brainbase',
                capability: { capability_id: 'cap_outcome_control', status: 'active' },
                closure_authority: {
                    person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
                    role_code: 'outcome_case:close'
                }
            }
        });
    });

    it('uses the provided service for dry-run and never applies records', async () => {
        const service = {
            withAccessContext: vi.fn(async (_access, handler) => handler({
                query: async (sql) => {
                    const compact = String(sql).replace(/\s+/gu, ' ').trim();
                    if (compact.includes("to_regclass('brainbase_capabilities')")) return { rows: [{ relation_name: 'brainbase_capabilities' }] };
                    if (compact.includes('FROM projects p')) return { rows: [{ id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H' }] };
                    if (compact.includes('FROM graph_entities')) return { rows: [{ id: 'per_01KGYC7NNS0VXADK7NP48W4VR5' }] };
                    if (compact.includes('FROM brainbase_capabilities')) return { rows: [] };
                    if (compact.includes('FROM raci_assignments')) return { rows: [] };
                    throw new Error(`Unexpected query: ${compact}`);
                }
            })),
            createRaci: vi.fn()
        };
        await expect(runProvisionOutcomeCaseControlPlane({
            argv: ['--dry-run'], env: {}, infoSSOTService: service
        })).resolves.toMatchObject({ ok: true, mode: 'dry-run', persisted: false });
        expect(service.createRaci).not.toHaveBeenCalled();
    });
});
