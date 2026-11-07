import { describe, expect, it, vi } from 'vitest';
import {
  runMeetingDraftGeneration,
  type MeetingDraftGenerationInput,
  type MeetingDraftGenerationPorts,
  type MeetingDraftGenerationReceipt,
} from '../src/meeting-automation-runtime.js';

function fixture() {
  const input: MeetingDraftGenerationInput = {
    owner_id: 'person', source_id: 'source-v2', draft_id: 'draft',
    transcript_digest: 'transcript-v2', transcript: 'Alice: Review the proposal.',
    claim_token: 'attempt-2', tenant_id: 'tenant', org_id: 'org',
    project_id: 'canonical-project', project_code: 'PROJ', channel_id: null,
  };
  let saved: MeetingDraftGenerationReceipt | null = null;
  const ports = {
    authorize: vi.fn(async () => true),
    resolveContext: vi.fn(async () => ({ tenant_id: 'tenant', org_id: 'org', project_id: 'canonical-project', digest: 'context-v1', records: [] })),
    generate: vi.fn(async () => ({ body: 'Review the proposal.' })),
    validate: vi.fn(async (output: unknown) => ({ valid: true as const, draft: output })),
    saveIfCurrent: vi.fn(async (_input: MeetingDraftGenerationInput, _draft: unknown, receipt: MeetingDraftGenerationReceipt) => { saved = receipt; return receipt; }),
    readback: vi.fn(async () => saved),
  } satisfies MeetingDraftGenerationPorts<unknown>;
  return { input, ports };
}

describe('pre-generation meeting contract', () => {
  it('pins the selected input, validates and requires durable readback', async () => {
    const { input, ports } = fixture();
    ports.generate.mockImplementationOnce(async () => {
      // Changes in the caller cannot retarget an already authorized execution.
      Object.assign(input, { project_id: 'other-project' });
      return { body: 'Review the proposal.' };
    });
    const receipt = await runMeetingDraftGeneration(input, ports);
    expect(receipt.input_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(ports.saveIfCurrent.mock.calls[0][0].project_id).toBe('canonical-project');
    expect(ports.readback).toHaveBeenCalledOnce();
    expect(ports.generate).toHaveBeenCalledOnce();
    expect(ports.validate).toHaveBeenCalledOnce();
  });

  it.each(['owner_id', 'source_id', 'claim_token', 'transcript', 'project_id', 'project_code'] as const)(
    'rejects missing %s before resolving or generating', async (field) => {
      const { input, ports } = fixture();
      await expect(runMeetingDraftGeneration({ ...input, [field]: '' }, ports)).rejects.toMatchObject({ code: 'invalid_generation_input' });
      expect(ports.authorize).not.toHaveBeenCalled();
      expect(ports.generate).not.toHaveBeenCalled();
    },
  );

  it('checks all required ports before authorization or model work', async () => {
    const { input, ports } = fixture();
    await expect(runMeetingDraftGeneration(input, { ...ports, readback: undefined } as unknown as MeetingDraftGenerationPorts<unknown>))
      .rejects.toMatchObject({ code: 'invalid_ports' });
    expect(ports.authorize).not.toHaveBeenCalled();
  });

  it('does not retrieve context or generate without a current publish decision and access', async () => {
    const { input, ports } = fixture();
    ports.authorize.mockResolvedValue(false);
    await expect(runMeetingDraftGeneration(input, ports)).rejects.toMatchObject({ code: 'generation_not_authorized' });
    expect(ports.resolveContext).not.toHaveBeenCalled();
    expect(ports.generate).not.toHaveBeenCalled();
  });

  it.each(['tenant_id', 'org_id', 'project_id', 'digest'] as const)(
    'does not generate with mismatched or unverified context %s', async (field) => {
      const { input, ports } = fixture();
      ports.resolveContext.mockResolvedValue({ tenant_id: 'tenant', org_id: 'org', project_id: 'canonical-project', digest: 'context-v1', records: [], [field]: '' });
      await expect(runMeetingDraftGeneration(input, ports)).rejects.toMatchObject({ code: 'context_unavailable' });
      expect(ports.generate).not.toHaveBeenCalled();
      expect(ports.saveIfCurrent).not.toHaveBeenCalled();
    },
  );

  it('propagates generation failures without retrying through another generator', async () => {
    const { input, ports } = fixture();
    ports.generate.mockRejectedValue(new Error('model unavailable'));
    await expect(runMeetingDraftGeneration(input, ports)).rejects.toThrow('model unavailable');
    expect(ports.generate).toHaveBeenCalledOnce();
    expect(ports.saveIfCurrent).not.toHaveBeenCalled();
  });

  it('does not save invalid output', async () => {
    const { input, ports } = fixture();
    await expect(runMeetingDraftGeneration(input, { ...ports, validate: async () => ({ valid: false }) }))
      .rejects.toMatchObject({ code: 'output_invalid' });
    expect(ports.saveIfCurrent).not.toHaveBeenCalled();
  });

  it('does not report stale worker saves as successful', async () => {
    const { input, ports } = fixture();
    await expect(runMeetingDraftGeneration(input, { ...ports, saveIfCurrent: async () => null }))
      .rejects.toMatchObject({ code: 'generation_stale' });
    expect(ports.readback).not.toHaveBeenCalled();
  });

  it('rejects a missing or different durable draft', async () => {
    for (const readback of [null, { input_fingerprint: 'different', draft_fingerprint: 'different' }]) {
      const { input, ports } = fixture();
      await expect(runMeetingDraftGeneration(input, { ...ports, readback: async () => readback }))
        .rejects.toMatchObject({ code: 'readback_mismatch' });
    }
  });

  it('separates source, claim, destination and context versions in receipts', async () => {
    const first = fixture();
    const original = await runMeetingDraftGeneration(first.input, first.ports);
    for (const field of ['owner_id', 'source_id', 'transcript_digest', 'claim_token', 'project_code', 'channel_id'] as const) {
      const { input, ports } = fixture();
      const changed = await runMeetingDraftGeneration({ ...input, [field]: 'changed' }, ports);
      expect(changed.input_fingerprint).not.toBe(original.input_fingerprint);
    }
    const { input, ports } = fixture();
    ports.resolveContext.mockResolvedValue({ tenant_id: 'tenant', org_id: 'org', project_id: 'canonical-project', digest: 'context-v2', records: [] });
    expect((await runMeetingDraftGeneration(input, ports)).input_fingerprint).not.toBe(original.input_fingerprint);
  });
});
