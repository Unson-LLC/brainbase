import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = resolve(new URL('../../..', import.meta.url).pathname);
const outputDir = resolve(repo, 'docs/ux-research/cycle-07-human-first-value/after-corpus');
const runRoot = await mkdtemp(join(tmpdir(), 'brainbase-cycle07-after-'));
const consumer = join(runRoot, 'consumer');
const dataDir = join(runRoot, 'personal-os');
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
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  const trace = {
    id,
    invocation_kind: 'child_process.spawn',
    executable: redact(executable),
    args: args.map(redact),
    cwd: redact(cwd),
    exit_code: exitCode,
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
  const pack = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', runRoot], { cwd: repo, encoding: 'utf8' }));
  const tarball = join(runRoot, pack[0].filename);
  execFileSync('npm', ['init', '--yes'], { cwd: consumer, stdio: 'ignore' });
  const journeyStartedAt = performance.now();
  const traces = [];
  traces.push(await run('after-01-install', 'npm', ['install', '--ignore-scripts', tarball]));
  const binary = join(consumer, 'node_modules', '.bin', 'brainbase');
  const start = await run('after-02-start', binary, [
    'onboard:start', '--target', 'codex', '--dir', dataDir,
    '--name', '佐藤', '--value', '同じ前提を説明し直さず、事実と未確認を分ける',
    '--project', 'Atlas導入', '--decision-principle', '実測と利用者成果を分けて判断する',
    '--stakeholder', '田中|最終判断者|Atlas導入の承認を担当'
  ]);
  traces.push(start);
  const displayedSeed = start.raw_stdout.match(/`(brainbase onboard:seed[^`]+)`/u)?.[1];
  if (!displayedSeed) throw new Error('start output did not contain a copyable seed command');
  traces.push(await run('after-03-displayed-seed', '/bin/sh', ['-c', displayedSeed]));
  traces.push(await run('after-04-install-preview', binary, ['onboard:install', '--target', 'codex', '--dir', dataDir, '--dry-run']));
  traces.push(await run('after-05-doctor', binary, ['doctor', '--dir', dataDir, '--format', 'json']));

  const node = process.execPath;
  const server = join(consumer, 'node_modules', '@unson', 'brainbase-mcp', 'dist', 'index.js');
  const prompt = [
    'Brainbaseのget_contextとsearchを実際に使ってください。',
    '保存済み文脈を根拠に、Atlas導入について田中さんへ相談する判断メモを作ってください。',
    '事実、未確認事項、次に田中さんと合意すべきことを分け、最後に使ったBrainbase文脈を明示してください。',
    'ファイル変更や外部送信はしないでください。'
  ].join('');
  const codex = await run('after-06-real-codex', 'codex', [
    '--dangerously-bypass-approvals-and-sandbox',
    '-c', `mcp_servers.brainbase.command=${JSON.stringify(node)}`,
    '-c', `mcp_servers.brainbase.args=${JSON.stringify([server])}`,
    '-c', `mcp_servers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR=${JSON.stringify(dataDir)}`,
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', prompt
  ]);
  traces.push(codex);
  const journeyDurationMs = Math.round(performance.now() - journeyStartedAt);
  const codexText = codex.raw_stdout;
  const actualMcpUsed = /brainbase.*(?:get_context|search)|(?:get_context|search).*brainbase/iu.test(codexText);
  const usefulBodyPresent = ['Atlas導入', '田中', '未確認', '合意'].every((marker) => codexText.includes(marker));
  const manifest = {
    version: 1,
    evidence_kind: 'candidate_end_to_end_journey',
    source_snapshot: 'working-tree',
    base_revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    package: pack[0].filename,
    tarball_sha256: createHash('sha256').update(await readFile(tarball)).digest('hex'),
    journey_budget_ms: 600000,
    candidate_answer_duration_ms: journeyDurationMs,
    candidate_answer_within_budget: journeyDurationMs <= 600000,
    installed_from_local_tarball: traces[0].exit_code === 0,
    displayed_seed_executed: traces[2].exit_code === 0,
    actual_codex_exit_code: codex.exit_code,
    actual_mcp_used: actualMcpUsed,
    useful_body_present: usefulBodyPresent,
    candidate_journey_passed: traces.every((trace) => trace.exit_code === 0) && actualMcpUsed && usefulBodyPresent,
    human_value_recognition: 'not_collected',
    first_value_achieved: false,
    production_registry_install: 'not_collected',
    traces: traces.map(({ id, sha256, exit_code, duration_ms }) => ({ id, sha256, exit_code, duration_ms }))
  };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
