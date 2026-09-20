#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
    else if (argument === '--out-dir') parsed.outDir = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  invariant(parsed.baseUrl, '--base-url is required');
  invariant(parsed.outDir, '--out-dir is required');
  return parsed;
}

function gitHead(directory) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
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
    command: `node ${PRODUCER} --base-url <url> --out-dir <path>`,
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
