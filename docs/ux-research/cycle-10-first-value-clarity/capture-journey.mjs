import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inspectCodexEvidence } from './codex-evidence.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(scriptDir, '../../..');
const outputDir = join(scriptDir, 'candidate-corpus-after');
const packageSpec = process.argv[2];
if (!packageSpec) throw new Error('usage: node capture-journey.mjs <tarball>');
const timeoutMs = 600_000;
const runRoot = await mkdtemp(join(tmpdir(), 'brainbase-cycle10-'));
const consumer = join(runRoot, 'consumer');
const dataDir = join(runRoot, 'personal-os');
const skillRoot = join(consumer, '.agents', 'skills');
await mkdir(outputDir, { recursive: true });
await mkdir(consumer, { recursive: true });

function redact(value) {
  return String(value)
    .replaceAll(runRoot, '<isolated-run-root>')
    .replaceAll(repo, '<repo>')
    .replaceAll(homedir(), '<home>');
}

async function run(id, executable, args) {
  const started = performance.now();
  const child = spawn(executable, args, {
    cwd: consumer,
    env: { ...process.env, PATH: `${join(consumer, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  }).finally(() => clearTimeout(timer));
  const trace = {
    id,
    invocation_kind: 'child_process.spawn',
    executable: redact(executable),
    args: args.map(redact),
    cwd: '<isolated-run-root>/consumer',
    exit_code: exitCode,
    timed_out: timedOut,
    duration_ms: Math.round(performance.now() - started),
    stdout: redact(stdout),
    stderr: redact(stderr)
  };
  const body = `${JSON.stringify(trace, null, 2)}\n`;
  await writeFile(join(outputDir, `${id}.json`), body);
  return { ...trace, raw_stdout: stdout, sha256: createHash('sha256').update(body).digest('hex') };
}

try {
  execFileSync('npm', ['init', '--yes'], { cwd: consumer, stdio: 'ignore' });
  const journeyStarted = performance.now();
  const traces = [];
  traces.push(await run('journey-01-install', 'npm', ['install', '--ignore-scripts', resolve(packageSpec)]));
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules', '@unson', 'brainbase-mcp', 'package.json'), 'utf8'));
  const binary = join(consumer, 'node_modules', '.bin', 'brainbase');
  const start = await run('journey-02-start', binary, [
    'onboard:start', '--target', 'codex', '--dir', dataDir,
    '--name', '佐藤', '--value', '同じ前提を説明し直さず、事実と未確認を分ける',
    '--project', 'Atlas導入', '--decision-principle', '実測と利用者成果を分けて判断する',
    '--stakeholder', '田中|最終判断者|Atlas導入の承認を担当'
  ]);
  traces.push(start);
  const seed = start.raw_stdout.match(/`(brainbase onboard:seed[^`]+)`/u)?.[1];
  if (!seed) throw new Error('start did not display seed command');
  traces.push(await run('journey-03-seed', '/bin/sh', ['-c', seed]));
  traces.push(await run('journey-04-doctor', binary, ['doctor', '--dir', dataDir, '--format', 'json']));
  traces.push(await run('journey-05-generate-skill', binary, [
    'onboard:skills', '--target', 'codex', '--skills', 'brainbase-personal-onboarding', '--out', skillRoot
  ]));
  const skillPath = join(skillRoot, 'brainbase-personal-onboarding', 'SKILL.md');
  const server = join(consumer, 'node_modules', '@unson', 'brainbase-mcp', 'dist', 'index.js');
  const prompt = [
    `${skillPath}を黙って読み、その指示に従ってください。Skillの読み込みやtool操作は利用者向け回答で説明しないでください。`,
    'Brainbaseのresolve_entity、get_context、searchを実際に使ってください。',
    '「田中さんにAtlas導入の判断基準を確認する」という文章を解決し、保存済み文脈を根拠に短い判断メモを作ってください。',
    '利用者向け回答は前置きなしで「## 覚えていたこと」から始め、「つながったこと」「次にできること」の3節にしてください。表は使わず、技術監査情報は必要なら最後の「詳細」へ分けてください。',
    '事実と未確認事項を分け、ファイル変更や外部送信はしないでください。'
  ].join('');
  const codex = await run('journey-06-real-codex-clear-value', 'codex', [
    '--dangerously-bypass-approvals-and-sandbox',
    '-c', `mcp_servers.brainbase.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.brainbase.args=${JSON.stringify([server])}`,
    '-c', `mcp_servers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR=${JSON.stringify(dataDir)}`,
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', prompt
  ]);
  traces.push(codex);
  const duration = Math.round(performance.now() - journeyStarted);
  const evidence = inspectCodexEvidence(codex.raw_stdout);
  const passed = traces.every((trace) => trace.exit_code === 0 && !trace.timed_out)
    && duration <= timeoutMs && evidence.actualResolveUsed && evidence.actualContextUsed
    && evidence.actualSearchUsed && evidence.usefulBodyPresent && evidence.conciseStructurePresent
    && evidence.technicalEvidenceInTools && evidence.tableAbsent && evidence.internalNarrationAbsent;
  const manifest = {
    version: 1,
    corpus_id: `cycle-10-candidate-${Date.now()}`,
    evidence_kind: 'first_value_end_to_end_journey',
    execution_surface: 'actual_cli_generated_skill_actual_mcp_actual_codex',
    source_snapshot: 'candidate_local_tarball',
    evaluated_repository_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    installed_package_version: installed.version,
    journey_start: 'candidate_tarball_install_started',
    journey_completion: 'actual_codex_concise_grounded_answer_returned',
    journey_budget_ms: timeoutMs,
    journey_duration_ms: duration,
    journey_within_budget: duration <= timeoutMs,
    actual_resolve_entity_used: evidence.actualResolveUsed,
    actual_get_context_used: evidence.actualContextUsed,
    actual_search_used: evidence.actualSearchUsed,
    useful_body_present: evidence.usefulBodyPresent,
    concise_structure_present: evidence.conciseStructurePresent,
    technical_evidence_in_tools: evidence.technicalEvidenceInTools,
    table_absent: evidence.tableAbsent,
    internal_narration_absent: evidence.internalNarrationAbsent,
    generated_skill_used: true,
    candidate_journey_passed: passed,
    synthetic_persona_value_recognition: 'pending',
    human_value_recognition: 'not_collected',
    traces: traces.map(({ id, sha256, exit_code, timed_out, duration_ms }) => ({ id, sha256, exit_code, timed_out, duration_ms }))
  };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
