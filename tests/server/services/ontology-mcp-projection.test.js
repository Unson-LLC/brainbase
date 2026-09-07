import { describe, expect, it } from 'vitest';
import manifest from '../../../config/ontology/releases/1.0.0.json';
import { ENTITY_TYPE_REGISTRY } from '../../../mcp/brainbase/src/indexer/ontology.ts';

describe('Ontology MCP projection', () => {
    it('keeps every MCP public/storage type and search visibility in the canonical manifest', () => {
        for (const registration of ENTITY_TYPE_REGISTRY) {
            const definition = manifest.entity_types[registration.type];
            expect(definition, registration.type).toBeDefined();
            expect(definition.default_search, registration.type).toBe(registration.defaultSearch);
            if (registration.storageType) {
                expect(definition.storage_type, registration.type).toBe(registration.storageType);
                expect(manifest.entity_types[registration.storageType]?.public_type).toBe(registration.type);
            }
        }
    });

    it('keeps the intentional initiative publication/category projection explicit', () => {
        const initiative = ENTITY_TYPE_REGISTRY.find(({ type }) => type === 'initiative');

        expect(manifest.entity_types.initiative.category).toBe('internal');
        expect(initiative?.category).toBe('extension');
    });
});
