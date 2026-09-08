#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { checkCanonicalTaskColumns } from './migrate-canonical-task-columns.js';
import { checkCanonicalTaskOperationSchema } from './migrate-canonical-task-operations.js';
import { sha256 } from './evidence-reporters/canonical-task-evidence-protocol.js';
import { createCanonicalTaskStoreConfig } from '../server/services/companion/canonical-task-store-config.js';

const PRODUCER = 'scripts/capture-canonical-task-cutover-evidence.js';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base-url') parsed.baseUrl = argv[++index];
    else if (argument === '--mac-result') parsed.macResultPath = argv[++index];
    else if (argument === '--mac-source-root') parsed.macSourceRoot = argv[++index];
    else if (argument === '--out-dir') parsed.outDir = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  invariant(parsed.baseUrl, '--base-url is required');
  invariant(parsed.macResultPath, '--mac-result is required');
  invariant(parsed.outDir, '--out-dir is required');
  return parsed;
}

function gitHead(directory) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
}

function relativePathInside(root, candidate, message) {
  const relative = path.relative(root, candidate);
  invariant(
    relative
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    message,
  );
  return relative;
}

async function assertRegularPathWithoutSymlinks(root, relativePath, label) {
  const rootStat = await lstat(root);
  invariant(rootStat.isDirectory(), `${label} root is not a directory`);
  invariant(!rootStat.isSymbolicLink(), `${label} root must not be a symbolic link`);

  let current = root;
  for (const segment of relativePath.split(path.sep)) {
    current = path.join(current, segment);
    const currentStat = await lstat(current);
    invariant(!currentStat.isSymbolicLink(), `${label} must not use a symbolic link`);
  }
  return current;
}

export async function resolveMacEvidenceSource({
  rootDir = process.cwd(),
  macResult,
  macSourceRoot,
} = {}) {
  invariant(macResult?.mac_checkout, 'Mac read-only live contract mac_checkout is required');
  invariant(path.isAbsolute(macResult.mac_checkout), 'Mac read-only live contract mac_checkout must be absolute');
  invariant(macResult.raw_log, 'Mac read-only live contract raw_log is required');

  const originalCheckout = path.resolve(macResult.mac_checkout);
  const originalRawLog = path.isAbsolute(macResult.raw_log)
    ? path.resolve(macResult.raw_log)
    : path.resolve(originalCheckout, macResult.raw_log);
  const rawLogRelativePath = relativePathInside(
    originalCheckout,
    originalRawLog,
    'Mac read-only live contract raw_log is outside the original Mac checkout',
  );

  if (!macSourceRoot) {
    return {
      checkout: originalCheckout,
      originalCheckout,
      rawLogPath: originalRawLog,
    };
  }

  const snapshotRoot = path.resolve(rootDir, macSourceRoot);
  const snapshotRawLog = path.resolve(snapshotRoot, rawLogRelativePath);
  const snapshotRelativeRawLog = relativePathInside(
    snapshotRoot,
    snapshotRawLog,
    'Transported Mac raw_log escapes the snapshot root',
  );
  const checkedRawLog = await assertRegularPathWithoutSymlinks(
    snapshotRoot,
    snapshotRelativeRawLog,
    'Transported Mac raw_log',
  );
  const rawLogStat = await lstat(checkedRawLog);
  invariant(rawLogStat.isFile(), 'Transported Mac raw_log is not a regular file');
  invariant(gitHead(snapshotRoot) === macResult.head_sha, 'Mac read-only live contract source HEAD is stale');
  const rawLogBytes = await readFile(checkedRawLog);
  invariant(sha256(rawLogBytes) === macResult.raw_log_hash, 'Mac read-only live contract raw log hash mismatch');

  return {
    checkout: snapshotRoot,
    originalCheckout,
    rawLogPath: checkedRawLog,
  };
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unavailable or invalid: ${error.message}`, { cause: error });
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* validated by caller */ }
  return { status: response.status, body };
}

export async function captureClosedRuntimeTaskProbes({
  baseUrl,
  taskToken,
  requestJsonImpl = requestJson,
} = {}) {
  invariant(baseUrl, 'Canonical Task probe base URL is required');
  invariant(taskToken, 'Canonical Task probe bearer token is required');
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${taskToken}` };
  const readEndpoint = `${normalizedBaseUrl}/api/companion/tasks?limit=1`;
  const readProbe = await requestJsonImpl(readEndpoint, { headers });
  invariant(readProbe.status === 200, `Canonical Task live read probe failed: ${readProbe.status}`);
  invariant(Array.isArray(readProbe.body?.items), 'Canonical Task live read probe response is invalid');

  const mutationEndpoint = `${normalizedBaseUrl}/api/companion/tasks/cutover-readiness-probe`;
  const mutationProbe = await requestJsonImpl(mutationEndpoint, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expected_version: 1,
      title: 'cutover-readiness-probe',
    }),
  });
  invariant(
    mutationProbe.status === 503 && mutationProbe.body?.code === 'canonical_task_mutation_not_ready',
    `Canonical Task fail-closed mutation probe failed: ${mutationProbe.status}`,
  );

  return {
    read: { status: readProbe.status, endpoint: readEndpoint },
    mutation: {
      method: 'PATCH',
      status: mutationProbe.status,
      endpoint: mutationEndpoint,
      code: mutationProbe.body.code,
    },
  };
}

async function writeArtifact({ rootDir, outDir, name, sourceHead, details, log }) {
  const logPath = path.join(outDir, `${name}.log`);
  const artifactPath = path.join(outDir, `${name}.json`);
  const logBytes = Buffer.from(`${log.trim()}\n`);
  await writeFile(logPath, logBytes);
  const artifact = {
    pass: true,
    source_head: sourceHead,
    exit_code: 0,
    producer: PRODUCER,
    command: `node ${PRODUCER} --base-url <url> --mac-result <path> --out-dir <path>`,
    raw_log_path: path.relative(rootDir, logPath).split(path.sep).join('/'),
    raw_log_hash: sha256(logBytes),
    ...details,
  };
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifactPath;
}

export async function captureCanonicalTaskCutoverEvidence({
  rootDir = process.cwd(),
  baseUrl,
  macResultPath,
  macSourceRoot,
  outDir,
} = {}) {
  const sourceHead = gitHead(rootDir);
  const storeConfig = createCanonicalTaskStoreConfig();
  const absoluteOutDir = path.resolve(rootDir, outDir);
  await mkdir(absoluteOutDir, { recursive: true });

  const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
  invariant(databaseUrl, 'INFO_SSOT_DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl });
  let postgres;
  try {
    const schema = await checkCanonicalTaskOperationSchema(pool);
    const writer = await pool.query(
      `SELECT writer_token, process_identity, source_head
       FROM canonical_task_writer WHERE singleton_id = TRUE`,
    );
    invariant(writer.rowCount === 1, 'Canonical Task active writer is missing');
    invariant(writer.rows[0].writer_token, 'Canonical Task active writer token is missing');
    invariant(writer.rows[0].source_head === sourceHead, 'Canonical Task writer HEAD does not match current HEAD');
    postgres = { schema, writer: writer.rows[0] };
  } finally {
    await pool.end();
  }

  const nocoToken = process.env.NOCODB_TOKEN || process.env.NOCODB_API_TOKEN;
  invariant(nocoToken, 'NOCODB_TOKEN is required');
  const nocoUrl = (process.env.NOCODB_URL || 'https://noco.unson.jp').replace(/\/$/, '');
  const metadataResponse = await requestJson(`${nocoUrl}/api/v2/meta/tables/${storeConfig.tableId}`, {
    headers: { 'xc-token': nocoToken },
  });
  invariant(metadataResponse.status === 200, `NocoDB metadata check failed: ${metadataResponse.status}`);
  const columnResult = checkCanonicalTaskColumns(metadataResponse.body);

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const version = await requestJson(`${normalizedBaseUrl}/api/version`);
  invariant(version.status === 200, `Brainbase version probe failed: ${version.status}`);
  const runtime = version.body?.runtime;
  invariant(runtime?.git?.sha === sourceHead, 'Brainbase runtime HEAD does not match current HEAD');
  invariant(path.resolve(runtime?.cwd || '') === path.resolve(rootDir), 'Brainbase runtime cwd does not match current checkout');
  invariant(Number.isInteger(runtime?.pid) && runtime.pid > 0, 'Brainbase runtime pid is invalid');
  const taskToken = process.env.BRAINBASE_TASK_LIVE_BEARER_TOKEN || process.env.BRAINBASE_SERVICE_TOKEN;
  invariant(taskToken, 'BRAINBASE_TASK_LIVE_BEARER_TOKEN or BRAINBASE_SERVICE_TOKEN is required');
  const taskProbes = await captureClosedRuntimeTaskProbes({
    baseUrl: normalizedBaseUrl,
    taskToken,
  });

  const absoluteMacResultPath = path.resolve(macResultPath);
  const macResult = await readJson(absoluteMacResultPath, 'Mac read-only live contract result');
  invariant(macResult.status === 'pass', 'Mac read-only live contract did not pass');
  invariant(macResult.exit_code === 0, 'Mac read-only live contract exit_code is not zero');
  invariant(macResult.provider_source_head === sourceHead, 'Mac read-only live contract provider HEAD mismatch');
  const macSource = await resolveMacEvidenceSource({ rootDir, macResult, macSourceRoot });
  if (!macSourceRoot) {
    invariant(gitHead(macSource.checkout) === macResult.head_sha, 'Mac read-only live contract source HEAD is stale');
  }
  const copiedMacLog = path.join(absoluteOutDir, 'mac-source.log');
  await copyFile(macSource.rawLogPath, copiedMacLog);
  const macRawBytes = await readFile(copiedMacLog);
  invariant(sha256(macRawBytes) === macResult.raw_log_hash, 'Mac read-only live contract raw log hash mismatch');

  const paths = {};
  paths.postgres = await writeArtifact({
    rootDir,
    outDir: absoluteOutDir,
    name: 'postgres',
    sourceHead,
    log: JSON.stringify({ ok: true, tables: postgres.schema.tables, writer_source_head: postgres.writer.source_head }),
    details: {
      artifact_schema: 'canonical-task-postgres-check-v1',
      check_kind: 'persistent_postgres',
      schema_version: storeConfig.schemaVersion,
      writer_token: postgres.writer.writer_token,
      required_tables: postgres.schema.tables,
      process_identity: postgres.writer.process_identity,
    },
  });
  paths.nocodb = await writeArtifact({
    rootDir,
    outDir: absoluteOutDir,
    name: 'nocodb',
    sourceHead,
    log: JSON.stringify({ ok: true, table_id: storeConfig.tableId, columns: columnResult.columns }),
    details: {
      artifact_schema: 'canonical-task-nocodb-check-v1',
      check_kind: 'persistent_nocodb',
      schema_version: storeConfig.schemaVersion,
      table_id: storeConfig.tableId,
      required_columns: columnResult.columns.length,
    },
  });
  paths.runtime = await writeArtifact({
    rootDir,
    outDir: absoluteOutDir,
    name: 'runtime',
    sourceHead,
    log: JSON.stringify({
      ok: true,
      pid: runtime.pid,
      port: runtime.port,
      cwd: runtime.cwd,
      source_head: runtime.git.sha,
      read_status: taskProbes.read.status,
      mutation_status: taskProbes.mutation.status,
    }),
    details: {
      artifact_schema: 'canonical-task-runtime-check-v1',
      check_kind: 'brainbase_server_process',
      runtime_kind: 'brainbase_server',
      process: { pid: runtime.pid, port: Number(runtime.port), cwd: runtime.cwd, source_head: runtime.git.sha },
      probe: taskProbes.read,
      mutation_probe: taskProbes.mutation,
    },
  });
  paths.mac = await writeArtifact({
    rootDir,
    outDir: absoluteOutDir,
    name: 'mac',
    sourceHead,
    log: JSON.stringify({ ok: true, mac_source_head: macResult.head_sha, provider_source_head: sourceHead, source_log_hash: macResult.raw_log_hash }),
    details: {
      artifact_schema: 'canonical-task-mac-consumer-check-v1',
      check_kind: 'mac_live_read_only_contract',
      provider_source_head: sourceHead,
      mac_source_head: macResult.head_sha,
      mac_checkout: macSource.originalCheckout,
      source_raw_log_path: path.relative(rootDir, copiedMacLog).split(path.sep).join('/'),
      source_raw_log_hash: sha256(macRawBytes),
      read_only_contract: { pass: true, exit_code: 0, matched_tests: macResult.matched_tests },
    },
  });
  return paths;
}

async function main() {
  try {
    const paths = await captureCanonicalTaskCutoverEvidence(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ pass: true, artifacts: paths })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ pass: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
