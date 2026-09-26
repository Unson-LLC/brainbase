import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GRAPH_CORRECTIONS_FILE, graphRecordDigest } from '../src/graph-corrections.js';
import { createGraphWebModule, createLocalWebHost, LOCAL_WEB_TOKEN_HEADER } from '../src/local-web-host.js';
import { EDGES, ENTITIES, FIXTURE_NOW, writeGraphV1, writeGraphV2 } from './graph-web-fixture.js';

const TOKEN = 'local-web-graph-token-0123456789';

let directory: string;
let dataDir: string;
const servers: Server[] = [];

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function startHost(): Promise<string> {
  const host = createLocalWebHost({ dataDir, journalRoot: join(directory, 'journal'), token: TOKEN, now: () => FIXTURE_NOW });
  return listen(host.server);
}

function correct(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/api/graph/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [LOCAL_WEB_TOKEN_HEADER]: TOKEN, ...headers },
    body: JSON.stringify(body)
  });
}

// fetch() cannot override Host, so a rebound DNS name is simulated with a raw request.
function rawRequest(base: string, path: string, options: { host: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
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

const roleCorrection = {
  kind: 'update_edge',
  edgeId: EDGES.tanakaAtlas.id,
  expectedDigest: graphRecordDigest(EDGES.tanakaAtlas),
  reason: '役割は技術顧問だった。',
  changes: { role: '技術顧問' }
};

async function historyExists(): Promise<boolean> {
  try {
    await access(join(dataDir, GRAPH_CORRECTIONS_FILE));
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-local-web-graph-'));
  dataDir = join(directory, 'personal-os');
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await rm(directory, { recursive: true, force: true });
});

describe('Graph screens on the local Web host', () => {
  it('serves the Graph read routes for the host data directory and the screen parts', async () => {
    await writeGraphV2(dataDir);
    const base = await startHost();

    const projects = await (await fetch(`${base}/api/graph/projects`)).json();
    expect(projects).toMatchObject({ status: 'ok', source: { dataDir, graphFormat: 2 }, absenceConfirmed: false });
    expect(projects.projects.map((project: { id: string }) => project.id)).toEqual(['project-atlas', 'project-beta']);
    const project = await (await fetch(`${base}/api/graph/projects/project-atlas`)).json();
    expect(project.participants.map((edge: { id: string }) => edge.id)).toEqual([EDGES.satoAtlas.id, EDGES.tanakaAtlas.id]);
    const search = await (await fetch(`${base}/api/graph/search?q=Tanaka&type=person`)).json();
    expect(search.results.map((entity: { id: string }) => entity.id)).toEqual(['person-tanaka']);
    const entity = await (await fetch(`${base}/api/graph/entities/person-tanaka`)).json();
    expect(entity.entity.digest).toBe(graphRecordDigest(ENTITIES.tanaka));
    expect((await (await fetch(`${base}/api/graph/ontology`)).json()).status).toBe('ok');
    expect((await (await fetch(`${base}/api/graph/status`)).json()).counts.entities.total).toBe(8);

    const shell = await (await fetch(`${base}/`)).text();
    for (const file of ['graph-view-shared.css', 'graph-projects-view.css', 'graph-registry-view.css']) {
      expect(shell).toContain(`<link rel="stylesheet" href="/ui/${file}">`);
    }
    for (const file of ['graph-view-shared.js', 'graph-view-shared.css', 'graph-projects-view.js', 'graph-projects-view.css', 'graph-registry-view.js', 'graph-registry-view.css']) {
      const response = await fetch(`${base}/ui/${file}`);
      expect(response.status, file).toBe(200);
      expect(response.headers.get('content-type')).toMatch(file.endsWith('.js') ? /text\/javascript/ : /text\/css/);
    }
    // No organization Graph route is served (W6 is not part of this host yet).
    expect((await fetch(`${base}/api/graph/organization/search?q=x`)).status).toBe(404);
  });

  it('refuses a rebound DNS name on the Graph routes, including a correction with the token', async () => {
    await writeGraphV2(dataDir);
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const base = await startHost();
    const rebound = `evil.example:${new URL(base).port}`;
    for (const path of ['/api/graph/projects', '/api/graph/projects/project-atlas', '/api/graph/search?q=a', '/api/graph/entities/person-tanaka', '/api/graph/ontology', '/ui/graph-projects-view.js']) {
      const response = await rawRequest(base, path, { host: rebound });
      expect(response.status, path).toBe(403);
      expect(response.body).not.toContain('田中');
      expect(response.body).not.toContain(dataDir);
    }
    const write = await rawRequest(base, '/api/graph/corrections', {
      host: rebound,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://${rebound}`, [LOCAL_WEB_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify(roleCorrection)
    });
    expect(write.status).toBe(403);
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
    expect(await historyExists()).toBe(false);
  });

  it('refuses a correction without the launch token or from another origin, and changes nothing', async () => {
    await writeGraphV2(dataDir);
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const base = await startHost();
    const missing = await fetch(`${base}/api/graph/corrections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roleCorrection)
    });
    expect(missing.status).toBe(403);
    expect((await missing.json()).error.code).toBe('web_token_required');
    expect((await correct(base, roleCorrection, { [LOCAL_WEB_TOKEN_HEADER]: 'wrong-token-00000000000000' })).status).toBe(403);
    const crossOrigin = await correct(base, roleCorrection, { Origin: 'http://evil.example' });
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error.code).toBe('cross_origin_rejected');
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
    expect(await historyExists()).toBe(false);
  });

  it('saves a correction with the token, writes the history line and reads the saved record back', async () => {
    await writeGraphV2(dataDir);
    const base = await startHost();
    const saved = await correct(base, roleCorrection, { Origin: base });
    expect(saved.status).toBe(201);
    const body = await saved.json();
    expect(body).toMatchObject({
      status: 'saved',
      record: { id: EDGES.tanakaAtlas.id, role: '技術顧問' },
      readback: { verified: true, historyRecorded: true },
      appliesTo: ['search', 'get_context', 'resolve_entity']
    });
    const lines = (await readFile(join(dataDir, GRAPH_CORRECTIONS_FILE), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: 'update_edge', reason: '役割は技術顧問だった。', at: FIXTURE_NOW.toISOString(), afterDigest: body.digest });

    const project = await (await fetch(`${base}/api/graph/projects/project-atlas`)).json();
    expect(project.participants.find((edge: { id: string }) => edge.id === EDGES.tanakaAtlas.id)).toMatchObject({ role: '技術顧問', digest: body.digest });
    expect(project.history).toHaveLength(1);

    const stale = await correct(base, roleCorrection);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatchObject({ code: 'digest_conflict', current: { recordType: 'edge', digest: body.digest } });
  });

  it('re-checks the token and origin inside the Graph module even when the host check is bypassed', async () => {
    await writeGraphV2(dataDir);
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const module = createGraphWebModule({ dataDir, journalRoot: join(directory, 'journal'), token: TOKEN, now: () => FIXTURE_NOW });
    const base = await listen(createServer((request, response) => {
      void module.handle(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    }));
    const missing = await fetch(`${base}/api/graph/corrections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roleCorrection)
    });
    expect(missing.status).toBe(403);
    expect((await missing.json()).error.code).toBe('web_token_required');
    const crossOrigin = await correct(base, roleCorrection, { Origin: 'http://evil.example' });
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error.code).toBe('cross_origin_rejected');
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
    expect(await historyExists()).toBe(false);
    expect((await correct(base, roleCorrection)).status).toBe(201);
  });

  it('answers Graph v1 as migration required and never migrates or corrects it', async () => {
    await writeGraphV1(dataDir);
    const before = await readFile(join(dataDir, 'graph.json'), 'utf8');
    const base = await startHost();
    for (const path of ['/api/graph/projects', '/api/graph/search?q=Legacy', '/api/graph/entities/person-legacy', '/api/graph/ontology']) {
      const body = await (await fetch(`${base}${path}`)).json();
      expect(body, path).toMatchObject({ status: 'migration_required', absenceConfirmed: false });
      expect(body.command).toContain('brainbase ontology:migrate --dir');
      expect(body.writeCommand).toContain('--write --expected-input-digest');
      expect(body).not.toHaveProperty('projects');
      expect(body).not.toHaveProperty('results');
    }
    const refused = await correct(base, roleCorrection);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe('migration_required');
    expect(await readFile(join(dataDir, 'graph.json'), 'utf8')).toBe(before);
  });

  it('reports a missing data directory as not initialized without creating it', async () => {
    const base = await startHost();
    const projects = await (await fetch(`${base}/api/graph/projects`)).json();
    expect(projects).toMatchObject({ status: 'not_initialized', absenceConfirmed: true });
    expect((await correct(base, roleCorrection)).status).toBe(404);
    await expect(access(dataDir)).rejects.toThrow();
  });
});
