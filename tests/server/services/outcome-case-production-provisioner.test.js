import { describe, expect, it, vi } from 'vitest';

import {
    OUTCOME_CASE_CONTROL_PLANE_TARGET,
    OutcomeCaseProductionProvisioningError,
    provisionOutcomeCaseControlPlane,
    readbackOutcomeCaseControlPlane
} from '../../../server/services/outcome-case/outcome-case-production-provisioner.js';

function createService({ capabilityStatus = null, authorityPresent = false } = {}) {
    const state = { capabilityStatus, authorityPresent };
    const queries = [];
    const client = {
        async query(sql, parameters = []) {
            const compact = String(sql).replace(/\s+/gu, ' ').trim();
            queries.push({ sql: compact, parameters });
            if (compact.includes("to_regclass('brainbase_capabilities')")) {
                return { rows: [{ relation_name: 'brainbase_capabilities' }] };
            }
            if (compact.includes('FROM projects p') && compact.includes('p.organization_id = $3')) {
                return { rows: [{ id: OUTCOME_CASE_CONTROL_PLANE_TARGET.project_id }] };
            }
            if (compact.includes('FROM graph_entities') && compact.includes("entity_type = 'person'")) {
                return { rows: [{ id: OUTCOME_CASE_CONTROL_PLANE_TARGET.closure_authority.person_id }] };
            }
            if (compact.startsWith('SELECT status FROM brainbase_capabilities')) {
                return { rows: state.capabilityStatus ? [{ status: state.capabilityStatus }] : [] };
            }
            if (compact.includes('FROM raci_assignments r') && compact.includes('r.role_code = $5')) {
                return { rows: state.authorityPresent ? [{
                    person_id: OUTCOME_CASE_CONTROL_PLANE_TARGET.closure_authority.person_id,
                    role_code: OUTCOME_CASE_CONTROL_PLANE_TARGET.closure_authority.role_code,
                    authority_scope: OUTCOME_CASE_CONTROL_PLANE_TARGET.closure_authority.authority_scope,
                    sensitivity_min: OUTCOME_CASE_CONTROL_PLANE_TARGET.closure_authority.sensitivity_min,
                    sensitivity: OUTCOME_CASE_CONTROL_PLANE_TARGET.closure_authority.sensitivity
                }] : [] };
            }
            if (compact.startsWith('INSERT INTO brainbase_capabilities')) {
                state.capabilityStatus = 'active';
                return { rows: [] };
            }
            throw new Error(`Unexpected query: ${compact}`);
        }
    };
    const service = {
        withAccessContext: vi.fn(async (_access, handler) => handler(client)),
        createRaci: vi.fn(async (_access, input, options) => {
            expect(options).toEqual({ client, access_context_applied: true });
            expect(input).toMatchObject({
                projectCode: 'brainbase',
                personId: OUTCOME_CASE_CONTROL_PLANE_TARGET.closure_authority.person_id,
                roleCode: 'outcome_case:close',
                authorityScope: 'outcome_case.close'
            });
            state.authorityPresent = true;
            return { raci_id: 'rac_outcome_case_close', event_id: 'evt_outcome_case_close' };
        })
    };
    return { service, state, queries };
}

describe('OutcomeCase production control-plane provisioning', () => {
    it('provisions the exact registry capability and Sato close RACI in one access context', async () => {
        const { service, queries } = createService();

        const result = await provisionOutcomeCaseControlPlane({
            infoSSOTService: service,
            actorId: 'operator-keigo',
            commit: true
        });

        expect(result).toMatchObject({
            persisted: true,
            capability: { capability_id: 'cap_outcome_control', status: 'active' },
            closure_authority: {
                person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
                role_code: 'outcome_case:close'
            }
        });
        expect(service.createRaci).toHaveBeenCalledTimes(1);
        expect(queries.some(({ sql, parameters }) => sql.startsWith('INSERT INTO brainbase_capabilities')
            && parameters[0] === 'cap_outcome_control')).toBe(true);
    });

    it('returns a dry-run plan without writing either control-plane record', async () => {
        const { service, queries } = createService();

        const result = await provisionOutcomeCaseControlPlane({
            infoSSOTService: service,
            actorId: 'dry-run',
            commit: false
        });

        expect(result).toMatchObject({ persisted: false, plan: { capability: 'upsert_active', closure_authority: 'upsert_raci' } });
        expect(service.createRaci).not.toHaveBeenCalled();
        expect(queries.some(({ sql }) => sql.startsWith('INSERT INTO brainbase_capabilities'))).toBe(false);
    });

    it('does not create another RACI event when the approved close authority already exists', async () => {
        const { service } = createService({ capabilityStatus: 'active', authorityPresent: true });

        await expect(provisionOutcomeCaseControlPlane({
            infoSSOTService: service,
            actorId: 'operator-keigo',
            commit: true
        })).resolves.toMatchObject({ persisted: true, raci: null });
        expect(service.createRaci).not.toHaveBeenCalled();
    });

    it('requires both exact records in post-commit readback', async () => {
        const missingAuthority = createService({ capabilityStatus: 'active', authorityPresent: false });

        await expect(readbackOutcomeCaseControlPlane({ infoSSOTService: missingAuthority.service }))
            .rejects.toThrow(expect.objectContaining({ code: 'POST_COMMIT_READBACK_FAILED' }));

        const complete = createService({ capabilityStatus: 'active', authorityPresent: true });
        await expect(readbackOutcomeCaseControlPlane({ infoSSOTService: complete.service })).resolves.toMatchObject({
            capability: { capability_id: 'cap_outcome_control', status: 'active' },
            closure_authority: {
                person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
                role_code: 'outcome_case:close'
            }
        });
    });

    it('keeps the production target fixed to Brainbase and Sato', () => {
        expect(OUTCOME_CASE_CONTROL_PLANE_TARGET).toMatchObject({
            organization_id: 'unson',
            project_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H',
            project_code: 'brainbase',
            capability: { capability_id: 'cap_outcome_control', status: 'active' },
            closure_authority: {
                person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
                role_code: 'outcome_case:close'
            }
        });
        expect(() => {
            throw new OutcomeCaseProductionProvisioningError('CHECK', 'expected');
        }).toThrow('expected');
    });
});
