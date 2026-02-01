#!/usr/bin/env node

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArgValue = (name) => {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const sessionId = getArgValue('--session-id') || process.env.BRAINBASE_SESSION_ID || '';
const initialPrompt = getArgValue('--initial') || '';
const model = getArgValue('--model') || process.env.CODEX_MODEL || 'gpt-5.2-codex';
const approvalPolicy = getArgValue('--approval') || process.env.CODEX_APPROVAL_POLICY || 'never';
const sandboxMode = getArgValue('--sandbox') || process.env.CODEX_SANDBOX_MODE || 'danger-full-access';
const networkAccess = (process.env.CODEX_NETWORK_ACCESS || 'enabled') === 'enabled';

const server = spawn('codex', ['app-server'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    CODEX_SANDBOX_MODE: sandboxMode,
    CODEX_NETWORK_ACCESS: networkAccess ? 'enabled' : 'disabled',
    CODEX_APPROVAL_POLICY: approvalPolicy
  }
});

let requestId = 1;
const pending = new Map();
let threadId = null;
let activeTurnId = null;
let inTurn = false;
let sawDelta = false;
let resolvedPort = null;

const serverReader = readline.createInterface({
  input: server.stdout,
  crlfDelay: Infinity
});

const stdinReader = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
});

stdinReader.setPrompt('codex> ');

function send(message) {
  server.stdin.write(JSON.stringify(message) + '\n');
}

function mapSandboxPolicy(mode) {
  const normalized = String(mode || '').toLowerCase();
  if (normalized.includes('danger')) {
    return { type: 'dangerFullAccess', networkAccess: true };
  }
  if (normalized.includes('workspace')) {
    return { type: 'workspaceWrite', writableRoots: [process.cwd()], networkAccess };
  }
  if (normalized.includes('read')) {
    return { type: 'readOnly', networkAccess };
  }
  if (normalized.includes('external')) {
    return { type: 'externalSandbox', networkAccess: networkAccess ? 'enabled' : 'restricted' };
  }
  return null;
}

function request(method, params = {}) {
  const id = requestId++;
  send({ id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function resolveBrainbasePort() {
  if (resolvedPort) return resolvedPort;
  if (process.env.BRAINBASE_PORT) {
    resolvedPort = String(process.env.BRAINBASE_PORT);
    return resolvedPort;
  }

  const portFile = process.env.BRAINBASE_PORT_FILE || path.join(process.env.HOME || '', '.brainbase', 'active-port');
  try {
    if (portFile && fs.existsSync(portFile)) {
      const port = fs.readFileSync(portFile, 'utf8').trim();
      if (port) {
        resolvedPort = port;
        return resolvedPort;
      }
    }
  } catch {
    // ignore
  }

  const fallbackFile = path.join(process.env.HOME || '', '.brainbase-port');
  try {
    if (fs.existsSync(fallbackFile)) {
      const port = fs.readFileSync(fallbackFile, 'utf8').trim();
      if (port) {
        resolvedPort = port;
        return resolvedPort;
      }
    }
  } catch {
    // ignore
  }

  resolvedPort = '3000';
  return resolvedPort;
}

async function reportActivity(status) {
  if (!sessionId) return;
  const port = resolveBrainbasePort();
  try {
    await fetch(`http://localhost:${port}/api/sessions/report_activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        status,
        reportedAt: Date.now()
      })
    });
  } catch {
    // ignore
  }
}

function extractText(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.delta === 'string') return payload.delta;
  if (payload.delta && typeof payload.delta.text === 'string') return payload.delta.text;
  if (Array.isArray(payload.content)) {
    return payload.content.map((part) => part?.text || '').join('');
  }
  return null;
}

function handleNotification(method, params) {
  if (method === 'codex/event/task_complete') {
    inTurn = false;
    activeTurnId = null;
    reportActivity('done');
    process.stdout.write('\n');
    stdinReader.prompt();
    return;
  }

  if (method === 'error' || method === 'codex/event/error') {
    inTurn = false;
    activeTurnId = null;
    reportActivity('done');
    process.stdout.write('\n');
    stdinReader.prompt();
    return;
  }

  if (method === 'turn/started') {
    activeTurnId = params?.turn?.id || params?.turnId || activeTurnId;
    inTurn = true;
    sawDelta = false;
    reportActivity('working');
    return;
  }

  if (method === 'turn/completed') {
    inTurn = false;
    activeTurnId = null;
    reportActivity('done');
    if (!sawDelta) {
      const items = params?.turn?.items || [];
      for (const item of items) {
        const text = extractText(item);
        if (text) process.stdout.write(text);
      }
    }
    process.stdout.write('\n');
    stdinReader.prompt();
    return;
  }

  if (method === 'turn/failed' || method === 'turn/interrupted') {
    inTurn = false;
    activeTurnId = null;
    reportActivity('done');
    process.stdout.write('\n');
    stdinReader.prompt();
    return;
  }

  if (method === 'item/agentMessage/delta' || method === 'item/assistantMessage/delta') {
    const text = extractText(params);
    if (text) {
      sawDelta = true;
      process.stdout.write(text);
    }
    return;
  }

  if (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') {
    const text = extractText(params);
    if (text) {
      sawDelta = true;
      process.stdout.write(text);
    }
    return;
  }

  if (method === 'item/completed') {
    const text = extractText(params?.item);
    if (text && !sawDelta) {
      process.stdout.write(text);
    }
  }
}

serverReader.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (typeof message.id === 'number' && message.method) {
    if (message.method.endsWith('requestApproval')) {
      send({ id: message.id, result: { decision: 'accept' } });
      return;
    }
    handleNotification(message.method, message.params || {});
    return;
  }

  if (typeof message.id === 'number') {
    const pendingRequest = pending.get(message.id);
    if (pendingRequest) {
      pending.delete(message.id);
      if (message.error) {
        pendingRequest.reject(message.error);
      } else {
        pendingRequest.resolve(message.result || message);
      }
    }
    return;
  }

  if (message.method) {
    handleNotification(message.method, message.params || {});
  }
});

async function startTurn(text) {
  if (!threadId) return;
  if (inTurn) {
    process.stdout.write('\n[busy] turn in progress\n');
    return;
  }
  inTurn = true;
  sawDelta = false;
  await reportActivity('working');

  try {
    const sandboxPolicy = mapSandboxPolicy(sandboxMode);
    const response = await request('turn/start', {
      threadId,
      input: [{ type: 'text', text }],
      cwd: process.cwd(),
      approvalPolicy,
      ...(sandboxPolicy ? { sandboxPolicy } : {}),
      model
    });
    activeTurnId = response?.turn?.id || activeTurnId;
  } catch (err) {
    inTurn = false;
    process.stdout.write(`\n[error] ${err?.message || 'failed to start turn'}\n`);
    reportActivity('done');
    stdinReader.prompt();
  }
}

async function initialize() {
  await request('initialize', {
    clientInfo: {
      name: 'brainbase-ui',
      title: 'Brainbase UI',
      version: '0.1.0'
    }
  });
  send({ method: 'initialized', params: {} });
  const thread = await request('thread/start', { model });
  threadId = thread?.thread?.id || thread?.threadId || thread?.id;
}

async function run() {
  try {
    await initialize();
  } catch (err) {
    process.stderr.write(`Failed to initialize codex app-server: ${err?.message || err}\n`);
    process.exit(1);
  }

  if (initialPrompt) {
    await startTurn(initialPrompt);
  }

  stdinReader.prompt();

  stdinReader.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      stdinReader.prompt();
      return;
    }
    if (trimmed === '/exit' || trimmed === '/quit') {
      shutdown();
      return;
    }
    await startTurn(trimmed);
  });
}

function shutdown() {
  try {
    stdinReader.close();
  } catch {
    // ignore
  }
  try {
    server.kill('SIGTERM');
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', async () => {
  if (inTurn && activeTurnId) {
    try {
      await request('turn/interrupt', { threadId, turnId: activeTurnId });
    } catch {
      // ignore
    }
    inTurn = false;
    activeTurnId = null;
    reportActivity('done');
    stdinReader.prompt();
    return;
  }
  shutdown();
});

server.on('exit', (code) => {
  process.stderr.write(`codex app-server exited (${code ?? 'unknown'})\n`);
  shutdown();
});

run();
