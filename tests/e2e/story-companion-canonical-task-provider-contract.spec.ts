import { expect, request as playwrightRequest, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
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
const verifiedMacSourceHead = '8b1c95fe7c8bf76e7dadd56aa912ae417227aba8';
const registry = JSON.parse(
  readFileSync(path.join(rootDir, 'config/canonical-task-evidence-registry.json'), 'utf8'),
) as { entries: EvidenceEntry[] };

type VitestContract = {
  files: string[];
  testNamePattern: string;
};

const file = (path: string, testNamePattern: string): VitestContract => ({
  files: [path],
  testNamePattern,
});
const files = (paths: string[], testNamePattern: string): VitestContract => ({
  files: paths,
  testNamePattern,
});

const taskService = 'tests/server/services/canonical-task-service.test.js';
const taskRepository = 'tests/server/services/canonical-task-nocodb-repository.test.js';
const operationRepository = 'tests/server/services/canonical-task-operation-repository.test.js';
const taskRoutes = 'tests/server/routes/companion-canonical-tasks.test.js';
const workflowMaterialization = 'tests/server/services/workflow-canonical-task-materialization.test.js';
const workflowRoutes = 'tests/server/routes/workflows.test.js';
const manaRoutes = 'tests/server/routes/mana-capture-routes.test.js';
const browserService = 'tests/domain/nocodb-task/nocodb-task-service.test.js';
const browserRepository = 'tests/domain/nocodb-task/nocodb-task-repository.test.js';
const legacyRouteGuard = 'tests/server/routes/nocodb-canonical-task-write-guard.test.js';
const legacyAdapter = 'tests/domain/nocodb-task/nocodb-task-adapter.test.js';
const liveApiScenarioIds = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 18, 19, 21, 32, 39, 45,
]);

let liveApiHarness: Awaited<ReturnType<typeof startCanonicalTaskLiveApiHarness>>;

test.beforeAll(async () => {
  liveApiHarness = await startCanonicalTaskLiveApiHarness();
});

test.afterAll(async () => {
  await liveApiHarness?.close();
});

const scenarioContracts: Record<number, VitestContract> = {
  1: file(taskRoutes, 'passes repeated filters and returns Mac list metadata'),
  2: file(taskService, 'creates once with a server-side actor namespace'),
  3: file(taskService, 'returns 409 instead of replaying another PATCH for the same Task version'),
  4: file(taskService, 'returns current task on version conflict'),
  5: file(taskService, 'requires waiting_on and seals completed tasks'),
  6: file(taskService, 'requires waiting_on and seals completed tasks'),
  7: file(taskRepository, 'does not guess a legacy free-text assignee'),
  8: file(taskService, 'rejects unresolved assignees before writing any workflow Task'),
  9: file(taskService, 'keeps Task store failures explicit'),
  10: file(workflowMaterialization, 'returns materialized Task IDs and only then approves the human step'),
  11: file(workflowMaterialization, 'replays the materialization result after an approved response was lost'),
  12: file(workflowMaterialization, 'keeps the human step pending when Canonical Task materialization fails'),
  13: file(workflowRoutes, 'does not resume a human-gated workflow when the human step is rejected'),
  15: file(operationRepository, 'replays the completed result for a matching concurrent operation'),
  16: file('tests/server/routes/companion-canonical-task-live-http.test.js', 'materializes one Task with origin references when approval is retried over TCP'),
  17: file(operationRepository, 'reclaims a failed operation|matching concurrent operation does not settle|left running by a previous writer'),
  18: file(taskRoutes, 'does not allow another authenticated person to act as the canonical owner'),
  19: file(taskRepository, 'rejects opaque ids from another store or with a forged signature'),
  20: file(operationRepository, 'binds a recovered matching writer token|does not rebind readiness when verified release authorities differ'),
  21: file(taskService, 'recovers an already-applied PATCH after restart without writing NocoDB again'),
  22: file(workflowMaterialization, 'surface.workflow.retry-reconcile'),
  23: file(workflowRoutes, 'denies human step resolution by another project member'),
  25: file(workflowRoutes, 'keeps the review run visible after resolving one generated human approval'),
  26: file(taskService, 'materializes approved workflow candidates and applies only declared edits'),
  27: file(workflowMaterialization, 'AC-20 fails closed'),
  28: files([
    operationRepository,
    'tests/server/scripts/recover-canonical-task-writer.test.js',
  ], 'writer claimed after restart|surface.writer.release-recover'),
  29: file(workflowMaterialization, 'surface.workflow.audit-idempotency'),
  30: file(legacyRouteGuard, 'Given canonical base, when (POST|PUT|DELETE) mutates legacy Task route'),
  31: files([
    'tests/server/scripts/canonical-task-writer-policy.test.js',
    'tests/server/scripts/preflight-canonical-task-cutover.test.js',
  ], 'keeps operational scripts behind|tracked runtime file introduces an unregistered canonical table reference'),
  32: files([
    taskService,
    'tests/server/services/canonical-task-principal.test.js',
  ], 'creates once with a server-side actor namespace|keeps type and delimiter-bearing ids disjoint'),
  33: file(workflowMaterialization, 'SC-033 normalizes legacy string candidates'),
  34: file(workflowMaterialization, 'AC-25 keeps generated candidate IDs and downstream operation keys stable across reorder'),
  35: file(legacyAdapter, 'preserves waiting and urgent|keeps unknown legacy values visible'),
  36: files([taskService, manaRoutes], 'materializes a Mana capture with an actor-scoped stable command key|POST /capture requires a valid CSRF token'),
  37: file(manaRoutes, 'GET /captures follows canonical Task cursors before filtering Mana captures'),
  38: file(browserService, 'merges the required canonical list|loads every canonical task page|canonical task cursor repeats'),
  39: file(operationRepository, 'finishes a prepared delete|persists the version claim and delete intent|rejects changed input for an existing actor-scoped delete key|rejects another delete key from the same actor'),
  41: files([
    taskRoutes,
    'tests/server/services/canonical-task-store-config.test.js',
  ], 'rejects cookie before Task store access|rejects insecure-header before Task store access|loads, hashes, and deeply freezes the committed manifest'),
  42: files([taskService, manaRoutes], 'materializes a Mana capture with an actor-scoped stable command key|POST /capture rejects missing capture_id|does not return a local id when the canonical store is unavailable'),
  43: file(browserService, 'creates a canonical task with a People SSOT person id|rejects canonical creation when no People SSOT person id is available'),
  44: file(browserRepository, 'uses the versioned Companion API and idempotency headers'),
  45: file(operationRepository, 'finishes a prepared delete after the Task has already disappeared|does not disclose another actor delete result'),
  46: files([
    'tests/server/services/canonical-task-readiness.test.js',
    'tests/server/scripts/preflight-canonical-task-cutover.test.js',
  ], 'starts closed and opens only when all persisted authorities match|runs the built-in rollback policy'),
  47: files([
    taskService,
    'tests/server/services/canonical-task-principal.test.js',
  ], 'does not let another session actor replay the owner Mana capture namespace|normalizes equivalent person credentials|keeps type and delimiter-bearing ids disjoint'),
};

const surfaceContracts: Record<string, VitestContract> = {
  'surface.auth.matrix': files([
    taskRoutes,
    'tests/server/services/canonical-task-principal.test.js',
  ], 'rejects cookie before Task store access|rejects insecure-header before Task store access|rejects untrusted or invalid principals'),
  'surface.approval.inbox': file('tests/server/routes/companion-approval-inbox.test.js', 'returns pending workflow approvals with outputs and audit refs'),
  'surface.approval.resolve-run': file(workflowRoutes, 'resolves a pending human step through the run-scoped human-step API'),
  'surface.approval.resolve-step': file(workflowRoutes, 'keeps the legacy human-step resolve alias behind the same approval and resume semantics'),
  'surface.approval.non-task': file(workflowRoutes, 'does not resume a human-gated workflow when the human step is rejected'),
  'surface.workflow.get-run-reconcile': file(workflowMaterialization, 'surface.workflow.get-run-reconcile'),
  'surface.workflow.retry-reconcile': file(workflowMaterialization, 'surface.workflow.retry-reconcile'),
  'surface.workflow.audit-idempotency': file(workflowMaterialization, 'surface.workflow.audit-idempotency'),
  'surface.writer.claim-reconcile': file(operationRepository, 'rebinds matching verified readiness to the writer claimed after restart'),
  'surface.writer.release-recover': file('tests/server/scripts/recover-canonical-task-writer.test.js', 'surface.writer.release-recover'),
  'surface.readiness.closed-start': file('tests/server/services/canonical-task-readiness.test.js', 'starts closed and opens only when all persisted authorities match'),
  'surface.readiness.atomic-enable': file('tests/server/services/canonical-task-readiness.test.js', 'opens a running process after an external enable writes matching evidence'),
  'surface.readiness.explicit-disable': file('tests/server/services/canonical-task-readiness.test.js', 'keeps the verified release open across a clean writer restart and observes disable'),
  'surface.legacy.route': file(legacyRouteGuard, 'Given canonical base, when (POST|PUT|DELETE) mutates legacy Task route'),
  'surface.legacy.ui': file(legacyAdapter, 'preserves waiting and urgent|keeps unknown legacy values visible'),
  'surface.mana.auth-retry-read': files([taskService, manaRoutes], 'materializes a Mana capture with an actor-scoped stable command key|POST /capture requires a valid CSRF token|GET /captures follows canonical Task cursors'),
  'surface.browser.mutations': file(browserRepository, 'uses the versioned Companion API and idempotency headers'),
  'surface.delete.recovery': file(operationRepository, 'finishes a prepared delete|persists the version claim and delete intent|does not disclose another actor delete result'),
  'surface.operational-scripts': files([
    'tests/server/scripts/canonical-task-writer-policy.test.js',
    'tests/server/scripts/preflight-canonical-task-cutover.test.js',
  ], 'keeps operational scripts behind|tracked runtime file introduces an unregistered canonical table reference'),
  'surface.migrations.postgres': file('tests/server/scripts/migrate-canonical-task-operations.test.js', 'verifies required tables, columns, constraints, and index'),
  'surface.migrations.nocodb': file('tests/server/scripts/migrate-canonical-task-columns.test.js', 'creates missing columns and verifies the unique idempotency key'),
};

function childEnvironment() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('VIBEPRO_EVIDENCE_')),
    ),
    NO_COLOR: '1',
  };
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
  return output;
}

function runVitest(contract: VitestContract) {
  const output = run('npx', [
    'vitest',
    'run',
    ...contract.files,
    '--testNamePattern',
    contract.testNamePattern,
  ]);
  expect(output, `No passing Vitest assertion matched ${contract.testNamePattern}`)
    .toMatch(/Tests\s+[1-9]\d* passed/);
}

function assertMacWireFixture() {
  const fixture = JSON.parse(readFileSync(
    path.join(rootDir, 'tests/fixtures/companion-canonical-task-mac-cb9c293.json'),
    'utf8',
  ));
  const page = fixture.sample_list_response;
  const task = page.items[0];
  expect(fixture.mac_source_head).toBe(verifiedMacSourceHead);
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

async function verifyRuntimeProcessPath() {
  const child = spawn(process.execPath, ['scripts/run-canonical-task-live-api-harness.js'], {
    cwd: rootDir,
    env: childEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const stderr: string[] = [];
  child.stderr?.on('data', chunk => stderr.push(String(chunk)));
  try {
    const runtime = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`runtime harness did not start: ${stderr.join('')}`)), 15_000);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`runtime harness exited with ${code}: ${stderr.join('')}`));
      });
      child.once('message', message => {
        clearTimeout(timer);
        resolve(message as Record<string, unknown>);
      });
    });
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
    expect(head.status).toBe(0);
    expect(runtime).toMatchObject({
      status: 'ready',
      pid: child.pid,
      cwd: rootDir,
      source_head: head.stdout.trim(),
      command: expect.stringContaining('scripts/run-canonical-task-live-api-harness.js'),
      base_url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
    });
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      setTimeout(resolve, 5_000);
    });
  }
}

async function verifyAuthenticatedTaskLifecycle() {
  const client = await playwrightRequest.newContext({
    baseURL: liveApiHarness.baseURL,
    extraHTTPHeaders: { Authorization: 'Bearer canonical-task-e2e' },
  });
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

async function verifyUnauthenticatedMutation() {
  const client = await playwrightRequest.newContext({ baseURL: liveApiHarness.baseURL });
  try {
    const response = await client.post('/api/companion/tasks', {
      data: { title: 'must-not-be-created' },
      headers: { 'Idempotency-Key': 'e2e-unauthenticated-mutation' },
    });
    expect([401, 403]).toContain(response.status());
    const body = await response.json();
    expect(body.code || body.error).toBeTruthy();
  } finally {
    await client.dispose();
  }
}

async function verifyEvidenceContract(evidenceId: string) {
  if (evidenceId === 'scenario.SC-014') {
    await verifyUnauthenticatedMutation();
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
    await verifyRuntimeProcessPath();
    return;
  }

  const scenario = /^scenario\.SC-(\d{3})$/.exec(evidenceId);
  if (scenario && liveApiScenarioIds.has(Number(scenario[1]))) {
    await verifyAuthenticatedTaskLifecycle();
  }
  const contract = scenario ? scenarioContracts[Number(scenario[1])] : surfaceContracts[evidenceId];
  expect(contract, `No scenario-specific test contract mapped for ${evidenceId}`).toBeDefined();
  runVitest(contract);
}

test('canonical Task API rejects an unauthenticated mutation', async () => {
  await verifyUnauthenticatedMutation();
});

test('canonical Task API completes an authenticated lifecycle through HTTP', async () => {
  await verifyAuthenticatedTaskLifecycle();
});

test('story-companion-canonical-task-provider S-001 advances allowed lifecycle transitions exactly once', () => {
  expect(
    () => runVitest(file(taskService, 'requires waiting_on and seals completed tasks')),
    'Given a canonical Task is pending, in_progress, or waiting, when an allowed lifecycle transition is requested with the current expected version, then the Task moves to the requested state and its version advances exactly once.',
  ).not.toThrow();
});

test('story-companion-canonical-task-provider S-002 rejects transitions from completed', () => {
  expect(
    () => runVitest(file(taskService, 'requires waiting_on and seals completed tasks')),
    'Given a canonical Task is completed, when any further lifecycle transition is requested, then the API rejects it as invalid_transition and leaves the persisted Task unchanged.',
  ).not.toThrow();
});

test('story-companion-canonical-task-provider S-003 replays approval materialization without duplicates', () => {
  expect(
    () => runVitest(file(workflowMaterialization, 'replays the materialization result after an approved response was lost')),
    'Given an approved workflow output targets task_store, when materialization is retried concurrently or after a response loss, then all Tasks are created before approval is committed and every retry returns the same materialized Task IDs without duplication.',
  ).not.toThrow();
});

test('story-companion-canonical-task-provider S-004 keeps mutation fail-closed unless release evidence matches', () => {
  expect(
    () => runVitest(file('tests/server/services/canonical-task-readiness.test.js', 'stays closed when writer, evidence, manifest, schema, or HEAD do not match')),
    'Given a process starts with canonical Task mutation closed, when persisted readiness, manifest, schema, evidence, and the claimed single-writer token all match the current release, then readiness is rebound to the current process; otherwise every mutation remains fail-closed.',
  ).not.toThrow();
});

test('story-companion-canonical-task-provider S-005 fails closed on stalled NocoDB pagination', () => {
  expect(
    () => runVitest(file(taskRepository, 'fails closed when NocoDB repeats a full page instead of advancing pagination')),
    'Given NocoDB returns the same full Task page for a later offset, when the canonical repository reads the complete Task set, then it stops after detecting the repeated page and returns task_store_unavailable instead of looping or reporting an incomplete success.',
  ).not.toThrow();
});

for (const entry of registry.entries) {
  test(entry.id, async ({}, testInfo) => {
    await withCanonicalTaskEvidence(entry.id, async () => {
      await verifyEvidenceContract(entry.id);
    }, testInfo);
  });
}
