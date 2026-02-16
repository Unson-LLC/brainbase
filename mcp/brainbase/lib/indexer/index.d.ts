/**
 * brainbase Entity Indexer
 * Builds entity index from EntitySource (filesystem, API, or hybrid)
 */
import type { EntitySource } from '../sources/entity-source.js';
import type { EntityIndex, Entity, EntityType } from './types.js';
/**
 * Build the complete entity index from EntitySource
 */
export declare function buildIndex(source: EntitySource): Promise<EntityIndex>;
/**
 * Resolve a person name to their ID using alias mappings
 */
export declare function resolvePersonId(index: EntityIndex, nameOrAlias: string): string | undefined;
/**
 * Resolve an org name to its ID using alias mappings
 */
export declare function resolveOrgId(index: EntityIndex, nameOrAlias: string): string | undefined;
/**
 * Get all entities of a specific type
 */
export declare function getEntitiesByType(index: EntityIndex, type: EntityType): Entity[];
/**
 * Get an entity by type and ID
 */
export declare function getEntity(index: EntityIndex, type: EntityType, id: string): Entity | undefined;
/**
 * Search entities by keyword in content and names
 */
export declare function searchEntities(index: EntityIndex, query: string): Entity[];
/**
 * Get context for a specific topic/entity
 * Returns relevant entities and their relationships
 */
export declare function getContextForTopic(index: EntityIndex, topic: string): {
    primary: Entity | undefined;
    related: Entity[];
};
export type { EntityIndex, Entity, EntityType } from './types.js';
