import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer, toolDefinitions } from '../src/server.js';
import { foundationPublicToolDefinitions, type FoundationPublicConnection } from '../src/foundation-public-provider.js';
import { foundationAdoptionTools, foundationPublicTools } from '../src/foundation-authenticated-tools.js';
import { judgmentFrameTools, judgmentModelOutcomeTools } from '../src/judgment-frame.js';
import { judgmentFrameReadTools } from '../src/judgment-frame-read.js';
import { knowledgeLookupTools } from '../src/knowledge-lookup.js';
import { queueTaskToolDefinitions } from '../src/queue-task-tools.js';
import {
  assertMcpToolSchemasPortable,
  createLocalMcpServer,
  normalizeMcpToolInputSchemaForPortability,
  validateMcpToolSchemaPortability,
  type LocalMcpRuntimeTool,
} from '../src/mcp-runtime.js';

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

    const issuesBefore = validateMcpToolSchemaPortability(nonPortableTool);
    expect(issuesBefore.some((issue) => issue.code === 'array_items_missing')).toBe(true);
    expect(issuesBefore.some((issue) => issue.code === 'forbidden_keyword' && issue.path.endsWith('.prefixItems'))).toBe(true);

    const server = createLocalMcpServer({
      name: 'reproducer-host',
      version: '1.0.0',
      tools: [{ definition: nonPortableTool, handler: async () => ({ content: [] }) }],
    });
    const [listed] = await listToolsFromServer(server);
    expect(validateMcpToolSchemaPortability(listed)).toEqual([]);
    expect(listed.inputSchema.properties?.presented_sections).toEqual({
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'string',
        enum: ['覚えていたこと', 'つながったこと', '次にできること'],
      },
    });
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
    expect(props.nullable_text).toEqual({ type: 'string' });
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
    const codes = new Set(issues.map((issue) => issue.code));
    expect(codes).toEqual(new Set([
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
});
