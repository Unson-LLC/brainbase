import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

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

    it('reports inactive_no_current on legacy Graph writes before publication', () => {
        expect(createService().getOntologyGuard()).toEqual({
            guard_status: 'inactive_no_current',
            ontology_version: null
        });
    });

    it('preserves legacy entity and edge writes while returning inactive_no_current', async () => {
        const client = {
            query: async (sql) => String(sql).includes('SELECT id FROM projects')
                ? { rows: [{ id: 'project:brainbase' }] }
                : { rows: [] },
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

    it('resolves stored endpoint types before guarding an existing edge write', async () => {
        const writes = [];
        const client = {
            query: async (sql) => {
                const text = String(sql);
                if (text.includes('WHERE id = ANY')) return { rows: [{ id: 'app:a', entity_type: 'app' }, { id: 'app:b', entity_type: 'app' }] };
                if (text.includes('SELECT id FROM projects')) return { rows: [{ id: 'project:brainbase' }] };
                if (text.includes('INSERT INTO graph_edges')) writes.push(text);
                return { rows: [] };
            },
            release: () => {}
        };
        const service = new InfoSSOTService({ ontologyRegistry: activeRegistry(), pool: { connect: async () => client } });
        const result = await service.createOrUpdateGraphEdge(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            { fromId: 'app:a', toId: 'app:b', relType: 'depends_on', projectCode: 'brainbase', roleMin: 'member', sensitivity: 'internal' }
        );
        expect(result).toMatchObject({ guard_status: 'active_current', ontology_version: '1.0.0' });
        expect(writes).toHaveLength(1);
    });

    it('rejects an edge when persisted endpoint types violate the current relation', async () => {
        const client = {
            query: async (sql) => String(sql).includes('WHERE id = ANY')
                ? { rows: [{ id: 'app:a', entity_type: 'app' }, { id: 'decision:b', entity_type: 'decision' }] }
                : { rows: [] },
            release: () => {}
        };
        const service = new InfoSSOTService({ ontologyRegistry: activeRegistry(), pool: { connect: async () => client } });
        await expect(service.createOrUpdateGraphEdge(
            { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
            { fromId: 'app:a', toId: 'decision:b', relType: 'depends_on', projectCode: 'brainbase', roleMin: 'member', sensitivity: 'internal' }
        )).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
    });

    it('audits every access-scoped cursor page and reports completeness evidence', async () => {
        let entityPage = 0;
        let edgePage = 0;
        const client = {
            query: async (sql) => {
                const text = String(sql);
                if (text.includes('FROM graph_entities') && text.includes('ORDER BY id')) {
                    entityPage += 1;
                    return { rows: entityPage === 1 ? [{ id: 'org:a', type: 'org', payload: {} }] : [] };
                }
                if (text.includes('FROM graph_edges') && text.includes('ORDER BY from_id')) {
                    edgePage += 1;
                    return { rows: edgePage === 1 ? [{ from_id: 'org:a', to_id: 'org:a', relation: 'derived_from', payload: {} }] : [] };
                }
                return { rows: [] };
            },
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
    });
});
