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

  it('keeps Tactiq provider polling when poll_tool is configured', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapter = new MeetingSourceMcpAdapter({
      provider: 'tactiq',
      client: {
        callTool: async (name, args) => {
          calls.push({ name, args });
          if (name === 'custom_poll') {
            return { records: [{ id: 't-custom', title: 'Base', createdAt: '2026-10-20T01:00:00.000Z' }] };
          }
          return { structuredContent: {
            title: 'Expanded',
            detailedSummary: { status: 'ready', content: 'Summary' },
          } };
        },
      },
      config: { poll_tool: 'custom_poll' },
    });

    await expect(adapter.poll()).resolves.toEqual([expect.objectContaining({
      external_id: 't-custom',
      title: 'Expanded',
      note_text: 'Summary',
    })]);
    expect(calls).toEqual([
      { name: 'custom_poll', args: { limit: 50 } },
      { name: 'get_meeting', args: { id: 't-custom' } },
    ]);
  });

  it('keeps provider polling when provider_poll is false without a primary tool', async () => {
    const calls: string[] = [];
    const adapter = new MeetingSourceMcpAdapter({
      provider: 'plaud',
      client: {
        callTool: async (name) => {
          calls.push(name);
          if (name === 'list_files') {
            return { records: [{ id: 'p-compat', name: 'Recording', start_at: '2026-10-20T01:00:00.000Z' }] };
          }
          return { structuredContent: { markdown: name === 'get_note' ? 'Note' : 'Transcript' } };
        },
      },
      config: { provider_poll: false },
    });

    await expect(adapter.poll()).resolves.toEqual([expect.objectContaining({
      external_id: 'p-compat',
      transcript_text: 'Transcript',
      note_text: 'Note',
    })]);
    expect(calls).toEqual(['list_files', 'get_transcript', 'get_note']);
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

  it('supports an injected generic tool', async () => {
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
