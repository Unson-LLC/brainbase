import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const roadmapPath = 'docs/management/milestones/brainbase-program-master-roadmap.json';
const expectedStatuses = [
  'planned',
  'contract_ready',
  'implementing',
  'verified',
  'production_proven',
  'done',
];

async function roadmap() {
  return JSON.parse(await readFile(roadmapPath, 'utf8'));
}

describe('Program external delivery reconciliation contract', () => {
  it('keeps the Program status vocabulary exact and the reconciliation contract incomplete', async () => {
    const value = await roadmap();
    assert.deepEqual(value.status_vocabulary, expectedStatuses);
    assertPartial(value.live_reconciliation.reconciliation_contract, {
      story_id: 'story-program-external-delivery-reconciliation-v1',
      status: 'contract_ready',
      production_evidence: 'not_collected',
    });
    assert.equal(value.rules.docs_only_completion, false);
  });

  it('identifies the canonical A0 producer by repository, PR, role and merge SHA', async () => {
    const value = await roadmap();
    const producer = value.live_reconciliation.artifacts.find(
      (artifact) => artifact.repository === 'Unson-LLC/brainbase-unson'
        && artifact.pull_request === 1302,
    );
    assertPartial(producer, {
      program_id: 'A0',
      role: 'producer_contract_delivery',
      state: 'MERGED_EXTERNALLY',
      program_effect: 'contract_delivery_only',
      merge: { sha: 'ad908bce7b90678f9ed7f1c570f808bdf1a500ad' },
      exit_evidence: {
        work_package: 'not_established',
        consumer: 'not_established',
        independent_review: 'not_recorded_here',
        gate: 'not_established',
        production: 'not_collected',
      },
    });
  });

  it('does not promote the stale title-matched open PR to canonical A0 producer', async () => {
    const value = await roadmap();
    const stale = value.live_reconciliation.identity_discrepancies.find(
      (candidate) => candidate.repository === 'Unson-LLC/brainbase-unson'
        && candidate.pull_request === 1283,
    );
    assertPartial(stale, {
      state: 'OPEN',
      role: 'stale_title_matched_candidate',
      supersession_evidence: 'not_collected',
    });
    assert.equal(value.live_reconciliation.artifacts.some(
      (artifact) => artifact.repository === stale.repository
        && artifact.pull_request === stale.pull_request,
    ), false);
  });

  it('binds P0 lineage to the repo-qualified A0 producer without status promotion', async () => {
    const value = await roadmap();
    const producer = value.live_reconciliation.artifacts.find((artifact) => artifact.pull_request === 1302);
    const p0 = value.live_reconciliation.artifacts.find(
      (artifact) => artifact.repository === 'Unson-LLC/brainbase-unson'
        && artifact.pull_request === 1304,
    );
    assert.equal(p0.program_effect, 'no_status_promotion');
    assertPartial(p0.source_lock_lineage, {
      upstream_repository: producer.repository,
      upstream_pull_request: producer.pull_request,
      upstream_role: 'A0 producer',
      upstream_merged_sha: producer.merge.sha,
      ancestor_verified: true,
    });
    assert.equal(p0.dependency_debt.includes(
      'A0 contract delivery #1302 does not satisfy A0 work-package, consumer, independent review, Gate or production completion',
    ), true);
  });
});

function assertPartial(actual, expected) {
  assert.ok(actual && typeof actual === 'object');
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      assertPartial(actualValue, expectedValue);
    } else {
      assert.deepEqual(actualValue, expectedValue);
    }
  }
}
