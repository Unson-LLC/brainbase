import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const repo = resolve(new URL('../../..', import.meta.url).pathname);
const phase = process.argv[2] === 'after' ? 'after' : 'baseline';
const outputDir = resolve(repo, `docs/ux-research/cycle-06-cli-first-value/terminal-corpus-${phase}`);
const runRoot = join(tmpdir(), `brainbase-cli-cycle-06-${process.pid}`);
const budgetMs = 600_000;

await rm(runRoot, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const baseEnv = {
  ...process.env,
  XDG_CONFIG_HOME: join(runRoot, 'xdg-config'),
  XDG_DATA_HOME: join(runRoot, 'xdg-data'),
  NO_COLOR: '1'
};

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function redact(value) {
  return value.replaceAll(runRoot, '<isolated-run-root>').replaceAll(repo, '<repo>');
}

async function command(id, args, options = {}) {
  const startedAt = performance.now();
  const child = spawn('npm', ['run', ...args], {
    cwd: repo,
    env: baseEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timeoutMs = options.timeoutMs ?? 120_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, timeoutMs);
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  clearTimeout(timer);
  const trace = {
    id,
    invocation: 'child_process.spawn',
    command: redact(['npm', 'run', ...args].join(' ')),
    cwd: '<repo>',
    duration_ms: Math.round(performance.now() - startedAt),
    timeout_ms: timeoutMs,
    timed_out: timedOut,
    exit_code: exitCode,
    stdout: redact(stdout),
    stderr: redact(stderr)
  };
  const body = `${JSON.stringify(trace, null, 2)}\n`;
  await writeFile(join(outputDir, `${id}.json`), body);
  return trace;
}

const happyDir = join(runRoot, 'happy-personal-os');
const emptyDir = join(runRoot, 'empty-personal-os');
const invalidDir = join(runRoot, 'invalid-personal-os');
const startMarker = performance.now();

const traces = [];
traces.push(await command('happy-01-start', [
  'onboard:start', '--', '--target', 'codex', '--dir', happyDir,
  '--name', '高橋葵', '--value', '結論と次の行動を先に示す',
  '--project', 'Atlas導入', '--decision-principle', '推測を事実として扱わない',
  '--stakeholder', '田中|責任者|導入判断を担当'
]));
traces.push(await command('happy-02-seed', [
  'onboard:seed', '--', '--dir', happyDir,
  '--name', '高橋葵', '--value', '結論と次の行動を先に示す',
  '--project', 'Atlas導入', '--decision-principle', '推測を事実として扱わない',
  '--relationship', '田中|責任者|Atlas導入の最終判断を担当'
]));
const demo = await command('happy-03-demo', [
  'onboard:demo', '--', '--dir', happyDir,
  '--scenario', '田中さんにAtlas導入の相談を投げるための論点メモを作って'
]);
traces.push(demo);
const durationMs = Math.round(performance.now() - startMarker);
traces.push(await command('happy-04-doctor', ['doctor', '--', '--dir', happyDir, '--format', 'json']));

traces.push(await command('recovery-01-demo-before-seed', [
  'onboard:demo', '--', '--dir', emptyDir,
  '--scenario', '保存した文脈を使って相談メモを作って'
]));
traces.push(await command('recovery-02-invalid-seed', [
  'onboard:seed', '--', '--dir', invalidDir,
  '--name', '高橋葵', '--value', '結論を先に示す', '--project', 'Atlas導入',
  '--relationship', '区切りのない不正入力'
]));
traces.push(await command('resume-01-start-existing', [
  'onboard:start', '--', '--target', 'codex', '--dir', happyDir,
  '--name', '高橋葵', '--value', '結論と次の行動を先に示す',
  '--project', 'Atlas導入', '--decision-principle', '推測を事実として扱わない',
  '--stakeholder', '田中|責任者|導入判断を担当'
]));
traces.push(await command('resume-02-demo-again', [
  'onboard:demo', '--', '--dir', happyDir,
  '--scenario', '田中さんにAtlas導入の相談を投げるための論点メモを作って'
]));
traces.push(await command('help-01-demo-help', ['onboard:demo', '--', '--help']));

const valueMarkers = [
  'Atlas導入',
  '田中',
  '推測を事実として扱わない',
  '次に判断したいこと:',
  '相談したいこと:',
  '未確認事項:',
  '次の行動:'
];
const usefulOutcome = demo.exit_code === 0 && valueMarkers.every((marker) => demo.stdout.includes(marker));
const manifest = {
  version: 1,
  phase,
  evidence_kind: 'synthetic_cli_evaluation',
  source_snapshot: 'working-tree',
  base_revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  package: '@unson/brainbase-mcp@0.2.0',
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  isolated_environment: {
    data_root: '<isolated-run-root>',
    xdg_config_home: '<isolated-run-root>/xdg-config',
    xdg_data_home: '<isolated-run-root>/xdg-data',
    production_credentials: false,
    external_side_effects: false
  },
  time_to_value: {
    start_marker: 'happy-01-start child process spawn immediately before execution',
    value_marker: 'happy-03-demo stdout contains an explicitly labeled local sample using the saved project, relationship, and decision principle',
    duration_ms: durationMs,
    budget_ms: budgetMs,
    useful_outcome: usefulOutcome,
    outcome_scope: 'local_cli_sample',
    real_agent_outcome: 'not_collected',
    met_budget: usefulOutcome && durationMs <= budgetMs,
    value_markers: valueMarkers
  },
  traces: traces.map((trace) => ({
    id: trace.id,
    sha256: digest(`${JSON.stringify(trace, null, 2)}\n`),
    exit_code: trace.exit_code,
    duration_ms: trace.duration_ms,
    timed_out: trace.timed_out
  }))
};
await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
