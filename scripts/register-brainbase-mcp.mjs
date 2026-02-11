#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_API_URL = 'https://graph.brain-base.work';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MCP_ENTRY = path.join(ROOT_DIR, 'mcp', 'brainbase', 'lib', 'index.js');

function normalizeApiUrl(url) {
  return (url || DEFAULT_API_URL).trim().replace(/\/+$/, '');
}

function runClaude(args) {
  return spawnSync('claude', args, {
    encoding: 'utf8',
    cwd: ROOT_DIR
  });
}

function removeExistingBrainbaseServer() {
  const scopes = ['project', 'local', 'user'];
  for (const scope of scopes) {
    runClaude(['mcp', 'remove', '-s', scope, 'brainbase']);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--api-url') {
      options.apiUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === '--project-codes') {
      options.projectCodes = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === '--quiet') {
      options.quiet = true;
    }
  }
  return options;
}

function readUserConfig() {
  const userConfigPath = path.join(os.homedir(), '.claude.json');
  if (!fs.existsSync(userConfigPath)) {
    return { userConfigPath, config: {} };
  }
  const raw = fs.readFileSync(userConfigPath, 'utf8');
  return { userConfigPath, config: JSON.parse(raw) };
}

function buildManualCommand(apiUrl, projectCodes) {
  const parts = [
    'claude mcp add -s user --transport stdio brainbase',
    `-e BRAINBASE_ENTITY_SOURCE=graphapi`,
    `-e BRAINBASE_GRAPH_API_URL=${apiUrl}`
  ];
  if (projectCodes) {
    parts.push(`-e BRAINBASE_PROJECT_CODES=${projectCodes}`);
  }
  parts.push(`-- node ${MCP_ENTRY}`);
  return parts.join(' \\\n  ');
}

export function registerBrainbaseMcp({
  apiUrl = process.env.BRAINBASE_API_URL || DEFAULT_API_URL,
  projectCodes = process.env.BRAINBASE_PROJECT_CODES,
  quiet = false
} = {}) {
  const normalizedApiUrl = normalizeApiUrl(apiUrl);
  const normalizedProjectCodes = projectCodes?.trim() || '';

  if (!fs.existsSync(MCP_ENTRY)) {
    throw new Error(`Bundled MCP entry not found: ${MCP_ENTRY}`);
  }

  removeExistingBrainbaseServer();

  const addArgs = [
    'mcp',
    'add',
    '-s',
    'user',
    '--transport',
    'stdio',
    'brainbase',
    '-e',
    'BRAINBASE_ENTITY_SOURCE=graphapi',
    '-e',
    `BRAINBASE_GRAPH_API_URL=${normalizedApiUrl}`
  ];

  if (normalizedProjectCodes) {
    addArgs.push('-e', `BRAINBASE_PROJECT_CODES=${normalizedProjectCodes}`);
  }

  addArgs.push('--', 'node', MCP_ENTRY);

  const addResult = runClaude(addArgs);
  if (addResult.status !== 0) {
    const detail = (addResult.stderr || addResult.stdout || '').trim();
    throw new Error([
      'Failed to register brainbase MCP.',
      detail ? `CLI output: ${detail}` : '',
      'Run this manually:',
      buildManualCommand(normalizedApiUrl, normalizedProjectCodes)
    ]
      .filter(Boolean)
      .join('\n'));
  }

  const { userConfigPath, config } = readUserConfig();
  const userServer = config?.mcpServers?.brainbase;
  if (!userServer) {
    throw new Error(`brainbase MCP is not present in user config: ${userConfigPath}`);
  }

  const getResult = runClaude(['mcp', 'get', 'brainbase']);
  const getDetail = (getResult.stdout || getResult.stderr || '').trim();
  const isProjectOverride = getDetail.includes('Scope: Project config');

  if (!quiet) {
    process.stdout.write('✅ brainbase MCP registered (scope: user)\n');
    if (getDetail) {
      process.stdout.write(`${getDetail}\n`);
    }
    if (isProjectOverride) {
      process.stdout.write('⚠️ A project-scoped brainbase MCP overrides user scope in this directory.\n');
      process.stdout.write('   Remove it with: claude mcp remove -s project brainbase\n');
    }
  }

  return {
    apiUrl: normalizedApiUrl,
    projectCodes: normalizedProjectCodes,
    detail: getDetail
  };
}

function main() {
  try {
    const options = parseArgs(process.argv);
    registerBrainbaseMcp(options);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
