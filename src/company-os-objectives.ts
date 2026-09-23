import type {
  ObjectiveDefinition,
  ObjectiveCriterion,
  VariableDefinition,
  FoundationDefinition,
  FoundationValidationIssue
} from './ontology-foundation.js';
import { validateFoundationDefinition } from './ontology-foundation.js';
import type { FoundationRef } from './foundation-catalog.js';
import type { FoundationCatalogRecord } from './types.js';
import type {
  FoundationRevisionStore,
  FoundationStoreContext
} from './foundation-store.js';

export interface ObjectiveReadinessIssue {
  code: string;
  path: string;
  message: string;
}

export interface ObjectiveReadiness {
  /** Whether the definition can be used for a judgment or evaluation setup. */
  ready: boolean;
  /** Definition and referenced Variable issues; observations are not inferred. */
  issues: readonly ObjectiveReadinessIssue[];
}

/**
 * Typed Story 02 operations over the shared foundation revision port.
 *
 * This class owns no storage.  It prevents callers from accidentally using a
 * Variable as an Objective, while the generic store remains the one canonical
 * Graph SSOT writer and authorization boundary.
 */
export class CompanyOsObjectives {
  constructor(private readonly store: FoundationRevisionStore) {}

  createObjective(definition: ObjectiveDefinition, context: FoundationStoreContext): Promise<FoundationRef> {
    assertType(definition, 'objective');
    return this.store.create(definition, context);
  }

  readObjective(
    id: string,
    context: FoundationStoreContext,
    revision?: string
  ): Promise<FoundationCatalogRecord | null> {
    return this.readTyped('objective', id, context, revision);
  }

  updateObjective(
    id: string,
    expectedRevision: string,
    next: ObjectiveDefinition,
    context: FoundationStoreContext
  ): Promise<FoundationRef> {
    assertType(next, 'objective');
    return this.store.update({
      reference: { id, type: 'objective', revision: expectedRevision },
      next,
      expectedRevision
    }, context);
  }

  async checkObjectiveReadiness(
    id: string,
    context: FoundationStoreContext,
    revision?: string
  ): Promise<ObjectiveReadiness> {
    const record = await this.readObjective(id, context, revision);
    if (!record) {
      return {
        ready: false,
        issues: [{ code: 'NOT_FOUND', path: 'id', message: `Objective ${id} was not found.` }]
      };
    }

    const objective = record.definition as ObjectiveDefinition;
    const issues = validationIssues(objective, 'judgment');
    const criteria = Array.isArray(objective.criteria) ? objective.criteria : [];
    for (const [index, criterion] of criteria.entries()) {
      if (!criterion || typeof criterion !== 'object' || !criterion.variableRef) continue;
      if (!isVariableRevisionReference(criterion.variableRef)) {
        issues.push({
          code: 'INVALID_VARIABLE_REFERENCE',
          path: `criteria[${index}].variableRef`,
          message: 'Criterion must reference a Variable with a positive revision.'
        });
        continue;
      }
      const variable = await this.store.read(criterion.variableRef, context);
      if (!variable) {
        issues.push({
          code: 'MISSING_VARIABLE_REVISION',
          path: `criteria[${index}].variableRef`,
          message: `Variable ${criterion.variableRef.id}@${criterion.variableRef.revision} was not found.`
        });
        continue;
      }
      if (variable.definition.type !== 'variable') {
        issues.push({
          code: 'INVALID_VARIABLE_REFERENCE',
          path: `criteria[${index}].variableRef`,
          message: `Criterion ${criterion.variableRef.id}@${criterion.variableRef.revision} is not a Variable.`
        });
        continue;
      }
      for (const issue of validationIssues(variable.definition, 'judgment')) {
        issues.push({
          ...issue,
          path: `criteria[${index}].variableRef.${issue.path}`
        });
      }
      issues.push(...criterionCompatibilityIssues(criterion, variable.definition, index));
    }

    return { ready: issues.length === 0, issues };
  }

  createVariable(definition: VariableDefinition, context: FoundationStoreContext): Promise<FoundationRef> {
    assertType(definition, 'variable');
    return this.store.create(definition, context);
  }

  readVariable(
    id: string,
    context: FoundationStoreContext,
    revision?: string
  ): Promise<FoundationCatalogRecord | null> {
    return this.readTyped('variable', id, context, revision);
  }

  updateVariable(
    id: string,
    expectedRevision: string,
    next: VariableDefinition,
    context: FoundationStoreContext
  ): Promise<FoundationRef> {
    assertType(next, 'variable');
    return this.store.update({
      reference: { id, type: 'variable', revision: expectedRevision },
      next,
      expectedRevision
    }, context);
  }

  /** Exposes typed relation persistence without creating a second relation store. */
  addRelation(relation: Parameters<FoundationRevisionStore['addRelation']>[0], context: FoundationStoreContext): Promise<void> {
    return this.store.addRelation(relation, context);
  }

  private readTyped(
    type: 'objective' | 'variable',
    id: string,
    context: FoundationStoreContext,
    revision?: string
  ): Promise<FoundationCatalogRecord | null> {
    if (revision !== undefined) {
      return this.store.read({ id, type, revision }, context);
    }
    return this.store.readLatest(type, id, context);
  }
}

export function createCompanyOsObjectives(store: FoundationRevisionStore): CompanyOsObjectives {
  return new CompanyOsObjectives(store);
}

function assertType<T extends FoundationDefinition>(definition: T, type: T['type']): void {
  if (!definition || definition.type !== type) {
    throw new TypeError(`Expected a ${type} definition`);
  }
}

function validationIssues(
  definition: FoundationDefinition,
  use: 'judgment'
): ObjectiveReadinessIssue[] {
  try {
    const result = validateFoundationDefinition(definition, { use });
    return result.issues.map((issue: FoundationValidationIssue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message
    }));
  } catch (error) {
    return [{
      code: 'INVALID_FIELD',
      path: 'definition',
      message: error instanceof Error ? error.message : String(error)
    }];
  }
}

function isVariableRevisionReference(value: unknown): value is ObjectiveCriterion['variableRef'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as { type?: unknown; id?: unknown; revision?: unknown };
  return candidate.type === 'variable'
    && typeof candidate.id === 'string'
    && candidate.id.length > 0
    && typeof candidate.revision === 'string'
    && /^[1-9]\d*$/.test(candidate.revision);
}

function criterionCompatibilityIssues(
  criterion: ObjectiveCriterion,
  variable: VariableDefinition,
  index: number
): ObjectiveReadinessIssue[] {
  const path = `criteria[${index}]`;
  if (criterion.target === undefined) return [];
  if (criterion.operator === 'at_least' || criterion.operator === 'at_most') {
    if (variable.valueKind !== 'number' || typeof criterion.target !== 'number' || !Number.isFinite(criterion.target)) {
      return [{
        code: 'CRITERION_TYPE_MISMATCH',
        path,
        message: `${criterion.operator} requires a numeric Variable and a finite number target.`
      }];
    }
    return [];
  }
  if (criterion.operator !== 'equals') return [];
  const targetMatches = variable.valueKind === 'number'
    ? typeof criterion.target === 'number' && Number.isFinite(criterion.target)
    : variable.valueKind === 'boolean'
      ? typeof criterion.target === 'boolean'
      : (variable.valueKind === 'string' || variable.valueKind === 'state') && typeof criterion.target === 'string';
  if (!targetMatches) {
    return [{
      code: 'CRITERION_TYPE_MISMATCH',
      path,
      message: `equals target type does not match Variable valueKind ${variable.valueKind}.`
    }];
  }
  return [];
}
