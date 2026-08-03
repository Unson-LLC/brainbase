import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { resolveDataDir } from './paths.js';
import { auditPersonalOsDirectory, getOntologyImpact, inferDecisions, portableOntology, resolveOntologyVersion } from './ontology.js';
import { loadPersonalOs } from './ssot.js';
import { getContext, listEntities, onboardingStatus, searchAll, searchPersonalKg } from './tools.js';

const argsSchema = z.object({
  dataDir: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
  type: z.enum(['person', 'org', 'project', 'relationship', 'decision']).optional(),
  fromVersion: z.string().optional(),
  ontologyVersion: z.string().optional(),
  asOf: z.string().datetime({ offset: true }).optional()
});

export const toolDefinitions = [
  {
    name: 'get_context',
    description: 'Return initial AI context from local Graph and Personal KG canonical files.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' }
      }
    }
  },
  {
    name: 'list_entities',
    description: 'List person, org, project, relationship, and decision entities from local SSOT.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' },
        type: { enum: ['person', 'org', 'project', 'relationship', 'decision'] }
      }
    }
  },
  {
    name: 'search',
    description: 'Search canonical local Graph, Personal KG, relationships, and decisions.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        dataDir: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'search_personal_kg',
    description: 'Search owner-local Personal KG only.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        dataDir: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'onboarding_status',
    description: 'Report seeded areas, first value demo readiness, missing setup, and local connection status.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' }
      }
    }
  },
  {
    name: 'get_ontology',
    description: 'Return the bundled immutable Brainbase Portable Ontology Kernel release.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'audit_ontology',
    description: 'Audit local canonical Personal OS files using the active or recorded historical ontology semantics.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' },
        ontologyVersion: { enum: ['0.0.0', '1.0.0'] }
      }
    }
  },
  {
    name: 'infer_decisions',
    description: 'Derive active, superseded, and conflicting decisions using explicit ontology rules.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' },
        asOf: { type: 'string', format: 'date-time' },
        ontologyVersion: { enum: ['0.0.0', '1.0.0'] }
      }
    }
  },
  {
    name: 'ontology_impact',
    description: 'Describe compatibility, migration, and rollback from an ontology version to the active release.',
    inputSchema: {
      type: 'object',
      properties: {
        fromVersion: { type: 'string' }
      }
    }
  }
] as const;

export async function callBrainbaseTool(name: string, rawArgs: unknown = {}): Promise<unknown> {
  const args = argsSchema.parse(rawArgs ?? {});
  const dataDir = resolveDataDir(args.dataDir);

  switch (name) {
    case 'get_ontology':
      return portableOntology;
    case 'audit_ontology':
      return auditPersonalOsDirectory(dataDir, { ontologyVersion: resolveOntologyVersion(args.ontologyVersion) });
    case 'ontology_impact':
      return getOntologyImpact(args.fromVersion);
  }

  const os = await loadPersonalOs(dataDir);

  switch (name) {
    case 'get_context':
      return getContext(os);
    case 'list_entities':
      return listEntities(os, args.type);
    case 'search':
      if (!args.query) {
        throw new Error('search requires query');
      }
      return { results: searchAll(os, args.query, args.limit) };
    case 'search_personal_kg':
      if (!args.query) {
        throw new Error('search_personal_kg requires query');
      }
      return { results: searchPersonalKg(os, args.query, args.limit) };
    case 'onboarding_status':
      return onboardingStatus(os);
    case 'infer_decisions':
      return inferDecisions(os.decisions, {
        asOf: args.asOf,
        ontologyVersion: resolveOntologyVersion(args.ontologyVersion)
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createServer(): Server {
  const server = new Server(
    {
      name: 'brainbase-mcp',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...toolDefinitions]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callBrainbaseTool(request.params.name, request.params.arguments);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
