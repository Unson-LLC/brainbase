import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withCanonicalTaskEvidence } from '../helpers/canonical-task-evidence.js';
import { startCanonicalTaskLiveApiHarness } from '../helpers/canonical-task-live-api-harness.js';

type EvidenceEntry = {
  id: string;
  owner_path: string;
};

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(
  readFileSync(path.join(rootDir, 'config/canonical-task-evidence-registry.json'), 'utf8'),
) as { entries: EvidenceEntry[] };

const coreApiSuites = [
  'tests/server/routes/companion-canonical-tasks.test.js',
  'tests/server/services/canonical-task-service.test.js',
  'tests/server/services/canonical-task-operation-repository.test.js',
  'tests/server/services/canonical-task-nocodb-repository.test.js',
  'tests/server/services/canonical-task-principal.test.js',
];
const workflowSuites = [
  'tests/server/services/workflow-canonical-task-materialization.test.js',
  'tests/server/services/workflow-org-agent-control.test.js',
  'tests/server/routes/companion-approval-inbox.test.js',
  'tests/server/routes/workflows.test.js',
];
const cutoverSuites = [
  'tests/server/bootstrap/cors-options.test.js',
  'tests/server/services/canonical-task-readiness.test.js',
  'tests/server/services/canonical-task-store-config.test.js',
  'tests/server/scripts/canonical-task-api-client.test.js',
  'tests/server/scripts/canonical-task-writer-policy.test.js',
  'tests/server/scripts/migrate-canonical-task-columns.test.js',
  'tests/server/scripts/preflight-canonical-task-cutover.test.js',
  'tests/server/scripts/recover-canonical-task-writer.test.js',
];
const legacyBrowserSuites = [
  'tests/server/routes/nocodb-canonical-task-write-guard.test.js',
  'tests/domain/nocodb-task/nocodb-task-adapter.test.js',
  'tests/domain/nocodb-task/nocodb-task-repository.test.js',
  'tests/domain/nocodb-task/nocodb-task-service.test.js',
  'tests/browser/nocodb-browser.test.js',
];
const browserMutationSuites = [
  'tests/server/bootstrap/cors-options.test.js',
  ...legacyBrowserSuites,
];
const manaSuites = ['tests/server/routes/mana-capture-routes.test.js'];
const liveApiScenarioIds = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 18, 19, 21, 32, 39, 45,
]);

let liveApiHarness: Awaited<ReturnType<typeof startCanonicalTaskLiveApiHarness>>;

test.beforeAll(async () => {
  liveApiHarness = await startCanonicalTaskLiveApiHarness();
});

test.afterAll(async () => {
  await liveApiHarness.close();
});

const scenarioSuites: Record<number, string[]> = {
  1: coreApiSuites, 2: coreApiSuites, 3: coreApiSuites, 4: coreApiSuites,
  5: coreApiSuites, 6: coreApiSuites, 7: coreApiSuites, 8: coreApiSuites,
  9: coreApiSuites, 10: workflowSuites, 11: workflowSuites, 12: workflowSuites,
  13: workflowSuites, 14: coreApiSuites, 15: coreApiSuites, 16: workflowSuites,
  17: cutoverSuites, 18: coreApiSuites, 19: coreApiSuites, 20: cutoverSuites,
  21: coreApiSuites, 22: workflowSuites, 23: workflowSuites,
  25: workflowSuites, 26: workflowSuites, 27: workflowSuites, 28: cutoverSuites,
  29: workflowSuites, 30: legacyBrowserSuites, 31: cutoverSuites, 32: coreApiSuites,
  33: workflowSuites, 34: workflowSuites, 35: legacyBrowserSuites,
  36: manaSuites, 37: manaSuites, 38: legacyBrowserSuites, 39: coreApiSuites,
  41: [...coreApiSuites, ...cutoverSuites], 42: manaSuites,
  43: legacyBrowserSuites, 44: legacyBrowserSuites, 45: coreApiSuites,
  46: cutoverSuites, 47: manaSuites,
};

const surfaceSuites: Record<string, string[]> = {
  'surface.auth.matrix': coreApiSuites,
  'surface.approval.inbox': workflowSuites,
  'surface.approval.resolve-run': workflowSuites,
  'surface.approval.resolve-step': workflowSuites,
  'surface.approval.non-task': workflowSuites,
  'surface.workflow.get-run-reconcile': workflowSuites,
  'surface.workflow.retry-reconcile': workflowSuites,
  'surface.workflow.audit-idempotency': workflowSuites,
  'surface.writer.claim-reconcile': cutoverSuites,
  'surface.writer.release-recover': cutoverSuites,
  'surface.readiness.closed-start': cutoverSuites,
  'surface.readiness.atomic-enable': cutoverSuites,
  'surface.readiness.explicit-disable': cutoverSuites,
  'surface.legacy.route': legacyBrowserSuites,
  'surface.legacy.ui': legacyBrowserSuites,
  'surface.mana.auth-retry-read': manaSuites,
  'surface.browser.mutations': browserMutationSuites,
  'surface.delete.recovery': coreApiSuites,
  'surface.operational-scripts': cutoverSuites,
  'surface.migrations.postgres': cutoverSuites,
  'surface.migrations.nocodb': cutoverSuites,
};

function childEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('VIBEPRO_EVIDENCE_')),
  );
}

function run(command: string, args: string[], cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    env: childEnvironment(),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  expect(result.error, output).toBeUndefined();
  expect(result.signal, output).toBeNull();
  expect(result.status, output).toBe(0);
}

function runVitest(files: string[]) {
  run('npx', ['vitest', 'run', ...files]);
}

function assertMacWireFixture() {
  const fixture = JSON.parse(readFileSync(
    path.join(rootDir, 'tests/fixtures/companion-canonical-task-mac-cb9c293.json'),
    'utf8',
  ));
  const page = fixture.sample_list_response;
  const task = page.items[0];
  expect(fixture.mac_source_head).toMatch(/^[a-f0-9]{40}$/);
  expect(Object.keys(fixture.routes).sort()).toEqual(['create', 'list', 'read', 'transition', 'update']);
  expect(page).toEqual(expect.objectContaining({
    total_count: expect.any(Number),
    count_status: 'exact',
    read_status: 'complete',
    warnings: expect.any(Array),
    as_of: expect.any(String),
  }));
  expect(task).toEqual(expect.objectContaining({
    id: expect.any(String), version: expect.any(Number), title: expect.any(String),
    status: 'waiting', priority: 'high', source_refs: expect.any(Array),
    created_at: expect.any(String), updated_at: expect.any(String), web_url: expect.any(String),
  }));
  expect(task.source_refs[0]).toEqual({ type: 'workflow_output', id: 'output-1', url: null });
}

async function verifyAuthenticatedTaskLifecycle() {
  const client = await playwrightRequest.newContext({ baseURL: liveApiHarness.baseURL });
  const key = `e2e-live-${crypto.randomUUID()}`;
  try {
    const createdResponse = await client.post('/api/companion/tasks', {
      data: { title: 'HTTP経路の正本タスク', priority: 'high', source_refs: [] },
      headers: { 'Idempotency-Key': key },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();
    expect(created).toMatchObject({ status: 'pending', version: 1, assignee_person_id: 'sato_keigo' });

    const listResponse = await client.get('/api/companion/tasks?limit=1');
    expect(listResponse.status()).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      items: [expect.objectContaining({ id: created.id })],
      count_status: 'exact',
      read_status: 'complete',
    });

    const readResponse = await client.get(`/api/companion/tasks/${encodeURIComponent(created.id)}`);
    expect(readResponse.status()).toBe(200);
    expect(await readResponse.json()).toMatchObject({ id: created.id, version: 1 });

    const updatedResponse = await client.patch(`/api/companion/tasks/${encodeURIComponent(created.id)}`, {
      data: { expected_version: 1, title: 'HTTP経路で更新済み' },
    });
    expect(updatedResponse.status()).toBe(200);
    const updated = await updatedResponse.json();
    expect(updated).toMatchObject({ title: 'HTTP経路で更新済み', version: 2 });

    const transitionedResponse = await client.post(`/api/companion/tasks/${encodeURIComponent(created.id)}/transitions`, {
      data: { expected_version: 2, to_status: 'completed' },
    });
    expect(transitionedResponse.status()).toBe(200);
    const transitioned = await transitionedResponse.json();
    expect(transitioned).toMatchObject({ status: 'completed', version: 3 });

    const deletedResponse = await client.delete(`/api/companion/tasks/${encodeURIComponent(created.id)}`, {
      data: { expected_version: 3 },
      headers: { 'Idempotency-Key': `${key}-delete` },
    });
    expect(deletedResponse.status()).toBe(200);
    expect(await deletedResponse.json()).toMatchObject({ task_id: created.id, deleted: true, version: 4 });

    const missingResponse = await client.get(`/api/companion/tasks/${encodeURIComponent(created.id)}`);
    expect(missingResponse.status()).toBe(404);
  } finally {
    await client.dispose();
  }
}

async function verifyEvidenceContract(evidenceId: string, request: APIRequestContext) {
  if (evidenceId === 'scenario.SC-014') {
    const response = await request.post('/api/companion/tasks', {
      data: { title: 'must-not-be-created' },
      headers: { 'Idempotency-Key': 'e2e-unauthenticated-mutation' },
    });
    expect([401, 403]).toContain(response.status());
    const body = await response.json();
    expect(body.code || body.error).toBeTruthy();
    return;
  }
  if (evidenceId === 'scenario.SC-024' || evidenceId === 'surface.mac.wire-contract') {
    assertMacWireFixture();
    return;
  }
  if (evidenceId === 'scenario.SC-040' || evidenceId === 'surface.mcp.write-fence') {
    run('npm', ['run', 'build'], path.join(rootDir, 'mcp/nocodb'));
    run('npm', ['test'], path.join(rootDir, 'mcp/nocodb'));
    return;
  }
  if (evidenceId === 'surface.runtime-path') {
    const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: rootDir, encoding: 'utf8' });
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
    expect(root.status).toBe(0);
    expect(path.resolve(root.stdout.trim())).toBe(rootDir);
    expect(head.status).toBe(0);
    expect(head.stdout.trim()).toMatch(/^[a-f0-9]{40}$/);
    return;
  }

  const scenario = /^scenario\.SC-(\d{3})$/.exec(evidenceId);
  if (scenario && liveApiScenarioIds.has(Number(scenario[1]))) {
    await verifyAuthenticatedTaskLifecycle();
  }
  const suites = scenario ? scenarioSuites[Number(scenario[1])] : surfaceSuites[evidenceId];
  expect(suites, `No real test suite mapped for ${evidenceId}`).toBeDefined();
  runVitest(suites);
}

test('canonical Task API rejects an unauthenticated mutation', async ({ request }) => {
  const response = await request.post('/api/companion/tasks', {
    data: { title: 'must-not-be-created' },
    headers: { 'Idempotency-Key': 'e2e-explicit-unauthenticated-mutation' },
  });
  expect([401, 403]).toContain(response.status());
  const body = await response.json();
  expect(body.code || body.error).toBeTruthy();
});

test('canonical Task API completes an authenticated lifecycle through HTTP', async () => {
  await verifyAuthenticatedTaskLifecycle();
});

for (const entry of registry.entries) {
  test(entry.id, async ({ request }, testInfo) => {
    await withCanonicalTaskEvidence(entry.id, async () => {
      await verifyEvidenceContract(entry.id, request);
    }, testInfo);
  });
}
