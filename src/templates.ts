import type { GraphFile, RelationshipsFile } from './types.js';

export const emptyGraph: GraphFile = {
  version: 1,
  owner: {},
  entities: []
};

export const emptyRelationships: RelationshipsFile = {
  version: 1,
  relationships: []
};

export const schemaTemplates: Record<string, unknown> = {
  'graph.schema.json': {
    type: 'object',
    required: ['version', 'entities'],
    properties: {
      version: { const: 1 },
      owner: {
        type: 'object',
        properties: {
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
            type: { enum: ['person', 'org', 'project', 'relationship'] },
            name: { type: 'string', minLength: 1 },
            summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' }
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
      tags: { type: 'array', items: { type: 'string' } },
      updatedAt: { type: 'string' }
    }
  }
};
