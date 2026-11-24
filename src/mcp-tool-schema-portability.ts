import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type McpToolSchemaProfile = 'standard' | 'gemini';

export type McpToolSchemaPortabilityIssueCode =
  | 'root_not_object'
  | 'root_properties_missing'
  | 'object_properties_missing'
  | 'type_missing'
  | 'type_array_forbidden'
  | 'type_unsupported'
  | 'array_items_missing'
  | 'array_items_tuple_forbidden'
  | 'forbidden_keyword'
  | 'nullable_invalid'
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

const NULL_NOTE = 'null is also accepted.';

/**
 * JSON Schema keywords rejected or mis-rendered by Gemini FunctionDeclaration
 * (OpenAPI 3.0 subset). Note that OpenAPI boolean `nullable` is allowed by
 * Gemini and validated separately.
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
]);

type JsonObject = Record<string, unknown>;

interface MergedSchemaResult {
  schema: JsonObject;
  notes: string[];
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function setOwnProperty(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function appendDescription(existing: unknown, addition: string): string {
  const base = typeof existing === 'string' ? existing.trim() : '';
  if (!base) return addition;
  if (base.includes(addition)) return base;
  return `${base} ${addition}`;
}

function appendDescriptions(existing: unknown, additions: readonly string[]): string | undefined {
  let result = typeof existing === 'string' ? existing.trim() : '';
  for (const addition of additions) {
    if (!addition) continue;
    result = appendDescription(result, addition);
  }
  return result || undefined;
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

function pruneUndeclaredRequired(node: JsonObject): void {
  if (isPlainObject(node.properties)) {
    for (const child of Object.values(node.properties)) {
      if (isPlainObject(child)) {
        pruneUndeclaredRequired(child);
      }
    }
  }
  if (isPlainObject(node.items)) {
    pruneUndeclaredRequired(node.items);
  }
  if (isPlainObject(node.additionalProperties)) {
    pruneUndeclaredRequired(node.additionalProperties);
  }
  if (node.type === 'object' && Array.isArray(node.required)) {
    const props = isPlainObject(node.properties) ? node.properties : {};
    const filtered = uniqueStrings(
      node.required.filter(
        (key): key is string => typeof key === 'string' && Object.hasOwn(props, key),
      ),
    );
    if (filtered.length > 0) {
      node.required = filtered;
    } else {
      delete node.required;
    }
  }
}

function mergeNormalizedSchemas(
  branches: readonly JsonObject[],
  mode: 'union' | 'intersection',
  preserveUndeclaredRequired = false,
): MergedSchemaResult {
  const nonNull = branches.filter((branch) => !isPureNullSchema(branch));
  if (nonNull.length === 0) return { schema: { type: 'string' }, notes: [] };
  if (nonNull.length === 1) {
    const single = structuredClone(nonNull[0]);
    if (!preserveUndeclaredRequired) {
      pruneUndeclaredRequired(single);
    }
    return { schema: single, notes: [] };
  }

  const anyNullable = mode === 'union' && nonNull.some((branch) => branch.nullable === true);
  const types = new Set(nonNull.map((branch) => String(branch.type ?? 'string')));
  if (types.size === 1) {
    const singleType = [...types][0];
    if (singleType === 'object') {
      const mergedObject = mergeObjectSchemas(nonNull, mode, preserveUndeclaredRequired);
      if (anyNullable) {
        mergedObject.nullable = true;
        mergedObject.description = appendDescription(mergedObject.description, NULL_NOTE);
      }
      return { schema: mergedObject, notes: [] };
    }
    if (singleType === 'string') {
      const result: JsonObject = { type: 'string' };
      const notes: string[] = [];
      const description = nonNull.find((branch) => typeof branch.description === 'string')?.description;
      if (typeof description === 'string') result.description = description;
      const allHaveEnum = nonNull.every((branch) => Array.isArray(branch.enum) && branch.enum.length > 0);
      if (allHaveEnum) {
        const mergedEnums = uniqueStrings(
          nonNull.flatMap((branch) => (branch.enum as unknown[]).filter((item): item is string => typeof item === 'string')),
        );
        if (mergedEnums.length > 0) {
          if (anyNullable) {
            const note = `Allowed values: ${mergedEnums.map((value) => JSON.stringify(value)).join(', ')}.`;
            notes.push(note);
            result.description = appendDescription(result.description, note);
          } else {
            result.enum = mergedEnums;
          }
        }
      }
      if (anyNullable) {
        result.nullable = true;
        result.description = appendDescription(result.description, NULL_NOTE);
      }
      return { schema: result, notes };
    }
    if (singleType === 'array') {
      const itemSchemas = nonNull
        .map((branch) => branch.items)
        .filter((item): item is JsonObject => isPlainObject(item));
      const mergedItems = itemSchemas.length > 0
        ? mergeNormalizedSchemas(itemSchemas, mode, preserveUndeclaredRequired).schema
        : { type: 'string' };
      const result: JsonObject = { type: 'array', items: mergedItems };
      const description = nonNull.find((branch) => typeof branch.description === 'string')?.description;
      if (typeof description === 'string') result.description = description;
      if (anyNullable) {
        result.nullable = true;
        result.description = appendDescription(result.description, NULL_NOTE);
      }
      return { schema: result, notes: [] };
    }
    const base = structuredClone(nonNull[0]);
    if (anyNullable) {
      base.nullable = true;
      base.description = appendDescription(base.description, NULL_NOTE);
    }
    return { schema: base, notes: [] };
  }

  if (types.size === 2 && types.has('integer') && types.has('number')) {
    const description = nonNull.find((branch) => typeof branch.description === 'string')?.description;
    const result: JsonObject = {
      type: 'number',
      ...(typeof description === 'string' ? { description } : {}),
    };
    if (anyNullable) {
      result.nullable = true;
      result.description = appendDescription(result.description, NULL_NOTE);
    }
    return { schema: result, notes: [] };
  }

  const [first, ...rest] = nonNull;
  const merged = structuredClone(first);
  if (!preserveUndeclaredRequired) {
    pruneUndeclaredRequired(merged);
  }
  const firstType = String(merged.type ?? 'value');
  const otherShapes = uniqueStrings(
    rest
      .map((branch) => String(branch.type ?? 'value'))
      .filter((shape) => shape !== firstType),
  );
  const notes: string[] = [];
  if (otherShapes.length > 0) {
    const shapeNote = `Other accepted shapes: ${otherShapes.join(', ')}.`;
    notes.push(shapeNote);
    merged.description = appendDescription(merged.description, shapeNote);
  }
  if (anyNullable) {
    merged.nullable = true;
    merged.description = appendDescription(merged.description, NULL_NOTE);
  }
  return { schema: merged, notes };
}

function mergeObjectSchemas(
  branches: readonly JsonObject[],
  mode: 'union' | 'intersection',
  preserveUndeclaredRequired = false,
): JsonObject {
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
    let mergedProp: JsonObject;
    if (list.length === 1) {
      mergedProp = structuredClone(list[0]);
      if (!preserveUndeclaredRequired) {
        pruneUndeclaredRequired(mergedProp);
      }
    } else {
      mergedProp = mergeNormalizedSchemas(list, mode, preserveUndeclaredRequired).schema;
    }
    setOwnProperty(properties, key, mergedProp);
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
  if (!preserveUndeclaredRequired) {
    required = required.filter((key) => Object.hasOwn(properties, key));
  }

  const disallowAdditional = mode === 'intersection'
    ? branches.some((branch) => branch.additionalProperties === false)
    : branches.every((branch) => branch.additionalProperties === false);
  const additionalSchemas = branches
    .map((branch) => branch.additionalProperties)
    .filter((entry): entry is JsonObject => isPlainObject(entry));
  let mergedAdditionalProperties: JsonObject | false | undefined;
  if (disallowAdditional) {
    mergedAdditionalProperties = false;
  } else if (
    additionalSchemas.length > 0
    && (
      mode === 'intersection'
      || branches.every((branch) => isPlainObject(branch.additionalProperties) || branch.additionalProperties === false)
    )
  ) {
    if (additionalSchemas.length === 1) {
      mergedAdditionalProperties = structuredClone(additionalSchemas[0]);
      if (!preserveUndeclaredRequired) {
        pruneUndeclaredRequired(mergedAdditionalProperties);
      }
    } else {
      mergedAdditionalProperties = mergeNormalizedSchemas(
        additionalSchemas,
        mode,
        preserveUndeclaredRequired,
      ).schema;
    }
  }
  const description = branches.find((branch) => typeof branch.description === 'string')?.description;

  const merged: JsonObject = {
    type: 'object',
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(required.length > 0 ? { required } : {}),
    ...(mergedAdditionalProperties !== undefined ? { additionalProperties: mergedAdditionalProperties } : {}),
    ...(typeof description === 'string' ? { description } : {}),
  };
  return merged;
}

function normalizeSchemaNode(
  rawNode: unknown,
  root: JsonObject,
  seenRefs: ReadonlySet<string>,
  isRoot = false,
  preserveUndeclaredRequired = false,
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
        const resolvedTarget = normalizeSchemaNode(
          target,
          root,
          nextSeen,
          false,
          preserveUndeclaredRequired || isPlainObject(working.properties),
        );
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

    const mode = combinatorKey === 'allOf' ? 'intersection' : 'union';
    const hasOuterObjectFields =
      isPlainObject(working.properties)
      || Array.isArray(working.required)
      || isPlainObject(working.additionalProperties)
      || working.additionalProperties === false;
    const hasOuterArrayItems = isPlainObject(working.items);
    const preserveBranchRequired = preserveUndeclaredRequired || mode === 'intersection';
    const preserveMergedRequired =
      preserveUndeclaredRequired
      || (mode === 'intersection' && (hasOuterObjectFields || hasOuterArrayItems));
    const hasNullBranch = rawBranches.some((branch) => isPureNullSchema(branch));
    const normalizedBranches = rawBranches
      .filter((branch) => !isPureNullSchema(branch))
      .map((branch) => normalizeSchemaNode(branch, root, seenRefs, false, preserveBranchRequired));
    const { schema: mergedBranch, notes: mergedNotes } = mergeNormalizedSchemas(
      normalizedBranches,
      mode,
      preserveMergedRequired,
    );
    const shouldBeNullable =
      working.nullable === true
      || mergedBranch.nullable === true
      || (mode === 'union' && hasNullBranch)
      || (hasNullBranch && normalizedBranches.length === 0);

    // Merge outer sibling properties/required/additionalProperties or array items if present.
    const outerDescription = typeof working.description === 'string' ? working.description : undefined;
    if (mergedBranch.type === 'object' && hasOuterObjectFields) {
      const outerCandidate: JsonObject = { type: 'object' };
      if (isPlainObject(working.properties)) {
        const normalizedOuterProps: JsonObject = {};
        for (const [k, v] of Object.entries(working.properties)) {
          setOwnProperty(
            normalizedOuterProps,
            k,
            normalizeSchemaNode(v, root, seenRefs, false, preserveUndeclaredRequired || mode === 'intersection'),
          );
        }
        outerCandidate.properties = normalizedOuterProps;
      }
      if (Array.isArray(working.required)) outerCandidate.required = working.required;
      if (isPlainObject(working.additionalProperties)) {
        outerCandidate.additionalProperties = normalizeSchemaNode(
          working.additionalProperties,
          root,
          seenRefs,
          false,
          preserveUndeclaredRequired || mode === 'intersection',
        );
      } else if (working.additionalProperties === false) {
        outerCandidate.additionalProperties = false;
      }
      const combined = mergeObjectSchemas([outerCandidate, mergedBranch], 'intersection', preserveUndeclaredRequired);
      const finalDescription = outerDescription !== undefined
        ? appendDescriptions(outerDescription, mergedNotes)
        : (typeof combined.description === 'string' ? combined.description : undefined);
      const nextWorking: JsonObject = { ...working };
      delete nextWorking.required;
      working = {
        ...nextWorking,
        ...combined,
        ...(finalDescription !== undefined ? { description: finalDescription } : {}),
      };
    } else if (mergedBranch.type === 'array' && hasOuterArrayItems) {
      const outerArrayCandidate: JsonObject = {
        type: 'array',
        items: normalizeSchemaNode(
          working.items,
          root,
          seenRefs,
          false,
          preserveUndeclaredRequired || mode === 'intersection',
        ),
      };
      const combined = mergeNormalizedSchemas(
        [outerArrayCandidate, mergedBranch],
        'intersection',
        preserveUndeclaredRequired,
      ).schema;
      const finalDescription = outerDescription !== undefined
        ? appendDescriptions(outerDescription, mergedNotes)
        : (typeof combined.description === 'string' ? combined.description : undefined);
      working = {
        ...working,
        ...combined,
        ...(finalDescription !== undefined ? { description: finalDescription } : {}),
      };
    } else {
      const finalDescription = outerDescription !== undefined
        ? appendDescriptions(outerDescription, mergedNotes)
        : (typeof mergedBranch.description === 'string' ? mergedBranch.description : undefined);
      working = {
        ...working,
        ...mergedBranch,
        ...(finalDescription !== undefined ? { description: finalDescription } : {}),
      };
    }
    if (shouldBeNullable) {
      working.nullable = true;
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
      working.type = typeof working.type === 'string' && SUPPORTED_TYPES.has(working.type)
        ? working.type
        : 'string';
      working.nullable = true;
      working.description = appendDescription(working.description, 'Must be null.');
    } else {
      working.type = inferTypeFromValue(constValue);
      working.description = appendDescription(working.description, `Must be ${JSON.stringify(constValue)}.`);
    }
  }

  // Normalize array-valued `type` (e.g. `['string', 'null']` or `['string', 'integer', 'null']`).
  if (Array.isArray(working.type)) {
    const hasNull = working.type.includes('null');
    if (hasNull) working.nullable = true;
    const candidates = uniqueStrings(
      working.type.filter(
        (entry): entry is string => typeof entry === 'string' && entry !== 'null' && SUPPORTED_TYPES.has(entry),
      ),
    );
    if (candidates.length === 1) {
      working.type = candidates[0];
    } else if (candidates.length === 2 && candidates.includes('integer') && candidates.includes('number')) {
      working.type = 'number';
    } else if (candidates.length > 1) {
      working.type = candidates[0];
      working.description = appendDescription(
        working.description,
        `Other accepted shapes: ${candidates.slice(1).join(', ')}.`,
      );
    } else {
      working.type = 'string';
    }
  } else if (working.type === 'null') {
    working.nullable = true;
  }

  // Handle `enum`: Gemini FunctionDeclaration requires `type: 'string'` and string values,
  // and nullable enums move allowed values into `description` so `null` is not rejected.
  if (Array.isArray(working.enum)) {
    if (working.enum.includes(null)) {
      working.nullable = true;
    }
    const nonNullValues = working.enum.filter((entry) => entry !== null && entry !== undefined);
    if (
      working.nullable !== true
      && nonNullValues.length > 0
      && nonNullValues.every((entry): entry is string => typeof entry === 'string')
    ) {
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
    } else if (
      isPlainObject(working.properties)
      || Array.isArray(working.required)
      || isPlainObject(working.additionalProperties)
    ) {
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
      const hasExplicitItems = isPlainObject(rawItems) && Object.keys(rawItems).length > 0;
      if (hasExplicitItems) {
        working.items = normalizeSchemaNode(rawItems, root, seenRefs, false, preserveUndeclaredRequired);
      } else {
        const tupleBranches = rawPrefixItems.map((entry) =>
          normalizeSchemaNode(entry, root, seenRefs, false, preserveUndeclaredRequired),
        );
        if (rawItems === false && working.maxItems === undefined) {
          working.maxItems = rawPrefixItems.length;
        }
        const fixedOrderValues = tupleBranches.every(
          (entry) => entry.type === 'string' && Array.isArray(entry.enum) && entry.enum.length === 1,
        )
          ? tupleBranches.map((entry) => (entry.enum as string[])[0])
          : null;
        working.items = mergeNormalizedSchemas(tupleBranches, 'union', preserveUndeclaredRequired).schema;
        if (fixedOrderValues && fixedOrderValues.length > 0) {
          working.description = appendDescription(
            working.description,
            `In this order: ${fixedOrderValues.map((value) => JSON.stringify(value)).join(', ')}.`,
          );
        }
      }
    } else if (Array.isArray(rawItems)) {
      const tupleBranches = rawItems.map((entry) =>
        normalizeSchemaNode(entry, root, seenRefs, false, preserveUndeclaredRequired),
      );
      if (isPlainObject(working.additionalItems)) {
        tupleBranches.push(
          normalizeSchemaNode(working.additionalItems, root, seenRefs, false, preserveUndeclaredRequired),
        );
      } else if (working.additionalItems === false && working.maxItems === undefined) {
        working.maxItems = rawItems.length;
      }
      working.items = tupleBranches.length > 0
        ? mergeNormalizedSchemas(tupleBranches, 'union', preserveUndeclaredRequired).schema
        : { type: 'string' };
    } else if (isPlainObject(rawItems)) {
      working.items = normalizeSchemaNode(rawItems, root, seenRefs, false, preserveUndeclaredRequired);
    } else {
      working.items = { type: 'string' };
    }
  }

  // Normalize object schemas: recurse into properties and additionalProperties,
  // keep `required` consistent, and mark nested free-form objects explicitly.
  if (working.type === 'object') {
    if (isPlainObject(working.properties)) {
      const normalizedProperties: JsonObject = {};
      for (const [key, child] of Object.entries(working.properties)) {
        setOwnProperty(
          normalizedProperties,
          key,
          normalizeSchemaNode(child, root, seenRefs, false, preserveUndeclaredRequired),
        );
      }
      working.properties = normalizedProperties;
    } else if (isRoot) {
      working.properties = {};
    }

    if (isPlainObject(working.additionalProperties)) {
      working.additionalProperties = normalizeSchemaNode(
        working.additionalProperties,
        root,
        seenRefs,
        false,
        preserveUndeclaredRequired,
      );
    }

    if (!isRoot) {
      const hasProperties = isPlainObject(working.properties) && Object.keys(working.properties).length > 0;
      if (!hasProperties && !isPlainObject(working.additionalProperties) && working.additionalProperties !== true) {
        working.additionalProperties = true;
      }
    }

    if (Array.isArray(working.required)) {
      const props = isPlainObject(working.properties) ? working.properties : {};
      const filtered = uniqueStrings(
        working.required.filter(
          (key): key is string => typeof key === 'string' && (preserveUndeclaredRequired || Object.hasOwn(props, key)),
        ),
      );
      if (filtered.length > 0) {
        working.required = filtered;
      } else {
        delete working.required;
      }
    } else if (working.required !== undefined) {
      delete working.required;
    }
  }

  // Normalize `nullable`: preserve OpenAPI boolean `nullable` (and note `null` in description),
  // strip invalid non-boolean values.
  if (working.nullable === true) {
    working.description = appendDescription(working.description, NULL_NOTE);
  } else if (working.nullable !== false && Object.hasOwn(working, 'nullable')) {
    delete working.nullable;
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
 * Resolve the MCP tool schema profile from environment variables.
 *
 * Defaults to `'standard'` (lossless JSON Schema for Claude / OpenAI / Codex).
 * Launchers targeting Gemini FunctionDeclaration opt in with
 * `BRAINBASE_MCP_SCHEMA_PROFILE=gemini`.
 */
export function resolveMcpToolSchemaProfile(
  env: NodeJS.ProcessEnv = process.env,
): McpToolSchemaProfile {
  return env.BRAINBASE_MCP_SCHEMA_PROFILE?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'standard';
}

/**
 * Normalize an MCP tool `inputSchema` into the Gemini FunctionDeclaration
 * (OpenAPI 3.0) compatible JSON Schema subset.
 *
 * Idempotent on already-portable schemas.
 */
export function normalizeMcpToolInputSchemaForPortability(
  schema: Tool['inputSchema'],
): Tool['inputSchema'] {
  const cloned = isPlainObject(schema) ? (structuredClone(schema) as JsonObject) : { type: 'object', properties: {} };
  const normalized = normalizeSchemaNode(cloned, cloned, new Set<string>(), true);
  pruneUndeclaredRequired(normalized);
  return normalized as Tool['inputSchema'];
}

/**
 * Normalize an MCP tool `inputSchema` according to the target host profile:
 * - `'standard'`: returns a lossless deep clone (Claude / OpenAI / Codex).
 * - `'gemini'`: normalizes into the Gemini FunctionDeclaration subset.
 */
export function normalizeMcpToolInputSchemaForProfile(
  schema: Tool['inputSchema'],
  profile: McpToolSchemaProfile,
): Tool['inputSchema'] {
  if (profile === 'gemini') {
    return normalizeMcpToolInputSchemaForPortability(schema);
  }
  return structuredClone(schema);
}

/**
 * Return a cloned MCP Tool definition with a Gemini-portable `inputSchema`.
 */
export function normalizeMcpToolForPortability<T extends Tool>(tool: T): T {
  const cloned = structuredClone(tool);
  return {
    ...cloned,
    inputSchema: normalizeMcpToolInputSchemaForPortability(cloned.inputSchema),
  };
}

/**
 * Return an MCP Tool definition adapted for the requested host schema profile:
 * - `'standard'`: returns `tool` unchanged (lossless standard JSON Schema).
 * - `'gemini'`: returns a cloned tool normalized for Gemini FunctionDeclaration.
 */
export function applyMcpToolSchemaProfile<T extends Tool>(
  tool: T,
  profile: McpToolSchemaProfile = resolveMcpToolSchemaProfile(),
): T {
  return profile === 'gemini' ? normalizeMcpToolForPortability(tool) : tool;
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

  if (Object.hasOwn(node, 'nullable') && typeof node.nullable !== 'boolean') {
    issues.push({
      tool: toolName,
      path: `${path}.nullable`,
      code: 'nullable_invalid',
      message: `${path}.nullable must be a boolean.`,
    });
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
  } else if (isPlainObject(node.items)) {
    validateSchemaNode(toolName, node.items, `${path}.items`, issues, false);
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
    if (!isRoot) {
      const hasProperties = Boolean(properties) && Object.keys(properties!).length > 0;
      if (!hasProperties && !isPlainObject(node.additionalProperties) && node.additionalProperties !== true) {
        issues.push({
          tool: toolName,
          path,
          code: 'object_properties_missing',
          message: `${path} has type "object" without non-empty "properties" or "additionalProperties" (causes Gemini 400 INVALID_ARGUMENT).`,
        });
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

  if (isPlainObject(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      validateSchemaNode(toolName, child, `${path}.properties.${key}`, issues, false);
    }
  }

  if (isPlainObject(node.additionalProperties)) {
    validateSchemaNode(toolName, node.additionalProperties, `${path}.additionalProperties`, issues, false);
  }

  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const) {
    const list = node[key];
    if (Array.isArray(list)) {
      list.forEach((child, index) => {
        validateSchemaNode(toolName, child, `${path}.${key}[${index}]`, issues, false);
      });
    }
  }
}

/**
 * Validate a raw JSON Schema object against Gemini FunctionDeclaration
 * portability requirements. Returns an empty array when fully portable.
 */
export function validateMcpToolInputSchemaPortability(
  schema: unknown,
  toolName = '<schema>',
): McpToolSchemaPortabilityIssue[] {
  const issues: McpToolSchemaPortabilityIssue[] = [];
  validateSchemaNode(toolName, schema, 'inputSchema', issues, true);
  return issues;
}

/**
 * Validate a single MCP Tool's `inputSchema` against Gemini FunctionDeclaration
 * portability requirements. Returns an empty array when fully portable.
 */
export function validateMcpToolSchemaPortability(
  tool: Pick<Tool, 'name' | 'inputSchema'>,
): McpToolSchemaPortabilityIssue[] {
  return validateMcpToolInputSchemaPortability(tool.inputSchema, tool.name);
}

/**
 * Assert that every MCP Tool in `tools` satisfies Gemini schema portability.
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
