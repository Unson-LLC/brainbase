import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { graphRecordDigest } from '../src/graph-corrections.js';
import {
  createLocalWebHost,
  LOCAL_WEB_TOKEN_HEADER,
  type LocalWebExtension,
  type LocalWebMeetingMinutesStorageOptions,
} from '../src/local-web-host.js';
import type { ConstraintDefinition, FoundationRevision, ModelDefinition, ObjectiveDefinition, VariableDefinition } from '../src/ontology-foundation.js';
import { initializePersonalOs, mutatePersonalOs } from '../src/ssot.js';
import { createWorldModelStore } from '../src/world-model.js';
import { ENTITIES, writeGraphV2 } from './graph-web-fixture.js';

const TOKEN = 'local-web-test-token-0123456789';
const OWNER = { principal: 'self' };

let directory: string;
let dataDir: string;
let server: Server | null = null;

async function start(options: {
  dataDir?: string;
  extensions?: readonly LocalWebExtension[];
  meetingMinutesStorage?: LocalWebMeetingMinutesStorageOptions;
} = {}): Promise<string> {
  const host = createLocalWebHost({
    dataDir: options.dataDir ?? dataDir,
    journalRoot: join(directory, 'journal'),
    token: TOKEN,
    now: () => new Date('2026-09-26T00:00:00.000Z'),
    extensions: options.extensions,
    meetingMinutesStorage: options.meetingMinutesStorage,
  });
  server = host.server;
  await new Promise<void>((resolve) => host.server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(host.server.address() as AddressInfo).port}`;
}

async function v2DataDir(ownerId?: string): Promise<string> {
  await initializePersonalOs(dataDir);
  if (ownerId) {
    await mutatePersonalOs(dataDir, (os) => ({ ...os, graph: { ...os.graph, owner: { id: ownerId, name: 'テスト' } } }));
  }
  return dataDir;
}

function write(base: string, method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', [LOCAL_WEB_TOKEN_HEADER]: TOKEN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

// fetch() cannot override Host, so a rebound DNS name is simulated with a raw request.
function rawRequest(
  base: string,
  path: string,
  options: { host: string; method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; body: string }> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method ?? 'GET',
      headers: { Host: options.host, ...options.headers }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

function objectiveBody(id = 'objective-focus', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'objective',
    meaning: '深い仕事の時間を確保する',
    desiredState: '週に10時間、中断されない時間がある',
    beneficiaryIds: ['self'],
    criteria: [],
    evaluationPeriod: { from: '', until: '' },
    adoptionState: 'draft',
    ...overrides
  };
}

const scope = { subjectIds: ['home'], validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-12-31T23:59:59.000Z' } as const;
const acl = { ownerId: 'self', visibility: 'private', readerIds: [], writerIds: [] } as const;

const variable: VariableDefinition = {
  id: 'focus.hours',
  type: 'variable',
  revision: '1',
  meaning: '中断されない作業時間',
  epistemicState: 'supported',
  adoptionState: 'approved',
  authorizedUses: ['draft', 'judgment', 'evaluation'],
  acl,
  storage: 'ontology',
  provenance: [{ sourceId: 'calendar-1', sourceKind: 'document', evidenceIds: [] }],
  scope,
  subject: '自分の作業時間',
  valueKind: 'number',
  unit: '時間',
  aggregation: 'sum',
  granularity: 'week',
  measurementMethod: 'カレンダーの予定から集計'
};

const model: ModelDefinition = {
  id: 'model.meetings-reduce-focus',
  type: 'model',
  revision: '1',
  meaning: '会議が増えると深い仕事の時間が減る',
  epistemicState: 'hypothesis',
  adoptionState: 'proposed',
  authorizedUses: ['draft', 'judgment'],
  acl,
  storage: 'ontology',
  provenance: [{ sourceId: 'candidate-1', sourceKind: 'candidate', evidenceIds: ['note-1'] }],
  scope,
  inputVariableRefs: [{ id: 'meetings.count', type: 'variable', revision: '1' }],
  outputVariableRefs: [{ id: variable.id, type: 'variable', revision: '1' }],
  applicability: scope,
  relationship: '週の会議数が多いほど中断されない時間が減る',
  uncertainty: '会議の長さの影響はまだ分からない',
  validationState: 'in_progress'
};

function observation(id: string, value: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    variableRef: { id: variable.id, type: 'variable' as const, revision: '1' },
    subjectId: 'home',
    value,
    occurredAt: '2026-06-10T01:00:00.000Z',
    period: { from: '2026-06-08T00:00:00.000Z', until: '2026-06-14T23:59:59.000Z' },
    recordedAt: '2026-06-11T01:00:00.000Z',
    sourceRef: { sourceId: 'calendar-week-24', sourceKind: 'observation' as const, evidenceIds: ['calendar-export-24'] },
    ...extra
  };
}

function worldModelWriter() {
  const foundationStore = createFoundationRevisionStore({ dataDir });
  return createWorldModelStore({
    dataDir,
    foundationStore,
    approvalReader: { isApproved: async ({ approvalRef }) => approvalRef.id === 'decision-adopt-model' }
  });
}

async function writeSyntheticValueProof(source: Record<string, unknown>): Promise<void> {
  const sessionDir = join(directory, 'journal', 'synthetic-ux06-session');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'turn-1.value-proof.json'), JSON.stringify({
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: 'synthetic-ux06-intent',
    decision_attempt_id: 'synthetic-ux06-attempt',
    recorded_at: '2026-09-20T00:00:00.000Z',
    state: 'unconfirmed',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '架空fixtureの設定を反映してよいですか？',
      question_digest: 'sha256:synthetic-question',
      reason_code: 'routine_reversible_work',
      human_reason: null
    },
    decision: {
      summary: '架空fixtureの出典を確認できた場合だけ対象へ移動する',
      work_impact: '出典の確認結果を画面に残す',
      basis: [{
        entity_id: 'project-atlas',
        application: '架空fixtureの対象を確認する',
        layer: 'objective',
        source
      }],
      prior_learning_reused: false
    },
    execution: { status: 'completed', summary: 'fixtureを表示した', artifact_refs: [] },
    outcome: { status: 'unconfirmed', summary: null, evidence_refs: [] },
    human_decision: null,
    feedback: { status: 'none', summary: null, evidence_ref: null }
  }), 'utf8');
}

const candidate = {
  candidateId: 'candidate-1',
  hypothesis: '会議が週5件を超えると深い仕事が減る',
  evidenceIds: ['note-1'],
  acl,
  epistemicState: 'hypothesis' as const
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-local-web-'));
  dataDir = join(directory, 'personal-os');
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await rm(directory, { recursive: true, force: true });
});

describe('local web host protections', () => {
  it('lists an extension marked first before the public screens, so it opens when no screen is named', async () => {
    const uiDir = join(directory, 'first-ui');
    await mkdir(uiDir);
    await writeFile(join(uiDir, 'screen.js'), 'export const screen = { id: "lead" };');
    const extension: LocalWebExtension = {
      id: 'lead', uiDir, uiFiles: ['screen.js'], screenEntry: 'screen.js', navPosition: 'first',
      createModule: () => ({ id: 'lead', uiFiles: [], async handle() { return false; } })
    };
    const base = await start({ extensions: [extension] });
    expect(await (await fetch(`${base}/app.js`)).text()).toContain('screens: [extensionScreen0, ...LOCAL_WEB_SCREENS]');
  });

  it('mounts an allowlisted private screen and confines its API to its own prefix', async () => {
    const uiDir = join(directory, 'extension-ui');
    await mkdir(uiDir);
    await writeFile(join(uiDir, 'screen.js'), 'export const screen = { id: "example" };');
    await writeFile(join(uiDir, 'screen.css'), 'body { color: black; }');
    let calls = 0;
    const extension: LocalWebExtension = {
      id: 'example', uiDir, uiFiles: ['screen.js', 'screen.css'], screenEntry: 'screen.js',
      createModule: () => ({ id: 'example', uiFiles: [], async handle(_request, response) {
        calls += 1;
        response.end('example');
        return true;
      } })
    };
    const base = await start({ extensions: [extension] });
    const html = await (await fetch(base)).text();
    expect(html).toContain('/ui/extensions/example/screen.css');
    expect((await (await fetch(`${base}/app.js`)).text())).toContain("/ui/extensions/example/screen.js");
    expect((await (await fetch(`${base}/app.js`)).text())).toContain('screens: [...LOCAL_WEB_SCREENS, ...extensionScreens]');
    expect((await (await fetch(`${base}/app.js`)).text())).toContain("throw new Error('Invalid extension screen id')");
    expect((await fetch(`${base}/ui/extensions/example/screen.js`)).status).toBe(200);
    expect((await fetch(`${base}/ui/extensions/example/private.js`)).status).toBe(404);
    expect((await (await fetch(`${base}/api/extensions/example`)).text())).toBe('example');
    expect(calls).toBe(1);
    expect((await fetch(`${base}/api/local/status`)).status).toBe(200);
    expect((await fetch(`${base}/api/extensions/example-other`)).status).toBe(404);
    expect(calls).toBe(1);
    const rebound = await rawRequest(base, '/api/extensions/example', { host: `evil.example:${new URL(base).port}` });
    expect(rebound.status).toBe(403);
    expect(calls).toBe(1);
    expect((await fetch(`${base}/api/extensions/example`, { method: 'POST' })).status).toBe(403);
    expect(calls).toBe(1);
  });

  it('rejects invalid extension names, paths and duplicate registrations', () => {
    const extension: LocalWebExtension = {
      id: 'example', uiDir: directory, uiFiles: ['screen.js'], screenEntry: 'screen.js',
      createModule: () => ({ id: 'example', uiFiles: [], handle: async () => false })
    };
    expect(() => createLocalWebHost({ extensions: [{ ...extension, id: '../bad' }] })).toThrow(/Invalid/);
    expect(() => createLocalWebHost({ extensions: [extension, extension] })).toThrow(/duplicate/);
    expect(() => createLocalWebHost({ extensions: [{ ...extension, uiFiles: ['../private.js'] }] })).toThrow(/allowlisted/);
    expect(() => createLocalWebHost({ extensions: [{ ...extension, screenEntry: 'other.js' }] })).toThrow(/allowlisted/);
  });

  it('serves one shell with the token, a strict CSP and only allowlisted UI files', async () => {
    await v2DataDir();
    const base = await start();
    const shell = await fetch(`${base}/`);
    const csp = shell.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const html = await shell.text();
    expect(html).toContain(`<meta name="brainbase-web-token" content="${TOKEN}">`);
    expect(html.indexOf('/ui/brainbase-tokens.css')).toBeLessThan(html.indexOf('/ui/local-web-shell.css'));

    for (const file of [
      'brainbase-tokens.css', 'local-web-shell.js', 'local-web-shell.css', 'workspace-kit.js', 'workspace-kit.css', 'value-proof-review.js', 'value-proof-review.css',
      'objective-editor.js', 'objective-editor.css', 'objective-editor-http-port.js', 'world-model-view.js', 'world-model-view.css', 'project-icon.js',
      'meeting-minutes.js', 'meeting-minutes.css', 'meeting-minutes-storage.js', 'meeting-minutes-storage.css'
    ]) {
      const response = await fetch(`${base}/ui/${file}`);
      expect(response.status, file).toBe(200);
      expect(response.headers.get('content-type')).toMatch(file.endsWith('.js') ? /text\/javascript/ : /text\/css/);
    }
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    // Every module a served part imports is served too, or the page cannot start.
    for (const file of ['local-web-shell.js', 'value-proof-review.js', 'objective-editor.js', 'world-model-view.js']) {
      const source = await (await fetch(`${base}/ui/${file}`)).text();
      for (const [, imported] of source.matchAll(/from '\.\/([^']+)'/gu)) {
        expect((await fetch(`${base}/ui/${imported}`)).status, `${file} -> ${imported}`).toBe(200);
      }
    }
    for (const path of ['/ui/outcome-knowledge.js', '/ui/judgment-view.js', '/ui/', '/../package.json', '/ui/%2e%2e/package.json', '/ui/..%2Fpackage.json']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });

  it('refuses a rebound DNS name on every route, including writes, before reading or writing anything', async () => {
    await v2DataDir();
    const base = await start();
    const rebound = `evil.example:${new URL(base).port}`;
    for (const path of ['/', '/app.js', '/ui/local-web-shell.js', '/api/local/status', '/api/value-proofs/home',
      '/api/foundation/objectives', '/api/world-model/variables', '/api/world-model/observations']) {
      const response = await rawRequest(base, path, { host: rebound });
      expect(response.status, path).toBe(403);
      expect(response.body).not.toContain(TOKEN);
      expect(response.body).not.toContain(dataDir);
    }
    const created = await rawRequest(base, '/api/foundation/objectives', {
      host: rebound,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://${rebound}`, [LOCAL_WEB_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify(objectiveBody())
    });
    expect(created.status).toBe(403);
    const list = await (await fetch(`${base}/api/foundation/objectives`)).json();
    expect(list).toMatchObject({ state: 'empty', records: [], absence_confirmed: true });
  });

  it('requires the launch token and the same origin for every write', async () => {
    await v2DataDir();
    const base = await start();
    const missing = await fetch(`${base}/api/foundation/objectives`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(objectiveBody())
    });
    expect(missing.status).toBe(403);
    expect((await missing.json()).error.code).toBe('web_token_required');
    expect((await write(base, 'POST', '/api/foundation/objectives', objectiveBody(), { [LOCAL_WEB_TOKEN_HEADER]: 'wrong-token-000000000000000' })).status).toBe(403);
    const crossOrigin = await write(base, 'POST', '/api/foundation/objectives', objectiveBody(), { Origin: 'http://evil.example' });
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error.code).toBe('cross_origin_rejected');
    expect((await fetch(`${base}/api/foundation/objectives/objective-focus`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: '1', definition: objectiveBody() })
    })).status).toBe(403);
    expect((await fetch(`${base}/api/value-proofs/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent_id: 'x', decision_attempt_id: 'y', status: 'accepted' })
    })).status).toBe(403);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(403);
    const list = await (await fetch(`${base}/api/foundation/objectives`)).json();
    expect(list.records).toEqual([]);

    const sameOrigin = await write(base, 'POST', '/api/foundation/objectives', objectiveBody(), { Origin: base });
    expect(sameOrigin.status).toBe(201);
  });

  it('keeps the value-proof review of 今日 on the same host', async () => {
    await v2DataDir();
    const base = await start();
    const home = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(home).toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });
  });

  it('serves native meeting minutes from the local single-owner host and preserves idempotent writes', async () => {
    await v2DataDir();
    const base = await start();
    const payload = { title: 'ローカル会議', initial_body: '手元の議事録' };
    const created = await write(base, 'POST', '/api/meeting-minutes', payload, { 'Idempotency-Key': 'local-meeting-1' });
    expect(created.status).toBe(201);
    const first = await created.json();
    const meetingId = first.meeting.meeting_id;

    const replay = await write(base, 'POST', '/api/meeting-minutes', payload, { 'Idempotency-Key': 'local-meeting-1' });
    expect(replay.status).toBe(201);
    expect((await replay.json()).meeting.meeting_id).toBe(meetingId);

    const detail = await (await fetch(`${base}/api/meeting-minutes/${encodeURIComponent(meetingId)}`)).json();
    expect(detail.meeting.meeting_id).toBe(meetingId);
    expect(detail.versions[0]).toMatchObject({ body: '手元の議事録' });
  });

  it('connects an explicitly configured filesystem source through the shared host and preserves unavailable history', async () => {
    await v2DataDir();
    const externalRoot = join(directory, 'minutes-external');
    await mkdir(externalRoot, { recursive: true });
    await writeFile(join(externalRoot, 'minutes.md'), '外部の議事録\n', 'utf8');
    const authorizationCalls: string[] = [];
    const base = await start({
      meetingMinutesStorage: {
        filesystem: {
          root: externalRoot,
          authorize: (_context, operation) => {
            authorizationCalls.push(operation);
            return true;
          },
        },
        defaultExternal: { provider: 'filesystem', locator: 'minutes.md' },
      },
    });

    const app = await (await fetch(`${base}/app.js`)).text();
    expect(app).toContain('"provider":"filesystem","locator":"minutes.md"');
    expect(app).not.toContain(externalRoot);
    const created = await write(base, 'POST', '/api/meeting-minutes', {
      title: '外部ソース会議',
      placement: { kind: 'external', provider: 'filesystem', locator: 'minutes.md' },
    }, { 'Idempotency-Key': 'external-meeting-1' });
    expect(created.status).toBe(201);
    const createdPayload = await created.json();
    const meetingId = createdPayload.meeting.meeting_id;
    const minutesId = createdPayload.minutes[0].minutes_id;
    const versionId = createdPayload.versions.find((version: { minutes_id: string }) => version.minutes_id === minutesId).version_id;
    expect(createdPayload.versions[0].source_ref).toMatchObject({ provider: 'filesystem', locator: 'minutes.md' });

    const resolved = await fetch(`${base}/api/meeting-minutes/${encodeURIComponent(meetingId)}/minutes/${encodeURIComponent(minutesId)}/versions/${encodeURIComponent(versionId)}`);
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      placement: 'external',
      source_status: 'available',
      body: '外部の議事録\n',
    });
    expect(authorizationCalls).toEqual(expect.arrayContaining(['register', 'read']));

    await writeFile(join(externalRoot, 'minutes.md'), '更新された外部の議事録\n', 'utf8');
    const unavailable = await fetch(`${base}/api/meeting-minutes/${encodeURIComponent(meetingId)}/minutes/${encodeURIComponent(minutesId)}/versions/${encodeURIComponent(versionId)}`);
    expect(unavailable.status).toBe(200);
    const unavailablePayload = await unavailable.json();
    expect(unavailablePayload).toMatchObject({ placement: 'external', source_status: 'historical_unavailable' });
    expect(unavailablePayload).not.toHaveProperty('body');
  });
});

describe('objectives through the Foundation routes', () => {
  it('creates, reads back, refuses a stale update with the current revision and updates on Graph v2', async () => {
    await v2DataDir();
    const base = await start();

    const created = await write(base, 'POST', '/api/foundation/objectives', objectiveBody());
    expect(created.status).toBe(201);
    expect((await created.json()).ref).toMatchObject({ id: 'objective-focus', type: 'objective', revision: '1' });

    const readback = await (await fetch(`${base}/api/foundation/objectives/objective-focus`)).json();
    expect(readback.record.definition).toMatchObject({
      id: 'objective-focus',
      revision: '1',
      meaning: '深い仕事の時間を確保する',
      acl: { ownerId: 'self', visibility: 'private', readerIds: [], writerIds: [] },
      storage: 'ontology',
      authorizedUses: ['draft', 'judgment', 'evaluation'],
      scope: { subjectIds: ['self'], validFrom: '2026-09-26T00:00:00.000Z' }
    });
    expect(readback.record.definition).not.toHaveProperty('evaluationPeriod');

    const updated = await write(base, 'PUT', '/api/foundation/objectives/objective-focus', {
      expectedRevision: '1',
      definition: objectiveBody('objective-focus', { meaning: '深い仕事の時間を週10時間確保する' })
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).ref.revision).toBe('2');

    const stale = await write(base, 'PUT', '/api/foundation/objectives/objective-focus', {
      expectedRevision: '1',
      definition: objectiveBody('objective-focus', { meaning: '古い版からの上書き' })
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatchObject({ code: 'revision_conflict', currentRevision: '2' });

    const latest = await (await fetch(`${base}/api/foundation/objectives/objective-focus`)).json();
    expect(latest.record.definition).toMatchObject({ revision: '2', meaning: '深い仕事の時間を週10時間確保する' });
    expect(latest.record.definition.acl).toEqual(readback.record.definition.acl);
    const first = await (await fetch(`${base}/api/foundation/objectives/objective-focus?revision=1`)).json();
    expect(first.record.definition.meaning).toBe('深い仕事の時間を確保する');

    const list = await (await fetch(`${base}/api/foundation/objectives`)).json();
    expect(list).toMatchObject({ state: 'ready', absence_confirmed: true, unreadable: { count: 0 } });
    expect(list.records).toHaveLength(1);
    expect(list.records[0].definition.revision).toBe('2');
    expect(list.records[0].readiness).toMatchObject({ ready: false });
  });

  it('takes the principal from the Graph owner and rejects authority fields sent by the browser', async () => {
    await v2DataDir('owner-7');
    const base = await start();
    for (const field of [{ acl: { ownerId: 'mallory' } }, { principal: 'mallory' }, { authorizedUses: ['execution'] }, { scope: { subjectIds: ['x'] } }]) {
      const response = await write(base, 'POST', '/api/foundation/objectives', objectiveBody('objective-x', field));
      expect(response.status, JSON.stringify(field)).toBe(400);
      expect((await response.json()).error.code).toBe('authority_field_in_body');
    }
    expect((await write(base, 'POST', '/api/foundation/objectives', objectiveBody())).status).toBe(201);
    const envelope = await write(base, 'PUT', '/api/foundation/objectives/objective-focus', {
      expectedRevision: '1', definition: objectiveBody(), storage: 'candidate'
    });
    expect(envelope.status).toBe(400);
    const nested = await write(base, 'PUT', '/api/foundation/objectives/objective-focus', {
      expectedRevision: '1', definition: objectiveBody('objective-focus', { ownerId: 'mallory' })
    });
    expect(nested.status).toBe(400);

    const record = await (await fetch(`${base}/api/foundation/objectives/objective-focus`)).json();
    expect(record.record.definition.revision).toBe('1');
    expect(record.record.definition.acl.ownerId).toBe('owner-7');
    expect((await (await fetch(`${base}/api/foundation/objectives`)).json()).records).toHaveLength(1);
  });

  it('shows readable objectives and counts a foreign one instead of failing the whole list', async () => {
    await v2DataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const foreign: ObjectiveDefinition = {
      id: 'objective-foreign',
      type: 'objective',
      revision: '1',
      meaning: '他人の目的',
      adoptionState: 'draft',
      authorizedUses: ['draft'],
      acl: { ownerId: 'someone-else', visibility: 'private', readerIds: [], writerIds: [] },
      storage: 'ontology',
      provenance: [],
      scope: { subjectIds: ['someone-else'], validFrom: '2026-01-01T00:00:00.000Z' },
      beneficiaryIds: [],
      desiredState: '',
      criteria: [],
      evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' }
    };
    await store.create(foreign, { principal: 'someone-else' });
    const base = await start();
    expect((await write(base, 'POST', '/api/foundation/objectives', objectiveBody())).status).toBe(201);

    const list = await (await fetch(`${base}/api/foundation/objectives`)).json();
    expect(list.state).toBe('partial');
    expect(list.absence_confirmed).toBe(false);
    expect(list.unreadable).toEqual({ count: 1, codes: ['authorization_denied'] });
    expect(list.records.map((record: { definition: { id: string } }) => record.definition.id)).toEqual(['objective-focus']);
    expect(JSON.stringify(list)).not.toContain('他人の目的');
  });

  it('reads constraint links for the exact Objective revision and does not replace them from the Web', async () => {
    await v2DataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const base = await start();
    expect((await write(base, 'POST', '/api/foundation/objectives', objectiveBody())).status).toBe(201);
    const constraint: ConstraintDefinition = {
      id: 'constraint-evenings',
      type: 'constraint',
      revision: '1',
      meaning: '平日の夜は仕事を入れない',
      adoptionState: 'approved',
      authorizedUses: ['draft', 'judgment'],
      acl,
      storage: 'ontology',
      provenance: [],
      scope: { subjectIds: ['self'], validFrom: '2026-01-01T00:00:00.000Z' },
      condition: '平日19時以降',
      appliesTo: ['objective-focus'],
      exceptions: [],
      adoptionBasis: []
    };
    await store.create(constraint, OWNER);
    await store.addRelation({
      relation: 'applies_to',
      source: { id: constraint.id, type: 'constraint', revision: '1' },
      target: { id: 'objective-focus', type: 'objective', revision: '1' }
    }, OWNER);

    const refs = await (await fetch(`${base}/api/foundation/objectives/objective-focus/constraints?revision=1`)).json();
    expect(refs).toMatchObject({ state: 'ready', absence_confirmed: true });
    expect(refs.refs).toEqual([expect.objectContaining({ id: 'constraint-evenings', type: 'constraint', revision: '1', meaning: '平日の夜は仕事を入れない' })]);

    expect((await write(base, 'PUT', '/api/foundation/objectives/objective-focus', { expectedRevision: '1', definition: objectiveBody() })).status).toBe(200);
    const next = await (await fetch(`${base}/api/foundation/objectives/objective-focus/constraints`)).json();
    expect(next).toMatchObject({ state: 'empty', refs: [], absence_confirmed: true });

    const replace = await write(base, 'PUT', '/api/foundation/objectives/objective-focus/constraints', { refs: [] });
    expect(replace.status).toBe(501);
    expect((await replace.json()).error.code).toBe('api_unavailable');
  });

  it('refuses a body over the local limit', async () => {
    await v2DataDir();
    const base = await start();
    const response = await write(base, 'POST', '/api/foundation/objectives', objectiveBody('objective-big', { meaning: 'x'.repeat(70 * 1024) }));
    expect(response.status).toBe(413);
    expect((await (await fetch(`${base}/api/foundation/objectives`)).json()).records).toEqual([]);
  });
});

describe('World Model routes', () => {
  it('registers an initial variable and observation through the trusted local Web entry', async () => {
    await v2DataDir();
    const base = await start();
    const variableResponse = await write(base, 'POST', '/api/world-model/variables', {
      meaning: '架空の集中時間',
      subject: '架空の利用者',
      valueKind: 'number',
      unit: '時間',
      aggregation: 'last',
      granularity: '日',
      measurementMethod: '画面から手入力'
    });
    expect(variableResponse.status).toBe(201);
    const created = await variableResponse.json() as { reference: FoundationRevision; digest: string };
    expect(created.reference).toMatchObject({ type: 'variable', revision: '1' });
    expect(created.reference.id).toMatch(/^web\.variable\.[0-9a-f]+$/);
    expect(created.digest).toMatch(/^sha256:/);

    const observationResponse = await write(base, 'POST', '/api/world-model/observations', {
      variableRef: created.reference,
      value: 3
    });
    expect(observationResponse.status).toBe(201);
    const savedObservation = await observationResponse.json() as { observation: Record<string, unknown> };
    expect(savedObservation.observation).toMatchObject({
      variableRef: created.reference,
      subjectId: 'self',
      value: 3,
      sourceRef: { sourceId: 'brainbase-local-web', sourceKind: 'observation' }
    });
    expect(savedObservation.observation.id).toMatch(/^web\.observation\.[0-9a-f]+$/);
    expect(savedObservation.observation.sourceRef.evidenceIds).toEqual([savedObservation.observation.id]);
    expect(savedObservation.observation.occurredAt).toBe('2026-09-26T00:00:00.000Z');

    const variables = await (await fetch(`${base}/api/world-model/variables`)).json();
    expect(variables.records).toHaveLength(1);
    expect(variables.records[0].definition).toMatchObject({
      id: created.reference.id,
      meaning: '架空の集中時間',
      adoptionState: 'draft',
      acl: { ownerId: 'self', visibility: 'private' }
    });
    const observations = await (await fetch(`${base}/api/world-model/observations`)).json();
    expect(observations.observations).toHaveLength(1);
    expect(observations.observations[0]).toMatchObject({ variableRef: created.reference, subjectId: 'self', value: 3 });

    const authorityAttempt = await write(base, 'POST', '/api/world-model/variables', {
      meaning: '架空の別変数', subject: '架空の利用者', valueKind: 'number', unit: '件', aggregation: 'count',
      granularity: '日', measurementMethod: '手入力', acl: { ownerId: 'someone-else', visibility: 'public' }
    });
    expect(authorityAttempt.status).toBe(400);
    expect((await authorityAttempt.json()).error.code).toBe('authority_field_in_body');
    expect((await write(base, 'POST', '/api/world-model/models', { meaning: '架空のモデル' })).status).toBe(405);
  });

  it('lists variables and models with their epistemic state apart from observations and corrections', async () => {
    await v2DataDir();
    const writer = worldModelWriter();
    await writer.createVariable(variable, OWNER);
    await writer.createModel(model, OWNER);
    await writer.saveObservation(observation('observation-1', 6), OWNER);
    await writer.saveObservation(observation('observation-2', 7, { recordedAt: '2026-06-12T01:00:00.000Z', supersedes: 'observation-1' }), OWNER);
    const base = await start();

    const variables = await (await fetch(`${base}/api/world-model/variables`)).json();
    expect(variables).toMatchObject({ state: 'ready', absence_confirmed: true });
    expect(variables.records[0].definition).toMatchObject({ id: variable.id, revision: '1', epistemicState: 'supported' });
    const models = await (await fetch(`${base}/api/world-model/models`)).json();
    expect(models.records[0].definition).toMatchObject({ id: model.id, epistemicState: 'hypothesis', validationState: 'in_progress' });
    expect(models.records.some((record: { definition: { type: string } }) => record.definition.type !== 'model')).toBe(false);

    const observations = await (await fetch(`${base}/api/world-model/observations`)).json();
    expect(observations).toMatchObject({ state: 'ready', absence_confirmed: true });
    expect(observations.observations.map((item: { id: string; supersedes?: string }) => [item.id, item.supersedes ?? null]))
      .toEqual([['observation-1', null], ['observation-2', 'observation-1']]);
    expect(observations.observations[0]).toMatchObject({ subjectId: 'home', value: 6, occurredAt: '2026-06-10T01:00:00.000Z', recordedAt: '2026-06-11T01:00:00.000Z' });

    const adoptions = await (await fetch(`${base}/api/world-model/adoptions`)).json();
    expect(adoptions).toMatchObject({ state: 'empty', adoptions: [], absence_confirmed: true });

    expect((await write(base, 'POST', '/api/world-model/models', { meaning: '書き込み対象外' })).status).toBe(405);
    expect((await fetch(`${base}/api/world-model/unknown`)).status).toBe(404);
  });

  it('marks only the adoptions as unverifiable when an approved adoption cannot be checked', async () => {
    await v2DataDir();
    const writer = worldModelWriter();
    await writer.createVariable(variable, OWNER);
    const modelRef = await writer.createModel(model, OWNER);
    await writer.saveObservation(observation('observation-1', 6), OWNER);
    await writer.saveModelAdoption(candidate, modelRef, {
      adoptionId: 'adoption-1',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      approvalRef: { id: 'decision-adopt-model', type: 'decision', revision: '1' }
    }, OWNER);
    const base = await start();

    const adoptions = await fetch(`${base}/api/world-model/adoptions`);
    expect(adoptions.status).toBe(503);
    expect((await adoptions.json()).error.code).toBe('approval_reference_unresolved');
    expect((await fetch(`${base}/api/world-model/observations`)).status).toBe(200);
    expect((await fetch(`${base}/api/world-model/models`)).status).toBe(200);
  });

  it('shows readable variables and observations and counts the ones owned by someone else', async () => {
    await v2DataDir();
    const writer = worldModelWriter();
    await writer.createVariable(variable, OWNER);
    await writer.saveObservation(observation('observation-own', 6), OWNER);
    const other = { principal: 'someone-else' };
    const foreignVariable: VariableDefinition = { ...variable, id: 'foreign.hours', acl: { ...acl, ownerId: 'someone-else' } };
    await writer.createVariable(foreignVariable, other);
    await writer.saveObservation({ ...observation('observation-foreign', 9), variableRef: { id: 'foreign.hours', type: 'variable', revision: '1' } }, other);
    const base = await start();

    const variables = await (await fetch(`${base}/api/world-model/variables`)).json();
    expect(variables).toMatchObject({ state: 'partial', absence_confirmed: false, unreadable: { count: 1, codes: ['authorization_denied'] } });
    expect(variables.records.map((record: { definition: { id: string } }) => record.definition.id)).toEqual([variable.id]);
    const observations = await (await fetch(`${base}/api/world-model/observations`)).json();
    expect(observations).toMatchObject({ state: 'partial', absence_confirmed: false, unreadable: { count: 1, codes: ['authorization_denied'] } });
    expect(observations.observations.map((item: { id: string }) => item.id)).toEqual(['observation-own']);
  });

  it('lists a proposed adoption with its candidate basis', async () => {
    await v2DataDir();
    const writer = worldModelWriter();
    const modelRef = await writer.createModel(model, OWNER);
    await writer.saveModelAdoption(candidate, modelRef, {
      adoptionId: 'adoption-proposed',
      adoptionState: 'proposed',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z'
    }, OWNER);
    const base = await start();
    const adoptions = await (await fetch(`${base}/api/world-model/adoptions`)).json();
    expect(adoptions.state).toBe('ready');
    expect(adoptions.adoptions[0]).toMatchObject({ adoptionId: 'adoption-proposed', adoptionState: 'proposed', candidate: { hypothesis: candidate.hypothesis } });
  });
});

describe('W-20261002-UXE2E synthetic local-host boundaries', () => {
  it('confirms an empty World Model through a temporary local data directory', async () => {
    await v2DataDir();
    const base = await start();

    const variables = await (await fetch(`${base}/api/world-model/variables`)).json();
    const observations = await (await fetch(`${base}/api/world-model/observations`)).json();
    expect(variables).toMatchObject({ state: 'empty', records: [], absence_confirmed: true, unreadable: { count: 0 } });
    expect(observations).toMatchObject({ state: 'empty', observations: [], absence_confirmed: true, unreadable: { count: 0 } });
  });

  it('reads existing synthetic variables and observations instead of treating them as an empty World Model', async () => {
    await v2DataDir();
    const writer = worldModelWriter();
    await writer.createVariable(variable, OWNER);
    await writer.saveObservation(observation('synthetic-observation', 4), OWNER);
    const base = await start();

    const variables = await (await fetch(`${base}/api/world-model/variables`)).json();
    const observations = await (await fetch(`${base}/api/world-model/observations`)).json();
    expect(variables).toMatchObject({ state: 'ready', absence_confirmed: true });
    expect(variables.records).toHaveLength(1);
    expect(variables.records[0].definition).toMatchObject({ id: variable.id, meaning: variable.meaning });
    expect(observations).toMatchObject({ state: 'ready', absence_confirmed: true });
    expect(observations.observations).toHaveLength(1);
    expect(observations.observations[0]).toMatchObject({ id: 'synthetic-observation', value: 4 });
  });

  it('reports an unreadable Graph as a read failure, never as zero records', async () => {
    await v2DataDir();
    await writeFile(join(dataDir, 'graph.json'), '{"version":2,"entities":', 'utf8');
    const base = await start();

    const status = await (await fetch(`${base}/api/local/status`)).json();
    expect(status.graph).toMatchObject({ status: 'unreadable', format: null });
    expect(status.graph.message).toEqual(expect.any(String));
    const variables = await fetch(`${base}/api/world-model/variables`);
    expect(variables.status).toBe(503);
    const body = await variables.json();
    expect(body.error).toMatchObject({ code: 'personal_os_unreadable' });
    expect(body).not.toHaveProperty('records');
    expect(body).not.toHaveProperty('observations');
  });

  it('rejects synthetic World Model registration unless token and same-origin checks both pass', async () => {
    await v2DataDir();
    const base = await start();
    const registration = {
      meaning: '架空の集中時間',
      subject: '架空の利用者',
      valueKind: 'number',
      unit: '時間',
      aggregation: 'last',
      granularity: '日',
      measurementMethod: '画面から手入力'
    };

    const missingToken = await fetch(`${base}/api/world-model/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration)
    });
    expect(missingToken.status).toBe(403);
    const wrongToken = await write(base, 'POST', '/api/world-model/variables', registration, {
      [LOCAL_WEB_TOKEN_HEADER]: 'wrong-token-000000000000000'
    });
    expect(wrongToken.status).toBe(403);
    const crossOrigin = await write(base, 'POST', '/api/world-model/variables', registration, { Origin: 'http://evil.example' });
    expect(crossOrigin.status).toBe(403);
    expect((await (await fetch(`${base}/api/world-model/variables`)).json()).records).toEqual([]);

    const sameOrigin = await write(base, 'POST', '/api/world-model/variables', registration, { Origin: base });
    expect(sameOrigin.status).toBe(201);
    expect((await (await fetch(`${base}/api/world-model/variables`)).json()).records).toHaveLength(1);
  });

  it('reads a synthetic journal source and the matching Graph entity back from the same local host', async () => {
    await v2DataDir();
    await writeGraphV2(dataDir, { entities: [ENTITIES.atlas], edges: [], references: false });
    const source = {
      kind: 'local_graph',
      entity_id: ENTITIES.atlas.id,
      entity_type: ENTITIES.atlas.type,
      digest: graphRecordDigest(ENTITIES.atlas)
    };
    await writeSyntheticValueProof(source);
    const base = await start();

    const homeResponse = await fetch(`${base}/api/value-proofs/home`);
    expect(homeResponse.status).toBe(200);
    const home = await homeResponse.json();
    expect(home.status).toBe('available');
    expect(home.sections.continued[0].proof.decision.basis[0].source).toEqual(source);

    const graphResponse = await fetch(`${base}/api/graph/entities/${encodeURIComponent(ENTITIES.atlas.id)}`);
    expect(graphResponse.status).toBe(200);
    const graph = await graphResponse.json();
    expect(graph).toMatchObject({ status: 'ok', entity: { id: source.entity_id, type: source.entity_type, digest: source.digest } });
    expect(new URL(`${base}/api/graph/entities/${encodeURIComponent(source.entity_id)}`).origin).toBe(new URL(base).origin);
  });
});

describe('Graph format and data directory state', () => {
  async function v1DataDir(): Promise<string> {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'graph.json'), `${JSON.stringify({ version: 1, owner: { name: '佐藤' }, entities: [] }, null, 2)}\n`);
    await writeFile(join(dataDir, 'relationships.json'), '{\n  "version": 1,\n  "relationships": []\n}\n');
    await writeFile(join(dataDir, 'personal-kg.jsonl'), '');
    await writeFile(join(dataDir, 'decisions.jsonl'), '');
    return dataDir;
  }

  it('reports Graph v1 as migration required on every Graph-backed route and never migrates', async () => {
    await v1DataDir();
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const base = await start();

    const status = await (await fetch(`${base}/api/local/status`)).json();
    expect(status).toMatchObject({
      data_dir: dataDir,
      graph: { status: 'migration_required', format: 'v1' }
    });
    expect(status.graph.commands).toHaveLength(2);
    expect(status.graph.commands[0]).toContain('brainbase ontology:migrate --dir');
    expect(status.graph.commands[1]).toContain('--write --expected-input-digest');

    for (const path of ['/api/foundation/objectives', '/api/world-model/variables', '/api/world-model/observations', '/api/world-model/adoptions']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe('graph_migration_required');
      expect(body).not.toHaveProperty('records');
    }
    expect((await write(base, 'POST', '/api/foundation/objectives', objectiveBody())).status).toBe(503);
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
  });

  it('reports Graph v2 with the data directory, and nothing about an organization Graph (the local host never reads one)', async () => {
    await v2DataDir();
    const base = await start();
    const status = await (await fetch(`${base}/api/local/status`)).json();
    expect(status).toMatchObject({ data_dir: dataDir, graph: { status: 'ready', format: 'v2', commands: [] } });
    expect(status).not.toHaveProperty('organization_graph');
  });

  it('reports a missing data directory without creating it', async () => {
    const base = await start();
    const status = await (await fetch(`${base}/api/local/status`)).json();
    expect(status.graph).toMatchObject({ status: 'not_initialized', format: null });
    expect(status.graph.commands[0]).toContain('brainbase onboard:init --dir');
    const objectives = await fetch(`${base}/api/foundation/objectives`);
    expect(objectives.status).toBe(503);
    expect((await objectives.json()).error.code).toBe('personal_os_not_initialized');
    await expect(access(dataDir)).rejects.toThrow();
  });
});
