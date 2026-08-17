import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = resolve(new URL('../../..', import.meta.url).pathname);
const outputDir = resolve(repo, 'docs/ux-research/cycle-08-persona-value-recognition/baseline-terminal-corpus');
const runRoot = await mkdtemp(join(tmpdir(), 'brainbase-cycle08-baseline-'));
const consumer = join(runRoot, 'consumer');
const dataDir = join(runRoot, 'personal-os');
const packageSpec = '@unson/brainbase-mcp@0.2.4';
const processTimeoutMs = 600_000;
await mkdir(outputDir, { recursive: true });
await mkdir(consumer, { recursive: true });

function redact(value) {
  return String(value).replaceAll(runRoot, '<isolated-run-root>').replaceAll(repo, '<repo>');
}

async function run(id, executable, args, cwd = consumer) {
  const startedAt = performance.now();
  const child = spawn(executable, args, {
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
    args: args.map(redact),
    cwd: redact(cwd),
    exit_code: exitCode,
    timed_out: timedOut,
    duration_ms: Math.round(performance.now() - startedAt),
    stdout: redact(stdout),
    stderr: redact(stderr)
  };
  const body = `${JSON.stringify(trace, null, 2)}\n`;
  await writeFile(join(outputDir, `${id}.json`), body);
  return {
    ...trace,
    raw_stdout: stdout,
    sha256: createHash('sha256').update(body).digest('hex')
  };
}

try {
  execFileSync('npm', ['init', '--yes'], { cwd: consumer, stdio: 'ignore' });
  const journeyStartedAt = performance.now();
  const traces = [];
  traces.push(await run('baseline-01-registry-install', 'npm', ['install', '--ignore-scripts', packageSpec]));
  const packageJsonPath = join(consumer, 'node_modules', '@unson', 'brainbase-mcp', 'package.json');
  const installedPackage = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const binary = join(consumer, 'node_modules', '.bin', 'brainbase');
  const start = await run('baseline-02-start', binary, [
    'onboard:start', '--target', 'codex', '--dir', dataDir,
    '--name', '佐藤', '--value', '同じ前提を説明し直さず、事実と未確認を分ける',
    '--project', 'Atlas導入', '--decision-principle', '実測と利用者成果を分けて判断する',
    '--stakeholder', '田中|最終判断者|Atlas導入の承認を担当'
  ]);
  traces.push(start);
  const displayedSeed = start.raw_stdout.match(/`(brainbase onboard:seed[^`]+)`/u)?.[1];
  if (!displayedSeed) throw new Error('start output did not contain a copyable seed command');
  traces.push(await run('baseline-03-displayed-seed', '/bin/sh', ['-c', displayedSeed]));
  traces.push(await run('baseline-04-install-preview', binary, ['onboard:install', '--target', 'codex', '--dir', dataDir, '--dry-run']));
  traces.push(await run('baseline-05-doctor', binary, ['doctor', '--dir', dataDir, '--format', 'json']));

  const server = join(consumer, 'node_modules', '@unson', 'brainbase-mcp', 'dist', 'index.js');
  const prompt = [
    'Brainbaseのget_contextとsearchを実際に使ってください。',
    '保存済み文脈を根拠に、Atlas導入について田中さんへ相談する判断メモを作ってください。',
    '事実、未確認事項、次に田中さんと合意すべきことを分け、最後に使ったBrainbase文脈を明示してください。',
    'ファイル変更や外部送信はしないでください。'
  ].join('');
  const codex = await run('baseline-06-real-codex', 'codex', [
    '--dangerously-bypass-approvals-and-sandbox',
    '-c', `mcp_servers.brainbase.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.brainbase.args=${JSON.stringify([server])}`,
    '-c', `mcp_servers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR=${JSON.stringify(dataDir)}`,
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', prompt
  ]);
  traces.push(codex);
  const resume = await run('baseline-07-resume-start', binary, [
    'onboard:start', '--target', 'codex', '--dir', dataDir
  ]);
  traces.push(resume);
  const resumePrompt = [
    '作業を中断して戻ってきました。Brainbaseのget_contextとsearchを実際に使ってください。',
    'さきほどのAtlas導入について、保存済み文脈から相談を再開できるように、',
    '確認済みの前提、まだ決めていないこと、田中さんへの次の相談文を短くまとめてください。',
    '前提の再入力は求めず、ファイル変更や外部送信はしないでください。'
  ].join('');
  const resumeCodex = await run('baseline-08-real-codex-resume', 'codex', [
    '--dangerously-bypass-approvals-and-sandbox',
    '-c', `mcp_servers.brainbase.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.brainbase.args=${JSON.stringify([server])}`,
    '-c', `mcp_servers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR=${JSON.stringify(dataDir)}`,
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', resumePrompt
  ]);
  traces.push(resumeCodex);
  const ontologyPrompt = [
    'Brainbaseのget_contextとsearchを実際に使ってください。',
    'オントロジー管理者として、保存済みのAtlas導入、田中さん、判断基準が、',
    'どのエンティティ・関係・知識種別として取得できるかを点検してください。',
    '用語や関係の不整合、重複、未確認を分け、正規化案を具体的に示してください。',
    '書き込み、ファイル変更、外部送信はしないでください。'
  ].join('');
  const ontologyCodex = await run('baseline-09-real-codex-ontology', 'codex', [
    '--dangerously-bypass-approvals-and-sandbox',
    '-c', `mcp_servers.brainbase.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.brainbase.args=${JSON.stringify([server])}`,
    '-c', `mcp_servers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR=${JSON.stringify(dataDir)}`,
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', ontologyPrompt
  ]);
  traces.push(ontologyCodex);
  const journeyDurationMs = Math.round(performance.now() - journeyStartedAt);
  const codexText = codex.raw_stdout;
  const resumeCodexText = resumeCodex.raw_stdout;
  const actualMcpUsed = /brainbase.*(?:get_context|search)|(?:get_context|search).*brainbase/iu.test(codexText);
  const usefulBodyPresent = ['Atlas導入', '田中', '未確認', '合意'].every((marker) => codexText.includes(marker));
  const recoveryMcpUsed = /brainbase.*(?:get_context|search)|(?:get_context|search).*brainbase/iu.test(resumeCodexText);
  const recoveryUsefulBodyPresent = ['Atlas導入', '田中', '確認済み'].every((marker) => resumeCodexText.includes(marker));
  const ontologyCodexText = ontologyCodex.raw_stdout;
  const ontologyMcpUsed = /brainbase.*(?:get_context|search)|(?:get_context|search).*brainbase/iu.test(ontologyCodexText);
  const ontologyUsefulBodyPresent = ['Atlas導入', '田中', 'エンティティ', '関係', '正規化'].every((marker) => ontologyCodexText.includes(marker));
  const lockfile = await readFile(join(consumer, 'package-lock.json'));
  const manifest = {
    version: 3,
    corpus_id: `cycle-08-registry-baseline-${Date.now()}`,
    evidence_kind: 'candidate_end_to_end_journey',
    execution_surface: 'actual_cli_and_actual_codex',
    source_snapshot: 'published_registry_package',
    evaluated_repository_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    registry_package_spec: packageSpec,
    installed_package_version: installedPackage.version,
    package_lock_sha256: createHash('sha256').update(lockfile).digest('hex'),
    journey_budget_ms: 600_000,
    journey_duration_ms: journeyDurationMs,
    journey_within_budget: journeyDurationMs <= 600_000,
    production_registry_install: traces[0].exit_code === 0,
    displayed_seed_executed: traces[2].exit_code === 0,
    actual_codex_exit_code: codex.exit_code,
    actual_mcp_used: actualMcpUsed,
    useful_body_present: usefulBodyPresent,
    recovery_resume_executed: resume.exit_code === 0,
    recovery_actual_mcp_used: recoveryMcpUsed,
    recovery_useful_body_present: recoveryUsefulBodyPresent,
    ontology_actual_mcp_used: ontologyMcpUsed,
    ontology_useful_body_present: ontologyUsefulBodyPresent,
    candidate_journey_passed: traces.every((trace) => trace.exit_code === 0 && !trace.timed_out) && actualMcpUsed && usefulBodyPresent && recoveryMcpUsed && recoveryUsefulBodyPresent && ontologyMcpUsed && ontologyUsefulBodyPresent,
    human_value_recognition: 'not_collected',
    synthetic_persona_value_recognition: 'pending',
    traces: traces.map(({ id, sha256, exit_code, timed_out, duration_ms }) => ({ id, sha256, exit_code, timed_out, duration_ms }))
  };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
