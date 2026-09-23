import { describe, expect, it } from 'vitest';
import {
  inferFoundationConclusions,
  JUDGMENT_FOUNDATION_CONTRACT_VERSION,
  judgmentFoundationContract,
  judgmentFoundationRelations,
  validateEvaluationCompatibility,
  validateFoundationDefinition,
  validateFoundationRelation
} from '../src/ontology-foundation.js';
import type {
  ConstraintDefinition,
  FoundationEvaluationDescriptor,
  FoundationPeriod,
  FoundationScope,
  ModelDefinition,
  ObjectiveDefinition,
  VariableDefinition
} from '../src/ontology-foundation.js';
import {
  judgmentFoundationReference,
  portableOntology,
  portableOntologyV1
} from '../src/ontology.js';

const scope: FoundationScope = {
  subjectIds: ['hotel-1'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T00:00:00.000Z'
};
const evaluationPeriod: FoundationPeriod = {
  from: '2026-10-01T00:00:00.000Z',
  until: '2026-10-31T00:00:00.000Z'
};

function acl() {
  return {
    ownerId: 'org-brainbase',
    visibility: 'project' as const,
    readerIds: ['team-judgment'],
    writerIds: ['owner-1']
  };
}

function provenance() {
  return [{
    sourceId: 'candidate-1',
    sourceKind: 'candidate' as const,
    evidenceIds: ['evidence-1']
  }];
}

function variable(overrides: Partial<VariableDefinition> = {}): VariableDefinition {
  return {
    id: 'front-desk-total-minutes',
    type: 'variable',
    revision: '1',
    meaning: 'Total front desk handling time, including handoff and correction work.',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl: acl(),
    storage: 'ontology',
    provenance: provenance(),
    scope,
    subject: 'front-desk',
    valueKind: 'number',
    unit: 'minute',
    aggregation: 'sum',
    granularity: 'week',
    measurementMethod: 'weekly event aggregation',
    ...overrides
  };
}

function objective(overrides: Partial<ObjectiveDefinition> = {}): ObjectiveDefinition {
  return {
    id: 'reduce-front-desk-load',
    type: 'objective',
    revision: '1',
    meaning: 'Reduce total handling load while preserving customer response quality.',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl: acl(),
    storage: 'ontology',
    provenance: provenance(),
    scope,
    beneficiaryIds: ['org-brainbase', 'front-desk-team'],
    desiredState: 'Front desk total handling time is lower without quality regression.',
    criteria: [{
      variableRef: { id: 'front-desk-total-minutes', type: 'variable', revision: '1' },
      operator: 'at_most',
      target: 240
    }],
    evaluationPeriod,
    ...overrides
  };
}

function model(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: 'ai-handoff-load-model',
    type: 'model',
    revision: '1',
    meaning: 'Estimate total handling load from automated completion and handoff correction work.',
    epistemicState: 'hypothesis',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment'],
    acl: acl(),
    storage: 'ontology',
    provenance: provenance(),
    scope,
    inputVariableRefs: [{ id: 'automated-completion-rate', type: 'variable', revision: '1' }],
    outputVariableRefs: [{ id: 'front-desk-total-minutes', type: 'variable', revision: '1' }],
    applicability: scope,
    relationship: 'Higher automated completion may reduce direct handling, while handoff correction may add work.',
    uncertainty: 'Handoff and correction load is not yet measured across all facilities.',
    validationState: 'in_progress',
    ...overrides
  };
}

function constraint(overrides: Partial<ConstraintDefinition> = {}): ConstraintDefinition {
  return {
    id: 'no-double-entry-mvp',
    type: 'constraint',
    revision: '1',
    meaning: 'The MVP must not require front desk staff to enter the same information twice.',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: acl(),
    storage: 'ontology',
    provenance: provenance(),
    scope,
    condition: 'No workflow in the MVP requires duplicate manual entry.',
    appliesTo: ['reduce-front-desk-load', 'ai-handoff-load-model'],
    exceptions: [{
      decisionRef: { id: 'decision-mvp-entry-exception', type: 'decision', revision: '2' },
      scope
    }],
    adoptionBasis: [{ id: 'decision-no-double-entry', type: 'decision', revision: '1' }],
    ...overrides
  };
}

describe('judgment foundation ontology extension', () => {
  it('registers the four foundation types and semantic relations', () => {
    expect(JUDGMENT_FOUNDATION_CONTRACT_VERSION).toBe('0.1.0');
    expect(Object.keys(judgmentFoundationContract.types)).toEqual([
      'objective', 'variable', 'model', 'constraint'
    ]);
    expect(Object.keys(judgmentFoundationContract.relations)).toEqual([
      'contributes_to', 'evaluated_by', 'uses_as_input', 'predicts', 'applies_to', 'used_as_basis'
    ]);
    expect(judgmentFoundationContract.graphActivation).toBe('deferred');
    expect(judgmentFoundationContract.canonicalStoreAdoption).toBe('future-story-02-plus');
    expect(Object.isFrozen(judgmentFoundationContract)).toBe(true);
    expect(judgmentFoundationContract.types.objective.requiredBase).toEqual(
      expect.arrayContaining(['id', 'type', 'revision', 'meaning', 'adoptionState', 'authorizedUses', 'acl', 'storage', 'provenance', 'scope'])
    );
    expect(judgmentFoundationContract.types.objective.requiredForEvaluation).toEqual(
      expect.arrayContaining(['beneficiaryIds', 'desiredState', 'criteria', 'evaluationPeriod'])
    );
    expect(judgmentFoundationContract.types.model.requiredForEvaluation).toEqual(
      expect.arrayContaining(['epistemicState', 'relationship', 'uncertainty', 'validationState'])
    );
    expect(judgmentFoundationContract.types.constraint.requiredForEvaluation).toEqual(
      expect.arrayContaining(['exceptions', 'adoptionBasis'])
    );
    expect(judgmentFoundationRelations.contributes_to.prohibitedInferences).toContain(
      'story completion does not establish objective achievement'
    );
  });

  it('keeps the historical ontology releases unchanged', () => {
    expect(portableOntologyV1.version).toBe('1.0.0');
    expect(portableOntology.version).toBe('2.0.0');
    expect(portableOntologyV1.domains.types.concepts.some((concept) => concept.id === 'objective')).toBe(false);
    expect(portableOntology.domains.types.concepts.some((concept) => concept.id === 'variable')).toBe(false);
    expect(judgmentFoundationReference).toMatchObject({
      contractVersion: '0.1.0',
      historicalOntologyVersions: ['1.0.0', '2.0.0'],
      graphActivation: 'deferred'
    });
  });

  it('separates draft retention from judgment and evaluation validation', () => {
    const incompleteDraft = objective({ desiredState: '', criteria: [] });
    const draftResult = validateFoundationDefinition(incompleteDraft, { use: 'draft' });
    expect(draftResult).toMatchObject({ valid: true, status: 'valid', issues: [] });

    const judgmentResult = validateFoundationDefinition(incompleteDraft, { use: 'judgment' });
    expect(judgmentResult.valid).toBe(false);
    expect(judgmentResult.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['MISSING_FIELD'])
    );

    const criterionWithoutTarget = objective({
      criteria: [{
        variableRef: { id: 'front-desk-total-minutes', type: 'variable', revision: '1' },
        operator: 'at_most'
      }]
    });
    const criterionResult = validateFoundationDefinition(criterionWithoutTarget, { use: 'evaluation' });
    expect(criterionResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'criteria[0].target', code: 'MISSING_FIELD' })
    ]));

    const modelWithoutEpistemicState = { ...model(), epistemicState: undefined } as unknown as ModelDefinition;
    expect(validateFoundationDefinition(modelWithoutEpistemicState, { use: 'judgment' }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'epistemicState', code: 'MISSING_FIELD' })])
    );
  });

  it('reports concrete definition, unit, aggregation, granularity, scope, and period mismatches', () => {
    const definition = variable();
    const actual: FoundationEvaluationDescriptor = {
      variableRef: { id: definition.id, type: 'variable', revision: '2' },
      unit: 'hour',
      aggregation: 'average',
      granularity: 'day',
      scope: { ...scope, subjectIds: ['hotel-2'] },
      period: { from: '2026-11-01T00:00:00.000Z', until: '2026-11-30T00:00:00.000Z' }
    };
    const result = validateEvaluationCompatibility(definition, actual, {
      scope,
      period: evaluationPeriod
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'EVALUATION_DEFINITION_VERSION_MISMATCH',
      'EVALUATION_UNIT_MISMATCH',
      'EVALUATION_AGGREGATION_MISMATCH',
      'EVALUATION_GRANULARITY_MISMATCH',
      'EVALUATION_SCOPE_MISMATCH',
      'EVALUATION_PERIOD_MISMATCH'
    ]));

    const compatible = validateEvaluationCompatibility(definition, {
      variableRef: { id: definition.id, type: 'variable', revision: definition.revision },
      unit: definition.unit,
      aggregation: definition.aggregation,
      granularity: definition.granularity,
      scope,
      period: evaluationPeriod
    }, { scope, period: evaluationPeriod });
    expect(compatible).toMatchObject({ valid: true, status: 'valid', issues: [] });

    const narrowerEvaluationScope = {
      subjectIds: ['hotel-1'],
      validFrom: '2026-02-01T00:00:00.000Z',
      validUntil: '2026-03-01T00:00:00.000Z'
    };
    const narrowerEvaluationPeriod = {
      from: '2026-02-10T00:00:00.000Z',
      until: '2026-02-20T00:00:00.000Z'
    };
    expect(validateEvaluationCompatibility(definition, {
      variableRef: { id: definition.id, type: 'variable', revision: definition.revision },
      unit: definition.unit,
      aggregation: definition.aggregation,
      granularity: definition.granularity,
      scope: narrowerEvaluationScope,
      period: narrowerEvaluationPeriod
    })).toMatchObject({ valid: true, status: 'valid', issues: [] });

    const outsideSubject = validateEvaluationCompatibility(definition, {
      variableRef: { id: definition.id, type: 'variable', revision: definition.revision },
      unit: definition.unit,
      aggregation: definition.aggregation,
      granularity: definition.granularity,
      scope: { ...narrowerEvaluationScope, subjectIds: ['hotel-2'] },
      period: narrowerEvaluationPeriod
    });
    expect(outsideSubject.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EVALUATION_SCOPE_MISMATCH' })
    ]));

    const outsidePeriod = validateEvaluationCompatibility(definition, {
      variableRef: { id: definition.id, type: 'variable', revision: definition.revision },
      unit: definition.unit,
      aggregation: definition.aggregation,
      granularity: definition.granularity,
      scope: narrowerEvaluationScope,
      period: { from: '2027-01-01T00:00:00.000Z', until: '2027-01-10T00:00:00.000Z' }
    });
    expect(outsidePeriod.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EVALUATION_PERIOD_MISMATCH' })
    ]));
  });

  it('keeps forbidden inferences explicit and allows world-model cycles', () => {
    const contribution = {
      relation: 'contributes_to' as const,
      source: { id: 'story-1', type: 'story' as const },
      target: { id: 'reduce-front-desk-load', type: 'objective' as const, revision: '1' }
    };
    expect(validateFoundationRelation(contribution)).toMatchObject({ valid: true, status: 'valid' });
    expect(inferFoundationConclusions(contribution)).toEqual([]);
    expect(validateFoundationRelation({
      relation: 'evaluated_by',
      source: { id: 'reduce-front-desk-load', type: 'objective' },
      target: { id: 'front-desk-total-minutes', type: 'variable' }
    })).toMatchObject({
      valid: false,
      status: 'invalid',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'INVALID_REVISION_REFERENCE' })])
    });
    expect(judgmentFoundationRelations.uses_as_input.prohibitedInferences).toContain(
      'input declaration does not prove causality or model accuracy'
    );
    expect(judgmentFoundationContract.inference).toEqual({
      worldModelCycles: 'allowed',
      executionDagCycles: 'rejected'
    });
  });

  it('keeps epistemic state, adoption, ACL, storage, and provenance independent', () => {
    const registeredHypothesis = model();
    const result = validateFoundationDefinition(registeredHypothesis, { use: 'judgment' });
    expect(result).toMatchObject({ valid: true, status: 'unverified', issues: [] });
    expect(registeredHypothesis.epistemicState).toBe('hypothesis');
    expect(registeredHypothesis.adoptionState).toBe('approved');
    expect(registeredHypothesis.storage).toBe('ontology');
    expect(registeredHypothesis.acl.ownerId).toBe('org-brainbase');
    expect(registeredHypothesis.acl.readerIds).toEqual(['team-judgment']);
    expect(registeredHypothesis.acl.writerIds).toEqual(['owner-1']);
    expect(registeredHypothesis.provenance).toEqual(provenance());

    const stateVariable = variable({
      id: 'pms-available',
      valueKind: 'state',
      unit: undefined,
      meaning: 'Whether the PMS integration is available.'
    });
    expect(validateFoundationDefinition(stateVariable, { use: 'evaluation' })).toMatchObject({
      valid: true,
      status: 'valid'
    });

    const boundedConstraint = constraint();
    expect(validateFoundationDefinition(boundedConstraint, { use: 'execution' })).toMatchObject({
      valid: true,
      status: 'valid'
    });
  });

  it('rejects malformed runtime payloads instead of trusting TypeScript casts', () => {
    const unknownType = validateFoundationDefinition({
      ...variable(),
      type: 'world_model'
    } as unknown, { use: 'draft' });
    expect(unknownType).toMatchObject({ valid: false });
    expect(unknownType.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'type', code: 'INVALID_FIELD' })
    ]));

    const unknownValueKind = validateFoundationDefinition({
      ...variable(),
      valueKind: 'observation'
    } as unknown, { use: 'draft' });
    expect(unknownValueKind).toMatchObject({ valid: false });
    expect(unknownValueKind.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'valueKind', code: 'INVALID_FIELD' })
    ]));

    const unknownOperator = validateFoundationDefinition({
      ...objective(),
      criteria: [{
        variableRef: { id: 'front-desk-total-minutes', type: 'variable', revision: '1' },
        operator: 'greater_than',
        target: 240
      }]
    } as unknown, { use: 'draft' });
    expect(unknownOperator).toMatchObject({ valid: false });
    expect(unknownOperator.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'criteria[0].operator', code: 'INVALID_FIELD' })
    ]));

    const malformedArray = validateFoundationDefinition({
      ...variable(),
      authorizedUses: 'judgment'
    } as unknown, { use: 'draft' });
    expect(malformedArray).toMatchObject({ valid: false });
    expect(malformedArray.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'authorizedUses', code: 'INVALID_FIELD' })
    ]));

    const malformedProvenance = validateFoundationDefinition({
      ...variable(),
      provenance: [{ sourceId: 'candidate-1', sourceKind: 'unknown', evidenceIds: 'evidence-1' }]
    } as unknown, { use: 'draft' });
    expect(malformedProvenance).toMatchObject({ valid: false });
    expect(malformedProvenance.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'provenance[0].sourceKind', code: 'INVALID_FIELD' }),
      expect.objectContaining({ path: 'provenance[0].evidenceIds', code: 'INVALID_FIELD' })
    ]));

    const malformedDate = validateFoundationDefinition({
      ...variable(),
      scope: { ...scope, validFrom: 'not-a-date' }
    } as unknown, { use: 'draft' });
    expect(malformedDate).toMatchObject({ valid: false });
    expect(malformedDate.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'scope', code: 'INVALID_FIELD' })
    ]));

    const impossibleDate = validateFoundationDefinition({
      ...variable(),
      scope: { ...scope, validFrom: '2026-02-30T00:00:00.000Z' }
    } as unknown, { use: 'draft' });
    expect(impossibleDate.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'scope', code: 'INVALID_FIELD' })
    ]));

    const equalPeriod = validateFoundationDefinition({
      ...objective(),
      evaluationPeriod: { from: '2026-10-01T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z' }
    } as unknown, { use: 'evaluation' });
    expect(equalPeriod.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'evaluationPeriod', code: 'INVALID_FIELD' })
    ]));

    const malformedDecisionBackedScope = validateFoundationDefinition({
      ...constraint(),
      exceptions: [{ decisionRef: 'decision-mvp-entry-exception', scope }]
    } as unknown, { use: 'execution' });
    expect(malformedDecisionBackedScope).toMatchObject({ valid: false });
    expect(malformedDecisionBackedScope.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'exceptions[0].decisionRef', code: 'INVALID_REVISION_REFERENCE' })
    ]));

    const emptyExceptionScope = validateFoundationDefinition({
      ...constraint(),
      exceptions: [{
        decisionRef: { id: 'decision-mvp-entry-exception', type: 'decision', revision: '2' },
        scope: { subjectIds: [], validFrom: scope.validFrom, validUntil: scope.validUntil }
      }]
    } as unknown, { use: 'execution' });
    expect(emptyExceptionScope.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'exceptions[0].scope.subjectIds', code: 'MISSING_FIELD' })
    ]));

    const outsideExceptionScope = validateFoundationDefinition({
      ...constraint(),
      exceptions: [{
        decisionRef: { id: 'decision-mvp-entry-exception', type: 'decision', revision: '2' },
        scope: { ...scope, subjectIds: ['hotel-2'] }
      }]
    } as unknown, { use: 'execution' });
    expect(outsideExceptionScope.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'exceptions[0].scope', code: 'INVALID_FIELD' })
    ]));

    const malformedEvaluationReference = validateEvaluationCompatibility(variable(), {
      variableRef: { id: 'front-desk-total-minutes', type: 'world_model', revision: '1' },
      unit: 'minute',
      aggregation: 'sum',
      granularity: 'week',
      scope,
      period: evaluationPeriod
    } as unknown);
    expect(malformedEvaluationReference).toMatchObject({ valid: false });
    expect(malformedEvaluationReference.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'variableRef', code: 'INVALID_REVISION_REFERENCE' })
    ]));
  });

  it('does not allow retired or refuted definitions to self-authorize use', () => {
    const retired = validateFoundationDefinition(constraint({ adoptionState: 'retired' }), { use: 'execution' });
    expect(retired.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'adoptionState', code: 'UNAUTHORIZED_USE' })
    ]));

    const refutedVariable = validateFoundationDefinition(variable({ epistemicState: 'refuted' }), { use: 'evaluation' });
    expect(refutedVariable.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'epistemicState', code: 'UNAUTHORIZED_USE' })
    ]));

    const refutedModel = validateFoundationDefinition(model({
      epistemicState: 'refuted',
      validationState: 'refuted',
      authorizedUses: ['draft', 'judgment']
    }), { use: 'judgment' });
    expect(refutedModel.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'epistemicState', code: 'UNAUTHORIZED_USE' }),
      expect.objectContaining({ path: 'validationState', code: 'UNVERIFIED_MODEL' })
    ]));
  });
});
