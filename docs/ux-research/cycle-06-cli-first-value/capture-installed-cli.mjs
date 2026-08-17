import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = resolve(new URL('../../..', import.meta.url).pathname);
const outputDir = resolve(repo, 'docs/ux-research/cycle-06-cli-first-value/installed-cli-after');
const runRoot = await mkdtemp(join(tmpdir(), 'brainbase-installed-cli-'));
const consumer = join(runRoot, 'consumer');
const dataDir = join(runRoot, 'personal-os');
await mkdir(outputDir, { recursive: true });
await mkdir(consumer, { recursive: true });

function redact(value) {
  return value.replaceAll(runRoot, '<isolated-run-root>').replaceAll(repo, '<repo>');
}

async function run(id, executable, args, cwd = consumer) {
  const startedAt = performance.now();
  const child = spawn(executable, args, {
    cwd,
    env: {
      ...process.env,
      PATH: `${join(consumer, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      NO_COLOR: '1',
      XDG_CONFIG_HOME: join(runRoot, 'xdg-config'),
      XDG_DATA_HOME: join(runRoot, 'xdg-data')
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
    invocation: 'child_process.spawn',
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
  Object.defineProperty(trace, 'sha256', { value: createHash('sha256').update(body).digest('hex'), enumerable: false });
  Object.defineProperty(trace, 'raw_stdout', { value: stdout, enumerable: false });
  return trace;
}

try {
  const pack = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', runRoot], { cwd: repo, encoding: 'utf8' }));
  const tarball = join(runRoot, pack[0].filename);
  execFileSync('npm', ['init', '--yes'], { cwd: consumer, stdio: 'ignore' });
  execFileSync('npm', ['install', '--ignore-scripts', tarball], { cwd: consumer, stdio: 'ignore' });
  const binary = join(consumer, 'node_modules', '.bin', 'brainbase');
  const traces = [];
  traces.push(await run('installed-01-help', binary, ['onboard:demo', '--help']));
  const start = await run('installed-02-start', binary, [
    'onboard:start', '--target', 'codex', '--dir', dataDir, '--name', '高橋葵',
    '--value', '結論を先に示す', '--project', 'Atlas導入',
    '--decision-principle', '推測を事実として扱わない',
    '--stakeholder', '田中|責任者|Atlas導入の最終判断を担当'
  ]);
  traces.push(start);
  const displayedSeed = start.raw_stdout.match(/`(brainbase onboard:seed[^`]+)`/u)?.[1];
  if (!displayedSeed) throw new Error('start output did not contain a copyable seed command');
  traces.push(await run('installed-03-displayed-seed', '/bin/sh', ['-c', displayedSeed]));
  const seedTrace = traces.at(-1);
  const displayedDemo = seedTrace.raw_stdout.match(/^(brainbase onboard:demo .+)$/mu)?.[1];
  if (!displayedDemo) throw new Error('seed output did not contain a copyable demo command');
  const demo = await run('installed-04-displayed-demo', '/bin/sh', ['-c', displayedDemo]);
  traces.push(demo);
  const doctor = await run('installed-05-doctor', binary, ['doctor', '--dir', dataDir, '--format', 'json']);
  traces.push(doctor);
  const doctorStatus = JSON.parse(doctor.raw_stdout);
  const doctorDemoCommand = doctorStatus.valueDemo?.command;
  if (typeof doctorDemoCommand !== 'string') throw new Error('doctor did not contain a copyable valueDemo.command');
  traces.push(await run('installed-06-doctor-displayed-demo', '/bin/sh', ['-c', doctorDemoCommand.replace('<real request>', '田中さんへの確認メモを作って')]));
  traces.push(await run('installed-07-reseed-existing', '/bin/sh', ['-c', displayedSeed]));
  const afterReseed = await run('installed-08-doctor-after-reseed', binary, ['doctor', '--dir', dataDir, '--format', 'json']);
  traces.push(afterReseed);
  const afterReseedStatus = JSON.parse(afterReseed.raw_stdout);
  const markers = [
    'Atlas導入', '田中', '推測を事実として扱わない',
    '次に判断したいこと:', '相談したいこと:', '未確認事項:', '次の行動:'
  ];
  const existingDataPreserved = Object.entries(doctorStatus.counts ?? {}).every(([key, value]) => (
    typeof value === 'number' && Number(afterReseedStatus.counts?.[key]) >= value
  )) && Object.values(afterReseedStatus.seeded ?? {}).every(Boolean);
  const manifest = {
    version: 1,
    evidence_kind: 'local_tarball_install_cli_execution',
    package: '@unson/brainbase-mcp@0.2.0',
    source_snapshot: 'working-tree',
    base_revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    tarball: { filename: pack[0].filename, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex') },
    production_registry_install: 'not_collected',
    displayed_happy_path_commands_executed: ['installed-03-displayed-seed', 'installed-04-displayed-demo', 'installed-06-doctor-displayed-demo']
      .every((id) => traces.find((trace) => trace.id === id)?.exit_code === 0),
    doctor_verified: doctor.exit_code === 0
      && doctor.stdout.includes('"localBackend"')
      && doctor.stdout.includes('"status": "not_verified"')
      && doctor.stdout.includes('"operationallyReady": false'),
    existing_data_preserved_after_reseed: afterReseed.exit_code === 0 && existingDataPreserved,
    useful_outcome: demo.exit_code === 0 && markers.every((marker) => demo.stdout.includes(marker)),
    outcome_scope: 'local_cli_sample',
    real_agent_outcome: 'not_collected',
    markers,
    traces: traces.map(({ id, sha256, exit_code, duration_ms }) => ({ id, sha256, exit_code, duration_ms }))
  };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
