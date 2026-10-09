import { describe, expect, it } from 'vitest';
import {
  createTactiqTranscriptBudget,
  listMeetings,
  readProviderSummary,
  readTranscript,
  type MeetingSourceCallTool,
} from '../src/meeting-source-reader.js';

type Call = { name: string; args: Record<string, unknown> };

// MCP CallToolResult shapes as the official servers return them.
const textResult = (payload: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
const errorResult = (text: string) => ({ isError: true, content: [{ type: 'text', text }] });

function recorder(handler: (call: Call) => unknown): { callTool: MeetingSourceCallTool; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    callTool: async (name, args) => {
      const call = { name, args };
      calls.push(call);
      return handler(call);
    },
  };
}

// 120 utterances: Plaud's default page is 50, so a single call would drop most of them.
const plaudSegments = Array.from({ length: 120 }, (_, i) => ({
  content: i === 7 ? '  ' : `発話 ${i}　です。\t続き`,
  start_time: i * 1000,
  end_time: i * 1000 + 900,
  speaker: i % 3 === 0 ? ' Speaker 1 ' : (i % 3 === 1 ? '' : 'Speaker 2'),
  original_speaker: 'Orig',
  embeddingKey: null,
}));
// Computed with brainbase-unson transcriptSegmentsToText + normalizeMultilineText + sha256 (develop edca319c0).
const UNSON_DIGEST = 'd4877bb58ca45bd9d1c2956c91095c36c7cab468cc88993fd2bbd75a81dc4b6a';

function plaudTranscriptServer(segments: unknown[], pageSize = 50) {
  return recorder(({ name, args }) => {
    expect(name).toBe('get_transcript');
    const offset = args.cursor ? JSON.parse(Buffer.from(String(args.cursor), 'base64').toString()).o : 0;
    const page = segments.slice(offset, offset + pageSize);
    const next = offset + pageSize < segments.length ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64') : null;
    return textResult({ file_id: args.file_id, block: 'transaction', total: segments.length, offset, limit: pageSize, returned: page.length, next_cursor: next, segments: page });
  });
}

describe('meeting source reader: Plaud', () => {
  it('reads every page of a long transcript and matches the brainbase-unson digest (AC-01, AC-07)', async () => {
    const { callTool, calls } = plaudTranscriptServer(plaudSegments);
    const result = await readTranscript({ provider: 'plaud', callTool, meetingId: 'file-1' });

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') return;
    expect(calls).toHaveLength(3);
    expect(calls[0].args).toMatchObject({ file_id: 'file-1', block: 'transaction' });
    expect(calls[1].args.cursor).toBeTruthy();
    expect(result.segmentCount).toBe(120);
    expect(result.pageCount).toBe(3);
    expect(result.segments[119]).toEqual({ speaker: 'Speaker 2', text: '発話 119　です。\t続き', startMs: 119000, endMs: 119900 });
    expect(result.text.split('\n')).toHaveLength(119);
    expect(result.text.split('\n').slice(0, 2)).toEqual(['Speaker 1: 発話 0 です。 続き', 'Orig: 発話 1 です。 続き']);
    expect(result.digest).toBe(UNSON_DIGEST);
  });

  it('treats a transcript that stops before `total` as incomplete, not as the full text', async () => {
    const { callTool } = recorder(() => textResult({ total: 80, next_cursor: null, segments: plaudSegments.slice(0, 50) }));
    const result = await readTranscript({ provider: 'plaud', callTool, meetingId: 'file-1' });
    expect(result).toMatchObject({ status: 'unavailable', failure: { reason: 'incomplete', scope: 'meeting' } });
  });

  it('pages the date-filtered list to the end and keeps meetings at the window edges (AC-02)', async () => {
    // 2026-09-01T00:30 JST = 2026-08-31T15:30Z: inside a window that starts at 2026-08-31T15:00Z,
    // but on the previous UTC date. Widening the server-local dates keeps it.
    const files = [
      { id: 'edge-start', name: 'Early', start_at: '2026-09-01T00:30:00' },
      ...Array.from({ length: 23 }, (_, i) => ({ id: `mid-${i}`, name: `Mid ${i}`, start_at: `2026-09-0${(i % 5) + 2}T10:00:00` })),
      { id: 'too-early', name: 'Before', start_at: '2026-08-31T23:00:00' },
      { id: 'edge-end', name: 'Late', start_at: '2026-09-08T08:59:00' },
    ];
    const { callTool, calls } = recorder(({ name, args }) => {
      expect(name).toBe('list_files');
      const page = Number(args.page);
      const size = Number(args.page_size);
      return textResult({ data: files.slice((page - 1) * size, page * size) });
    });

    const result = await listMeetings({
      provider: 'plaud', callTool, since: '2026-08-31T15:00:00.000Z', until: '2026-09-08T00:00:00.000Z', plaudPageSize: 10,
    });

    expect(calls.map((call) => call.args.page)).toEqual([1, 2, 3]);
    expect(calls[0].args).toMatchObject({ date_from: '2026-08-31', date_to: '2026-09-09' });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.complete).toBe(true);
    const ids = result.meetings.map((meeting) => meeting.externalId);
    expect(ids).toContain('edge-start');
    expect(ids).toContain('edge-end');
    expect(ids).not.toContain('too-early');
    expect(ids).toHaveLength(25);
    expect(result.meetings.find((m) => m.externalId === 'edge-start')?.startedAt).toBe('2026-08-31T15:30:00.000Z');
  });

  it('returns a failure instead of an empty list when Plaud is not authenticated (AC-05)', async () => {
    const { callTool } = recorder(() => errorResult('Failed to list files: Error: Not authenticated. Please login first.'));
    const result = await listMeetings({ provider: 'plaud', callTool, since: '2026-09-01T00:00:00Z', until: '2026-09-02T00:00:00Z' });
    expect(result).toMatchObject({ status: 'failed', failure: { reason: 'reauth_required', scope: 'connection' } });
  });

  it('classifies an MCP request timeout as timeout (AC-05)', async () => {
    const callTool: MeetingSourceCallTool = async () => { throw new Error('MCP error -32001: Request timed out'); };
    const result = await readTranscript({ provider: 'plaud', callTool, meetingId: 'file-1' });
    expect(result).toMatchObject({ status: 'unavailable', failure: { reason: 'timeout', scope: 'meeting' } });
  });

  it('reports a transcript with no utterances as not_ready (AC-05)', async () => {
    const { callTool } = recorder(() => textResult({ total: 0, next_cursor: null, segments: [] }));
    const result = await readTranscript({ provider: 'plaud', callTool, meetingId: 'file-1' });
    expect(result).toMatchObject({ status: 'unavailable', failure: { reason: 'not_ready', scope: 'meeting' } });
  });

  it('keeps the provider note separate from the transcript (AC-06)', async () => {
    const { callTool, calls } = recorder(() => textResult([{ data_content: '## 要約\n決まったこと' }]));
    const summary = await readProviderSummary({ provider: 'plaud', callTool, meetingId: 'file-1' });
    expect(calls[0].name).toBe('get_note');
    expect(summary).toEqual({ status: 'ok', summary: { kind: 'provider_summary', text: '## 要約\n決まったこと' } });
    const empty = await readProviderSummary({ provider: 'plaud', callTool: async () => textResult([]), meetingId: 'file-1' });
    expect(empty).toEqual({ status: 'ok', summary: null });
  });
});

describe('meeting source reader: Tactiq', () => {
  const entries = (page: number, count: number) => Array.from({ length: count }, (_, i) => ({
    text: `page ${page} line ${i}`, speaker: i % 2 ? '佐藤圭吾' : 'Haruka Umeda', startSeconds: page * 100 + i, endSeconds: page * 100 + i,
  }));

  it('reads transcript pages until hasMore is false (AC-03)', async () => {
    const { callTool, calls } = recorder(({ args }) => {
      const page = Number(args.page);
      return { structuredContent: { page, totalPages: 2, totalChars: 1000, hasMore: page < 2, entries: entries(page, 3), url: 'https://app.tactiq.io/x' } };
    });
    const result = await readTranscript({ provider: 'tactiq', callTool, meetingId: 'm-1' });
    expect(calls.map((call) => call.args)).toEqual([{ meetingId: 'm-1', page: 1 }, { meetingId: 'm-1', page: 2 }]);
    expect(result).toMatchObject({ status: 'complete', pageCount: 2, segmentCount: 6 });
    if (result.status !== 'complete') return;
    expect(result.segments[3]).toEqual({ speaker: 'Haruka Umeda', text: 'page 2 line 0', startMs: 200000, endMs: 200000 });
    expect(result.text.split('\n')[0]).toBe('Haruka Umeda: page 1 line 0');
  });

  it('treats hasMore past totalPages as incomplete', async () => {
    const { callTool } = recorder(() => ({ structuredContent: { page: 1, totalPages: 1, hasMore: true, entries: entries(1, 2) } }));
    const result = await readTranscript({ provider: 'tactiq', callTool, meetingId: 'm-1' });
    expect(result).toMatchObject({ status: 'unavailable', failure: { reason: 'incomplete' } });
  });

  it('splits a search window that hits the 50 result limit (AC-03)', async () => {
    const since = Date.parse('2026-09-01T00:00:00Z');
    const meetings = Array.from({ length: 70 }, (_, i) => ({
      id: `m-${i}`, title: `Meeting ${i}`, createdAt: new Date(since + i * 3600_000).toISOString(), durationSeconds: 1800, attendees: ['a'], url: `https://app.tactiq.io/${i}`,
    }));
    const { callTool, calls } = recorder(({ name, args }) => {
      expect(name).toBe('search_meetings');
      const from = Date.parse(String(args.dateFrom));
      const to = Date.parse(String(args.dateTo));
      const hits = meetings.filter((m) => Date.parse(m.createdAt) >= from && Date.parse(m.createdAt) <= to);
      return { structuredContent: { results: hits.slice(0, Number(args.limit)) } };
    });
    const result = await listMeetings({ provider: 'tactiq', callTool, since: '2026-09-01T00:00:00Z', until: '2026-09-04T00:00:00Z' });
    expect(calls.length).toBeGreaterThan(1);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.complete).toBe(true);
    expect(result.meetings).toHaveLength(70);
    expect(result.meetings[0]).toMatchObject({ provider: 'tactiq', durationSeconds: 1800, participants: ['a'] });
  });

  it('marks a window still at the limit after splitting to one minute as incomplete', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ id: `same-${i}`, createdAt: '2026-09-01T00:00:00Z' }));
    const { callTool } = recorder(() => ({ structuredContent: { results: full } }));
    const result = await listMeetings({ provider: 'tactiq', callTool, since: '2026-09-01T00:00:00Z', until: '2026-09-01T00:00:30Z' });
    expect(result).toMatchObject({ status: 'ok', complete: false, incompleteWindows: [{ since: '2026-09-01T00:00:00.000Z' }] });
  });

  it('does not exceed 10 distinct transcripts per hour and does not count re-reads (AC-04)', async () => {
    let clock = Date.parse('2026-10-09T09:00:00Z');
    const now = () => new Date(clock);
    const budget = createTactiqTranscriptBudget();
    const { callTool, calls } = recorder(() => ({ structuredContent: { page: 1, totalPages: 1, hasMore: false, entries: entries(1, 1) } }));

    for (let i = 0; i < 10; i += 1) {
      expect((await readTranscript({ provider: 'tactiq', callTool, meetingId: `m-${i}`, budget, now })).status).toBe('complete');
      clock += 60_000;
    }
    expect((await readTranscript({ provider: 'tactiq', callTool, meetingId: 'm-0', budget, now })).status).toBe('complete');
    const blocked = await readTranscript({ provider: 'tactiq', callTool, meetingId: 'm-10', budget, now });
    expect(blocked).toMatchObject({ status: 'unavailable', failure: { reason: 'rate_limited', retryAt: '2026-10-09T10:00:00.000Z' } });
    expect(calls.filter((call) => call.args.meetingId === 'm-10')).toHaveLength(0);

    clock = Date.parse('2026-10-09T10:00:01Z');
    expect((await readTranscript({ provider: 'tactiq', callTool, meetingId: 'm-10', budget, now })).status).toBe('complete');
  });

  it('carries recorded reads into a new budget so limits hold across runs (AC-04)', () => {
    const now = new Date('2026-10-09T09:30:00Z');
    const reads = Array.from({ length: 10 }, (_, i) => ({ meetingId: `m-${i}`, readAt: '2026-10-09T09:00:00.000Z' }));
    const budget = createTactiqTranscriptBudget({ reads });
    expect(budget.tryAcquire('m-new', now)).toEqual({ ok: false, retryAt: '2026-10-09T10:00:00.000Z' });
    expect(budget.tryAcquire('m-3', now)).toEqual({ ok: true });
  });

  it('asks get_access_options when access is required and separates connection from preview-only (AC-05)', async () => {
    const run = async (access: Record<string, unknown>) => {
      const { callTool, calls } = recorder(({ name }) => (name === 'get_access_options'
        ? { structuredContent: { access } }
        : errorResult(JSON.stringify({ error: 'access_required', message: 'Reading meeting details requires a Team plan.' }))));
      return { result: await readTranscript({ provider: 'tactiq', callTool, meetingId: 'm-1' }), calls };
    };

    const plan = await run({ action: 'upgrade', title: 'Upgrade to Team', message: 'Full transcripts require a Team plan.', cta: 'Upgrade', url: 'https://tactiq.io/buy' });
    expect(plan.calls.map((call) => call.name)).toEqual(['get_transcript', 'get_access_options']);
    expect(plan.result).toMatchObject({
      status: 'unavailable',
      failure: { reason: 'access_required', scope: 'connection', access: { action: 'upgrade', cause: 'plan', url: 'https://tactiq.io/buy' } },
    });

    const preview = await run({ action: 'request_access', title: 'Shared as a preview', message: 'This meeting is only shared as a preview.' });
    expect(preview.result).toMatchObject({ failure: { reason: 'access_required', scope: 'meeting', access: { cause: 'preview_only' } } });
  });

  it('classifies a missing OAuth token as reauth_required (AC-05)', async () => {
    const callTool: MeetingSourceCallTool = async () => { throw new Error('tactiq MCP OAuth authorization is required: https://mcp.tactiq.io/oauth/authorize?x=1'); };
    const result = await listMeetings({ provider: 'tactiq', callTool, since: '2026-09-01T00:00:00Z', until: '2026-09-02T00:00:00Z' });
    expect(result).toMatchObject({ status: 'failed', failure: { reason: 'reauth_required', scope: 'connection' } });
  });

  it('reads the ready summary as a separate provider summary (AC-06)', async () => {
    const ready = recorder(() => ({ structuredContent: { id: 'm-1', detailedSummary: { status: 'ready', content: { markdown: 'ready summary' } } } }));
    expect(await readProviderSummary({ provider: 'tactiq', callTool: ready.callTool, meetingId: 'm-1' }))
      .toEqual({ status: 'ok', summary: { kind: 'provider_summary', text: 'ready summary' } });
    expect(ready.calls[0]).toEqual({ name: 'get_meeting', args: { meetingId: 'm-1' } });

    const generating = recorder(() => ({ structuredContent: { detailedSummary: { status: 'generating', jobId: 'j' } } }));
    expect(await readProviderSummary({ provider: 'tactiq', callTool: generating.callTool, meetingId: 'm-1' }))
      .toEqual({ status: 'ok', summary: null });
  });
});
