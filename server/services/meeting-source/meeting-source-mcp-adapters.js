import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { SUPPORTED_MEETING_SOURCE_PROVIDERS } from './meeting-source-mcp-sync-service.js';

function parseJsonMaybe(value) {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function extractArtifactList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.artifacts)) return payload.artifacts;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.records)) return payload.records;
    if (Array.isArray(payload.transcripts)) return payload.transcripts;
    if (Array.isArray(payload.recordings)) return payload.recordings;
    if (payload.structuredContent) return extractArtifactList(payload.structuredContent);
    if (Array.isArray(payload.content)) {
        const parsed = payload.content
            .filter((item) => item?.type === 'text' && typeof item.text === 'string')
            .flatMap((item) => {
                const json = parseJsonMaybe(item.text);
                return extractArtifactList(json || item.text);
            });
        if (parsed.length) return parsed;
    }
    return [];
}

function normalizeHeaders(headers = {}) {
    return Object.fromEntries(Object.entries(headers || {}).filter(([, value]) => value !== undefined && value !== null));
}

export function parseMeetingSourceMcpAdapterConfig(rawConfig) {
    const parsed = parseJsonMaybe(rawConfig);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
        .filter(([provider]) => SUPPORTED_MEETING_SOURCE_PROVIDERS.includes(provider))
        .filter(([, config]) => config && typeof config === 'object'));
}

export class ConfiguredMeetingSourceMcpAdapter {
    constructor({ provider, config = {}, log = console } = {}) {
        if (!SUPPORTED_MEETING_SOURCE_PROVIDERS.includes(provider)) {
            throw new Error(`unsupported meeting source provider adapter: ${provider}`);
        }
        this.provider = provider;
        this.config = config;
        this.log = log;
    }

    _createTransport() {
        const transport = String(this.config.transport || this.config.type || 'streamable_http').toLowerCase();
        if (transport === 'stdio') {
            if (!this.config.command) throw new Error(`${this.provider} MCP stdio command is required`);
            return new StdioClientTransport({
                command: this.config.command,
                args: Array.isArray(this.config.args) ? this.config.args : [],
                cwd: this.config.cwd,
                env: this.config.env || {},
                stderr: this.config.stderr || 'inherit'
            });
        }

        const url = new URL(this.config.url || this.config.endpoint || '');
        const requestInit = {
            headers: normalizeHeaders({
                ...(this.config.headers || {}),
                authorization: this.config.bearer_token ? `Bearer ${this.config.bearer_token}` : undefined
            })
        };
        if (transport === 'sse') {
            return new SSEClientTransport(url, { requestInit });
        }
        return new StreamableHTTPClientTransport(url, { requestInit });
    }

    async _withClient(fn) {
        const client = new Client({
            name: `brainbase-${this.provider}-meeting-source-sync`,
            version: '0.1.0'
        });
        const transport = this._createTransport();
        try {
            await client.connect(transport);
            return await fn(client);
        } finally {
            await Promise.resolve(client.close?.()).catch(() => {});
            await Promise.resolve(transport.close?.()).catch(() => {});
        }
    }

    _toolArgs({ cursor = {}, since = null, until = null } = {}) {
        return {
            ...(this.config.arguments || {}),
            since,
            until,
            updated_since: since,
            cursor
        };
    }

    async test() {
        return await this._withClient(async (client) => {
            const tools = await client.listTools().catch(() => ({ tools: [] }));
            const toolNames = (tools.tools || []).map((tool) => tool.name);
            return {
                ok: true,
                auth_status: 'connected',
                capabilities: toolNames,
                configured_tool: this.config.tool || this.config.poll_tool || null
            };
        });
    }

    async poll({ cursor = {}, since = null, until = null } = {}) {
        return await this._withClient(async (client) => {
            const toolName = this.config.tool || this.config.poll_tool || this.config.list_tool;
            if (toolName) {
                const result = await client.callTool({
                    name: toolName,
                    arguments: this._toolArgs({ cursor, since, until })
                });
                return extractArtifactList(result);
            }
            const resources = await client.listResources().catch(() => ({ resources: [] }));
            return (resources.resources || [])
                .filter((resource) => !this.config.resource_prefix || String(resource.uri || '').startsWith(this.config.resource_prefix))
                .map((resource) => ({
                    id: resource.uri,
                    title: resource.name || resource.title || resource.uri,
                    resource_uri: resource.uri,
                    updated_at: resource.updated_at || resource.modified_at || null,
                    provider: this.provider
                }));
        });
    }
}

export function createMeetingSourceMcpAdaptersFromEnv({ env = process.env, log = console } = {}) {
    const configs = parseMeetingSourceMcpAdapterConfig(env.BRAINBASE_MEETING_SOURCE_MCP_ADAPTERS_JSON);
    return Object.fromEntries(Object.entries(configs).map(([provider, config]) => [
        provider,
        new ConfiguredMeetingSourceMcpAdapter({ provider, config, log })
    ]));
}
