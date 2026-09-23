import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_ADAPTER_SIDECAR,
  LEGACY_KNOWLEDGE_ADAPTER_VERSION,
  KnowledgeAdapterError,
  type KnowledgeRecordKind,
  createKnowledgeConditionAdapter,
  type KnowledgeAdoptionReadPort,
  type LegacyKnowledgeRecordPort,
  type LegacyKnowledgeRecordRef
} from '../src/knowledge-adapter.js';
import type { DecisionAdapterConditions, DecisionAdapterContext } from '../src/decision-adapter.js';
import { initializePersonalOs, mutatePersonalOs } from '../src/ssot.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-knowledge-adapter-'));
  dataDirs.push(directory);
  await initializePersonalOs(directory);
  return directory;
}

function context(principal = 'person-1'): DecisionAdapterContext {
  return { principal };
}

function source(overrides: Partial<LegacyKnowledgeRecordRef> = {}): LegacyKnowledgeRecordRef {
  return {
    kind: 'knowledge_event',
    id: 'event-1',
    ...overrides
  };
}

function exactSource(overrides: Partial<LegacyKnowledgeRecordRef> = {}): LegacyKnowledgeRecordRef {
  return source({
    revision: '3',
    digest: `sha256:${'b'.repeat(64)}`,
    ...overrides
  });
}

function conditions(overrides: Partial<DecisionAdapterConditions> = {}): DecisionAdapterConditions {
  return {
    problem_snapshot: {
      snapshot_id: `sha256:${'a'.repeat(64)}`,
      problem_id: 'problem-1',
      revision: '4'
    },
    method: { id: 'method-1', version: '2' },
    objective_refs: [{ id: 'objective-1', type: 'objective', revision: '7' }],
    ...overrides
  };
}

function provider(
  read: LegacyKnowledgeRecordPort['read'],
): LegacyKnowledgeRecordPort {
  return { read };
}

const legacyRecordKinds: readonly KnowledgeRecordKind[] = [
  'knowledge_event',
  'knowledge_feedback',
  'candidate',
  'candidate_promotion',
  'graph_maintenance_plan',
  'human_gate_receipt',
  'graph_maintenance_receipt',
  'meeting_bridge_event',
  'meeting_bridge_candidate'
];

describe('KnowledgeConditionReferenceAdapter', () => {
  it('stores exact condition/provenance locators without copying the host knowledge body', async () => {
    const dataDir = await makeDataDir();
    const recordRead = vi.fn(async ({ source: requested }: { source: LegacyKnowledgeRecordRef }) => ({
      source_status: 'quarantined' as const,
      acl_status: 'allowed' as const,
      source: exactSource(requested),
      provenance: [{
        kind: 'meeting_transcript',
        id: 'transcript-1',
        revision: '9',
        digest: `sha256:${'c'.repeat(64)}`
      }],
      // A host provider must not make this body part of the adapter contract.
      body: 'sensitive meeting transcript body'
    }));
    const adoptionRead = vi.fn(async () => ({
      status: 'recorded' as const,
      adoption: {
        id: 'adoption-1',
        schema: 'host-adoption.v1',
        contentDigest: `sha256:${'d'.repeat(64)}`
      }
    }));
    const adapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: provider(recordRead),
      adoptionPort: { read: adoptionRead } satisfies KnowledgeAdoptionReadPort
    });

    const receipt = await adapter.attach(source(), conditions(), context());

    expect(receipt).toMatchObject({
      operation: 'created',
      source_status: 'quarantined',
      condition_status: 'recorded',
      conditions: conditions(),
      adoption_status: 'recorded',
      adoption: {
        id: 'adoption-1',
        schema: 'host-adoption.v1',
        contentDigest: `sha256:${'d'.repeat(64)}`
      }
    });
    expect(recordRead).toHaveBeenCalledWith({ source: source(), context: context() });
    expect(adoptionRead).toHaveBeenCalledWith({ source: exactSource(), context: context() });

    const sidecar = await readFile(join(dataDir, KNOWLEDGE_ADAPTER_SIDECAR), 'utf8');
    expect(sidecar).toContain('meeting_transcript');
    expect(sidecar).toContain('transcript-1');
    expect(sidecar).not.toContain('sensitive meeting transcript body');
    await expect(adapter.read(source(), context())).resolves.toMatchObject({
      condition_status: 'recorded',
      conditions: conditions(),
      provenance: [{ kind: 'meeting_transcript', id: 'transcript-1', revision: '9' }],
      adoption_status: 'recorded'
    });
  });

  it('is idempotent for the same exact source and rejects a different condition binding', async () => {
    const dataDir = await makeDataDir();
    const adapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: provider(async ({ source: requested }) => ({
        source_status: 'present' as const,
        acl_status: 'allowed' as const,
        source: exactSource(requested),
        provenance: []
      }))
    });

    const first = await adapter.attach(source(), conditions(), context());
    const retry = await adapter.attach(source(), conditions(), context());
    expect(first.binding_id).toBe(retry.binding_id);
    expect(retry.operation).toBe('existing');

    await expect(adapter.attach(source(), conditions({
      method: { id: 'method-2', version: '1' }
    }), context())).rejects.toMatchObject({ code: 'condition_conflict' });
  });

  it('keeps every named legacy entry behind the port contract across cutover and rollback', async () => {
    const dataDir = await makeDataDir();
    const routeCalls: string[] = [];
    const makeRoute = (route: string): LegacyKnowledgeRecordPort => provider(async ({ source: requested }) => {
      routeCalls.push(`${route}:${requested.kind}`);
      return {
        source_status: 'present' as const,
        acl_status: 'allowed' as const,
        source: exactSource(requested),
        provenance: [{ kind: 'legacy-entry', id: `${requested.kind}:${requested.id}` }]
      };
    });

    let activeRoute = makeRoute('primary');
    const adapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: {
        read(input) {
          return activeRoute.read(input);
        }
      }
    });

    for (const kind of legacyRecordKinds) {
      const sourceRef = { kind, id: `${kind}-1` } as const;
      await expect(adapter.attach(sourceRef, conditions(), context())).resolves.toMatchObject({
        condition_status: 'recorded',
        resolved_source: exactSource(sourceRef)
      });
      await expect(adapter.read(sourceRef, context())).resolves.toMatchObject({
        condition_status: 'recorded',
        provenance: [{ kind: 'legacy-entry', id: `${kind}:${kind}-1` }]
      });
    }

    activeRoute = makeRoute('fallback');
    await expect(adapter.read({ kind: 'meeting_bridge_event', id: 'meeting_bridge_event-1' }, context()))
      .resolves.toMatchObject({ condition_status: 'recorded' });
    activeRoute = makeRoute('primary');
    await expect(adapter.read({ kind: 'meeting_bridge_event', id: 'meeting_bridge_event-1' }, context()))
      .resolves.toMatchObject({ condition_status: 'recorded' });

    expect(routeCalls).toContain('fallback:meeting_bridge_event');
    expect(routeCalls.filter((call) => call === 'primary:meeting_bridge_event')).toHaveLength(3);
  });

  it('preserves a v1 adoption locator without reinterpreting it as a v2 locator', async () => {
    const dataDir = await makeDataDir();
    const adapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: provider(async ({ source: requested }) => ({
        source_status: 'present' as const,
        acl_status: 'allowed' as const,
        source: exactSource(requested),
        provenance: []
      }))
    });
    await adapter.attach(source(), conditions(), context());

    const sidecarPath = join(dataDir, KNOWLEDGE_ADAPTER_SIDECAR);
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as {
      version: string;
      bindings: Record<string, Record<string, unknown>>;
    };
    const key = Object.keys(sidecar.bindings)[0];
    const binding = key === undefined ? undefined : sidecar.bindings[key];
    if (!binding) throw new Error('test sidecar binding was not created');
    sidecar.version = LEGACY_KNOWLEDGE_ADAPTER_VERSION;
    binding.adoption = {
      id: 'legacy-adoption-1',
      revision: '3',
      digest: `sha256:${'e'.repeat(64)}`
    };
    await writeFile(sidecarPath, `${JSON.stringify(sidecar)}\n`, 'utf8');

    await expect(adapter.read(source(), context())).resolves.toMatchObject({
      condition_status: 'unavailable',
      adoption_status: 'unavailable'
    });
  });

  it('requires the provider to return an exact revision and digest and detects stale requested locators', async () => {
    const dataDir = await makeDataDir();
    const adapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: provider(async ({ source: requested }) => ({
        source_status: 'present' as const,
        acl_status: 'allowed' as const,
        source: { kind: requested.kind, id: requested.id, revision: '3' },
        provenance: []
      }))
    });
    await expect(adapter.attach(source(), conditions(), context())).rejects.toMatchObject({
      code: 'source_unavailable'
    });

    const staleAdapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: provider(async ({ source: requested }) => ({
        source_status: 'present' as const,
        acl_status: 'allowed' as const,
        source: exactSource(),
        provenance: []
      }))
    });
    await expect(staleAdapter.attach(exactSource({ digest: `sha256:${'e'.repeat(64)}` }), conditions(), context())).rejects.toMatchObject({
      code: 'integrity_mismatch'
    });
  });

  it('returns denied, unavailable, and not-found as distinct provider results', async () => {
    const dataDir = await makeDataDir();
    let state: 'denied' | 'unknown' | 'not_found' | 'present' | 'error' = 'denied';
    const recordPort = provider(async ({ source: requested }) => {
      if (state === 'error') throw new Error('provider unavailable');
      if (state === 'not_found') return { source_status: 'not_found' as const, acl_status: 'allowed' as const };
      if (state === 'present') return {
        source_status: 'present' as const,
        acl_status: 'allowed' as const,
        source: exactSource(requested),
        provenance: [{ kind: 'legacy', id: 'legacy-1' }]
      };
      if (state === 'unknown') return {
        source_status: 'present' as const,
        acl_status: 'unknown' as const,
        source: exactSource(requested),
        provenance: []
      };
      return { source_status: 'present' as const, acl_status: 'denied' as const };
    });
    const adapter = createKnowledgeConditionAdapter({ dataDir, recordPort });

    await expect(adapter.read(source(), context())).resolves.toMatchObject({
      source_status: 'present',
      acl_status: 'denied',
      condition_status: 'denied'
    });
    state = 'unknown';
    await expect(adapter.read(source(), context())).resolves.toMatchObject({
      source_status: 'present',
      acl_status: 'unknown',
      condition_status: 'unavailable'
    });
    state = 'not_found';
    await expect(adapter.read(source(), context())).resolves.toMatchObject({
      source_status: 'not_found',
      condition_status: 'unavailable'
    });
    state = 'present';
    await expect(adapter.read(source(), context())).resolves.toMatchObject({
      source_status: 'present',
      condition_status: 'unrecorded',
      provenance: [{ kind: 'legacy', id: 'legacy-1' }]
    });
    state = 'error';
    await expect(adapter.read(source(), context())).rejects.toMatchObject({
      code: 'source_unavailable'
    });
  });

  it('does not claim a recorded condition when the host adoption readback becomes unavailable', async () => {
    const dataDir = await makeDataDir();
    let adoptionState: 'recorded' | 'unavailable' = 'recorded';
    const adapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: provider(async ({ source: requested }) => ({
        source_status: 'present' as const,
        acl_status: 'allowed' as const,
        source: exactSource(requested),
        provenance: []
      })),
      adoptionPort: {
        read: vi.fn(async () => adoptionState === 'recorded'
          ? {
            status: 'recorded' as const,
            adoption: { id: 'adoption-1', schema: 'host-adoption.v1', contentDigest: `sha256:${'f'.repeat(64)}` }
          }
          : { status: 'unavailable' as const })
      }
    });

    await adapter.attach(source(), conditions(), context());
    adoptionState = 'unavailable';
    await expect(adapter.read(source(), context())).resolves.toMatchObject({
      condition_status: 'unavailable',
      adoption_status: 'unavailable'
    });
  });

  it('rejects a canonical aggregate change that occurs while the provider is being read', async () => {
    const dataDir = await makeDataDir();
    let releaseProvider: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let continueProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      continueProvider = resolve;
    });
    const adapter = createKnowledgeConditionAdapter({
      dataDir,
      recordPort: provider(async ({ source: requested }) => {
        releaseProvider?.();
        await providerGate;
        return {
          source_status: 'present' as const,
          acl_status: 'allowed' as const,
          source: exactSource(requested),
          provenance: []
        };
      })
    });

    const pending = adapter.attach(source(), conditions(), context());
    await providerStarted;
    await mutatePersonalOs(dataDir, (current) => ({
      ...current,
      personalKg: [...current.personalKg, { id: 'concurrent-write', type: 'value', text: 'changed' }]
    }));
    continueProvider();
    await expect(pending).rejects.toMatchObject({ code: 'condition_conflict' });
  });
});
