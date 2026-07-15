#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REGISTRY_PATH,
  STDOUT_PATH_TEMPLATE,
  buildEffectiveInvocation,
  evaluateRunnerEvidence,
  validateEvidenceRegistry,
} from './collect-canonical-task-evidence.js';
import {
  EVIDENCE_ENV_NAMES,
  atomicWriteFile,
  sha256,
} from './evidence-reporters/canonical-task-evidence-protocol.js';

const VALID_PHASES = new Set(['before-migration', 'before-enable', 'rollback']);
const OPERATIONAL_TASK_SCRIPTS = [
  'scripts/list-high-priority-tasks.js',
  'scripts/add-frame-story-tasks.js',
  'scripts/add-framework-operation-tasks.js',
  'scripts/complete-doc-tasks.js',
  'scripts/update-task-status.js',
];
const FORBIDDEN_DIRECT_WRITER_PATTERNS = [
  /api\/v2\/tables/,
  /m7iys8m7o1abr3f/,
  /xc-(?:auth|token)/,
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

function resolveInsideRoot(rootDir, registeredPath, field) {
  invariant(typeof registeredPath === 'string' && registeredPath.length > 0, `${field} is required`);
  invariant(!path.isAbsolute(registeredPath), `${field} must be relative`);
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, registeredPath);
  invariant(resolved === root || resolved.startsWith(`${root}${path.sep}`), `${field} escapes the repository root`);
  return resolved;
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function expectField(artifact, field, expected) {
  invariant(
    sameJson(artifact[field], expected),
    `${artifact.evidence_id ?? '<unknown>'} ${field} mismatch`,
  );
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortCanonical(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortCanonical(value));
}

async function readJsonWithBytes(filePath, label) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${filePath}: ${error.message}`, { cause: error });
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${filePath}: ${error.message}`, { cause: error });
  }
}

const CUTOVER_CHECKS = Object.freeze({
  postgres: {
    option: 'postgresCheckPath',
    schema: 'canonical-task-postgres-check-v1',
    kind: 'persistent_postgres',
  },
  nocodb: {
    option: 'nocodbCheckPath',
    schema: 'canonical-task-nocodb-check-v1',
    kind: 'persistent_nocodb',
  },
  runtime: {
    option: 'runtimeCheckPath',
    schema: 'canonical-task-runtime-check-v1',
    kind: 'brainbase_server_process',
  },
  mac: {
    option: 'macCheckPath',
    schema: 'canonical-task-mac-consumer-check-v1',
    kind: 'mac_live_read_only_contract',
  },
});

async function verifyCutoverCheckArtifact({ rootDir, name, checkPath, sourceHead }) {
  const definition = CUTOVER_CHECKS[name];
  invariant(checkPath, `before-enable requires --${name}-check`);
  const absolutePath = path.isAbsolute(checkPath)
    ? checkPath
    : resolveInsideRoot(rootDir, checkPath, `${name} check path`);
  const { bytes, value: artifact } = await readJsonWithBytes(absolutePath, `${name} check`);
  expectField(artifact, 'artifact_schema', definition.schema);
  expectField(artifact, 'check_kind', definition.kind);
  expectField(artifact, 'pass', true);
  expectField(artifact, 'source_head', sourceHead);
  expectField(artifact, 'exit_code', 0);
  invariant(
    artifact.producer === 'scripts/capture-canonical-task-cutover-evidence.js',
    `${name} check producer mismatch`,
  );
  invariant(typeof artifact.command === 'string' && artifact.command.length > 0, `${name} check command is required`);
  const rawLogPath = resolveInsideRoot(rootDir, artifact.raw_log_path, `${name} raw log path`);
  const rawLogBytes = await readFile(rawLogPath);
  expectField(artifact, 'raw_log_hash', sha256(rawLogBytes));

  if (name === 'postgres') {
    invariant(artifact.schema_version, 'postgres check schema_version is required');
    invariant(artifact.writer_token, 'postgres check writer_token is required');
    invariant(artifact.required_tables?.length === 3, 'postgres check required_tables mismatch');
  } else if (name === 'nocodb') {
    invariant(artifact.schema_version, 'nocodb check schema_version is required');
    invariant(artifact.table_id === 'm7iys8m7o1abr3f', 'nocodb check table_id mismatch');
    invariant(artifact.required_columns >= 16, 'nocodb check required_columns mismatch');
  } else if (name === 'runtime') {
    expectField(artifact, 'runtime_kind', 'brainbase_server');
    invariant(Number.isInteger(artifact.process?.pid) && artifact.process.pid > 0, 'runtime check process.pid is invalid');
    invariant(Number.isInteger(artifact.process?.port) && artifact.process.port > 0, 'runtime check process.port is invalid');
    expectField(artifact.process, 'cwd', path.resolve(rootDir));
    expectField(artifact.process, 'source_head', sourceHead);
    expectField(artifact.probe, 'status', 200);
    invariant(/\/api\/companion\/tasks/.test(artifact.probe?.endpoint ?? ''), 'runtime check probe endpoint mismatch');
  } else if (name === 'mac') {
    expectField(artifact, 'provider_source_head', sourceHead);
    invariant(artifact.read_only_contract?.pass === true, 'mac check read_only_contract pass mismatch');
    invariant(artifact.read_only_contract?.exit_code === 0, 'mac check read_only_contract exit_code mismatch');
    invariant(artifact.read_only_contract?.matched_tests >= 1, 'mac check read_only_contract matched_tests mismatch');
    invariant(path.isAbsolute(artifact.mac_checkout ?? ''), 'mac check mac_checkout must be absolute');
    invariant(/^[a-f0-9]{40}$/.test(artifact.mac_source_head ?? ''), 'mac check mac_source_head is invalid');
  }

  return {
    name,
    artifact_path: normalizeRelative(path.relative(rootDir, absolutePath)),
    artifact_hash: sha256(bytes),
    raw_log_path: artifact.raw_log_path,
    raw_log_hash: artifact.raw_log_hash,
    details: artifact,
  };
}

export function currentGitHead(rootDir = process.cwd()) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
}

function listSystemProcesses() {
  return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function checkCanonicalTaskWriterPolicy({
  rootDir = process.cwd(),
  phase,
  sourceHead = currentGitHead(rootDir),
  readFileImpl = readFile,
  listProcesses = listSystemProcesses,
} = {}) {
  invariant(phase === 'before-migration' || phase === 'rollback', 'writer-policy check requires before-migration or rollback');

  const staticViolations = [];
  for (const relativePath of OPERATIONAL_TASK_SCRIPTS) {
    const source = await readFileImpl(resolveInsideRoot(rootDir, relativePath, 'writer path'), 'utf8');
    if (!source.includes('./lib/canonical-task-api-client.js')) {
      staticViolations.push({ path: relativePath, reason: 'canonical_task_api_client_missing' });
    }
    for (const pattern of FORBIDDEN_DIRECT_WRITER_PATTERNS) {
      if (pattern.test(source)) {
        staticViolations.push({ path: relativePath, reason: 'direct_nocodb_writer_marker', marker: pattern.source });
      }
    }
  }

  const processLines = await Promise.resolve(listProcesses());
  invariant(Array.isArray(processLines), 'process evidence must be an array');
  const activeWriterProcesses = processLines.filter((line) =>
    OPERATIONAL_TASK_SCRIPTS.some((relativePath) => line.includes(relativePath)),
  );
  const pass = staticViolations.length === 0 && activeWriterProcesses.length === 0;
  return {
    artifact_schema: 'canonical-task-writer-policy-v1',
    phase,
    pass,
    source_head: sourceHead,
    required_zero_direct_writers: true,
    checks: {
      static_direct_writers: {
        pass: staticViolations.length === 0,
        count: staticViolations.length,
        violations: staticViolations,
      },
      active_direct_writer_processes: {
        pass: activeWriterProcesses.length === 0,
        count: activeWriterProcesses.length,
        processes: activeWriterProcesses,
      },
    },
  };
}

export async function verifyEvidenceArtifact({
  rootDir = process.cwd(),
  registry,
  registryHash,
  entry,
  sourceHead,
}) {
  const artifactAbsolutePath = resolveInsideRoot(rootDir, entry.artifact_path, 'artifact path');
  const { bytes: artifactBytes, value: artifact } = await readJsonWithBytes(
    artifactAbsolutePath,
    `${entry.id} artifact`,
  );

  expectField(artifact, 'artifact_schema', entry.artifact_schema);
  expectField(artifact, 'evidence_id', entry.id);
  expectField(artifact, 'pass', true);
  expectField(artifact, 'source_head', sourceHead);
  expectField(artifact, 'registry_path', registry.source_of_truth);
  expectField(artifact, 'registry_hash', registryHash);
  expectField(artifact, 'owner_path', entry.owner_path);
  expectField(artifact, 'producer_command', entry.producer_command);
  expectField(artifact, 'registered_test_command', entry.test_command);
  expectField(artifact, 'exit_code', 0);
  expectField(artifact, 'matched_tests', 1);
  expectField(artifact, 'matched_assertions', 1);

  const ownerAbsolutePath = resolveInsideRoot(rootDir, entry.owner_path, 'owner path');
  const ownerBytes = await readFile(ownerAbsolutePath);
  expectField(artifact, 'owner_hash', sha256(ownerBytes));

  const effectiveEnv = artifact.effective_env;
  invariant(effectiveEnv && typeof effectiveEnv === 'object' && !Array.isArray(effectiveEnv), `${entry.id} effective_env is required`);
  invariant(
    sameJson(Object.keys(effectiveEnv).sort(), EVIDENCE_ENV_NAMES),
    `${entry.id} effective_env contains unregistered names`,
  );
  const nonce = effectiveEnv.VIBEPRO_EVIDENCE_NONCE;
  invariant(/^[a-f0-9]{64}$/.test(nonce ?? ''), `${entry.id} evidence nonce is malformed`);
  expectField(artifact, 'nonce_hash', sha256(nonce));

  const invocation = buildEffectiveInvocation({
    registry,
    entry,
    rootDir,
    nonce,
    inheritedEnv: {},
  });
  expectField(artifact, 'registered_argv', invocation.registeredArgv);
  expectField(artifact, 'effective_argv', invocation.effectiveArgv);
  expectField(artifact, 'effective_env', invocation.effectiveEnv);
  expectField(artifact, 'adapter', invocation.adapterKey);
  expectField(artifact, 'reporter', invocation.reporterPath);
  expectField(artifact, 'reporter_hash', invocation.reporterHash);
  expectField(artifact, 'runner_result_path', invocation.resultRelativePath);

  const runnerBytes = await readFile(invocation.resultPath);
  expectField(artifact, 'runner_result_hash', sha256(runnerBytes));
  let runnerResult;
  if (invocation.adapterKey === 'node_test') {
    runnerResult = runnerBytes.toString('utf8');
  } else {
    try {
      runnerResult = JSON.parse(runnerBytes.toString('utf8'));
    } catch (error) {
      throw new Error(`${entry.id} runner result is not valid JSON: ${error.message}`, { cause: error });
    }
  }

  const stdoutRelativePath = STDOUT_PATH_TEMPLATE.replaceAll('<evidence-id>', entry.id);
  expectField(artifact, 'stdout_path', stdoutRelativePath);
  const stdoutBytes = await readFile(resolveInsideRoot(rootDir, stdoutRelativePath, 'stdout path'));
  expectField(artifact, 'stdout_hash', sha256(stdoutBytes));
  if (
    invocation.adapterKey !== 'node_test'
    && /VIBEPRO_ASSERT:[A-Za-z0-9._-]+:[a-f0-9]{64}/.test(stdoutBytes.toString('utf8'))
  ) {
    throw new Error(`${entry.id} stdout_marker is not a registered final-event channel`);
  }

  const reparsed = evaluateRunnerEvidence({
    adapterKey: invocation.adapterKey,
    result: runnerResult,
    evidenceId: entry.id,
    nonce,
  });
  invariant(reparsed.errors.length === 0, `${entry.id} runner evidence invalid: ${reparsed.errors.join('; ')}`);
  expectField(artifact, 'matched_tests', reparsed.matchedTests);
  expectField(artifact, 'matched_assertions', reparsed.matchedAssertions);

  return {
    evidence_id: entry.id,
    pass: true,
    artifact_path: entry.artifact_path,
    artifact_hash: sha256(artifactBytes),
    artifact_schema: entry.artifact_schema,
    producer_command: entry.producer_command,
    producer_command_hash: sha256(entry.producer_command),
    owner_path: entry.owner_path,
    owner_hash: artifact.owner_hash,
    registered_test_command: entry.test_command,
    effective_argv: artifact.effective_argv,
    adapter: artifact.adapter,
    reporter_hash: artifact.reporter_hash,
    runner_result_path: artifact.runner_result_path,
    runner_result_hash: artifact.runner_result_hash,
    stdout_path: artifact.stdout_path,
    stdout_hash: artifact.stdout_hash,
    matched_tests: reparsed.matchedTests,
    matched_assertions: reparsed.matchedAssertions,
  };
}

export async function buildBeforeEnableEvidence({
  rootDir = process.cwd(),
  registryPath = DEFAULT_REGISTRY_PATH,
  evidenceOut,
  sourceHead = currentGitHead(rootDir),
  manifestPath = process.env.CANONICAL_TASK_STORE_MANIFEST ?? 'config/canonical-task-store.json',
  postgresCheckPath,
  nocodbCheckPath,
  runtimeCheckPath,
  macCheckPath,
}) {
  invariant(evidenceOut, 'before-enable requires --evidence-out');

  const registryAbsolutePath = path.isAbsolute(registryPath)
    ? registryPath
    : resolveInsideRoot(rootDir, registryPath, 'registry path');
  const { bytes: registryBytes, value: registry } = await readJsonWithBytes(registryAbsolutePath, 'evidence registry');
  validateEvidenceRegistry(registry);
  const registryHash = sha256(registryBytes);

  const registeredArtifactPaths = new Set(registry.entries.map((entry) => entry.artifact_path));
  const artifactDirectories = new Set(
    registry.entries.map((entry) => path.dirname(resolveInsideRoot(rootDir, entry.artifact_path, 'artifact path'))),
  );
  for (const directory of artifactDirectories) {
    const names = await readdir(directory).catch((error) => {
      throw new Error(`evidence artifact directory is unavailable: ${directory}: ${error.message}`, { cause: error });
    });
    for (const name of names.filter((candidate) => candidate.endsWith('.json'))) {
      const relativeArtifactPath = normalizeRelative(path.relative(rootDir, path.join(directory, name)));
      invariant(
        registeredArtifactPaths.has(relativeArtifactPath),
        `unregistered evidence artifact: ${relativeArtifactPath}`,
      );
    }
  }

  const evidence = [];
  for (const entry of registry.entries) {
    evidence.push(await verifyEvidenceArtifact({
      rootDir,
      registry,
      registryHash,
      entry,
      sourceHead,
    }));
  }

  const manifestAbsolutePath = path.isAbsolute(manifestPath)
    ? manifestPath
    : resolveInsideRoot(rootDir, manifestPath, 'manifest path');
  const { value: manifest } = await readJsonWithBytes(manifestAbsolutePath, 'canonical task store manifest');
  const checkPaths = { postgresCheckPath, nocodbCheckPath, runtimeCheckPath, macCheckPath };
  const cutoverChecks = [];
  for (const [name, definition] of Object.entries(CUTOVER_CHECKS)) {
    cutoverChecks.push(await verifyCutoverCheckArtifact({
      rootDir,
      name,
      checkPath: checkPaths[definition.option],
      sourceHead,
    }));
  }
  const postgresCheck = cutoverChecks.find((check) => check.name === 'postgres').details;
  const nocodbCheck = cutoverChecks.find((check) => check.name === 'nocodb').details;
  invariant(postgresCheck.schema_version === manifest.schema_version, 'postgres schema_version does not match manifest');
  invariant(nocodbCheck.schema_version === manifest.schema_version, 'nocodb schema_version does not match manifest');
  const output = {
    artifact_schema: 'canonical-task-cutover-evidence-v1',
    phase: 'before-enable',
    pass: true,
    source_head: sourceHead,
    registry_path: registry.source_of_truth,
    registry_hash: registryHash,
    manifest_path: normalizeRelative(path.relative(rootDir, manifestAbsolutePath)),
    manifest_hash: sha256(canonicalJson(manifest)),
    schema_version: manifest.schema_version,
    writer_token: postgresCheck.writer_token,
    cutover_checks: cutoverChecks,
    required_evidence_ids: registry.entries.map((entry) => entry.id),
    evidence,
  };

  const outputPath = path.isAbsolute(evidenceOut)
    ? evidenceOut
    : resolveInsideRoot(rootDir, evidenceOut, 'evidence output path');
  await atomicWriteFile(outputPath, `${JSON.stringify(sortCanonical(output), null, 2)}\n`);
  return output;
}

export function parseArgs(argv) {
  const parsed = { registryPath: DEFAULT_REGISTRY_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--phase') parsed.phase = argv[++index];
    else if (argument === '--evidence-out') parsed.evidenceOut = argv[++index];
    else if (argument === '--registry') parsed.registryPath = argv[++index];
    else if (argument === '--manifest') parsed.manifestPath = argv[++index];
    else if (argument === '--postgres-check') parsed.postgresCheckPath = argv[++index];
    else if (argument === '--nocodb-check') parsed.nocodbCheckPath = argv[++index];
    else if (argument === '--runtime-check') parsed.runtimeCheckPath = argv[++index];
    else if (argument === '--mac-check') parsed.macCheckPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  invariant(VALID_PHASES.has(parsed.phase), '--phase must be before-migration, before-enable, or rollback');
  return parsed;
}

export async function runCanonicalTaskCutoverPreflight(options) {
  if (options.phase === 'before-enable') {
    return buildBeforeEnableEvidence(options);
  }
  if (typeof options.phaseCheck === 'function') return options.phaseCheck(options);
  return checkCanonicalTaskWriterPolicy(options);
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runCanonicalTaskCutoverPreflight(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.pass) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`canonical-task cutover preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
