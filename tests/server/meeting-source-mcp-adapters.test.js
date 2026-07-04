import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    ConfiguredMeetingSourceMcpAdapter,
    createMeetingSourceMcpAdaptersFromEnv,
    discoverMeetingSourceMcpAdapterConfigFromCli,
    parseMeetingSourceMcpAdapterConfig
} from '../../server/services/meeting-source/meeting-source-mcp-adapters.js';

describe('meeting source MCP adapter config', () => {
    it('builds only supported provider adapters from env JSON', () => {
        const adapters = createMeetingSourceMcpAdaptersFromEnv({
            env: {
                BRAINBASE_MEETING_SOURCE_MCP_ADAPTERS_JSON: JSON.stringify({
                    tactiq: {
                        transport: 'streamable_http',
                        url: 'http://127.0.0.1:8787/mcp',
                        tool: 'list_transcripts'
                    },
                    plaud: {
                        transport: 'stdio',
                        command: 'plaud-mcp',
                        args: ['--stdio'],
                        tool: 'list_recordings'
                    },
                    calendar: {
                        transport: 'stdio',
                        command: 'calendar-mcp'
                    }
                })
            }
        });

        expect(Object.keys(adapters).sort()).toEqual(['plaud', 'tactiq']);
        expect(adapters.tactiq).toBeInstanceOf(ConfiguredMeetingSourceMcpAdapter);
        expect(adapters.plaud).toBeInstanceOf(ConfiguredMeetingSourceMcpAdapter);
    });

    it('ignores malformed adapter config instead of exposing partial secrets', () => {
        expect(parseMeetingSourceMcpAdapterConfig('not-json')).toEqual({});
        expect(parseMeetingSourceMcpAdapterConfig(JSON.stringify({ gmail: { bearer_token: 'secret' } }))).toEqual({});
    });

    it('discovers Tactiq and Plaud MCP adapters from Codex CLI config', () => {
        const homeDir = mkdtempSync(join(tmpdir(), 'brainbase-mcp-codex-'));
        mkdirSync(join(homeDir, '.codex'));
        writeFileSync(join(homeDir, '.codex', 'config.toml'), `
[mcp_servers.plaud]
command = "/usr/local/bin/npx"
args = ["-y", "@plaud-ai/mcp@latest"]

[mcp_servers.tactiq]
url = "https://mcp.tactiq.io"
`);

        const configs = discoverMeetingSourceMcpAdapterConfigFromCli({ homeDir });
        expect(configs.plaud).toEqual({
            transport: 'stdio',
            command: '/usr/local/bin/npx',
            args: ['-y', '@plaud-ai/mcp@latest'],
            env: {}
        });
        expect(configs.tactiq).toEqual({
            transport: 'streamable_http',
            url: 'https://mcp.tactiq.io',
            headers: undefined
        });

        const adapters = createMeetingSourceMcpAdaptersFromEnv({ env: {}, homeDir });
        expect(Object.keys(adapters).sort()).toEqual(['plaud', 'tactiq']);
    });

    it('discovers MCP adapters from Claude user config when Codex config is absent', () => {
        const homeDir = mkdtempSync(join(tmpdir(), 'brainbase-mcp-claude-'));
        writeFileSync(join(homeDir, '.claude.json'), JSON.stringify({
            mcpServers: {
                tactiq: {
                    type: 'http',
                    url: 'https://mcp.tactiq.io'
                },
                plaud: {
                    command: '/usr/local/bin/npx',
                    args: ['-y', '@plaud-ai/mcp@latest']
                }
            }
        }));

        const configs = discoverMeetingSourceMcpAdapterConfigFromCli({ homeDir });
        expect(Object.keys(configs).sort()).toEqual(['plaud', 'tactiq']);
    });

    it('lets explicit env config override auto-discovered CLI config', () => {
        const homeDir = mkdtempSync(join(tmpdir(), 'brainbase-mcp-override-'));
        mkdirSync(join(homeDir, '.codex'));
        writeFileSync(join(homeDir, '.codex', 'config.toml'), `
[mcp_servers.tactiq]
url = "https://mcp.tactiq.io"
`);

        const adapters = createMeetingSourceMcpAdaptersFromEnv({
            homeDir,
            env: {
                BRAINBASE_MEETING_SOURCE_MCP_ADAPTERS_JSON: JSON.stringify({
                    tactiq: {
                        transport: 'streamable_http',
                        url: 'http://127.0.0.1:8787/mcp'
                    }
                })
            }
        });

        expect(adapters.tactiq.config.url).toBe('http://127.0.0.1:8787/mcp');
    });
});
