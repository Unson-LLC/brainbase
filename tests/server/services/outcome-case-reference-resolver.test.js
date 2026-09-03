import { describe, expect, it, vi } from 'vitest';

import { createOutcomeCaseReferenceResolver } from '../../../server/services/outcome-case/outcome-case-reference-resolver.js';

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
            actor: { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] }
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

        await expect(resolve({ projectCode: 'brainbase', capabilityId: 'cap_outcome_control' })).resolves.toEqual({
            project: { ref: 'brainbase', state: 'confirmed' },
            capability: { ref: 'cap_outcome_control', state: 'unresolved', reason: 'capability_registry_unavailable' }
        });
        expect(client.query).toHaveBeenCalledTimes(2);
    });
});
