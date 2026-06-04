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
      owner: { type: 'object' },
      entities: { type: 'array' }
    }
  },
  'personal-kg.schema.json': {
    type: 'object',
    required: ['id', 'type', 'text'],
    properties: {
      id: { type: 'string' },
      type: { enum: ['self', 'work', 'relationship', 'value', 'judgment', 'experience', 'sns_context'] },
      text: { type: 'string' }
    }
  },
  'relationships.schema.json': {
    type: 'object',
    required: ['version', 'relationships'],
    properties: {
      version: { const: 1 },
      relationships: { type: 'array' }
    }
  },
  'decisions.schema.json': {
    type: 'object',
    required: ['id', 'title', 'decision'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      decision: { type: 'string' }
    }
  }
};
