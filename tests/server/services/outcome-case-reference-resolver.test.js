import { describe, expect, it, vi } from 'vitest';

import {
    createOutcomeCaseClosureAuthorityResolver,
    createOutcomeCaseReferenceResolver
} from '../../../server/services/outcome-case/outcome-case-reference-resolver.js';

const scopedActor = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'], organizationId: 'org_unson' };

function createResolver({ projectConfirmed = true, capabilityRegistry = 'brainbase_capabilities', capabilityConfirmed = true } = {}) {
    const client = {
        query: vi.fn()
            .mockResolvedValueOnce({ rows: [{ confirmed: projectConfirmed }] })
            .mockResolvedValueOnce({ rows: [{ relation_name: capabilityRegistry }] })
            .mockResolvedValueOnce({ rows: [{ confirmed: capabilityConfirmed }] })
    };
    const infoSSOTService = {
        withAccessContext: vi.fn(async (_access, callback) => callback(client))
    };
    return { client, infoSSOTService, resolve: createOutcomeCaseReferenceResolver({ infoSSOTService }) };
}

describe('OutcomeCase authoritative reference resolver', () => {
    it('uses scoped, read-only project and capability registries', async () => {
        const { client, infoSSOTService, resolve } = createResolver();

        await expect(resolve({
            projectCode: 'brainbase',
            capabilityId: 'cap_outcome_control',
            actor: scopedActor
        })).resolves.toEqual({
            project: { ref: 'brainbase', state: 'confirmed' },
            capability: { ref: 'cap_outcome_control', state: 'confirmed' }
        });
        expect(infoSSOTService.withAccessContext).toHaveBeenCalledWith(
            expect.objectContaining({ projectCodes: ['brainbase'], clearance: ['internal'] }),
            expect.any(Function)
        );
        expect(client.query.mock.calls.map(([sql]) => sql.trim())).toEqual(expect.arrayContaining([
            expect.stringContaining('SELECT EXISTS (SELECT 1 FROM projects'),
            expect.stringContaining("SELECT to_regclass('brainbase_capabilities')"),
            expect.stringContaining('SELECT EXISTS (SELECT 1 FROM brainbase_capabilities')
        ]));
        expect(client.query.mock.calls.map(([sql]) => sql)).not.toEqual(expect.arrayContaining([
            expect.stringMatching(/\b(?:INSERT|UPDATE|DELETE)\b/i)
        ]));
    });

    it('represents an absent capability registry as unresolved instead of inferring authority', async () => {
        const { client, resolve } = createResolver({ capabilityRegistry: null });

        await expect(resolve({ projectCode: 'brainbase', capabilityId: 'cap_outcome_control', actor: scopedActor })).resolves.toEqual({
            project: { ref: 'brainbase', state: 'confirmed' },
            capability: { ref: 'cap_outcome_control', state: 'unresolved', reason: 'capability_registry_unavailable' }
        });
        expect(client.query).toHaveBeenCalledTimes(2);
    });

    it('resolves closers only through scoped read-only RACI assignments', async () => {
        const client = {
            query: vi.fn().mockResolvedValue({ rows: [
                { person_id: 'per_owner', role_code: 'outcome_case:close' }
            ] })
        };
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, callback) => callback(client)) };
        const resolve = createOutcomeCaseClosureAuthorityResolver({ infoSSOTService });

        await expect(resolve({
            projectCode: 'brainbase',
            actor: scopedActor
        })).resolves.toEqual({
            state: 'confirmed',
            closure_authorized_person_ids: ['per_owner'],
            provenance: {
                source: 'info_ssot_raci', project_code: 'brainbase', role_codes: ['outcome_case:close']
            }
        });
        expect(client.query.mock.calls[0][0]).toMatch(/SELECT r\.person_id[\s\S]*FROM raci_assignments/u);
        expect(client.query.mock.calls[0][0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/iu);
    });

    it('passes empty authenticated clearance to the RACI lookup without defaulting to internal', async () => {
        const client = {
            query: vi.fn().mockResolvedValue({ rows: [] })
        };
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, callback) => callback(client)) };
        const resolve = createOutcomeCaseClosureAuthorityResolver({ infoSSOTService });

        await expect(resolve({
            projectCode: 'brainbase',
            actor: { ...scopedActor, clearance: [] }
        })).resolves.toMatchObject({
            state: 'unresolved',
            reason: 'closure_authority_not_found'
        });
        expect(infoSSOTService.withAccessContext).toHaveBeenCalledWith(
            expect.objectContaining({ projectCodes: ['brainbase'], clearance: [] }),
            expect.any(Function)
        );
    });

    it('does not query authoritative references or RACI for conflicting organization claims', async () => {
        const { infoSSOTService, resolve } = createResolver();
        const resolveAuthority = createOutcomeCaseClosureAuthorityResolver({ infoSSOTService });
        const actor = { ...scopedActor, tenantId: 'org_other' };

        await expect(resolve({ projectCode: 'brainbase', capabilityId: 'cap_outcome_control', actor })).resolves.toEqual({
            project: { ref: 'brainbase', state: 'unresolved', reason: 'organization_context_ambiguous' },
            capability: { ref: 'cap_outcome_control', state: 'unresolved', reason: 'organization_context_ambiguous' }
        });
        await expect(resolveAuthority({ projectCode: 'brainbase', actor })).resolves.toMatchObject({
            state: 'unresolved', reason: 'organization_context_ambiguous'
        });
        expect(infoSSOTService.withAccessContext).not.toHaveBeenCalled();
    });

    async function expectUnavailableAuthority(failure) {
        const client = { query: vi.fn(async () => { throw new Error('query failed'); }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, callback) => {
                if (failure === 'access context failure') throw new Error('context failed');
                return callback(client);
            })
        };
        const resolve = createOutcomeCaseClosureAuthorityResolver({ infoSSOTService });

        await expect(resolve({ projectCode: 'brainbase', actor: scopedActor }))
            .resolves.toEqual({
                state: 'unresolved',
                closure_authorized_person_ids: [],
                provenance: null,
                reason: 'authoritative_resolver_unavailable'
            });
    }

    it('fails closure authority closed when access context failure', async () => {
        await expectUnavailableAuthority('access context failure');
    });

    it('fails closure authority closed when query failure', async () => {
        await expectUnavailableAuthority('query failure');
    });
});
