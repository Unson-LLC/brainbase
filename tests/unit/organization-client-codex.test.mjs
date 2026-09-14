import { describe, it, expect } from 'vitest';
import { buildCodexInvocation, resolveCodexExecutable } from '../../packages/organization-client/src/codex.mjs';

const config = { organization_id: 'org_fixture', api_url: 'https://api.fixture.example', mcp_url: 'https://mcp.fixture.example/mcp' };
describe('Codex organization invocation', () => {
  it('uses native Codex on Windows without needing Claude', () => {
    expect(resolveCodexExecutable({ platform: 'win32', env: { CODEX_EXECUTABLE: 'C:\\Apps\\codex.exe' } })).toBe('C:\\Apps\\codex.exe');
    expect(() => resolveCodexExecutable({ platform: 'win32', env: { CODEX_EXECUTABLE: 'C:\\Apps\\codex.cmd' } })).toThrow(/native Codex/);
  });
  it('uses a complete MCP table override and keeps bearer out of arguments', () => {
    const result = buildCodexInvocation(config, 'fixture-secret', [], { PATH: '/bin' });
    expect(result.args.join(' ')).not.toContain('fixture-secret');
    expect(result.args.join(' ')).toContain('mcp_servers=');
    expect(result.args.join(' ')).toContain('bearer_token_env_var');
    expect(result.env.ORGANIZATION_CLIENT_ACCESS_TOKEN).toBe('fixture-secret');
    expect(result.args.join(' ')).toContain('shell_environment_policy');
  });
  it('rejects configuration overrides and does not mutate the parent environment', () => {
    const env = { PATH: '/bin', ORGANIZATION_CLIENT_REFRESH_TOKEN: 'old' };
    expect(() => buildCodexInvocation(config, 'fixture', ['--config', 'x=y'], env)).toThrow();
    const result = buildCodexInvocation(config, 'fixture', [], env);
    expect(result.env.ORGANIZATION_CLIENT_REFRESH_TOKEN).toBeUndefined();
    expect(env.ORGANIZATION_CLIENT_REFRESH_TOKEN).toBe('old');
  });
});
