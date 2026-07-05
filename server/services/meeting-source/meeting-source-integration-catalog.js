const INTEGRATIONS_SH_BASE_URL = 'https://integrations.sh';

const MEETING_SOURCE_PROVIDER_CATALOG = Object.freeze({
    tactiq: Object.freeze({
        provider: 'tactiq',
        domain: 'tactiq.io',
        label: 'Tactiq',
        role: 'online_primary',
        source_role: 'online meetings',
        catalog_source: 'brainbase_override',
        catalog_status: 'override_required',
        surfaces: Object.freeze([
            Object.freeze({
                type: 'mcp',
                transport: 'brainbase_runtime',
                configured_by: 'brainbase_mcp_runtime',
                confidence: 'manual_override',
                purpose: 'online meeting transcripts and speaker timeline'
            })
        ]),
        auth: Object.freeze({
            managed_by: 'brainbase_runtime',
            credential_ref_required: true,
            local_secret_storage: false,
            user_action: 'provider login is completed outside Mac Companion and stored by Brainbase runtime'
        }),
        notes: Object.freeze([
            'integrations.sh may not detect a published MCP surface yet; Brainbase keeps Tactiq as an effective provider override.',
            'Calendar data is context only. Tactiq is the primary source for online meetings.'
        ])
    }),
    plaud: Object.freeze({
        provider: 'plaud',
        domain: 'plaud.ai',
        label: 'Plaud.ai',
        role: 'offline_or_call_primary',
        source_role: 'offline recordings, calls, and online meetings without Tactiq',
        catalog_source: 'brainbase_override',
        catalog_status: 'override_required',
        surfaces: Object.freeze([
            Object.freeze({
                type: 'mcp',
                transport: 'brainbase_runtime',
                configured_by: 'brainbase_mcp_runtime',
                confidence: 'manual_override',
                purpose: 'offline recordings, calls, and fallback meeting transcripts'
            })
        ]),
        auth: Object.freeze({
            managed_by: 'brainbase_runtime',
            credential_ref_required: true,
            local_secret_storage: false,
            user_action: 'provider login is completed outside Mac Companion and stored by Brainbase runtime'
        }),
        notes: Object.freeze([
            'integrations.sh may not detect a published MCP surface yet; Brainbase keeps Plaud.ai as an effective provider override.',
            'Calendar data is context only. Plaud.ai is the primary source for offline meetings and calls.'
        ])
    })
});

function nowIso() {
    return new Date().toISOString();
}

function normalizeProvider(provider) {
    return String(provider || '').trim().toLowerCase();
}

function providerEntry(provider) {
    const key = normalizeProvider(provider);
    const entry = MEETING_SOURCE_PROVIDER_CATALOG[key];
    if (!entry) {
        const error = new Error(`unsupported meeting source provider: ${provider}`);
        error.statusCode = 404;
        throw error;
    }
    return structuredClone(entry);
}

function integrationDetectURL(baseURL, domain) {
    return `${String(baseURL).replace(/\/$/, '')}/api/${encodeURIComponent(domain)}/detect`;
}

export class MeetingSourceIntegrationCatalogService {
    constructor({
        baseURL = INTEGRATIONS_SH_BASE_URL,
        fetchImpl = globalThis.fetch,
        clock = nowIso
    } = {}) {
        this.baseURL = baseURL;
        this.fetchImpl = fetchImpl;
        this.clock = clock;
    }

    async listCatalog({ includeLiveDetect = false } = {}) {
        const providers = Object.keys(MEETING_SOURCE_PROVIDER_CATALOG);
        const entries = [];
        for (const provider of providers) {
            entries.push(await this.getCatalogEntry(provider, { includeLiveDetect }));
        }
        return {
            version: 1,
            generated_at: this.clock(),
            upstream: {
                name: 'integrations.sh',
                base_url: this.baseURL,
                purpose: 'detect public integration surfaces; Brainbase override decides effective meeting-source providers'
            },
            providers: entries
        };
    }

    async getCatalogEntry(provider, { includeLiveDetect = false } = {}) {
        const entry = providerEntry(provider);
        return {
            ...entry,
            effective: true,
            upstream: {
                name: 'integrations.sh',
                domain: entry.domain,
                detect_url: integrationDetectURL(this.baseURL, entry.domain),
                detect_status: includeLiveDetect ? 'pending' : 'not_queried'
            },
            upstream_detect: includeLiveDetect ? await this.detectUpstream(entry.domain) : null
        };
    }

    async refreshProvider(provider) {
        return this.getCatalogEntry(provider, { includeLiveDetect: true });
    }

    async detectUpstream(domain) {
        if (typeof this.fetchImpl !== 'function') {
            return {
                ok: false,
                error: 'fetch_not_available'
            };
        }
        try {
            const response = await this.fetchImpl(integrationDetectURL(this.baseURL, domain), {
                headers: { accept: 'application/json' }
            });
            const body = await response.json();
            return {
                ok: response.ok,
                status: response.status,
                found: body?.found || [],
                mcp: body?.mcp || [],
                integrations_json: body?.integrationsJson || null,
                auth: body?.auth || []
            };
        } catch (error) {
            return {
                ok: false,
                error: error?.message || 'upstream_detect_failed'
            };
        }
    }
}

export function createMeetingSourceIntegrationCatalogService(options = {}) {
    return new MeetingSourceIntegrationCatalogService(options);
}
