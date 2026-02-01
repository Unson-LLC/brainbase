import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';

const buildService = () => {
    process.env.INFO_SSOT_DATABASE_URL = 'postgres://test';
    const service = new InfoSSOTService();
    const client = {
        query: vi.fn(async (text) => {
            if (typeof text === 'string' && text.startsWith('SELECT id FROM projects')) {
                return { rows: [{ id: 'prj_1' }] };
            }
            if (typeof text === 'string' && text.startsWith('SELECT id FROM people')) {
                return { rows: [{ id: 'per_1' }] };
            }
            if (typeof text === 'string' && text.includes('FROM raci_assignments')) {
                return { rows: [{ ok: 1 }] };
            }
            if (typeof text === 'string' && text.includes('INSERT INTO raci_assignments')) {
                return { rows: [{ id: 'rac_1' }] };
            }
            return { rows: [] };
        }),
        release: vi.fn()
    };
    service.pool = { connect: vi.fn(async () => client) };
    return { service, client };
};

const accessContext = {
    role: 'gm',
    projectCodes: ['brainbase'],
    clearance: ['internal', 'restricted', 'finance', 'hr', 'contract']
};

describe('InfoSSOTService (Graph SSOT)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('createDecision writes graph entity and edges', async () => {
        const { service, client } = buildService();

        await service.createDecision(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            roleMin: 'gm',
            sensitivity: 'internal',
            title: 'Decide Graph SSOT',
            decisionDomain: 'ops',
            context: { reason: 'AI-first' },
            options: [],
            chosen: { plan: 'graph' }
        });

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('decision');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project', 'owned_by', 'member_of']));
    });

    it('createDecision rejects finance when role_min is member', async () => {
        const { service } = buildService();

        await expect(service.createDecision(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            roleMin: 'member',
            sensitivity: 'finance',
            title: 'Finance Only',
            decisionDomain: 'finance'
        })).rejects.toThrow('Sensitive data requires role_min gm or ceo');
    });

    it('createRaci writes member_of edge', async () => {
        const { service, client } = buildService();

        await service.createRaci(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            personName: 'Bob',
            roleCode: 'gm',
            roleMin: 'gm',
            sensitivity: 'internal',
            authorityScope: 'ops'
        });

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toContain('member_of');
    });
});
