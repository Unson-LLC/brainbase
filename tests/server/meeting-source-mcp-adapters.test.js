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

    it('polls Tactiq recent meetings and expands ready summaries', async () => {
        const calls = [];
        const adapter = new ConfiguredMeetingSourceMcpAdapter({
            provider: 'tactiq',
            config: {}
        });
        adapter._withClient = async (fn) => fn({
            callTool: async (request) => {
                calls.push(request);
                if (request.name === 'list_recent_meetings') {
                    return {
                        structuredContent: {
                            results: [
                                {
                                    id: 'tactiq-real-1',
                                    title: 'Recent meeting',
                                    createdAt: '2026-07-09T05:48:39.000Z',
                                    attendees: ['a@example.com'],
                                    url: 'https://app.tactiq.io/meeting/tactiq-real-1'
                                }
                            ]
                        }
                    };
                }
                return {
                    structuredContent: {
                        id: 'tactiq-real-1',
                        title: 'Recent meeting detail',
                        detailedSummary: {
                            status: 'ready',
                            content: { markdown: 'ready summary' }
                        }
                    }
                };
            }
        });

        const artifacts = await adapter.poll({ since: '2026-07-09T00:00:00.000Z' });

        expect(calls.map((call) => call.name)).toEqual(['list_recent_meetings', 'get_meeting']);
        expect(artifacts).toEqual([
            expect.objectContaining({
                external_id: 'tactiq-real-1',
                title: 'Recent meeting detail',
                started_at: '2026-07-09T05:48:39.000Z',
                note_text: 'ready summary',
                meeting_mode: 'online',
                resource_uri: 'https://app.tactiq.io/meeting/tactiq-real-1'
            })
        ]);
    });

    it('polls Plaud files and expands transcript and note text', async () => {
        const calls = [];
        const adapter = new ConfiguredMeetingSourceMcpAdapter({
            provider: 'plaud',
            config: {}
        });
        adapter._withClient = async (fn) => fn({
            callTool: async (request) => {
                calls.push(request);
                if (request.name === 'list_files') {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    data: [
                                        {
                                            id: 'plaud-file-1',
                                            name: 'Offline recording',
                                            start_at: '2026-07-09T09:07:52'
                                        }
                                    ]
                                })
                            }
                        ]
                    };
                }
                if (request.name === 'get_transcript') {
                    return { structuredContent: { text: 'full transcript' } };
                }
                return { structuredContent: { data: { markdown: 'generated note' } } };
            }
        });

        const artifacts = await adapter.poll({ since: '2026-07-09T00:00:00.000Z' });

        expect(calls.map((call) => call.name)).toEqual(['list_files', 'get_transcript', 'get_note']);
        expect(artifacts).toEqual([
            expect.objectContaining({
                external_id: 'plaud-file-1',
                title: 'Offline recording',
                started_at: '2026-07-09T09:07:52',
                transcript_text: 'full transcript',
                note_text: 'generated note',
                meeting_mode: 'offline',
                resource_uri: 'plaud:plaud-file-1'
            })
        ]);
    });
});
