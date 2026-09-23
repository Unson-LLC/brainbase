/**
 * Shared semantic contract for the company judgment foundation.
 *
 * This module is intentionally separate from the historical Graph entity
 * kinds.  Story 01 registers the definitions that a later canonical store can
 * adopt; it does not reinterpret or mutate ontology releases 1.0.0/2.0.0.
 */

export const JUDGMENT_FOUNDATION_CONTRACT_VERSION = '0.1.0' as const;

export type FoundationType = 'objective' | 'variable' | 'model' | 'constraint';

export type FoundationUse = 'draft' | 'judgment' | 'evaluation' | 'execution';

export type FoundationEpistemicState =
  | 'unverified'
  | 'hypothesis'
  | 'supported'
  | 'verified'
  | 'refuted';

export type FoundationAdoptionState = 'draft' | 'proposed' | 'approved' | 'retired';

/** `ontology` means a formal definition in the future canonical store. */
export type FoundationStorage = 'candidate' | 'ontology' | 'evidence' | 'execution';

export type FoundationValueKind = 'number' | 'boolean' | 'string' | 'state';

export type FoundationAggregation = 'none' | 'sum' | 'average' | 'count' | 'min' | 'max' | 'last' | 'custom';

/**
 * Threshold operators are intentionally the only operators in the first
 * contract.  Relative increase/decrease/maintain need a versioned baseline;
 * accepting them without one would make an evaluation criterion ambiguous.
 */
export type FoundationOperator = 'at_least' | 'at_most' | 'equals';

export type FoundationValidationState = 'unverified' | 'in_progress' | 'supported' | 'verified' | 'refuted';

export interface FoundationRevision {
  id: string;
  type: FoundationType;
  revision: string;
}

export interface DecisionRevision {
  id: string;
  type: 'decision';
  revision: string;
}

export type RevisionReference = FoundationRevision | DecisionRevision;

export interface FoundationPeriod {
  from: string;
  until: string;
}

export interface FoundationScope {
  subjectIds: readonly string[];
  validFrom: string;
  validUntil?: string;
}

export interface FoundationAcl {
  /** The owner is explicit even when visibility is public. */
  ownerId: string;
  visibility: 'private' | 'project' | 'organization' | 'public';
  readerIds: readonly string[];
  writerIds: readonly string[];
}

export interface FoundationProvenance {
  sourceId: string;
  sourceKind: 'candidate' | 'document' | 'observation' | 'decision' | 'import';
  evidenceIds: readonly string[];
}

export interface FoundationDefinitionBase {
  id: string;
  type: FoundationType;
  revision: string;
  meaning: string;
  /** Objective, Variable, and Constraint may be epistemically open in a draft. */
  epistemicState?: FoundationEpistemicState;
  adoptionState: FoundationAdoptionState;
  authorizedUses: readonly FoundationUse[];
  acl: FoundationAcl;
  /** Storage is a destination contract, not a confidence or truth value. */
  storage: FoundationStorage;
  provenance: readonly FoundationProvenance[];
  scope: FoundationScope;
}

export interface ObjectiveCriterion {
  variableRef: FoundationRevision;
  operator: FoundationOperator;
  target?: string | number | boolean;
}

export interface ObjectiveDefinition extends FoundationDefinitionBase {
  type: 'objective';
  beneficiaryIds: readonly string[];
  desiredState: string;
  criteria: readonly ObjectiveCriterion[];
  evaluationPeriod: FoundationPeriod;
  accountableId?: string;
}

export interface VariableDefinition extends FoundationDefinitionBase {
  type: 'variable';
  subject: string;
  valueKind: FoundationValueKind;
  unit?: string;
  aggregation: FoundationAggregation;
  granularity: string;
  measurementMethod: string;
}

export interface ModelDefinition extends FoundationDefinitionBase {
  type: 'model';
  /** A model is allowed to be formally registered while still unverified. */
  epistemicState: FoundationEpistemicState;
  inputVariableRefs: readonly FoundationRevision[];
  outputVariableRefs: readonly FoundationRevision[];
  applicability: FoundationScope;
  relationship: string;
  uncertainty: string;
  validationState: FoundationValidationState;
}

export interface ConstraintException {
  decisionRef: DecisionRevision;
  scope: FoundationScope;
}

export interface ConstraintDefinition extends FoundationDefinitionBase {
  type: 'constraint';
  condition: string;
  appliesTo: readonly string[];
  exceptions: readonly ConstraintException[];
  adoptionBasis: readonly DecisionRevision[];
}

export type FoundationDefinition =
  | ObjectiveDefinition
  | VariableDefinition
  | ModelDefinition
  | ConstraintDefinition;

export type FoundationRelationId =
  | 'contributes_to'
  | 'evaluated_by'
  | 'uses_as_input'
  | 'predicts'
  | 'applies_to'
  | 'used_as_basis';

export type FoundationRelationEndpoint =
  | FoundationType
  | 'story'
  | 'decision'
  | 'project'
  | 'judgment_problem'
  | 'execution'
  | 'outcome'
  | 'evaluation';

export interface FoundationRelationDefinition {
  id: FoundationRelationId;
  from: readonly FoundationRelationEndpoint[];
  to: readonly FoundationRelationEndpoint[];
  meaning: string;
  permittedInferences: readonly string[];
  prohibitedInferences: readonly string[];
}

export interface FoundationRelationReference {
  relation: FoundationRelationId;
  source: FoundationRevision | DecisionRevision | { id: string; type: FoundationRelationEndpoint; revision?: string };
  target: FoundationRevision | DecisionRevision | { id: string; type: FoundationRelationEndpoint; revision?: string };
}

export interface FoundationValidationIssue {
  code:
    | 'MISSING_FIELD'
    | 'INVALID_FIELD'
    | 'INVALID_REVISION_REFERENCE'
    | 'UNAUTHORIZED_USE'
    | 'UNVERIFIED_MODEL'
    | 'EVALUATION_DEFINITION_VERSION_MISMATCH'
    | 'EVALUATION_UNIT_MISMATCH'
    | 'EVALUATION_AGGREGATION_MISMATCH'
    | 'EVALUATION_GRANULARITY_MISMATCH'
    | 'EVALUATION_SCOPE_MISMATCH'
    | 'EVALUATION_PERIOD_MISMATCH'
    | 'RELATION_SOURCE_TYPE_MISMATCH'
    | 'RELATION_TARGET_TYPE_MISMATCH';
  path: string;
  message: string;
}

export interface FoundationValidationResult {
  valid: boolean;
  status: 'valid' | 'invalid' | 'unverified';
  issues: readonly FoundationValidationIssue[];
}

export interface FoundationEvaluationDescriptor {
  variableRef: FoundationRevision;
  unit?: string;
  aggregation: FoundationAggregation;
  granularity: string;
  scope: FoundationScope;
  period: FoundationPeriod;
}

export interface FoundationEvaluationExpectation {
  scope?: FoundationScope;
  period?: FoundationPeriod;
}

export interface FoundationTypeContract {
  type: FoundationType;
  meaning: string;
  /** Fields supplied by the shared definition base for every non-draft use. */
  requiredBase: readonly string[];
  /** Type-specific fields required for the named use. */
  requiredForJudgment: readonly string[];
  requiredForEvaluation: readonly string[];
  /** Conditional requirements that cannot be represented by one flat list. */
  conditionalRequirements?: readonly string[];
}

export interface JudgmentFoundationContract {
  version: typeof JUDGMENT_FOUNDATION_CONTRACT_VERSION;
  status: 'extension-manifest';
  compatibility: 'read-compatible-write-gated';
  historicalOntologyVersions: readonly ['1.0.0', '2.0.0'];
  canonicalStoreAdoption: 'future-story-02-plus';
  graphActivation: 'deferred';
  types: Readonly<Record<FoundationType, FoundationTypeContract>>;
  relations: Readonly<Record<FoundationRelationId, FoundationRelationDefinition>>;
  inference: {
    worldModelCycles: 'allowed';
    executionDagCycles: 'rejected';
  };
}

const typeContracts: Record<FoundationType, FoundationTypeContract> = {
  objective: {
    type: 'objective',
    meaning: 'A desired state for a beneficiary, with explicit criteria and an evaluation period.',
    requiredBase: ['id', 'type', 'revision', 'meaning', 'adoptionState', 'authorizedUses', 'acl', 'storage', 'provenance', 'scope'],
    requiredForJudgment: ['beneficiaryIds', 'desiredState', 'criteria', 'evaluationPeriod'],
    requiredForEvaluation: ['beneficiaryIds', 'desiredState', 'criteria', 'evaluationPeriod']
  },
  variable: {
    type: 'variable',
    meaning: 'A definition of a state or outcome value, including measurement and aggregation semantics.',
    requiredBase: ['id', 'type', 'revision', 'meaning', 'adoptionState', 'authorizedUses', 'acl', 'storage', 'provenance', 'scope'],
    requiredForJudgment: ['subject', 'valueKind', 'aggregation', 'granularity', 'measurementMethod'],
    requiredForEvaluation: ['subject', 'valueKind', 'aggregation', 'granularity', 'measurementMethod'],
    conditionalRequirements: ['unit when valueKind is number']
  },
  model: {
    type: 'model',
    meaning: 'A scoped relationship or calculation describing how variables may change; it is not an LLM model name.',
    requiredBase: ['id', 'type', 'revision', 'meaning', 'adoptionState', 'authorizedUses', 'acl', 'storage', 'provenance', 'scope'],
    requiredForJudgment: ['epistemicState', 'inputVariableRefs', 'outputVariableRefs', 'applicability', 'relationship', 'uncertainty', 'validationState'],
    requiredForEvaluation: ['epistemicState', 'inputVariableRefs', 'outputVariableRefs', 'applicability', 'relationship', 'uncertainty', 'validationState']
  },
  constraint: {
    type: 'constraint',
    meaning: 'A condition that applies to a bounded target and validity period, with decision-backed exceptions.',
    requiredBase: ['id', 'type', 'revision', 'meaning', 'adoptionState', 'authorizedUses', 'acl', 'storage', 'provenance', 'scope'],
    requiredForJudgment: ['condition', 'appliesTo', 'exceptions', 'adoptionBasis'],
    requiredForEvaluation: ['condition', 'appliesTo', 'exceptions', 'adoptionBasis']
  }
};

export const judgmentFoundationRelations: Readonly<Record<FoundationRelationId, FoundationRelationDefinition>> = deepFreeze({
  contributes_to: {
    id: 'contributes_to',
    from: ['story'],
    to: ['objective'],
    meaning: 'A Story aims to contribute to an Objective.',
    permittedInferences: [],
    prohibitedInferences: ['story completion does not establish objective achievement']
  },
  evaluated_by: {
    id: 'evaluated_by',
    from: ['objective'],
    to: ['variable'],
    meaning: 'An Objective uses a Variable and its definition as an evaluation criterion.',
    permittedInferences: [],
    prohibitedInferences: ['one variable improvement does not establish objective achievement']
  },
  uses_as_input: {
    id: 'uses_as_input',
    from: ['model'],
    to: ['variable'],
    meaning: 'A Model declares a Variable as an input.',
    permittedInferences: [],
    prohibitedInferences: ['input declaration does not prove causality or model accuracy']
  },
  predicts: {
    id: 'predicts',
    from: ['model'],
    to: ['variable'],
    meaning: 'A Model declares a Variable as an output it predicts.',
    permittedInferences: [],
    prohibitedInferences: ['prediction declaration does not prove causality or accuracy']
  },
  applies_to: {
    id: 'applies_to',
    from: ['constraint'],
    to: ['objective', 'variable', 'model', 'constraint', 'story', 'decision', 'project', 'judgment_problem', 'execution'],
    meaning: 'A Constraint applies to the explicitly listed target and validity scope.',
    permittedInferences: [],
    prohibitedInferences: ['scope does not extend to unlisted targets or periods']
  },
  used_as_basis: {
    id: 'used_as_basis',
    from: ['decision', 'judgment_problem'],
    to: ['objective', 'variable', 'model', 'constraint'],
    meaning: 'A Decision or JudgmentProblem records that a revision was used as a historical basis.',
    permittedInferences: [],
    prohibitedInferences: ['historical use does not establish current validity or truth']
  }
});

/**
 * Extension manifest consumed by future canonical-store work.  The historical
 * portable ontology releases intentionally do not include these definitions.
 */
export const judgmentFoundationContract: JudgmentFoundationContract = deepFreeze({
  version: JUDGMENT_FOUNDATION_CONTRACT_VERSION,
  status: 'extension-manifest',
  compatibility: 'read-compatible-write-gated',
  historicalOntologyVersions: ['1.0.0', '2.0.0'],
  canonicalStoreAdoption: 'future-story-02-plus',
  graphActivation: 'deferred',
  types: typeContracts,
  relations: judgmentFoundationRelations,
  inference: {
    worldModelCycles: 'allowed',
    executionDagCycles: 'rejected'
  }
});

const FOUNDATION_TYPES = ['objective', 'variable', 'model', 'constraint'] as const;
const FOUNDATION_USES = ['draft', 'judgment', 'evaluation', 'execution'] as const;
const FOUNDATION_EPISTEMIC_STATES = ['unverified', 'hypothesis', 'supported', 'verified', 'refuted'] as const;
const FOUNDATION_ADOPTION_STATES = ['draft', 'proposed', 'approved', 'retired'] as const;
const FOUNDATION_STORAGE = ['candidate', 'ontology', 'evidence', 'execution'] as const;
const FOUNDATION_VALUE_KINDS = ['number', 'boolean', 'string', 'state'] as const;
const FOUNDATION_AGGREGATIONS = ['none', 'sum', 'average', 'count', 'min', 'max', 'last', 'custom'] as const;
const FOUNDATION_OPERATORS = ['at_least', 'at_most', 'equals'] as const;
const FOUNDATION_VALIDATION_STATES = ['unverified', 'in_progress', 'supported', 'verified', 'refuted'] as const;
const FOUNDATION_RELATION_IDS = [
  'contributes_to',
  'evaluated_by',
  'uses_as_input',
  'predicts',
  'applies_to',
  'used_as_basis'
] as const;
const FOUNDATION_RELATION_ENDPOINTS = [
  ...FOUNDATION_TYPES,
  'story',
  'decision',
  'project',
  'judgment_problem',
  'execution',
  'outcome',
  'evaluation'
] as const;
const FOUNDATION_VISIBILITIES = ['private', 'project', 'organization', 'public'] as const;
const FOUNDATION_SOURCE_KINDS = ['candidate', 'document', 'observation', 'decision', 'import'] as const;

type FoundationRecord = Record<string, unknown>;

function isRecord(value: unknown): value is FoundationRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isFoundationType(value: unknown): value is FoundationType {
  return isOneOf(value, FOUNDATION_TYPES);
}

function isFoundationUse(value: unknown): value is FoundationUse {
  return isOneOf(value, FOUNDATION_USES);
}

function isFoundationEpistemicState(value: unknown): value is FoundationEpistemicState {
  return isOneOf(value, FOUNDATION_EPISTEMIC_STATES);
}

function isFoundationAdoptionState(value: unknown): value is FoundationAdoptionState {
  return isOneOf(value, FOUNDATION_ADOPTION_STATES);
}

function isFoundationStorage(value: unknown): value is FoundationStorage {
  return isOneOf(value, FOUNDATION_STORAGE);
}

function isFoundationValueKind(value: unknown): value is FoundationValueKind {
  return isOneOf(value, FOUNDATION_VALUE_KINDS);
}

function isFoundationAggregation(value: unknown): value is FoundationAggregation {
  return isOneOf(value, FOUNDATION_AGGREGATIONS);
}

function isFoundationOperator(value: unknown): value is FoundationOperator {
  return isOneOf(value, FOUNDATION_OPERATORS);
}

function isFoundationValidationState(value: unknown): value is FoundationValidationState {
  return isOneOf(value, FOUNDATION_VALIDATION_STATES);
}

function isFoundationRelationId(value: unknown): value is FoundationRelationId {
  return isOneOf(value, FOUNDATION_RELATION_IDS);
}

function isFoundationRelationEndpoint(value: unknown): value is FoundationRelationEndpoint {
  return isOneOf(value, FOUNDATION_RELATION_ENDPOINTS);
}

function isFoundationVisibility(value: unknown): value is FoundationAcl['visibility'] {
  return isOneOf(value, FOUNDATION_VISIBILITIES);
}

function isFoundationSourceKind(value: unknown): value is FoundationProvenance['sourceKind'] {
  return isOneOf(value, FOUNDATION_SOURCE_KINDS);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isScalar(value: unknown): value is string | number | boolean {
  return isNonEmptyString(value)
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function isEmptyRequiredArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function forEachArrayEntry(
  value: readonly unknown[],
  callback: (entry: unknown, index: number) => void
): void {
  for (let index = 0; index < value.length; index += 1) {
    callback(value[index], index);
  }
}

function requiredString(
  record: FoundationRecord,
  key: string,
  issues: FoundationValidationIssue[]
): void {
  if (record[key] === undefined) {
    issues.push({ code: 'MISSING_FIELD', path: key, message: `${key} is required.` });
  } else if (!isNonEmptyString(record[key])) {
    issues.push({ code: 'INVALID_FIELD', path: key, message: `${key} must be a non-empty string.` });
  }
}

function requiredEnum<T extends string>(
  record: FoundationRecord,
  key: string,
  guard: (value: unknown) => value is T,
  issues: FoundationValidationIssue[]
): void {
  if (record[key] === undefined) {
    issues.push({ code: 'MISSING_FIELD', path: key, message: `${key} is required.` });
  } else if (!guard(record[key])) {
    issues.push({ code: 'INVALID_FIELD', path: key, message: `${key} must be a registered value.` });
  }
}

function optionalString(value: unknown, path: string, issues: FoundationValidationIssue[], allowEmpty = false): void {
  if (value !== undefined && !(allowEmpty && typeof value === 'string') && !isNonEmptyString(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be a non-empty string when provided.` });
  }
}

function optionalStringArray(value: unknown, path: string, issues: FoundationValidationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be an array of non-empty strings.` });
    return;
  }
  forEachArrayEntry(value, (item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push({ code: 'INVALID_FIELD', path: `${path}[${index}]`, message: `${path} entries must be non-empty strings.` });
    }
  });
}

function optionalArray(value: unknown, path: string, issues: FoundationValidationIssue[]): void {
  if (value !== undefined && !Array.isArray(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be an array.` });
  }
}

function optionalEnum<T extends string>(
  value: unknown,
  path: string,
  guard: (value: unknown) => value is T,
  issues: FoundationValidationIssue[]
): void {
  if (value !== undefined && !guard(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be a registered value.` });
  }
}

function validateAcl(value: unknown, issues: FoundationValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ code: value === undefined ? 'MISSING_FIELD' : 'INVALID_FIELD', path: 'acl', message: 'ACL requires ownerId, visibility, readerIds, and writerIds.' });
    return;
  }
  requiredString(value, 'ownerId', issues);
  requiredEnum(value, 'visibility', isFoundationVisibility, issues);
  validateStringArray(value.readerIds, 'acl.readerIds', issues);
  validateStringArray(value.writerIds, 'acl.writerIds', issues);
}

function validateStringArray(value: unknown, path: string, issues: FoundationValidationIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'MISSING_FIELD', path, message: `${path} is required.` });
    return;
  }
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be an array of non-empty strings.` });
    return;
  }
  forEachArrayEntry(value, (item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push({ code: 'INVALID_FIELD', path: `${path}[${index}]`, message: `${path} entries must be non-empty strings.` });
    }
  });
}

function validateProvenance(value: unknown, issues: FoundationValidationIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'MISSING_FIELD', path: 'provenance', message: 'provenance is required.' });
    return;
  }
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_FIELD', path: 'provenance', message: 'provenance must be an array of evidence references.' });
    return;
  }
  forEachArrayEntry(value, (item, index) => {
    const path = `provenance[${index}]`;
    if (!isRecord(item)) {
      issues.push({ code: 'INVALID_FIELD', path, message: 'Provenance entries must be objects.' });
      return;
    }
    requiredStringAtPath(item, 'sourceId', `${path}.sourceId`, issues);
    requiredEnumAtPath(item, 'sourceKind', isFoundationSourceKind, `${path}.sourceKind`, issues);
    validateStringArrayAtPath(item.evidenceIds, `${path}.evidenceIds`, issues);
  });
}

function requiredStringAtPath(
  record: FoundationRecord,
  key: string,
  path: string,
  issues: FoundationValidationIssue[]
): void {
  if (record[key] === undefined) {
    issues.push({ code: 'MISSING_FIELD', path, message: `${path} is required.` });
  } else if (!isNonEmptyString(record[key])) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be a non-empty string.` });
  }
}

function requiredEnumAtPath<T extends string>(
  record: FoundationRecord,
  key: string,
  guard: (value: unknown) => value is T,
  path: string,
  issues: FoundationValidationIssue[]
): void {
  if (record[key] === undefined) {
    issues.push({ code: 'MISSING_FIELD', path, message: `${path} is required.` });
  } else if (!guard(record[key])) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be a registered value.` });
  }
}

function validateStringArrayAtPath(value: unknown, path: string, issues: FoundationValidationIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'MISSING_FIELD', path, message: `${path} is required.` });
    return;
  }
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be an array of non-empty strings.` });
    return;
  }
  forEachArrayEntry(value, (item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push({ code: 'INVALID_FIELD', path: `${path}[${index}]`, message: `${path} entries must be non-empty strings.` });
    }
  });
}

function isPeriodValue(value: unknown): value is FoundationPeriod {
  return isRecord(value)
    && isNonEmptyString(value.from)
    && isNonEmptyString(value.until)
    && isValidPeriod({ from: value.from, until: value.until });
}

function isScopeValue(value: unknown): value is FoundationScope {
  if (!isRecord(value) || !isNonEmptyStringArray(value.subjectIds)) {
    return false;
  }
  if (!isNonEmptyString(value.validFrom)) return false;
  if (value.validUntil !== undefined && !isNonEmptyString(value.validUntil)) return false;
  if (parseStrictRfc3339(value.validFrom) === undefined) return false;
  if (value.validUntil === undefined) return true;
  return isValidPeriod({ from: value.validFrom, until: value.validUntil });
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!isNonEmptyString(value[index])) return false;
  }
  return true;
}

function validateRevisionValue(
  value: unknown,
  expectedType: FoundationType | 'decision',
  path: string,
  issues: FoundationValidationIssue[]
): FoundationRevision | DecisionRevision | undefined {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || value.type !== expectedType
    || !isNonEmptyString(value.revision)) {
    issues.push({
      code: 'INVALID_REVISION_REFERENCE',
      path,
      message: `${path} must reference ${expectedType} by id, type, and revision.`
    });
    return undefined;
  }
  if (expectedType === 'decision') {
    return { id: value.id, type: 'decision', revision: value.revision };
  }
  return { id: value.id, type: expectedType, revision: value.revision };
}

function validateDecisionValue(value: unknown, path: string, issues: FoundationValidationIssue[]): void {
  validateRevisionValue(value, 'decision', path, issues);
}

function optionalRevisionArray(
  value: unknown,
  path: string,
  expectedType: FoundationType | 'decision',
  issues: FoundationValidationIssue[]
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be an array of versioned references.` });
    return;
  }
  forEachArrayEntry(value, (item, index) => validateRevisionValue(item, expectedType, `${path}[${index}]`, issues));
}

function validateRelationEndpoint(
  value: unknown,
  path: string,
  issues: FoundationValidationIssue[]
): FoundationRelationEndpoint | undefined {
  if (!isRecord(value)) {
    issues.push({ code: 'INVALID_FIELD', path, message: `${path} must be an endpoint object.` });
    return undefined;
  }
  if (!isNonEmptyString(value.id)) {
    issues.push({ code: 'INVALID_FIELD', path: `${path}.id`, message: `${path}.id must be a non-empty string.` });
  }
  if (!isFoundationRelationEndpoint(value.type)) {
    issues.push({ code: 'INVALID_FIELD', path: `${path}.type`, message: `${path}.type is not a registered relation endpoint.` });
    return undefined;
  }
  if (value.revision !== undefined && !isNonEmptyString(value.revision)) {
    issues.push({ code: 'INVALID_REVISION_REFERENCE', path: `${path}.revision`, message: `${path}.revision must be a non-empty revision.` });
  }
  if (isRevisionEndpoint(value.type) && !isNonEmptyString(value.revision)) {
    issues.push({ code: 'INVALID_REVISION_REFERENCE', path: `${path}.revision`, message: `Versioned ${value.type} relation endpoints require a revision.` });
  }
  return value.type;
}

export function validateFoundationDefinition(
  definition: unknown,
  options: { use: FoundationUse }
): FoundationValidationResult {
  const issues: FoundationValidationIssue[] = [];
  const requestedUse = isRecord(options) ? options.use : undefined;
  const use = isFoundationUse(requestedUse) ? requestedUse : undefined;
  if (!use) {
    issues.push({ code: 'INVALID_FIELD', path: 'use', message: `Unknown foundation use ${String(requestedUse)}.` });
  }
  if (!isRecord(definition)) {
    issues.push({ code: 'INVALID_FIELD', path: 'definition', message: 'A foundation definition must be an object.' });
    return { valid: false, status: 'invalid', issues };
  }

  const type = isFoundationType(definition.type) ? definition.type : undefined;
  if (definition.type === undefined) {
    issues.push({ code: 'MISSING_FIELD', path: 'type', message: 'A foundation definition requires a registered type.' });
  } else if (!type) {
    issues.push({ code: 'INVALID_FIELD', path: 'type', message: `Unknown foundation type ${String(definition.type)}.` });
  }

  validateCommonDefinition(definition, use, issues);
  if (type) {
    validateDefinitionShape(definition, type, issues, use !== 'draft');
    if (use && use !== 'draft') {
      validateTypeSpecificDefinition(definition, type, use, issues);
    }
  }

  const hasError = issues.length > 0;
  const unverifiedModel = type === 'model' && definition.epistemicState !== 'verified';
  return {
    valid: !hasError,
    status: hasError ? 'invalid' : unverifiedModel ? 'unverified' : 'valid',
    issues
  };
}

export function validateFoundationRelation(reference: unknown): FoundationValidationResult {
  const issues: FoundationValidationIssue[] = [];
  if (!isRecord(reference)) {
    return {
      valid: false,
      status: 'invalid',
      issues: [{ code: 'INVALID_FIELD', path: 'relation', message: 'A foundation relation must be an object.' }]
    };
  }
  const relation = isFoundationRelationId(reference.relation) ? reference.relation : undefined;
  if (!relation) {
    issues.push({ code: 'INVALID_FIELD', path: 'relation', message: `Unknown foundation relation ${String(reference.relation)}.` });
    return { valid: false, status: 'invalid', issues };
  }
  const definition = judgmentFoundationRelations[relation];
  const sourceType = validateRelationEndpoint(reference.source, 'source', issues);
  const targetType = validateRelationEndpoint(reference.target, 'target', issues);
  if (sourceType && !definition.from.includes(sourceType)) {
    issues.push({
      code: 'RELATION_SOURCE_TYPE_MISMATCH',
      path: 'source.type',
      message: `${relation} does not accept source type ${sourceType}.`
    });
  }
  if (targetType && !definition.to.includes(targetType)) {
    issues.push({
      code: 'RELATION_TARGET_TYPE_MISMATCH',
      path: 'target.type',
      message: `${relation} does not accept target type ${targetType}.`
    });
  }
  return {
    valid: issues.length === 0,
    status: issues.length === 0 ? 'valid' : 'invalid',
    issues
  };
}

export function validateEvaluationCompatibility(
  variable: unknown,
  actual: unknown,
  expected: unknown = {}
): FoundationValidationResult {
  const issues: FoundationValidationIssue[] = [];
  if (isRecord(variable) && variable.type === 'variable') {
    const variableResult = validateFoundationDefinition(variable, { use: 'evaluation' });
    issues.push(...variableResult.issues);
  }
  if (!isRecord(variable) || variable.type !== 'variable') {
    issues.push({ code: 'INVALID_FIELD', path: 'variable.type', message: 'Evaluation compatibility requires a Variable definition.' });
  }
  const variableId = isRecord(variable) && typeof variable.id === 'string' ? variable.id : undefined;
  const variableRevision = isRecord(variable) && typeof variable.revision === 'string' ? variable.revision : undefined;
  const variableUnit = isRecord(variable) && (variable.unit === undefined || typeof variable.unit === 'string')
    ? variable.unit
    : undefined;
  const variableAggregation = isRecord(variable) && isFoundationAggregation(variable.aggregation)
    ? variable.aggregation
    : undefined;
  const variableGranularity = isRecord(variable) && typeof variable.granularity === 'string'
    ? variable.granularity
    : undefined;
  if (!variableId || !variableRevision) {
    issues.push({ code: 'INVALID_FIELD', path: 'variable.id/revision', message: 'Variable compatibility requires a versioned Variable definition.' });
  }
  if (!variableAggregation) {
    issues.push({ code: 'INVALID_FIELD', path: 'variable.aggregation', message: 'Variable compatibility requires a registered aggregation.' });
  }
  if (!variableGranularity) {
    issues.push({ code: 'INVALID_FIELD', path: 'variable.granularity', message: 'Variable compatibility requires a granularity.' });
  }

  const actualRecord = isRecord(actual) ? actual : undefined;
  if (!actualRecord) {
    issues.push({ code: 'INVALID_FIELD', path: 'actual', message: 'Evaluation descriptor must be an object.' });
  }
  const actualReference = actualRecord ? actualRecord.variableRef : undefined;
  const actualRevision = validateRevisionValue(actualReference, 'variable', 'variableRef', issues);
  const actualUnit = actualRecord && (actualRecord.unit === undefined || typeof actualRecord.unit === 'string')
    ? actualRecord.unit
    : undefined;
  if (actualRecord && actualRecord.unit !== undefined && typeof actualRecord.unit !== 'string') {
    issues.push({ code: 'INVALID_FIELD', path: 'unit', message: 'Evaluation unit must be a string when provided.' });
  }
  const actualAggregation = actualRecord && isFoundationAggregation(actualRecord.aggregation)
    ? actualRecord.aggregation
    : undefined;
  if (!actualAggregation) {
    issues.push({ code: 'INVALID_FIELD', path: 'aggregation', message: 'Evaluation requires a registered aggregation.' });
  }
  const actualGranularity = actualRecord && typeof actualRecord.granularity === 'string'
    ? actualRecord.granularity
    : undefined;
  if (!actualGranularity) {
    issues.push({ code: 'INVALID_FIELD', path: 'granularity', message: 'Evaluation requires a granularity.' });
  }
  const actualScope = actualRecord ? actualRecord.scope : undefined;
  if (!isScopeValue(actualScope)) {
    issues.push({ code: 'INVALID_FIELD', path: 'scope', message: 'Evaluation requires a valid scope.' });
  }
  const actualPeriod = actualRecord ? actualRecord.period : undefined;
  if (!isPeriodValue(actualPeriod)) {
    issues.push({ code: 'INVALID_FIELD', path: 'period', message: 'Evaluation requires a valid period.' });
  }

  const definitionScope = isRecord(variable) && isScopeValue(variable.scope)
    ? variable.scope
    : undefined;
  if (definitionScope && isScopeValue(actualScope) && !scopeWithin(actualScope, definitionScope)) {
    issues.push({
      code: 'EVALUATION_SCOPE_MISMATCH',
      path: 'scope',
      message: 'Evaluation scope must stay within the Variable subject and validity scope.'
    });
  }
  if (definitionScope && isPeriodValue(actualPeriod) && !periodWithinScope(actualPeriod, definitionScope)) {
    issues.push({
      code: 'EVALUATION_PERIOD_MISMATCH',
      path: 'period',
      message: 'Evaluation period must stay within the Variable validity scope.'
    });
  }

  if (actualRevision && variableId && variableRevision &&
      (actualRevision.id !== variableId || actualRevision.revision !== variableRevision)) {
    issues.push({
      code: 'EVALUATION_DEFINITION_VERSION_MISMATCH',
      path: 'variableRef',
      message: `Evaluation uses ${actualRevision.id}@${actualRevision.revision}, expected ${variableId}@${variableRevision}.`
    });
  }
  if (variableId && variableRevision && actualRevision && variableUnit !== actualUnit) {
    issues.push({
      code: 'EVALUATION_UNIT_MISMATCH',
      path: 'unit',
      message: `Evaluation unit ${JSON.stringify(actualUnit)} does not match variable unit ${JSON.stringify(variableUnit)}.`
    });
  }
  if (variableAggregation && actualAggregation && variableAggregation !== actualAggregation) {
    issues.push({
      code: 'EVALUATION_AGGREGATION_MISMATCH',
      path: 'aggregation',
      message: `Evaluation aggregation ${actualAggregation} does not match variable aggregation ${variableAggregation}.`
    });
  }
  if (variableGranularity && actualGranularity && variableGranularity !== actualGranularity) {
    issues.push({
      code: 'EVALUATION_GRANULARITY_MISMATCH',
      path: 'granularity',
      message: `Evaluation granularity ${actualGranularity} does not match variable granularity ${variableGranularity}.`
    });
  }

  const expectedRecord = isRecord(expected) ? expected : undefined;
  if (!expectedRecord) {
    issues.push({ code: 'INVALID_FIELD', path: 'expected', message: 'Evaluation expectations must be an object.' });
  }
  const expectedScope = expectedRecord?.scope;
  if (expectedScope !== undefined && !isScopeValue(expectedScope)) {
    issues.push({ code: 'INVALID_FIELD', path: 'expected.scope', message: 'Expected evaluation scope is invalid.' });
  }
  const expectedPeriod = expectedRecord?.period;
  if (expectedPeriod !== undefined && !isPeriodValue(expectedPeriod)) {
    issues.push({ code: 'INVALID_FIELD', path: 'expected.period', message: 'Expected evaluation period is invalid.' });
  }
  if (isScopeValue(expectedScope) && isScopeValue(actualScope) && !sameScope(expectedScope, actualScope)) {
    issues.push({
      code: 'EVALUATION_SCOPE_MISMATCH',
      path: 'scope',
      message: 'Evaluation scope does not match the expected subject or validity scope.'
    });
  }
  if (isPeriodValue(expectedPeriod) && isPeriodValue(actualPeriod) && !samePeriod(expectedPeriod, actualPeriod)) {
    issues.push({
      code: 'EVALUATION_PERIOD_MISMATCH',
      path: 'period',
      message: 'Evaluation period does not match the expected evaluation period.'
    });
  }
  return {
    valid: issues.length === 0,
    status: issues.length === 0 ? 'valid' : 'invalid',
    issues
  };
}

/**
 * Relation declarations carry no achievement, causality, accuracy, or truth
 * inference.  This intentionally returns no derived conclusions; callers must
 * use explicit observations, evaluations, or decisions for those claims.
 */
export function inferFoundationConclusions(
  reference: unknown
): readonly [] {
  validateFoundationRelation(reference);
  return [];
}

function validateCommonDefinition(
  definition: Record<string, unknown>,
  use: FoundationUse | undefined,
  issues: FoundationValidationIssue[]
): void {
  requiredString(definition, 'id', issues);
  requiredString(definition, 'revision', issues);
  requiredString(definition, 'meaning', issues);
  requiredEnum(definition, 'adoptionState', isFoundationAdoptionState, issues);
  requiredEnum(definition, 'storage', isFoundationStorage, issues);
  if (definition.epistemicState !== undefined && !isFoundationEpistemicState(definition.epistemicState)) {
    issues.push({ code: 'INVALID_FIELD', path: 'epistemicState', message: `Unknown epistemic state ${String(definition.epistemicState)}.` });
  }
  if (!Array.isArray(definition.authorizedUses)) {
    issues.push({ code: 'INVALID_FIELD', path: 'authorizedUses', message: 'authorizedUses must be an array of registered uses.' });
  } else {
    forEachArrayEntry(definition.authorizedUses, (value, index) => {
      if (!isFoundationUse(value)) {
        issues.push({ code: 'INVALID_FIELD', path: `authorizedUses[${index}]`, message: `Unknown authorized use ${String(value)}.` });
      }
    });
  }
  if (use && (!Array.isArray(definition.authorizedUses) || !definition.authorizedUses.includes(use))) {
    issues.push({
      code: 'UNAUTHORIZED_USE',
      path: 'authorizedUses',
      message: `Definition ${String(definition.id)} is not authorized for ${use} use.`
    });
  }
  validateAcl(definition.acl, issues);
  validateScope(definition.scope, 'scope', issues, use !== 'draft');
  validateProvenance(definition.provenance, issues);
  if (definition.adoptionState === 'retired' && use && use !== 'draft') {
    issues.push({ code: 'UNAUTHORIZED_USE', path: 'adoptionState', message: 'A retired definition cannot be used for judgment, evaluation, or execution.' });
  }
  if (definition.epistemicState === 'refuted' && use && use !== 'draft') {
    issues.push({ code: 'UNAUTHORIZED_USE', path: 'epistemicState', message: 'A refuted definition cannot be used for judgment, evaluation, or execution.' });
  }
  if (use === 'execution' && definition.adoptionState !== 'approved') {
    issues.push({ code: 'UNAUTHORIZED_USE', path: 'adoptionState', message: 'Execution requires an approved definition.' });
  }
  if (definition.storage === 'ontology' && definition.adoptionState === 'draft' && use === 'execution') {
    issues.push({ code: 'UNAUTHORIZED_USE', path: 'adoptionState', message: 'A draft ontology definition cannot be used for execution.' });
  }
}

function validateTypeSpecificDefinition(
  definition: Record<string, unknown>,
  type: FoundationType,
  use: Exclude<FoundationUse, 'draft'>,
  issues: FoundationValidationIssue[]
): void {
  switch (type) {
    case 'objective':
      if (isEmptyRequiredArray(definition.beneficiaryIds)) issues.push(missing('beneficiaryIds'));
      if (!isNonEmptyString(definition.desiredState)) issues.push(missing('desiredState'));
      if (isEmptyRequiredArray(definition.criteria)) issues.push(missing('criteria'));
      validatePeriod(definition.evaluationPeriod, 'evaluationPeriod', issues);
      break;
    case 'variable':
      if (!isNonEmptyString(definition.subject)) issues.push(missing('subject'));
      if (!isFoundationValueKind(definition.valueKind)) issues.push(missing('valueKind'));
      if (definition.valueKind === 'number' && !isNonEmptyString(definition.unit)) issues.push(missing('unit'));
      if (!isFoundationAggregation(definition.aggregation)) issues.push(missing('aggregation'));
      if (!isNonEmptyString(definition.granularity)) issues.push(missing('granularity'));
      if (!isNonEmptyString(definition.measurementMethod)) issues.push(missing('measurementMethod'));
      break;
    case 'model':
      if (!isFoundationEpistemicState(definition.epistemicState)) issues.push(missing('epistemicState'));
      if (isEmptyRequiredArray(definition.inputVariableRefs)) issues.push(missing('inputVariableRefs'));
      if (isEmptyRequiredArray(definition.outputVariableRefs)) issues.push(missing('outputVariableRefs'));
      if (!isScopeValue(definition.applicability)) issues.push(missing('applicability'));
      if (!isNonEmptyString(definition.relationship)) issues.push(missing('relationship'));
      if (!isNonEmptyString(definition.uncertainty)) issues.push(missing('uncertainty'));
      if (!isFoundationValidationState(definition.validationState)) issues.push(missing('validationState'));
      if (definition.epistemicState === 'refuted' || definition.validationState === 'refuted') {
        issues.push({ code: 'UNVERIFIED_MODEL', path: 'validationState', message: 'A refuted Model cannot be used for judgment, evaluation, or execution.' });
      }
      break;
    case 'constraint':
      if (!isNonEmptyString(definition.condition)) issues.push(missing('condition'));
      if (isEmptyRequiredArray(definition.appliesTo)) issues.push(missing('appliesTo'));
      if (definition.exceptions === undefined) issues.push(missing('exceptions'));
      if (isEmptyRequiredArray(definition.adoptionBasis)) issues.push(missing('adoptionBasis'));
      break;
  }
}

function validateDefinitionShape(
  definition: Record<string, unknown>,
  type: FoundationType,
  issues: FoundationValidationIssue[],
  requireEvaluationCriteria: boolean
): void {
  switch (type) {
    case 'objective':
      optionalStringArray(definition.beneficiaryIds, 'beneficiaryIds', issues);
      optionalString(definition.desiredState, 'desiredState', issues, !requireEvaluationCriteria);
      optionalArray(definition.criteria, 'criteria', issues);
      if (Array.isArray(definition.criteria)) {
        forEachArrayEntry(definition.criteria, (criterion, index) => validateCriterion(
          criterion,
          `criteria[${index}]`,
          issues,
          requireEvaluationCriteria
        ));
      }
      if (definition.evaluationPeriod !== undefined) validatePeriod(definition.evaluationPeriod, 'evaluationPeriod', issues);
      optionalString(definition.accountableId, 'accountableId', issues, !requireEvaluationCriteria);
      break;
    case 'variable':
      optionalString(definition.subject, 'subject', issues, !requireEvaluationCriteria);
      optionalEnum(definition.valueKind, 'valueKind', isFoundationValueKind, issues);
      optionalString(definition.unit, 'unit', issues, !requireEvaluationCriteria);
      optionalEnum(definition.aggregation, 'aggregation', isFoundationAggregation, issues);
      optionalString(definition.granularity, 'granularity', issues, !requireEvaluationCriteria);
      optionalString(definition.measurementMethod, 'measurementMethod', issues, !requireEvaluationCriteria);
      break;
    case 'model':
      if (definition.epistemicState === undefined) issues.push(missing('epistemicState'));
      optionalRevisionArray(definition.inputVariableRefs, 'inputVariableRefs', 'variable', issues);
      optionalRevisionArray(definition.outputVariableRefs, 'outputVariableRefs', 'variable', issues);
      if (definition.applicability !== undefined) validateScope(definition.applicability, 'applicability', issues, false);
      optionalString(definition.relationship, 'relationship', issues, !requireEvaluationCriteria);
      optionalString(definition.uncertainty, 'uncertainty', issues, !requireEvaluationCriteria);
      optionalEnum(definition.validationState, 'validationState', isFoundationValidationState, issues);
      break;
    case 'constraint':
      optionalString(definition.condition, 'condition', issues, !requireEvaluationCriteria);
      optionalStringArray(definition.appliesTo, 'appliesTo', issues);
      optionalArray(definition.exceptions, 'exceptions', issues);
      if (Array.isArray(definition.exceptions)) {
        forEachArrayEntry(definition.exceptions, (exception, index) => {
          if (!isRecord(exception)) {
            issues.push({ code: 'INVALID_FIELD', path: `exceptions[${index}]`, message: 'Constraint exceptions must be objects.' });
            return;
          }
          validateDecisionValue(exception.decisionRef, `exceptions[${index}].decisionRef`, issues);
          validateScope(exception.scope, `exceptions[${index}].scope`, issues, true);
          if (isScopeValue(exception.scope) && isScopeValue(definition.scope)
            && !scopeWithin(exception.scope, definition.scope)) {
            issues.push({
              code: 'INVALID_FIELD',
              path: `exceptions[${index}].scope`,
              message: 'Constraint exception scope must be non-empty and remain within the parent Constraint scope.'
            });
          }
        });
      }
      optionalArray(definition.adoptionBasis, 'adoptionBasis', issues);
      if (Array.isArray(definition.adoptionBasis)) {
        forEachArrayEntry(definition.adoptionBasis, (decisionRef, index) => validateDecisionValue(decisionRef, `adoptionBasis[${index}]`, issues));
      }
      break;
  }
}

function validateCriterion(
  criterion: unknown,
  path: string,
  issues: FoundationValidationIssue[],
  requireTarget: boolean
): void {
  if (!isRecord(criterion)) {
    issues.push({ code: 'INVALID_FIELD', path, message: 'Objective criteria must be objects.' });
    return;
  }
  if (criterion.variableRef === undefined) {
    if (requireTarget) {
      issues.push({ code: 'MISSING_FIELD', path: `${path}.variableRef`, message: 'Objective criteria require a versioned Variable reference.' });
    }
  } else {
    validateRevisionValue(criterion.variableRef, 'variable', `${path}.variableRef`, issues);
  }
  if (criterion.operator === undefined) {
    if (requireTarget) {
      issues.push({ code: 'MISSING_FIELD', path: `${path}.operator`, message: 'Objective criteria require an operator.' });
    }
  } else if (!isFoundationOperator(criterion.operator)) {
    issues.push({ code: 'INVALID_FIELD', path: `${path}.operator`, message: `Unsupported Objective criterion operator ${String(criterion.operator)}.` });
  }
  if (criterion.target === undefined && requireTarget) {
    issues.push({ code: 'MISSING_FIELD', path: `${path}.target`, message: 'Objective criterion target is required for threshold evaluation.' });
  } else if (criterion.target !== undefined && !isScalar(criterion.target)) {
    issues.push({ code: 'INVALID_FIELD', path: `${path}.target`, message: 'Objective criterion targets must be scalar values.' });
  }
}

function validatePeriod(period: unknown, path: string, issues: FoundationValidationIssue[]): void {
  if (!isPeriodValue(period)) {
    issues.push({ code: 'INVALID_FIELD', path, message: 'Period requires ISO from/until values with until after from.' });
  }
}

function validateScope(scope: unknown, path: string, issues: FoundationValidationIssue[], requireSubject: boolean): void {
  if (!isScopeValue(scope)) {
    issues.push({ code: 'INVALID_FIELD', path, message: 'Scope requires subjectIds and validFrom.' });
    return;
  }
  if (requireSubject && scope.subjectIds.length === 0) {
    issues.push({ code: 'MISSING_FIELD', path: `${path}.subjectIds`, message: 'Scope requires at least one subject.' });
  }
}

function isValidPeriod(period: FoundationPeriod): boolean {
  const from = parseStrictRfc3339(period.from);
  const until = parseStrictRfc3339(period.until);
  return from !== undefined && until !== undefined && until > from;
}

/**
 * Parse only RFC3339 date-time values and validate calendar components before
 * converting them. Date.parse accepts values such as 2026-02-30 by silently
 * normalizing them into March, which would make a scope or evaluation period
 * mean something other than what its author wrote.
 */
function parseStrictRfc3339(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const zone = match[8];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }

  // Date.UTC treats years 0..99 as 1900..1999; the contract's four-digit
  // year range is handled explicitly so the conversion remains unambiguous.
  const milliseconds = Number((fraction + '000').slice(0, 3));
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds)
    - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function sameScope(left: FoundationScope, right: FoundationScope): boolean {
  return [...left.subjectIds].sort().join('\u0000') === [...right.subjectIds].sort().join('\u0000')
    && left.validFrom === right.validFrom
    && left.validUntil === right.validUntil;
}

function samePeriod(left: FoundationPeriod, right: FoundationPeriod): boolean {
  return left.from === right.from && left.until === right.until;
}

function scopeWithin(inner: FoundationScope, outer: FoundationScope): boolean {
  const outerSubjects = new Set(outer.subjectIds);
  const subjectsContained = inner.subjectIds.every((subjectId) => outerSubjects.has(subjectId));
  if (!subjectsContained) return false;
  const innerFrom = parseStrictRfc3339(inner.validFrom);
  const outerFrom = parseStrictRfc3339(outer.validFrom);
  if (innerFrom === undefined || outerFrom === undefined || innerFrom < outerFrom) return false;
  if (inner.validUntil === undefined) return outer.validUntil === undefined;
  const innerUntil = parseStrictRfc3339(inner.validUntil);
  if (innerUntil === undefined) return false;
  if (outer.validUntil === undefined) return true;
  const outerUntil = parseStrictRfc3339(outer.validUntil);
  return outerUntil !== undefined && innerUntil <= outerUntil;
}

function periodWithinScope(period: FoundationPeriod, scope: FoundationScope): boolean {
  const periodFrom = parseStrictRfc3339(period.from);
  const periodUntil = parseStrictRfc3339(period.until);
  const scopeFrom = parseStrictRfc3339(scope.validFrom);
  if (periodFrom === undefined || periodUntil === undefined || scopeFrom === undefined || periodFrom < scopeFrom) {
    return false;
  }
  if (scope.validUntil === undefined) return true;
  const scopeUntil = parseStrictRfc3339(scope.validUntil);
  return scopeUntil !== undefined && periodUntil <= scopeUntil;
}

function isRevisionEndpoint(type: FoundationRelationEndpoint): type is FoundationType | 'decision' {
  return type === 'objective' || type === 'variable' || type === 'model' || type === 'constraint' || type === 'decision';
}

function missing(path: string): FoundationValidationIssue {
  return { code: 'MISSING_FIELD', path, message: `${path} is required for this use.` };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
