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

    it('createGlossaryTerm writes graph entity and edges with full payload', async () => {
        const { service, client } = buildService();

        const result = await service.createGlossaryTerm(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            term: 'SSOT',
            reading: 'エスエスオーティー',
            correctForm: 'Single Source of Truth',
            incorrectForms: ['SSOTT', 'S.S.O.T'],
            category: 'architecture',
            description: '唯一の正本',
            roleMin: 'member',
            sensitivity: 'internal',
            source: 'manual'
        });

        expect(result.glossary_term_id).toMatch(/^gls_/);
        expect(result.event_id).toMatch(/^evt_/);

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('glossary_term');

        const payloads = entityCalls.map(([, params]) => params?.[3]).filter(Boolean);
        const glossaryPayload = payloads.find(p => {
            const parsed = JSON.parse(p);
            return parsed.term === 'SSOT';
        });
        expect(glossaryPayload).toBeTruthy();
        const parsed = JSON.parse(glossaryPayload);
        expect(parsed.reading).toBe('エスエスオーティー');
        expect(parsed.correct_form).toBe('Single Source of Truth');
        expect(parsed.incorrect_forms).toEqual(['SSOTT', 'S.S.O.T']);
        expect(parsed.category).toBe('architecture');
        expect(parsed.description).toBe('唯一の正本');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project']));
    });

    it('createGlossaryTerm requires term', async () => {
        const { service } = buildService();

        await expect(service.createGlossaryTerm(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            description: 'missing term field',
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toThrow('term is required');
    });

    it('createKpi writes graph entity and edges with full payload', async () => {
        const { service, client } = buildService();

        const result = await service.createKpi(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            metricName: 'Task Completion Rate',
            targetValue: '80',
            currentValue: '65',
            unit: '%',
            period: 'monthly',
            description: 'タスク完了率',
            roleMin: 'member',
            sensitivity: 'internal',
            source: 'manual'
        });

        expect(result.kpi_id).toMatch(/^kpi_/);
        expect(result.event_id).toMatch(/^evt_/);

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('kpi');

        const payloads = entityCalls.map(([, params]) => params?.[3]).filter(Boolean);
        const kpiPayload = payloads.find(p => {
            const parsed = JSON.parse(p);
            return parsed.metric_name === 'Task Completion Rate';
        });
        expect(kpiPayload).toBeTruthy();
        const parsed = JSON.parse(kpiPayload);
        expect(parsed.target_value).toBe('80');
        expect(parsed.current_value).toBe('65');
        expect(parsed.unit).toBe('%');
        expect(parsed.period).toBe('monthly');
        expect(parsed.description).toBe('タスク完了率');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project']));
    });

    it('createKpi requires metricName', async () => {
        const { service } = buildService();

        await expect(service.createKpi(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            targetValue: '80',
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toThrow('metricName is required');
    });

    it('createInitiative writes graph entity and edges with full payload', async () => {
        const { service, client } = buildService();

        const result = await service.createInitiative(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            title: 'Graph SSOT Migration',
            description: 'Migrate all entities to graph',
            status: 'in_progress',
            startDate: '2026-02-01',
            roleMin: 'gm',
            sensitivity: 'internal',
            source: 'manual'
        });

        expect(result.initiative_id).toMatch(/^ini_/);
        expect(result.event_id).toMatch(/^evt_/);

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('initiative');

        const payloads = entityCalls.map(([, params]) => params?.[3]).filter(Boolean);
        const iniPayload = payloads.find(p => {
            const parsed = JSON.parse(p);
            return parsed.title === 'Graph SSOT Migration';
        });
        expect(iniPayload).toBeTruthy();
        const parsed = JSON.parse(iniPayload);
        expect(parsed.status).toBe('in_progress');
        expect(parsed.start_date).toBe('2026-02-01');
        expect(parsed.description).toBe('Migrate all entities to graph');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project', 'owned_by', 'member_of']));
    });

    it('createInitiative requires title', async () => {
        const { service } = buildService();

        await expect(service.createInitiative(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toThrow('title is required');
    });
});
