import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inspectCodexEvidence } from './codex-evidence.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(scriptDir, '../../..');
const cycleDir = resolve(repo, 'docs/ux-research/cycle-09-id-edge-first-value');
const args = parseArgs(process.argv.slice(2));
const packageSpec = required(args, 'package-spec');
const sourceSnapshot = required(args, 'source-snapshot');
if (!['candidate_local_tarball', 'published_registry_package'].includes(sourceSnapshot)) {
  throw new Error('--source-snapshot must be candidate_local_tarball or published_registry_package');
}
const defaultSurface = sourceSnapshot === 'candidate_local_tarball' ? 'candidate-corpus' : 'registry-corpus';
const outputDir = resolve(cycleDir, args['output-dir'] ?? defaultSurface);
if (!outputDir.startsWith(`${cycleDir}/`)) throw new Error('--output-dir must remain inside the cycle-09 evidence directory');
try {
  await access(join(outputDir, 'manifest.json'));
  throw new Error('refusing to overwrite an existing evidence manifest');
} catch (error) {
  if (error instanceof Error && error.message.includes('refusing to overwrite')) throw error;
}

const processTimeoutMs = 600_000;
const runRoot = await mkdtemp(join(tmpdir(), 'brainbase-cycle09-'));
const consumer = join(runRoot, 'consumer');
const dataDir = join(runRoot, 'personal-os');
await mkdir(outputDir, { recursive: true });
await mkdir(consumer, { recursive: true });

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${key ?? '<end>'}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function redact(value) {
  return String(value).replaceAll(runRoot, '<isolated-run-root>').replaceAll(repo, '<repo>');
}

async function run(id, executable, commandArgs, cwd = consumer) {
  const startedAt = performance.now();
  const child = spawn(executable, commandArgs, {
    cwd,
    env: {
      ...process.env,
      PATH: `${join(consumer, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      NO_COLOR: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, processTimeoutMs);
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  }).finally(() => clearTimeout(timer));
  const trace = {
    id,
    invocation_kind: 'child_process.spawn',
    executable: redact(executable),
    args: commandArgs.map(redact),
    cwd: redact(cwd),
    exit_code: exitCode,
    timed_out: timedOut,
    duration_ms: Math.round(performance.now() - startedAt),
    stdout: redact(stdout),
    stderr: redact(stderr)
  };
  const body = `${JSON.stringify(trace, null, 2)}\n`;
  await writeFile(join(outputDir, `${id}.json`), body);
  return { ...trace, raw_stdout: stdout, sha256: createHash('sha256').update(body).digest('hex') };
}

try {
  execFileSync('npm', ['init', '--yes'], { cwd: consumer, stdio: 'ignore' });
  const journeyStartedAt = performance.now();
  const traces = [];
  traces.push(await run('journey-01-install', 'npm', ['install', '--ignore-scripts', packageSpec]));
  const packageJsonPath = join(consumer, 'node_modules', '@unson', 'brainbase-mcp', 'package.json');
  const installedPackage = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (args['expected-version'] && installedPackage.version !== args['expected-version']) {
    throw new Error(`installed version ${installedPackage.version} did not match ${args['expected-version']}`);
  }

  const binary = join(consumer, 'node_modules', '.bin', 'brainbase');
  const start = await run('journey-02-start', binary, [
    'onboard:start', '--target', 'codex', '--dir', dataDir,
    '--name', '佐藤', '--value', '同じ前提を説明し直さず、事実と未確認を分ける',
    '--project', 'Atlas導入', '--decision-principle', '実測と利用者成果を分けて判断する',
    '--stakeholder', '田中|最終判断者|Atlas導入の承認を担当'
  ]);
  traces.push(start);
  const displayedSeed = start.raw_stdout.match(/`(brainbase onboard:seed[^`]+)`/u)?.[1];
  if (!displayedSeed) throw new Error('start output did not contain a copyable seed command');
  traces.push(await run('journey-03-displayed-seed', '/bin/sh', ['-c', displayedSeed]));
  traces.push(await run('journey-04-doctor', binary, ['doctor', '--dir', dataDir, '--format', 'json']));

  const server = join(consumer, 'node_modules', '@unson', 'brainbase-mcp', 'dist', 'index.js');
  const prompt = [
    'Brainbaseのresolve_entity、get_context、searchを実際に使ってください。',
    '「田中さんにAtlas導入の判断基準を確認する」という文章を解決し、保存済み文脈を根拠に判断メモを作ってください。',
    'Atlas導入、田中、判断基準について、canonicalEntityId、relationPath、recordClassを使って、正規エンティティと投影を区別してください。',
    '事実、未確認事項、田中さんと次に合意すべきことを分け、最後に使ったBrainbase文脈とID接続を明示してください。',
    'ファイル変更や外部送信はしないでください。'
  ].join('');
  const codex = await run('journey-05-real-codex-id-edge', 'codex', [
    '--dangerously-bypass-approvals-and-sandbox',
    '-c', `mcp_servers.brainbase.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.brainbase.args=${JSON.stringify([server])}`,
    '-c', `mcp_servers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR=${JSON.stringify(dataDir)}`,
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', prompt
  ]);
  traces.push(codex);

  const journeyDurationMs = Math.round(performance.now() - journeyStartedAt);
  const codexEvidence = inspectCodexEvidence(codex.raw_stdout);
  const lockfile = await readFile(join(consumer, 'package-lock.json'));
  const manifest = {
    version: 1,
    corpus_id: `cycle-09-${sourceSnapshot}-${Date.now()}`,
    evidence_kind: 'first_value_end_to_end_journey',
    execution_surface: 'actual_cli_actual_mcp_actual_codex',
    source_snapshot: sourceSnapshot,
    evaluated_repository_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    package_spec: sourceSnapshot === 'candidate_local_tarball'
      ? '<candidate-local-tarball>'
      : redact(packageSpec),
    installed_package_version: installedPackage.version,
    package_lock_sha256: createHash('sha256').update(lockfile).digest('hex'),
    journey_start: 'package_install_started',
    journey_completion: 'actual_codex_useful_id_edge_answer_returned',
    journey_budget_ms: processTimeoutMs,
    journey_duration_ms: journeyDurationMs,
    journey_within_budget: journeyDurationMs <= processTimeoutMs,
    actual_resolve_entity_used: codexEvidence.actualResolveUsed,
    actual_get_context_used: codexEvidence.actualContextUsed,
    actual_search_used: codexEvidence.actualSearchUsed,
    useful_body_present: codexEvidence.usefulBodyPresent,
    canonical_id_evidence_present: codexEvidence.canonicalIdEvidencePresent,
    relation_evidence_present: codexEvidence.relationEvidencePresent,
    projection_boundary_present: codexEvidence.projectionBoundaryPresent,
    mcp_tool_call_evidence: codexEvidence.toolCalls,
    candidate_journey_passed: traces.every((trace) => trace.exit_code === 0 && !trace.timed_out)
      && journeyDurationMs <= processTimeoutMs
      && codexEvidence.actualResolveUsed && codexEvidence.actualContextUsed && codexEvidence.actualSearchUsed
      && codexEvidence.usefulBodyPresent && codexEvidence.canonicalIdEvidencePresent
      && codexEvidence.relationEvidencePresent && codexEvidence.projectionBoundaryPresent,
    known_major_count: null,
    synthetic_persona_value_recognition: 'pending',
    human_value_recognition: 'not_collected',
    traces: traces.map(({ id, sha256, exit_code, timed_out, duration_ms }) => ({ id, sha256, exit_code, timed_out, duration_ms }))
  };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (!manifest.candidate_journey_passed) process.exitCode = 1;
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
