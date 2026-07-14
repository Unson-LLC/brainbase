#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import {
  readFile,
  unlink,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVIDENCE_ENV_NAMES,
  FINAL_EVENT_KIND,
  RUNNER_PROTOCOL,
  atomicWriteFile,
  atomicWriteJson,
  sha256,
} from './evidence-reporters/canonical-task-evidence-protocol.js';

export const DEFAULT_REGISTRY_PATH = 'config/canonical-task-evidence-registry.json';
export const STDOUT_PATH_TEMPLATE = '.vibepro/verification/canonical-task-cutover/stdout/<evidence-id>.log';

const REQUIRED_ENTRY_FIELDS = [
  'id',
  'producer_command',
  'owner_path',
  'test_command',
  'artifact_path',
  'artifact_schema',
  'pre_fix_assertion',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function relativePath(value) {
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

export function parseCommandArgv(command) {
  invariant(typeof command === 'string' && command.trim().length > 0, 'registered test command is required');
  const argv = [];
  let token = '';
  let state = 'plain';
  let tokenStarted = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (state === 'single') {
      if (character === "'") state = 'plain';
      else token += character;
      tokenStarted = true;
      continue;
    }
    if (state === 'double') {
      if (character === '"') {
        state = 'plain';
      } else if (character === '\\') {
        index += 1;
        invariant(index < command.length, 'registered test command has a trailing escape');
        token += command[index];
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        argv.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }
    invariant(!/[|&;<>()$`\n\r]/.test(character), 'registered test command contains shell syntax');
    if (character === "'") {
      state = 'single';
      tokenStarted = true;
    } else if (character === '"') {
      state = 'double';
      tokenStarted = true;
    } else if (character === '\\') {
      index += 1;
      invariant(index < command.length, 'registered test command has a trailing escape');
      token += command[index];
      tokenStarted = true;
    } else {
      token += character;
      tokenStarted = true;
    }
  }

  invariant(state === 'plain', 'registered test command has an unterminated quote');
  if (tokenStarted) argv.push(token);
  invariant(argv.length > 0, 'registered test command produced empty argv');
  return argv;
}

export function validateEvidenceRegistry(registry) {
  invariant(registry && typeof registry === 'object' && !Array.isArray(registry), 'evidence registry must be an object');
  invariant(registry.schema_version === '1.0.0', 'unsupported evidence registry schema_version');
  invariant(registry.source_of_truth === DEFAULT_REGISTRY_PATH, 'unexpected evidence registry source_of_truth');
  invariant(registry.collector === 'scripts/collect-canonical-task-evidence.js', 'unexpected evidence collector');
  invariant(Number.isInteger(registry.required_entry_count), 'required_entry_count must be an integer');
  invariant(Array.isArray(registry.entries), 'evidence registry entries must be an array');
  invariant(
    registry.entries.length === registry.required_entry_count,
    `evidence registry entry count mismatch: expected ${registry.required_entry_count}, received ${registry.entries.length}`,
  );

  const invocation = registry.effective_invocation;
  invariant(invocation?.spawn_mode === 'argv-with-explicit-env', 'unsupported evidence spawn mode');
  invariant(invocation?.nonce_hash === 'sha256', 'unsupported evidence nonce hash');
  invariant(invocation?.reject_unregistered_env === true, 'evidence env must reject unregistered names');
  invariant(
    JSON.stringify(Object.keys(invocation.required_env ?? {}).sort()) === JSON.stringify(EVIDENCE_ENV_NAMES),
    'evidence registry required_env must contain exactly the three registered names',
  );

  const adapters = registry.runner_adapters;
  invariant(adapters && typeof adapters === 'object', 'runner_adapters is required');
  for (const key of ['playwright', 'vitest', 'node_test']) {
    invariant(adapters[key] && typeof adapters[key] === 'object', `runner adapter ${key} is required`);
    invariant(typeof adapters[key].match_prefix === 'string', `runner adapter ${key} match_prefix is required`);
    invariant(typeof adapters[key].result_path_template === 'string', `runner adapter ${key} result_path_template is required`);
    invariant(adapters[key].result_path_template.includes('<evidence-id>'), `runner adapter ${key} result path must include evidence ID`);
  }

  const ids = new Set();
  const artifactPaths = new Set();
  for (const entry of registry.entries) {
    for (const field of REQUIRED_ENTRY_FIELDS) {
      invariant(typeof entry[field] === 'string' && entry[field].length > 0, `${entry.id ?? '<unknown>'} is missing ${field}`);
    }
    invariant(!ids.has(entry.id), `duplicate evidence id: ${entry.id}`);
    invariant(!artifactPaths.has(entry.artifact_path), `duplicate evidence artifact path: ${entry.artifact_path}`);
    ids.add(entry.id);
    artifactPaths.add(entry.artifact_path);
    invariant(
      entry.producer_command === `${registry.collector.replace(/^/, 'node ')} --id ${entry.id}`,
      `producer command mismatch for ${entry.id}`,
    );
    invariant(entry.artifact_schema === 'canonical-task-evidence-v1', `artifact schema mismatch for ${entry.id}`);
    const matchingAdapters = Object.entries(adapters)
      .filter(([, adapter]) => entry.test_command.startsWith(adapter.match_prefix));
    invariant(matchingAdapters.length === 1, `${entry.id} must match exactly one runner adapter`);
    parseCommandArgv(entry.test_command);
  }

  if (registry.required_entry_count === 71) {
    for (let number = 1; number <= 47; number += 1) {
      invariant(ids.has(`scenario.SC-${String(number).padStart(3, '0')}`), `missing scenario.SC-${String(number).padStart(3, '0')}`);
    }
    invariant([...ids].filter((id) => id.startsWith('surface.')).length === 24, 'registry must contain 24 surface entries');
  }

  return registry.entries;
}

export function resolveRunnerAdapter(registry, entry) {
  const matches = Object.entries(registry.runner_adapters)
    .filter(([, adapter]) => entry.test_command.startsWith(adapter.match_prefix));
  invariant(matches.length === 1, `${entry.id} must match exactly one runner adapter`);
  const [adapterKey, adapter] = matches[0];
  return { adapterKey, adapter };
}

export function buildEffectiveInvocation({
  registry,
  entry,
  rootDir = process.cwd(),
  nonce,
  inheritedEnv = process.env,
}) {
  invariant(/^[a-f0-9]{64}$/.test(nonce ?? ''), 'collector nonce must be 64 lowercase hex characters');
  const { adapterKey, adapter } = resolveRunnerAdapter(registry, entry);
  const registeredArgv = parseCommandArgv(entry.test_command);
  const resultRelativePath = adapter.result_path_template.replaceAll('<evidence-id>', entry.id);
  const resultPath = resolveInsideRoot(rootDir, resultRelativePath, 'runner result path');
  const effectiveArgv = [...registeredArgv];

  if (adapterKey !== 'node_test') {
    const reporterArgument = `--reporter=${adapter.reporter}`;
    invariant(!effectiveArgv.some((argument) => argument.startsWith('--reporter')), `${entry.id} registered command must not override reporter`);
    effectiveArgv.push(reporterArgument);
    invariant(
      adapter.effective_command_template === `<registered-test-command> ${reporterArgument}`,
      `${entry.id} effective command template mismatch`,
    );
  } else {
    invariant(adapter.reporter === 'tap', 'node_test adapter must use TAP');
    invariant(adapter.effective_command_template === '<registered-test-command>', 'node_test effective command template mismatch');
    invariant(effectiveArgv.includes('--test-reporter=tap'), 'node_test command must explicitly select TAP');
  }

  const effectiveEnv = {
    VIBEPRO_EVIDENCE_ID: entry.id,
    VIBEPRO_EVIDENCE_RESULT: relativePath(path.relative(rootDir, resultPath)),
    VIBEPRO_EVIDENCE_NONCE: nonce,
  };
  const environment = Object.fromEntries(
    Object.entries(inheritedEnv).filter(([name]) => !name.startsWith('VIBEPRO_EVIDENCE_')),
  );
  Object.assign(environment, effectiveEnv);

  let reporterHash;
  let reporterPath = adapter.reporter;
  if (adapterKey === 'node_test') {
    reporterHash = sha256(`node:${process.version}:node:test:tap`);
  } else {
    const absoluteReporterPath = resolveInsideRoot(rootDir, adapter.reporter, 'reporter path');
    reporterHash = sha256(readFileSync(absoluteReporterPath));
    reporterPath = relativePath(path.relative(rootDir, absoluteReporterPath));
  }

  return {
    adapterKey,
    adapter,
    command: effectiveArgv[0],
    args: effectiveArgv.slice(1),
    registeredArgv,
    effectiveArgv,
    effectiveEnv,
    resultPath,
    resultRelativePath: relativePath(path.relative(rootDir, resultPath)),
    reporterPath,
    reporterHash,
    spawnOptions: {
      cwd: rootDir,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  };
}

function validFinalEvent(event, evidenceId, nonce) {
  return event?.kind === FINAL_EVENT_KIND
    && event?.evidence_id === evidenceId
    && event?.nonce === nonce
    && event?.marker === `VIBEPRO_ASSERT:${evidenceId}:${nonce}`;
}

function parseTapTests(tap) {
  const tests = [];
  const stack = [];
  const globalMarkers = [];
  const markerPattern = /VIBEPRO_ASSERT:[A-Za-z0-9._-]+:[a-f0-9]{64}/g;

  for (const line of tap.split(/\r?\n/)) {
    const subtest = /^(\s*)# Subtest: (.+)$/.exec(line);
    if (subtest) {
      const indent = subtest[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const record = { title: subtest[2], status: 'pending', final_events: [], indent };
      tests.push(record);
      stack.push(record);
      continue;
    }

    const markers = line.match(markerPattern) ?? [];
    if (markers.length) {
      const indent = /^\s*/.exec(line)[0].length;
      const current = [...stack].reverse().find((record) => record.indent < indent);
      for (const marker of markers) {
        if (!current) {
          globalMarkers.push(marker);
          continue;
        }
        const [, evidenceId, nonce] = /^VIBEPRO_ASSERT:([^:]+):([a-f0-9]{64})$/.exec(marker) ?? [];
        current.final_events.push({ kind: FINAL_EVENT_KIND, evidence_id: evidenceId, nonce, marker });
      }
    }

    const status = /^(\s*)(ok|not ok) \d+ - (.+?)(?:\s+#\s+(SKIP|TODO).*)?$/.exec(line);
    if (status) {
      const indent = status[1].length;
      const title = status[3];
      const record = [...tests].reverse().find((candidate) => candidate.indent === indent && candidate.title === title && candidate.status === 'pending');
      if (record) {
        record.status = status[4] === 'SKIP' ? 'skipped' : status[2] === 'ok' ? 'passed' : 'failed';
      }
    }
  }

  return {
    tests: tests.map(({ indent: _indent, ...test }) => test),
    globalMarkers,
  };
}

export function evaluateRunnerEvidence({ adapterKey, result, evidenceId, nonce }) {
  const errors = [];
  let tests;
  let globalMarkers = [];

  if (adapterKey === 'node_test') {
    const parsed = parseTapTests(Buffer.isBuffer(result) ? result.toString('utf8') : String(result));
    tests = parsed.tests;
    globalMarkers = parsed.globalMarkers;
  } else {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return { matchedTests: 0, matchedAssertions: 0, errors: ['runner result is not an object'], tests: [] };
    }
    if (result.protocol !== RUNNER_PROTOCOL) errors.push('runner protocol mismatch');
    if (result.adapter !== adapterKey) errors.push('runner adapter mismatch');
    if (result.evidence_id !== evidenceId) errors.push('runner evidence_id mismatch');
    if (result.nonce_hash !== sha256(nonce)) errors.push('runner nonce_hash mismatch');
    tests = Array.isArray(result.tests) ? result.tests : [];
    if (!Array.isArray(result.tests)) errors.push('runner tests must be an array');
  }

  const exactTests = tests.filter((test) => test.title === evidenceId);
  const matchedTests = exactTests.length;
  if (matchedTests !== 1) errors.push(`matched_tests must be 1, received ${matchedTests}`);
  if (globalMarkers.length) errors.push('global evidence marker is not attached to a test');

  for (const test of tests) {
    const events = Array.isArray(test.final_events) ? test.final_events : [];
    if (test.title !== evidenceId && events.some((event) => validFinalEvent(event, evidenceId, nonce))) {
      errors.push('evidence marker is attached to a different test title');
    }
  }

  let matchedAssertions = 0;
  if (exactTests.length === 1) {
    const [test] = exactTests;
    const events = Array.isArray(test.final_events) ? test.final_events : [];
    if (test.status !== 'passed') errors.push(`evidence test status must be passed, received ${test.status}`);
    if (events.length !== 1) errors.push(`final event count must be 1, received ${events.length}`);
    if (events.some((event) => !validFinalEvent(event, evidenceId, nonce))) {
      errors.push('final event does not match evidence ID and nonce');
    }
    if (test.status === 'passed' && events.length === 1 && validFinalEvent(events[0], evidenceId, nonce)) {
      matchedAssertions = 1;
    }
  }

  if (errors.length) matchedAssertions = 0;
  return { matchedTests, matchedAssertions, errors, tests };
}

async function defaultSpawn(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolve({
      exitCode: exitCode ?? 1,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

export function currentGitHead(rootDir = process.cwd()) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
}

export function parseArgs(argv) {
  const parsed = { registryPath: DEFAULT_REGISTRY_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--id') parsed.id = argv[++index];
    else if (argument === '--all') parsed.all = true;
    else if (argument === '--registry') parsed.registryPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  invariant(Boolean(parsed.id) !== Boolean(parsed.all), 'exactly one of --id or --all is required');
  return parsed;
}

export async function collectAllCanonicalTaskEvidence({
  rootDir = process.cwd(),
  registryPath = DEFAULT_REGISTRY_PATH,
  sourceHead = currentGitHead(rootDir),
  inheritedEnv = process.env,
} = {}) {
  const absoluteRegistryPath = resolveInsideRoot(rootDir, registryPath, 'registry path');
  const registry = JSON.parse(await readFile(absoluteRegistryPath, 'utf8'));
  validateEvidenceRegistry(registry);

  const artifacts = [];
  for (const entry of registry.entries) {
    const artifact = await collectCanonicalTaskEvidence({
      id: entry.id,
      rootDir,
      registryPath,
      sourceHead,
      inheritedEnv,
    });
    artifacts.push(artifact);
    process.stderr.write(`${artifact.pass ? 'PASS' : 'FAIL'} ${entry.id}\n`);
  }
  return artifacts;
}

export async function collectCanonicalTaskEvidence({
  id,
  rootDir = process.cwd(),
  registryPath = DEFAULT_REGISTRY_PATH,
  nonce = randomBytes(32).toString('hex'),
  sourceHead = currentGitHead(rootDir),
  spawnImpl = defaultSpawn,
  inheritedEnv = process.env,
} = {}) {
  const absoluteRegistryPath = resolveInsideRoot(rootDir, registryPath, 'registry path');
  const registryBytes = await readFile(absoluteRegistryPath);
  const registry = JSON.parse(registryBytes.toString('utf8'));
  validateEvidenceRegistry(registry);
  const entry = registry.entries.find((candidate) => candidate.id === id);
  invariant(entry, `Unregistered evidence ID: ${id}`);

  const ownerPath = resolveInsideRoot(rootDir, entry.owner_path, 'owner path');
  const ownerBytes = await readFile(ownerPath);
  const invocation = buildEffectiveInvocation({ registry, entry, rootDir, nonce, inheritedEnv });
  const stdoutRelativePath = STDOUT_PATH_TEMPLATE.replaceAll('<evidence-id>', entry.id);
  const stdoutPath = resolveInsideRoot(rootDir, stdoutRelativePath, 'stdout path');
  const artifactPath = resolveInsideRoot(rootDir, entry.artifact_path, 'artifact path');

  await Promise.all([
    unlink(invocation.resultPath).catch((error) => { if (error.code !== 'ENOENT') throw error; }),
    unlink(stdoutPath).catch((error) => { if (error.code !== 'ENOENT') throw error; }),
  ]);

  let execution;
  try {
    execution = await spawnImpl(invocation.command, invocation.args, invocation.spawnOptions);
  } catch (error) {
    execution = {
      exitCode: 1,
      signal: null,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(`failed to start test command: ${error.message}`),
      spawnError: error.message,
    };
  }
  const stdout = Buffer.isBuffer(execution.stdout) ? execution.stdout : Buffer.from(execution.stdout ?? '');
  const stderr = Buffer.isBuffer(execution.stderr) ? execution.stderr : Buffer.from(execution.stderr ?? '');
  await atomicWriteFile(stdoutPath, stdout);
  if (invocation.adapterKey === 'node_test') await atomicWriteFile(invocation.resultPath, stdout);

  const errors = [];
  let runnerBytes = Buffer.alloc(0);
  let runnerResult = null;
  try {
    runnerBytes = await readFile(invocation.resultPath);
    runnerResult = invocation.adapterKey === 'node_test'
      ? runnerBytes.toString('utf8')
      : JSON.parse(runnerBytes.toString('utf8'));
  } catch (error) {
    errors.push(`runner result unavailable: ${error.message}`);
  }

  const parsed = runnerResult === null
    ? { matchedTests: 0, matchedAssertions: 0, errors: [] }
    : evaluateRunnerEvidence({ adapterKey: invocation.adapterKey, result: runnerResult, evidenceId: id, nonce });
  errors.push(...parsed.errors);
  if (invocation.adapterKey !== 'node_test' && /VIBEPRO_ASSERT:[A-Za-z0-9._-]+:[a-f0-9]{64}/.test(stdout.toString('utf8'))) {
    errors.push('stdout_marker is not a registered final-event channel');
  }
  if (execution.exitCode !== 0) errors.push(`test command exited with ${execution.exitCode}`);
  if (execution.spawnError) errors.push(`test command failed to start: ${execution.spawnError}`);

  const artifact = {
    artifact_schema: entry.artifact_schema,
    evidence_id: entry.id,
    pass: errors.length === 0 && parsed.matchedTests === 1 && parsed.matchedAssertions === 1,
    source_head: sourceHead,
    registry_path: registry.source_of_truth,
    registry_hash: sha256(registryBytes),
    owner_path: entry.owner_path,
    owner_hash: sha256(ownerBytes),
    producer_command: entry.producer_command,
    registered_test_command: entry.test_command,
    registered_argv: invocation.registeredArgv,
    effective_argv: invocation.effectiveArgv,
    effective_env: invocation.effectiveEnv,
    nonce_hash: sha256(nonce),
    adapter: invocation.adapterKey,
    reporter: invocation.reporterPath,
    reporter_hash: invocation.reporterHash,
    runner_result_path: invocation.resultRelativePath,
    runner_result_hash: runnerBytes.length ? sha256(runnerBytes) : null,
    stdout_path: relativePath(path.relative(rootDir, stdoutPath)),
    stdout_hash: sha256(stdout),
    exit_code: execution.exitCode,
    signal: execution.signal ?? null,
    matched_tests: parsed.matchedTests,
    matched_assertions: parsed.matchedAssertions,
    stderr: stderr.toString('utf8'),
    errors,
  };
  await atomicWriteJson(artifactPath, artifact);
  return artifact;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.all) {
      const artifacts = await collectAllCanonicalTaskEvidence(args);
      const failed = artifacts.filter((artifact) => !artifact.pass);
      process.stdout.write(`${JSON.stringify({
        source_head: artifacts[0]?.source_head ?? currentGitHead(),
        total: artifacts.length,
        passed: artifacts.length - failed.length,
        failed: failed.map((artifact) => artifact.evidence_id),
      }, null, 2)}\n`);
      if (failed.length) process.exitCode = 1;
    } else {
      const artifact = await collectCanonicalTaskEvidence(args);
      process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
      if (!artifact.pass) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`canonical-task evidence collection failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
