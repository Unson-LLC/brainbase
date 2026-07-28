import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildEffectiveInvocation,
  collectCanonicalTaskEvidence,
  evaluateRunnerEvidence,
  validateEvidenceRegistry,
  writeCanonicalTaskEvidenceAggregate,
} from '../../../scripts/collect-canonical-task-evidence.js';
import { captureClosedRuntimeTaskProbes } from '../../../scripts/capture-canonical-task-cutover-evidence.js';
import {
  buildBeforeEnableEvidence,
  checkCanonicalTaskWriterPolicy,
  runCanonicalTaskCutoverPreflight,
  verifyEvidenceArtifact,
  verifyBeforeEnableEvidenceFile,
} from '../../../scripts/preflight-canonical-task-cutover.js';
import { setCanonicalTaskReadiness } from '../../../scripts/set-canonical-task-readiness.js';

const NONCE = 'b'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function registryFixture(entryOverrides = {}) {
  return {
    schema_version: '1.0.0',
    story_id: 'story-companion-canonical-task-provider',
    source_of_truth: 'config/canonical-task-evidence-registry.json',
    required_entry_count: 1,
    collector: 'scripts/collect-canonical-task-evidence.js',
    effective_invocation: {
      spawn_mode: 'argv-with-explicit-env',
      required_env: {
        VIBEPRO_EVIDENCE_ID: '<evidence-id>',
        VIBEPRO_EVIDENCE_RESULT: '<runner-result-path>',
        VIBEPRO_EVIDENCE_NONCE: '<collector-generated-64-hex>',
      },
      nonce_hash: 'sha256',
      reject_unregistered_env: true,
    },
    runner_adapters: {
      playwright: {
        match_prefix: 'npx playwright test ',
        reporter: 'scripts/evidence-reporters/canonical-task-playwright-reporter.js',
        effective_command_template: '<registered-test-command> --reporter=scripts/evidence-reporters/canonical-task-playwright-reporter.js',
        result_path_template: '.vibepro/verification/canonical-task-cutover/runner/<evidence-id>.json',
      },
      vitest: {
        match_prefix: 'npx vitest run ',
        reporter: 'scripts/evidence-reporters/canonical-task-vitest-reporter.js',
        effective_command_template: '<registered-test-command> --reporter=scripts/evidence-reporters/canonical-task-vitest-reporter.js',
        result_path_template: '.vibepro/verification/canonical-task-cutover/runner/<evidence-id>.json',
      },
      node_test: {
        match_prefix: 'node --test ',
        reporter: 'tap',
        reporter_hash_rule: 'sha256(node:<runtime-version>:node:test:tap)',
        effective_command_template: '<registered-test-command>',
        result_path_template: '.vibepro/verification/canonical-task-cutover/runner/<evidence-id>.tap',
      },
    },
    entries: [{
      id: 'scenario.SC-001',
      producer_command: 'node scripts/collect-canonical-task-evidence.js --id scenario.SC-001',
      owner_path: 'tests/e2e/owner.spec.ts',
      test_command: 'npx playwright test tests/e2e/owner.spec.ts --grep "scenario.SC-001"',
      artifact_path: '.vibepro/verification/canonical-task-cutover/raw/scenario.SC-001.json',
      artifact_schema: 'canonical-task-evidence-v1',
      pre_fix_assertion: 'fails before implementation',
      ...entryOverrides,
    }],
  };
}

async function createEvidenceFixture(overrides = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'canonical-task-preflight-'));
  const registry = registryFixture(overrides.entry);
  const registryPath = path.join(rootDir, 'config/canonical-task-evidence-registry.json');
  const ownerPath = path.join(rootDir, registry.entries[0].owner_path);
  const reporterPath = path.join(rootDir, registry.runner_adapters.playwright.reporter);
  const runnerResultPath = path.join(
    rootDir,
    '.vibepro/verification/canonical-task-cutover/runner/scenario.SC-001.json',
  );
  const stdoutPath = path.join(
    rootDir,
    '.vibepro/verification/canonical-task-cutover/stdout/scenario.SC-001.log',
  );
  const artifactPath = path.join(rootDir, registry.entries[0].artifact_path);
  const manifestPath = path.join(rootDir, 'config/canonical-task-store.json');
  const cutoverDirectory = path.join(rootDir, '.vibepro/verification/canonical-task-cutover/checks');
  await Promise.all([
    mkdir(path.dirname(registryPath), { recursive: true }),
    mkdir(path.dirname(ownerPath), { recursive: true }),
    mkdir(path.dirname(reporterPath), { recursive: true }),
    mkdir(path.dirname(runnerResultPath), { recursive: true }),
    mkdir(path.dirname(stdoutPath), { recursive: true }),
    mkdir(path.dirname(artifactPath), { recursive: true }),
    mkdir(cutoverDirectory, { recursive: true }),
  ]);

  const registryBytes = `${JSON.stringify(registry, null, 2)}\n`;
  const ownerBytes = 'test("scenario.SC-001", () => {});\n';
  const reporterBytes = 'export default class Reporter {}\n';
  const runnerResult = overrides.runnerResult ?? {
    protocol: 'canonical-task-runner-evidence-v1',
    schema_version: '1.0.0',
    adapter: 'playwright',
    evidence_id: 'scenario.SC-001',
    nonce_hash: sha256(NONCE),
    tests: [{
      title: 'scenario.SC-001',
      status: 'passed',
      final_events: [{
        kind: 'canonical-task-evidence-final',
        evidence_id: 'scenario.SC-001',
        nonce: NONCE,
        marker: `VIBEPRO_ASSERT:scenario.SC-001:${NONCE}`,
      }],
    }],
  };
  const runnerBytes = `${JSON.stringify(runnerResult, null, 2)}\n`;
  const stdoutBytes = overrides.stdout ?? '1 passed\n';
  const manifest = {
    schema_version: '1.0.0',
    base_id: 'pva7l2qlu6fdfip',
    table_id: 'm7iys8m7o1abr3f',
    table_name: 'タスク',
    project: 'brainbase',
    owner_person_id: 'sato_keigo',
  };

  await Promise.all([
    writeFile(registryPath, registryBytes),
    writeFile(ownerPath, ownerBytes),
    writeFile(reporterPath, reporterBytes),
    writeFile(runnerResultPath, runnerBytes),
    writeFile(stdoutPath, stdoutBytes),
    writeFile(manifestPath, `${JSON.stringify(manifest)}\n`),
  ]);

  const invocation = buildEffectiveInvocation({
    registry,
    entry: registry.entries[0],
    rootDir,
    nonce: NONCE,
  });
  const artifact = {
    artifact_schema: 'canonical-task-evidence-v1',
    evidence_id: 'scenario.SC-001',
    pass: true,
    source_head: 'abc123',
    registry_path: registry.source_of_truth,
    registry_hash: sha256(registryBytes),
    owner_path: registry.entries[0].owner_path,
    owner_hash: sha256(ownerBytes),
    producer_command: registry.entries[0].producer_command,
    registered_test_command: registry.entries[0].test_command,
    registered_argv: invocation.registeredArgv,
    effective_argv: invocation.effectiveArgv,
    effective_env: invocation.effectiveEnv,
    nonce_hash: sha256(NONCE),
    adapter: 'playwright',
    reporter: registry.runner_adapters.playwright.reporter,
    reporter_hash: sha256(reporterBytes),
    runner_result_path: path.relative(rootDir, runnerResultPath),
    runner_result_hash: sha256(runnerBytes),
    stdout_path: path.relative(rootDir, stdoutPath),
    stdout_hash: sha256(stdoutBytes),
    exit_code: 0,
    matched_tests: 1,
    matched_assertions: 1,
  };
  Object.assign(artifact, overrides.artifact);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const writeCheck = async (name, value) => {
    const rawLogPath = path.join(cutoverDirectory, `${name}.log`);
    const artifactPath = path.join(cutoverDirectory, `${name}.json`);
    const rawLog = `${name} verified\n`;
    await writeFile(rawLogPath, rawLog);
    const check = {
      pass: true,
      source_head: 'abc123',
      exit_code: 0,
      producer: 'scripts/capture-canonical-task-cutover-evidence.js',
      command: `capture ${name}`,
      raw_log_path: path.relative(rootDir, rawLogPath),
      raw_log_hash: sha256(rawLog),
      ...value,
    };
    await writeFile(artifactPath, `${JSON.stringify(check, null, 2)}\n`);
    return artifactPath;
  };
  const postgresCheckPath = await writeCheck('postgres', {
    artifact_schema: 'canonical-task-postgres-check-v1',
    check_kind: 'persistent_postgres',
    schema_version: '1.0.0',
    writer_token: 'writer-token-1',
    required_tables: ['canonical_task_writer', 'canonical_task_readiness', 'canonical_task_operations'],
  });
  const nocodbCheckPath = await writeCheck('nocodb', {
    artifact_schema: 'canonical-task-nocodb-check-v1',
    check_kind: 'persistent_nocodb',
    schema_version: '1.0.0',
    table_id: 'm7iys8m7o1abr3f',
    required_columns: 16,
  });
  const runtimeCheckPath = await writeCheck('runtime', {
    artifact_schema: 'canonical-task-runtime-check-v1',
    check_kind: 'brainbase_server_process',
    runtime_kind: 'brainbase_server',
    process: { pid: 1234, port: 31982, cwd: rootDir, source_head: 'abc123' },
    probe: { status: 200, endpoint: 'http://127.0.0.1:31982/api/companion/tasks?limit=1' },
    mutation_probe: {
      method: 'PATCH',
      status: 503,
      endpoint: 'http://127.0.0.1:31982/api/companion/tasks/cutover-readiness-probe',
      code: 'canonical_task_mutation_not_ready',
    },
  });
  const macCheckPath = await writeCheck('mac', {
    artifact_schema: 'canonical-task-mac-consumer-check-v1',
    check_kind: 'mac_live_read_only_contract',
    provider_source_head: 'abc123',
    mac_source_head: 'c'.repeat(40),
    mac_checkout: '/Users/ksato/workspace/code/brainbase-mac-companion',
    read_only_contract: { pass: true, exit_code: 0, matched_tests: 1 },
  });

  return {
    rootDir,
    registry,
    registryPath,
    artifactPath,
    manifestPath,
    runnerResultPath,
    stdoutPath,
    artifact,
    postgresCheckPath,
    nocodbCheckPath,
    runtimeCheckPath,
    macCheckPath,
  };
}

describe('canonical task evidence registry and runner parsing', () => {
  it('keeps the operator runbook aligned with the PostgreSQL migration and readiness backend context', async () => {
    const runbook = await readFile(
      path.join(process.cwd(), 'docs/runbooks/canonical-task-cutover.md'),
      'utf8',
    );
    const workflow = await readFile(
      path.join(process.cwd(), 'scripts/run-canonical-task-postgres-migration-workflow.js'),
      'utf8',
    );

    const dryRun = workflow.indexOf("{ name: 'dry-run', argv: ['--dry-run'] }");
    const initialCheck = workflow.indexOf("{ name: 'check', argv: ['--check'] }", dryRun);
    const apply = workflow.indexOf("{ name: 'apply', argv: ['--apply'] }", initialCheck);
    const finalCheck = workflow.indexOf("{ name: 'final-check', argv: ['--check'] }", apply);

    expect(runbook).toContain('npm run migrate:canonical-task-postgres-workflow');
    expect(dryRun).toBeGreaterThan(-1);
    expect(initialCheck).toBeGreaterThan(dryRun);
    expect(apply).toBeGreaterThan(initialCheck);
    expect(finalCheck).toBeGreaterThan(apply);
    expect(runbook).toContain('pending_count: 0');
    expect(runbook).toContain('conflict_count: 0');
    expect(runbook).toContain(
      'CANONICAL_TASK_BACKEND=postgres npm run canonical-task:readiness -- --enable --evidence',
    );
    expect(runbook).toContain('backend mismatch');
  });

  it('requires a complete registry with unique IDs, artifact paths, and one registered adapter', () => {
    expect(validateEvidenceRegistry(registryFixture())).toHaveLength(1);
    const duplicate = registryFixture();
    duplicate.required_entry_count = 2;
    duplicate.entries.push({ ...duplicate.entries[0] });
    expect(() => validateEvidenceRegistry(duplicate)).toThrow(/duplicate evidence id/i);
  });

  it('derives effective argv, result path, and exactly the registered evidence env without a shell', () => {
    const registry = registryFixture();
    const invocation = buildEffectiveInvocation({
      registry,
      entry: registry.entries[0],
      rootDir: process.cwd(),
      nonce: NONCE,
      inheritedEnv: {
        PATH: '/bin',
        VIBEPRO_EVIDENCE_RESULT: '/forged/result.json',
        VIBEPRO_EVIDENCE_EXTRA: 'forged',
      },
    });

    expect(invocation.command).toBe('npx');
    expect(invocation.effectiveArgv).toEqual([
      'npx', 'playwright', 'test', 'tests/e2e/owner.spec.ts', '--grep', 'scenario.SC-001',
      '--reporter=scripts/evidence-reporters/canonical-task-playwright-reporter.js',
    ]);
    expect(invocation.spawnOptions.shell).toBe(false);
    expect(Object.keys(invocation.spawnOptions.env).filter((key) => key.startsWith('VIBEPRO_EVIDENCE_')).sort())
      .toEqual(['VIBEPRO_EVIDENCE_ID', 'VIBEPRO_EVIDENCE_NONCE', 'VIBEPRO_EVIDENCE_RESULT']);
    expect(invocation.effectiveEnv.VIBEPRO_EVIDENCE_RESULT)
      .toBe('.vibepro/verification/canonical-task-cutover/runner/scenario.SC-001.json');
  });

  it('fails closed for zero tests, zero final markers, failed tests, wrong titles, and duplicates', () => {
    const base = {
      protocol: 'canonical-task-runner-evidence-v1',
      adapter: 'playwright',
      evidence_id: 'scenario.SC-001',
      nonce_hash: sha256(NONCE),
      tests: [],
    };
    expect(evaluateRunnerEvidence({ adapterKey: 'playwright', result: base, evidenceId: 'scenario.SC-001', nonce: NONCE }))
      .toMatchObject({ matchedTests: 0, matchedAssertions: 0 });

    const event = {
      kind: 'canonical-task-evidence-final', evidence_id: 'scenario.SC-001', nonce: NONCE,
      marker: `VIBEPRO_ASSERT:scenario.SC-001:${NONCE}`,
    };
    for (const test of [
      { title: 'scenario.SC-001', status: 'passed', final_events: [] },
      { title: 'scenario.SC-001', status: 'failed', final_events: [event] },
      { title: 'scenario.SC-001', status: 'skipped', final_events: [event] },
      { title: 'scenario.SC-002', status: 'passed', final_events: [event] },
      { title: 'scenario.SC-001', status: 'passed', final_events: [event, event] },
    ]) {
      const parsed = evaluateRunnerEvidence({
        adapterKey: 'playwright',
        result: { ...base, tests: [test] },
        evidenceId: 'scenario.SC-001',
        nonce: NONCE,
      });
      expect(parsed.matchedAssertions).toBe(0);
      expect(parsed.errors.length).toBeGreaterThan(0);
    }
  });

  it('correlates a Node TAP diagnostic only with its exact passing subtest', () => {
    const validTap = [
      'TAP version 13',
      '# Subtest: scenario.SC-001',
      `    # VIBEPRO_ASSERT:scenario.SC-001:${NONCE}`,
      'ok 1 - scenario.SC-001',
      '1..1',
      '',
    ].join('\n');
    expect(evaluateRunnerEvidence({
      adapterKey: 'node_test',
      result: validTap,
      evidenceId: 'scenario.SC-001',
      nonce: NONCE,
    })).toMatchObject({ matchedTests: 1, matchedAssertions: 1, errors: [] });

    const forgedGlobalTap = `# VIBEPRO_ASSERT:scenario.SC-001:${NONCE}\n${validTap}`;
    expect(evaluateRunnerEvidence({
      adapterKey: 'node_test',
      result: forgedGlobalTap,
      evidenceId: 'scenario.SC-001',
      nonce: NONCE,
    })).toMatchObject({ matchedTests: 1, matchedAssertions: 0 });
  });
});

describe('canonical task evidence collector', () => {
  it('writes a passing artifact only after independently correlating the reporter result', async () => {
    const fixture = await createEvidenceFixture();
    const registryPath = path.relative(fixture.rootDir, fixture.registryPath);

    const artifact = await collectCanonicalTaskEvidence({
      id: 'scenario.SC-001',
      rootDir: fixture.rootDir,
      registryPath,
      nonce: NONCE,
      sourceHead: 'abc123',
      inheritedEnv: { PATH: '/bin', VIBEPRO_EVIDENCE_EXTRA: 'forged' },
      spawnImpl: async (_command, _args, options) => {
        const runnerPath = path.join(fixture.rootDir, options.env.VIBEPRO_EVIDENCE_RESULT);
        await writeFile(runnerPath, `${JSON.stringify({
          protocol: 'canonical-task-runner-evidence-v1',
          schema_version: '1.0.0',
          adapter: 'playwright',
          evidence_id: options.env.VIBEPRO_EVIDENCE_ID,
          nonce_hash: sha256(options.env.VIBEPRO_EVIDENCE_NONCE),
          tests: [{
            title: 'scenario.SC-001',
            status: 'passed',
            final_events: [{
              kind: 'canonical-task-evidence-final',
              evidence_id: 'scenario.SC-001',
              nonce: options.env.VIBEPRO_EVIDENCE_NONCE,
              marker: `VIBEPRO_ASSERT:scenario.SC-001:${options.env.VIBEPRO_EVIDENCE_NONCE}`,
            }],
          }],
        }, null, 2)}\n`);
        return { exitCode: 0, signal: null, stdout: Buffer.from('1 passed\n'), stderr: Buffer.alloc(0) };
      },
    });

    expect(artifact).toMatchObject({
      pass: true,
      evidence_id: 'scenario.SC-001',
      matched_tests: 1,
      matched_assertions: 1,
      exit_code: 0,
    });
    expect(Object.keys(artifact.effective_env).sort())
      .toEqual(['VIBEPRO_EVIDENCE_ID', 'VIBEPRO_EVIDENCE_NONCE', 'VIBEPRO_EVIDENCE_RESULT']);
    expect(JSON.parse(await readFile(fixture.artifactPath, 'utf8'))).toEqual(artifact);
  });

  it('writes failed evidence when the registered test process cannot start', async () => {
    const fixture = await createEvidenceFixture();
    const artifact = await collectCanonicalTaskEvidence({
      id: 'scenario.SC-001',
      rootDir: fixture.rootDir,
      registryPath: path.relative(fixture.rootDir, fixture.registryPath),
      nonce: NONCE,
      sourceHead: 'abc123',
      spawnImpl: async () => { throw new Error('spawn denied'); },
    });

    expect(artifact).toMatchObject({ pass: false, exit_code: 1, matched_tests: 0, matched_assertions: 0 });
    expect(artifact.errors.join('\n')).toMatch(/failed to start|runner result unavailable/);
    expect(JSON.parse(await readFile(fixture.artifactPath, 'utf8'))).toEqual(artifact);
  });
});

describe('before-enable evidence preflight', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts one current, registered, independently reparsed artifact', async () => {
    const fixture = await createEvidenceFixture();
    await expect(verifyEvidenceArtifact({
      rootDir: fixture.rootDir,
      registry: fixture.registry,
      registryHash: fixture.artifact.registry_hash,
      entry: fixture.registry.entries[0],
      sourceHead: 'abc123',
    })).resolves.toMatchObject({ evidence_id: 'scenario.SC-001', matched_tests: 1, matched_assertions: 1 });
  });

  it.each([
    ['zero matched tests', { artifact: { matched_tests: 0 } }, /matched_tests/],
    ['zero matched assertions', { artifact: { matched_assertions: 0 } }, /matched_assertions/],
    ['tampered count', { artifact: { matched_tests: 2 } }, /matched_tests/],
    ['changed result path', { artifact: { runner_result_path: 'forged.json' } }, /runner_result_path/],
    ['changed reporter hash', { artifact: { reporter_hash: '0'.repeat(64) } }, /reporter_hash/],
  ])('rejects %s', async (_name, overrides, expected) => {
    const fixture = await createEvidenceFixture(overrides);
    await expect(verifyEvidenceArtifact({
      rootDir: fixture.rootDir,
      registry: fixture.registry,
      registryHash: fixture.artifact.registry_hash,
      entry: fixture.registry.entries[0],
      sourceHead: 'abc123',
    })).rejects.toThrow(expected);
  });

  it('rejects tampered raw stdout and global forged markers', async () => {
    const fixture = await createEvidenceFixture();
    await writeFile(fixture.stdoutPath, `VIBEPRO_ASSERT:scenario.SC-001:${NONCE}\n`);
    await expect(verifyEvidenceArtifact({
      rootDir: fixture.rootDir,
      registry: fixture.registry,
      registryHash: fixture.artifact.registry_hash,
      entry: fixture.registry.entries[0],
      sourceHead: 'abc123',
    })).rejects.toThrow(/stdout_(hash|marker)/);
  });

  it('builds a canonical before-enable artifact bound to all registry entries and cutover inputs', async () => {
    const fixture = await createEvidenceFixture();
    const outputPath = path.join(fixture.rootDir, 'before-enable.json');
    const output = await buildBeforeEnableEvidence({
      rootDir: fixture.rootDir,
      registryPath: fixture.registryPath,
      evidenceOut: outputPath,
      sourceHead: 'abc123',
      manifestPath: fixture.manifestPath,
      postgresCheckPath: fixture.postgresCheckPath,
      nocodbCheckPath: fixture.nocodbCheckPath,
      runtimeCheckPath: fixture.runtimeCheckPath,
      macCheckPath: fixture.macCheckPath,
    });

    expect(output).toMatchObject({
      artifact_schema: 'canonical-task-cutover-evidence-v1',
      phase: 'before-enable',
      pass: true,
      source_head: 'abc123',
      backend: 'nocodb',
      schema_version: '1.0.0',
      writer_token: 'writer-token-1',
      required_evidence_ids: ['scenario.SC-001'],
    });
    expect(output.cutover_checks).toHaveLength(4);
    expect(output.evidence).toHaveLength(1);
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(output);
    await expect(verifyBeforeEnableEvidenceFile({
      rootDir: fixture.rootDir,
      evidencePath: outputPath,
      sourceHead: 'abc123',
      registryPath: fixture.registryPath,
      manifestPath: fixture.manifestPath,
    })).resolves.toMatchObject({ evidence: output, absolutePath: outputPath });
  });

  it('rejects a passing-looking before-enable summary that omits independently verifiable inputs', async () => {
    const fixture = await createEvidenceFixture();
    const outputPath = path.join(fixture.rootDir, 'forged-before-enable.json');
    await writeFile(outputPath, `${JSON.stringify({
      artifact_schema: 'canonical-task-cutover-evidence-v1',
      phase: 'before-enable',
      pass: true,
      source_head: 'abc123',
      backend: 'nocodb',
      schema_version: '1.0.0',
      writer_token: 'writer-token-1',
      evidence: [{ pass: true }],
    })}\n`);

    await expect(verifyBeforeEnableEvidenceFile({
      rootDir: fixture.rootDir,
      evidencePath: outputPath,
      sourceHead: 'abc123',
      registryPath: fixture.registryPath,
      manifestPath: fixture.manifestPath,
    })).rejects.toThrow(/cutover_checks/i);
  });

  it('re-verifies the complete artifact before the readiness CLI opens mutations', async () => {
    const fixture = await createEvidenceFixture();
    const outputPath = path.join(fixture.rootDir, 'before-enable.json');
    vi.stubEnv('CANONICAL_TASK_BACKEND', 'postgres');
    await buildBeforeEnableEvidence({
      rootDir: fixture.rootDir,
      registryPath: fixture.registryPath,
      evidenceOut: outputPath,
      sourceHead: 'abc123',
      manifestPath: fixture.manifestPath,
      postgresCheckPath: fixture.postgresCheckPath,
      nocodbCheckPath: fixture.nocodbCheckPath,
      runtimeCheckPath: fixture.runtimeCheckPath,
      macCheckPath: fixture.macCheckPath,
      backend: 'postgres',
    });
    vi.stubEnv('CANONICAL_TASK_STORE_MANIFEST', fixture.manifestPath);
    const queries = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT writer_token, source_head')) {
          return { rowCount: 1, rows: [{ writer_token: 'writer-token-1', source_head: 'abc123' }] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };

    const result = await setCanonicalTaskReadiness({
      argv: ['--enable', '--evidence', outputPath],
      pool: { connect: vi.fn().mockResolvedValue(client) },
      rootDir: fixture.rootDir,
      sourceHead: 'abc123',
    });

    expect(result).toMatchObject({ ready: true, source_head: 'abc123' });
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO canonical_task_readiness'))).toBe(true);
    expect(queries.at(-1).sql).toBe('COMMIT');
  });

  it('rejects evidence produced for a different canonical task backend', async () => {
    const fixture = await createEvidenceFixture();
    const outputPath = path.join(fixture.rootDir, 'before-enable.json');
    await buildBeforeEnableEvidence({
      rootDir: fixture.rootDir,
      registryPath: fixture.registryPath,
      evidenceOut: outputPath,
      sourceHead: 'abc123',
      manifestPath: fixture.manifestPath,
      postgresCheckPath: fixture.postgresCheckPath,
      nocodbCheckPath: fixture.nocodbCheckPath,
      runtimeCheckPath: fixture.runtimeCheckPath,
      macCheckPath: fixture.macCheckPath,
      backend: 'nocodb',
    });
    vi.stubEnv('CANONICAL_TASK_STORE_MANIFEST', fixture.manifestPath);
    vi.stubEnv('CANONICAL_TASK_BACKEND', 'postgres');
    const client = {
      query: vi.fn(async () => ({ rowCount: 1, rows: [] })),
      release: vi.fn(),
    };

    await expect(setCanonicalTaskReadiness({
      argv: ['--enable', '--evidence', outputPath],
      pool: { connect: vi.fn().mockResolvedValue(client) },
      rootDir: fixture.rootDir,
      sourceHead: 'abc123',
    })).rejects.toThrow(/backend mismatch/);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('writes an auditable aggregate for the exact source HEAD', async () => {
    const fixture = await createEvidenceFixture();
    const registryBytes = await readFile(fixture.registryPath);
    const result = await writeCanonicalTaskEvidenceAggregate({
      rootDir: fixture.rootDir,
      registry: fixture.registry,
      registryBytes,
      sourceHead: 'abc123',
      artifacts: [fixture.artifact],
    });

    expect(result.aggregate).toMatchObject({
      artifact_schema: 'canonical-task-evidence-aggregate-v1',
      source_head: 'abc123',
      total: 1,
      passed: 1,
      failed: [],
    });
    expect(result.aggregate.evidence[0]).toMatchObject({
      evidence_id: 'scenario.SC-001',
      pass: true,
      artifact_path: fixture.registry.entries[0].artifact_path,
    });
    expect(result.aggregatePath).toContain('evidence-all-abc123.json');
    expect(JSON.parse(await readFile(result.aggregatePath, 'utf8'))).toEqual(result.aggregate);
  });

  it('rejects an unregistered raw evidence artifact', async () => {
    const fixture = await createEvidenceFixture();
    const unknownPath = path.join(path.dirname(fixture.artifactPath), 'unregistered.json');
    await writeFile(unknownPath, '{}\n');

    await expect(buildBeforeEnableEvidence({
      rootDir: fixture.rootDir,
      registryPath: fixture.registryPath,
      evidenceOut: path.join(fixture.rootDir, 'before-enable.json'),
      sourceHead: 'abc123',
      manifestPath: fixture.manifestPath,
      postgresCheckPath: fixture.postgresCheckPath,
      nocodbCheckPath: fixture.nocodbCheckPath,
      runtimeCheckPath: fixture.runtimeCheckPath,
      macCheckPath: fixture.macCheckPath,
    })).rejects.toThrow(/unregistered evidence artifact/i);
  });

  it.each([
    ['missing Postgres check', 'postgresCheckPath', null, /postgres-check/i],
    ['stale runtime HEAD', 'runtimeCheckPath', { source_head: 'old-head' }, /source_head/i],
    ['in-memory runtime harness', 'runtimeCheckPath', { runtime_kind: 'in_memory_harness' }, /runtime_kind/i],
    ['open runtime mutation gate', 'runtimeCheckPath', { mutation_probe: { method: 'PATCH', status: 404, code: 'not_found' } }, /status mismatch/i],
    ['failed Mac read-only contract', 'macCheckPath', { read_only_contract: { pass: false, exit_code: 1, matched_tests: 0 } }, /read_only_contract/i],
  ])('rejects %s', async (_name, field, mutation, expected) => {
    const fixture = await createEvidenceFixture();
    if (mutation) {
      const artifact = JSON.parse(await readFile(fixture[field], 'utf8'));
      await writeFile(fixture[field], `${JSON.stringify({ ...artifact, ...mutation }, null, 2)}\n`);
    }
    await expect(buildBeforeEnableEvidence({
      rootDir: fixture.rootDir,
      registryPath: fixture.registryPath,
      evidenceOut: path.join(fixture.rootDir, 'before-enable.json'),
      sourceHead: 'abc123',
      manifestPath: fixture.manifestPath,
      postgresCheckPath: field === 'postgresCheckPath' && mutation === null ? null : fixture.postgresCheckPath,
      nocodbCheckPath: fixture.nocodbCheckPath,
      runtimeCheckPath: fixture.runtimeCheckPath,
      macCheckPath: fixture.macCheckPath,
    })).rejects.toThrow(expected);
  });
});

describe('closed runtime cutover probes', () => {
  it('captures readable tasks and a fail-closed mutation from the same runtime', async () => {
    const requestJsonImpl = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: { items: [] } })
      .mockResolvedValueOnce({
        status: 503,
        body: { code: 'canonical_task_mutation_not_ready' },
      });

    const result = await captureClosedRuntimeTaskProbes({
      baseUrl: 'http://127.0.0.1:31982',
      taskToken: 'secret',
      requestJsonImpl,
    });

    expect(result.read.status).toBe(200);
    expect(result.mutation).toMatchObject({
      method: 'PATCH',
      status: 503,
      code: 'canonical_task_mutation_not_ready',
    });
    expect(requestJsonImpl.mock.calls[1][1]).toMatchObject({ method: 'PATCH' });
  });

  it('rejects a runtime where canonical task mutations are not fail-closed', async () => {
    const requestJsonImpl = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: { items: [] } })
      .mockResolvedValueOnce({ status: 404, body: { code: 'not_found' } });

    await expect(captureClosedRuntimeTaskProbes({
      baseUrl: 'http://127.0.0.1:31982',
      taskToken: 'secret',
      requestJsonImpl,
    })).rejects.toThrow(/fail-closed mutation probe/i);
  });
});

describe('before-migration and rollback writer-policy preflight', () => {
  const safeScript = "import './lib/canonical-task-api-client.js';\n";
  const safeWriterPolicySource = async (filePath) => {
    const relativePath = filePath.replace('/repo/', '');
    if (relativePath === 'server/controllers/nocodb-controller.js') return '_assertLegacyTaskMutationAllowed';
    if (relativePath === 'mcp/nocodb/src/nocodb-client.ts') return 'assertRecordMutationAllowed';
    return safeScript;
  };

  it.each(['before-migration', 'rollback'])('runs the built-in %s policy from the public CLI path', async (phase) => {
    const result = await runCanonicalTaskCutoverPreflight({
      phase,
      rootDir: '/repo',
      sourceHead: 'current-head',
      readFileImpl: safeWriterPolicySource,
      listProcesses: () => ['101 node server.js'],
      trackedFiles: () => [],
    });

    expect(result).toMatchObject({
      artifact_schema: 'canonical-task-writer-policy-v1',
      phase,
      pass: true,
      source_head: 'current-head',
      checks: {
        static_direct_writers: { count: 0 },
        active_direct_writer_processes: { count: 0 },
      },
    });
  });

  it('fails closed when a direct writer marker or active legacy writer is present', async () => {
    const result = await checkCanonicalTaskWriterPolicy({
      phase: 'rollback',
      rootDir: '/repo',
      sourceHead: 'current-head',
      readFileImpl: async () => "import './lib/canonical-task-api-client.js'; fetch('/api/v2/tables/task');\n",
      listProcesses: () => ['202 node scripts/update-task-status.js'],
      trackedFiles: () => [],
    });

    expect(result.pass).toBe(false);
    expect(result.checks.static_direct_writers.count).toBeGreaterThan(0);
    expect(result.checks.active_direct_writer_processes.processes).toEqual([
      '202 node scripts/update-task-status.js',
    ]);
  });

  it('fails closed when a tracked runtime file introduces an unregistered canonical table reference', async () => {
    const result = await checkCanonicalTaskWriterPolicy({
      phase: 'before-migration',
      rootDir: '/repo',
      sourceHead: 'current-head',
      readFileImpl: async (filePath) => {
        const relativePath = filePath.replace('/repo/', '');
        if (relativePath === 'server/controllers/nocodb-controller.js') return '_assertLegacyTaskMutationAllowed';
        if (relativePath === 'mcp/nocodb/src/nocodb-client.ts') return 'assertRecordMutationAllowed';
        if (relativePath === 'scripts/unregistered-writer.js') return 'const TABLE_ID = "m7iys8m7o1abr3f";';
        return safeScript;
      },
      listProcesses: () => [],
      trackedFiles: () => ['scripts/unregistered-writer.js'],
    });

    expect(result.pass).toBe(false);
    expect(result.checks.repository_writer_inventory.violations).toContainEqual({
      path: 'scripts/unregistered-writer.js',
      reason: 'unregistered_canonical_table_reference',
    });
  });
});
