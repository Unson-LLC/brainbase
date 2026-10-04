import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGraphWebHttpHandler } from '../src/graph-web-http.js';
import { openInMemoryGraph } from '../src/graph-web.js';
import { createLocalWebHost } from '../src/local-web-host.js';
import { createOrganizationGraphSource, projectOrganizationGraph } from '../src/organization-graph-web.js';

const entity = (id: string, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, entity_type: type, lifecycle_status: 'active', payload, ...extra
});
const edge = (id: string, from: string, rel: string, to: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id, from_id: from, to_id: to, rel_type: rel, lifecycle_status: 'active', payload, ...extra
});

const records = {
  entities: {
    project: [
      entity('prj_atlas', 'project', { name: 'Atlas', purpose: '研修', status: 'active' }, { project_code: 'atlas' }),
      entity('prj_old', 'project', { name: 'Old Product' }, { lifecycle_status: 'retired' })
    ],
    person: [entity('per_owner', 'person', { name: '山田 太郎', aliases: ['山田'] }), entity('per_a', 'person', { name: '鈴木' })],
    org: [entity('acme', 'org', { name: '例示組織' })],
    decision: [entity('dec_1', 'decision', { title: '研修は月1' })],
    raci_assignment: [
      entity('rac_final', 'raci_assignment', { role_code: 'decision:最終決裁' }, { project_id: 'prj_atlas' }),
      entity('rac_r', 'raci_assignment', { role_code: 'responsible' }, { project_id: 'prj_atlas' })
    ]
  },
  memberOf: [
    edge('e1', 'per_owner', 'member_of', 'prj_atlas', { role_code: 'decision:最終決裁' }),
    edge('e2', 'per_a', 'member_of', 'prj_atlas'),
    edge('e3', 'per_a', 'member_of', 'prj_old')
  ],
  assignedTo: [edge('e4', 'rac_final', 'assigned_to', 'per_owner'), edge('e5', 'rac_r', 'assigned_to', 'per_a')]
};

describe('organization Graph projected for the local host (C1)', () => {
  it('turns stated memberships and RACI into participation and accountability, and reads like a local Graph', () => {
    const { graph, excluded } = projectOrganizationGraph(records);
    expect(excluded).toEqual({ inactive: 1, unnamed: 0, danglingRelations: 1 });
    const reader = openInMemoryGraph(graph, { dataDir: null, graphFormat: 2, authority: 'organization_graph', server: 'https://graph.example', readAt: '2026-10-04T00:00:00.000Z' });
    const [atlas] = reader.listProjects().projects;
    expect(atlas).toMatchObject({ name: 'Atlas', goal: '研修', status: 'active', participantCount: 2, accountableCount: 1 });
    expect(atlas.people[0]).toMatchObject({ name: '山田 太郎', accountable: true });
    expect(reader.status().source.authority).toBe('organization_graph');
    const member = graph.edges.filter((item) => item.fromId === 'per_a');
    // The same person, relation and project become one relation with both role names.
    expect(member).toEqual([expect.objectContaining({ relation: 'participates_in', role: 'responsible' })]);
  });

  it('refuses corrections while reading the organization Graph', async () => {
    const reader = openInMemoryGraph(projectOrganizationGraph(records).graph, { dataDir: null, graphFormat: 2, authority: 'organization_graph', server: 'https://graph.example', readAt: '2026-10-04T00:00:00.000Z' });
    const handler = createGraphWebHttpHandler({ dataDir: '/nonexistent', readGraph: async () => reader, assertWriteAllowed: () => undefined });
    const server: Server = createServer((request, response) => void handler(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      const listed = await (await fetch(`${base}/api/graph/projects`)).json() as { projects: Array<{ name: string }> };
      expect(listed.projects.map((project) => project.name)).toEqual(['Atlas']);
      const refused = await fetch(`${base}/api/graph/corrections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(refused.status).toBe(403);
      expect((await refused.json() as { error: { code: string } }).error.code).toBe('organization_graph_read_only');
    } finally {
      server.close();
    }
  });

  it('reports a missing sign-in as a reason, never as an empty Graph', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bb-org-graph-'));
    expect(await createOrganizationGraphSource({ home })).toEqual({ reason: 'brainbase_auth_files_unreadable' });
  });

  it('tells the shell the organization Graph is connected, read only', async () => {
    const reader = openInMemoryGraph(projectOrganizationGraph(records).graph, { dataDir: null, graphFormat: 2, authority: 'organization_graph', server: 'https://graph.example', readAt: '2026-10-04T00:00:00.000Z' });
    const dataDir = await mkdtemp(join(tmpdir(), 'bb-org-host-'));
    const { server } = createLocalWebHost({ dataDir, journalRoot: join(dataDir, 'journal'), organizationGraph: { server: 'https://graph.example', read: async () => reader } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      const status = await (await fetch(`${base}/api/local/status`)).json() as { graph: { status: string }; organization_graph: Record<string, string> };
      expect(status.organization_graph).toEqual({ status: 'connected', server: 'https://graph.example', mode: 'read_only' });
      expect(status.graph.status).toBe('ready');
      const listed = await (await fetch(`${base}/api/graph/projects`)).json() as { projects: unknown[] };
      expect(listed.projects).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
