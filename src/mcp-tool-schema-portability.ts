import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type McpToolSchemaPortabilityIssueCode =
  | 'root_not_object'
  | 'root_properties_missing'
  | 'type_missing'
  | 'type_array_forbidden'
  | 'type_unsupported'
  | 'array_items_missing'
  | 'array_items_tuple_forbidden'
  | 'forbidden_keyword'
  | 'enum_type_not_string'
  | 'enum_invalid'
  | 'required_not_array'
  | 'required_property_missing'
  | 'properties_invalid';

export interface McpToolSchemaPortabilityIssue {
  readonly tool: string;
  readonly path: string;
  readonly code: McpToolSchemaPortabilityIssueCode;
  readonly message: string;
}

const SUPPORTED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);

/**
 * JSON Schema keywords rejected or mis-rendered by Gemini FunctionDeclaration
 * (OpenAPI 3.0 subset), Codex, or strict cross-client tool-schema parsers.
 */
const FORBIDDEN_KEYWORDS = new Set([
  'prefixItems',
  'const',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  '$ref',
  '$defs',
  'definitions',
  '$schema',
  '$id',
  '$anchor',
  '$dynamicRef',
  '$comment',
  'additionalItems',
  'dependentSchemas',
  'dependentRequired',
  'dependencies',
  'if',
  'then',
  'else',
  'patternProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'minContains',
  'maxContains',
  'nullable',
]);

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function appendDescription(existing: unknown, addition: string): string {
  const base = typeof existing === 'string' ? existing.trim() : '';
  if (!base) return addition;
  if (base.includes(addition)) return base;
  return `${base} ${addition}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function resolvePointer(root: JsonObject, ref: string): JsonObject | null {
  if (!ref.startsWith('#/')) return null;
  const parts = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: unknown = root;
  for (const part of parts) {
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) return null;
    current = current[part];
  }
  return isPlainObject(current) ? current : null;
}

function isPureNullSchema(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  if (node.type === 'null') return true;
  if (Array.isArray(node.type) && node.type.length > 0 && node.type.every((entry) => entry === 'null')) return true;
  if (Object.hasOwn(node, 'const') && node.const === null) return true;
  if (Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((entry) => entry === null)) return true;
  return false;
}

function inferTypeFromValue(value: unknown): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (Array.isArray(value)) return 'array';
  if (isPlainObject(value)) return 'object';
  return 'string';
}

function mergeNormalizedSchemas(branches: readonly JsonObject[], mode: 'union' | 'intersection'): JsonObject {
  const nonNull = branches.filter((branch) => !isPureNullSchema(branch));
  if (nonNull.length === 0) return { type: 'string' };
  if (nonNull.length === 1) return structuredClone(nonNull[0]);

  const types = new Set(nonNull.map((branch) => String(branch.type ?? 'string')));
  if (types.size === 1) {
    const singleType = [...types][0];
    if (singleType === 'object') {
      return mergeObjectSchemas(nonNull, mode);
    }
    if (singleType === 'string') {
      const result: JsonObject = { type: 'string' };
      const allHaveEnum = nonNull.every((branch) => Array.isArray(branch.enum) && branch.enum.length > 0);
      if (allHaveEnum) {
        const mergedEnums = uniqueStrings(
          nonNull.flatMap((branch) => (branch.enum as unknown[]).filter((item): item is string => typeof item === 'string')),
        );
        if (mergedEnums.length > 0) result.enum = mergedEnums;
      }
      const description = nonNull.find((branch) => typeof branch.description === 'string')?.description;
      if (typeof description === 'string') result.description = description;
      return result;
    }
    if (singleType === 'array') {
      const itemSchemas = nonNull
        .map((branch) => branch.items)
        .filter((item): item is JsonObject => isPlainObject(item));
      const mergedItems = itemSchemas.length > 0
        ? mergeNormalizedSchemas(itemSchemas, 'union')
        : { type: 'string' };
      const result: JsonObject = { type: 'array', items: mergedItems };
      const description = nonNull.find((branch) => typeof branch.description === 'string')?.description;
      if (typeof description === 'string') result.description = description;
      return result;
    }
    const base = structuredClone(nonNull[0]);
    return base;
  }

  if (types.size === 2 && types.has('integer') && types.has('number')) {
    return { type: 'number' };
  }

  const description = nonNull.find((branch) => typeof branch.description === 'string')?.description;
  return {
    type: 'string',
    ...(typeof description === 'string' ? { description } : {}),
  };
}

function mergeObjectSchemas(branches: readonly JsonObject[], mode: 'union' | 'intersection'): JsonObject {
  const properties: JsonObject = {};
  const propertyBranches = new Map<string, JsonObject[]>();

  for (const branch of branches) {
    if (!isPlainObject(branch.properties)) continue;
    for (const [key, propSchema] of Object.entries(branch.properties)) {
      if (!isPlainObject(propSchema)) continue;
      const list = propertyBranches.get(key) ?? [];
      list.push(propSchema);
      propertyBranches.set(key, list);
    }
  }

  for (const [key, list] of propertyBranches.entries()) {
    properties[key] = list.length === 1
      ? structuredClone(list[0])
      : mergeNormalizedSchemas(list, mode);
  }

  const branchRequiredLists = branches.map((branch) =>
    Array.isArray(branch.required)
      ? branch.required.filter((entry): entry is string => typeof entry === 'string')
      : [],
  );

  let required: string[];
  if (mode === 'intersection') {
    required = uniqueStrings(branchRequiredLists.flat());
  } else {
    const first = branchRequiredLists[0] ?? [];
    required = uniqueStrings(
      first.filter((key) => branchRequiredLists.every((list) => list.includes(key))),
    );
  }
  required = required.filter((key) => Object.hasOwn(properties, key));

  const allDisallowedAdditional = branches.every((branch) => branch.additionalProperties === false);
  const description = branches.find((branch) => typeof branch.description === 'string')?.description;

  const merged: JsonObject = {
    type: 'object',
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(required.length > 0 ? { required } : {}),
    ...(allDisallowedAdditional ? { additionalProperties: false } : {}),
    ...(typeof description === 'string' ? { description } : {}),
  };
  return merged;
}

function normalizeSchemaNode(
  rawNode: unknown,
  root: JsonObject,
  seenRefs: ReadonlySet<string>,
  isRoot = false,
): JsonObject {
  if (!isPlainObject(rawNode)) {
    return isRoot ? { type: 'object', properties: {} } : { type: 'string' };
  }

  // Resolve internal $ref first (with cycle protection).
  let working: JsonObject = { ...rawNode };
  if (typeof working.$ref === 'string') {
    const ref = working.$ref;
    delete working.$ref;
    if (!seenRefs.has(ref)) {
      const target = resolvePointer(root, ref);
      if (target) {
        const nextSeen = new Set(seenRefs);
        nextSeen.add(ref);
        const resolvedTarget = normalizeSchemaNode(target, root, nextSeen, false);
        working = { ...resolvedTarget, ...working };
      }
    }
  }

  // Flatten combinators (oneOf / anyOf / allOf) before finalizing node type.
  const combinatorKeys = ['oneOf', 'anyOf', 'allOf'] as const;
  for (const combinatorKey of combinatorKeys) {
    const rawBranches = working[combinatorKey];
    if (!Array.isArray(rawBranches)) continue;
    delete working[combinatorKey];

    const normalizedBranches = rawBranches
      .filter((branch) => !isPureNullSchema(branch))
      .map((branch) => normalizeSchemaNode(branch, root, seenRefs, false));
    const mode = combinatorKey === 'allOf' ? 'intersection' : 'union';
    const mergedBranch = mergeNormalizedSchemas(normalizedBranches, mode);

    // Merge outer sibling properties/required if present on object schemas.
    const hasOuterObjectFields = isPlainObject(working.properties) || Array.isArray(working.required);
    if (mergedBranch.type === 'object' && hasOuterObjectFields) {
      const outerCandidate: JsonObject = { type: 'object' };
      if (isPlainObject(working.properties)) {
        const normalizedOuterProps: JsonObject = {};
        for (const [k, v] of Object.entries(working.properties)) {
          normalizedOuterProps[k] = normalizeSchemaNode(v, root, seenRefs, false);
        }
        outerCandidate.properties = normalizedOuterProps;
      }
      if (Array.isArray(working.required)) outerCandidate.required = working.required;
      if (working.additionalProperties === false) outerCandidate.additionalProperties = false;
      const combined = mergeObjectSchemas([outerCandidate, mergedBranch], 'intersection');
      working = {
        ...working,
        ...combined,
        ...(typeof working.description === 'string' ? { description: working.description } : {}),
      };
    } else {
      const outerDescription = typeof working.description === 'string' ? working.description : undefined;
      working = {
        ...working,
        ...mergedBranch,
        ...(outerDescription !== undefined ? { description: outerDescription } : {}),
      };
    }
  }

  // Convert `const` to portable `enum` (string) or scalar type + description.
  if (Object.hasOwn(working, 'const')) {
    const constValue = working.const;
    delete working.const;
    if (typeof constValue === 'string') {
      working.type = 'string';
      working.enum = [constValue];
    } else if (constValue === null) {
      working.type = working.type ?? 'string';
    } else {
      working.type = inferTypeFromValue(constValue);
      working.description = appendDescription(working.description, `Must be ${JSON.stringify(constValue)}.`);
    }
  }

  // Normalize array-valued `type` (e.g. `['string', 'null']`).
  if (Array.isArray(working.type)) {
    const candidates = working.type.filter(
      (entry): entry is string => typeof entry === 'string' && entry !== 'null' && SUPPORTED_TYPES.has(entry),
    );
    if (candidates.length === 1) {
      working.type = candidates[0];
    } else if (candidates.includes('string')) {
      working.type = 'string';
    } else if (candidates.includes('object')) {
      working.type = 'object';
    } else if (candidates.length > 0) {
      working.type = candidates[0];
    } else {
      working.type = 'string';
    }
  }

  // Handle `enum`: Gemini FunctionDeclaration requires `type: 'string'` and string values.
  if (Array.isArray(working.enum)) {
    const nonNullValues = working.enum.filter((entry) => entry !== null && entry !== undefined);
    if (nonNullValues.length > 0 && nonNullValues.every((entry): entry is string => typeof entry === 'string')) {
      working.type = 'string';
      working.enum = uniqueStrings(nonNullValues);
    } else {
      delete working.enum;
      if (typeof working.type !== 'string' || !SUPPORTED_TYPES.has(working.type)) {
        const inferredTypes = new Set(nonNullValues.map(inferTypeFromValue));
        working.type = inferredTypes.size === 1 ? [...inferredTypes][0] : 'string';
      }
      if (nonNullValues.length > 0) {
        working.description = appendDescription(
          working.description,
          `Allowed values: ${nonNullValues.map((v) => JSON.stringify(v)).join(', ')}.`,
        );
      }
    }
  }

  // Infer missing `type`.
  if (typeof working.type !== 'string' || !SUPPORTED_TYPES.has(working.type)) {
    if (isRoot) {
      working.type = 'object';
    } else if (isPlainObject(working.properties) || Array.isArray(working.required)) {
      working.type = 'object';
    } else if (working.items !== undefined || Array.isArray(working.prefixItems)) {
      working.type = 'array';
    } else {
      working.type = 'string';
    }
  }

  if (isRoot) {
    working.type = 'object';
  }

  // Normalize array schemas: convert prefixItems / tuple items to portable `items`.
  if (working.type === 'array') {
    const rawPrefixItems = Array.isArray(working.prefixItems) ? working.prefixItems : null;
    const rawItems = working.items;
    delete working.prefixItems;

    if (rawPrefixItems && rawPrefixItems.length > 0) {
      const tupleBranches = rawPrefixItems.map((entry) => normalizeSchemaNode(entry, root, seenRefs, false));
      if (isPlainObject(rawItems)) {
        tupleBranches.push(normalizeSchemaNode(rawItems, root, seenRefs, false));
      } else if (rawItems === false && working.maxItems === undefined) {
        working.maxItems = rawPrefixItems.length;
      }
      working.items = mergeNormalizedSchemas(tupleBranches, 'union');
    } else if (Array.isArray(rawItems)) {
      const tupleBranches = rawItems.map((entry) => normalizeSchemaNode(entry, root, seenRefs, false));
      if (isPlainObject(working.additionalItems)) {
        tupleBranches.push(normalizeSchemaNode(working.additionalItems, root, seenRefs, false));
      } else if (working.additionalItems === false && working.maxItems === undefined) {
        working.maxItems = rawItems.length;
      }
      working.items = tupleBranches.length > 0 ? mergeNormalizedSchemas(tupleBranches, 'union') : { type: 'string' };
    } else if (isPlainObject(rawItems)) {
      working.items = normalizeSchemaNode(rawItems, root, seenRefs, false);
    } else {
      working.items = { type: 'string' };
    }
  }

  // Normalize object schemas: recurse into properties and keep `required` consistent.
  if (working.type === 'object') {
    if (isPlainObject(working.properties)) {
      const normalizedProperties: JsonObject = {};
      for (const [key, child] of Object.entries(working.properties)) {
        normalizedProperties[key] = normalizeSchemaNode(child, root, seenRefs, false);
      }
      working.properties = normalizedProperties;
    } else if (isRoot) {
      working.properties = {};
    }

    if (Array.isArray(working.required)) {
      const props = isPlainObject(working.properties) ? working.properties : {};
      const filtered = uniqueStrings(
        working.required.filter((key): key is string => typeof key === 'string' && Object.hasOwn(props, key)),
      );
      working.required = filtered;
    } else if (working.required !== undefined) {
      delete working.required;
    }
  }

  // Strip any remaining forbidden keywords.
  for (const key of Object.keys(working)) {
    if (FORBIDDEN_KEYWORDS.has(key)) {
      delete working[key];
    }
  }

  return working;
}

/**
 * Normalize an MCP tool `inputSchema` into a portable JSON Schema subset
 * accepted by Gemini (OpenAPI 3.0 FunctionDeclaration), OpenAI, Claude, and Codex.
 *
 * Idempotent on already-portable schemas.
 */
export function normalizeMcpToolInputSchemaForPortability(
  schema: Tool['inputSchema'],
): Tool['inputSchema'] {
  const cloned = isPlainObject(schema) ? (structuredClone(schema) as JsonObject) : { type: 'object', properties: {} };
  return normalizeSchemaNode(cloned, cloned, new Set<string>(), true) as Tool['inputSchema'];
}

/**
 * Return a cloned MCP Tool definition with a portable `inputSchema`.
 */
export function normalizeMcpToolForPortability<T extends Tool>(tool: T): T {
  const cloned = structuredClone(tool);
  return {
    ...cloned,
    inputSchema: normalizeMcpToolInputSchemaForPortability(cloned.inputSchema),
  };
}

function validateSchemaNode(
  toolName: string,
  node: unknown,
  path: string,
  issues: McpToolSchemaPortabilityIssue[],
  isRoot = false,
): void {
  if (!isPlainObject(node)) {
    issues.push({
      tool: toolName,
      path,
      code: isRoot ? 'root_not_object' : 'type_missing',
      message: `${path} must be a JSON Schema object.`,
    });
    return;
  }

  for (const key of Object.keys(node)) {
    if (FORBIDDEN_KEYWORDS.has(key)) {
      issues.push({
        tool: toolName,
        path: `${path}.${key}`,
        code: 'forbidden_keyword',
        message: `${path} uses non-portable JSON Schema keyword "${key}".`,
      });
    }
  }

  if (Array.isArray(node.type)) {
    issues.push({
      tool: toolName,
      path: `${path}.type`,
      code: 'type_array_forbidden',
      message: `${path}.type must be a single type string, not an array (${JSON.stringify(node.type)}).`,
    });
  } else if (typeof node.type !== 'string') {
    issues.push({
      tool: toolName,
      path: `${path}.type`,
      code: 'type_missing',
      message: `${path} is missing a string "type" field.`,
    });
  } else if (!SUPPORTED_TYPES.has(node.type)) {
    issues.push({
      tool: toolName,
      path: `${path}.type`,
      code: 'type_unsupported',
      message: `${path}.type "${node.type}" is not supported across Gemini/OpenAI/Claude tool schemas.`,
    });
  }

  if (isRoot) {
    if (node.type !== 'object') {
      issues.push({
        tool: toolName,
        path: `${path}.type`,
        code: 'root_not_object',
        message: `Root inputSchema must have type "object".`,
      });
    }
    if (!isPlainObject(node.properties)) {
      issues.push({
        tool: toolName,
        path: `${path}.properties`,
        code: 'root_properties_missing',
        message: `Root inputSchema must declare a "properties" object.`,
      });
    }
  }

  if (Object.hasOwn(node, 'enum')) {
    if (node.type !== 'string') {
      issues.push({
        tool: toolName,
        path: `${path}.enum`,
        code: 'enum_type_not_string',
        message: `${path} declares "enum" without type: "string" (Gemini only accepts string enums).`,
      });
    }
    if (
      !Array.isArray(node.enum)
      || node.enum.length === 0
      || node.enum.some((entry) => typeof entry !== 'string')
      || new Set(node.enum).size !== node.enum.length
    ) {
      issues.push({
        tool: toolName,
        path: `${path}.enum`,
        code: 'enum_invalid',
        message: `${path}.enum must be a non-empty array of unique strings.`,
      });
    }
  }

  if (node.type === 'array') {
    if (Array.isArray(node.items)) {
      issues.push({
        tool: toolName,
        path: `${path}.items`,
        code: 'array_items_tuple_forbidden',
        message: `${path}.items must be a single schema object, not a tuple array.`,
      });
    } else if (!isPlainObject(node.items) || Object.keys(node.items).length === 0) {
      issues.push({
        tool: toolName,
        path: `${path}.items`,
        code: 'array_items_missing',
        message: `${path} has type "array" without a non-empty "items" schema (causes Gemini 400 INVALID_ARGUMENT).`,
      });
    } else {
      validateSchemaNode(toolName, node.items, `${path}.items`, issues, false);
    }
  }

  if (node.type === 'object') {
    if (node.properties !== undefined && !isPlainObject(node.properties)) {
      issues.push({
        tool: toolName,
        path: `${path}.properties`,
        code: 'properties_invalid',
        message: `${path}.properties must be a plain object.`,
      });
    }
    const properties = isPlainObject(node.properties) ? node.properties : undefined;
    if (properties) {
      for (const [key, child] of Object.entries(properties)) {
        validateSchemaNode(toolName, child, `${path}.properties.${key}`, issues, false);
      }
    }
    if (node.required !== undefined) {
      if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
        issues.push({
          tool: toolName,
          path: `${path}.required`,
          code: 'required_not_array',
          message: `${path}.required must be an array of strings.`,
        });
      } else {
        for (const requiredKey of node.required) {
          if (!properties || !Object.hasOwn(properties, requiredKey)) {
            issues.push({
              tool: toolName,
              path: `${path}.required`,
              code: 'required_property_missing',
              message: `${path}.required lists "${requiredKey}" which is not declared in ${path}.properties.`,
            });
          }
        }
      }
    }
  }
}

/**
 * Validate a single MCP Tool's `inputSchema` against Gemini/OpenAI/Claude/Codex
 * portability requirements. Returns an empty array when fully portable.
 */
export function validateMcpToolSchemaPortability(
  tool: Pick<Tool, 'name' | 'inputSchema'>,
): McpToolSchemaPortabilityIssue[] {
  const issues: McpToolSchemaPortabilityIssue[] = [];
  validateSchemaNode(tool.name, tool.inputSchema, 'inputSchema', issues, true);
  return issues;
}

/**
 * Assert that every MCP Tool in `tools` satisfies cross-client schema portability.
 */
export function assertMcpToolSchemasPortable(
  tools: readonly Pick<Tool, 'name' | 'inputSchema'>[],
): void {
  const issues = tools.flatMap((tool) => validateMcpToolSchemaPortability(tool));
  if (issues.length === 0) return;
  const formatted = issues
    .map((issue) => `- ${issue.tool} (${issue.path}) [${issue.code}]: ${issue.message}`)
    .join('\n');
  throw new Error(`MCP tool inputSchema portability violations detected:\n${formatted}`);
}
