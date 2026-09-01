import { afterAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';
import { createProposedOntologyFixture } from '../../helpers/ontology-test-fixtures.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const proposedFixture = createProposedOntologyFixture(sourceRoot);
const rootDir = proposedFixture.rootDir;

afterAll(() => proposedFixture.cleanup());

function createService() {
    return new InfoSSOTService({ ontologyRegistry: new OntologyRegistry({ rootDir }) });
}

function activeRegistry() {
    const registry = new OntologyRegistry({ rootDir });
    return {
        hasCurrent: () => true,
        resolve: (options = {}) => {
            const release = registry.resolve({ version: options.version || '1.0.0', asOf: options.asOf });
            release.kernel.status = 'active';
            return release;
        }
    };
}

function activeRegistryWith(overrides = {}) {
    const registry = activeRegistry();
    return {
        ...registry,
        resolve: (options = {}) => {
            const release = registry.resolve(options);
            return { ...release, kernel: Object.assign(Object.create(release.kernel), overrides) };
        }
    };
}

describe('InfoSSOTService ontology API', () => {
    it('describes an explicit immutable release with its digest', () => {
        const result = createService().describeOntology({ version: '1.0.0' });
        expect(result).toMatchObject({ version: '1.0.0', effective_status: 'proposed' });
        expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
        expect(createService().describeOntologyType('app', { version: '1.0.0' })).toMatchObject({
            id: 'app', ontology_version: '1.0.0', definition: { owner: 'org' }
        });
        expect(createService().describeOntologyRelation('supersedes', { version: '1.0.0' })).toMatchObject({
            id: 'supersedes', ontology_version: '1.0.0'
        });
    });

    it('validates an explicit-version snapshot without a database', () => {
        const result = createService().validateOntology({
            version: '1.0.0',
            snapshot: {
                entities: [{ id: 'app:brainbase', type: 'app', payload: {} }],
                edges: []
            }
        });
        expect(result.valid).toBe(false);
        expect(result.violations).toEqual(expect.arrayContaining([
            expect.objectContaining({ rule_id: 'CON-APP-OWNER-001' })
        ]));
    });

    it('runs inference and impact against an explicit release', () => {
        const service = createService();
        const inference = service.inferOntology({ version: '1.0.0', snapshot: { entities: [], edges: [] } });
        const impact = service.impactOntology({ version: '1.0.0', change: { kind: 'remove_type' } });
        expect(inference.ontology_version).toBe('1.0.0');
        expect(impact).toMatchObject({ ontology_version: '1.0.0', semver: 'major', verification: 'unverified' });
    });

    it('interprets history through the ontology version recorded with the fact', () => {
        const result = createService().interpretOntologyHistory({
            asOf: '2026-08-03T00:00:00.000Z',
            snapshot: {
                ontology_version: '1.0.0',
                entities: [{ id: 'org:legacy', type: 'org' }],
                evolution_events: [{
                    event_id: 'ontology:rename:org:unson',
                    event_type: 'ontology_rename',
                    ontology_version: '1.0.0',
                    canonical_id: 'org:unson',
                    source_ids: ['org:legacy'],
                    provenance: ['decision:rename'],
                    effective_at: '2026-08-02T00:00:00.000Z'
                }]
            }
        });
        expect(result).toMatchObject({
            ontology_version: null,
            recorded_ontology_version: '1.0.0',
            resolved_ontology_version: null,
            verification: 'unverified',
            unverified_reason: { code: 'ONTOLOGY_PUBLICATION_UNVERIFIED' },
            entities: [{ id: 'org:legacy', type: 'org' }]
        });
    });

    it('reports inactive_no_current on legacy Graph writes before publication', () => {
        expect(createService().getOntologyGuard()).toEqual({
            guard_status: 'inactive_no_current',
            ontology_version: null
        });
    });

    it('preserves legacy entity and edge writes while returning inactive_no_current', async () => {
        const client = {
            query: async (sql) => {
                const text = String(sql);
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                if (text.includes('SELECT id, project_id FROM graph_entities')) {
                    return { rows: [
                        { id: 'app:legacy', project_id: 'project:brainbase' },
                        { id: 'app:dependency', project_id: 'project:brainbase' }
                    ] };
                }
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: new OntologyRegistry({ rootDir }),
            pool: { connect: async () => client }
        });
        const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };
        await expect(service.createOrUpdateGraphEntity(access, {
            id: 'app:legacy', entityType: 'app', projectCode: 'brainbase', payload: {}, roleMin: 'member', sensitivity: 'internal'
        })).resolves.toMatchObject({ guard_status: 'inactive_no_current', ontology_version: null });
        await expect(service.createOrUpdateGraphEdge(access, {
            fromId: 'app:legacy', toId: 'app:dependency', relType: 'depends_on', projectCode: 'brainbase', roleMin: 'member', sensitivity: 'internal'
        })).resolves.toMatchObject({ guard_status: 'inactive_no_current', ontology_version: null });
    });

    it('rolls back an atomic commit when the entity and required edge violate the ontology', async () => {
        const statements = [];
        const client = {
            query: async (sql) => { statements.push(sql); return { rows: [] }; },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistry(),
            pool: { connect: async () => client }
        });
        const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

        await expect(service.commitOntologyGraph(access, {
            projectCode: 'brainbase',
            roleMin: 'member',
            sensitivity: 'internal',
            entity: { id: 'app:orphan', type: 'app', payload: {} },
            edges: []
        })).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
        expect(statements).toContain('BEGIN');
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
        expect(statements.some((sql) => String(sql).includes('INSERT INTO graph_entities'))).toBe(false);
    });

    it('rejects an effective Decision without persisted authority relations before persistence', async () => {
        const statements = [];
        const client = {
            query: async (sql) => {
                statements.push(String(sql));
                if (String(sql).includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistry(),
            pool: { connect: async () => client }
        });
        const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

        await expect(service.createOrUpdateGraphEntity(access, {
            id: 'decision:entity-only',
            entityType: 'decision',
            projectCode: 'brainbase',
            payload: { status: 'decided' },
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toMatchObject({
            code: 'ONTOLOGY_VALIDATION_FAILED',
            details: expect.objectContaining({
                violations: expect.arrayContaining([
                    expect.objectContaining({ rule_id: 'CON-DECISION-DECIDER-001' }),
                    expect.objectContaining({ rule_id: 'CON-DECISION-SCOPE-001' })
                ])
            })
        });
        expect(statements).toContain('ROLLBACK');
        expect(statements.filter((sql) => sql.trim().startsWith('INSERT INTO graph_entities'))).toHaveLength(1);
    });

    it('rejects caller-declared context entities that do not exist in the canonical Graph', async () => {
        const statements = [];
        const client = {
            query: async (sql) => {
                statements.push(String(sql));
                if (String(sql).includes('FROM graph_entities')) return { rows: [] };
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistry(),
            pool: { connect: async () => client }
        });

        await expect(service.commitOntologyGraph(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                projectCode: 'brainbase',
                roleMin: 'member',
                sensitivity: 'internal',
                entity: { id: 'app:new', type: 'app', payload: {} },
                contextEntities: [{ id: 'org:invented', type: 'org', payload: {} }],
                edges: [{ from_id: 'org:invented', to_id: 'app:new', relation: 'owns' }]
            }
        )).rejects.toMatchObject({
            code: 'ONTOLOGY_EDGE_ENDPOINT_NOT_FOUND',
            details: { missing_endpoint_ids: ['org:invented'] }
        });
        expect(statements).toContain('ROLLBACK');
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_entities'))).toBe(false);
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_edges'))).toBe(false);
    });

    it('validates an atomic commit with context resolved from the canonical Graph', async () => {
        const statements = [];
        const client = {
            query: async (sql) => {
                const text = String(sql);
                statements.push(text);
                if (text.includes('FROM graph_entities')) {
                    return { rows: [
                        { id: 'org:unson', entity_type: 'org', payload: { name: 'Unson' } },
                        { id: 'app:new', entity_type: 'app', payload: {} }
                    ] };
                }
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistry(),
            pool: { connect: async () => client }
        });

        await expect(service.commitOntologyGraph(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                projectCode: 'brainbase',
                roleMin: 'member',
                sensitivity: 'internal',
                entity: { id: 'app:new', type: 'app', payload: {} },
                contextEntities: [{ id: 'org:unson', type: 'org' }],
                edges: [{ from_id: 'org:unson', to_id: 'app:new', relation: 'owns' }]
            }
        )).resolves.toMatchObject({
            entity_id: 'app:new',
            edge_count: 1,
            guard_status: 'active_current'
        });
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_entities'))).toBe(true);
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_edges'))).toBe(true);
        expect(statements).toContain('COMMIT');
    });

    it('rolls back a canonical commit that conflicts with a persisted cardinality edge', async () => {
        const statements = [];
        const client = {
            query: async (sql) => {
                const text = String(sql);
                statements.push(text);
                if (text.includes('FROM graph_edges')) {
                    return { rows: [{
                        id: 'edge:existing-owner',
                        from_id: 'app:existing',
                        to_id: 'org:first-owner',
                        rel_type: 'owned_by'
                    }] };
                }
                if (text.includes('FROM graph_entities')) {
                    return { rows: [
                        { id: 'app:existing', entity_type: 'app', payload: {} },
                        { id: 'org:first-owner', entity_type: 'org', payload: {} },
                        { id: 'org:second-owner', entity_type: 'org', payload: {} }
                    ] };
                }
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistry(),
            pool: { connect: async () => client }
        });

        await expect(service.commitOntologyGraph(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                projectCode: 'brainbase',
                roleMin: 'member',
                sensitivity: 'internal',
                entity: { id: 'app:existing', type: 'app', payload: {} },
                contextEntities: [{ id: 'org:second-owner', type: 'org' }],
                edges: [{ from_id: 'app:existing', to_id: 'org:second-owner', relation: 'owned_by' }]
            }
        )).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_entities'))).toBe(false);
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_edges'))).toBe(false);
    });

    it('locks every canonical aggregate target in deterministic order before reading edges', async () => {
        const calls = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql);
                calls.push({ text, params });
                if (text.includes('FROM graph_entities')) {
                    return { rows: [
                        { id: 'org:z-owner', entity_type: 'org', payload: {} },
                        { id: 'app:new-concurrent', entity_type: 'app', payload: {} }
                    ] };
                }
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistry(),
            pool: { connect: async () => client }
        });

        await service.commitOntologyGraph(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                projectCode: 'brainbase',
                roleMin: 'member',
                sensitivity: 'internal',
                entity: { id: 'app:new-concurrent', type: 'app', payload: {} },
                contextEntities: [{ id: 'org:z-owner', type: 'org' }],
                edges: [{ from_id: 'app:new-concurrent', to_id: 'org:z-owner', relation: 'owned_by' }]
            }
        );

        const lockCalls = calls.filter(({ text, params }) => text.includes('pg_advisory_xact_lock')
            && String(params[0]).startsWith('ontology-aggregate:'));
        expect(lockCalls.map(({ params }) => params[0])).toEqual([
            'ontology-aggregate:app:new-concurrent',
            'ontology-aggregate:org:z-owner'
        ]);
        const firstEdgeRead = calls.findIndex(({ text }) => text.includes('FROM graph_edges'));
        expect(firstEdgeRead).toBeGreaterThan(calls.lastIndexOf(lockCalls.at(-1)));
    });

    it('resolves stored endpoint types before guarding an existing edge write', async () => {
        const writes = [];
        const client = {
            query: async (sql) => {
                const text = String(sql);
                if (text.includes('WHERE id = ANY')) return { rows: [{ id: 'project:a', entity_type: 'project' }, { id: 'project:b', entity_type: 'project' }] };
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                if (text.includes('INSERT INTO graph_edges')) writes.push(text);
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({ ontologyRegistry: activeRegistry(), pool: { connect: async () => client } });
        const result = await service.createOrUpdateGraphEdge(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            { fromId: 'project:a', toId: 'project:b', relType: 'depends_on', projectCode: 'brainbase', roleMin: 'member', sensitivity: 'internal' }
        );
        expect(result).toMatchObject({ guard_status: 'active_current', ontology_version: '1.0.0' });
        expect(writes).toHaveLength(1);
    });

    it('rejects an edge when persisted endpoint types violate the current relation', async () => {
        const client = {
            query: async (sql) => {
                const text = String(sql);
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                if (text.includes('WHERE id = ANY')) {
                    return { rows: [{ id: 'app:a', entity_type: 'app' }, { id: 'decision:b', entity_type: 'decision' }] };
                }
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({ ontologyRegistry: activeRegistry(), pool: { connect: async () => client } });
        await expect(service.createOrUpdateGraphEdge(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            { fromId: 'app:a', toId: 'decision:b', relType: 'depends_on', projectCode: 'brainbase', roleMin: 'member', sensitivity: 'internal' }
        )).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
    });

    it('rolls back a legacy writer when the active ontology rejects its entity', async () => {
        const statements = [];
        const client = {
            query: async (sql) => {
                const text = String(sql);
                statements.push(text);
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistryWith({
                validateEntity: () => ({
                    valid: false,
                    ontology_version: '1.0.0',
                    violations: [{ rule_id: 'test-kpi-rejected' }]
                })
            }),
            pool: { connect: async () => client }
        });

        await expect(service.createKpi(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            { projectCode: 'brainbase', metricName: 'MRR' }
        )).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
        expect(statements.some((sql) => sql.includes('INSERT INTO graph_entities'))).toBe(false);
    });

    it('validates a legacy Decision aggregate before committing its transaction', async () => {
        const statements = [];
        const client = {
            query: async (sql) => {
                const text = String(sql);
                statements.push(text);
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                if (text.includes("entity_type = 'person'")) return { rows: [{ id: 'person:owner' }] };
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({
            ontologyRegistry: activeRegistryWith({
                validateSnapshot: () => ({
                    valid: false,
                    ontology_version: '1.0.0',
                    violations: [{ rule_id: 'test-decision-aggregate-rejected' }]
                })
            }),
            pool: { connect: async () => client }
        });

        await expect(service.createDecision(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                projectCode: 'brainbase',
                ownerPersonName: '佐藤圭吾',
                title: 'Ontologyを有効化する',
                enforceRaci: false,
                roleMin: 'member',
                sensitivity: 'internal'
            }
        )).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
        expect(statements.some((sql) => sql.includes('INSERT INTO events'))).toBe(false);
        expect(statements.some((sql) => sql.includes('INSERT INTO decisions'))).toBe(false);
    });

    it('preserves the legacy Decision response after active aggregate validation', async () => {
        const statements = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql);
                statements.push(text);
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                if (text.includes("entity_type = 'person'")) return { rows: [{ id: 'person:owner' }] };
                if (text.includes('WHERE id = ANY')) {
                    return {
                        rows: (params[0] || []).map((id) => ({
                            id,
                            entity_type: id.startsWith('dec_') ? 'decision' : id.startsWith('person:') ? 'person' : 'project',
                            payload: id.startsWith('dec_') ? { status: 'decided' } : {}
                        }))
                    };
                }
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({ ontologyRegistry: activeRegistry(), pool: { connect: async () => client } });

        await expect(service.createDecision(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                projectCode: 'brainbase',
                ownerPersonName: '佐藤圭吾',
                title: 'Ontologyを有効化する',
                enforceRaci: false,
                roleMin: 'member',
                sensitivity: 'internal'
            }
        )).resolves.toMatchObject({
            decision_id: expect.stringMatching(/^dec_/),
            event_id: expect.stringMatching(/^evt_/),
            guard_status: 'active_current',
            ontology_version: '1.0.0'
        });
        expect(statements).toContain('COMMIT');
        expect(statements.filter((sql) => sql.includes('INSERT INTO graph_edges'))).toHaveLength(3);
    });

    it('audits every access-scoped cursor page and reports completeness evidence', async () => {
        let entityPage = 0;
        let edgePage = 0;
        const client = {
            query: vi.fn(async (sql) => {
                const text = String(sql);
                if (text.includes('FROM graph_entities') && text.includes('ORDER BY ge.id')) {
                    entityPage += 1;
                    return { rows: entityPage === 1 ? [{ id: 'org:a', type: 'org', payload: {} }] : [] };
                }
                if (text.includes('FROM graph_edges') && text.includes('ORDER BY ge.from_id')) {
                    edgePage += 1;
                    return { rows: edgePage === 1 ? [{ id: 'edge:a', from_id: 'org:a', to_id: 'org:a', relation: 'derived_from', payload: {} }] : [] };
                }
                return { rows: [] };
            }),
            release: () => {}
        };
        const service = new InfoSSOTService({ ontologyRegistry: activeRegistry(), pool: { connect: async () => client } });
        const result = await service.auditOntology(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            { limit: 1 }
        );
        expect(result.completeness).toMatchObject({
            status: 'complete', entity_count: 1, edge_count: 1, next_cursor: null, completed_cursor_count: 4
        });
        expect(result.verification).toBe('verified');
        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('FROM graph_entities'));
        expect(entityCalls[0][0]).toContain('entity_project.code=ANY($5)');
        expect(entityCalls[0][0]).toContain("membership.lifecycle_status='active'");
        expect(entityCalls[0][0]).toContain('membership.sensitivity=ANY($3)');
        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('SELECT id, from_id, to_id'));
        expect(edgeCalls[0][0]).toContain('(ge.from_id, ge.to_id, ge.rel_type, ge.id)');
        expect(edgeCalls[0][0]).toContain('ORDER BY ge.from_id, ge.to_id, ge.rel_type, ge.id');
        expect(edgeCalls[1][1].slice(0, 4)).toEqual(['org:a', 'org:a', 'derived_from', 'edge:a']);
    });
});
