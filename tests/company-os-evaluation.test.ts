import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPANY_OS_EVALUATION_SIDECAR,
  CompanyOsEvaluationError,
  createCompanyOsEvaluationStore,
  createFoundationDefinitionLoadPort,
  type EvaluationMeasurementInput,
  type OutcomeCasePort
} from '../src/company-os-evaluation.js';
import {
  createFoundationRevisionStore,
  type FoundationRevisionStore
} from '../src/foundation-store.js';
import {
  createJudgmentProblemFoundationReferenceProvider,
  saveJudgmentProblemSnapshot,
  type JudgmentProblemReference,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot
} from '../src/judgment-problem-snapshot.js';
import { initializePersonalOs } from '../src/ssot.js';
import type {
  FoundationAcl,
  FoundationScope,
  ObjectiveDefinition,
  VariableDefinition
} from '../src/ontology-foundation.js';
import type { FoundationRef } from '../src/foundation-catalog.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

const scope: FoundationScope = {
  subjectIds: ['hotel-alpha'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z'
};

const evaluationPeriod = {
  from: '2026-01-01T00:00:00.000Z',
  until: '2026-03-31T23:59:59.000Z'
} as const;

function acl(readerIds: readonly string[] = ['reader-1']): FoundationAcl {
  return {
    ownerId: 'owner-1',
    visibility: 'private',
    readerIds: [...readerIds],
    writerIds: []
  };
}

function variableDefinition(
  id: string,
  meaning: string,
  unit: string,
  aggregation: VariableDefinition['aggregation']
): VariableDefinition {
  return {
    id,
    type: 'variable',
    revision: '1',
    meaning,
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: acl(),
    storage: 'ontology',
    provenance: [{ sourceId: 'story-company-os-evaluation-v1', sourceKind: 'document', evidenceIds: [] }],
    scope,
    subject: 'hotel-alpha/front-desk',
    valueKind: 'number',
    unit,
    aggregation,
    granularity: 'week',
    measurementMethod: 'weekly operational aggregation'
  };
}

function objectiveDefinition(loadRef: FoundationRef, qualityRef: FoundationRef): ObjectiveDefinition {
  return {
    id: 'objective-reduce-front-desk-load',
    type: 'objective',
    revision: '1',
    meaning: 'Reduce handling load while preserving guest response quality.',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: acl(),
    storage: 'ontology',
    provenance: [{ sourceId: 'story-company-os-evaluation-v1', sourceKind: 'document', evidenceIds: [] }],
    scope,
    beneficiaryIds: ['hotel-alpha'],
    desiredState: 'The front desk spends less time on total handling while guest quality is preserved.',
    criteria: [
      {
        variableRef: { id: loadRef.id, type: 'variable', revision: loadRef.revision },
        operator: 'at_most',
        target: 100
      },
      {
        variableRef: { id: qualityRef.id, type: 'variable', revision: qualityRef.revision },
        operator: 'at_least',
        target: 0.9
      }
    ],
    evaluationPeriod,
    accountableId: 'owner-1'
  };
}

function snapshotReference(
  kind: JudgmentProblemReference['kind'],
  id: string,
  referenceDigest: string
): JudgmentProblemReference {
  return {
    kind,
    id,
    revision: '1',
    digest: referenceDigest as `sha256:${string}`,
    scope: { type: 'project', id: 'hotel-alpha' },
    valid_from: evaluationPeriod.from,
    valid_to: evaluationPeriod.until
  };
}

function makeSnapshot(objectiveRef: FoundationRef, variableRefs: readonly FoundationRef[]): JudgmentProblemSnapshot {
  const refs: JudgmentProblemReference[] = [
    snapshotReference('objective', objectiveRef.id, objectiveRef.digest),
    ...variableRefs.map((ref) => snapshotReference('variable', ref.id, ref.digest)),
    snapshotReference('criterion', 'criterion-load', digest(['criterion-load'])),
    snapshotReference('criterion', 'criterion-quality', digest(['criterion-quality'])),
    snapshotReference('observation', 'observation-hotel-week', digest(['observation-hotel-week'])),
    snapshotReference('model', 'model-handoff-load', digest(['model-handoff-load'])),
    snapshotReference('constraint', 'constraint-no-double-entry', digest(['constraint-no-double-entry'])),
    snapshotReference('authority', 'authority-owner', digest(['authority-owner'])),
    snapshotReference('resource', 'resource-pilot', digest(['resource-pilot'])),
    snapshotReference('deadline', 'deadline-evaluation', digest(['deadline-evaluation']))
  ];
  return {
    snapshot_version: 'judgment-problem-snapshot.v1',
    problem_id: 'problem-hotel-ai-phone-pilot',
    revision: '1',
    question: 'Did the pilot reduce front-desk load while preserving quality?',
    owner_scope: { type: 'project', id: 'hotel-alpha' },
    references: refs,
    read_policy: {
      ownerId: 'owner-1',
      visibility: 'private',
      readerIds: ['reader-1'],
      writerIds: []
    },
    execution_permission: 'none',
    created_at: '2026-01-01T00:00:00.000Z'
  };
}

function measurement(
  reference: FoundationRef,
  variable: VariableDefinition,
  value: number | undefined,
  options: Partial<Pick<EvaluationMeasurementInput, 'status' | 'recordedAt' | 'evidenceRef'>> = {}
): EvaluationMeasurementInput {
  return {
    variableRef: reference,
    descriptor: {
      unit: variable.unit,
      aggregation: variable.aggregation,
      granularity: variable.granularity,
      scope,
      period: evaluationPeriod
    },
    status: options.status ?? 'observed',
    ...(value === undefined ? {} : { value }),
    recordedAt: options.recordedAt ?? '2026-04-01T00:00:00.000Z',
    ...(options.evidenceRef === undefined ? {} : { evidenceRef: options.evidenceRef })
  };
}

function createOutcomeCasePort(sourceConditions: unknown = { pilot: 'hotel-ai' }) {
  const canonical = {
    id: 'outcome-hotel-ai-phone-pilot',
    revision: '1',
    digest: digest(['outcome-hotel-ai-phone-pilot'])
  } as const;
  let currentAcl = acl();
  const port: OutcomeCasePort = {
    async read(reference, actor) {
      if (reference.id !== canonical.id) throw new CompanyOsEvaluationError('not_found', 'OutcomeCase was not found');
      if (!currentAcl.readerIds.includes(actor.principal) && currentAcl.ownerId !== actor.principal) {
        throw new CompanyOsEvaluationError('authorization_denied', 'OutcomeCase current ACL denied the read');
      }
      if (reference.revision !== undefined && reference.revision !== canonical.revision) {
        throw new CompanyOsEvaluationError('not_found', 'OutcomeCase revision was not found');
      }
      if (reference.digest !== undefined && reference.digest !== canonical.digest) {
        throw new CompanyOsEvaluationError('integrity_mismatch', 'OutcomeCase digest does not match');
      }
      return {
        reference: canonical,
        source: {
          state: 'closed',
          owner_refs: [{ status: 'typed', ref: { id: 'project-hotel', type: 'project', revision: '3' } }],
          conditions: sourceConditions
        } as unknown as OutcomeCaseRead['source'],
        acl: { ...currentAcl, readerIds: [...currentAcl.readerIds], writerIds: [...currentAcl.writerIds] },
        scope
      };
    }
  };
  return {
    port,
    revokeReader() {
      currentAcl = acl([]);
    }
  };
}

async function makeHarness(sourceConditions: unknown = { pilot: 'hotel-ai' }) {
  const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-company-os-evaluation-'));
  dataDirs.push(dataDir);
  await initializePersonalOs(dataDir);
  const foundationStore = createFoundationRevisionStore({ dataDir });
  const loadRef = await foundationStore.create(
    variableDefinition('variable-front-desk-load', 'Total front-desk handling minutes including handoff and correction work.', 'minutes', 'sum'),
    { principal: 'owner-1' }
  );
  const qualityRef = await foundationStore.create(
    variableDefinition('variable-guest-quality', 'Guest response quality score after the pilot.', 'ratio', 'average'),
    { principal: 'owner-1' }
  );
  const objectiveRef = await foundationStore.create(objectiveDefinition(loadRef, qualityRef), { principal: 'owner-1' });
  const originalSnapshot = makeSnapshot(objectiveRef, [loadRef, qualityRef]);
  const foundationReferenceProvider = createJudgmentProblemFoundationReferenceProvider({ store: foundationStore });
  const referenceProvider: JudgmentProblemReferenceProvider = {
    async resolve(input) {
      if (input.reference.kind === 'objective' || input.reference.kind === 'variable') {
        return foundationReferenceProvider.resolve(input);
      }
      return { status: 'resolved', digest: input.reference.digest };
    }
  };
  const receipt = await saveJudgmentProblemSnapshot({
    root: dataDir,
    snapshot: originalSnapshot,
    access: { principal: 'owner-1' },
    referenceProvider
  });
  const outcome = createOutcomeCasePort(sourceConditions);
  const evaluation = createCompanyOsEvaluationStore({
    dataDir,
    foundation: createFoundationDefinitionLoadPort(foundationStore),
    outcomeCase: outcome.port,
    snapshotReferenceProvider: referenceProvider
  });
  return {
    dataDir,
    foundationStore,
    loadRef,
    qualityRef,
    objectiveRef,
    loadVariable: variableDefinition('variable-front-desk-load', 'Total front-desk handling minutes including handoff and correction work.', 'minutes', 'sum'),
    qualityVariable: variableDefinition('variable-guest-quality', 'Guest response quality score after the pilot.', 'ratio', 'average'),
    receipt,
    referenceProvider,
    outcome,
    evaluation
  };
}

function requestFor(
  harness: Awaited<ReturnType<typeof makeHarness>>,
  overrides: Partial<Parameters<Awaited<ReturnType<typeof makeHarness>>['evaluation']['evaluate']>[0]> = {}
) {
  const predictionInputs = [
    measurement(harness.loadRef, harness.loadVariable, 80),
    measurement(harness.qualityRef, harness.qualityVariable, 0.95)
  ];
  const actualInputs = [
    measurement(harness.loadRef, harness.loadVariable, 80),
    measurement(harness.qualityRef, harness.qualityVariable, 0.82)
  ];
  return {
    id: 'evaluation-hotel-ai-phone-pilot-1',
    snapshot: {
      root: harness.dataDir,
      snapshotId: harness.receipt.snapshot_id,
      referenceProvider: harness.referenceProvider
    },
    access: { principal: 'owner-1', scope },
    outcomeCase: { id: 'outcome-hotel-ai-phone-pilot' },
    predictions: predictionInputs,
    actuals: actualInputs,
    judgmentAtTimeValidity: {
      status: 'valid' as const,
      basis: 'The pilot decision used the approved objective and available evidence.',
      evidenceRefs: ['evidence/judgment-at-time-1']
    },
    evaluatedAt: '2026-04-02T00:00:00.000Z',
    ...overrides
  };
}

describe('Company OS evaluation contract', () => {
  it('evaluates hotel load and quality independently, then reads the immutable record back', async () => {
    const harness = await makeHarness();
    const record = await harness.evaluation.evaluate(requestFor(harness));

    expect(record.achievement).toBe('not_achieved');
    expect(record.criteria.map((criterion) => criterion.status)).toEqual(['achieved', 'not_achieved']);
    expect(record.predictionComparisons.map((comparison) => comparison.status)).toEqual(['matched', 'missed']);
    expect(record.judgmentAtTimeValidity.status).toBe('valid');
    expect(record.outcomeCaseRef).toMatchObject({ id: 'outcome-hotel-ai-phone-pilot', revision: '1' });

    const readback = await harness.evaluation.read(record.id, { principal: 'owner-1', scope });
    expect(readback).toEqual(record);
    expect(Object.isFrozen(readback)).toBe(true);
    expect(JSON.parse(await readFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), 'utf8')).records).toHaveLength(1);
    await expect(harness.evaluation.evaluate(requestFor(harness))).rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('does not turn missing or future evidence into a successful result', async () => {
    const harness = await makeHarness();
    const missing = requestFor(harness, {
      id: 'evaluation-hotel-ai-phone-pilot-missing',
      actuals: [
        measurement(harness.loadRef, harness.loadVariable, undefined, { status: 'missing' }),
        measurement(harness.qualityRef, harness.qualityVariable, undefined, { status: 'not_arrived' })
      ]
    });
    const missingRecord = await harness.evaluation.evaluate(missing);
    expect(missingRecord.achievement).toBe('indeterminate');
    expect(missingRecord.criteria.map((criterion) => criterion.reason)).toEqual(['actual_missing', 'actual_not_arrived']);

    const future = requestFor(harness, {
      id: 'evaluation-hotel-ai-phone-pilot-future',
      evaluatedAt: '2026-02-01T00:00:00.000Z'
    });
    const futureRecord = await harness.evaluation.evaluate(future);
    expect(futureRecord.achievement).toBe('indeterminate');
    expect(futureRecord.criteria.every((criterion) => criterion.reason === 'evaluation_period_not_complete')).toBe(true);
  });

  it('requires explicit conversion provenance for a changed measurement definition', async () => {
    const harness = await makeHarness();
    const qualityV2 = await harness.foundationStore.update({
      reference: harness.qualityRef,
      next: {
        ...harness.qualityVariable,
        meaning: 'Guest response quality score expressed in percentage points.',
        unit: 'percentage-points'
      }
    }, { principal: 'owner-1' });

    const incompatible = requestFor(harness, {
      id: 'evaluation-hotel-ai-phone-pilot-no-conversion',
      actuals: [
        measurement(harness.loadRef, harness.loadVariable, 80),
        measurement(qualityV2, { ...harness.qualityVariable, unit: 'percentage-points' }, 82)
      ],
      predictions: [
        measurement(harness.loadRef, harness.loadVariable, 80),
        measurement(qualityV2, { ...harness.qualityVariable, unit: 'percentage-points' }, 95)
      ]
    });
    await expect(harness.evaluation.evaluate(incompatible)).rejects.toMatchObject({ code: 'incompatible_measurement' });

    const convertedMeasurement = {
      ...measurement(harness.qualityRef, harness.qualityVariable, 0.82),
      variableRef: qualityV2,
      conversion: {
        sourceRef: qualityV2,
        targetRef: harness.qualityRef,
        provenance: {
          id: 'conversion-quality-percentage-to-ratio-v1',
          description: 'Divide percentage points by 100 using the pilot measurement adapter.'
        }
      }
    };
    const converted = await harness.evaluation.evaluate(requestFor(harness, {
      id: 'evaluation-hotel-ai-phone-pilot-converted',
      actuals: [measurement(harness.loadRef, harness.loadVariable, 80), convertedMeasurement],
      predictions: [measurement(harness.loadRef, harness.loadVariable, 80), convertedMeasurement]
    }));
    expect(converted.actuals[1]?.variableRef).toEqual(qualityV2);
    expect(converted.actuals[1]?.effectiveVariableRef).toEqual(harness.qualityRef);
    expect(converted.actuals[1]?.conversion?.provenance.id).toBe('conversion-quality-percentage-to-ratio-v1');
  });

  it('fails closed when OutcomeCase source conditions are not JSON values', async () => {
    class ConditionInstance {
      readonly value = 'class-instance';
    }
    const invalidConditions: readonly unknown[] = [
      new Date('2026-09-23T00:00:00.000Z'),
      new Map([['kind', 'map']]),
      new Set(['set']),
      new ConditionInstance()
    ];

    for (const conditions of invalidConditions) {
      const harness = await makeHarness(conditions);
      await expect(harness.evaluation.evaluate(requestFor(harness)))
        .rejects.toMatchObject({ code: 'integrity_mismatch' });
    }
  });

  it('rechecks current ACL and trusted scope when reading historical evaluation inputs', async () => {
    const harness = await makeHarness();
    const record = await harness.evaluation.evaluate(requestFor(harness));

    harness.outcome.revokeReader();
    await expect(harness.evaluation.read(record.id, { principal: 'reader-1', scope }))
      .rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(harness.evaluation.read(record.id, { principal: 'owner-1', scope: { subjectIds: ['other-hotel'], validFrom: scope.validFrom } }))
      .rejects.toMatchObject({ code: 'scope_violation' });

    const raw = await readFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), 'utf8');
    await writeFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), '{not-json}\n', 'utf8');
    await expect(harness.evaluation.read(record.id, { principal: 'owner-1', scope })).rejects.toMatchObject({ code: 'corrupt_record' });
    await writeFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), raw, 'utf8');

    const snapshotTampering = [
      {
        snapshotId: record.snapshot.snapshotId,
        problemId: `${record.snapshot.problemId}-tampered`,
        revision: record.snapshot.revision,
        digest: record.snapshot.digest
      },
      {
        snapshotId: record.snapshot.snapshotId,
        problemId: record.snapshot.problemId,
        revision: '2',
        digest: record.snapshot.digest
      },
      {
        snapshotId: record.snapshot.snapshotId,
        problemId: record.snapshot.problemId,
        revision: record.snapshot.revision,
        digest: digest(['tampered-snapshot'])
      }
    ];
    for (const snapshot of snapshotTampering) {
      const tampered = JSON.parse(raw) as { records: Array<Record<string, unknown>> };
      tampered.records[0] = {
        ...tampered.records[0],
        snapshot
      };
      await writeFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), JSON.stringify(tampered), 'utf8');
      await expect(harness.evaluation.read(record.id, { principal: 'owner-1', scope }))
        .rejects.toMatchObject({ code: 'integrity_mismatch' });
    }
    await writeFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), raw, 'utf8');

    const tampered = JSON.parse(raw) as { records: Array<Record<string, unknown>> };
    tampered.records[0] = {
      ...tampered.records[0],
      achievement: 'achieved'
    };
    await writeFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), JSON.stringify(tampered), 'utf8');
    await expect(harness.evaluation.read(record.id, { principal: 'owner-1', scope }))
      .rejects.toMatchObject({ code: 'integrity_mismatch' });
    await writeFile(join(harness.dataDir, COMPANY_OS_EVALUATION_SIDECAR), raw, 'utf8');
  });
});
