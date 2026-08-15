import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleMeetingMinutesContextToolCall,
  meetingMinutesContextTools,
} from '../src/tools/meeting-minutes-context-tools.js';

const args = {
  receipt_id: 'mmctx_123',
  run_id: 'Ev123',
  project_code: 'mana',
  transcript_sha256: 'a'.repeat(64),
};

test('dedicated tool retrieves the exact identity-bound receipt', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const receipt = {
    receipt_id: args.receipt_id,
    identity: {
      run_id: args.run_id,
      project_code: args.project_code,
      transcript_sha256: args.transcript_sha256,
    },
    status: 'resolved',
    checksum: 'b'.repeat(64),
    context: { decisions: [{ id: 'decision:1' }] },
  };
  const result = await handleMeetingMinutesContextToolCall(
    'brainbase_get_meeting_minutes_context',
    args,
    {
      apiUrl: 'https://bb.example.test/',
      getToken: async () => 'token',
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify(receipt), { status: 200 });
      },
    },
  );

  assert.equal(meetingMinutesContextTools[0]?.name, 'brainbase_get_meeting_minutes_context');
  assert.deepEqual(result, { status: 'ok', receipt });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/api\/meeting-minutes\/context-receipts\/mmctx_123\?/);
  assert.equal(new Headers(calls[0]!.init?.headers).get('authorization'), 'Bearer token');
});

test('wrong receipt identity fails closed', async () => {
  const result = await handleMeetingMinutesContextToolCall(
    'brainbase_get_meeting_minutes_context',
    args,
    {
      apiUrl: 'https://bb.example.test',
      getToken: async () => 'token',
      fetch: async () => new Response(JSON.stringify({
        receipt_id: args.receipt_id,
        identity: { ...args, receipt_id: undefined, run_id: 'different' },
        status: 'resolved',
      }), { status: 200 }),
    },
  );

  assert.equal(result?.status, 'error');
  assert.equal(result?.error?.code, 'meeting_minutes_context_identity_mismatch');
});

test('partial and unavailable receipts are returned explicitly and never coerced to empty', async () => {
  const partial = {
    receipt_id: args.receipt_id,
    identity: {
      run_id: args.run_id,
      project_code: args.project_code,
      transcript_sha256: args.transcript_sha256,
    },
    status: 'partial',
  };
  const result = await handleMeetingMinutesContextToolCall(
    'brainbase_get_meeting_minutes_context',
    args,
    {
      apiUrl: 'https://bb.example.test',
      getToken: async () => 'token',
      fetch: async () => new Response(JSON.stringify(partial), { status: 200 }),
    },
  );

  assert.deepEqual(result, { status: 'partial', receipt: partial });
});
