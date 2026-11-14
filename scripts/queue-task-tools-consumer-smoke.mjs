#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  };
}

function installTarball(tarballPath, consumerRoot, environment) {
  const installEnvironment = {
    ...environment,
    PATH: [process.env.PATH, environment.PATH].filter(Boolean).join(path.delimiter)
  };
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], consumerRoot, installEnvironment);
}

// The consumer adapter is intentionally independent (overlay-style).
const consumerAdapterSource = `import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createLocalMcpServer } from '@unson/brainbase-mcp/mcp-runtime';
import { createStreamableHttpHandler } from '@unson/brainbase-mcp/streamable-http';
import { createQueueTaskTools } from '@unson/brainbase-mcp/queue-task-tools';
import { createQueueReferenceBackend } from '@unson/brainbase-mcp/testing/queue-task-tools-contract';
export async function createQueueHttpFixture(options) {
    const backend = createQueueReferenceBackend(options.state, {
        expectedAgentCredentials: options.agent ? { [options.agent.agentId]: options.agent.credential } : {}
    });
    let created = 0;
    let closed = 0;
    const hostCredentials = { agent: options.agent, sharedServiceToken: options.sharedServiceToken };
    let counter = 0;
    const tokens = new Map([['synthetic-A', { token: 'synthetic-A', clientId: 'A', scopes: [] }], ['synthetic-B', { token: 'synthetic-B', clientId: 'B', scopes: [] }]]);
    if (options.agent)
        tokens.set(\`synthetic-\${options.agent.agentId}\`, { token: \`synthetic-\${options.agent.agentId}\`, clientId: options.agent.agentId, scopes: [] });
    const handler = createStreamableHttpHandler({ authenticate: req => tokens.get(req.headers.authorization?.replace(/^Bearer /, '') ?? '') ?? null, createServer: scope => {
            created++;
            const bound = scope.auth?.clientId;
            const server = createLocalMcpServer({ name: 'queue-fixture', version: '0.0.0', tools: createQueueTaskTools({ backend, resolveAgent: extra => extra.authInfo?.clientId === bound && hostCredentials.agent?.agentId === bound ? { kind: 'agent', ...hostCredentials.agent } : null, generateKey: () => options.generatedKeys?.[counter++] ?? \`generated-\${counter}\` }) });
            const close = server.close.bind(server);
            server.close = async () => { closed++; await close(); };
            return server;
        } });
    const server = createServer((req, res) => { void handler.handle(req, res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = new URL(\`http://127.0.0.1:\${address.port}/mcp\`);
    return { url, handler, backend, tokens, get created() { return created; }, get closed() { return closed; }, async close() { await handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve())); } };
}
export function createHttpQueueAdapter() {
    return { transport: 'http', async connect(options) {
            const fixture = await createQueueHttpFixture(options);
            const client = new Client({ name: 'queue-test', version: '0.0.0' });
            const transport = new StreamableHTTPClientTransport(fixture.url, { requestInit: { headers: { Authorization: \`Bearer synthetic-\${options.agent?.agentId ?? 'A'}\` } } });
            try {
                await client.connect(transport);
            }
            catch (e) {
                await fixture.close();
                throw e;
            }
            return { listTools: async () => (await client.listTools()).tools, callTool: async (name, args) => await client.callTool({ name, arguments: args }), snapshot: async () => fixture.backend.snapshot(), close: async () => { try {
                    await transport.terminateSession();
                }
                finally {
                    await client.close();
                    await fixture.close();
                } } };
        } };
}
`;
const probeSource = `
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpQueueAdapter } from './adapter.mjs';
import { QUEUE_TASK_CONTRACT_SCENARIO_NAMES, runQueueTaskContractScenario } from '@unson/brainbase-mcp/testing/queue-task-tools-contract';
const root=path.dirname(fileURLToPath(import.meta.resolve('@unson/brainbase-mcp/package.json')));
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const moduleResolution={};
for(const subpath of ['queue-task-tools','testing/queue-task-tools-contract']) {
 const resolved=fileURLToPath(import.meta.resolve('@unson/brainbase-mcp/'+subpath));
 assert.ok(resolved.startsWith(path.join(root,'dist')+path.sep),'subpath resolved outside the installed package');
 await access(resolved.replace(/\\.js$/,'.d.ts'));
 await import('@unson/brainbase-mcp/'+subpath);
 moduleResolution[subpath]=path.relative(root,resolved).split(path.sep).join('/');
}
let absent=false;
try {await import('vitest');} catch {absent=true;}
assert.ok(absent);assert.ok(!manifest.dependencies?.vitest);
for(const f of await readdir(path.join(root,'dist/testing'))) if(f.endsWith('.js')) assert.ok(!(await readFile(path.join(root,'dist/testing',f),'utf8')).includes('vitest'));
const scenarios=[];
for(const name of QUEUE_TASK_CONTRACT_SCENARIO_NAMES) {
 await runQueueTaskContractScenario(name,createHttpQueueAdapter(),assert);
 scenarios.push({name,status:'passed'});
}
console.log(JSON.stringify({moduleResolution,scenarios,vitestAbsent:'passed'}));
`;
export async function runQueueTaskToolsConsumerSmoke(tarballPath) {
 const consumerRoot=await mkdtemp(path.join(tmpdir(),'brainbase-queue-consumer-'));
 try {
  await mkdir(path.join(consumerRoot,'tmp'));
  for(const f of ['user-npmrc','global-npmrc']) await writeFile(path.join(consumerRoot,f),'');
  await writeFile(path.join(consumerRoot,'package.json'),JSON.stringify({name:'queue-consumer',version:'1.0.0',private:true,type:'module'}));
  const environment=isolatedConsumerEnvironment(process.env,consumerRoot);
  installTarball(path.resolve(tarballPath),consumerRoot,environment);
  await writeFile(path.join(consumerRoot,'adapter.mjs'),consumerAdapterSource);
  await writeFile(path.join(consumerRoot,'probe.mjs'),probeSource);
  return JSON.parse(run(process.execPath,[path.join(consumerRoot,'probe.mjs')],consumerRoot,environment));
 } finally {await rm(consumerRoot,{recursive:true,force:true});}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 runQueueTaskToolsConsumerSmoke(process.argv[2]).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{console.error(e);process.exitCode=1;});
}
