// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertLockedRunnerDescriptor } from './run-locked-vitest.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const assertContractOnlyState = ({ task, spec, story, manifest, sourceLock, storyMarkdown }) => {
  expect(task.status).toBe('contract_ready');
  expect(task.runtime_evidence).toBe('not_collected');
  expect(task.production_evidence).toBe('not_collected');
  expect(task.done).toBe(false);
  expect(task.forbidden_claims).toEqual(['verified', 'production_proven', 'release_ready', 'done']);
  expect(spec.implementation_status).toBe('contract_ready');
  expect(spec.runtime_evidence).toBe('not_collected');
  expect(spec.production_evidence).toBe('not_collected');
  expect(spec.done).toBe(false);
  expect(story.status).toBe('contract_ready');
  expect(story.production_evidence).toBe('not_collected');
  expect(story).not.toHaveProperty('runtime_evidence');
  expect(story).not.toHaveProperty('done');
  expect(manifest.contract_status).toBe('contract_ready');
  expect(manifest.production_evidence).toBe('not_collected');
  expect(manifest).not.toHaveProperty('runtime_evidence');
  expect(manifest).not.toHaveProperty('done');
  expect(sourceLock.status).toBe('contract_ready');
  expect(sourceLock.evidence_state).toEqual({ contract: 'collected', runtime: 'not_collected', production: 'not_collected' });
  expect(storyMarkdown).toMatch(/^status: contract_ready$/m);
  expect(storyMarkdown).toMatch(/^production_evidence: not_collected$/m);
  expect(storyMarkdown).toMatch(/^done: false$/m);
  expect(storyMarkdown).toContain('release/done宣言は対象外');
};

describe('P0 planning and source-lock alignment', () => {
  it('locks roadmap P0 to A0 and J0 without broadening primary implementation scope', async () => {
    const roadmap = await readJson('docs/management/milestones/brainbase-program-master-roadmap.json');
    const p0 = roadmap.work_packages.find(entry => entry.id === 'P0');
    expect(p0.hard_dependencies).toEqual(['A0']);
    expect(p0.contract_dependencies).toEqual(['J0']);
    expect(p0.repositories[0]).toBe('Unson-LLC/brainbase-unson');
  });

  it('keeps A0 and P0 at contract_ready and production evidence not_collected', async () => {
    const lock = await readJson('contracts/p0-negative-boundary-contract-v1/source-lock.json');
    const task = await readJson('docs/management/tasks/p0-negative-boundary-contract-v1.json');
    expect(lock.upstream.merged_sha).toBe('ad908bce7b90678f9ed7f1c570f808bdf1a500ad');
    expect(lock.upstream.contract_id).toBe('mana-brainbase-company-authority/v1');
    expect(lock.upstream.contract_version).toBe('1.0.0');
    expect(lock.upstream.fixture_set_sha256).toBe('1d7af5b850abeb10e07db281c17341636d80a74cb37679b2c2b6ab5ce9b0a6ea');
    expect(lock.status).toBe('contract_ready');
    expect(task.status).toBe('contract_ready');
    expect(task.production_evidence).toBe('not_collected');
    expect(task.done).toBe(false);
  });

  it('rejects AC-009 contract-only state drift across planning artifacts', async () => {
    const state = {
      task: await readJson('docs/management/tasks/p0-negative-boundary-contract-v1.json'),
      spec: await readJson('.vibepro/spec/story-p0-negative-boundary-contract-v1/spec.json'),
      story: await readJson('.vibepro/stories/story-p0-negative-boundary-contract-v1/story.json'),
      manifest: await readJson('contracts/p0-negative-boundary-contract-v1/manifest.json'),
      sourceLock: await readJson('contracts/p0-negative-boundary-contract-v1/source-lock.json'),
      storyMarkdown: await readFile('docs/management/stories/active/story-p0-negative-boundary-contract-v1.md', 'utf8')
    };
    expect(() => assertContractOnlyState(state)).not.toThrow();
    const drifts = [
      value => { value.task.runtime_evidence = 'collected'; },
      value => { value.spec.done = true; },
      value => { value.story.status = 'verified'; },
      value => { value.manifest.contract_status = 'release_ready'; },
      value => { value.sourceLock.evidence_state.runtime = 'collected'; },
      value => { value.storyMarkdown = value.storyMarkdown.replace('done: false', 'done: true'); },
      value => { value.task.forbidden_claims = value.task.forbidden_claims.filter(claim => claim !== 'release_ready'); }
    ];
    for (const mutate of drifts) {
      const drifted = structuredClone(state);
      mutate(drifted);
      expect(() => assertContractOnlyState(drifted)).toThrow();
    }
  });

  it('connects all nine Story ACs to machine-readable clauses and multi-tenant planning', async () => {
    const spec = await readJson('.vibepro/spec/story-p0-negative-boundary-contract-v1/spec.json');
    const story = await readJson('.vibepro/stories/story-p0-negative-boundary-contract-v1/story.json');
    const acIds = spec.clauses.flatMap(clause => clause.origin.story_refs.map(ref => ref.ac_id));
    expect(new Set(acIds)).toEqual(new Set(Array.from({length:9}, (_, index) => `AC-${String(index + 1).padStart(3, '0')}`)));
    expect(story.acceptance_criteria.map(ac => ac.id)).toEqual(Array.from({length:9}, (_, index) => `AC-${String(index + 1).padStart(3, '0')}`));
    expect(story.acceptance_criteria.every(ac => ac.source && ac.test && ac.evidence)).toBe(true);
    for (const clause of spec.clauses) {
      expect(clause.origin.code_refs.length).toBeGreaterThan(0);
      expect(clause.origin.test_refs.length).toBeGreaterThan(0);
    }
    expect(spec.multi_tenancy.tenant_identity).toMatchObject({canonical_key:'source_tenant',missing_behavior:'deny',ambiguity_behavior:'deny'});
    expect(spec.multi_tenancy.credentials.cross_tenant_fallback).toBe('forbidden');
    expect(spec.production_evidence).toBe('not_collected');
  });

  it('pins the focused runner to package-lock without an arbitrary AJV override', async () => {
    const lock = await readJson('package-lock.json');
    const config = await readFile('.vibepro/spec/story-p0-negative-boundary-contract-v1/vitest.config.mjs', 'utf8');
    expect(lock.packages['node_modules/vitest'].version).toBe('4.0.16');
    expect(lock.packages['node_modules/ajv'].version).toBe('8.17.1');
    expect(config).not.toContain('P0_AJV_2020');
    expect(config).not.toContain('resolve:');
    expect(config).not.toContain('alias:');
  });

  it('rejects npx, cache, temp and package-lock drift before the focused runner starts', async () => {
    const contract = await readJson('contracts/p0-negative-boundary-contract-v1/locked-runner.json');
    const canonical = {
      command: ['/usr/bin/node', '/repo/node_modules/vitest/vitest.mjs', 'run'],
      install_root: '/repo',
      node_modules_root: '/repo/node_modules',
      package_lock_sha256: contract.package_lock_sha256,
      installed_package_lock_sha256: contract.package_lock_sha256,
      runner_path: '/repo/node_modules/vitest/vitest.mjs',
      runner_bin_path: '/repo/node_modules/vitest/vitest.mjs',
      runner_version: contract.runner.version,
      runner_lock_version: contract.runner.version,
      runner_lock_integrity: contract.runner.lock_integrity,
      runner_package_sha256: contract.runner.package_sha256,
      runner_entrypoint_sha256: contract.runner.entrypoint_sha256,
      ajv_path: '/repo/node_modules/ajv/dist/2020.js',
      ajv_version: contract.schema_validator.version,
      ajv_lock_version: contract.schema_validator.version,
      ajv_lock_integrity: contract.schema_validator.lock_integrity,
      ajv_package_sha256: contract.schema_validator.package_sha256,
      ajv_entrypoint_sha256: contract.schema_validator.entrypoint_sha256,
      network_acquisition: false,
      contract
    };
    expect(() => assertLockedRunnerDescriptor(canonical)).not.toThrow();
    const drifts = [
      value => { value.command = ['npx', 'vitest', 'run']; },
      value => { value.install_root = '/Users/test/.npm/_npx/cache'; },
      value => { value.install_root = '/private/tmp/p0-runner'; },
      value => { value.installed_package_lock_sha256 = '0'.repeat(64); },
      value => { value.runner_version = '4.1.11'; },
      value => { value.runner_path = '/Users/test/.npm/_npx/node_modules/vitest/vitest.mjs'; },
      value => { value.runner_entrypoint_sha256 = '0'.repeat(64); },
      value => { value.ajv_version = '8.16.0'; }
    ];
    for (const mutate of drifts) {
      const drifted = structuredClone(canonical);
      mutate(drifted);
      expect(() => assertLockedRunnerDescriptor(drifted)).toThrow();
    }
  });

  it('rejects VibePro command bypass, non-authoritative metadata and incomplete content binding', async () => {
    const contract = await readJson('contracts/p0-negative-boundary-contract-v1/locked-runner.json');
    const expectedArgv = ['node', '--test', 'tests/contracts/p0-negative-boundary-contract-v1/locked-runner.test.mjs'];
    const expectedTargets = [
      'tests/contracts/p0-negative-boundary-contract-v1/contract.test.js',
      'tests/contracts/p0-negative-boundary-contract-v1/planning-source-lock.test.js',
      'tests/contracts/p0-negative-boundary-contract-v1/locked-runner.test.mjs',
      'tests/contracts/p0-negative-boundary-contract-v1/run-locked-vitest.mjs',
      'contracts/p0-negative-boundary-contract-v1/locked-runner.json'
    ];
    expect(contract.vibepro_verification).toEqual({
      argv: expectedArgv,
      metadata_prefix: 'P0_LOCKED_RUNNER_METADATA=',
      cleanup_prefix: 'P0_LOCKED_RUNNER_CLEANUP=',
      content_binding_targets: expectedTargets
    });
    for (const mutate of [
      value => { value.argv = ['npm', 'run', 'test:run']; },
      value => { value.metadata_prefix = 'AGENT_OBSERVATION='; },
      value => { value.content_binding_targets = value.content_binding_targets.filter(path => !path.endsWith('locked-runner.json')); },
      value => { value.content_binding_targets = value.content_binding_targets.filter(path => !path.endsWith('run-locked-vitest.mjs')); }
    ]) {
      const drifted = structuredClone(contract.vibepro_verification);
      mutate(drifted);
      expect(drifted).not.toEqual(contract.vibepro_verification);
    }
  });

  it('keeps the public verification command on the descriptor-locked outer runner', async () => {
    const contract = await readJson('contracts/p0-negative-boundary-contract-v1/locked-runner.json');
    const publicSpec = await readFile('docs/specs/p0-negative-boundary-contract-v1.md', 'utf8');
    const expectedCommand = `\`${contract.vibepro_verification.argv.join(' ')}\``;
    const verificationSection = publicSpec.split('## 検証')[1];

    expect(verificationSection).toBeDefined();
    expect(verificationSection).toContain('VibePro verification専用経路');
    expect(verificationSection).toContain('P0_LOCK_INSTALL_ROOT');
    expect(verificationSection).toContain('fail closed');
    expect(verificationSection).toContain('network acquisitionは行わない');
    expect(verificationSection).toContain(expectedCommand.slice(1, -1));
    expect(verificationSection).toContain('${P0_LOCK_INSTALL_ROOT:?');
    expect(verificationSection).not.toContain('npm run test:run');
  });
});
