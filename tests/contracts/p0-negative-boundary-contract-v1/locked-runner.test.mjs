import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  assertLockedRunnerDescriptor,
  finalizeRunnerResult,
  resolveLockedRunner,
  run
} from './run-locked-vitest.mjs';

const descriptorPath = 'contracts/p0-negative-boundary-contract-v1/locked-runner.json';
const expectedArgv = ['node', '--test', 'tests/contracts/p0-negative-boundary-contract-v1/locked-runner.test.mjs'];
const expectedTargets = [
  'tests/contracts/p0-negative-boundary-contract-v1/contract.test.js',
  'tests/contracts/p0-negative-boundary-contract-v1/planning-source-lock.test.js',
  'tests/contracts/p0-negative-boundary-contract-v1/locked-runner.test.mjs',
  'tests/contracts/p0-negative-boundary-contract-v1/run-locked-vitest.mjs',
  descriptorPath
];

test('locks the VibePro argv, computed receipt prefixes and complete content surface', async () => {
  const contract = JSON.parse(await readFile(descriptorPath, 'utf8'));
  assert.deepEqual(contract.vibepro_verification.argv, expectedArgv);
  assert.equal(contract.vibepro_verification.metadata_prefix, 'P0_LOCKED_RUNNER_METADATA=');
  assert.equal(contract.vibepro_verification.cleanup_prefix, 'P0_LOCKED_RUNNER_CLEANUP=');
  assert.deepEqual(contract.vibepro_verification.content_binding_targets, expectedTargets);

  for (const mutate of [
    value => { value.vibepro_verification.argv = ['npm', 'run', 'test:run']; },
    value => { value.vibepro_verification.metadata_prefix = 'AGENT_OBSERVATION='; },
    value => { value.vibepro_verification.content_binding_targets.pop(); }
  ]) {
    const drifted = structuredClone(contract);
    mutate(drifted);
    assert.throws(() => {
      assert.deepEqual(drifted.vibepro_verification.argv, expectedArgv);
      assert.equal(drifted.vibepro_verification.metadata_prefix, 'P0_LOCKED_RUNNER_METADATA=');
      assert.deepEqual(drifted.vibepro_verification.content_binding_targets, expectedTargets);
    });
  }
});

test('computes lock metadata and executes the focused suite through the locked runner', async () => {
  const descriptor = await resolveLockedRunner(process.env.P0_LOCK_INSTALL_ROOT);
  assert.doesNotThrow(() => assertLockedRunnerDescriptor(descriptor));
  assert.equal(descriptor.network_acquisition, false);
  const result = await run();
  assert.deepEqual(result, { code: 0, signal: null });
});

test('finishes cleanup before applying a signal-derived exit state', async () => {
  const order = [];
  const exitCode = await finalizeRunnerResult(
    { code: null, signal: 'SIGTERM' },
    async () => { order.push('cleanup'); },
    code => { order.push(`exit:${code}`); }
  );
  assert.equal(exitCode, 143);
  assert.deepEqual(order, ['cleanup', 'exit:143']);
});

test('removes the temporary AJV link before a forwarded signal run exits', async () => {
  const runnerPath = 'tests/contracts/p0-negative-boundary-contract-v1/run-locked-vitest.mjs';
  const localAjv = resolve('node_modules/ajv');
  const child = spawn(process.execPath, [runnerPath], {
    cwd: process.cwd(),
    env: { ...process.env, npm_config_offline: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let signalSent = false;
  const capture = chunk => {
    output += chunk;
    if (!signalSent && output.includes('P0_LOCKED_RUNNER_METADATA=')) {
      signalSent = true;
      child.kill('SIGTERM');
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const result = await new Promise((fulfil, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => fulfil({ code, signal }));
  });
  assert.equal(signalSent, true);
  assert.deepEqual(result, { code: 143, signal: null });
  assert.match(output, /P0_LOCKED_RUNNER_CLEANUP=.*"ajv_link_absent":true/);
  await assert.rejects(lstat(localAjv), error => error.code === 'ENOENT');
});
