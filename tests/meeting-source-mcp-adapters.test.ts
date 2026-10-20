import { describe, expect, it, vi } from 'vitest';

import {
  MeetingSourceMcpAdapter,
  createMeetingSourceMcpAdapter,
  extractMeetingSourceArtifactList,
  extractMeetingSourceToolPayload,
  extractMeetingSourceToolText,
  meetingSourceArtifactInWindow,
} from '../src/meeting-source-mcp-adapters.js';

const textResult = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

describe('meeting source MCP adapters', () => {
  it('extracts the public MCP envelopes and applies the requested window', () => {
    expect(extractMeetingSourceArtifactList(textResult({ items: [{ id: 'one' }] }))).toEqual([{ id: 'one' }]);
    expect(extractMeetingSourceToolPayload(textResult({ transcript: 'hello' }))).toEqual({ transcript: 'hello' });
    expect(extractMeetingSourceToolText({ data: { text: 'hello' } })).toBe('hello');
    expect(meetingSourceArtifactInWindow('2026-10-20T01:00:00.000Z', {
      since: '2026-10-20T00:00:00.000Z',
      until: '2026-10-20T02:00:00.000Z',
    })).toBe(true);
    expect(meetingSourceArtifactInWindow('2026-10-20T03:00:00.000Z', {
      since: '2026-10-20T00:00:00.000Z',
      until: '2026-10-20T02:00:00.000Z',
    })).toBe(false);
  });

  it('keeps Tactiq list/detail behavior equivalent without owning transport or credentials', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapter = createMeetingSourceMcpAdapter({
      provider: 'tactiq',
      client: {
        callTool: async (name, args) => {
          calls.push({ name, args });
          if (name === 'list_recent_meetings') {
            return textResult({ items: [
              { id: 't-1', title: 'Inside', createdAt: '2026-10-20T01:00:00.000Z', attendees: ['a@example.test'] },
              { id: 't-old', title: 'Outside', createdAt: '2026-10-19T01:00:00.000Z' },
            ] });
          }
          return textResult({
            title: 'Inside detail',
            createdAt: '2026-10-20T01:00:00.000Z',
            detailedSummary: { status: 'ready', content: { text: 'Decision and next step' } },
            url: 'https://tactiq.test/t-1',
          });
        },
      },
    });

    const artifacts = await adapter.poll({
      since: '2026-10-20T00:00:00.000Z',
      until: '2026-10-20T02:00:00.000Z',
    });
    expect(artifacts).toEqual([expect.objectContaining({
      external_id: 't-1',
      title: 'Inside detail',
      note_text: 'Decision and next step',
      meeting_mode: 'online',
      resource_uri: 'https://tactiq.test/t-1',
    })]);
    expect(calls).toEqual([
      { name: 'list_recent_meetings', args: { limit: 50 } },
      { name: 'get_meeting', args: { id: 't-1' } },
    ]);
  });

  it('keeps Plaud transcript and note failures independent', async () => {
    const warn = vi.fn();
    const calls: string[] = [];
    const adapter = new MeetingSourceMcpAdapter({
      provider: 'plaud',
      client: {
        callTool: async (name) => {
          calls.push(name);
          if (name === 'list_files') return textResult({ data: [{ id: 'p-1', name: 'Recording', start_at: '2026-10-20T01:00:00.000Z' }] });
          if (name === 'get_transcript') throw new Error('provider response contains a secret');
          return textResult({ markdown: 'Provider note' });
        },
      },
      log: { warn },
    });

    const [artifact] = await adapter.poll({ since: '2026-10-20T00:00:00.000Z' });
    expect(artifact).toEqual(expect.objectContaining({
      external_id: 'p-1',
      transcript_text: '',
      note_text: 'Provider note',
      resource_uri: 'plaud:p-1',
      meeting_mode: 'offline',
    }));
    expect(calls).toEqual(['list_files', 'get_transcript', 'get_note']);
    expect(warn).toHaveBeenCalledWith('[meeting-source] plaud transcript fetch failed for p-1');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('provider response contains a secret');
  });

  it('supports an injected generic tool and resource fallback', async () => {
    const genericCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const generic = new MeetingSourceMcpAdapter({
      provider: 'tactiq',
      client: {
        callTool: async (name, args) => {
          genericCalls.push({ name, args });
          return { records: [{ id: 'custom-1' }] };
        },
      },
      config: { tool: 'list_custom', arguments: { account: 'fixture' } },
    });
    await expect(generic.poll({ cursor: { page: 2 }, since: '2026-10-20T00:00:00.000Z' })).resolves.toEqual([{ id: 'custom-1' }]);
    expect(genericCalls[0]).toEqual({
      name: 'list_custom',
      args: {
        account: 'fixture',
        since: '2026-10-20T00:00:00.000Z',
        until: null,
        updated_since: '2026-10-20T00:00:00.000Z',
        cursor: { page: 2 },
      },
    });

    const resources = new MeetingSourceMcpAdapter({
      provider: 'plaud',
      client: {
        callTool: async () => [],
        listResources: async () => ({ resources: [
          { uri: 'keep:1', name: 'Keep', updated_at: '2026-10-20T01:00:00.000Z' },
          { uri: 'drop:1', name: 'Drop' },
        ] }),
      },
      config: { provider_poll: false, resource_prefix: 'keep:' },
    });
    await expect(resources.poll()).resolves.toEqual([expect.objectContaining({ id: 'keep:1', provider: 'plaud' })]);
  });

  it('reports injected-client capabilities and never requires a home directory', async () => {
    const adapter = new MeetingSourceMcpAdapter({
      provider: 'tactiq',
      client: {
        callTool: async () => [],
        listTools: async () => ({ tools: [{ name: 'list_recent_meetings' }, { name: 'get_meeting' }] }),
      },
      config: { tool: 'list_custom' },
    });
    await expect(adapter.test({ provider: { cursor: {} } })).resolves.toEqual({
      ok: true,
      auth_status: 'connected',
      capabilities: ['list_recent_meetings', 'get_meeting'],
      configured_tool: 'list_custom',
    });
  });
});
