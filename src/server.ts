import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ConnectedOnboardingRuntime, type ConnectedOnboardingRun } from './connected-onboarding.js';
import { resolveDataDir } from './paths.js';
import { auditPersonalOsDirectory } from './ontology-ssot.js';
import { getOntologyImpact, inferPersonalOs, portableOntology, resolveOntologyVersion } from './ontology.js';
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

const sourceInventorySchema = z.object({
  id: z.string(),
  mode: z.enum(['mcp', 'drive', 'gmail', 'local_folder', 'single_document']),
  status: z.enum(['ready', 'waiting_for_authorization', 'unavailable', 'error', 'unconfirmed']),
  evidencePointer: z.string().optional(),
  permissionScope: z.array(z.string()).optional(),
  detail: z.string().optional()
}).strict();

const candidateSchema = z.object({
  kind: z.string(),
  payload: z.record(z.unknown()),
  observationClass: z.enum(['observed', 'inferred']),
  evidenceId: z.string()
}).strict();

const reviewActionSchema = z.discriminatedUnion('decision', [
  z.object({ candidateId: z.string(), decision: z.literal('approve'), reason: z.string() }).strict(),
  z.object({ candidateId: z.string(), decision: z.literal('edit'), reason: z.string(), payload: z.record(z.unknown()) }).strict(),
  z.object({ candidateId: z.string(), decision: z.literal('reject'), reason: z.string() }).strict(),
  z.object({ candidateId: z.string(), decision: z.literal('merge'), reason: z.string(), mergeIntoCandidateId: z.string() }).strict()
]);

const connectedSchemas = {
  brainbase_onboarding_start: z.object({
    dataDir: z.string().optional(),
    valueTarget: z.string(),
    sources: z.array(sourceInventorySchema)
  }).strict(),
  brainbase_onboarding_get: z.object({ dataDir: z.string().optional(), runId: z.string() }).strict(),
  brainbase_onboarding_ingest: z.object({
    dataDir: z.string().optional(),
    runId: z.string(),
    source: z.object({
      sourceId: z.string(),
      evidencePointer: z.string(),
      contentHash: z.string(),
      permissionSnapshot: z.record(z.unknown()),
      collectionStatus: z.literal('collected')
    }).strict(),
    candidates: z.array(candidateSchema)
  }).strict(),
  brainbase_onboarding_review: z.object({
    dataDir: z.string().optional(),
    runId: z.string(),
    actions: z.array(reviewActionSchema)
  }).strict(),
  brainbase_onboarding_first_value: z.discriminatedUnion('action', [
    z.object({
      dataDir: z.string().optional(),
      runId: z.string(),
      action: z.literal('record'),
      answerHash: z.string(),
      usedCanonicalIds: z.array(z.string()),
      missingContext: z.array(z.string()).optional()
    }).strict(),
    z.object({
      dataDir: z.string().optional(),
      runId: z.string(),
      action: z.literal('review'),
      verdict: z.enum(['useful', 'not_useful']),
      missingContext: z.array(z.string()).optional()
    }).strict()
  ])
} as const;

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
    description: 'Search all canonical local stores: Graph entities, Personal KG, relationships, and decisions. Use this for people and projects.',
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
    description: 'Search owner-local Personal KG only. People and projects are Graph entities, so use search for them.',
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
    name: 'brainbase_onboarding_start',
    description: 'Start a local first-value onboarding run from actually callable sources. The result exposes runId (also id); pass runId to every later onboarding tool.',
    inputSchema: {
      type: 'object', required: ['valueTarget', 'sources'], additionalProperties: false,
      properties: {
        dataDir: { type: 'string', description: 'Optional Personal OS directory.' }, valueTarget: { type: 'string', description: 'One concrete question the first useful answer should resolve.' },
        sources: { type: 'array', maxItems: 50, items: { type: 'object', required: ['id', 'mode', 'status'], additionalProperties: false, properties: {
          id: { type: 'string' }, mode: { enum: ['mcp', 'drive', 'gmail', 'local_folder', 'single_document'] },
          status: { enum: ['ready', 'waiting_for_authorization', 'unavailable', 'error', 'unconfirmed'] }, evidencePointer: { type: 'string' },
          permissionScope: { type: 'array', items: { type: 'string' } }, detail: { type: 'string' }
        } } }
      }
    }
  },
  {
    name: 'brainbase_onboarding_get',
    description: 'Read a connected-world onboarding run without exposing source or answer bodies.',
    inputSchema: { type: 'object', required: ['runId'], additionalProperties: false, properties: { dataDir: { type: 'string' }, runId: { type: 'string' } } }
  },
  {
    name: 'brainbase_onboarding_ingest',
    description: 'Ingest one selected source receipt under source plus review candidates. Do not flatten sourceId or receipt fields at the top level.',
    inputSchema: {
      type: 'object', required: ['runId', 'source', 'candidates'], additionalProperties: false,
      properties: {
        dataDir: { type: 'string' }, runId: { type: 'string', description: 'runId returned by brainbase_onboarding_start.' },
        source: { type: 'object', required: ['sourceId', 'evidencePointer', 'contentHash', 'permissionSnapshot', 'collectionStatus'], additionalProperties: false, properties: {
          sourceId: { type: 'string' }, evidencePointer: { type: 'string' }, contentHash: { type: 'string' }, permissionSnapshot: { type: 'object' }, collectionStatus: { const: 'collected' }
        } },
        candidates: { type: 'array', maxItems: 50, items: { type: 'object', required: ['kind', 'payload', 'observationClass', 'evidenceId'], additionalProperties: false, properties: {
          kind: { type: 'string' }, payload: { type: 'object' }, observationClass: { enum: ['observed', 'inferred'] }, evidenceId: { type: 'string' }
        } } }
      }
    }
  },
  {
    name: 'brainbase_onboarding_review',
    description: 'Submit review decisions in actions. Inferred candidates cannot be approved or merged; use edit with a human-confirmed payload, or reject.',
    inputSchema: {
      type: 'object', required: ['runId', 'actions'], additionalProperties: false,
      properties: { dataDir: { type: 'string' }, runId: { type: 'string', minLength: 1, maxLength: 200 }, actions: { type: 'array', minItems: 1, maxItems: 50, items: {
        oneOf: [
          { type: 'object', required: ['candidateId', 'decision', 'reason'], additionalProperties: false, properties: {
            candidateId: { type: 'string', minLength: 1, maxLength: 200 }, decision: { const: 'approve' }, reason: { type: 'string', minLength: 1, maxLength: 500 }
          } },
          { type: 'object', required: ['candidateId', 'decision', 'reason', 'payload'], additionalProperties: false, properties: {
            candidateId: { type: 'string', minLength: 1, maxLength: 200 }, decision: { const: 'edit' }, reason: { type: 'string', minLength: 1, maxLength: 500 }, payload: { type: 'object' }
          } },
          { type: 'object', required: ['candidateId', 'decision', 'reason'], additionalProperties: false, properties: {
            candidateId: { type: 'string', minLength: 1, maxLength: 200 }, decision: { const: 'reject' }, reason: { type: 'string', minLength: 1, maxLength: 500 }
          } },
          { type: 'object', required: ['candidateId', 'decision', 'reason', 'mergeIntoCandidateId'], additionalProperties: false, properties: {
            candidateId: { type: 'string', minLength: 1, maxLength: 200 }, decision: { const: 'merge' }, reason: { type: 'string', minLength: 1, maxLength: 500 }, mergeIntoCandidateId: { type: 'string', minLength: 1, maxLength: 200 }
          } }
        ]
      } } }
    }
  },
  {
    name: 'brainbase_onboarding_first_value',
    description: 'Finish onboarding in two calls. First choose action=record with an answer hash and promoted canonical IDs. Then choose action=review with useful or not_useful.',
    inputSchema: {
      type: 'object', required: ['runId', 'action'], additionalProperties: false,
      properties: {
        dataDir: { type: 'string', description: 'Optional Personal OS directory.' },
        runId: { type: 'string', minLength: 1, maxLength: 200, description: 'runId returned by the previous onboarding step.' },
        action: { enum: ['record', 'review'], description: 'Use record first. Use review only after the answer receipt has been recorded.' },
        answerHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$', description: 'Required for action=record. SHA-256 of the answer body; the body itself is not stored.' },
        usedCanonicalIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Required for action=record. Use only promotedCanonicalIds returned by review.' },
        verdict: { enum: ['useful', 'not_useful'], description: 'Required for action=review.' },
        missingContext: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Optional short labels for context the answer still lacked.' }
      }
    }
  },
  {
    name: 'get_ontology',
    description: 'Return a beginner guide followed by the bundled immutable Brainbase Portable Ontology Kernel release.',
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
  if (name in connectedSchemas) {
    return callConnectedOnboardingTool(name as keyof typeof connectedSchemas, rawArgs);
  }
  const args = argsSchema.parse(rawArgs ?? {});
  const dataDir = resolveDataDir(args.dataDir);

  switch (name) {
    case 'get_ontology':
      return {
        beginnerGuide: {
          oneSentence: 'The ontology is Brainbase\'s machine-checkable agreement about entity meanings, relationships, validation, inference, and safe change.',
          fiveParts: [
            { id: 'types', question: 'What kind of thing is this?', example: 'person, org, project, relationship, decision' },
            { id: 'relations', question: 'How are two things connected?', example: 'a decision supersedes another decision' },
            { id: 'constraints', question: 'What must be true before data is accepted?', example: 'a supersedes ID must resolve to an existing decision' },
            { id: 'inference', question: 'What can Brainbase conclude from explicit facts?', example: 'an explicitly superseded decision becomes inactive' },
            { id: 'evolution', question: 'How can meanings change without losing history?', example: 'audit, migrate, and keep rollback instructions' }
          ],
          suggestedNextTools: ['audit_ontology', 'infer_decisions', 'ontology_impact']
        },
        ...portableOntology
      };
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
      return inferPersonalOs(os, {
        asOf: args.asOf,
        ontologyVersion: resolveOntologyVersion(args.ontologyVersion)
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function callConnectedOnboardingTool(name: keyof typeof connectedSchemas, rawArgs: unknown): Promise<unknown> {
  const schema = connectedSchemas[name];
  const args = schema.parse(rawArgs ?? {}) as Record<string, unknown> & { dataDir?: string; runId?: string };
  const runtime = new ConnectedOnboardingRuntime(resolveDataDir(args.dataDir));
  switch (name) {
    case 'brainbase_onboarding_start':
      return runtime.start(args as Parameters<ConnectedOnboardingRuntime['start']>[0])
        .then(withOnboardingGuidance);
    case 'brainbase_onboarding_get':
      return runtime.get(args.runId!).then(withOnboardingGuidance);
    case 'brainbase_onboarding_ingest': {
      const { runId, dataDir: _dataDir, ...input } = args;
      return runtime.ingest(runId!, input as Parameters<ConnectedOnboardingRuntime['ingest']>[1]).then(withOnboardingGuidance);
    }
    case 'brainbase_onboarding_review':
      return runtime.review(args.runId!, args.actions as Parameters<ConnectedOnboardingRuntime['review']>[1]).then(withOnboardingGuidance);
    case 'brainbase_onboarding_first_value': {
      const { runId, dataDir: _dataDir, ...input } = args;
      return runtime.firstValue(runId!, input as Parameters<ConnectedOnboardingRuntime['firstValue']>[1]).then(withOnboardingGuidance);
    }
  }
}

function withOnboardingGuidance(run: ConnectedOnboardingRun): ConnectedOnboardingRun & {
  runId: string;
  nextAction: { tool: string; instruction: string; requiredIds: string[] } | null;
} {
  const pendingCandidateIds = run.candidates
    .filter((candidate) => candidate.reviewStatus === 'pending')
    .map((candidate) => candidate.id);
  const nextAction = (() => {
    switch (run.state) {
      case 'initialized':
        return { tool: 'brainbase_onboarding_start', instruction: 'No source is ready. Authorize or add one callable source, then start a new run.', requiredIds: [] };
      case 'source_ready':
        return { tool: 'brainbase_onboarding_ingest', instruction: 'Ingest a receipt and review candidates from one selected ready source.', requiredIds: run.selectedSourceIds };
      case 'candidates_ready':
        return { tool: 'brainbase_onboarding_review', instruction: 'Review every pending candidate. Inferred candidates require edit with a human-confirmed payload, or reject.', requiredIds: pendingCandidateIds };
      case 'promotion_reviewed':
        return { tool: 'brainbase_onboarding_first_value', instruction: 'Use action=record with an answerHash and promotedCanonicalIds.', requiredIds: run.promotedCanonicalIds };
      case 'first_value_ready':
        return { tool: 'brainbase_onboarding_first_value', instruction: 'Use action=review with verdict useful or not_useful.', requiredIds: [] };
      case 'first_value_answer_reviewed':
        return null;
    }
  })();
  return { ...run, runId: run.id, nextAction };
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
