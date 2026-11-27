import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer, toolDefinitions } from '../src/server.js';
import { foundationPublicToolDefinitions, type FoundationPublicConnection } from '../src/foundation-public-provider.js';
import { foundationAdoptionTools, foundationPublicTools } from '../src/foundation-authenticated-tools.js';
import { judgmentFrameTools, judgmentModelOutcomeTools } from '../src/judgment-frame.js';
import { judgmentFrameReadTools } from '../src/judgment-frame-read.js';
import {
  JUDGMENT_NODE_EVIDENCE_CONTRACT,
  JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION,
  evaluateJudgmentNodeEvidence,
  normalizeJudgmentNodeResult,
} from '../src/judgment-node-evidence.js';
import { knowledgeLookupTools } from '../src/knowledge-lookup.js';
import { queueTaskToolDefinitions } from '../src/queue-task-tools.js';
import {
  createLocalMcpServer,
  runLocalMcpServer,
  type LocalMcpRuntimeTool,
} from '../src/mcp-runtime.js';
import {
  applyMcpToolSchemaProfile,
  assertMcpToolSchemasPortable,
  normalizeMcpToolForPortability,
  normalizeMcpToolInputSchemaForPortability,
  normalizeMcpToolInputSchemaForProfile,
  resolveMcpToolSchemaProfile,
  validateMcpToolInputSchemaPortability,
  validateMcpToolSchemaPortability,
  type McpToolSchemaPortabilityIssue,
  type McpToolSchemaPortabilityIssueCode,
  type McpToolSchemaProfile,
} from '../src/mcp-tool-schema-portability.js';

async function listToolsFromServer(server: ReturnType<typeof createServer>): Promise<Tool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'schema-portability-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

const dummyFoundation: FoundationPublicConnection = {
  provider: {
    describe: () => { throw new Error('unused'); },
    read: async () => { throw new Error('unused'); },
    validate: async () => { throw new Error('unused'); },
    validateProblem: async () => { throw new Error('unused'); },
  },
  resolveContext: () => null,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MCP tool inputSchema cross-client portability contract (Gemini / OpenAI / Claude / Codex)', () => {
  it('lists only Gemini-compatible schemas from createServer() in local, managed_cloud, and foundation_connected modes', async () => {
    vi.stubEnv('BRAINBASE_PERSONAL_KNOWLEDGE_MODE', 'local');
    vi.stubEnv('BRAINBASE_PERSONAL_KG_STORAGE_MODE', 'local');
    const localTools = await listToolsFromServer(createServer());
    expect(localTools.length).toBeGreaterThan(0);
    expect(localTools.flatMap(validateMcpToolSchemaPortability)).toEqual([]);

    const foundationTools = await listToolsFromServer(createServer({ foundation: dummyFoundation }));
    expect(foundationTools.length).toBeGreaterThan(localTools.length);
    expect(foundationTools.flatMap(validateMcpToolSchemaPortability)).toEqual([]);

    vi.stubEnv('BRAINBASE_PERSONAL_KNOWLEDGE_MODE', 'managed_cloud');
    vi.stubEnv('BRAINBASE_PERSONAL_KG_STORAGE_MODE', 'managed_cloud');
    const managedTools = await listToolsFromServer(createServer());
    expect(managedTools.length).toBe(4);
    expect(managedTools.flatMap(validateMcpToolSchemaPortability)).toEqual([]);
  });

  it('keeps every raw exported MCP tool definition across the repository portable without relying on runtime patching', () => {
    const allExportedGroups: Array<{ group: string; tools: readonly Tool[] }> = [
      { group: 'server.toolDefinitions', tools: toolDefinitions as unknown as Tool[] },
      { group: 'foundation-public-provider.foundationPublicToolDefinitions', tools: foundationPublicToolDefinitions as unknown as Tool[] },
      { group: 'foundation-authenticated-tools.foundationPublicTools', tools: foundationPublicTools },
      { group: 'foundation-authenticated-tools.foundationAdoptionTools', tools: foundationAdoptionTools },
      { group: 'judgment-frame.judgmentFrameTools', tools: judgmentFrameTools },
      { group: 'judgment-frame.judgmentModelOutcomeTools', tools: judgmentModelOutcomeTools },
      { group: 'judgment-frame-read.judgmentFrameReadTools', tools: judgmentFrameReadTools },
      { group: 'knowledge-lookup.knowledgeLookupTools', tools: knowledgeLookupTools },
      { group: 'queue-task-tools.queueTaskToolDefinitions', tools: queueTaskToolDefinitions },
    ];

    for (const { group, tools } of allExportedGroups) {
      expect(tools.length, `${group} should contain tools`).toBeGreaterThan(0);
      const issues = tools.flatMap(validateMcpToolSchemaPortability);
      expect(issues, `${group} has non-portable MCP tool schemas`).toEqual([]);
    }
  });

  it('lists portable schemas from createLocalMcpServer() across all shared tool suites', async () => {
    const noopHandler: LocalMcpRuntimeTool['handler'] = async () => ({ content: [] });
    const allHostedTools: Tool[] = [
      ...foundationPublicTools,
      ...foundationAdoptionTools,
      ...judgmentFrameTools,
      ...judgmentModelOutcomeTools,
      ...judgmentFrameReadTools,
      ...knowledgeLookupTools,
      ...queueTaskToolDefinitions,
    ];
    const server = createLocalMcpServer({
      name: 'portability-suite',
      version: '1.0.0',
      tools: allHostedTools.map((definition) => ({ definition, handler: noopHandler })),
    });
    const listed = await listToolsFromServer(server);
    expect(listed.map((t) => t.name)).toEqual(allHostedTools.map((t) => t.name));
    expect(() => assertMcpToolSchemasPortable(listed)).not.toThrow();
  });

  it('is idempotent on already-portable schemas such as queueTaskToolDefinitions', () => {
    for (const tool of queueTaskToolDefinitions) {
      expect(normalizeMcpToolInputSchemaForPortability(tool.inputSchema)).toEqual(tool.inputSchema);
    }
  });

  it('normalizes prefixItems tuple schemas (such as presented_sections) into Gemini-compatible array items', async () => {
    const nonPortableTool: Tool = {
      name: 'brainbase_onboarding_first_value',
      description: 'Reproducer for Antigravity Gemini 400 missing items error.',
      inputSchema: {
        type: 'object',
        required: ['runId', 'presented_sections'],
        additionalProperties: false,
        properties: {
          runId: { type: 'string' },
          presented_sections: {
            type: 'array',
            prefixItems: [
              { const: '覚えていたこと' },
              { const: 'つながったこと' },
              { const: '次にできること' },
            ],
            minItems: 3,
            maxItems: 3,
          },
        },
      } as Tool['inputSchema'],
    };

    const issuesBefore: McpToolSchemaPortabilityIssue[] = validateMcpToolSchemaPortability(nonPortableTool);
    expect(issuesBefore.some((issue) => issue.code === 'array_items_missing')).toBe(true);
    expect(issuesBefore.some((issue) => issue.code === 'forbidden_keyword' && issue.path.endsWith('.prefixItems'))).toBe(true);

    const normalizedTool = normalizeMcpToolForPortability(nonPortableTool);
    expect(validateMcpToolSchemaPortability(normalizedTool)).toEqual([]);
    expect(normalizedTool.inputSchema.properties?.presented_sections).toEqual({
      type: 'array',
      minItems: 3,
      maxItems: 3,
      description: 'In this order: "覚えていたこと", "つながったこと", "次にできること".',
      items: {
        type: 'string',
        enum: ['覚えていたこと', 'つながったこと', '次にできること'],
      },
    });

    const server = createLocalMcpServer({
      name: 'reproducer-host',
      version: '1.0.0',
      tools: [{ definition: nonPortableTool, handler: async () => ({ content: [] }) }],
    });
    const [listed] = await listToolsFromServer(server);
    expect(validateMcpToolSchemaPortability(listed)).toEqual([]);
    expect(listed.inputSchema.properties?.presented_sections).toEqual(
      normalizedTool.inputSchema.properties?.presented_sections,
    );
  });

  it('normalizes tuple items arrays, const, array type, untyped enums, oneOf/anyOf/allOf, $ref, empty schemas, and orphan required keys', () => {
    const messy = {
      type: 'object',
      $defs: {
        sharedTag: { type: 'string', minLength: 1 },
      },
      required: ['mode', 'missing_key'],
      properties: {
        mode: { const: 'strict' },
        version: { const: 2 },
        nullable_text: { type: ['string', 'null'] },
        untyped_enum: { enum: ['alpha', 'beta'] },
        tuple_items: {
          type: 'array',
          items: [{ type: 'string' }, { type: 'string' }],
          additionalItems: false,
        },
        bare_array: { type: 'array' },
        empty_field: {},
        ref_field: { $ref: '#/$defs/sharedTag' },
        union_object: {
          oneOf: [
            {
              type: 'object',
              required: ['kind', 'query'],
              additionalProperties: false,
              properties: {
                kind: { const: 'search' },
                query: { type: 'string' },
              },
            },
            {
              type: 'object',
              required: ['kind', 'id'],
              additionalProperties: false,
              properties: {
                kind: { const: 'read' },
                id: { type: 'string' },
              },
            },
          ],
        },
      },
    } as unknown as Tool['inputSchema'];

    const normalized = normalizeMcpToolInputSchemaForPortability(messy);
    expect(validateMcpToolSchemaPortability({ name: 'messy_tool', inputSchema: normalized })).toEqual([]);
    expect(normalized.required).toEqual(['mode']);
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.mode).toEqual({ type: 'string', enum: ['strict'] });
    expect(props.version).toMatchObject({ type: 'integer' });
    expect(props.nullable_text).toEqual({
      type: 'string',
      nullable: true,
      description: 'null is also accepted.',
    });
    expect(props.untyped_enum).toEqual({ type: 'string', enum: ['alpha', 'beta'] });
    expect(props.tuple_items).toEqual({ type: 'array', items: { type: 'string' }, maxItems: 2 });
    expect(props.bare_array).toEqual({ type: 'array', items: { type: 'string' } });
    expect(props.empty_field).toEqual({ type: 'string' });
    expect(props.ref_field).toEqual({ type: 'string', minLength: 1 });
    expect(props.union_object).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['search', 'read'] },
        query: { type: 'string' },
        id: { type: 'string' },
      },
    });
  });

  it('detects every class of Gemini FunctionDeclaration violation in validateMcpToolSchemaPortability', () => {
    const broken: Tool = {
      name: 'broken_tool',
      inputSchema: {
        type: 'object',
        required: ['ghost'],
        properties: {
          arr_no_items: { type: 'array' },
          arr_tuple: { type: 'array', items: [{ type: 'string' }] },
          arr_prefix: { type: 'array', prefixItems: [{ type: 'string' }] },
          const_field: { const: 'x' },
          array_type: { type: ['string', 'null'] },
          untyped_enum: { enum: ['a', 'b'] },
          numeric_enum: { type: 'integer', enum: [1, 2] },
          union_field: { oneOf: [{ type: 'string' }] },
          empty_field: {},
        },
      } as unknown as Tool['inputSchema'],
    };

    const issues = validateMcpToolSchemaPortability(broken);
    const codes = new Set<McpToolSchemaPortabilityIssueCode>(issues.map((issue) => issue.code));
    expect(codes).toEqual(new Set<McpToolSchemaPortabilityIssueCode>([
      'required_property_missing',
      'array_items_missing',
      'array_items_tuple_forbidden',
      'forbidden_keyword',
      'type_missing',
      'type_array_forbidden',
      'enum_type_not_string',
      'enum_invalid',
    ]));
    expect(() => assertMcpToolSchemasPortable([broken])).toThrow(/broken_tool/);
  });

  it('resolves host schema profile from env and separates lossless standard from gemini normalization', async () => {
    const defaultProfile: McpToolSchemaProfile = resolveMcpToolSchemaProfile({});
    expect(defaultProfile).toBe('standard');
    expect(resolveMcpToolSchemaProfile({ BRAINBASE_MCP_SCHEMA_PROFILE: '' })).toBe('standard');
    expect(resolveMcpToolSchemaProfile({ BRAINBASE_MCP_SCHEMA_PROFILE: 'openai' })).toBe('standard');
    expect(resolveMcpToolSchemaProfile({ BRAINBASE_MCP_SCHEMA_PROFILE: 'standard' })).toBe('standard');
    expect(resolveMcpToolSchemaProfile({ BRAINBASE_MCP_SCHEMA_PROFILE: 'gemini' })).toBe('gemini');
    expect(resolveMcpToolSchemaProfile({ BRAINBASE_MCP_SCHEMA_PROFILE: ' Gemini ' })).toBe('gemini');

    const richTool: Tool = {
      name: 'rich_standard_tool',
      description: 'Uses standard JSON Schema 2020-12 null union and anyOf.',
      inputSchema: {
        type: 'object',
        required: ['answer', 'evidence_refs'],
        properties: {
          answer: { type: ['string', 'null'], description: 'Nullable answer.' },
          evidence_refs: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string', description: 'Reference ID.' },
                { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
              ],
            },
          },
          presented_sections: {
            type: 'array',
            prefixItems: [
              { const: '覚えていたこと' },
              { const: 'つながったこと' },
              { const: '次にできること' },
            ],
            items: { type: 'string', enum: ['覚えていたこと', 'つながったこと', '次にできること'] },
            minItems: 3,
            maxItems: 3,
          },
        },
      } as unknown as Tool['inputSchema'],
    };

    // Standard profile is lossless (preserves union-with-null, anyOf, prefixItems).
    expect(applyMcpToolSchemaProfile(richTool, 'standard')).toBe(richTool);
    const standardSchema = normalizeMcpToolInputSchemaForProfile(richTool.inputSchema, 'standard');
    expect(standardSchema).toEqual(richTool.inputSchema);
    expect(standardSchema).not.toBe(richTool.inputSchema);

    // Gemini profile produces zero violations, relaxes required on nullable properties, and documents lost shapes in descriptions.
    const geminiTool = applyMcpToolSchemaProfile(richTool, 'gemini');
    expect(validateMcpToolSchemaPortability(geminiTool)).toEqual([]);
    expect(geminiTool.inputSchema.required).toEqual(['evidence_refs']);
    const geminiProps = geminiTool.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(geminiProps.answer).toEqual({
      type: 'string',
      nullable: true,
      description: 'Nullable answer. Omit or pass null when unset.',
    });
    expect(geminiProps.evidence_refs.items).toEqual({
      type: 'string',
      description: 'Reference ID. Other accepted shapes: object.',
    });
    expect(geminiProps.presented_sections).toEqual({
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string', enum: ['覚えていたこと', 'つながったこと', '次にできること'] },
    });

    // createLocalMcpServer & runLocalMcpServer respect schemaProfile: 'standard' losslessly.
    const standardServer = createLocalMcpServer({
      name: 'standard-host',
      version: '1.0.0',
      schemaProfile: 'standard',
      tools: [{ definition: richTool, handler: async () => ({ content: [] }) }],
    });
    const [listedStandard] = await listToolsFromServer(standardServer);
    expect(listedStandard.inputSchema).toEqual(richTool.inputSchema);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'run-local-standard-test', version: '1.0.0' });
    const handle = await runLocalMcpServer({
      name: 'standard-run-host',
      version: '1.0.0',
      schemaProfile: 'standard',
      tools: [{ definition: richTool, handler: async () => ({ content: [] }) }],
      transport: serverTransport,
    });
    await client.connect(clientTransport);
    try {
      const [listedRun] = (await client.listTools()).tools;
      expect(listedRun.inputSchema).toEqual(richTool.inputSchema);
    } finally {
      await client.close();
      await handle.close();
    }
  });

  it('normalizes nullable variants, union-with-null enums, heterogeneous unions, and nested objects/additionalProperties idempotently', () => {
    const complex = {
      type: 'object',
      properties: {
        nullable_union_enum: {
          anyOf: [{ type: 'null' }, { type: 'string', enum: ['x', 'y'] }],
          description: 'Target layer.',
        },
        enum_with_null: {
          enum: ['a', 'b', null],
        },
        null_const: {
          const: null,
        },
        pure_null: {
          type: 'null',
        },
        explicit_nullable_false: {
          type: 'string',
          nullable: false,
        },
        invalid_nullable_flag: {
          type: 'string',
          nullable: 'yes',
        },
        multi_type_nullable: {
          type: ['string', 'integer', 'null'],
          description: 'Identifier.',
        },
        outer_desc_union: {
          description: 'Reference value.',
          anyOf: [
            { type: 'string' },
            { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
          ],
        },
        numeric_union: {
          anyOf: [{ type: 'integer' }, { type: 'number' }],
        },
        empty_nested_object: {
          type: 'object',
        },
        closed_empty_nested_object: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        typed_map: {
          type: 'object',
          additionalProperties: {
            type: ['string', 'null'],
          },
        },
        nested_array_of_empty_objects: {
          type: 'array',
          items: { type: 'object' },
        },
      },
    } as unknown as Tool['inputSchema'];

    const normalized = normalizeMcpToolInputSchemaForPortability(complex);
    expect(validateMcpToolInputSchemaPortability(normalized)).toEqual([]);
    // Strictly idempotent on second pass.
    expect(normalizeMcpToolInputSchemaForPortability(normalized)).toEqual(normalized);

    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.nullable_union_enum).toEqual({
      type: 'string',
      nullable: true,
      description: 'Target layer. Allowed values: "x", "y". null is also accepted.',
    });
    expect(props.enum_with_null).toEqual({
      type: 'string',
      nullable: true,
      description: 'Allowed values: "a", "b". null is also accepted.',
    });
    expect(props.null_const).toEqual({
      type: 'string',
      nullable: true,
      description: 'Must be null. null is also accepted.',
    });
    expect(props.pure_null).toEqual({
      type: 'string',
      nullable: true,
      description: 'null is also accepted.',
    });
    expect(props.explicit_nullable_false).toEqual({
      type: 'string',
      nullable: false,
    });
    expect(props.invalid_nullable_flag).toEqual({
      type: 'string',
    });
    expect(props.multi_type_nullable).toEqual({
      type: 'string',
      nullable: true,
      description: 'Identifier. Other accepted shapes: integer. null is also accepted.',
    });
    expect(props.outer_desc_union).toEqual({
      type: 'string',
      description: 'Reference value. Other accepted shapes: object.',
    });
    expect(props.numeric_union).toEqual({
      type: 'number',
    });
    expect(props.empty_nested_object).toEqual({
      type: 'object',
      additionalProperties: true,
    });
    expect(props.closed_empty_nested_object).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
      maxProperties: 0,
      description:
        'Must be an empty object ({}); additionalProperties: false was relaxed to additionalProperties: true for Gemini schema compatibility.',
    });
    expect(props.typed_map).toEqual({
      type: 'object',
      additionalProperties: {
        type: 'string',
        nullable: true,
        description: 'null is also accepted.',
      },
    });
    expect(props.nested_array_of_empty_objects).toEqual({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
      },
    });
    // Empty root objects stay clean (no unsolicited additionalProperties on root).
    const emptyRoot = normalizeMcpToolInputSchemaForPortability({ type: 'object', properties: {} });
    expect(emptyRoot).toEqual({ type: 'object', properties: {} });
    expect(validateMcpToolInputSchemaPortability(emptyRoot)).toEqual([]);
  });

  it('validates nullable type, nested empty objects, additionalProperties schemas, and combinator children', () => {
    const issues = validateMcpToolInputSchemaPortability({
      type: 'object',
      properties: {
        ok_nullable: { type: 'string', nullable: true },
        bad_nullable: { type: 'string', nullable: 'true' },
        empty_nested: { type: 'object' },
        free_nested: { type: 'object', additionalProperties: true },
        bad_map: { type: 'object', additionalProperties: { type: 'array' } },
        either_null: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    }, 'edge_tool');

    expect(issues.map((issue) => `${issue.path}:${issue.code}`)).toEqual([
      'inputSchema.properties.bad_nullable.nullable:nullable_invalid',
      'inputSchema.properties.empty_nested:object_properties_missing',
      'inputSchema.properties.bad_map.additionalProperties.items:array_items_missing',
      'inputSchema.properties.either_null.anyOf:forbidden_keyword',
      'inputSchema.properties.either_null.type:type_missing',
      'inputSchema.properties.either_null.anyOf[1].type:type_unsupported',
    ]);
  });

  it('preserves own "__proto__" properties and required entries across root, nested, combinator merge, and outer-properties paths without prototype mutation', () => {
    const schema = JSON.parse(`{
      "type": "object",
      "required": ["__proto__", "nested", "merged_union", "outer_with_combinator"],
      "properties": {
        "__proto__": { "type": ["string", "null"], "description": "Literal __proto__ key." },
        "nested": {
          "type": "object",
          "required": ["__proto__"],
          "properties": {
            "__proto__": { "const": "nested-value" }
          }
        },
        "merged_union": {
          "oneOf": [
            {
              "type": "object",
              "required": ["__proto__", "a"],
              "properties": {
                "__proto__": { "type": "string", "enum": ["alpha"] },
                "a": { "type": "string" }
              }
            },
            {
              "type": "object",
              "required": ["__proto__", "b"],
              "properties": {
                "__proto__": { "type": "string", "enum": ["beta"] },
                "b": { "type": "integer" }
              }
            }
          ]
        },
        "outer_with_combinator": {
          "type": "object",
          "required": ["__proto__"],
          "properties": {
            "__proto__": { "type": "string", "minLength": 1 }
          },
          "allOf": [
            {
              "type": "object",
              "required": ["extra"],
              "properties": {
                "extra": { "type": "boolean" }
              }
            }
          ]
        }
      }
    }`) as Tool['inputSchema'];

    const normalized = normalizeMcpToolInputSchemaForPortability(schema);
    expect(validateMcpToolInputSchemaPortability(normalized, 'proto_tool')).toEqual([]);

    const rootProps = normalized.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(rootProps)).toBe(Object.prototype);
    expect(Object.hasOwn(rootProps, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(rootProps, '__proto__')?.value).toEqual({
      type: 'string',
      nullable: true,
      description: 'Literal __proto__ key. Omit or pass null when unset.',
    });
    expect(normalized.required).toEqual(['nested', 'merged_union', 'outer_with_combinator']);

    const nested = rootProps.nested;
    const nestedProps = nested.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(nestedProps)).toBe(Object.prototype);
    expect(Object.hasOwn(nestedProps, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(nestedProps, '__proto__')?.value).toEqual({
      type: 'string',
      enum: ['nested-value'],
    });
    expect(nested.required).toEqual(['__proto__']);

    const mergedUnion = rootProps.merged_union;
    const mergedUnionProps = mergedUnion.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(mergedUnionProps)).toBe(Object.prototype);
    expect(Object.hasOwn(mergedUnionProps, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(mergedUnionProps, '__proto__')?.value).toEqual({
      type: 'string',
      enum: ['alpha', 'beta'],
    });
    expect(mergedUnion.required).toEqual(['__proto__']);

    const outerWithCombinator = rootProps.outer_with_combinator;
    const outerProps = outerWithCombinator.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(outerProps)).toBe(Object.prototype);
    expect(Object.hasOwn(outerProps, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(outerProps, '__proto__')?.value).toEqual({
      type: 'string',
      minLength: 1,
    });
    expect(outerWithCombinator.required).toEqual(['__proto__', 'extra']);

    // Idempotent on second pass and preserves own "__proto__" keys through structuredClone.
    const secondPass = normalizeMcpToolInputSchemaForPortability(normalized);
    expect(validateMcpToolInputSchemaPortability(secondPass, 'proto_tool')).toEqual([]);
    expect(Object.hasOwn(secondPass.properties as object, '__proto__')).toBe(true);
    expect(secondPass.required).toEqual(['nested', 'merged_union', 'outer_with_combinator']);
    expect(JSON.stringify(secondPass)).toBe(JSON.stringify(normalized));
  });

  it('preserves required entries declared in a separate allOf branch (including __proto__, nested allOf, $ref, and outer properties) while dropping truly undeclared keys', () => {
    const schema = JSON.parse(`{
      "type": "object",
      "$defs": {
        "requireProto": {
          "required": ["__proto__"]
        }
      },
      "properties": {
        "split_all_of": {
          "allOf": [
            {
              "type": "object",
              "properties": {
                "__proto__": { "type": "string" },
                "label": { "type": "string" }
              }
            },
            {
              "required": ["__proto__", "label", "orphan_key"]
            }
          ]
        },
        "nested_all_of": {
          "allOf": [
            {
              "type": "object",
              "properties": {
                "__proto__": { "type": "integer" }
              }
            },
            {
              "allOf": [
                { "$ref": "#/$defs/requireProto" }
              ]
            }
          ]
        },
        "outer_props_branch_required": {
          "type": "object",
          "properties": {
            "__proto__": { "type": "boolean" }
          },
          "allOf": [
            { "required": ["__proto__"] }
          ]
        }
      }
    }`) as Tool['inputSchema'];

    const normalized = normalizeMcpToolInputSchemaForPortability(schema);
    expect(validateMcpToolInputSchemaPortability(normalized, 'split_allof_tool')).toEqual([]);

    const props = normalized.properties as Record<string, Record<string, unknown>>;

    const splitAllOf = props.split_all_of;
    const splitProps = splitAllOf.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(splitProps)).toBe(Object.prototype);
    expect(Object.hasOwn(splitProps, '__proto__')).toBe(true);
    expect(splitAllOf.required).toEqual(['__proto__', 'label']);

    const nestedAllOf = props.nested_all_of;
    const nestedProps = nestedAllOf.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(nestedProps)).toBe(Object.prototype);
    expect(Object.hasOwn(nestedProps, '__proto__')).toBe(true);
    expect(nestedAllOf.required).toEqual(['__proto__']);

    const outerBranchReq = props.outer_props_branch_required;
    const outerBranchProps = outerBranchReq.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(outerBranchProps)).toBe(Object.prototype);
    expect(Object.hasOwn(outerBranchProps, '__proto__')).toBe(true);
    expect(outerBranchReq.required).toEqual(['__proto__']);
  });

  it('preserves nested child required entries when allOf branches split child properties and required, while pruning truly undeclared keys', () => {
    // Exact repro from cross-model review: root allOf splitting config.properties.id and config.required.
    const directRepro = {
      type: 'object',
      allOf: [
        { properties: { config: { properties: { id: { type: 'string' } } } } },
        { properties: { config: { required: ['id'] } } },
      ],
    } as unknown as Tool['inputSchema'];

    const normalizedDirect = normalizeMcpToolInputSchemaForPortability(directRepro);
    expect(validateMcpToolInputSchemaPortability(normalizedDirect, 'config_repro_tool')).toEqual([]);
    const directConfig = (normalizedDirect.properties as Record<string, Record<string, unknown>>).config;
    expect(directConfig).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });

    // Multi-level nesting, __proto__ child keys, outer sibling properties, and orphan key pruning.
    const deepSplit = JSON.parse(`{
      "type": "object",
      "properties": {
        "outer_child": {
          "required": ["id", "outer_orphan"]
        }
      },
      "allOf": [
        {
          "properties": {
            "outer_child": {
              "properties": {
                "id": { "type": "string" }
              }
            },
            "deep": {
              "properties": {
                "inner": {
                  "properties": {
                    "id": { "type": "string" },
                    "__proto__": { "type": "integer" }
                  }
                }
              }
            },
            "single_branch_only": {
              "type": "object",
              "properties": {
                "present": { "type": "boolean" }
              },
              "required": ["present", "branch_orphan"]
            }
          }
        },
        {
          "properties": {
            "deep": {
              "properties": {
                "inner": {
                  "required": ["id", "__proto__", "deep_orphan"]
                }
              }
            }
          }
        }
      ]
    }`) as Tool['inputSchema'];

    const normalizedDeep = normalizeMcpToolInputSchemaForPortability(deepSplit);
    expect(validateMcpToolInputSchemaPortability(normalizedDeep, 'deep_split_tool')).toEqual([]);
    const deepProps = normalizedDeep.properties as Record<string, Record<string, unknown>>;

    expect(deepProps.outer_child).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });

    const inner = (deepProps.deep.properties as Record<string, Record<string, unknown>>).inner;
    const innerProps = inner.properties as Record<string, Record<string, unknown>>;
    expect(Object.getPrototypeOf(innerProps)).toBe(Object.prototype);
    expect(Object.hasOwn(innerProps, '__proto__')).toBe(true);
    expect(Object.hasOwn(innerProps, 'id')).toBe(true);
    expect(inner.required).toEqual(['id', '__proto__']);

    expect(deepProps.single_branch_only).toEqual({
      type: 'object',
      properties: { present: { type: 'boolean' } },
      required: ['present'],
    });
  });

  it('propagates preserveUndeclaredRequired and intersection/union modes into array items and additionalProperties schemas', () => {
    // Exact repro from cross-model review #4: array items split across allOf branches.
    const arrayRepro = {
      type: 'object',
      allOf: [
        { properties: { config: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } },
        { properties: { config: { type: 'array', items: { type: 'object', required: ['id'] } } } },
      ],
    } as unknown as Tool['inputSchema'];

    const normalizedArrayRepro = normalizeMcpToolInputSchemaForPortability(arrayRepro);
    expect(validateMcpToolInputSchemaPortability(normalizedArrayRepro, 'array_repro_tool')).toEqual([]);
    const reproConfig = (normalizedArrayRepro.properties as Record<string, Record<string, unknown>>).config;
    expect(reproConfig).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    });

    // Nested array items, __proto__ retention, orphan pruning, outer array + allOf,
    // single-branch array pruning, and additionalProperties object schema merging.
    const richArrayAndMap = JSON.parse(`{
      "type": "object",
      "properties": {
        "outer_array": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string" }
            }
          },
          "allOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["id", "outer_array_orphan"]
              }
            }
          ]
        }
      },
      "allOf": [
        {
          "properties": {
            "config_proto": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" },
                  "__proto__": { "type": "integer" }
                }
              }
            },
            "nested_matrix": {
              "type": "array",
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": { "type": "string" },
                    "__proto__": { "type": "boolean" }
                  }
                }
              }
            },
            "single_branch_array": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "present": { "type": "string" }
                },
                "required": ["present", "single_branch_orphan"]
              }
            },
            "single_branch_orphan_only": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "present": { "type": "string" }
                },
                "required": ["orphan_only"]
              }
            },
            "typed_map": {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" },
                  "__proto__": { "type": "string" }
                }
              }
            }
          }
        },
        {
          "properties": {
            "config_proto": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["id", "__proto__", "orphan_key"]
              }
            },
            "nested_matrix": {
              "type": "array",
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["id", "__proto__", "matrix_orphan"]
                }
              }
            },
            "typed_map": {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "required": ["id", "__proto__", "map_orphan"]
              }
            }
          }
        }
      ]
    }`) as Tool['inputSchema'];

    const normalizedRich = normalizeMcpToolInputSchemaForPortability(richArrayAndMap);
    expect(validateMcpToolInputSchemaPortability(normalizedRich, 'rich_array_map_tool')).toEqual([]);
    const richProps = normalizedRich.properties as Record<string, Record<string, unknown>>;

    expect(richProps.outer_array).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    });

    const configProtoItems = richProps.config_proto.items as Record<string, unknown>;
    const configProtoItemProps = configProtoItems.properties as Record<string, unknown>;
    expect(Object.getPrototypeOf(configProtoItemProps)).toBe(Object.prototype);
    expect(Object.hasOwn(configProtoItemProps, 'id')).toBe(true);
    expect(Object.hasOwn(configProtoItemProps, '__proto__')).toBe(true);
    expect(configProtoItems.required).toEqual(['id', '__proto__']);

    const matrixLeaf = (richProps.nested_matrix.items as Record<string, unknown>).items as Record<string, unknown>;
    const matrixLeafProps = matrixLeaf.properties as Record<string, unknown>;
    expect(Object.getPrototypeOf(matrixLeafProps)).toBe(Object.prototype);
    expect(Object.hasOwn(matrixLeafProps, 'id')).toBe(true);
    expect(Object.hasOwn(matrixLeafProps, '__proto__')).toBe(true);
    expect(matrixLeaf.required).toEqual(['id', '__proto__']);

    expect(richProps.single_branch_array).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { present: { type: 'string' } },
        required: ['present'],
      },
    });

    expect(richProps.single_branch_orphan_only).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { present: { type: 'string' } },
      },
    });

    const typedMapAdd = richProps.typed_map.additionalProperties as Record<string, unknown>;
    const typedMapAddProps = typedMapAdd.properties as Record<string, unknown>;
    expect(Object.getPrototypeOf(typedMapAddProps)).toBe(Object.prototype);
    expect(Object.hasOwn(typedMapAddProps, 'id')).toBe(true);
    expect(Object.hasOwn(typedMapAddProps, '__proto__')).toBe(true);
    expect(typedMapAdd.required).toEqual(['id', '__proto__']);

    // Idempotent on second pass.
    const secondPass = normalizeMcpToolInputSchemaForPortability(normalizedRich);
    expect(validateMcpToolInputSchemaPortability(secondPass, 'rich_array_map_tool')).toEqual([]);
    expect(JSON.stringify(secondPass)).toBe(JSON.stringify(normalizedRich));

    // Union combinators (oneOf / anyOf) must continue to merge array items in union mode
    // (required = intersection of branch required keys, never union).
    const unionArrays = {
      type: 'object',
      properties: {
        oneof_items: {
          oneOf: [
            {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, a: { type: 'string' } },
                required: ['id', 'a'],
              },
            },
            {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, b: { type: 'integer' } },
                required: ['id', 'b'],
              },
            },
          ],
        },
        anyof_split_items: {
          anyOf: [
            {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' } },
              },
            },
            {
              type: 'array',
              items: {
                type: 'object',
                required: ['id'],
              },
            },
          ],
        },
      },
    } as unknown as Tool['inputSchema'];

    const normalizedUnion = normalizeMcpToolInputSchemaForPortability(unionArrays);
    expect(validateMcpToolInputSchemaPortability(normalizedUnion, 'union_array_tool')).toEqual([]);
    const unionProps = normalizedUnion.properties as Record<string, Record<string, unknown>>;

    expect(unionProps.oneof_items).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          a: { type: 'string' },
          b: { type: 'integer' },
        },
        required: ['id'],
      },
    });

    expect(unionProps.anyof_split_items).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    });
  });

  it('preserves additionalProperties: false and closed key intersections across allOf branches while keeping union semantics for oneOf/anyOf', () => {
    // Same declared key with mixed [false, schema] and [schema, false] preserves additionalProperties: false.
    const falseFirst = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string' } }, additionalProperties: false },
        { properties: { id: { type: 'string' } }, additionalProperties: { type: 'string' } },
      ],
    } as unknown as Tool['inputSchema'];

    const schemaFirst = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string' } }, additionalProperties: { type: 'string' } },
        { properties: { id: { type: 'string' } }, additionalProperties: false },
      ],
    } as unknown as Tool['inputSchema'];

    // Outer additionalProperties: false with outer properties: { id } intersects with allOf properties,
    // keeping only keys allowed by the closed outer schema (dropping allOf-only `extra`).
    const outerClosedWithDeclaredKey = {
      type: 'object',
      properties: { id: { type: 'string' } },
      additionalProperties: false,
      allOf: [
        { properties: { id: { type: 'string' }, extra: { type: 'string' } }, additionalProperties: { type: 'string' } },
      ],
    } as unknown as Tool['inputSchema'];

    // Closed branch + closed branch with disjoint extras keeps only the intersection (`id`).
    const twoClosedBranches = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string' }, a: { type: 'string' } }, additionalProperties: false },
        { properties: { id: { type: 'string' }, b: { type: 'integer' } }, additionalProperties: false },
      ],
    } as unknown as Tool['inputSchema'];

    // Closed branch + open branch drops keys forbidden by the closed branch.
    const closedAndOpenBranch = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string' } }, additionalProperties: false },
        { properties: { id: { type: 'string' }, extra: { type: 'string' } } },
      ],
    } as unknown as Tool['inputSchema'];

    for (const candidate of [
      falseFirst,
      schemaFirst,
      outerClosedWithDeclaredKey,
      twoClosedBranches,
      closedAndOpenBranch,
    ]) {
      const normalized = normalizeMcpToolInputSchemaForPortability(candidate);
      expect(validateMcpToolInputSchemaPortability(normalized, 'closed_allof_tool')).toEqual([]);
      expect(normalized).toEqual({
        type: 'object',
        properties: { id: { type: 'string' } },
        additionalProperties: false,
      });
    }

    // Closed branch + open branch with required forbidden key drops both the property and its required entry,
    // while retaining declared required keys.
    const closedWithRequiredForbidden = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string' } }, additionalProperties: false },
        { properties: { id: { type: 'string' }, extra: { type: 'string' } }, required: ['id', 'extra'] },
      ],
    } as unknown as Tool['inputSchema'];
    const normalizedClosedRequired = normalizeMcpToolInputSchemaForPortability(closedWithRequiredForbidden);
    expect(validateMcpToolInputSchemaPortability(normalizedClosedRequired, 'closed_req_tool')).toEqual([]);
    expect(normalizedClosedRequired).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    });

    // Outer additionalProperties: false without outer properties forbids all keys (including allOf-only `id`),
    // as do property-less closed allOf branches combined with additionalProperties schema branches (both orders,
    // nested allOf, untyped { additionalProperties: false }, and outer properties + closed empty allOf).
    const outerFalseNoOuterProps = {
      type: 'object',
      additionalProperties: false,
      allOf: [
        { properties: { id: { type: 'string' } }, additionalProperties: { type: 'string' } },
      ],
    } as unknown as Tool['inputSchema'];

    const emptyClosedFirst = {
      type: 'object',
      allOf: [
        { type: 'object', additionalProperties: false },
        { type: 'object', additionalProperties: { type: 'string' } },
      ],
    } as unknown as Tool['inputSchema'];

    const emptyClosedSecond = {
      type: 'object',
      allOf: [
        { type: 'object', additionalProperties: { type: 'string' } },
        { type: 'object', additionalProperties: false },
      ],
    } as unknown as Tool['inputSchema'];

    const nestedEmptyClosedFirst = {
      type: 'object',
      allOf: [
        {
          allOf: [
            { type: 'object', additionalProperties: false },
            { type: 'object', additionalProperties: { type: 'string' } },
          ],
        },
        { type: 'object', additionalProperties: { type: 'integer' } },
      ],
    } as unknown as Tool['inputSchema'];

    const nestedEmptyClosedSecond = {
      type: 'object',
      allOf: [
        { type: 'object', additionalProperties: { type: 'integer' } },
        {
          allOf: [
            { type: 'object', additionalProperties: { type: 'string' } },
            { type: 'object', additionalProperties: false },
          ],
        },
      ],
    } as unknown as Tool['inputSchema'];

    const untypedClosedBranch = {
      type: 'object',
      allOf: [
        { additionalProperties: false },
        { properties: { id: { type: 'string' } }, additionalProperties: { type: 'string' } },
      ],
    } as unknown as Tool['inputSchema'];

    const outerPropsWithEmptyClosedAllOf = {
      type: 'object',
      properties: { id: { type: 'string' } },
      allOf: [
        { type: 'object', additionalProperties: false },
      ],
    } as unknown as Tool['inputSchema'];

    for (const candidate of [
      outerFalseNoOuterProps,
      emptyClosedFirst,
      emptyClosedSecond,
      nestedEmptyClosedFirst,
      nestedEmptyClosedSecond,
      untypedClosedBranch,
      outerPropsWithEmptyClosedAllOf,
    ]) {
      const normalized = normalizeMcpToolInputSchemaForPortability(candidate);
      expect(validateMcpToolInputSchemaPortability(normalized, 'empty_closed_allof_tool')).toEqual([]);
      expect(normalized).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
    }

    // Nested property cases (both branch orders):
    // 1) Closed branch declaring `id` + schema/open branch declaring `extra` preserves only `id` and `additionalProperties: false`.
    // 2) Property-less closed branch + schema branch does NOT adopt `{ type: 'string' }` during merge; final Gemini
    //    non-root empty-object portability applies only after merging (matching closed_empty_nested_object).
    const nestedClosedCases = {
      type: 'object',
      properties: {
        nested_closed_with_key_first: {
          allOf: [
            { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
            { type: 'object', properties: { id: { type: 'string' }, extra: { type: 'string' } }, additionalProperties: { type: 'string' } },
          ],
        },
        nested_closed_with_key_second: {
          allOf: [
            { type: 'object', properties: { id: { type: 'string' }, extra: { type: 'string' } }, additionalProperties: { type: 'string' } },
            { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
          ],
        },
        nested_empty_closed_first: {
          allOf: [
            { type: 'object', additionalProperties: false },
            { type: 'object', additionalProperties: { type: 'string' } },
          ],
        },
        nested_empty_closed_second: {
          allOf: [
            { type: 'object', additionalProperties: { type: 'string' } },
            { type: 'object', additionalProperties: false },
          ],
        },
      },
    } as unknown as Tool['inputSchema'];

    const normalizedNestedClosed = normalizeMcpToolInputSchemaForPortability(nestedClosedCases);
    expect(validateMcpToolInputSchemaPortability(normalizedNestedClosed, 'nested_closed_tool')).toEqual([]);
    const nestedClosedProps = normalizedNestedClosed.properties as Record<string, Record<string, unknown>>;
    expect(nestedClosedProps.nested_closed_with_key_first).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    });
    expect(nestedClosedProps.nested_closed_with_key_second).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    });
    expect(nestedClosedProps.nested_empty_closed_first).toEqual({
      type: 'object',
      additionalProperties: true,
      maxProperties: 0,
      description:
        'Must be an empty object ({}); additionalProperties: false was relaxed to additionalProperties: true for Gemini schema compatibility.',
    });
    expect(nestedClosedProps.nested_empty_closed_second).toEqual({
      type: 'object',
      additionalProperties: true,
      maxProperties: 0,
      description:
        'Must be an empty object ({}); additionalProperties: false was relaxed to additionalProperties: true for Gemini schema compatibility.',
    });

    // Idempotent on second pass for relaxed closed empty nested objects.
    const secondPassNestedClosed = normalizeMcpToolInputSchemaForPortability(normalizedNestedClosed);
    expect(validateMcpToolInputSchemaPortability(secondPassNestedClosed, 'nested_closed_tool')).toEqual([]);
    expect(secondPassNestedClosed).toEqual(normalizedNestedClosed);

    // Typed additionalProperties from a branch that does NOT declare `id` must intersect into `properties.id`
    // in both branch orders (Codex review #7 repro), without affecting keys declared by the same branch.
    const typedAdditionalFirst = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string' } }, additionalProperties: false },
        { additionalProperties: { type: 'string', minLength: 1 } },
      ],
    } as unknown as Tool['inputSchema'];

    const typedAdditionalSecond = {
      type: 'object',
      allOf: [
        { additionalProperties: { type: 'string', minLength: 1 } },
        { properties: { id: { type: 'string' } }, additionalProperties: false },
      ],
    } as unknown as Tool['inputSchema'];

    const typedAdditionalOuterAndAllOf = {
      type: 'object',
      properties: { id: { type: 'string' } },
      additionalProperties: false,
      allOf: [
        { additionalProperties: { type: 'string', minLength: 1 } },
      ],
    } as unknown as Tool['inputSchema'];

    for (const candidate of [typedAdditionalFirst, typedAdditionalSecond, typedAdditionalOuterAndAllOf]) {
      const normalized = normalizeMcpToolInputSchemaForPortability(candidate);
      expect(validateMcpToolInputSchemaPortability(normalized, 'typed_additional_intersection_tool')).toEqual([]);
      expect(normalized).toEqual({
        type: 'object',
        properties: { id: { type: 'string', minLength: 1 } },
        additionalProperties: false,
      });
    }

    // Typed additionalProperties on a branch that DOES declare `id` must NOT apply to `id` itself,
    // while another branch's typed additionalProperties (which omits `id`) DOES intersect into `id`,
    // and object-valued additionalProperties intersects required/properties into undeclared keys.
    const typedAdditionalScopedAndObject = {
      type: 'object',
      allOf: [
        {
          properties: {
            id: { type: 'string' },
            meta: { type: 'object', properties: { tag: { type: 'string' } } },
          },
          additionalProperties: { type: 'integer' },
        },
        {
          properties: {
            meta: { type: 'object', properties: { tag: { type: 'string' } } },
          },
          additionalProperties: { type: 'string', minLength: 1, maxLength: 32 },
        },
        {
          properties: {
            id: { type: 'string' },
          },
          additionalProperties: { type: 'object', required: ['tag'] },
        },
      ],
    } as unknown as Tool['inputSchema'];

    const normalizedScoped = normalizeMcpToolInputSchemaForPortability(typedAdditionalScopedAndObject);
    expect(validateMcpToolInputSchemaPortability(normalizedScoped, 'typed_additional_scoped_tool')).toEqual([]);
    const scopedProps = normalizedScoped.properties as Record<string, Record<string, unknown>>;
    expect(scopedProps.id).toEqual({ type: 'string', minLength: 1, maxLength: 32 });
    expect(scopedProps.meta).toEqual({
      type: 'object',
      properties: { tag: { type: 'string' } },
      required: ['tag'],
    });

    // Disjoint string enum intersections (e.g. closed properties.id enum ['a'] vs other branch
    // additionalProperties enum ['b']) must NOT relax to an unconstrained string in either branch order,
    // while non-empty enum intersections (['a', 'b'] ∩ ['b', 'c'] === ['b']) keep the exact intersection.
    const disjointEnumFirst = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string', enum: ['a'] } }, additionalProperties: false },
        { additionalProperties: { type: 'string', enum: ['b'] } },
      ],
    } as unknown as Tool['inputSchema'];

    const disjointEnumSecond = {
      type: 'object',
      allOf: [
        { additionalProperties: { type: 'string', enum: ['b'] } },
        { properties: { id: { type: 'string', enum: ['a'] } }, additionalProperties: false },
      ],
    } as unknown as Tool['inputSchema'];

    for (const candidate of [disjointEnumFirst, disjointEnumSecond]) {
      const normalized = normalizeMcpToolInputSchemaForPortability(candidate);
      expect(validateMcpToolInputSchemaPortability(normalized, 'disjoint_enum_tool')).toEqual([]);
      expect(normalized).toEqual({
        type: 'object',
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 0,
            description: 'No string value satisfies the intersected enum constraints (empty enum intersection).',
          },
        },
        additionalProperties: false,
      });
      // Strictly idempotent on second pass.
      expect(normalizeMcpToolInputSchemaForPortability(normalized)).toEqual(normalized);
    }

    const overlappingEnumIntersection = {
      type: 'object',
      allOf: [
        { properties: { id: { type: 'string', enum: ['a', 'b'] } }, additionalProperties: false },
        { additionalProperties: { type: 'string', enum: ['b', 'c'] } },
      ],
    } as unknown as Tool['inputSchema'];

    const normalizedOverlap = normalizeMcpToolInputSchemaForPortability(overlappingEnumIntersection);
    expect(validateMcpToolInputSchemaPortability(normalizedOverlap, 'overlap_enum_tool')).toEqual([]);
    expect(normalizedOverlap).toEqual({
      type: 'object',
      properties: {
        id: {
          type: 'string',
          enum: ['b'],
        },
      },
      additionalProperties: false,
    });

    // Union combinators (oneOf / anyOf) must keep the looser constraint:
    // - [false, schema] -> schema
    // - [false, open] -> open (additionalProperties omitted)
    // - [false, false] -> false (and union of properties { a, b })
    const unionAdditional = {
      type: 'object',
      properties: {
        oneof_false_and_schema: {
          oneOf: [
            { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
            { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: { type: 'string' } },
          ],
        },
        anyof_false_and_open: {
          anyOf: [
            { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
            { type: 'object', properties: { id: { type: 'string' } } },
          ],
        },
        oneof_both_false: {
          oneOf: [
            { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
            { type: 'object', properties: { b: { type: 'integer' } }, additionalProperties: false },
          ],
        },
      },
    } as unknown as Tool['inputSchema'];

    const normalizedUnion = normalizeMcpToolInputSchemaForPortability(unionAdditional);
    expect(validateMcpToolInputSchemaPortability(normalizedUnion, 'union_additional_tool')).toEqual([]);
    const props = normalizedUnion.properties as Record<string, Record<string, unknown>>;

    expect(props.oneof_false_and_schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      additionalProperties: { type: 'string' },
    });
    expect(props.anyof_false_and_open).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    expect(props.oneof_both_false).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'integer' } },
      additionalProperties: false,
    });
  });

  it('publishes ./mcp-tool-schema-portability with all 11 exported symbols (8 runtime functions + 3 types) matching dist output', async () => {
    const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(manifest.exports['./mcp-tool-schema-portability']).toEqual({
      types: './dist/mcp-tool-schema-portability.d.ts',
      import: './dist/mcp-tool-schema-portability.js',
    });
    const direct = await import(pathToFileURL(path.join(process.cwd(), 'dist/mcp-tool-schema-portability.js')).href);
    const runtimeSymbols = [
      'resolveMcpToolSchemaProfile',
      'applyMcpToolSchemaProfile',
      'normalizeMcpToolInputSchemaForPortability',
      'normalizeMcpToolInputSchemaForProfile',
      'normalizeMcpToolForPortability',
      'validateMcpToolInputSchemaPortability',
      'validateMcpToolSchemaPortability',
      'assertMcpToolSchemasPortable',
    ] as const;
    for (const symbol of runtimeSymbols) {
      expect(typeof direct[symbol]).toBe('function');
    }
    expect(Object.keys(direct).sort()).toEqual([...runtimeSymbols].sort());

    const dts = await readFile(path.join(process.cwd(), 'dist/mcp-tool-schema-portability.d.ts'), 'utf8');
    for (const typeSymbol of [
      'export type McpToolSchemaProfile',
      'export type McpToolSchemaPortabilityIssueCode',
      'export interface McpToolSchemaPortabilityIssue',
    ]) {
      expect(dts).toContain(typeSymbol);
    }
    for (const fnSymbol of runtimeSymbols) {
      expect(dts).toContain(`export declare function ${fnSymbol}`);
    }
  });

  it('excludes nullable properties from required and annotates omission only in the gemini profile (brainbase_judgment_state_record & brainbase_judgment_node_record)', () => {
    const stateRecordTool: Tool = {
      name: 'brainbase_judgment_state_record',
      description: 'Record stop state for the active judgment turn.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'pending_safe_work', 'runtime_reason_code'],
        properties: {
          status: { type: 'string', enum: ['completed', 'blocked', 'needs_human'] },
          pending_safe_work: { type: 'boolean' },
          runtime_reason_code: {
            type: ['string', 'null'],
            description: 'Reason code when not completed.',
          },
          continuation_assessment: {
            type: 'object',
            additionalProperties: false,
            required: ['kg'],
            properties: {
              kg: {
                type: 'object',
                additionalProperties: false,
                required: ['status', 'search_tool_use_id', 'answer_tool_use_id', 'question_digest'],
                properties: {
                  status: { type: 'string', enum: ['not_needed', 'recorded', 'pending'] },
                  search_tool_use_id: { type: ['string', 'null'], description: 'Personal KG search tool use ID.' },
                  answer_tool_use_id: { type: ['string', 'null'], description: 'Personal KG answer tool use ID.' },
                  question_digest: { type: ['string', 'null'], description: 'Digest of the KG question.' },
                },
              },
            },
          },
        },
      } as unknown as Tool['inputSchema'],
    };

    const nodeRecordTool: Tool = {
      name: 'brainbase_judgment_node_record',
      description: 'Record evidence for a judgment node.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['node_id', 'status', 'previous_result_tool_use_id'],
        properties: {
          node_id: { type: 'string' },
          status: { type: 'string', enum: ['completed', 'skipped'] },
          previous_result_tool_use_id: {
            type: ['string', 'null'],
            description: 'Prior tool use ID when referencing an earlier result.',
          },
        },
      } as unknown as Tool['inputSchema'],
    };

    // Standard profile (Claude / OpenAI / Codex) MUST remain byte-for-byte identical.
    const standardState = normalizeMcpToolInputSchemaForProfile(stateRecordTool.inputSchema, 'standard');
    const standardNode = normalizeMcpToolInputSchemaForProfile(nodeRecordTool.inputSchema, 'standard');
    expect(JSON.stringify(standardState)).toBe(JSON.stringify(stateRecordTool.inputSchema));
    expect(JSON.stringify(standardNode)).toBe(JSON.stringify(nodeRecordTool.inputSchema));
    expect(applyMcpToolSchemaProfile(stateRecordTool, 'standard')).toBe(stateRecordTool);
    expect(applyMcpToolSchemaProfile(nodeRecordTool, 'standard')).toBe(nodeRecordTool);
    expect(standardState.required).toEqual(['status', 'pending_safe_work', 'runtime_reason_code']);
    expect(
      ((standardState.properties as Record<string, any>).continuation_assessment.properties.kg.required),
    ).toEqual(['status', 'search_tool_use_id', 'answer_tool_use_id', 'question_digest']);
    expect(standardNode.required).toEqual(['node_id', 'status', 'previous_result_tool_use_id']);

    // Gemini profile excludes nullable: true properties from `required`, keeps non-nullable required keys,
    // documents omission in `description`, validates with 0 issues, and stays strictly idempotent.
    const geminiStateTool = applyMcpToolSchemaProfile(stateRecordTool, 'gemini');
    const geminiNodeTool = applyMcpToolSchemaProfile(nodeRecordTool, 'gemini');
    expect(validateMcpToolSchemaPortability(geminiStateTool)).toEqual([]);
    expect(validateMcpToolSchemaPortability(geminiNodeTool)).toEqual([]);
    expect(normalizeMcpToolInputSchemaForPortability(geminiStateTool.inputSchema)).toEqual(geminiStateTool.inputSchema);
    expect(normalizeMcpToolInputSchemaForPortability(geminiNodeTool.inputSchema)).toEqual(geminiNodeTool.inputSchema);

    expect(geminiStateTool.inputSchema.required).toEqual(['status', 'pending_safe_work']);
    const geminiStateProps = geminiStateTool.inputSchema.properties as Record<string, any>;
    expect(geminiStateProps.runtime_reason_code).toEqual({
      type: 'string',
      nullable: true,
      description: 'Reason code when not completed. Omit or pass null when unset.',
    });

    const geminiKg = geminiStateProps.continuation_assessment.properties.kg;
    expect(geminiKg.required).toEqual(['status']);
    for (const key of ['search_tool_use_id', 'answer_tool_use_id', 'question_digest']) {
      expect(geminiKg.properties[key].nullable).toBe(true);
      expect(geminiKg.properties[key].description).toContain('Omit or pass null when unset.');
      expect(geminiKg.properties[key].description).not.toContain('null is also accepted.');
    }

    expect(geminiNodeTool.inputSchema.required).toEqual(['node_id', 'status']);
    const geminiNodeProps = geminiNodeTool.inputSchema.properties as Record<string, any>;
    expect(geminiNodeProps.previous_result_tool_use_id).toEqual({
      type: 'string',
      nullable: true,
      description: 'Prior tool use ID when referencing an earlier result. Omit or pass null when unset.',
    });
  });

  it('satisfies the live judgment-node-evidence contract when Gemini omits previous_result_tool_use_id per its normalized required list', () => {
    const liveNodeRecordTool: Tool = {
      name: 'brainbase_judgment_node_record',
      description: 'Record compact evidence for a judgment node.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: [
          'node_id',
          'status',
          'finding',
          'evidence_fit',
          'unknowns',
          'evidence_tool_use_ids',
          'previous_result_tool_use_id',
          'next_action',
        ],
        properties: {
          node_id: { type: 'string' },
          status: { type: 'string', enum: ['supported', 'insufficient'] },
          finding: { type: 'string' },
          evidence_fit: { type: 'string' },
          unknowns: { type: 'array', items: { type: 'string' } },
          evidence_tool_use_ids: { type: 'array', items: { type: 'string' } },
          previous_result_tool_use_id: {
            type: ['string', 'null'],
            description: 'Prior tool use ID when referencing an earlier node result.',
          },
          next_action: { type: 'string' },
        },
      } as unknown as Tool['inputSchema'],
    };

    // Standard profile stays byte-for-byte identical.
    expect(applyMcpToolSchemaProfile(liveNodeRecordTool, 'standard')).toBe(liveNodeRecordTool);
    expect(JSON.stringify(normalizeMcpToolInputSchemaForProfile(liveNodeRecordTool.inputSchema, 'standard')))
      .toBe(JSON.stringify(liveNodeRecordTool.inputSchema));

    // Gemini profile drops nullable previous_result_tool_use_id from required without duplicating null notes.
    const geminiTool = applyMcpToolSchemaProfile(liveNodeRecordTool, 'gemini');
    expect(validateMcpToolSchemaPortability(geminiTool)).toEqual([]);
    expect(normalizeMcpToolInputSchemaForPortability(geminiTool.inputSchema)).toEqual(geminiTool.inputSchema);
    expect(geminiTool.inputSchema.required).toEqual([
      'node_id',
      'status',
      'finding',
      'evidence_fit',
      'unknowns',
      'evidence_tool_use_ids',
      'next_action',
    ]);
    const prevSchema = (geminiTool.inputSchema.properties as Record<string, Record<string, unknown>>).previous_result_tool_use_id;
    expect(prevSchema).toEqual({
      type: 'string',
      nullable: true,
      description: 'Prior tool use ID when referencing an earlier node result. Omit or pass null when unset.',
    });

    // Build a payload containing ONLY the Gemini-required keys (omitting previous_result_tool_use_id).
    const fullArgs: Record<string, unknown> = {
      node_id: 'problem-frame',
      status: 'supported',
      finding: 'The question scope is confirmed.',
      evidence_fit: 'Earlier inspection directly supports this node.',
      unknowns: [],
      evidence_tool_use_ids: ['work-1'],
      next_action: 'Continue to observe.',
    };
    const geminiPayload: Record<string, unknown> = {};
    for (const key of geminiTool.inputSchema.required ?? []) {
      geminiPayload[key] = fullArgs[key];
    }
    expect(Object.hasOwn(geminiPayload, 'previous_result_tool_use_id')).toBe(false);

    // Real judgment-node-evidence validator accepts the omitted payload and normalizes previous_result_tool_use_id to null.
    const omittedResult = {
      schema_version: JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION,
      ...geminiPayload,
    };
    const normalized = normalizeJudgmentNodeResult(omittedResult);
    expect(normalized).toEqual({
      schema_version: JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION,
      node_id: 'problem-frame',
      status: 'supported',
      finding: 'The question scope is confirmed.',
      evidence_fit: 'Earlier inspection directly supports this node.',
      unknowns: [],
      evidence_tool_use_ids: ['work-1'],
      previous_result_tool_use_id: null,
      next_action: 'Continue to observe.',
    });
    expect(Object.hasOwn(omittedResult, 'previous_result_tool_use_id')).toBe(false);

    // End-to-end evaluation with evaluateJudgmentNodeEvidence accepts omitted first-node previous_result_tool_use_id and chains to the next node.
    const receipt = {
      active_node_definitions: [
        { id: 'problem-frame', execution_contract: JUDGMENT_NODE_EVIDENCE_CONTRACT },
        { id: 'observe', execution_contract: JUDGMENT_NODE_EVIDENCE_CONTRACT },
      ],
    };
    const evaluation = evaluateJudgmentNodeEvidence([
      {
        event_kind: 'execution',
        success: true,
        tool_name: 'mcp__example__inspect',
        tool_use_id: 'work-1',
        event_sequence: 1,
        safe_metadata: {},
      },
      {
        event_kind: 'node_evidence',
        success: true,
        tool_name: 'mcp__brainbase__brainbase_judgment_node_record',
        tool_use_id: 'node-problem',
        event_sequence: 2,
        safe_metadata: { node_result: omittedResult },
      },
      {
        event_kind: 'execution',
        success: true,
        tool_name: 'mcp__example__inspect',
        tool_use_id: 'work-2',
        event_sequence: 3,
        safe_metadata: {},
      },
      {
        event_kind: 'node_evidence',
        success: true,
        tool_name: 'mcp__brainbase__brainbase_judgment_node_record',
        tool_use_id: 'node-observe',
        event_sequence: 4,
        safe_metadata: {
          node_result: {
            ...omittedResult,
            node_id: 'observe',
            evidence_tool_use_ids: ['work-2'],
            previous_result_tool_use_id: 'node-problem',
            next_action: 'Finish answer.',
          },
        },
      },
    ], receipt);
    expect(evaluation).toMatchObject({
      required: true,
      ready: true,
      status: 'ready',
      next_node: null,
    });
    expect(evaluation.results[0]?.previous_result_tool_use_id).toBeNull();
    expect(evaluation.results[1]?.previous_result_tool_use_id).toBe('node-problem');

    // Fail-closed checks: unknown keys and invalid types/strings remain rejected.
    expect(normalizeJudgmentNodeResult({ ...omittedResult, extra: true })).toBeNull();
    expect(normalizeJudgmentNodeResult({ ...omittedResult, previous_result_tool_use_id: 123 })).toBeNull();
    expect(normalizeJudgmentNodeResult({ ...omittedResult, previous_result_tool_use_id: 'token=do-not-store' })).toBeNull();
  });

  it('publishes ./mcp-tool-schema-portability and re-exports profile helpers via ./mcp-runtime', async () => {
    const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(manifest.exports['./mcp-tool-schema-portability']).toEqual({
      types: './dist/mcp-tool-schema-portability.d.ts',
      import: './dist/mcp-tool-schema-portability.js',
    });
    const direct = await import(pathToFileURL(path.join(process.cwd(), 'dist/mcp-tool-schema-portability.js')).href);
    const runtime = await import(pathToFileURL(path.join(process.cwd(), 'dist/mcp-runtime.js')).href);
    for (const symbol of [
      'resolveMcpToolSchemaProfile',
      'applyMcpToolSchemaProfile',
      'normalizeMcpToolInputSchemaForPortability',
      'normalizeMcpToolInputSchemaForProfile',
      'normalizeMcpToolForPortability',
      'validateMcpToolInputSchemaPortability',
      'validateMcpToolSchemaPortability',
      'assertMcpToolSchemasPortable',
    ]) {
      expect(typeof direct[symbol]).toBe('function');
      expect(typeof runtime[symbol]).toBe('function');
      expect(runtime[symbol]).toBe(direct[symbol]);
    }
  });
});
