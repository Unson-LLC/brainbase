#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_API_URL = 'https://graph.brain-base.work';

function parseArgs(argv) {
  const options = { apiUrl: DEFAULT_API_URL };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--api-url' && argv[i + 1]) {
      options.apiUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function normalizeApiUrl(url) {
  return (url || DEFAULT_API_URL).trim().replace(/\/+$/, '');
}

function nowIso() {
  return new Date().toISOString();
}

function stampForFile() {
  return nowIso().replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'file_not_found' };
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function runCommand(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

async function postRefresh(apiUrl, refreshToken) {
  const url = `${apiUrl}/api/auth/refresh`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

async function fetchJsonWithAuth(apiUrl, endpoint, accessToken) {
  const url = `${apiUrl}${endpoint}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

function tokenExpiresSoon(tokens) {
  const issuedAt = Number(tokens?.issued_at || 0);
  const expiresIn = Number(tokens?.expires_in || 0);
  if (!issuedAt || !expiresIn) return false;
  const now = Math.floor(Date.now() / 1000);
  return now >= (issuedAt + expiresIn - 60);
}

function buildReportPath(username) {
  const reportsDir = path.resolve(process.cwd(), '_ops', 'reports');
  ensureDir(reportsDir);
  const fileName = `brainbase-setup-report-${username}-${stampForFile()}.json`;
  return path.join(reportsDir, fileName);
}

function extractEnvValue(text, key) {
  const regex = new RegExp(`${key}=([^\\n\\r]+)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log('Usage: node _ops/check_brainbase_member_setup.mjs [--api-url https://graph.brain-base.work]');
    process.exit(0);
  }

  const apiUrl = normalizeApiUrl(options.apiUrl);
  const username = (process.env.USER || os.userInfo().username || 'unknown').toLowerCase();
  const tokenFilePath = path.join(os.homedir(), '.brainbase', 'tokens.json');

  const report = {
    generated_at: nowIso(),
    user: {
      username,
      hostname: os.hostname(),
      platform: process.platform,
      node_version: process.version,
      cwd: process.cwd()
    },
    inputs: {
      api_url: apiUrl,
      command: process.argv.join(' ')
    },
    checks: {}
  };

  // 1) tokens.json
  const tokenRead = readJsonSafe(tokenFilePath);
  report.checks.tokens_file = {
    path: tokenFilePath,
    exists: tokenRead.ok,
    ok: tokenRead.ok,
    error: tokenRead.ok ? null : tokenRead.error
  };

  let tokens = tokenRead.ok ? tokenRead.value : null;
  if (tokens) {
    report.checks.tokens_file.fields = {
      has_access_token: Boolean(tokens.access_token),
      has_refresh_token: Boolean(tokens.refresh_token),
      issued_at: tokens.issued_at || null,
      expires_in: tokens.expires_in || null
    };
  }

  // 2) MCP config check
  const mcpGet = runCommand('claude', ['mcp', 'get', 'brainbase']);
  const mcpStdout = mcpGet.stdout || '';
  const entitySource = extractEnvValue(mcpStdout, 'BRAINBASE_ENTITY_SOURCE');
  const graphApiUrl = extractEnvValue(mcpStdout, 'BRAINBASE_GRAPH_API_URL');
  const normalizedGraphApiUrl = graphApiUrl ? normalizeApiUrl(graphApiUrl) : null;
  const mcpConnected = mcpStdout.includes('Status: ✓ Connected');
  const sourceOk = entitySource === 'graphapi';
  const urlOk = normalizedGraphApiUrl === apiUrl;

  report.checks.mcp_brainbase = {
    ok: mcpGet.ok && mcpConnected && sourceOk && urlOk,
    command_ok: mcpGet.ok,
    connected: mcpConnected,
    source: entitySource,
    graph_api_url: graphApiUrl,
    scope_line: (mcpStdout.split('\n').find((line) => line.includes('Scope:')) || '').trim(),
    command_line: (mcpStdout.split('\n').find((line) => line.includes('Command:')) || '').trim(),
    hints: {
      expected_source: 'graphapi',
      expected_graph_api_url: apiUrl
    },
    stdout: mcpGet.ok ? mcpStdout : null,
    stderr: mcpGet.ok ? null : (mcpGet.stderr || mcpGet.stdout || 'claude mcp get failed')
  };

  // 3) public API health
  try {
    const healthRes = await fetch(`${apiUrl}/api/health`, { method: 'GET' });
    const healthText = await healthRes.text();
    let healthData = null;
    try {
      healthData = healthText ? JSON.parse(healthText) : null;
    } catch {
      healthData = { raw: healthText };
    }
    report.checks.api_health = {
      ok: healthRes.ok,
      status: healthRes.status,
      status_text: healthRes.statusText,
      response: healthData
    };
  } catch (error) {
    report.checks.api_health = {
      ok: false,
      error: error.message
    };
  }

  // 4) authenticated API checks
  const authCheck = {
    ok: false,
    setup_config_ok: false,
    graph_context_ok: false,
    token_refreshed: false,
    error: null
  };

  try {
    if (!tokens?.access_token) {
      throw new Error('access_token not found in ~/.brainbase/tokens.json');
    }

    if (tokenExpiresSoon(tokens) && tokens.refresh_token) {
      const refreshed = await postRefresh(apiUrl, tokens.refresh_token);
      if (refreshed.response.ok && refreshed.data?.access_token) {
        tokens = {
          access_token: refreshed.data.access_token,
          refresh_token: refreshed.data.refresh_token || tokens.refresh_token,
          expires_in: refreshed.data.expires_in || 3600,
          issued_at: Math.floor(Date.now() / 1000)
        };
        ensureDir(path.dirname(tokenFilePath));
        fs.writeFileSync(tokenFilePath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
        authCheck.token_refreshed = true;
      }
    }

    let setupResult = await fetchJsonWithAuth(apiUrl, '/api/setup/config', tokens.access_token);
    if (setupResult.response.status === 401 && tokens.refresh_token) {
      const refreshed = await postRefresh(apiUrl, tokens.refresh_token);
      if (refreshed.response.ok && refreshed.data?.access_token) {
        tokens = {
          access_token: refreshed.data.access_token,
          refresh_token: refreshed.data.refresh_token || tokens.refresh_token,
          expires_in: refreshed.data.expires_in || 3600,
          issued_at: Math.floor(Date.now() / 1000)
        };
        ensureDir(path.dirname(tokenFilePath));
        fs.writeFileSync(tokenFilePath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
        authCheck.token_refreshed = true;
        setupResult = await fetchJsonWithAuth(apiUrl, '/api/setup/config', tokens.access_token);
      }
    }

    authCheck.setup_config = {
      ok: setupResult.response.ok && setupResult.data?.ok === true,
      status: setupResult.response.status
    };

    if (!(setupResult.response.ok && setupResult.data?.ok === true)) {
      throw new Error(`GET /api/setup/config failed: ${setupResult.response.status}`);
    }

    const projects = Array.isArray(setupResult.data?.projects) ? setupResult.data.projects : [];
    authCheck.setup_config_ok = true;
    authCheck.user = setupResult.data?.user || null;
    authCheck.projects = {
      count: projects.length,
      ids: projects.map((p) => p.id),
      names: projects.map((p) => p.name)
    };

    if (projects.length === 0) {
      throw new Error('No projects returned from /api/setup/config');
    }

    const firstProjectId = projects[0].id;
    const contextEndpoint = `/api/info/context?project=${encodeURIComponent(firstProjectId)}&limit=20`;
    const contextResult = await fetchJsonWithAuth(apiUrl, contextEndpoint, tokens.access_token);

    authCheck.graph_context = {
      ok: contextResult.response.ok,
      status: contextResult.response.status,
      endpoint: contextEndpoint
    };

    if (contextResult.response.ok && contextResult.data?.meta) {
      authCheck.graph_context_ok = true;
      authCheck.graph_context_meta = contextResult.data.meta;
    } else {
      authCheck.graph_context_error = contextResult.data?.error || null;
    }

    authCheck.ok = authCheck.setup_config_ok && authCheck.graph_context_ok;
  } catch (error) {
    authCheck.error = error.message;
  }

  report.checks.authenticated_api = authCheck;

  const requiredChecks = [
    report.checks.tokens_file.ok,
    report.checks.mcp_brainbase.ok,
    report.checks.api_health.ok,
    report.checks.authenticated_api.ok
  ];

  report.summary = {
    ok: requiredChecks.every(Boolean),
    required_checks: {
      tokens_file: report.checks.tokens_file.ok,
      mcp_brainbase: report.checks.mcp_brainbase.ok,
      api_health: report.checks.api_health.ok,
      authenticated_api: report.checks.authenticated_api.ok
    }
  };

  const reportPath = buildReportPath(username);
  writeJson(reportPath, report);

  console.log(`✅ Report generated: ${reportPath}`);
  console.log(`- overall: ${report.summary.ok ? 'PASS' : 'FAIL'}`);
  console.log(`- mcp: ${report.checks.mcp_brainbase.ok ? 'PASS' : 'FAIL'}`);
  console.log(`- api health: ${report.checks.api_health.ok ? 'PASS' : 'FAIL'}`);
  console.log(`- graph data fetch: ${report.checks.authenticated_api.ok ? 'PASS' : 'FAIL'}`);

  if (!report.summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`❌ Failed: ${error.message}`);
  process.exit(1);
});
