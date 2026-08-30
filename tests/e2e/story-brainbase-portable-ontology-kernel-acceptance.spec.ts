import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import {
  inferDecisions,
  portableOntology
} from '../../src/ontology.js';
import { auditPersonalOsDirectory } from '../../src/ontology-ssot.js';
import { callBrainbaseTool, toolDefinitions } from '../../src/server.js';
import { createFixturePersonalOs } from '../fixtures.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-ontology-e2e-'));
  dirs.push(dir);
  return dir;
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('story-brainbase-portable-ontology-kernel acceptance', () => {
  it('story-brainbase-portable-ontology-kernel ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 preserves the portable public contract end to end', async () => {
    const dir = await tempDir();
    const initOutput = capture();
    const seedOutput = capture();

    await expect(runCli(['onboard:init', '--dir', dir], initOutput.io)).resolves.toBe(0);
    await expect(runCli([
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--project', 'Portable ontology'
    ], seedOutput.io)).resolves.toBe(0);

    expect(portableOntology.version, 'story-brainbase-portable-ontology-kernel ac:1 publishes one immutable semantic release').toBe('2.0.0');
    expect(Object.keys(portableOntology.domains), 'story-brainbase-portable-ontology-kernel ac:1 covers all five ontology domains').toEqual([
      'types',
      'relations',
      'constraints',
      'inference',
      'evolution'
    ]);
    expect(portableOntology.domains.types.concepts, 'story-brainbase-portable-ontology-kernel ac:2 gives every public type an explicit meaning and usage conditions').toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: 'project',
        meaning: expect.any(String),
        usageConditions: expect.arrayContaining([expect.any(String)])
      })])
    );

    const completeAudit = await auditPersonalOsDirectory(dir);
    expect(completeAudit.status, 'story-brainbase-portable-ontology-kernel ac:3 returns stable rule-based validation for canonical local data').toBe('complete');

    const graphPath = join(dir, 'graph.json');
    await writeFile(graphPath, '{ malformed', 'utf8');
    const malformedBefore = await readFile(graphPath, 'utf8');
    const unverifiedAudit = await auditPersonalOsDirectory(dir);
    expect(unverifiedAudit, 'story-brainbase-portable-ontology-kernel ac:4 reports unavailable or malformed sources as unverified, never as zero violations').toMatchObject({
      status: 'unverified',
      violationCount: null,
      coverage: { complete: false }
    });
    expect(await readFile(graphPath, 'utf8'), 'story-brainbase-portable-ontology-kernel ac:10 audits never auto-fix, delete, or mutate canonical user data').toBe(malformedBefore);

    const invalidSnapshotDir = await tempDir();
    await createFixturePersonalOs(invalidSnapshotDir);
    const invalidGraphPath = join(invalidSnapshotDir, 'graph.json');
    const invalidGraph = JSON.parse(await readFile(invalidGraphPath, 'utf8'));
    invalidGraph.entities.push({ ...invalidGraph.entities[0] });
    await writeFile(invalidGraphPath, `${JSON.stringify(invalidGraph, null, 2)}\n`, 'utf8');
    expect(await callBrainbaseTool('infer_decisions', {
      dataDir: invalidSnapshotDir,
      asOf: '2026-08-03T00:00:00.000Z'
    }), 'story-brainbase-portable-ontology-kernel ac:5 suppresses inference whenever the complete canonical snapshot has an ontology error').toMatchObject({
      status: 'invalid',
      activeDecisionIds: [],
      violations: [expect.objectContaining({ ruleId: 'ONT-ENTITY-ID-UNIQUE' })]
    });

    const inference = inferDecisions([
      { id: 'old', title: 'Old', decision: 'Manual deploy', topic: 'deploy' },
      { id: 'new', title: 'New', decision: 'Automated deploy', topic: 'deploy', supersedes: ['old'] }
    ], { asOf: '2026-08-03T00:00:00.000Z' });
    expect(inference.supersededDecisionIds, 'story-brainbase-portable-ontology-kernel ac:5 applies only explicit supersedes edges').toEqual(['old']);
    expect(inference, 'story-brainbase-portable-ontology-kernel ac:6 returns version, as-of, evidence, and explanations with every inference').toMatchObject({
      ontologyVersion: '2.0.0',
      asOf: '2026-08-03T00:00:00.000Z',
      evidence: [expect.objectContaining({ ruleId: 'ONT-INFER-EXPLICIT-SUPERSESSION' })]
    });
    expect(inference.explanations.length).toBeGreaterThan(0);

    const conflictInference = inferDecisions([
      { id: 'choice-a', title: 'Choice A', decision: 'Use A', topic: 'runtime' },
      { id: 'choice-b', title: 'Choice B', decision: 'Use B', topic: 'runtime' }
    ], { asOf: '2026-08-03T00:00:00.000Z' });
    expect(conflictInference.activeDecisionIds, 'story-brainbase-portable-ontology-kernel ac:5 conflicting decisions are not exposed as current').toEqual([]);
    expect(conflictInference.evidence, 'story-brainbase-portable-ontology-kernel ac:5 明示的な置き換え根拠がある意思決定だけを現在有効として導出し、根拠がなければ競合を返す。').toContainEqual({
      ruleId: 'ONT-INFER-SAME-TOPIC-CONFLICT',
      topic: 'runtime',
      decisionIds: ['choice-a', 'choice-b']
    });

    expect(portableOntology.domains.evolution.compatibility[0], 'story-brainbase-portable-ontology-kernel ac:7 publishes compatibility, migration, and rollback guidance').toMatchObject({
      level: 'read-compatible-write-gated',
      migration: expect.any(String),
      rollback: expect.any(String)
    });
    expect(inferDecisions([
      { id: 'old', title: 'Old', decision: 'Manual deploy', topic: 'deploy' },
      { id: 'new', title: 'New', decision: 'Automated deploy', topic: 'deploy', supersedes: ['old'] }
    ], {
      asOf: '2026-08-03T00:00:00.000Z',
      ontologyVersion: '0.0.0'
    }), 'story-brainbase-portable-ontology-kernel ac:7 interprets historical SSOT using the rules recorded for that ontology version').toMatchObject({
      ontologyVersion: '0.0.0',
      activeDecisionIds: ['old', 'new'],
      supersededDecisionIds: []
    });
    expect(toolDefinitions.map((tool) => tool.name), 'story-brainbase-portable-ontology-kernel ac:8 keeps the original five tools while adding ontology capabilities').toEqual([
      'get_context',
      'list_entities',
      'search',
      'search_personal_kg',
      'onboarding_status',
      'brainbase_onboarding_start',
      'brainbase_onboarding_get',
      'brainbase_onboarding_ingest',
      'brainbase_onboarding_review',
      'brainbase_onboarding_first_value',
      'get_ontology',
      'audit_ontology',
      'infer_decisions',
      'ontology_impact',
      'resolve_entity',
      'brainbase_knowledge_event_record'
    ]);
    expect(JSON.stringify(portableOntology), 'story-brainbase-portable-ontology-kernel ac:9 has no Infisical, bb.unson.jp, Lightsail, AWS, or hosted-runtime dependency').not.toMatch(/infisical|bb\.unson\.jp|lightsail|aws|hosted backend/i);
  });
});
