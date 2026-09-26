import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GRAPH_CORRECTIONS_FILE, graphRecordDigest } from '../src/graph-corrections.js';
import { createGraphWebHttpHandler, type GraphWebHttpOptions } from '../src/graph-web-http.js';
import { EDGES, ENTITIES, FIXTURE_NOW, writeGraphV1, writeGraphV2 } from './graph-web-fixture.js';

let root: string;
let dataDir: string;
let server: Server | null = null;
const guardCalls: string[] = [];

const allowWrites = async (request: IncomingMessage): Promise<void> => {
  guardCalls.push(String(request.headers['x-test-token'] ?? ''));
  if (request.headers['x-test-token'] !== 'launch-token') {
    throw Object.assign(new Error('A valid launch token is required'), { statusCode: 403, code: 'launch_token_required' });
  }
};

async function start(options: Partial<GraphWebHttpOptions> = {}): Promise<string> {
  const handler = createGraphWebHttpHandler({ dataDir, now: () => FIXTURE_NOW, assertWriteAllowed: allowWrites, ...options });
  server = createServer((request, response) => {
    void handler(request, response).then((handled) => {
      if (handled) return;
      response.statusCode = 404;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: { code: 'host_not_found', message: 'not handled by the graph handler' } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function postCorrection(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/api/graph/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-Token': 'launch-token', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

const roleCorrection = {
  kind: 'update_edge',
  edgeId: EDGES.tanakaAtlas.id,
  expectedDigest: graphRecordDigest(EDGES.tanakaAtlas),
  reason: '役割は技術顧問だった。',
  changes: { role: '技術顧問' }
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brainbase-graph-web-http-'));
  dataDir = join(root, 'personal-os');
  guardCalls.length = 0;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await rm(root, { recursive: true, force: true });
});

describe('local Graph web HTTP handler', () => {
  it('serves every read route as uncached JSON from the host-chosen data directory', async () => {
    await writeGraphV2(dataDir);
    const base = await start();

    const status = await fetch(`${base}/api/graph/status`);
    expect(status.status).toBe(200);
    expect(status.headers.get('cache-control')).toBe('no-store');
    expect(await status.json()).toMatchObject({ status: 'ok', source: { dataDir, graphFormat: 2 }, counts: { entities: { total: 8 }, edges: { total: 5 } } });

    const projects = await (await fetch(`${base}/api/graph/projects`)).json();
    expect(projects.projects.map((project: { id: string }) => project.id)).toEqual(['project-atlas', 'project-beta']);

    const project = await (await fetch(`${base}/api/graph/projects/${encodeURIComponent('project-atlas')}`)).json();
    expect(project.participants).toHaveLength(2);

    const search = await (await fetch(`${base}/api/graph/search?q=${encodeURIComponent('佐藤')}&type=person&as_of=2026-09-26T00:00:00Z`)).json();
    expect(search).toMatchObject({ status: 'ok', query: { q: '佐藤', type: 'person', asOf: '2026-09-26T00:00:00Z' }, absenceConfirmed: false });
    expect(search.results.map((entity: { id: string }) => entity.id)).toEqual(['person-sato']);

    const none = await (await fetch(`${base}/api/graph/search?q=zzz`)).json();
    expect(none).toMatchObject({ results: [], absenceConfirmed: true, graphEmpty: false });

    const entity = await (await fetch(`${base}/api/graph/entities/person-tanaka`)).json();
    expect(entity.entity.digest).toBe(graphRecordDigest(ENTITIES.tanaka));
    expect(entity.outgoing.map((edge: { relation: string }) => edge.relation)).toEqual(['member_of', 'participates_in']);

    const ontology = await (await fetch(`${base}/api/graph/ontology`)).json();
    expect(ontology.relations.find((relation: { id: string }) => relation.id === 'participates_in')).toMatchObject({ count: 2, activeCount: 1 });
  });

  it('answers errors as JSON and leaves unknown paths, such as the organization search, to the host', async () => {
    await writeGraphV2(dataDir);
    const base = await start();
    expect((await fetch(`${base}/api/graph/projects/person-tanaka`)).status).toBe(404);
    const badQuery = await fetch(`${base}/api/graph/search?type=relationship`);
    expect(badQuery.status).toBe(400);
    expect(await badQuery.json()).toMatchObject({ error: { code: 'invalid_query' } });
    expect((await fetch(`${base}/api/graph/search?limit=abc`)).status).toBe(400);
    const postRead = await fetch(`${base}/api/graph/projects`, { method: 'POST' });
    expect(postRead.status).toBe(405);
    expect(postRead.headers.get('allow')).toBe('GET');
    expect((await fetch(`${base}/api/graph/corrections`)).status).toBe(405);
    const organization = await fetch(`${base}/api/graph/organization/search?q=x`);
    expect(organization.status).toBe(404);
    expect(await organization.json()).toMatchObject({ error: { code: 'host_not_found' } });
    expect((await fetch(`${base}/api/other`)).status).toBe(404);
  });

  it('reports Graph v1 as migration required on every read route and refuses corrections', async () => {
    await writeGraphV1(dataDir);
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const base = await start();
    for (const path of ['status', 'projects', 'projects/project-legacy', 'search?q=Legacy', 'entities/person-legacy', 'ontology']) {
      const response = await fetch(`${base}/api/graph/${path}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: 'migration_required', source: { graphFormat: 1 }, absenceConfirmed: false });
      expect(body.command).toContain('ontology:migrate');
    }
    const correction = await postCorrection(base, { ...roleCorrection, edgeId: 'x' });
    expect(correction.status).toBe(409);
    expect(await correction.json()).toMatchObject({ error: { code: 'migration_required' } });
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
  });

  it('returns a read failure as 503 instead of an empty list', async () => {
    await writeGraphV2(dataDir);
    await writeFile(join(dataDir, 'graph.json'), '{ broken');
    const base = await start();
    const response = await fetch(`${base}/api/graph/projects`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'graph_unavailable' } });
  });

  it('refuses every write when the host provides no write protection', async () => {
    await writeGraphV2(dataDir);
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const base = await start({ assertWriteAllowed: undefined });
    const response = await postCorrection(base, roleCorrection);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'write_protection_missing' } });
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
  });

  it('checks write protection before reading the body and returns the host refusal', async () => {
    await writeGraphV2(dataDir);
    const base = await start();
    const oversized = JSON.stringify({ ...roleCorrection, reason: 'x'.repeat(20 * 1024) });
    const refused = await postCorrection(base, oversized, { 'X-Test-Token': 'wrong' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'launch_token_required' } });
    expect(guardCalls).toEqual(['wrong']);

    const tooLarge = await postCorrection(base, oversized);
    expect(tooLarge.status).toBe(413);
    expect((await postCorrection(base, 'kind=update_edge', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await postCorrection(base, '{not json')).status).toBe(400);
  });

  it('saves a correction, answers 201 with the read-back record and serves it on the next read', async () => {
    await writeGraphV2(dataDir);
    const base = await start();
    const response = await postCorrection(base, roleCorrection);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'saved',
      record: { id: EDGES.tanakaAtlas.id, role: '技術顧問' },
      readback: { verified: true },
      appliesTo: ['search', 'get_context', 'resolve_entity'],
      correction: { reason: '役割は技術顧問だった。', changedFields: ['role'], beforeDigest: roleCorrection.expectedDigest }
    });
    expect(body.digest).toBe(body.correction.afterDigest);

    const history = (await readFile(join(dataDir, GRAPH_CORRECTIONS_FILE), 'utf8')).split('\n').filter(Boolean);
    expect(history).toHaveLength(1);

    const project = await (await fetch(`${base}/api/graph/projects/project-atlas`)).json();
    const participant = project.participants.find((edge: { id: string }) => edge.id === EDGES.tanakaAtlas.id);
    expect(participant).toMatchObject({ role: '技術顧問', digest: body.digest });
    expect(project.history.map((record: { id: string }) => record.id)).toEqual([body.correction.id]);

    const repeated = await postCorrection(base, roleCorrection);
    expect(repeated.status).toBe(409);
    const conflict = await repeated.json();
    expect(conflict.error).toMatchObject({
      code: 'digest_conflict',
      current: { recordType: 'edge', record: { id: EDGES.tanakaAtlas.id, role: '技術顧問' }, digest: body.digest }
    });
  });

  it('answers invalid corrections with 400 and the specific rule', async () => {
    await writeGraphV2(dataDir);
    const base = await start();
    const deleted = await postCorrection(base, { kind: 'delete_edge', edgeId: EDGES.tanakaAtlas.id, reason: '消す。' });
    expect(deleted.status).toBe(400);
    expect(await deleted.json()).toMatchObject({ error: { code: 'correction_delete_not_allowed' } });
    const noReason = await postCorrection(base, { ...roleCorrection, reason: '' });
    expect(noReason.status).toBe(400);
    expect(await noReason.json()).toMatchObject({ error: { code: 'correction_reason_required' } });
    const typeChange = await postCorrection(base, {
      kind: 'update_entity', entityId: 'person-tanaka', expectedDigest: graphRecordDigest(ENTITIES.tanaka), reason: '種類を直す。', changes: { type: 'org' }
    });
    expect(await typeChange.json()).toMatchObject({ error: { code: 'correction_type_change_not_allowed' } });
    const missing = await postCorrection(base, { ...roleCorrection, edgeId: 'edge-missing' });
    expect(missing.status).toBe(404);
  });
});
