import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

async function until(predicate: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, 'process lifecycle deadline exceeded');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('stdin EOF stops the facade and its pending backend process group', {timeout: 15000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-eof-'));
  const pidFile = join(directory, 'pids.json');
  const backendCode = `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    require('node:fs').writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));
    process.on('SIGTERM',()=>{});
    setInterval(()=>{},1000);
  `;
  const facade = spawn(process.execPath, [
    '--import', 'tsx', fileURLToPath(new URL('../src/stdio-facade.ts', import.meta.url)),
    '-e', backendCode, pidFile,
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {...getDefaultEnvironment(), BRAINBASE_MCP_BACKEND_LAUNCHER: process.execPath},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  facade.stderr.resume();
  let output = '';
  facade.stdout.on('data', chunk => { output += chunk.toString(); });
  let exited = false;
  facade.once('exit', () => { exited = true; });
  let pids: number[] = [];
  try {
    facade.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'eof-test', version: '1'},
    }}) + '\n');
    await until(() => output.includes('"id":1'));
    facade.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
    await until(async () => {
      try { pids = JSON.parse(await readFile(pidFile, 'utf8')); return pids.length === 2; }
      catch { return false; }
    });
    // No SDK close(), signal, or fallback kill: EOF itself must do the cleanup.
    facade.stdin.end();
    await until(() => exited);
    assert.equal(facade.exitCode, 0);
    await until(() => pids.every(pid => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    }));
  } finally {
    if (!exited) facade.kill('SIGKILL');
    if (pids[0]) {
      try { process.kill(-pids[0], 'SIGKILL'); } catch {}
    }
    await rm(directory, {recursive: true, force: true});
  }
});
