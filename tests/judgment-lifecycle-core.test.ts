import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  buildOwnerAudit,
  buildJudgmentRequest,
  resolveLocalJudgment,
  type ConversationMessage,
  type JudgmentReceipt,
  type JudgmentRequest
} from '../src/judgment-host.js';
import {
  assertCanonicalJudgmentRequest,
  buildJudgmentOwnerAudit,
  createJudgmentLifecycleCore,
  createJudgmentToolEvent,
  normalizeJudgmentRequest,
  type JudgmentLifecycleEpisode,
  type JudgmentLifecycleFinalReceipt,
  type JudgmentLifecycleIdentity,
  type JudgmentLifecycleJournalPort,
  type JudgmentLifecyclePorts,
  type JudgmentLifecycleToolEvent
} from '../src/judgment-lifecycle-core.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const messages: ConversationMessage[] = [
  { role: 'user', turn_id: 'turn-1', text: 'OSSのResolver Hostを実装する' },
  { role: 'assistant', turn_id: 'turn-1', text: '公開用のcoreを切り出します' }
];

function request(): JudgmentRequest {
  return normalizeJudgmentRequest({
    request: 'それでいい。修正して',
    turn_id: 'turn-2',
    session_ref: digest('session-core'),
    messages,
    runtime: { host: 'codex', model: 'test-model', permission_mode: 'never', project_binding: null },
    completeness: 'complete'
  });
}

async function receiptFor(value: JudgmentRequest): Promise<JudgmentReceipt> {
  return resolveLocalJudgment(value, {
    now: () => new Date('2026-10-19T00:00:00.000Z'),
    id: () => 'receipt-core'
  });
}

class MemoryJournal implements JudgmentLifecycleJournalPort {
  episode: JudgmentLifecycleEpisode | null = null;
  events: JudgmentLifecycleToolEvent[] = [];
  final: JudgmentLifecycleFinalReceipt | null = null;

  withLock<T>(_identity: JudgmentLifecycleIdentity, operation: () => T): T {
    return operation();
  }

  readEpisode(): JudgmentLifecycleEpisode | null {
    return this.episode;
  }

  writeEpisode(episode: JudgmentLifecycleEpisode): void {
    if (this.episode && this.episode.episode_digest !== episode.episode_digest) {
      throw new Error('memory_episode_conflict');
    }
    this.episode = episode;
  }

  readEvents(): readonly JudgmentLifecycleToolEvent[] {
    return [...this.events];
  }

  appendEvent(_identity: JudgmentLifecycleIdentity, event: JudgmentLifecycleToolEvent): void {
    this.events.push(event);
  }

  readFinal(): JudgmentLifecycleFinalReceipt | null {
    return this.final;
  }

  writeFinal(final: JudgmentLifecycleFinalReceipt): void {
    if (this.final && this.final.final_digest !== final.final_digest) throw new Error('memory_final_conflict');
    this.final = final;
  }
}

function portsFor(
  journal: MemoryJournal,
  receipt: JudgmentReceipt,
  transport?: JudgmentLifecyclePorts['transport']
): JudgmentLifecyclePorts {
  return {
    journal,
    resolver: { resolve: vi.fn(async () => receipt) },
    ...(transport ? { transport } : {})
  };
}

describe('portable judgment lifecycle core', () => {
  it('normalizes the same canonical request shape as the existing Host builder', () => {
    const normalized = normalizeJudgmentRequest({
      request: 'それでいい。修正して',
      turn_id: 'turn-2',
      session_ref: digest('session-core'),
      messages,
      runtime: { host: 'codex', model: 'test-model', permission_mode: 'never', project_binding: null },
      completeness: 'complete'
    });

    expect(normalized.conversation_context.messages).toHaveLength(3);
    expect(normalized.conversation_context.messages.at(-1)).toMatchObject({
      role: 'user',
      turn_id: 'turn-2',
      text: 'それでいい。修正して'
    });
    expect(assertCanonicalJudgmentRequest(normalized)).toEqual(normalized);

    const tampered = structuredClone(normalized);
    tampered.conversation_context.messages[0].text = '改変';
    expect(() => assertCanonicalJudgmentRequest(tampered)).toThrow('judgment_context_digest_mismatch');
  });

  it('matches the existing Host builder when the Host supplies its trusted transcript', () => {
    const hostRequest = buildJudgmentRequest({
      prompt: 'それでいい。修正して',
      turn_id: 'turn-2',
      session_id: 'session-core',
      model: 'test-model',
      permission_mode: 'never',
      cwd: '/tmp'
    }, {
      env: {},
      trustedConversationMessages: messages
    });
    const portableRequest = normalizeJudgmentRequest({
      request: hostRequest.request,
      turn_id: hostRequest.turn_id,
      session_ref: hostRequest.conversation_context.session_ref,
      messages,
      runtime: hostRequest.conversation_context.runtime,
      instruction_bindings: hostRequest.conversation_context.instruction_bindings,
      completeness: hostRequest.conversation_context.completeness
    });
    expect(portableRequest).toEqual(hostRequest);
  });

  it('keeps owner audit rendering identical to the existing Host contract', async () => {
    const value = request();
    const receipt = await receiptFor(value);
    expect(buildJudgmentOwnerAudit(value, receipt)).toEqual(buildOwnerAudit(value, receipt));
  });

  it('builds deterministic event fingerprints and digests without Host I/O', () => {
    const input = {
      session_ref: 'session-ref',
      turn_id: 'turn-1',
      sequence: 1,
      recorded_at: '2026-10-19T00:00:00.000Z',
      tool_use_id: 'tool-1',
      tool_name: 'mcp__brainbase__search',
      tool_input: { query: 'resolver' },
      tool_response: { content: [{ type: 'text', text: 'ok' }] },
      audit_kind: 'search' as const,
      success: true,
      satisfies: ['knowledge.resolve'],
      display_line: '📚 Brainbase検索: 「resolver」→ 正常応答を確認 ✓'
    };
    const first = createJudgmentToolEvent(input);
    const second = createJudgmentToolEvent(input);
    expect(second).toEqual(first);
    expect(first.event_fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.event_digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('reuses an adopted episode, detects event replay/conflict, and finalizes through ports', async () => {
    const value = request();
    const receipt = await receiptFor(value);
    const journal = new MemoryJournal();
    const enqueueFinalized = vi.fn(async () => undefined);
    const ports = portsFor(journal, receipt, { enqueueFinalized });
    const resolver = ports.resolver.resolve as ReturnType<typeof vi.fn>;
    const core = createJudgmentLifecycleCore(ports);

    const firstEpisode = await core.start({ request: value, accepted_at: '2026-10-19T00:00:00.000Z' });
    const replayEpisode = await core.start({ request: value, accepted_at: '2026-10-19T00:01:00.000Z' });
    expect(replayEpisode).toEqual(firstEpisode);
    expect(resolver).toHaveBeenCalledTimes(1);

    const eventInput = {
      identity: { session_ref: value.conversation_context.session_ref, turn_id: value.turn_id },
      eligible: true,
      recorded_at: '2026-10-19T00:02:00.000Z',
      tool_use_id: 'tool-1',
      tool_name: 'mcp__brainbase__search',
      tool_input: { query: 'resolver' },
      tool_response: { content: [{ type: 'text', text: 'ok' }] },
      audit_kind: 'search' as const,
      success: true,
      satisfies: ['knowledge.resolve'],
      display_line: '📚 Brainbase検索: 「resolver」→ 正常応答を確認 ✓'
    };
    const event = await core.recordToolEvent(eventInput);
    expect(await core.recordToolEvent(eventInput)).toEqual(event);
    await expect(core.recordToolEvent({ ...eventInput, tool_response: { content: [] } }))
      .rejects.toThrow('judgment_tool_event_conflict');

    const blocked = await core.finalize({
      identity: eventInput.identity,
      finalized_at: '2026-10-19T00:03:00.000Z',
      answer: '本文',
      audit: { complete: false, line_count: 0, reason: '監査行を補ってください' }
    });
    expect(blocked).toEqual({ decision: 'block', block_kind: 'audit_repair', reason: '監査行を補ってください' });
    expect(journal.final).toBeNull();

    const final = await core.finalize({
      identity: eventInput.identity,
      finalized_at: '2026-10-19T00:04:00.000Z',
      answer: '本文',
      audit: { complete: true, line_count: 2 }
    });
    expect(final).toMatchObject({
      schema_version: 'brainbase-judgment-final-v1',
      event_count: 1,
      owner_audit_complete: true,
      owner_audit_line_count: 2
    });
    expect(await core.finalize({
      identity: eventInput.identity,
      finalized_at: '2026-10-19T00:05:00.000Z',
      answer: '本文',
      audit: { complete: true, line_count: 2 }
    })).toEqual(final);
    expect(enqueueFinalized).toHaveBeenCalledTimes(2);
  });
});

