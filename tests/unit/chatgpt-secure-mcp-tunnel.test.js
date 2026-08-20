import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

describe('ChatGPT Secure MCP Tunnel contract', () => {
  it('uses the OpenAI stdio profile instead of publishing loopback HTTP', () => {
    const runner = read('scripts/run-chatgpt-brainbase-tunnel.sh');
    const stdio = read('scripts/run-brainbase-mcp-stdio.sh');

    expect(runner).toContain('--sample sample_mcp_stdio_local');
    expect(runner).toContain('--mcp-command "$MCP_COMMAND"');
    expect(runner).not.toContain('--mcp-server-url');
    expect(stdio).toContain('unset MCP_HTTP_PORT MCP_HTTP_HOST MCP_HTTP_BEARER_TOKEN');
    expect(stdio).toContain('unset CONTROL_PLANE_API_KEY OPENAI_MCP_TUNNEL_ID');
    expect(stdio).toContain('exec "$SCRIPT_DIR/run-brainbase-mcp.sh" "$@"');
  });

  it('loads tunnel identity from a dedicated Infisical target', () => {
    const targets = JSON.parse(read('config/infisical-targets.json'));
    const target = targets.targets['openai-brainbase-tunnel'];
    const runner = read('scripts/run-chatgpt-brainbase-tunnel.sh');

    expect(target.path).toBe('/mcp/openai-brainbase-tunnel');
    expect(target.requiredKeys).toEqual([
      'CONTROL_PLANE_API_KEY',
      'OPENAI_MCP_TUNNEL_ID',
    ]);
    expect(runner).toContain('unset INFISICAL_TOKEN');
    expect(runner).toContain('openai-brainbase-tunnel');
  });

  it('keeps secrets out of launchd and installs a managed runtime job', () => {
    const plist = read('config/com.brainbase.chatgpt-mcp-tunnel.plist');
    const install = read('scripts/install-chatgpt-brainbase-tunnel-launchd.sh');

    expect(plist).toContain('com.brainbase.chatgpt-mcp-tunnel');
    expect(plist).toContain('__RUNTIME_ROOT__/scripts/run-chatgpt-brainbase-tunnel.sh');
    expect(plist).toContain('<string>run</string>');
    expect(plist).not.toContain('CONTROL_PLANE_API_KEY');
    expect(plist).not.toContain('OPENAI_MCP_TUNNEL_ID');
    expect(plist).not.toContain('MCP_HTTP_PORT');
    expect(install).toContain('/bin/bash "$RUNNER" doctor');
    expect(install).toContain('launchctl bootstrap "$DOMAIN" "$PLIST"');
    expect(install).toContain('state = running');
  });

  it('restarts an installed tunnel without blocking core deployment', () => {
    const reconcile = read('scripts/reconcile-brainbase-mcp-runtime.sh');

    expect(reconcile).toContain('com.brainbase.chatgpt-mcp-tunnel');
    expect(reconcile).toContain('CHATGPT_TUNNEL_STATUS');
    expect(reconcile).toContain('chatgpt_tunnel=%s');
    expect(reconcile).toContain('WARNING: ChatGPT Secure MCP Tunnel');
  });

  it('records that port 39002 remains loopback-only', () => {
    const decision = read('docs/decisions/2026-08-19_chatgpt-brainbase-mcp-transport.md');

    expect(decision).toContain('HTTP port `39002`は引き続き`127.0.0.1`にのみbindする');
    expect(decision).toContain('Cloudflare Tunnelや独自public reverse proxyをChatGPT MCPの正規経路にしない');
  });
});
