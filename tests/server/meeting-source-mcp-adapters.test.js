import { describe, expect, it } from 'vitest';

import {
    ConfiguredMeetingSourceMcpAdapter,
    createMeetingSourceMcpAdaptersFromEnv,
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
});
