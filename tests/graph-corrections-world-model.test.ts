import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import {
  applyGraphCorrection,
  findGraphCorrectionWorldModelHints,
  graphRecordDigest,
} from '../src/graph-corrections.js';
import type { FoundationAcl, FoundationScope, ModelDefinition, VariableDefinition } from '../src/ontology-foundation.js';
import { loadPersonalOs } from '../src/ssot.js';
import type { GraphFileV2 } from '../src/types.js';
import { EDGES, ENTITIES, FIXTURE_NOW, writeGraphV2 } from './graph-web-fixture.js';

let root: string;
let dataDir: string;

const acl: FoundationAcl = {
  ownerId: 'person-sato',
  visibility: 'private',
  readerIds: [],
  writerIds: [],
};

function scopeFor(subjectIds: readonly string[]): FoundationScope {
  return {
    subjectIds,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T23:59:59.000Z',
  };
}

function makeVariable(id: string, subject: string, subjectIds: readonly string[]): VariableDefinition {
  return {
    id,
    type: 'variable',
    revision: '1',
    meaning: `Variable ${id}`,
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'world-model-test', sourceKind: 'document', evidenceIds: [] }],
    scope: scopeFor(subjectIds),
    subject,
    valueKind: 'number',
    unit: 'hours',
    aggregation: 'sum',
    granularity: 'week',
    measurementMethod: 'weekly log sum',
  };
}

function makeModel(
  id: string,
  inputVarId: string,
  outputVarId: string,
  subjectIds: readonly string[],
): ModelDefinition {
  return {
    id,
    type: 'model',
    revision: '1',
    meaning: `Model ${id}`,
    epistemicState: 'hypothesis',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'world-model-test', sourceKind: 'document', evidenceIds: [] }],
    scope: scopeFor(subjectIds),
    inputVariableRefs: [{ id: inputVarId, type: 'variable', revision: '1' }],
    outputVariableRefs: [{ id: outputVarId, type: 'variable', revision: '1' }],
    applicability: scopeFor(subjectIds),
    relationship: `${inputVarId} drives ${outputVarId}`,
    uncertainty: 'Needs post-rollout validation',
    validationState: 'unverified',
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brainbase-graph-corrections-wm-'));
  dataDir = join(root, 'personal-os');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('graph corrections world-model review bridge', () => {
  it('omits worldModelReviewHints and affectedModelRefs when no foundation world-model definitions match', async () => {
    await writeGraphV2(dataDir);
    const result = await applyGraphCorrection(dataDir, {
      kind: 'update_entity',
      entityId: 'project-atlas',
      expectedDigest: graphRecordDigest(ENTITIES.atlas),
      reason: '正式名称へ合わせる。',
      changes: { name: 'Atlas本番導入' },
    }, { now: FIXTURE_NOW });

    expect(result.status).toBe('saved');
    expect('worldModelReviewHints' in result).toBe(false);
    expect('affectedModelRefs' in result).toBe(false);
  });

  it('surfaces direct and transitive world-model review hints when correcting an entity referenced by variables and models', async () => {
    await writeGraphV2(dataDir);
    const foundationStore = createFoundationRevisionStore({ dataDir });
    const ctx = { principal: 'person-sato' };

    const varLoad = await foundationStore.create(
      makeVariable('var-atlas-load', 'project-atlas/ops', ['project-atlas']),
      ctx,
    );
    const varRisk = await foundationStore.create(
      makeVariable('var-delivery-risk', 'portfolio/risk', ['org-acme']),
      ctx,
    );
    const varPortfolio = await foundationStore.create(
      makeVariable('var-portfolio-margin', 'portfolio/margin', ['org-acme']),
      ctx,
    );
    const modelDirect = await foundationStore.create(
      makeModel('model-atlas-capacity', 'var-atlas-load', 'var-delivery-risk', ['project-atlas']),
      ctx,
    );
    const modelTransitive = await foundationStore.create(
      makeModel('model-portfolio-margin', 'var-delivery-risk', 'var-portfolio-margin', ['org-acme']),
      ctx,
    );
    await foundationStore.create(
      makeVariable('var-unrelated', 'project-beta/ops', ['project-beta']),
      ctx,
    );

    const result = await applyGraphCorrection(dataDir, {
      kind: 'update_entity',
      entityId: 'project-atlas',
      expectedDigest: graphRecordDigest(ENTITIES.atlas),
      reason: '導入目標を段階展開へ変更した。',
      changes: { goal: '段階展開で本番移行する' },
    }, { now: FIXTURE_NOW });

    expect(result.status).toBe('saved');
    expect(result.worldModelReviewHints).toBeDefined();
    expect(result.affectedModelRefs).toEqual([
      { type: 'model', id: modelDirect.id, revision: modelDirect.revision, digest: modelDirect.digest },
      { type: 'model', id: modelTransitive.id, revision: modelTransitive.revision, digest: modelTransitive.digest },
    ]);

    const hints = result.worldModelReviewHints!;
    expect(hints.map((hint) => [hint.targetRef.type, hint.targetRef.id, hint.matchKind])).toEqual([
      ['model', 'model-atlas-capacity', 'direct_scope'],
      ['model', 'model-portfolio-margin', 'transitive_dependency'],
      ['variable', 'var-atlas-load', 'direct_scope'],
      ['variable', 'var-delivery-risk', 'transitive_dependency'],
      ['variable', 'var-portfolio-margin', 'transitive_dependency'],
    ]);
    expect(hints.some((hint) => hint.targetRef.id === 'var-unrelated')).toBe(false);

    const transitiveHint = hints.find((hint) => hint.targetRef.id === 'model-portfolio-margin')!;
    expect(transitiveHint.status).toBe('needs_review');
    expect(transitiveHint.matchedEntityIds).toEqual(['project-atlas']);
    expect(transitiveHint.dependencyPath?.map((step) => step.relation)).toContain('uses_as_input');
    expect(varLoad.digest).toBe(hints.find((hint) => hint.targetRef.id === 'var-atlas-load')?.targetRef.digest);
    expect(varRisk.digest).toBeDefined();
    expect(varPortfolio.digest).toBeDefined();
  });

  it('emits world-model review hints when correcting an edge whose endpoint is referenced by a variable or model', async () => {
    await writeGraphV2(dataDir);
    const foundationStore = createFoundationRevisionStore({ dataDir });
    const ctx = { principal: 'person-sato' };

    await foundationStore.create(
      makeVariable('var-tanaka-availability', 'person-tanaka/capacity', ['person-tanaka']),
      ctx,
    );
    await foundationStore.create(
      makeVariable('var-atlas-velocity', 'project-atlas/velocity', ['project-atlas']),
      ctx,
    );
    const modelVelocity = await foundationStore.create(
      makeModel('model-atlas-velocity', 'var-tanaka-availability', 'var-atlas-velocity', ['project-atlas']),
      ctx,
    );

    const result = await applyGraphCorrection(dataDir, {
      kind: 'update_edge',
      edgeId: EDGES.tanakaAtlas.id,
      expectedDigest: graphRecordDigest(EDGES.tanakaAtlas),
      reason: '田中さんは技術顧問へ役割変更した。',
      changes: { role: '技術顧問' },
    }, { now: FIXTURE_NOW });

    expect(result.affectedModelRefs).toEqual([
      { type: 'model', id: modelVelocity.id, revision: modelVelocity.revision, digest: modelVelocity.digest },
    ]);
    expect(result.worldModelReviewHints?.map((hint) => hint.targetRef.id)).toEqual([
      'model-atlas-velocity',
      'var-atlas-velocity',
      'var-tanaka-availability',
    ]);

    // Pure helper produces the exact same output on the reloaded graph snapshot.
    const reloaded = await loadPersonalOs(dataDir);
    const pureResult = findGraphCorrectionWorldModelHints(reloaded.graph as GraphFileV2, result.recordType, result.record);
    expect(pureResult.worldModelReviewHints).toEqual(result.worldModelReviewHints);
    expect(pureResult.affectedModelRefs).toEqual(result.affectedModelRefs);
  });
});
