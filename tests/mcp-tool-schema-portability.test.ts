import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
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

describe('MCP tool inputSchema cross-client portability contract (Gemini / OpenAI / Claude / Codex)', () => {
  it('normalizes prefixItems tuple schemas (such as presented_sections) into Gemini-compatible array items', () => {
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

  it('resolves host schema profile from env and separates lossless standard from gemini normalization', () => {
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

    // Gemini profile produces zero violations and documents lost shapes in descriptions.
    const geminiTool = applyMcpToolSchemaProfile(richTool, 'gemini');
    expect(validateMcpToolSchemaPortability(geminiTool)).toEqual([]);
    const geminiProps = geminiTool.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(geminiProps.answer).toEqual({
      type: 'string',
      nullable: true,
      description: 'Nullable answer. null is also accepted.',
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
});
