import { describe, expect, it } from 'vitest';
import manifest from '../../../config/ontology/releases/1.0.0.json';
import { ENTITY_TYPE_REGISTRY } from '../../../mcp/brainbase/src/indexer/ontology.ts';

describe('Ontology MCP projection', () => {
    it('keeps every MCP public/storage type and visibility in the canonical manifest', () => {
        for (const registration of ENTITY_TYPE_REGISTRY) {
            const definition = manifest.entity_types[registration.type];
            expect(definition, registration.type).toBeDefined();
            expect(definition.category, registration.type).toBe(registration.category);
            expect(definition.default_search, registration.type).toBe(registration.defaultSearch);
            if (registration.storageType) {
                expect(definition.storage_type, registration.type).toBe(registration.storageType);
                expect(manifest.entity_types[registration.storageType]?.public_type).toBe(registration.type);
            }
        }
    });
});
