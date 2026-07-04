import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveRuntimePaths } from '../../../lib/runtime-paths.js';

function nowIso() {
    return new Date().toISOString();
}

function readJsonFile(filePath) {
    try {
        if (!existsSync(filePath)) return { version: 1, providers: {} };
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return { version: 1, providers: {} };
        return {
            version: parsed.version || 1,
            providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {}
        };
    } catch {
        return { version: 1, providers: {} };
    }
}

function writeJsonFile(filePath, value) {
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(tempPath, filePath);
}

export function defaultMeetingSourceMcpOAuthStorePath({
    env = process.env,
    repoDir = process.cwd()
} = {}) {
    const runtimePaths = resolveRuntimePaths({ repoDir, env });
    return join(runtimePaths.varDir, 'meeting-source-mcp-oauth.json');
}

export class FileMeetingSourceMcpOAuthProvider {
    constructor({
        provider,
        redirectUrl,
        storePath = defaultMeetingSourceMcpOAuthStorePath(),
        clientMetadataUrl,
        onRedirect = null
    } = {}) {
        if (!provider) throw new Error('meeting source MCP OAuth provider is required');
        if (!redirectUrl) throw new Error('meeting source MCP OAuth redirectUrl is required');
        this.provider = provider;
        this._redirectUrl = redirectUrl;
        this.storePath = storePath;
        this.clientMetadataUrl = clientMetadataUrl;
        this.onRedirect = onRedirect;
    }

    get redirectUrl() {
        return this._redirectUrl;
    }

    get clientMetadata() {
        return {
            client_name: 'Brainbase Meeting Source Sync',
            redirect_uris: [String(this._redirectUrl)],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_post'
        };
    }

    _readProviderState() {
        const data = readJsonFile(this.storePath);
        return data.providers[this.provider] || {};
    }

    _updateProviderState(patch) {
        const data = readJsonFile(this.storePath);
        data.providers[this.provider] = {
            ...(data.providers[this.provider] || {}),
            ...patch,
            updated_at: nowIso()
        };
        writeJsonFile(this.storePath, data);
    }

    clientInformation() {
        return this._readProviderState().client_information;
    }

    saveClientInformation(clientInformation) {
        this._updateProviderState({ client_information: clientInformation });
    }

    tokens() {
        return this._readProviderState().tokens;
    }

    saveTokens(tokens) {
        this._updateProviderState({ tokens });
    }

    redirectToAuthorization(authorizationUrl) {
        if (this.onRedirect) {
            return this.onRedirect(authorizationUrl);
        }
        throw new Error(`${this.provider} MCP OAuth authorization is required: ${authorizationUrl.toString()}`);
    }

    saveCodeVerifier(codeVerifier) {
        this._updateProviderState({ code_verifier: codeVerifier });
    }

    codeVerifier() {
        const codeVerifier = this._readProviderState().code_verifier;
        if (!codeVerifier) throw new Error(`${this.provider} MCP OAuth code verifier is missing`);
        return codeVerifier;
    }

    invalidateCredentials(scope = 'all') {
        const data = readJsonFile(this.storePath);
        const current = data.providers[this.provider] || {};
        const next = { ...current, updated_at: nowIso() };

        if (scope === 'all' || scope === 'client') delete next.client_information;
        if (scope === 'all' || scope === 'tokens') delete next.tokens;
        if (scope === 'all' || scope === 'verifier') delete next.code_verifier;

        data.providers[this.provider] = next;
        writeJsonFile(this.storePath, data);
    }
}
