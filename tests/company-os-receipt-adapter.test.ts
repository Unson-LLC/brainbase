import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPANY_OS_RECEIPT_LINK_SIDECAR,
  CompanyOsReceiptAdapterError,
  createCompanyOsReceiptAdapter,
  createOutcomeCaseReceiptSourcePort,
  type ReceiptSourceKind,
  type ReceiptSourcePort,
  type ReceiptSourceReference
} from '../src/company-os-receipt-adapter.js';
import type { OutcomeCasePort, OutcomeCaseRead } from '../src/company-os-evaluation.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const access = { principal: 'auditor-1' } as const;
const kinds: readonly ReceiptSourceKind[] = [
  'run_receipt',
  'outcome_case',
  'meeting_context_receipt',
  'decision_event'
];

function source(kind: ReceiptSourceKind, id: string, state: string, hash: string | null): ReceiptSourceReference {
  return {
    kind,
    id,
    ...(kind === 'run_receipt' ? { revision: '1' } : {}),
    hash,
    state,
    owner_refs: kind === 'decision_event'
      ? [{ status: 'unknown', reason: 'legacy_untyped' }]
      : [{ status: 'typed', ref: { id: 'project-hotel', type: 'project', revision: '3' } }]
  };
}

function makeSourcePorts(
  current: Map<string, ReceiptSourceReference>,
  options: { readonly wrongId?: string } = {}
): Partial<Record<ReceiptSourceKind, ReceiptSourcePort>> {
  return Object.fromEntries(kinds.map((kind) => [kind, {
    async read(reference, actor) {
      if (actor.principal !== access.principal) {
        throw new CompanyOsReceiptAdapterError('authorization_denied', 'current ACL denied the read');
      }
      const value = current.get(reference.id);
      if (!value) return null;
      return {
        reference: {
          ...value,
          ...(options.wrongId === reference.id ? { id: `${value.id}-different` } : {})
        }
      };
    }
  }])) as Partial<Record<ReceiptSourceKind, ReceiptSourcePort>>;
}

async function dataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-receipt-adapter-'));
  dataDirs.push(directory);
  return directory;
}

describe('company OS receipt adapter', () => {
  it('links all supported source kinds and keeps execution separate from judgment status', async () => {
    const directory = await dataDir();
    const current = new Map<string, ReceiptSourceReference>([
      ['run-1', source('run_receipt', 'run-1', 'success', 'sha256:run')],
      ['case-1', source('outcome_case', 'case-1', 'closed', null)],
      ['context-1', source('meeting_context_receipt', 'context-1', 'resolved', 'sha256:context')],
      ['event-1', source('decision_event', 'event-1', 'received', null)]
    ]);
    const adapter = createCompanyOsReceiptAdapter({
      dataDir: directory,
      sourcePorts: makeSourcePorts(current)
    });

    for (const [index, kind] of kinds.entries()) {
      const id = `${kind}-link`;
      const reference = source(kind, `${kind}-source`, kind === 'run_receipt' ? 'success' : 'recorded', index === 1 ? null : `sha256:${kind}`);
      current.set(reference.id, reference);
      const projection = await adapter.link({
        id,
        source: reference,
        judgment_refs: [
          { kind: 'problem', id: 'problem-1', revision: '2', digest: 'sha256:problem' },
          { kind: 'decision', id: `decision-${index}`, revision: '1' }
        ],
        recorded_at: '2026-09-23T00:00:00.000Z',
        access
      });

      expect(projection.link.source).toEqual(reference);
      expect(projection.link.judgment_refs[0]).toMatchObject({ kind: 'problem', id: 'problem-1' });
      expect(projection.link.objective_status).toBe('unrecorded');
      expect(projection.link.judgment_quality_status).toBe('unrecorded');
      expect(projection.source_read.reference.state).toBe(reference.state);
    }

    const list = await adapter.list(access);
    expect(list).toHaveLength(kinds.length);
    expect(list.map((item) => item.link.source.kind)).toEqual(kinds);
    expect(list.find((item) => item.link.source.kind === 'decision_event')?.link.source.owner_refs).toEqual([
      { status: 'unknown', reason: 'legacy_untyped' }
    ]);
  });

  it('preserves the recorded state and exposes a current state transition on read', async () => {
    const directory = await dataDir();
    const recorded = source('run_receipt', 'run-state-1', 'success', 'sha256:run-state');
    const current = new Map([[recorded.id, recorded]]);
    const adapter = createCompanyOsReceiptAdapter({ dataDir: directory, sourcePorts: makeSourcePorts(current) });

    await adapter.link({
      id: 'link-state-1',
      source: recorded,
      judgment_refs: [{ kind: 'evidence', id: 'artifact-1', digest: 'sha256:artifact' }],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access
    });
    current.set(recorded.id, { ...recorded, state: 'failed' });

    const projection = await adapter.read('link-state-1', access);
    expect(projection?.link.source.state).toBe('success');
    expect(projection?.source_read.reference.state).toBe('failed');
    expect(projection?.source_read.state_changed).toBe(true);
    expect(projection?.link.objective_status).toBe('unrecorded');
  });

  it('persists the canonical source snapshot and rejects a tampered snapshot envelope', async () => {
    const directory = await dataDir();
    const requested = {
      ...source('run_receipt', 'source-a', 'caller-state', null),
      revision: undefined,
      owner_refs: [{ status: 'unknown' as const, reason: 'legacy_untyped' as const }]
    };
    const canonical = {
      ...source('run_receipt', 'source-a', 'canonical-state', 'sha256:canonical'),
      revision: '7',
      conditions: { pilot: 'hotel-ai', evaluated: true }
    };
    const alternate = source('run_receipt', 'source-b', 'success', 'sha256:alternate');
    const current = new Map<string, ReceiptSourceReference>([
      [canonical.id, canonical],
      [alternate.id, alternate]
    ]);
    const adapter = createCompanyOsReceiptAdapter({ dataDir: directory, sourcePorts: makeSourcePorts(current) });

    const linked = await adapter.link({
      id: 'link-canonical-source',
      source: requested,
      judgment_refs: [],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access
    });
    expect(linked.link.source).toEqual(canonical);
    expect(linked.link.source_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(linked.source_read.state_changed).toBe(false);

    const sidecarPath = join(directory, COMPANY_OS_RECEIPT_LINK_SIDECAR);
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as {
      records: Array<{ source: ReceiptSourceReference }>;
    };
    sidecar.records[0].source = { ...sidecar.records[0].source, id: alternate.id };
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');

    await expect(adapter.read('link-canonical-source', access)).rejects.toMatchObject({ code: 'corrupt_record' });
  });

  it('fails closed when the current source stable identity changes', async () => {
    const directory = await dataDir();
    const recorded = {
      ...source('meeting_context_receipt', 'context-identity', 'resolved', 'sha256:context-identity'),
      revision: '3',
      conditions: { scope: 'pilot', channel: 'phone' }
    };
    const current = new Map<string, ReceiptSourceReference>([[recorded.id, recorded]]);
    const adapter = createCompanyOsReceiptAdapter({ dataDir: directory, sourcePorts: makeSourcePorts(current) });

    await adapter.link({
      id: 'link-identity',
      source: recorded,
      judgment_refs: [],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access
    });
    const mismatches: readonly ReceiptSourceReference[] = [
      { ...recorded, revision: '4' },
      { ...recorded, hash: 'sha256:changed' },
      { ...recorded, owner_refs: [{ status: 'unknown', reason: 'not_recorded' }] },
      { ...recorded, conditions: { scope: 'pilot', channel: 'chat' } }
    ];
    for (const mismatch of mismatches) {
      current.set(recorded.id, mismatch);
      await expect(adapter.read('link-identity', access)).rejects.toMatchObject({ code: 'integrity_mismatch' });
    }
  });

  it('fails closed before persistence for ACL denial, provider absence, and identity mismatch', async () => {
    const deniedDirectory = await dataDir();
    const deniedSource = source('decision_event', 'event-denied', 'received', null);
    const deniedAdapter = createCompanyOsReceiptAdapter({
      dataDir: deniedDirectory,
      sourcePorts: makeSourcePorts(new Map([[deniedSource.id, deniedSource]]))
    });
    await expect(deniedAdapter.link({
      id: 'link-denied',
      source: deniedSource,
      judgment_refs: [],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access: { principal: 'revoked-principal' }
    })).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(readFile(join(deniedDirectory, COMPANY_OS_RECEIPT_LINK_SIDECAR), 'utf8')).rejects.toThrow();

    const missingDirectory = await dataDir();
    const missingAdapter = createCompanyOsReceiptAdapter({ dataDir: missingDirectory, sourcePorts: {} });
    await expect(missingAdapter.link({
      id: 'link-missing',
      source: deniedSource,
      judgment_refs: [],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access
    })).rejects.toMatchObject({ code: 'source_unavailable' });
    await expect(readFile(join(missingDirectory, COMPANY_OS_RECEIPT_LINK_SIDECAR), 'utf8')).rejects.toThrow();

    const mismatchDirectory = await dataDir();
    const mismatchAdapter = createCompanyOsReceiptAdapter({
      dataDir: mismatchDirectory,
      sourcePorts: makeSourcePorts(new Map([['event-denied', deniedSource]]), { wrongId: 'event-denied' })
    });
    await expect(mismatchAdapter.link({
      id: 'link-mismatch',
      source: deniedSource,
      judgment_refs: [],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access
    })).rejects.toMatchObject({ code: 'integrity_mismatch' });
    await expect(readFile(join(mismatchDirectory, COMPANY_OS_RECEIPT_LINK_SIDECAR), 'utf8')).rejects.toThrow();
  });

  it('is idempotent for the same link and rejects a different payload for the same id', async () => {
    const directory = await dataDir();
    const recorded = source('meeting_context_receipt', 'context-idempotent', 'resolved', 'sha256:context-idempotent');
    const adapter = createCompanyOsReceiptAdapter({
      dataDir: directory,
      sourcePorts: makeSourcePorts(new Map([[recorded.id, recorded]]))
    });
    const request = {
      id: 'link-idempotent',
      source: recorded,
      judgment_refs: [{ kind: 'objective' as const, id: 'objective-1', revision: '1' }],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access
    };
    const first = await adapter.link(request);
    const second = await adapter.link(request);
    expect(second).toEqual(first);
    await expect(adapter.link({
      ...request,
      judgment_refs: [{ kind: 'objective', id: 'objective-2', revision: '1' }]
    })).rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('adapts the existing read-only OutcomeCasePort without importing its closure semantics', async () => {
    const calls: string[] = [];
    const canonicalSource = {
      state: 'canonical-closed',
      owner_refs: [{ status: 'typed' as const, ref: { id: 'project-canonical', type: 'project', revision: '9' } }],
      conditions: { closure: 'canonical' }
    };
    const outcomeCase: OutcomeCasePort = {
      async read(reference, actor) {
        calls.push(`${reference.id}:${reference.revision ?? 'latest'}:${actor.principal}`);
        return {
          reference: { id: reference.id, revision: '7', digest: 'sha256:outcome' },
          source: canonicalSource,
          acl: { ownerId: 'owner-1', visibility: 'private', readerIds: ['auditor-1'], writerIds: [] },
          scope: {
            subjectIds: ['project-hotel'],
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: '2026-12-31T23:59:59.000Z'
          }
        };
      }
    };
    const port = createOutcomeCaseReceiptSourcePort(outcomeCase);
    const reference = {
      ...source('outcome_case', 'outcome-1', 'caller-state', null),
      owner_refs: [{ status: 'unknown' as const, reason: 'legacy_untyped' as const }],
      conditions: { caller: 'untrusted' }
    };
    const projection = await port.read(reference, access);
    expect(calls).toEqual(['outcome-1:latest:auditor-1']);
    expect(projection?.reference.revision).toBe('7');
    expect(projection?.reference.hash).toBe('sha256:outcome');
    expect(projection?.reference.state).toBe('canonical-closed');
    expect(projection?.reference.owner_refs).toEqual(canonicalSource.owner_refs);
    expect(projection?.reference.conditions).toEqual(canonicalSource.conditions);
  });

  it('persists only the trusted OutcomeCase source projection and fails closed when it is absent', async () => {
    const directory = await dataDir();
    const canonicalSource = {
      state: 'canonical-closed',
      owner_refs: [{ status: 'typed' as const, ref: { id: 'project-canonical', type: 'project', revision: '9' } }],
      conditions: { closure: 'canonical' }
    };
    let currentReference = { id: 'outcome-2', revision: '7', digest: 'sha256:outcome' };
    let currentSource = canonicalSource;
    const outcomeCase: OutcomeCasePort = {
      async read(reference) {
        return {
          reference: { ...currentReference, id: reference.id },
          source: currentSource,
          acl: { ownerId: 'owner-1', visibility: 'private', readerIds: ['auditor-1'], writerIds: [] },
          scope: {
            subjectIds: ['project-hotel'],
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: '2026-12-31T23:59:59.000Z'
          }
        };
      }
    };
    const adapter = createCompanyOsReceiptAdapter({
      dataDir: directory,
      sourcePorts: { outcome_case: createOutcomeCaseReceiptSourcePort(outcomeCase) }
    });
    const requested = {
      ...source('outcome_case', 'outcome-2', 'caller-state', null),
      revision: undefined,
      owner_refs: [{ status: 'unknown' as const, reason: 'legacy_untyped' as const }]
    };
    const linked = await adapter.link({
      id: 'link-outcome-canonical',
      source: requested,
      judgment_refs: [],
      recorded_at: '2026-09-23T00:00:00.000Z',
      access
    });
    expect(linked.link.source).toEqual({
      kind: 'outcome_case',
      id: 'outcome-2',
      revision: '7',
      hash: 'sha256:outcome',
      ...canonicalSource
    });

    const identityMismatches = [
      { reference: { ...currentReference, revision: '8' } },
      { reference: { ...currentReference, digest: 'sha256:changed' } },
      { source: { ...currentSource, owner_refs: [{ status: 'unknown' as const, reason: 'not_recorded' as const }] } },
      { source: { ...currentSource, conditions: { closure: 'changed' } } }
    ] as const;
    for (const mismatch of identityMismatches) {
      if ('reference' in mismatch) currentReference = mismatch.reference;
      if ('source' in mismatch) currentSource = mismatch.source;
      await expect(adapter.read('link-outcome-canonical', access)).rejects.toMatchObject({ code: 'integrity_mismatch' });
      currentReference = { id: 'outcome-2', revision: '7', digest: 'sha256:outcome' };
      currentSource = canonicalSource;
    }

    const missingSource: OutcomeCasePort = {
      async read(reference) {
        return {
          reference: { id: reference.id, revision: '7', digest: 'sha256:outcome' },
          acl: { ownerId: 'owner-1', visibility: 'private', readerIds: ['auditor-1'], writerIds: [] },
          scope: {
            subjectIds: ['project-hotel'],
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: '2026-12-31T23:59:59.000Z'
          }
        } as unknown as OutcomeCaseRead;
      }
    };
    const missingPort = createOutcomeCaseReceiptSourcePort(missingSource);
    await expect(missingPort.read(requested, access)).rejects.toMatchObject({ code: 'source_unavailable' });
  });
});
