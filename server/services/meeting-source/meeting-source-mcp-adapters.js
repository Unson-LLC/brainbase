import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { FileMeetingSourceMcpOAuthProvider } from './meeting-source-mcp-oauth-provider.js';
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
    if (Array.isArray(payload.results)) return payload.results;
    if (Array.isArray(payload.files)) return payload.files;
    if (Array.isArray(payload.data)) return payload.data;
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

function extractToolPayload(payload) {
    if (!payload) return null;
    if (payload.structuredContent) return payload.structuredContent;
    if (Array.isArray(payload.content)) {
        for (const item of payload.content) {
            if (item?.type !== 'text' || typeof item.text !== 'string') continue;
            const parsed = parseJsonMaybe(item.text);
            if (parsed) return parsed;
        }
        return payload.content
            .filter((item) => item?.type === 'text' && typeof item.text === 'string')
            .map((item) => item.text)
            .join('\n');
    }
    return payload;
}

function extractToolText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(extractToolText).filter(Boolean).join('\n');
    if (typeof value !== 'object') return '';
    return value.text
        || value.transcript
        || value.transcript_text
        || value.data_content
        || value.content
        || value.markdown
        || value.summary
        || extractToolText(value.detailedSummary?.content)
        || extractToolText(value.detailedSummary)
        || extractToolText(value.data)
        || '';
}

function inWindow(value, { since = null, until = null } = {}) {
    if (!value) return true;
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return true;
    if (since && timestamp < new Date(since).getTime()) return false;
    if (until && timestamp > new Date(until).getTime()) return false;
    return true;
}

function normalizeHeaders(headers = {}) {
    return Object.fromEntries(Object.entries(headers || {}).filter(([, value]) => value !== undefined && value !== null));
}

function readTextFileIfExists(filePath) {
    try {
        if (!existsSync(filePath)) return null;
        return readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function parseTomlScalar(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return trimmed
                .slice(1, -1)
                .split(',')
                .map((item) => parseTomlScalar(item))
                .filter(Boolean);
        }
    }
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return trimmed;
}

function parseCodexMcpServersToml(text) {
    const servers = {};
    let currentServer = null;
    let currentSection = null;

    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.replace(/\s+#.*$/, '').trim();
        if (!line) continue;

        const sectionMatch = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?\]$/);
        if (sectionMatch) {
            currentServer = sectionMatch[1];
            currentSection = sectionMatch[2] || null;
            servers[currentServer] = servers[currentServer] || {};
            if (currentSection) servers[currentServer][currentSection] = servers[currentServer][currentSection] || {};
            continue;
        }

        if (!currentServer) continue;
        const keyValueMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
        if (!keyValueMatch) continue;

        const [, key, value] = keyValueMatch;
        const target = currentSection ? servers[currentServer][currentSection] : servers[currentServer];
        target[key] = parseTomlScalar(value);
    }

    return servers;
}

function collectClaudeMcpServers(value, collected = {}) {
    if (!value || typeof value !== 'object') return collected;

    for (const [key, child] of Object.entries(value)) {
        if ((key === 'mcpServers' || key === 'mcp_servers') && child && typeof child === 'object' && !Array.isArray(child)) {
            Object.assign(collected, child);
            continue;
        }
        collectClaudeMcpServers(child, collected);
    }

    return collected;
}

function normalizeCliMcpServerConfig(provider, config) {
    if (!config || typeof config !== 'object') return null;
    const rawTransport = String(config.transport || config.type || '').toLowerCase();

    if (config.url || config.endpoint) {
        return {
            transport: rawTransport === 'sse' ? 'sse' : 'streamable_http',
            url: config.url || config.endpoint,
            headers: config.headers
        };
    }

    if (config.command) {
        return {
            transport: 'stdio',
            command: config.command,
            args: Array.isArray(config.args) ? config.args : [],
            env: config.env || {}
        };
    }

    return null;
}

function readClaudeMcpServers(homeDir) {
    const text = readTextFileIfExists(join(homeDir, '.claude.json'));
    if (!text) return {};
    try {
        return collectClaudeMcpServers(JSON.parse(text));
    } catch {
        return {};
    }
}

function readCodexMcpServers(homeDir) {
    const text = readTextFileIfExists(join(homeDir, '.codex', 'config.toml'));
    return text ? parseCodexMcpServersToml(text) : {};
}

export function discoverMeetingSourceMcpAdapterConfigFromCli({ homeDir = homedir() } = {}) {
    const codexServers = readCodexMcpServers(homeDir);
    const claudeServers = readClaudeMcpServers(homeDir);
    const discovered = {};

    for (const provider of SUPPORTED_MEETING_SOURCE_PROVIDERS) {
        const config = normalizeCliMcpServerConfig(provider, codexServers[provider])
            || normalizeCliMcpServerConfig(provider, claudeServers[provider]);
        if (config) discovered[provider] = config;
    }

    return discovered;
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
        const hasExplicitAuthorization = Boolean(
            requestInit.headers.authorization
            || requestInit.headers.Authorization
            || this.config.authProvider
        );
        const authProvider = hasExplicitAuthorization || this.config.oauth === false
            ? this.config.authProvider
            : new FileMeetingSourceMcpOAuthProvider({
                provider: this.provider,
                storePath: this.config.oauth_store_path,
                redirectUrl: this.config.oauth_redirect_url || 'http://127.0.0.1:31087/oauth/callback',
                clientMetadataUrl: this.config.oauth_client_metadata_url,
                onRedirect: this.config.onOAuthRedirect
            });
        if (transport === 'sse') {
            return new SSEClientTransport(url, { requestInit, authProvider });
        }
        return new StreamableHTTPClientTransport(url, { requestInit, authProvider });
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

    async _pollTactiq(client, { since = null, until = null } = {}) {
        const limit = Number(this.config.limit || this.config.page_size || 50);
        const listResult = await client.callTool({
            name: this.config.tool || this.config.poll_tool || 'list_recent_meetings',
            arguments: {
                limit: Math.min(Math.max(limit, 1), 50),
                ...(this.config.arguments || {})
            }
        });
        const meetings = extractArtifactList(listResult)
            .filter((meeting) => inWindow(meeting.createdAt || meeting.created_at || meeting.started_at, { since, until }));

        const artifacts = [];
        for (const meeting of meetings) {
            let detail = null;
            if (meeting.id) {
                try {
                    detail = extractToolPayload(await client.callTool({
                        name: this.config.detail_tool || 'get_meeting',
                        arguments: { id: meeting.id }
                    }));
                } catch (error) {
                    this.log?.warn?.(`[meeting-source] tactiq detail fetch failed for ${meeting.id}: ${error.message}`);
                }
            }
            const detailedSummary = detail?.detailedSummary;
            const noteText = detailedSummary?.status === 'ready'
                ? extractToolText(detailedSummary.content)
                : extractToolText(detailedSummary);
            artifacts.push({
                ...meeting,
                ...(detail && typeof detail === 'object' ? detail : {}),
                external_id: meeting.id,
                title: detail?.title || meeting.title,
                started_at: meeting.createdAt || detail?.createdAt || meeting.created_at || detail?.created_at || null,
                updated_at: meeting.createdAt || detail?.createdAt || meeting.updated_at || detail?.updated_at || null,
                participants: meeting.attendees || detail?.attendees || meeting.participants || [],
                note_text: noteText,
                meeting_mode: 'online',
                resource_uri: meeting.url || detail?.url || meeting.resource_uri || null
            });
        }
        return artifacts;
    }

    async _pollPlaud(client, { since = null, until = null } = {}) {
        const args = {
            page: 1,
            page_size: Number(this.config.page_size || 20),
            ...(since ? { date_from: String(since).slice(0, 10) } : {}),
            ...(until ? { date_to: String(until).slice(0, 10) } : {}),
            ...(this.config.arguments || {})
        };
        const listResult = await client.callTool({
            name: this.config.tool || this.config.poll_tool || 'list_files',
            arguments: args
        });
        const files = extractArtifactList(listResult)
            .filter((file) => inWindow(file.start_at || file.created_at || file.started_at, { since, until }));

        const artifacts = [];
        for (const file of files) {
            const fileId = file.id || file.file_id || file.fileId;
            let transcriptText = '';
            let noteText = '';
            if (fileId) {
                try {
                    transcriptText = extractToolText(extractToolPayload(await client.callTool({
                        name: this.config.transcript_tool || 'get_transcript',
                        arguments: { file_id: fileId }
                    })));
                } catch (error) {
                    this.log?.warn?.(`[meeting-source] plaud transcript fetch failed for ${fileId}: ${error.message}`);
                }
                try {
                    noteText = extractToolText(extractToolPayload(await client.callTool({
                        name: this.config.note_tool || 'get_note',
                        arguments: { file_id: fileId }
                    })));
                } catch (error) {
                    this.log?.warn?.(`[meeting-source] plaud note fetch failed for ${fileId}: ${error.message}`);
                }
            }
            artifacts.push({
                ...file,
                external_id: fileId,
                title: file.name || file.title,
                started_at: file.start_at || file.created_at || null,
                updated_at: file.created_at || file.start_at || null,
                transcript_text: transcriptText,
                note_text: noteText,
                meeting_mode: 'offline',
                resource_uri: fileId ? `plaud:${fileId}` : null
            });
        }
        return artifacts;
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
            if (this.provider === 'tactiq' && (this.config.provider_poll || !this.config.tool)) {
                return await this._pollTactiq(client, { since, until });
            }
            if (this.provider === 'plaud' && (this.config.provider_poll || !this.config.tool)) {
                return await this._pollPlaud(client, { since, until });
            }
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

export function createMeetingSourceMcpAdaptersFromEnv({ env = process.env, log = console, homeDir = homedir() } = {}) {
    const discoveredConfigs = discoverMeetingSourceMcpAdapterConfigFromCli({ homeDir });
    const explicitConfigs = parseMeetingSourceMcpAdapterConfig(env.BRAINBASE_MEETING_SOURCE_MCP_ADAPTERS_JSON);
    const configs = {
        ...discoveredConfigs,
        ...explicitConfigs
    };
    return Object.fromEntries(Object.entries(configs).map(([provider, config]) => [
        provider,
        new ConfiguredMeetingSourceMcpAdapter({ provider, config, log })
    ]));
}
