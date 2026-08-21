import { describe, expect, it } from 'vitest';
import release100 from '../../../config/ontology/releases/1.0.0.json';
import release110 from '../../../config/ontology/releases/1.1.0.json';
import ontologyIndex from '../../../config/ontology/index.json';
import { OntologyKernel } from '../../../server/services/ontology-kernel.js';

describe('Ontology 1.1.0 person supersession release', () => {
    const kernel = new OntologyKernel({ manifest: release110 });

    it('is additive over 1.0.0 without requiring a data migration', () => {
        expect(release110).toMatchObject({
            version: '1.1.0',
            previous_version: '1.0.0',
            compatibility: { classification: 'backward_compatible', compatible_from: '1.0.0' },
            migration: { required: false },
            rollback: { target_version: '1.0.0' }
        });
        expect(Object.keys(release110.entity_types)).toEqual(expect.arrayContaining(Object.keys(release100.entity_types)));
        expect(Object.keys(release110.relation_types)).toEqual(expect.arrayContaining(Object.keys(release100.relation_types)));
        expect(release110.constraints).toEqual(expect.arrayContaining(release100.constraints));
        expect(release110.inference_rules).toEqual(expect.arrayContaining(release100.inference_rules));
    });

    it('accepts only person to person superseded_by edges', () => {
        expect(kernel.validateEdge({ relation: 'superseded_by', from_type: 'person', to_type: 'person' })).toMatchObject({ valid: true });
        expect(kernel.validateEdge({ relation: 'superseded_by', from_type: 'person_alias', to_type: 'person' })).toMatchObject({ valid: false });
        expect(kernel.validateEdge({ relation: 'superseded_by', from_type: 'person', to_type: 'org' })).toMatchObject({ valid: false });
    });

    it('preserves every 1.0.0 entity relation constraint and inference definition', () => {
        expect(Object.keys(release110.entity_types)).toEqual(expect.arrayContaining(Object.keys(release100.entity_types)));
        expect(Object.keys(release110.relation_types)).toEqual(expect.arrayContaining(Object.keys(release100.relation_types)));
        expect(release110.constraints).toEqual(expect.arrayContaining(release100.constraints));
        expect(release110.inference_rules).toEqual(expect.arrayContaining(release100.inference_rules));
    });

    it('keeps 1.1.0 proposed and current at signed 1.0.0 before publication', () => {
        expect(ontologyIndex.current).toBe('1.0.0');
        expect(ontologyIndex.releases.find((release) => release.version === '1.1.0')).toMatchObject({ status: 'proposed' });
        expect(release110.governance.decision_id).toBe('dec_ontology_1_1_0_person_supersession_20260821');
    });
});
