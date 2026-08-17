import { createHash } from 'node:crypto';
import { portableOntology } from './ontology.js';
import { canonicalRelationRegistry } from './relation-registry.js';
import type { GraphFileV2, RelationshipsFile } from './types.js';

const ontologyReleaseManifest = deepFreeze({
  id: 'brainbase-personal-os' as const,
  version: portableOntology.version,
  ontology: portableOntology,
  relationRegistry: canonicalRelationRegistry
});

const ontologyReleaseDigest = `sha256:${createHash('sha256')
  .update(JSON.stringify(ontologyReleaseManifest))
  .digest('hex')}`;

export const canonicalGraphOntologyRelease = deepFreeze({
  manifest: ontologyReleaseManifest,
  binding: {
    id: ontologyReleaseManifest.id,
    version: ontologyReleaseManifest.version,
    releaseDigest: ontologyReleaseDigest
  }
});

export const emptyGraph: GraphFileV2 = {
  version: 2,
  ontology: canonicalGraphOntologyRelease.binding,
  owner: {},
  entities: [],
  edges: []
};

export const emptyRelationships: RelationshipsFile = {
  version: 1,
  relationships: []
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export const schemaTemplates: Record<string, unknown> = {
  'graph.schema.json': {
    type: 'object',
    required: ['version', 'ontology', 'entities', 'edges'],
    properties: {
      version: { const: 2 },
      ontology: {
        type: 'object',
        required: ['id', 'version', 'releaseDigest'],
        properties: {
          id: { const: 'brainbase-personal-os' },
          version: { type: 'string', minLength: 1 },
          releaseDigest: { type: 'string', minLength: 1 }
        }
      },
      owner: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          summary: { type: 'string' }
        }
      },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'type', 'name'],
          properties: {
            id: { type: 'string', minLength: 1 },
            type: { enum: ['person', 'org', 'project', 'decision'] },
            name: { type: 'string', minLength: 1 },
            aliases: { type: 'array', items: { type: 'string', minLength: 1 } },
            summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' }
          }
        }
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'fromId', 'relation', 'toId'],
          properties: {
            id: { type: 'string', minLength: 1 },
            fromId: { type: 'string', minLength: 1 },
            relation: {
              enum: ['member_of', 'participates_in', 'accountable_for', 'owned_by', 'governs', 'supersedes']
            },
            toId: { type: 'string', minLength: 1 },
            role: { type: 'string' },
            context: { type: 'string' },
            validFrom: { type: 'string', format: 'date-time' },
            validTo: { type: 'string', format: 'date-time' },
            provenance: {
              type: 'object',
              required: ['sourceKind'],
              properties: {
                sourceKind: { enum: ['user_approved', 'migration', 'import', 'onboarding'] },
                sourceId: { type: 'string' },
                evidenceHash: { type: 'string' }
              }
            }
          }
        }
      }
    }
  },
  'personal-kg.schema.json': {
    type: 'object',
    required: ['id', 'type', 'text'],
    properties: {
      id: { type: 'string', minLength: 1 },
      type: { enum: ['self', 'work', 'relationship', 'value', 'judgment', 'experience', 'sns_context'] },
      text: { type: 'string', minLength: 1 },
      tags: { type: 'array', items: { type: 'string' } },
      source: { type: 'string' },
      updatedAt: { type: 'string' }
    }
  },
  'relationships.schema.json': {
    type: 'object',
    required: ['version', 'relationships'],
    properties: {
      version: { const: 1 },
      relationships: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'person', 'context'],
          properties: {
            id: { type: 'string', minLength: 1 },
            person: { type: 'string', minLength: 1 },
            role: { type: 'string' },
            context: { type: 'string', minLength: 1 },
            tags: { type: 'array', items: { type: 'string' } },
            updatedAt: { type: 'string' }
          }
        }
      }
    }
  },
  'decisions.schema.json': {
    type: 'object',
    required: ['id', 'title', 'decision'],
    properties: {
      id: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1 },
      decision: { type: 'string', minLength: 1 },
      rationale: { type: 'string' },
      topic: { type: 'string', minLength: 1 },
      supersedes: { type: 'array', items: { type: 'string', minLength: 1 } },
      effectiveAt: { type: 'string', format: 'date-time' },
      tags: { type: 'array', items: { type: 'string' } },
      updatedAt: { type: 'string' }
    }
  }
};
