import { type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMeetingMinutesLineageStore } from '../src/meeting-minutes-lineage.js';
import { createMeetingMinutesStore, createMeetingMinutesVersionPort } from '../src/meeting-minutes.js';
import { createLocalWebHost, LOCAL_WEB_TOKEN_HEADER } from '../src/local-web-host.js';
import { initializePersonalOs } from '../src/ssot.js';

const TOKEN = 'local-lineage-host-test-token-0123456789';
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function request(base: string, path: string, init: RequestInit = {}): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      [LOCAL_WEB_TOKEN_HEADER]: TOKEN,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return { response, body: text.length === 0 ? undefined : JSON.parse(text) };
}

describe('local web meeting-minutes lineage integration', () => {
  it('routes native saves, lineage candidates, and corrections through one host and store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-local-lineage-host-'));
    roots.push(root);
    await initializePersonalOs(root);

    const minutesStore = createMeetingMinutesStore({ data_dir: root, now: () => new Date('2026-10-06T00:00:00.000Z') });
    const lineageStore = createMeetingMinutesLineageStore({
      dataDir: root,
      minutes: createMeetingMinutesVersionPort(minutesStore),
      now: () => '2026-10-06T00:00:00.000Z',
    });
    const host = createLocalWebHost({
      dataDir: root,
      token: TOKEN,
      now: () => new Date('2026-10-06T00:00:00.000Z'),
      meetingMinutesStore: minutesStore,
      meetingMinutesLineage: {
        store: lineageStore,
        candidateDefaults: { subjectIds: ['self'] },
      },
    });
    servers.push(host.server);
    await new Promise<void>((resolve) => host.server.listen(0, '127.0.0.1', resolve));
    const address = host.server.address();
    if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
    const base = `http://127.0.0.1:${address.port}`;

    const created = await request(base, '/api/meeting-minutes', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'lineage-host-create' },
      body: JSON.stringify({ title: 'lineage host meeting', initial_body: '初版本文' }),
    });
    expect(created.response.status).toBe(201);
    const meetingId = created.body.meeting.meeting_id as string;
    const document = created.body.minutes[0] as Record<string, any>;
    const firstVersion = created.body.versions.find((version: Record<string, any>) => version.minutes_id === document.minutes_id) as Record<string, any>;
    const minutesId = document.minutes_id as string;
    const firstReference = {
      meetingId,
      minutesId,
      versionId: firstVersion.version_id,
      contentDigest: firstVersion.body_digest,
      locator: `${meetingId}/${minutesId}/${firstVersion.version_id}`,
      provenance: {
        providerKind: 'brainbase.native',
        providerId: `${meetingId}/${minutesId}`,
        revision: firstVersion.version_id,
        digest: firstVersion.body_digest,
      },
    };

    const initialLineage = await request(base, '/api/meeting-minutes-lineage/by-version', {
      method: 'POST',
      body: JSON.stringify({ reference: firstReference }),
    });
    expect(initialLineage.response.status).toBe(200);
    expect(initialLineage.body).toMatchObject({ evidence: firstReference, candidates: [], corrections: [] });

    const createdCandidate = await request(base, '/api/meeting-minutes-lineage/candidates', {
      method: 'POST',
      headers: { Origin: base, 'Idempotency-Key': 'browser-request-key' },
      body: JSON.stringify({
        id: 'lineage-task-candidate',
        idempotencyKey: 'lineage-task-candidate-op',
        actor: { type: 'person', id: 'json-attacker' },
        evidence: firstReference,
        kind: 'task',
        proposal: { task: { title: '候補タスク' } },
        epistemicStatus: 'inferred',
      }),
    });
    expect(createdCandidate.response.status).toBe(201);
    expect(createdCandidate.body.actor).toEqual({ type: 'person', id: 'self' });
    expect(createdCandidate.body.evidence).toEqual(firstReference);

    const confirmed = await request(base, '/api/meeting-minutes-lineage/candidates/lineage-task-candidate/confirm', {
      method: 'POST',
      headers: { Origin: base, 'Idempotency-Key': 'browser-confirm-key' },
      body: JSON.stringify({
        id: 'lineage-task-confirmation',
        idempotencyKey: 'lineage-task-confirmation-op',
        actor: { type: 'person', id: 'json-attacker' },
        evidenceDigest: createdCandidate.body.evidenceDigest,
      }),
    });
    expect(confirmed.response.status).toBe(201);
    expect(confirmed.body.actor).toEqual({ type: 'person', id: 'self' });

    const second = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}`, {
      method: 'POST',
      headers: { Origin: base, 'Idempotency-Key': 'lineage-host-save' },
      body: JSON.stringify({
        body: '訂正版本文',
        expected_revision: document.revision,
        predecessor_version_id: firstVersion.version_id,
      }),
    });
    expect(second.response.status).toBe(201);
    expect(second.body.lineage).toMatchObject({ status: 'recorded' });
    expect(second.body.minutes.find((row: Record<string, any>) => row.minutes_id === minutesId).current_version_id)
      .not.toBe(firstVersion.version_id);

    const afterCorrection = await request(base, '/api/meeting-minutes-lineage/by-version', {
      method: 'POST',
      body: JSON.stringify({ reference: firstReference }),
    });
    expect(afterCorrection.response.status).toBe(200);
    expect(afterCorrection.body.corrections).toHaveLength(1);
    expect(afterCorrection.body.candidates[0].reviewStatus).toBe('review_required');

    const app = await (await fetch(`${base}/app.js`)).text();
    expect(app).toContain('meetingMinutesLineage');
    expect((await fetch(`${base}/ui/meeting-minutes-lineage-http.js`)).status).toBe(200);
    expect((await fetch(`${base}/ui/meeting-minutes-lineage.css`)).status).toBe(200);
  });
});
