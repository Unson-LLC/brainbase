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
});
