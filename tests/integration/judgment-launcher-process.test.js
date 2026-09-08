import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const LAUNCHER = join(REPO_ROOT, 'scripts', 'run-brainbase-mcp.sh');
const RECONCILER = join(REPO_ROOT, 'scripts', 'reconcile-brainbase-mcp-runtime.sh');
const BINDING_SECRET = 'launcher-process-binding-secret-32-bytes';

function run(command, args, { env, timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env, cwd: REPO_ROOT });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`launcher timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            resolve({ code, signal, stdout, stderr });
        });
    });
}

async function listen(handler) {
    const server = createServer(handler);
    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', resolve);
        server.on('error', reject);
    });
    const address = server.address();
    return { server, url: `http://127.0.0.1:${address.port}` };
}

describe('brainbase MCP launcher judgment binding process contract', () => {
    let fixtureDir;
    let launcherRepo;
    let mockInfisical;
    let entry;
    let marker;
    const servers = [];

    beforeEach(() => {
        fixtureDir = mkdtempSync(join(tmpdir(), 'brainbase-judgment-launcher-'));
        launcherRepo = join(fixtureDir, 'clean-repo');
        execFileSync('git', ['clone', '--quiet', '--shared', REPO_ROOT, launcherRepo], {
            cwd: REPO_ROOT,
            stdio: 'ignore'
        });
        mockInfisical = join(fixtureDir, 'infisical');
        entry = join(fixtureDir, 'entry.mjs');
        marker = join(fixtureDir, 'mcp-started');
        writeFileSync(mockInfisical, `#!/bin/bash\nset -euo pipefail\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\n[ "$#" -gt 0 ] && shift\nexec "$@"\n`);
        chmodSync(mockInfisical, 0o700);
        writeFileSync(entry, `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.MCP_STARTED_MARKER, 'started\\n');\n`);
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
        rmSync(fixtureDir, { recursive: true, force: true });
    });

    function environment(overrides = {}) {
        return {
            ...process.env,
            INFISICAL_BIN: mockInfisical,
            INFISICAL_TOKEN: 'test-infisical-token',
            INFISICAL_PROJECT_CONFIG_DIR: join(launcherRepo, 'config'),
            BRAINBASE_REPO_ROOT: launcherRepo,
            BRAINBASE_MCP_ENTRY: entry,
            MCP_STARTED_MARKER: marker,
            BRAINBASE_GRAPH_API_URL: 'http://127.0.0.1:9',
            BRAINBASE_TASK_API_TOKEN: 'bbsvc_launcher_test',
            BRAINBASE_JUDGMENT_BINDING_SECRET: BINDING_SECRET,
            ...overrides
        };
    }

    async function healthyServer({ adapterId = 'brainbase-mcp' } = {}) {
        const running = await listen((request, response) => {
            response.setHeader('content-type', 'application/json');
            if (request.method === 'GET' && request.url?.startsWith('/api/companion/tasks')) {
                response.statusCode = 200;
                response.end('{"items":[]}');
                return;
            }
            if (request.method === 'POST' && request.url === '/api/judgment/resolve') {
                let body = '';
                request.on('data', (chunk) => { body += chunk; });
                request.on('end', () => {
                    const payload = JSON.parse(body);
                    response.statusCode = 200;
                    response.end(JSON.stringify({
                        turn_id: payload.turn_id,
                        request_digest: request.headers['x-brainbase-judgment-request-digest'],
                        host_binding: {
                            adapter_id: adapterId,
                            adapter_version: '1',
                            status: 'managed',
                            enforcement_level: 'host_contract'
                        }
                    }));
                });
                return;
            }
            response.statusCode = 404;
            response.end('{"error":"not found"}');
        });
        servers.push(running.server);
        return running.url;
    }

    it.each([
        ['missing secret', { BRAINBASE_JUDGMENT_BINDING_SECRET: '' }, /missing BRAINBASE_JUDGMENT_BINDING_SECRET/u],
        ['short secret', { BRAINBASE_JUDGMENT_BINDING_SECRET: 'short' }, /must be at least 32 characters/u],
        ['invalid service token', { BRAINBASE_TASK_API_TOKEN: 'invalid-token' }, /bbsvc_ service-token format/u]
    ])('%sを起動前にexit 78で拒否する', async (_label, overrides, message) => {
        const result = await run('bash', [LAUNCHER, '--check'], { env: environment(overrides) });
        expect(result.code).toBe(78);
        expect(result.stderr).toMatch(message);
        expect(existsSync(marker)).toBe(false);
        expect(result.stderr).not.toContain(BINDING_SECRET);
    });

    it('network failureをexit 69で可視化しMCPを開始しない', async () => {
        const result = await run('bash', [LAUNCHER, '--check'], {
            env: environment({ BRAINBASE_GRAPH_API_URL: 'http://127.0.0.1:9' })
        });
        expect(result.code).toBe(69);
        expect(result.stderr).toContain('canonical task API preflight could not connect');
        expect(existsSync(marker)).toBe(false);
    });

    it('binding mismatchをexit 78で可視化し通常起動でもMCP entryを実行しない', async () => {
        const apiUrl = await healthyServer({ adapterId: 'other-adapter' });
        const result = await run('bash', [LAUNCHER], { env: environment({ BRAINBASE_GRAPH_API_URL: apiUrl }) });
        expect(result.code).toBe(78);
        expect(result.stderr).toContain('judgment binding probe returned an untrusted receipt');
        expect(existsSync(marker)).toBe(false);
    });

    it('--check成功時はbindingとlauncher可用性を報告するがMCPを開始しない', async () => {
        const apiUrl = await healthyServer();
        const result = await run('bash', [LAUNCHER, '--check'], { env: environment({ BRAINBASE_GRAPH_API_URL: apiUrl }) });
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('BRAINBASE_JUDGMENT_BINDING_AVAILABLE: brainbase-mcp@1');
        expect(result.stderr).toContain('BRAINBASE_MCP_AVAILABLE');
        expect(existsSync(marker)).toBe(false);
    });

    it('symlink経由のrepo rootでもbinding probe本体を実行する', async () => {
        const apiUrl = await healthyServer();
        const symlinkRoot = join(fixtureDir, 'repo-symlink');
        symlinkSync(launcherRepo, symlinkRoot, 'dir');
        const result = await run('bash', [LAUNCHER, '--check'], {
            env: environment({
                BRAINBASE_GRAPH_API_URL: apiUrl,
                BRAINBASE_REPO_ROOT: symlinkRoot
            })
        });
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('BRAINBASE_JUDGMENT_BINDING_AVAILABLE: brainbase-mcp@1');
        expect(result.stderr).toContain('BRAINBASE_MCP_AVAILABLE');
    });

    it('--checkは未buildのcandidate checkoutでもsigned preflightを実行できる', async () => {
        const apiUrl = await healthyServer();
        const missingEntry = join(fixtureDir, 'candidate-dist-not-built.mjs');
        const result = await run('bash', [LAUNCHER, '--check'], {
            env: environment({
                BRAINBASE_GRAPH_API_URL: apiUrl,
                BRAINBASE_MCP_ENTRY: missingEntry
            })
        });
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('BRAINBASE_JUDGMENT_BINDING_AVAILABLE: brainbase-mcp@1');
        expect(existsSync(missingEntry)).toBe(false);
    });

    it('candidate preflight失敗時はMCP checkoutを変更しない', async () => {
        const uiRuntime = join(fixtureDir, 'ui-runtime');
        const mcpRuntime = join(fixtureDir, 'mcp-runtime');
        const fakeBin = join(fixtureDir, 'bin');
        const reconcileLog = join(fixtureDir, 'candidate-preflight.log');
        mkdirSync(uiRuntime);
        mkdirSync(fakeBin);

        execFileSync('git', ['init', '-q'], { cwd: uiRuntime });
        execFileSync('git', ['config', 'user.name', 'Brainbase Test'], { cwd: uiRuntime });
        execFileSync('git', ['config', 'user.email', 'brainbase-test@example.invalid'], { cwd: uiRuntime });
        mkdirSync(join(uiRuntime, 'scripts'));
        const candidateLauncher = join(uiRuntime, 'scripts', 'run-brainbase-mcp.sh');
        writeFileSync(candidateLauncher, `#!/bin/bash\nset -euo pipefail\ngit -C "$BRAINBASE_REPO_ROOT" rev-parse HEAD >> "$CANDIDATE_PREFLIGHT_LOG"\n[ "\${CANDIDATE_PREFLIGHT_FAIL:-0}" != "1" ]\n`);
        chmodSync(candidateLauncher, 0o700);
        writeFileSync(join(uiRuntime, 'base.txt'), 'base\n');
        execFileSync('git', ['add', '.'], { cwd: uiRuntime });
        execFileSync('git', ['commit', '-qm', 'base'], { cwd: uiRuntime });
        const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: uiRuntime, encoding: 'utf8' }).trim();
        execFileSync('git', ['clone', '-q', uiRuntime, mcpRuntime]);

        writeFileSync(join(uiRuntime, 'candidate.txt'), 'candidate\n');
        execFileSync('git', ['add', 'candidate.txt'], { cwd: uiRuntime });
        execFileSync('git', ['commit', '-qm', 'candidate'], { cwd: uiRuntime });
        const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: uiRuntime, encoding: 'utf8' }).trim();

        const fakeCurl = join(fakeBin, 'curl');
        writeFileSync(fakeCurl, `#!/bin/bash\nprintf '{"runtime":{"git":{"sha":"%s"}}}\\n' "$CANDIDATE_TARGET_SHA"\n`);
        chmodSync(fakeCurl, 0o700);

        const result = await run('bash', [RECONCILER, targetSha], {
            env: {
                ...process.env,
                PATH: `${fakeBin}:${process.env.PATH}`,
                BRAINBASE_MCP_RUNTIME_ROOT: mcpRuntime,
                BRAINBASE_UI_RUNTIME_ROOT: uiRuntime,
                BRAINBASE_MCP_RECONCILE_LOCK: join(fixtureDir, 'reconcile.lock'),
                BRAINBASE_MCP_RECONCILE_RECEIPT: join(fixtureDir, 'reconcile.receipt'),
                BRAINBASE_MCP_RECONCILE_WAIT_ATTEMPTS: '1',
                CANDIDATE_TARGET_SHA: targetSha,
                CANDIDATE_PREFLIGHT_LOG: reconcileLog,
                CANDIDATE_PREFLIGHT_FAIL: '1'
            }
        });

        const actualMcpSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: mcpRuntime, encoding: 'utf8' }).trim();
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('preflighting candidate MCP runtime before mutation');
        expect(result.stderr).toContain('MCP candidate authentication preflight failed before runtime mutation');
        expect(readFileSync(reconcileLog, 'utf8').trim()).toBe(targetSha);
        expect(actualMcpSha).toBe(baseSha);
        expect(existsSync(join(fixtureDir, 'reconcile.receipt'))).toBe(false);
    });

    it('tracked dirtyなruntime checkoutはMCP起動前にexit 78で拒否する', async () => {
        const apiUrl = await healthyServer();
        writeFileSync(join(launcherRepo, 'README.md'), `${readFileSync(join(launcherRepo, 'README.md'), 'utf8')}dirty\n`);
        const result = await run('bash', [LAUNCHER], { env: environment({ BRAINBASE_GRAPH_API_URL: apiUrl }) });
        expect(result.code).toBe(78);
        expect(result.stderr).toContain('runtime checkout is dirty');
        expect(existsSync(marker)).toBe(false);
    });

    it('untracked dirtyなruntime checkoutはMCP起動前にexit 78で拒否する', async () => {
        const apiUrl = await healthyServer();
        writeFileSync(join(launcherRepo, 'untracked-fixture.txt'), 'dirty\n');
        const result = await run('bash', [LAUNCHER], { env: environment({ BRAINBASE_GRAPH_API_URL: apiUrl }) });
        expect(result.code).toBe(78);
        expect(result.stderr).toContain('runtime checkout is dirty');
        expect(existsSync(marker)).toBe(false);
    });

    it('全preflight成功後だけMCP entryを開始する', async () => {
        const apiUrl = await healthyServer();
        const result = await run('bash', [LAUNCHER], { env: environment({ BRAINBASE_GRAPH_API_URL: apiUrl }) });
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('BRAINBASE_JUDGMENT_BINDING_AVAILABLE: brainbase-mcp@1');
        expect(readFileSync(marker, 'utf8')).toBe('started\n');
    });
});
