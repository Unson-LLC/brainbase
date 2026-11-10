#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
assert.equal(process.argv.length, 4, 'Usage: node .cursor/skills/verify-brainbase/scripts/verify.mjs NEW_EVIDENCE_DIRECTORY EXPECTED_HEAD_SHA');
const evidence = resolve(process.argv[2]);
const expectedHead = process.argv[3];
assert(/^[a-f0-9]{40}$/.test(expectedHead), 'Expected a full head SHA');
assert(relative(root, evidence).startsWith('..' + '/') || relative(root, evidence) === '..',
  'Evidence must be outside the checkout');
// Refuse reuse: old passing evidence must never mask a failed run.
await mkdir(evidence);
const scratch = await mkdtemp(join(tmpdir(), '.verify-brainbase-'));
const data = join(scratch, 'personal-os');
const env = {
  PATH: process.env.PATH ?? '',
  LANG: 'C.UTF-8',
  BRAINBASE_PERSONAL_OS_DIR: data,
  BRAINBASE_PERSONAL_KNOWLEDGE_MODE: 'local',
};
const events = [];
let client;
let passed = false;
let interrupted;
let finishing;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.once(signal, async () => {
    interrupted = signal;
    process.exitCode = code;
    await save('failure.json', { message: 'Interrupted by ' + signal });
    await finish();
    process.exit(code);
  });
}
async function finish() {
  finishing ??= (async () => {
    try { if (client) await client.close(); }
    finally {
      await save('actions.json', events);
      await rm(scratch, { recursive: true, force: true });
      const cleanup = !(await readdir(dirname(scratch))).includes(scratch.slice(dirname(scratch).length + 1));
      const result = passed && cleanup && !interrupted ? 'PASS' : 'FAIL';
      await save('result.json', { result, cleanup, signal: interrupted,
        features: ['cli-seed', 'mcp-readback', 'install-preview'],
        unverified: ['Web UI', 'real agent first value', 'host MCP configuration',
          'Node 22 skill execution', 'claude and codecode configuration previews',
          'external sources', 'Graph search and resolution', 'automatic merge', 'next morning sampling'],
        finishedAt: new Date().toISOString() });
      console.log(JSON.stringify({ result, cleanup, evidence }));
      if (result !== 'PASS' && !process.exitCode) process.exitCode = 1;
    }
  })();
  return finishing;
}
async function save(name, value) {
  await writeFile(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
}
function cli(args, expected = 0) {
  const result = spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 30000,
  });
  events.push({ feature: args[0], command: [process.execPath, 'dist/cli.js', ...args],
    stdout: result.stdout, stderr: result.stderr, exitCode: result.status,
    error: result.error?.message });
  assert.equal(result.status, expected, JSON.stringify(events.at(-1)));
  return result.stdout;
}
async function snapshot(path) {
  const out = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of Object.entries(await snapshot(full))) out[entry.name + '/' + key] = value;
    } else {
      assert(entry.isFile(), 'Unexpected symlink or special file: ' + full);
      out[entry.name] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  return out;
}
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  events.push({ feature: 'mcp-readback', method: 'tools/call', name, arguments: args, response });
  assert(!response.isError, JSON.stringify(response));
  const content = response.content.find(item => item.type === 'text');
  assert(content, 'No text content for ' + name);
  return JSON.parse(content.text);
}
try {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(sha.status, 0);
  const gitStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitStatus.status, 0);
  await save('identity.json', { head: sha.stdout.trim(), expectedHead, gitStatus: gitStatus.stdout, node: process.version, root, data,
    cliEnvKeys: Object.keys(env), mcpEnvKeys: Object.keys({ ...getDefaultEnvironment(), ...env }), startedAt: new Date().toISOString() });
  assert.equal(sha.stdout.trim(), expectedHead, 'HEAD does not match expected SHA');
  assert.equal(gitStatus.stdout, '', 'Working tree is dirty');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  events.push({ feature: 'build', head: expectedHead, exitCode: build.status,
    stdout: build.stdout, stderr: build.stderr, error: build.error?.message });
  assert.equal(build.status, 0, 'Build failed: ' + build.stderr);
  const afterBuild = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  assert.equal(afterBuild.status, 0);
  assert.equal(afterBuild.stdout, '', 'Build changed working tree');
  cli(['onboard:init', '--dir', data]);
  // Doctor checks the real data, not a TCP liveness probe.
  const doctor = JSON.parse(cli(['doctor', '--dir', data]));
  await save('doctor.json', doctor);
  assert.equal(doctor.localBackend?.connected, true);
  cli(['onboard:seed', '--dir', data, '--name', 'Verification Owner',
    '--value', 'Keep verification local', '--project', 'Local verification project',
    '--decision-principle', 'Read evidence before deciding',
    '--relationship', 'Verification Reviewer|reviewer|Checks local evidence']);
  const memories = JSON.parse(cli(['memory:list', '--dir', data, '--format', 'json']));
  await save('memories.json', memories);
  assert(JSON.stringify(memories).includes('Keep verification local'));
  const disk = await snapshot(data);
  await save('persisted-files.json', disk);
  const kg = await readFile(join(data, 'personal-kg.jsonl'), 'utf8');
  assert(kg.includes('Keep verification local'));
  const previewPath = join(scratch, 'must-not-exist.toml');
  const beforePreview = await snapshot(scratch);
  const preview = cli(['onboard:install', '--dir', data, '--target', 'codex', '--dry-run', '--output', previewPath]);
  assert(preview.includes(data));
  assert(preview.includes('[mcp_servers.brainbase]'));
  assert(preview.split('\n').includes('args = [' + JSON.stringify(join(root, 'dist/index.js')) + ']'),
    'Preview must point args to this checkout MCP entry');
  assert.deepEqual(await snapshot(scratch), beforePreview, 'Dry-run changed files');
  await save('install-preview.json', { preview, before: beforePreview, after: await snapshot(scratch) });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(root, 'dist/index.js')], cwd: root, env, stderr: 'pipe' });
  let serverStderr = '';
  transport.stderr?.on('data', chunk => { serverStderr += chunk; });
  client = new Client({ name: 'verify-brainbase', version: '1.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  events.push({ feature: 'mcp-readback', method: 'tools/list', response: tools });
  for (const name of ['get_context', 'list_entities', 'onboarding_status']) {
    assert(tools.tools.some(tool => tool.name === name), 'Missing public tool ' + name);
  }
  const entities = await call('list_entities', { type: 'project' });
  assert(JSON.stringify(entities).includes('Local verification project'));
  const context = await call('get_context', {});
  assert(JSON.stringify(context).includes('Keep verification local'));
  const status = await call('onboarding_status', {});
  assert.equal(status.localBackend?.connected, true);
  await client.close();
  client = undefined;
  await save('mcp-stderr.json', { stderr: serverStderr });
  assert.deepEqual(await snapshot(data), disk, 'Read-only MCP calls changed canonical files');
  passed = true;
} catch (error) {
  await save('failure.json', { message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  await finish();
}
