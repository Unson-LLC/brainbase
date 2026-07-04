#!/usr/bin/env node

import { createServer } from 'node:http';
import { URL } from 'node:url';

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import open from 'open';

import {
    discoverMeetingSourceMcpAdapterConfigFromCli,
    parseMeetingSourceMcpAdapterConfig
} from '../server/services/meeting-source/meeting-source-mcp-adapters.js';
import {
    defaultMeetingSourceMcpOAuthStorePath,
    FileMeetingSourceMcpOAuthProvider
} from '../server/services/meeting-source/meeting-source-mcp-oauth-provider.js';

const providerName = process.argv[2] || 'tactiq';
const port = Number(process.env.BRAINBASE_MEETING_SOURCE_MCP_OAUTH_PORT || 31087);
const redirectUrl = `http://127.0.0.1:${port}/oauth/callback`;
const storePath = process.env.BRAINBASE_MEETING_SOURCE_MCP_OAUTH_STORE
    || defaultMeetingSourceMcpOAuthStorePath();

function getProviderConfig() {
    const explicit = parseMeetingSourceMcpAdapterConfig(process.env.BRAINBASE_MEETING_SOURCE_MCP_ADAPTERS_JSON);
    const discovered = discoverMeetingSourceMcpAdapterConfigFromCli();
    return explicit[providerName] || discovered[providerName];
}

function createCallbackServer() {
    let settled = false;
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });

    const server = createServer((req, res) => {
        try {
            const url = new URL(req.url || '/', redirectUrl);
            if (url.pathname !== '/oauth/callback') {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
                res.end('not found');
                return;
            }

            const error = url.searchParams.get('error');
            const code = url.searchParams.get('code');
            res.writeHead(error ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(error
                ? `<p>Brainbase ${providerName} MCP OAuth failed: ${error}</p>`
                : `<p>Brainbase ${providerName} MCP OAuth completed. You can close this tab.</p>`);

            if (settled) return;
            settled = true;
            if (error) rejectCode(new Error(error));
            else if (!code) rejectCode(new Error('OAuth callback did not include code'));
            else resolveCode(code);
        } catch (error) {
            if (!settled) {
                settled = true;
                rejectCode(error);
            }
        }
    });

    return {
        server,
        codePromise,
        listen: () => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => resolve());
        }),
        close: () => new Promise((resolve) => {
            server.closeAllConnections?.();
            server.closeIdleConnections?.();
            const timeout = setTimeout(resolve, 1000);
            timeout.unref?.();
            server.close(() => {
                clearTimeout(timeout);
                resolve();
            });
        })
    };
}

function buildTransport(config, oauthProvider) {
    return new StreamableHTTPClientTransport(new URL(config.url || config.endpoint), {
        authProvider: oauthProvider,
        requestInit: {
            headers: {
                ...(config.headers || {}),
                ...(config.bearer_token ? { authorization: `Bearer ${config.bearer_token}` } : {})
            }
        }
    });
}

async function connectAndListTools(config, oauthProvider) {
    const client = new Client({
        name: `brainbase-${providerName}-meeting-source-oauth-login`,
        version: '0.1.0'
    });
    const transport = buildTransport(config, oauthProvider);
    await client.connect(transport);
    try {
        const tools = await client.listTools().catch(() => ({ tools: [] }));
        return (tools.tools || []).map((tool) => tool.name);
    } finally {
        await Promise.resolve(client.close?.()).catch(() => {});
        await Promise.resolve(transport.close?.()).catch(() => {});
    }
}

async function main() {
    const config = getProviderConfig();
    if (!config) {
        throw new Error(`${providerName} MCP config was not found in Brainbase env, Codex config, or Claude config`);
    }
    const transport = String(config.transport || config.type || 'streamable_http').toLowerCase();
    if (transport === 'stdio') {
        throw new Error(`${providerName} MCP is stdio; OAuth login is only required for HTTP MCP providers`);
    }
    if (!config.url && !config.endpoint) {
        throw new Error(`${providerName} MCP HTTP URL is missing`);
    }

    const callbackServer = createCallbackServer();
    await callbackServer.listen();

    const oauthProvider = new FileMeetingSourceMcpOAuthProvider({
        provider: providerName,
        redirectUrl,
        storePath,
        onRedirect: async (authorizationUrl) => {
            console.log(`[meeting-source:mcp-login] Opening ${providerName} OAuth login in the browser.`);
            console.log(`[meeting-source:mcp-login] ${authorizationUrl.toString()}`);
            await open(authorizationUrl.toString(), { wait: false });
        }
    });

    try {
        try {
            const toolNames = await connectAndListTools(config, oauthProvider);
            console.log(`[meeting-source:mcp-login] ${providerName} already connected. tools=${toolNames.join(',')}`);
            return;
        } catch (error) {
            if (!(error instanceof UnauthorizedError)) throw error;
        }

        console.log(`[meeting-source:mcp-login] Waiting for ${providerName} OAuth callback on ${redirectUrl}`);
        const authTransport = buildTransport(config, oauthProvider);
        const code = await callbackServer.codePromise;
        await authTransport.finishAuth(code);
        await Promise.resolve(authTransport.close?.()).catch(() => {});

        const toolNames = await connectAndListTools(config, oauthProvider);
        console.log(`[meeting-source:mcp-login] ${providerName} connected. store=${storePath}`);
        console.log(`[meeting-source:mcp-login] tools=${toolNames.join(',')}`);
    } finally {
        await callbackServer.close().catch(() => {});
    }
}

main().catch((error) => {
    console.error(`[meeting-source:mcp-login] ${error?.message || error}`);
    process.exit(1);
});
