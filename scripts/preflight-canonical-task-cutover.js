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

export function currentGitHead(rootDir = process.cwd()) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
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
  schemaVersion,
  writerToken,
}) {
  invariant(evidenceOut, 'before-enable requires --evidence-out');
  invariant(typeof schemaVersion === 'string' && schemaVersion.length > 0, 'before-enable requires schemaVersion');
  invariant(typeof writerToken === 'string' && writerToken.length > 0, 'before-enable requires writerToken');

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
  const output = {
    artifact_schema: 'canonical-task-cutover-evidence-v1',
    phase: 'before-enable',
    pass: true,
    source_head: sourceHead,
    registry_path: registry.source_of_truth,
    registry_hash: registryHash,
    manifest_path: normalizeRelative(path.relative(rootDir, manifestAbsolutePath)),
    manifest_hash: sha256(canonicalJson(manifest)),
    schema_version: schemaVersion,
    writer_token: writerToken,
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
    else if (argument === '--schema-version') parsed.schemaVersion = argv[++index];
    else if (argument === '--writer-token') parsed.writerToken = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  invariant(VALID_PHASES.has(parsed.phase), '--phase must be before-migration, before-enable, or rollback');
  return parsed;
}

export async function runCanonicalTaskCutoverPreflight(options) {
  if (options.phase === 'before-enable') {
    return buildBeforeEnableEvidence({
      ...options,
      schemaVersion: options.schemaVersion ?? process.env.CANONICAL_TASK_SCHEMA_VERSION,
      writerToken: options.writerToken ?? process.env.CANONICAL_TASK_WRITER_TOKEN,
    });
  }
  if (typeof options.phaseCheck !== 'function') {
    throw new Error(`${options.phase} requires an explicit writer-policy phaseCheck`);
  }
  return options.phaseCheck(options);
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
