import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTService } from '../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../server/services/ontology-registry.js';
import { createSignedActiveOntologyFixture } from '../helpers/ontology-test-fixtures.js';

const storyId = 'story-brainbase-ontology-production-activation';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test(`${storyId} ac:1 publication outputs bind current 1.0.0 to Graph governance`, async () => {
  const index = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'config/ontology/index.json'), 'utf8'));
  const entry = index.releases.find(({ version }: { version: string }) => version === '1.0.0');
  const receipt = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'config/ontology', entry.receipt_path), 'utf8'));

  expect(index.current).toBe('1.0.0');
  expect(entry).toMatchObject({ status: 'active', source_commit_sha: 'ef12ffabd109d75d2a55d3802daa44f2160aa333' });
  expect(receipt.payload).toMatchObject({
    release_version: '1.0.0',
    decision_id: 'dec_ontology_1_0_0_activation_20260803',
    scope_entity_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H',
    proposer_entity_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
    decider_entity_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
    applier_entity_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5'
  });
});

test(`${storyId} ac:2 a trusted signed current activates the canonical write guard`, async () => {
  const fixture = createSignedActiveOntologyFixture(sourceRoot);
  try {
    const registry = new OntologyRegistry({ rootDir: fixture.rootDir, publicKeyPem: fixture.publicKeyPem });
    const service = new InfoSSOTService({ ontologyRegistry: registry });
    expect(service.getOntologyGuard()).toEqual({ guard_status: 'active_current', ontology_version: '1.0.0' });
  } finally {
    fixture.cleanup();
  }
});
