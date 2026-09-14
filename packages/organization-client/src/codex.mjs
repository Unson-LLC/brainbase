import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import { win32 } from 'node:path';
import { validateConfig, readBoundToken, tokenIsCurrent } from './index.mjs';

const TOKEN_ENV = 'ORGANIZATION_CLIENT_ACCESS_TOKEN';

export function buildCodexInvocation(input, accessToken, args = [], environment = process.env) {
  const config = validateConfig(input);
  // This entry point deliberately accepts no CLI overrides or subcommands.
  if (args.length) throw new Error('run-codex does not accept additional arguments; enter your prompt after Codex starts');
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('authentication required; run auth first');
  const env = { ...environment };
  for (const name of Object.keys(env)) {
    if (/^ORGANIZATION_CLIENT_(?:ACCESS|REFRESH)_TOKEN$/i.test(name)) delete env[name];
  }
  env[TOKEN_ENV] = accessToken;
  // Replace the whole map, not individual leaves: no stale headers, commands,
  // or other MCP subprocesses receive this invocation's bearer environment.
  const mcp = `mcp_servers={${JSON.stringify(config.mcp_server_name)}={url=${JSON.stringify(config.mcp_url)},bearer_token_env_var="${TOKEN_ENV}"}}`;
  return {
    args: ['-c', mcp, '-c', 'shell_environment_policy={inherit="none",include_only=[],set={}}'],
    env,
  };
}

export function resolveCodexExecutable({ platform = process.platform, env = process.env, spawnSyncImpl = spawnSync } = {}) {
  if (platform !== 'win32') return 'codex';
  let executable = env.CODEX_EXECUTABLE;
  if (!executable) {
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
    const result = spawnSyncImpl(win32.join(systemRoot, 'System32', 'where.exe'), ['codex.exe'], {
      shell: false, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result.error && result.status === 0) executable = String(result.stdout).split(/\r?\n/).find((line) => line.trim());
  }
  if (typeof executable !== 'string' || executable.includes('\0') || !win32.isAbsolute(executable.trim()) || !/\.exe$/i.test(executable.trim())) {
    throw new Error('native Codex executable required; set CODEX_EXECUTABLE to its absolute .exe path; Claude is not required');
  }
  return executable.trim();
}

export async function runCodex(input, args = [], {
  platform = process.platform, env = process.env, windowsSecurity, spawnSyncImpl = spawnSync,
  spawnImpl = spawn, resolveCodexImpl = resolveCodexExecutable, now = () => Date.now(),
} = {}) {
  const config = validateConfig(input);
  if (args.length) throw new Error('run-codex does not accept additional arguments');
  const token = readBoundToken(config, { platform, env, windowsSecurity, spawnSyncImpl });
  if (!tokenIsCurrent(token, now)) throw new Error('token expired; run refresh or auth first');
  const invocation = buildCodexInvocation(config, token.access_token, args, env);
  const command = resolveCodexImpl({ platform, env, spawnSyncImpl });
  return new Promise((resolve, reject) => {
    let child;
    const handlers = new Map();
    const cleanup = () => { for (const [signal, handler] of handlers) process.removeListener(signal, handler); };
    try { child = spawnImpl(command, invocation.args, { stdio: 'inherit', shell: false, env: invocation.env }); }
    catch { reject(new Error('Codex failed to start')); return; }
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => child.kill?.(signal);
      handlers.set(signal, handler);
      process.once(signal, handler);
    }
    child.once('error', () => { cleanup(); reject(new Error('Codex failed to start')); });
    child.once('close', (code, signal) => {
      cleanup();
      resolve({ exitCode: signal ? 128 + (constants.signals[signal] || 1) : (Number.isInteger(code) ? code : 1) });
    });
  });
}
