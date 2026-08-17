import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ConnectedOnboardingRuntime, type ConnectedOnboardingRun } from './connected-onboarding.js';
import { validateCanonicalGraph } from './canonical-graph.js';
import { resolveText } from './entity-resolution.js';
import { resolveDataDir } from './paths.js';
import { auditPersonalOsDirectory } from './ontology-ssot.js';
import { getOntologyImpact, inferPersonalOs, portableOntology, resolveOntologyVersion } from './ontology.js';
import { loadPersonalOs } from './ssot.js';
import { getContext, listEntities, onboardingStatus, searchAll, searchPersonalKg } from './tools.js';
import type { CanonicalEntityKind, GraphFileV2 } from './types.js';

const argsSchema = z.object({
  dataDir: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
  type: z.enum(['person', 'org', 'project', 'relationship', 'decision']).optional(),
  fromVersion: z.string().optional(),
  ontologyVersion: z.string().optional(),
  asOf: z.string().datetime({ offset: true }).optional(),
  project: z.string().min(1).optional(),
  as_of: z.string().datetime({ offset: true }).optional()
});

const mentionSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive()
}).strict().refine((span) => span.end > span.start, { message: 'mention span end must be after start' });

const resolveEntitySchema = z.object({
  dataDir: z.string().optional(),
  text: z.string(),
  asOf: z.string().datetime({ offset: true }),
  mentionSpans: z.array(mentionSpanSchema).optional(),
  projectScope: z.object({
    projectIds: z.array(z.string().min(1)).min(1),
    policy: z.enum(['strict', 'prefer_project', 'allow_global_fallback']).optional()
  }).strict().optional(),
  entityTypes: z.array(z.enum(['person', 'org', 'project', 'decision'])).min(1).optional()
}).strict().superRefine((value, context) => {
  for (const [index, span] of (value.mentionSpans ?? []).entries()) {
    if (span.end > value.text.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mentionSpans', index, 'end'],
        message: 'mention span must be within text'
      });
    }
  }
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
      verdict: z.enum(['useful', 'not_useful']).optional(),
      missingContext: z.array(z.string()).optional()
    }).strict(),
    z.object({
      dataDir: z.string().optional(),
      runId: z.string(),
      action: z.literal('review'),
      answerHash: z.string().optional(),
      usedCanonicalIds: z.array(z.string()).optional(),
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
        dataDir: { type: 'string' },
        project: { type: 'string', description: 'Optional canonical project ID, name, or alias.' },
        as_of: { type: 'string', format: 'date-time', description: 'RFC 3339 validity instant. Defaults to now.' }
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
        limit: { type: 'number' },
        project: { type: 'string', description: 'Optional canonical project ID, name, or alias.' },
        as_of: { type: 'string', format: 'date-time', description: 'RFC 3339 validity instant. Defaults to now.' }
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
        ontologyVersion: { enum: ['0.0.0', '1.0.0', '2.0.0'] }
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
        ontologyVersion: { enum: ['0.0.0', '1.0.0', '2.0.0'] }
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
  },
  {
    name: 'resolve_entity',
    description: 'Resolve mentions in text to canonical Graph v2 entity IDs and return a privacy-safe evidence receipt.',
    inputSchema: {
      type: 'object',
      required: ['text', 'asOf'],
      additionalProperties: false,
      properties: {
        dataDir: { type: 'string', description: 'Optional Personal OS directory.' },
        text: { type: 'string', description: 'Text whose entity mentions should be resolved. The text is hashed, not stored in the receipt.' },
        asOf: { type: 'string', format: 'date-time', description: 'RFC 3339 instant used for temporal entity and edge validity.' },
        mentionSpans: {
          type: 'array',
          items: {
            type: 'object',
            required: ['start', 'end'],
            additionalProperties: false,
            properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 } }
          }
        },
        projectScope: {
          type: 'object',
          required: ['projectIds'],
          additionalProperties: false,
          properties: {
            projectIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            policy: { enum: ['strict', 'prefer_project', 'allow_global_fallback'] }
          }
        },
        entityTypes: {
          type: 'array',
          minItems: 1,
          items: { enum: ['person', 'org', 'project', 'decision'] }
        }
      }
    }
  }
] as const;

export async function callBrainbaseTool(name: string, rawArgs: unknown = {}): Promise<unknown> {
  if (name in connectedSchemas) {
    return callConnectedOnboardingTool(name as keyof typeof connectedSchemas, rawArgs);
  }
  if (name === 'resolve_entity') {
    return callResolveEntityTool(rawArgs);
  }
  const args = argsSchema.parse(rawArgs ?? {});
  const dataDir = resolveDataDir(args.dataDir);

  switch (name) {
    case 'get_ontology':
      return {
        beginnerGuide: {
          startHere: 'まずここだけ読めば大丈夫です。下の業務例から全体像をつかみ、必要なときだけ正式契約を確認してください。',
          oneSentence: 'オントロジーは、仕事の言葉・つながり・守る条件・判断方法・変更履歴を、Brainbaseと人が同じ意味で扱うための約束です。',
          workExample: '例: 「新しい方針が旧方針を置き換えた」と登録すると、Brainbaseは新しい方針を現在有効な判断として扱い、旧方針も履歴として残します。',
          fiveParts: [
            { id: 'types', name: '種類', question: 'これは何ですか？', example: '人、組織、プロジェクト、関係、意思決定' },
            { id: 'relations', name: '関係', question: '何とどうつながっていますか？', example: '新しい意思決定が旧意思決定を置き換える' },
            { id: 'constraints', name: '必須条件', question: '登録前に何が揃っている必要がありますか？', example: '置き換える相手の意思決定が実在する' },
            { id: 'inference', name: '判断規則', question: '明示した事実から何を判断しますか？', example: '置き換えられた旧意思決定は現在有効ではない' },
            { id: 'evolution', name: '変更履歴', question: '履歴を失わずに意味をどう変えますか？', example: '監査して新しい版へ移行し、戻し方も残す' }
          ],
          changeSafety: {
            check: '変更前は ontology_impact で影響を確認し、audit_ontology で現在の不整合を調べます。',
            recover: '誤った定義は履歴を消さず、新しい版で訂正し、移行と戻し方を記録します。'
          },
          unsafeShortcuts: [
            {
              request: '旧方針や変更履歴を削除して最新版だけにする',
              handling: 'reject_and_explain',
              safeAlternative: '履歴は削除せず、新しい版を作り、supersedes と有効日を記録して置き換えます。'
            },
            {
              request: '影響確認や監査を完了扱いにして先へ進む',
              handling: 'reject_and_explain',
              safeAlternative: 'ontology_impact と audit_ontology の実行結果を確認してから完了とします。'
            },
            {
              request: '必須項目を空欄のまま自動で補って登録する',
              handling: 'reject_and_explain',
              safeAlternative: '不足項目を明示し、根拠を確認できるまで登録せず候補として残します。'
            }
          ],
          toolChooser: [
            { goal: '変更の影響を知りたい', tool: 'ontology_impact', when: '定義や関係を変える前に実行します。' },
            { goal: '現在の不整合を調べたい', tool: 'audit_ontology', when: '変更前の現状確認と、変更後の再確認に使います。' },
            { goal: '現在有効な判断を知りたい', tool: 'infer_decisions', when: '旧判断を除き、今使う判断を確かめるときに使います。' }
          ],
          changeChecklist: [
            '変更前: ontology_impact で影響を確認する。',
            '変更前: audit_ontology で現在の不整合を確認する。',
            '変更時: 旧版を消さず、新版に supersedes と有効日を記録する。',
            '変更後: audit_ontology の実行結果を確認し、未実行なら完了扱いにしない。',
            '問題時: 履歴を残したまま訂正版と戻し方を記録する。'
          ],
          detailsNotice: '以下の正式契約は、実装・監査・詳しい確認が必要なときに読みます。',
          suggestedNextTools: ['audit_ontology', 'infer_decisions', 'ontology_impact']
        },
        ...portableOntology
      };
    case 'audit_ontology':
      return auditPersonalOsDirectory(dataDir, {
        ontologyVersion: args.ontologyVersion === undefined
          ? undefined
          : resolveOntologyVersion(args.ontologyVersion)
      });
    case 'ontology_impact':
      return getOntologyImpact(args.fromVersion);
  }

  const os = await loadPersonalOs(dataDir);

  switch (name) {
    case 'get_context':
      return getContext(os, { project: args.project, asOf: args.as_of ?? args.asOf });
    case 'list_entities':
      return listEntities(os, args.type);
    case 'search':
      if (!args.query) {
        throw new Error('search requires query');
      }
      return { results: searchAll(os, args.query, args.limit, { project: args.project, asOf: args.as_of ?? args.asOf }) };
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
        ontologyVersion: args.ontologyVersion === undefined
          ? undefined
          : resolveOntologyVersion(args.ontologyVersion)
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function callResolveEntityTool(rawArgs: unknown): Promise<unknown> {
  const args = resolveEntitySchema.parse(rawArgs ?? {});
  const dataDir = resolveDataDir(args.dataDir);
  const graphPath = join(dataDir, 'graph.json');
  let serialized: string;
  try {
    serialized = await readFile(graphPath, 'utf8');
  } catch {
    return blockedResolution(args, 'unavailable', 'graph_unavailable');
  }

  let graph: unknown;
  try {
    graph = JSON.parse(serialized);
  } catch {
    return blockedResolution(args, 'invalid', 'graph_invalid');
  }
  try {
    validateCanonicalGraph(graph);
  } catch {
    return blockedResolution(args, 'invalid', 'graph_invalid');
  }
  if (isGraphVersion(graph, 1)) {
    return {
      status: 'migration_required',
      graphSchemaVersion: 1,
      requiredAction: 'migrate_graph_v2'
    };
  }
  if (!isGraphVersion(graph, 2)) {
    return blockedResolution(args, 'invalid', 'graph_invalid');
  }

  const receipt = resolveText({
    text: args.text,
    ...(args.mentionSpans ? { mentionSpans: args.mentionSpans } : {}),
    ...(args.projectScope ? { projectScope: args.projectScope } : {}),
    asOf: args.asOf,
    ...(args.entityTypes ? { entityTypes: args.entityTypes as CanonicalEntityKind[] } : {}),
    source: {
      authority: 'local_graph',
      status: 'complete',
      revision: createHash('sha256').update(serialized).digest('hex'),
      graph: graph as GraphFileV2
    }
  }).receipt;
  return { status: 'verified', receipt };
}

function blockedResolution(
  args: z.infer<typeof resolveEntitySchema>,
  sourceStatus: 'unavailable' | 'invalid',
  issueCode: 'graph_unavailable' | 'graph_invalid'
): { status: 'unverified'; receipt: ReturnType<typeof resolveText>['receipt'] } {
  const receipt = resolveText({
    text: args.text,
    ...(args.mentionSpans ? { mentionSpans: args.mentionSpans } : {}),
    ...(args.projectScope ? { projectScope: args.projectScope } : {}),
    asOf: args.asOf,
    ...(args.entityTypes ? { entityTypes: args.entityTypes as CanonicalEntityKind[] } : {}),
    source: {
      authority: 'local_graph',
      status: sourceStatus,
      issues: [{ code: issueCode, message: issueCode }]
    }
  }).receipt;
  return { status: 'unverified', receipt };
}

function isGraphVersion(graph: unknown, version: 1 | 2): graph is { version: 1 | 2 } {
  return Boolean(graph && typeof graph === 'object' && 'version' in graph && (graph as { version?: unknown }).version === version);
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
      const input: Parameters<ConnectedOnboardingRuntime['firstValue']>[1] = args.action === 'record'
        ? {
            action: 'record',
            answerHash: args.answerHash as string,
            usedCanonicalIds: args.usedCanonicalIds as string[],
            missingContext: args.missingContext as string[] | undefined
          }
        : {
            action: 'review',
            verdict: args.verdict as 'useful' | 'not_useful',
            missingContext: args.missingContext as string[] | undefined
          };
      return runtime.firstValue(args.runId!, input).then(withOnboardingGuidance);
    }
  }
}

function withOnboardingGuidance(run: ConnectedOnboardingRun): ConnectedOnboardingRun & {
  runId: string;
  guide: { current: string; completed: string[]; remaining: string; plainText: string };
  safetyBoundaries: {
    mode: 'mandatory';
    review: string;
    resume: string;
    completion: string;
  };
  nextAction: {
    tool: string;
    label: string;
    instruction: string;
    requiredIds: string[];
    inputHelp: Array<{ field: string; meaning: string; source: string }>;
    confirmation: { changes: string; reversible: boolean; recovery: string; cannotSkip: string; resumeRule: string };
  } | null;
} {
  const pendingCandidateIds = run.candidates
    .filter((candidate) => candidate.reviewStatus === 'pending')
    .map((candidate) => candidate.id);
  const nextAction = (() => {
    switch (run.state) {
      case 'initialized':
        return onboardingAction('brainbase_onboarding_start', '利用できる情報源を準備する', '利用を許可するか、読み取れる情報源を追加して、新しいオンボーディングを開始します。', [], '新しい実行を作成します。既存データは変更しません。', true, '準備できない場合は開始せず、情報源の設定に戻れます。');
      case 'source_ready':
        return onboardingAction('brainbase_onboarding_ingest', '準備できた情報源を取り込む', '選択済みの情報源から、証拠の記録と確認候補を取り込みます。', run.selectedSourceIds, '確認待ちの候補を作ります。まだ正式な情報にはなりません。', true, '取り込み後も、候補を却下すれば正式な情報には反映されません。');
      case 'candidates_ready':
        return onboardingAction('brainbase_onboarding_review', '候補を確認する', 'すべての候補を確認します。推測された候補は、人が確認した内容へ edit するか、reject で却下してください。', pendingCandidateIds, '確認した候補だけを正式な情報として登録します。', true, '確信がなければ却下できます。誤って登録した場合も履歴を残して訂正できます。');
      case 'promotion_reviewed':
        return onboardingAction('brainbase_onboarding_first_value', '最初の回答を記録する', 'action=record と回答の answerHash、登録済みIDを使って、回答の記録だけを保存します。', run.promotedCanonicalIds, '回答本文ではなくハッシュと使用したIDを記録します。', true, '回答本文は保存されません。記録後に役立ったかを確認できます。');
      case 'first_value_ready':
        return onboardingAction('brainbase_onboarding_first_value', '回答が役立ったか評価する', 'action=review と verdict=useful または not_useful を使って評価します。', [], '最初の回答に対する評価を記録し、オンボーディングを完了します。', true, '役立たなかった場合は not_useful と不足情報を記録できます。');
      case 'first_value_answer_reviewed':
        return null;
    }
  })();
  const baseGuide = onboardingGuide(run.state);
  const safetyBoundaries = {
    mode: 'mandatory' as const,
    review: '候補の全件自動承認や確認の省略は行いません。候補ごとに根拠を確認し、承認・編集・却下を選びます。',
    resume: `中断後は同じ runId ${run.id} を取得し、表示された次の操作だけを続けます。`,
    completion: '完了済みの操作は再実行しません。現在の状態と残りの操作を確認してから続けます。'
  };
  const guardedNextAction = nextAction === null ? null : {
    ...nextAction,
    inputHelp: onboardingInputHelp(run),
    confirmation: {
      ...nextAction.confirmation,
      cannotSkip: '確認の省略や全件自動承認はできません。必要なIDごとに内容と根拠を確認してください。',
      resumeRule: `同じ runId ${run.id} で現在状態を取得し、完了済みの操作は繰り返さず、この操作だけを実行します。`
    }
  };
  const guide = {
    ...baseGuide,
    plainText: guardedNextAction === null
      ? `${baseGuide.current} 残りの操作はありません。runIdは${run.id}です。完了済み操作は繰り返しません。`
      : `${baseGuide.current} 次は「${guardedNextAction.label}」だけを行います。runIdは${run.id}です。${baseGuide.remaining}`
  };
  return { guide, nextAction: guardedNextAction, safetyBoundaries, ...run, runId: run.id };
}

function onboardingInputHelp(run: ConnectedOnboardingRun): Array<{ field: string; meaning: string; source: string }> {
  switch (run.state) {
    case 'initialized':
      return [{ field: 'sources', meaning: '利用を許可する情報源', source: '準備済みまたは許可待ちの情報源一覧から選びます。' }];
    case 'source_ready':
      return [{ field: 'sourceId', meaning: '今回取り込む情報源', source: 'nextAction.requiredIds に表示されたIDを使います。' }];
    case 'candidates_ready':
      return [
        { field: 'candidateId', meaning: '確認する候補', source: 'nextAction.requiredIds に表示されたIDを一件ずつ使います。' },
        { field: 'decision', meaning: '確認結果', source: '内容を確認して edit、確信がなければ reject を選びます。' }
      ];
    case 'promotion_reviewed':
      return [
        { field: 'answerHash', meaning: '回答本文を保存せず同じ回答を識別する値', source: '直前に作った回答からエージェントが生成し、利用者は対象回答だけ確認します。' },
        { field: 'usedCanonicalIds', meaning: '回答で使った正式情報', source: '直前の promotedCanonicalIds から、実際に回答で使ったIDを選びます。' }
      ];
    case 'first_value_ready':
      return [{ field: 'verdict', meaning: '回答が役立ったか', source: '利用者が useful または not_useful を選びます。' }];
    case 'first_value_answer_reviewed':
      return [];
  }
}

function onboardingAction(
  tool: string,
  label: string,
  instruction: string,
  requiredIds: string[],
  changes: string,
  reversible: boolean,
  recovery: string
) {
  return { tool, label, instruction, requiredIds, confirmation: { changes, reversible, recovery } };
}

function onboardingGuide(state: ConnectedOnboardingRun['state']): { current: string; completed: string[]; remaining: string } {
  const guides = {
    initialized: {
      current: '利用できる情報源を準備する段階です。',
      completed: [],
      remaining: '情報源の準備、取り込み、候補の確認、最初の回答の評価が残っています。'
    },
    source_ready: {
      current: '利用する情報源を選びました。',
      completed: ['情報源の選択'],
      remaining: '情報の取り込み、候補の確認、最初の回答の評価が残っています。'
    },
    candidates_ready: {
      current: '取り込んだ候補を確認する段階です。',
      completed: ['情報源の選択', '情報の取り込み'],
      remaining: '候補の確認、最初の回答の記録と評価が残っています。'
    },
    promotion_reviewed: {
      current: '確認済みの候補を正式な情報として登録しました。',
      completed: ['情報源の選択', '情報の取り込み', '候補の確認'],
      remaining: '最初の回答の記録と評価が残っています。'
    },
    first_value_ready: {
      current: '最初の回答を記録しました。',
      completed: ['情報源の選択', '情報の取り込み', '候補の確認', '最初の回答の記録'],
      remaining: '回答が役立ったかの評価が残っています。'
    },
    first_value_answer_reviewed: {
      current: '最初の回答の評価まで完了しました。',
      completed: ['情報源の選択', '情報の取り込み', '候補の確認', '最初の回答の記録', '回答の評価'],
      remaining: 'ありません。'
    }
  } satisfies Record<ConnectedOnboardingRun['state'], { current: string; completed: string[]; remaining: string }>;
  return guides[state];
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
