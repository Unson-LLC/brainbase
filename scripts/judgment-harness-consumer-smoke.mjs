#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function run(command, args, cwd, environment) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      result.error?.message ?? `Command failed: ${command} ${args.join(' ')} (exit ${result.status ?? 'unknown'})`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function credentialFreeEnvironment(environment) {
  const allowedNames = [
    'LANG', 'LC_ALL', 'LC_CTYPE',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'
  ];
  return Object.fromEntries(allowedNames.flatMap((name) => (
    typeof environment[name] === 'string' && environment[name] !== '' ? [[name, environment[name]]] : []
  )));
}

function isolatedConsumerEnvironment(environment, consumerRoot) {
  const systemPaths = process.platform === 'win32'
    ? [path.dirname(process.execPath), path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')]
    : [path.dirname(process.execPath), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  return {
    ...credentialFreeEnvironment(environment),
    HOME: consumerRoot,
    USERPROFILE: consumerRoot,
    TMPDIR: path.join(consumerRoot, 'tmp'),
    TEMP: path.join(consumerRoot, 'tmp'),
    TMP: path.join(consumerRoot, 'tmp'),
    PATH: [path.join(consumerRoot, 'node_modules', '.bin'), ...systemPaths].join(path.delimiter),
    NPM_CONFIG_USERCONFIG: path.join(consumerRoot, 'user-npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(consumerRoot, 'global-npmrc'),
    NPM_CONFIG_CACHE: path.join(consumerRoot, 'npm-cache'),
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/'
  };
}

function installTarball(tarballPath, consumerRoot, environment) {
  const installEnvironment = {
    ...environment,
    PATH: [process.env.PATH, environment.PATH].filter(Boolean).join(path.delimiter)
  };
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], consumerRoot, installEnvironment);
}

function harnessProbeSource() {
  return `import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageJsonUrl = await import.meta.resolve('@unson/brainbase-mcp/package.json');
const packageRoot = dirname(fileURLToPath(packageJsonUrl));

async function assertSubpath(subpath, exportKey) {
  const resolved = fileURLToPath(await import.meta.resolve(subpath));
  if (!resolved.startsWith(join(packageRoot, 'dist'))) {
    throw new Error(\`subpath \${subpath} did not resolve under installed dist/\`);
  }
  return {
    subpath,
    exportKey,
    modulePath: resolved.slice(packageRoot.length + 1).replaceAll('\\\\', '/')
  };
}

const host = await import('@unson/brainbase-mcp/judgment-host');
const executionOutcome = await import('@unson/brainbase-mcp/judgment-execution-outcome');
const nodeEvidence = await import('@unson/brainbase-mcp/judgment-node-evidence');
const eventAdapter = await import('@unson/brainbase-mcp/judgment-event-adapter');
const eventOutbox = await import('@unson/brainbase-mcp/judgment-event-outbox');

const importSpecs = [
  ['@unson/brainbase-mcp/judgment-host', 'buildJudgmentRequest'],
  ['@unson/brainbase-mcp/judgment-execution-outcome', 'normalizeJudgmentExecutionOutcome'],
  ['@unson/brainbase-mcp/judgment-node-evidence', 'normalizeJudgmentNodeResult'],
  ['@unson/brainbase-mcp/judgment-event-adapter', 'sanitizeJudgmentAnswer'],
  ['@unson/brainbase-mcp/judgment-event-outbox', 'enqueueJudgmentKnowledgeEvent']
];
const imports = [];
for (const [subpath, exportKey] of importSpecs) {
  imports.push(await assertSubpath(subpath, exportKey));
  const module = await import(subpath);
  if (typeof module[exportKey] !== 'function') {
    throw new Error(\`missing export \${exportKey} from \${subpath}\`);
  }
}

const completedOutcome = executionOutcome.normalizeJudgmentExecutionOutcome({
  schema_version: 'judgment_execution_outcome.v1',
  host: { type: 'codex', adapter_id: 'consumer-host', adapter_version: '1' },
  execution_id: 'execution-consumer',
  turn_id: 'turn-consumer',
  scope: 'host_turn',
  status: 'completed',
  stage: 'finalize',
  failure: null,
  resume_from: null,
  evidence: { state: 'confirmed', refs: ['receipt:turn-consumer'] }
});
if (completedOutcome.turn_id !== 'turn-consumer') {
  throw new Error('execution outcome normalization did not round-trip');
}

const knowledgeEvent = {
  schema_version: 'knowledge_event.v1',
  contract_version: 'knowledge_event.v1',
  event_id: 'consumer-harness-event',
  occurred_at: '2026-10-19T00:00:00.000Z',
  captured_at: '2026-10-19T00:00:00.000Z',
  source: { type: 'codex_judgment', ref: 'session-consumer:turn-consumer' },
  subject: { type: 'judgment_episode', id: 'episode-consumer' },
  decision_authority: {
    kind: 'judgment_receipt',
    authorized: false,
    graph_promotion_allowed: false
  },
  applicability_scope: { scope: 'judgment_episode', project_code: 'brainbase' },
  permission_snapshot: { knowledge_registration: true, external_action: false },
  source_pointer: { uri: 'codex://threads/session-consumer#turn=turn-consumer' },
  body_hash: 'body-hash-consumer',
  parent_episode_id: 'episode-consumer',
  payload: { summary: 'Consumer harness queue/readback smoke.' }
};

const varRoot = await mkdtemp(join(tmpdir(), 'brainbase-judgment-harness-consumer-'));
try {
  const paths = eventOutbox.resolveJudgmentKnowledgeEventOutboxPaths({ root: varRoot });
  const queued = eventOutbox.enqueueJudgmentKnowledgeEvent(knowledgeEvent, { directory: paths.outboxDir });
  if (queued.status !== 'queued') {
    throw new Error('enqueue did not queue the knowledge event');
  }
  let posts = 0;
  const delivery = await eventOutbox.deliverJudgmentKnowledgeEventOutbox({
    paths,
    delivery: {
      post: async (candidate) => {
        posts += 1;
        return {
          event_id: candidate.event_id,
          candidate_id: 'candidate-consumer',
          http_status: 201,
          received_at: '2026-10-19T00:00:01.000Z'
        };
      },
      readback: async ({ event: candidate, post }) => ({
        schema_version: eventOutbox.JUDGMENT_EVENT_READBACK_SCHEMA_VERSION,
        event_id: candidate.event_id,
        candidate_id: post.candidate_id,
        processing_stage: 'retrievable',
        semantic_state: 'active',
        readback_at: '2026-10-19T00:00:02.000Z'
      })
    },
    now: () => new Date('2026-10-19T00:00:03.000Z')
  });
  if (delivery.delivered !== 1 || delivery.pending !== 0 || posts !== 1) {
    throw new Error('queue/readback delivery did not confirm the event');
  }
  const remaining = await readdir(paths.outboxDir);
  if (remaining.length !== 0) {
    throw new Error('queue directory was not drained after confirmed readback');
  }

  process.stdout.write(JSON.stringify({
    packageRoot,
    subpathImports: imports,
    hostApi: typeof host.buildJudgmentRequest === 'function' ? 'passed' : 'failed',
    executionOutcome: 'passed',
    nodeEvidence: typeof nodeEvidence.normalizeJudgmentNodeResult === 'function' ? 'passed' : 'failed',
    eventAdapter: typeof eventAdapter.sanitizeJudgmentAnswer === 'function' ? 'passed' : 'failed',
    outbox: {
      enqueue: queued.status,
      delivery,
      posts
    },
    queueReadbackSmoke: 'passed'
  }));
} finally {
  await rm(varRoot, { recursive: true, force: true });
}
`;
}

export async function runJudgmentHarnessConsumerSmoke(tarballPath, options = {}) {
  const absoluteTarball = path.resolve(tarballPath);
  const consumerRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-judgment-harness-consumer-'));
  try {
    const npmUserConfig = path.join(consumerRoot, 'user-npmrc');
    const npmGlobalConfig = path.join(consumerRoot, 'global-npmrc');
    await mkdir(path.join(consumerRoot, 'tmp'));
    await writeFile(npmUserConfig, '');
    await writeFile(npmGlobalConfig, '');
    const environment = isolatedConsumerEnvironment(options.environment ?? process.env, consumerRoot);
    await writeFile(path.join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: 'brainbase-judgment-harness-consumer-smoke',
      version: '1.0.0',
      private: true,
      type: 'module'
    }, null, 2)}\n`);
    installTarball(absoluteTarball, consumerRoot, environment);

    const installedPackageRoot = path.join(consumerRoot, 'node_modules/@unson/brainbase-mcp');
    const manifest = JSON.parse(await readFile(path.join(installedPackageRoot, 'package.json'), 'utf8'));
    await access(path.join(installedPackageRoot, 'dist/judgment-host.js'));
    await access(path.join(installedPackageRoot, 'dist/judgment-event-outbox.js'));
    await access(path.join(installedPackageRoot, 'src')).then(
      () => { throw new Error('installed package unexpectedly contains repository source files'); },
      () => undefined
    );

    const probePath = path.join(consumerRoot, 'judgment-harness-probe.mjs');
    await writeFile(probePath, harnessProbeSource());
    const probe = JSON.parse(run(process.execPath, [probePath], consumerRoot, environment));

    return {
      packageName: manifest.name,
      version: manifest.version,
      consumerRoot,
      judgmentHarness: probe,
      runtime: { command: process.execPath, tarball: absoluteTarball }
    };
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

function isDirectInvocation() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  const tarballPath = process.argv[2];
  if (!tarballPath) {
    console.error('Usage: judgment-harness-consumer-smoke.mjs <release-tarball.tgz>');
    process.exitCode = 1;
  } else {
    runJudgmentHarnessConsumerSmoke(tarballPath)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
