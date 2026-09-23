import { createHash } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CompanyOsEvaluationError,
  createCompanyOsEvaluationStore,
  createFoundationDefinitionLoadPort,
  type EvaluationMeasurementInput,
  type OutcomeCasePort,
} from '../src/company-os-evaluation.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import {
  createJudgmentProblemFoundationReferenceProvider,
  loadJudgmentProblemSnapshot,
  saveJudgmentProblemSnapshot,
  type JudgmentProblemReference,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
} from '../src/judgment-problem-snapshot.js';
import {
  createJudgmentViewHttpHandler,
} from '../src/judgment-view-http.js';
import type {
  JudgmentViewReadPort,
} from '../src/judgment-view.js';
import {
  executeJudgmentDAG,
  executeJudgmentDAGComposition,
  loadJudgmentDAGRunArtifact,
  saveJudgmentDAGRunArtifact,
  type JudgmentDAG,
  type JudgmentDAGCompositionDefinition,
  type JudgmentDAGSubDAGEvaluationPort,
} from '../src/judgment-dag.js';
import { initializePersonalOs } from '../src/ssot.js';
import type {
  FoundationAcl,
  FoundationPeriod,
  FoundationScope,
  ObjectiveDefinition,
  VariableDefinition,
} from '../src/ontology-foundation.js';
import type { FoundationRef } from '../src/foundation-catalog.js';

const roots: string[] = [];
const principal = 'owner-1';
const scopeId = 'hotel-alpha';
const foundationScope: FoundationScope = {
  subjectIds: [scopeId],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z',
};
const evaluationPeriod: FoundationPeriod = {
  from: '2026-01-01T00:00:00.000Z',
  until: '2026-03-31T23:59:59.000Z',
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function acl(): FoundationAcl {
  return {
    ownerId: principal,
    visibility: 'private',
    readerIds: [],
    writerIds: [],
  };
}

function variableDefinition(): VariableDefinition {
  return {
    id: 'variable-front-desk-load',
    type: 'variable',
    revision: '1',
    meaning: 'Total front-desk handling minutes including handoff and correction work.',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: acl(),
    storage: 'ontology',
    provenance: [{ sourceId: 'story-company-os-judgment-view-v1', sourceKind: 'document', evidenceIds: [] }],
    scope: foundationScope,
    subject: 'hotel-alpha/front-desk',
    valueKind: 'number',
    unit: 'minutes',
    aggregation: 'sum',
    granularity: 'week',
    measurementMethod: 'weekly operational aggregation',
  };
}

function objectiveDefinition(variableRef: FoundationRef): ObjectiveDefinition {
  return {
    id: 'objective-reduce-front-desk-load',
    type: 'objective',
    revision: '1',
    meaning: 'Reduce handling load while preserving the service quality boundary.',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: acl(),
    storage: 'ontology',
    provenance: [{ sourceId: 'story-company-os-judgment-view-v1', sourceKind: 'document', evidenceIds: [] }],
    scope: foundationScope,
    beneficiaryIds: [scopeId],
    desiredState: 'Front-desk total handling time is at most 100 minutes per week.',
    criteria: [{
      variableRef: { id: variableRef.id, type: 'variable', revision: variableRef.revision },
      operator: 'at_most',
      target: 100,
    }],
    evaluationPeriod,
    accountableId: principal,
  };
}

function snapshotReference(
  kind: JudgmentProblemReference['kind'],
  id: string,
  referenceDigest: string,
): JudgmentProblemReference {
  return {
    kind,
    id,
    revision: '1',
    digest: referenceDigest as `sha256:${string}`,
    scope: { type: 'project', id: scopeId },
    valid_from: evaluationPeriod.from,
    valid_to: evaluationPeriod.until,
  };
}

function makeSnapshot(objectiveRef: FoundationRef, variableRef: FoundationRef): JudgmentProblemSnapshot {
  return {
    snapshot_version: 'judgment-problem-snapshot.v1',
    problem_id: 'problem-hotel-ai-phone-pilot',
    revision: '1',
    question: 'Should the hotel introduce the AI phone pilot?',
    owner_scope: { type: 'project', id: scopeId },
    references: [
      snapshotReference('objective', objectiveRef.id, objectiveRef.digest),
      snapshotReference('criterion', 'criterion-front-desk-load', digest('criterion-front-desk-load')),
      snapshotReference('variable', variableRef.id, variableRef.digest),
      snapshotReference('observation', 'observation-front-desk-load', digest('observation-front-desk-load')),
      snapshotReference('model', 'model-handoff-load', digest('model-handoff-load')),
      snapshotReference('constraint', 'constraint-no-double-entry', digest('constraint-no-double-entry')),
      snapshotReference('authority', 'authority-owner', digest('authority-owner')),
      snapshotReference('resource', 'resource-pilot', digest('resource-pilot')),
      snapshotReference('deadline', 'deadline-evaluation', digest('deadline-evaluation')),
    ],
    read_policy: {
      ownerId: principal,
      visibility: 'private',
      readerIds: [],
      writerIds: [],
    },
    execution_permission: 'none',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function parentDag(): JudgmentDAG {
  return {
    id: 'integration-parent-dag',
    version: '1.0.0',
    nodes: [
      {
        id: 'context.input',
        node_type: 'observation',
        layer: 'context',
        scope: { type: 'project', id: scopeId },
        version: '1.0.0',
        description: 'Capture the selected objective input.',
        depends_on: [],
        input_contract: 'parent.input.v1',
        output_contract: 'parent.context.v1',
        runner_type: 'deterministic',
      },
      {
        id: 'judgment.answer',
        node_type: 'judgment',
        layer: 'judgment',
        scope: { type: 'project', id: scopeId },
        version: '1.0.0',
        description: 'Produce the selected introduction path.',
        depends_on: ['context.input'],
        input_contract: 'parent.input.v1',
        output_contract: 'parent.output.v1',
        runner_type: 'deterministic',
      },
    ],
    edges: [{ from: 'context.input', to: 'judgment.answer', relation: 'depends_on' }],
  };
}

function compositionDefinition(): JudgmentDAGCompositionDefinition {
  return {
    composition_id: 'integration-composition',
    composition_version: '1.0.0',
    scope: { type: 'project', id: scopeId },
    parent_dag: { id: 'integration-parent-dag', version: '1.0.0' },
    children: [{
      invocation_id: 'technical',
      dag: { id: 'integration-child-dag', version: '1.0.0' },
      question: 'Can the pilot work technically?',
      input_contract: 'child.input.v1',
      output_contract: 'child.output.v1',
      required_capabilities: [],
      depends_on: [],
    }],
  };
}

function measurement(variableRef: FoundationRef, value: number): EvaluationMeasurementInput {
  return {
    variableRef,
    descriptor: {
      unit: 'minutes',
      aggregation: 'sum',
      granularity: 'week',
      scope: foundationScope,
      period: evaluationPeriod,
    },
    status: 'observed',
    value,
    recordedAt: '2026-04-01T00:00:00.000Z',
    evidenceRef: 'observation-front-desk-load',
  };
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return address.port;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('judgment view HTTP integration', () => {
  it('reads a real Foundation snapshot, composition run, artifact, and evaluation through one local HTTP host', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-judgment-view-http-'));
    roots.push(dataDir);
    await initializePersonalOs(dataDir);

    const foundationStore = createFoundationRevisionStore({ dataDir });
    const variableRef = await foundationStore.create(variableDefinition(), { principal });
    const objectiveRef = await foundationStore.create(objectiveDefinition(variableRef), { principal });
    const foundationProvider = createJudgmentProblemFoundationReferenceProvider({ store: foundationStore });
    const referenceProvider: JudgmentProblemReferenceProvider = {
      async resolve(input) {
        if (input.reference.kind === 'objective' || input.reference.kind === 'variable') {
          return foundationProvider.resolve(input);
        }
        return { status: 'resolved', digest: input.reference.digest };
      },
    };
    const savedSnapshot = await saveJudgmentProblemSnapshot({
      root: dataDir,
      snapshot: makeSnapshot(objectiveRef, variableRef),
      access: { principal },
      referenceProvider,
    });
    const problemRef = {
      snapshot_id: savedSnapshot.snapshot_id,
      problem_id: savedSnapshot.problem_id,
      revision: savedSnapshot.revision,
    } as const;

    const composition = compositionDefinition();
    const compositionRun = await executeJudgmentDAGComposition({
      run_id: 'composition-run-integration',
      composition,
      question: 'Should the hotel introduce the AI phone pilot?',
      input: { objective: objectiveRef.id },
      problem_snapshot: problemRef,
      fixed_conditions: { no_double_entry: true },
      delegation: { scope: composition.scope, capabilities: [] },
      snapshot_reader: {
        async read({ reference }) {
          const snapshot = await loadJudgmentProblemSnapshot({
            root: dataDir,
            snapshot_id: reference.snapshot_id,
            problem_id: reference.problem_id,
            revision: reference.revision,
            access: { principal },
            reference_resolution: 'current',
            referenceProvider,
          });
          return {
            status: 'resolved' as const,
            reference_resolution: 'current' as const,
            reference,
            snapshot: snapshot as unknown as Record<string, unknown>,
          };
        },
      },
      dag_resolver: {
        async resolve({ role, dag }) {
          return {
            dag,
            input_contract: role === 'parent' ? 'parent.input.v1' : 'child.input.v1',
            output_contract: role === 'parent' ? 'parent.output.v1' : 'child.output.v1',
          };
        },
      },
      contract_validator: { validate: async () => undefined },
      port: {
        async execute(request) {
          return {
            status: 'completed' as const,
            input_contract: 'child.input.v1',
            output_contract: 'child.output.v1',
            run_reference: { run_id: 'child-run-integration', dag: request.dag },
            conclusion: { answer: '技術的に成立' },
            evidence: [{ kind: 'observation', id: 'observation-front-desk-load', revision: '1' }],
            applicability: { scope: scopeId },
            uncertainty: { level: 'low' },
          };
        },
      } satisfies JudgmentDAGSubDAGEvaluationPort,
    });
    expect(compositionRun.status).toBe('completed');

    const artifactRecord = await executeJudgmentDAG({
      run_id: compositionRun.run_id,
      dag: parentDag(),
      input: { objective: objectiveRef.id },
      runners: {
        deterministic: {
          version: 'integration-runner-v1',
          run: ({ node }) => node.id === 'judgment.answer' ? { choice: 'pilot' } : { captured: true },
        },
      },
    });
    const artifactReceipt = await saveJudgmentDAGRunArtifact({ root: dataDir, record: artifactRecord });
    expect(await loadJudgmentDAGRunArtifact({ root: dataDir, artifact_id: artifactReceipt.artifact_id })).toEqual(artifactRecord);

    const outcomeReference = {
      id: 'outcome-hotel-ai-phone-pilot',
      revision: '1',
      digest: digest('outcome-hotel-ai-phone-pilot'),
    } as const;
    const outcomeCase: OutcomeCasePort = {
      async read(reference, actor) {
        if (reference.id !== outcomeReference.id || actor.principal !== principal) {
          throw new CompanyOsEvaluationError('not_found', 'OutcomeCase was not found');
        }
        return {
          reference: outcomeReference,
          acl: acl(),
          scope: foundationScope,
        };
      },
    };
    const evaluationStore = createCompanyOsEvaluationStore({
      dataDir,
      foundation: createFoundationDefinitionLoadPort(foundationStore),
      outcomeCase,
      snapshotReferenceProvider: referenceProvider,
    });
    const evaluationRecord = await evaluationStore.evaluate({
      id: 'evaluation-hotel-ai-phone-pilot-integration',
      snapshot: { root: dataDir, snapshotId: savedSnapshot.snapshot_id, referenceProvider },
      access: { principal, scope: foundationScope },
      outcomeCase: { id: outcomeReference.id },
      predictions: [measurement(variableRef, 90)],
      actuals: [measurement(variableRef, 80)],
      judgmentAtTimeValidity: {
        status: 'valid',
        basis: 'The pilot decision used the pinned Objective and evidence.',
        evidenceRefs: ['observation-front-desk-load'],
      },
      evaluatedAt: '2026-04-02T00:00:00.000Z',
    });

    const readPort: JudgmentViewReadPort = {
      async readCompositionRun(request) {
        return request.runId === compositionRun.run_id
          ? { status: 'resolved' as const, value: compositionRun }
          : { status: 'unknown' as const, reason: 'composition run was not found' };
      },
      async readProblemSnapshot(request) {
        try {
          const snapshot = await loadJudgmentProblemSnapshot({
            root: dataDir,
            snapshot_id: request.reference.snapshot_id,
            problem_id: request.reference.problem_id,
            revision: request.reference.revision,
            access: { principal: request.access.principal },
            reference_resolution: 'historical',
            referenceProvider,
          });
          return { status: 'resolved' as const, value: snapshot };
        } catch (error) {
          return { status: 'unknown' as const, reason: error instanceof Error ? error.message : 'snapshot read failed' };
        }
      },
      async readFoundationReference(request) {
        try {
          const record = await foundationStore.read(request.reference, {
            principal: request.access.principal,
            scope: foundationScope,
          });
          return record
            ? { status: 'resolved' as const, value: record }
            : { status: 'unknown' as const, reason: 'foundation reference was not found' };
        } catch (error) {
          return { status: 'permission_denied' as const, reason: error instanceof Error ? error.message : 'foundation read failed' };
        }
      },
      async readRunArtifact(request) {
        if (request.runId !== compositionRun.run_id
          || request.dag.id !== artifactRecord.dag.id
          || request.dag.version !== artifactRecord.dag.version) {
          return { status: 'invalid' as const, reason: 'artifact request did not match the historical run' };
        }
        try {
          const artifact = await loadJudgmentDAGRunArtifact({ root: dataDir, artifact_id: artifactReceipt.artifact_id });
          return { status: 'resolved' as const, value: artifact };
        } catch (error) {
          return { status: 'unknown' as const, reason: error instanceof Error ? error.message : 'artifact read failed' };
        }
      },
      async readEvaluation(request) {
        try {
          const record = await evaluationStore.read(request.evaluationId ?? evaluationRecord.id, {
            principal: request.access.principal,
            scope: foundationScope,
          });
          return record
            ? { status: 'resolved' as const, value: record }
            : { status: 'unknown' as const, reason: 'evaluation was not found' };
        } catch (error) {
          return { status: 'unknown' as const, reason: error instanceof Error ? error.message : 'evaluation read failed' };
        }
      },
    };

    const handler = createJudgmentViewHttpHandler({ readPort });
    const server = createServer((request, response) => {
      void handler(request, response, {
        tenantId: 'tenant-a',
        principal,
        scopeId,
      }).then((handled) => {
        if (!handled && !response.writableEnded) {
          response.statusCode = 404;
          response.end();
        }
      }).catch(() => {
        if (!response.writableEnded) {
          response.statusCode = 500;
          response.end();
        }
      });
    });
    const port = await listen(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/judgment-views/${encodeURIComponent(compositionRun.run_id)}?evaluationId=${encodeURIComponent(evaluationRecord.id)}`);
      const document = await response.json() as {
        status: string;
        conclusion: { status: string; value?: { value?: unknown } };
        problem: { status: string };
        objective: { status: string; value?: { ref?: FoundationRef } };
        resultEvaluation: { status: string; value?: { evaluationId?: string } };
        judgmentValidity: { status: string };
      };

      expect(response.status).toBe(200);
      expect(document.status).toBe('resolved');
      expect(document.problem.status).toBe('resolved');
      expect(document.objective.status).toBe('resolved');
      expect(document.objective.value?.ref).toEqual(objectiveRef);
      expect(document.conclusion).toMatchObject({ status: 'resolved', value: { value: { choice: 'pilot' } } });
      expect(document.resultEvaluation).toMatchObject({ status: 'resolved', value: { evaluationId: evaluationRecord.id } });
      expect(document.judgmentValidity.status).toBe('resolved');
    } finally {
      await close(server);
    }
  });
});
