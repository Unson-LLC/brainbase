// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

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
});
