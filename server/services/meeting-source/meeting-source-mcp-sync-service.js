import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { meetingPackIds } from '../workflow/meeting-workflow-pack.js';

export const SUPPORTED_MEETING_SOURCE_PROVIDERS = Object.freeze(['tactiq', 'plaud']);

const DEFAULT_PROVIDER_CAPABILITIES = Object.freeze({
    tactiq: ['online_transcript', 'speaker_timeline', 'mcp_resource'],
    plaud: ['offline_recording', 'call_recording', 'online_fallback', 'mcp_resource']
});

const DEFAULT_PROVIDER_ROLES = Object.freeze({
    tactiq: 'online_primary',
    plaud: 'offline_or_call_primary'
});

function nowIso() {
    return new Date().toISOString();
}

function parseDurationMs(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function subtractMs(isoValue, deltaMs) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return nowIso();
    return new Date(date.getTime() - deltaMs).toISOString();
}

function stableHash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeProvider(provider) {
    const normalized = String(provider || '').toLowerCase();
    if (!SUPPORTED_MEETING_SOURCE_PROVIDERS.includes(normalized)) {
        const error = new Error(`unsupported meeting source provider: ${provider}`);
        error.statusCode = 404;
        throw error;
    }
    return normalized;
}

function readText(raw = {}) {
    return raw.text
        || raw.transcript
        || raw.transcript_text
        || raw.note_text
        || raw.content
        || raw.markdown
        || '';
}

function readResourceUri(raw = {}, provider) {
    return raw.mcp_resource_uri
        || raw.resource_uri
        || raw.url
        || raw.permalink
        || raw.file_url
        || `${provider}:${raw.id || raw.external_id || stableHash(JSON.stringify(raw)).slice(0, 16)}`;
}

function minuteBucket(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
    date.setSeconds(0, 0);
    return date.toISOString().slice(0, 16);
}

function participantKey(participants = []) {
    if (!Array.isArray(participants)) return '';
    return participants
        .map((participant) => normalizeWhitespace(
            typeof participant === 'string'
                ? participant
                : participant?.name || participant?.email || participant?.id || ''
        ).toLowerCase())
        .filter(Boolean)
        .sort()
        .join('|');
}

function inferMeetingMode(raw = {}) {
    const explicit = String(raw.meeting_mode || raw.mode || raw.kind || '').toLowerCase();
    if (['online', 'offline', 'call'].includes(explicit)) return explicit;
    if (raw.calendar_event_id || raw.conference_url || raw.meet_url || raw.zoom_url) return 'online';
    if (raw.phone_number || raw.call_id || raw.is_call) return 'call';
    if (raw.location && !raw.conference_url) return 'offline';
    return 'unknown';
}

function completenessScore(artifact) {
    let score = 0;
    if (artifact.has_text) score += 4;
    if (artifact.started_at) score += 2;
    if (artifact.ended_at) score += 1;
    if (artifact.participants?.length) score += 1;
    if (artifact.title) score += 1;
    if (artifact.mcp_resource_uri) score += 1;
    return score;
}

function sourcePriority(artifact) {
    if (artifact.meeting_mode === 'online' && artifact.provider === 'tactiq') return 100;
    if (['offline', 'call'].includes(artifact.meeting_mode) && artifact.provider === 'plaud') return 100;
    if (artifact.provider === 'tactiq') return 70;
    if (artifact.provider === 'plaud') return 60;
    return 10;
}

function sourceKindForArtifact(artifact) {
    if (artifact.provider === 'plaud') return 'recording_transcript';
    return 'transcript';
}

function sortPrimaryCandidate(a, b) {
    const priorityDelta = sourcePriority(b) - sourcePriority(a);
    if (priorityDelta) return priorityDelta;
    const completenessDelta = completenessScore(b) - completenessScore(a);
    if (completenessDelta) return completenessDelta;
    return String(b.updated_at || b.started_at || '').localeCompare(String(a.updated_at || a.started_at || ''));
}

export function normalizeSourceArtifact(raw = {}, providerInput = raw.provider) {
    const provider = safeProvider(providerInput);
    const text = readText(raw);
    const normalizedText = normalizeWhitespace(text);
    const textHash = normalizedText ? stableHash(normalizedText) : null;
    const title = normalizeWhitespace(raw.title || raw.meeting_title || raw.name || 'Untitled meeting source');
    const startedAt = raw.started_at || raw.start_time || raw.created_at || raw.recorded_at || null;
    const endedAt = raw.ended_at || raw.end_time || null;
    const participants = Array.isArray(raw.participants) ? raw.participants : [];
    const meetingMode = inferMeetingMode(raw);
    const mcpResourceUri = readResourceUri(raw, provider);
    const externalId = raw.external_id || raw.id || stableHash(`${provider}:${mcpResourceUri}`).slice(0, 24);

    return {
        provider,
        external_id: String(externalId),
        title,
        meeting_mode: meetingMode,
        started_at: startedAt,
        ended_at: endedAt,
        updated_at: raw.updated_at || raw.modified_at || raw.created_at || startedAt || nowIso(),
        participants,
        mcp_resource_uri: mcpResourceUri,
        transcript_hash: textHash,
        has_text: Boolean(normalizedText),
        text_preview: normalizedText.slice(0, 280),
        raw_metadata: {
            calendar_event_id: raw.calendar_event_id || null,
            source_url: raw.url || raw.permalink || null,
            slack_permalink: raw.slack_permalink || raw.slack_permalink_url || null,
            provider_role: DEFAULT_PROVIDER_ROLES[provider]
        },
        dedupe_key: textHash
            ? `hash:${textHash}`
            : `shape:${stableHash(`${title.toLowerCase()}|${minuteBucket(startedAt)}|${participantKey(participants)}`)}`
    };
}

export function dedupeSourceArtifacts(artifacts = []) {
    const groups = new Map();
    for (const artifact of artifacts) {
        const key = artifact.dedupe_key || `${artifact.provider}:${artifact.external_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(artifact);
    }

    return [...groups.entries()].map(([dedupeKey, members]) => {
        const sorted = [...members].sort(sortPrimaryCandidate);
        const primary = sorted[0];
        const supporting = sorted.slice(1);
        const sourceClusterId = `msrc_${stableHash(`${dedupeKey}:${primary.provider}:${primary.external_id}`).slice(0, 24)}`;
        return {
            source_cluster_id: sourceClusterId,
            dedupe_key: dedupeKey,
            primary_source: primary,
            supporting_sources: supporting,
            providers: sorted.map((member) => member.provider),
            title: primary.title,
            started_at: primary.started_at,
            meeting_mode: primary.meeting_mode
        };
    });
}

export function buildSourceEventFromArtifact(artifact, { sourceClusterId = null, supportingSources = [], ingestedBy = 'meeting_source_mcp_sync_worker' } = {}) {
    const providerSourceId = artifact.external_id;
    const contentSha256 = artifact.transcript_hash;
    return {
        source_system: artifact.provider,
        source_kind: sourceKindForArtifact(artifact),
        source_provider: artifact.provider,
        provider: artifact.provider,
        provider_role: DEFAULT_PROVIDER_ROLES[artifact.provider],
        source_cluster_id: sourceClusterId,
        source_id: providerSourceId,
        provider_source_id: providerSourceId,
        external_id: artifact.external_id,
        mcp_resource_uri: artifact.mcp_resource_uri,
        artifact_ref: artifact.mcp_resource_uri,
        transcript_hash: artifact.transcript_hash,
        transcript_sha256: artifact.transcript_hash,
        content_hash: artifact.transcript_hash,
        content_sha256: contentSha256,
        calendar_event_id: artifact.raw_metadata?.calendar_event_id || null,
        slack_permalink: artifact.raw_metadata?.slack_permalink || null,
        source_url: artifact.raw_metadata?.source_url || null,
        has_text: artifact.has_text,
        meeting_mode: artifact.meeting_mode,
        title: artifact.title,
        started_at: artifact.started_at,
        ended_at: artifact.ended_at,
        updated_at: artifact.updated_at,
        participants: artifact.participants,
        supporting_source_count: supportingSources.length,
        ingested_by: ingestedBy,
        ingested_at: nowIso(),
        raw_metadata: artifact.raw_metadata
    };
}

function defaultState() {
    const providers = Object.fromEntries(SUPPORTED_MEETING_SOURCE_PROVIDERS.map((provider) => [provider, {
        provider,
        enabled: false,
        auth_status: 'not_configured',
        account_label: null,
        capabilities: DEFAULT_PROVIDER_CAPABILITIES[provider],
        has_credential_ref: false,
        credential_ref: null,
        cursor: {
            updated_since: null,
            last_seen_external_id: null
        },
        last_success_at: null,
        last_error: null,
        updated_at: null
    }]));
    return {
        version: 1,
        providers,
        sync_config: {
            enabled: false,
            interval_ms: 15 * 60 * 1000,
            lookback_ms: 24 * 60 * 60 * 1000,
            providers: [...SUPPORTED_MEETING_SOURCE_PROVIDERS],
            org_id: null,
            project_id: null,
            case_scope: null,
            immediate: false
        },
        last_scheduled_run: null,
        previews: {}
    };
}

function readString(input, ...keys) {
    for (const key of keys) {
        const value = input?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function resolveScope(options = {}, actor = {}) {
    const safeActor = actor || {};
    const projectId = readString(options, 'project_id', 'projectId')
        || readString(safeActor, 'project_id', 'projectId', 'projectCode')
        || (Array.isArray(safeActor.projectCodes) ? safeActor.projectCodes.find(Boolean) : null);
    const orgId = readString(options, 'org_id', 'orgId')
        || readString(safeActor, 'org_id', 'orgId')
        || projectId;
    return {
        org_id: orgId,
        project_id: projectId,
        case_scope: readString(options, 'case_scope', 'caseScope') || null
    };
}

function loopIntentIdsForScope({ org_id: orgId, project_id: projectId }) {
    return {
        pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
        transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
        meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
        meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
        post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
    };
}

function sourceEvidenceRef(sourceEvent) {
    return [
        sourceEvent.provider,
        sourceEvent.external_id,
        sourceEvent.transcript_hash || sourceEvent.mcp_resource_uri
    ].filter(Boolean).join(':');
}

function publicProvider(providerState) {
    const { credential_ref: _credentialRef, ...safe } = providerState;
    return {
        ...safe,
        has_credential_ref: Boolean(providerState.credential_ref || providerState.has_credential_ref)
    };
}

export class MeetingSourceMcpSyncService {
    constructor({
        stateFile,
        adapters = {},
        workflowService = null,
        clock = nowIso,
        syncConfig = {}
    } = {}) {
        if (!stateFile) throw new Error('stateFile is required');
        this.stateFile = stateFile;
        this.adapters = adapters;
        this.workflowService = workflowService;
        this.clock = clock;
        this.syncConfig = {
            ...defaultState().sync_config,
            ...syncConfig,
            interval_ms: parseDurationMs(syncConfig.interval_ms ?? syncConfig.intervalMs, defaultState().sync_config.interval_ms),
            lookback_ms: parseDurationMs(syncConfig.lookback_ms ?? syncConfig.lookbackMs, defaultState().sync_config.lookback_ms)
        };
        this._state = null;
        this._scheduleTimer = null;
        this._scheduledRunPromise = null;
    }

    async _loadState() {
        if (this._state) return this._state;
        try {
            const raw = await fs.readFile(this.stateFile, 'utf8');
            this._state = { ...defaultState(), ...JSON.parse(raw) };
            this._state.providers = { ...defaultState().providers, ...(this._state.providers || {}) };
            this._state.sync_config = { ...defaultState().sync_config, ...(this._state.sync_config || {}) };
            this._state.previews = this._state.previews || {};
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            this._state = defaultState();
            await this._saveState();
        }
        return this._state;
    }

    async _saveState() {
        await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
        await fs.writeFile(this.stateFile, JSON.stringify(this._state || defaultState(), null, 2));
    }

    async listProviderStatuses() {
        const state = await this._loadState();
        return {
            providers: SUPPORTED_MEETING_SOURCE_PROVIDERS.map((provider) => publicProvider(state.providers[provider])),
            updated_at: this.clock()
        };
    }

    async connectProvider(providerInput, payload = {}) {
        const provider = safeProvider(providerInput);
        const state = await this._loadState();
        const current = state.providers[provider] || defaultState().providers[provider];
        state.providers[provider] = {
            ...current,
            enabled: true,
            auth_status: 'connected',
            account_label: normalizeWhitespace(payload.account_label || payload.accountLabel || current.account_label || provider),
            capabilities: Array.isArray(payload.capabilities) && payload.capabilities.length
                ? payload.capabilities
                : DEFAULT_PROVIDER_CAPABILITIES[provider],
            credential_ref: payload.credential_ref || payload.credentialRef || current.credential_ref || null,
            has_credential_ref: Boolean(payload.credential_ref || payload.credentialRef || current.credential_ref),
            last_error: null,
            updated_at: this.clock()
        };
        await this._saveState();
        return publicProvider(state.providers[provider]);
    }

    async disconnectProvider(providerInput) {
        const provider = safeProvider(providerInput);
        const state = await this._loadState();
        const current = state.providers[provider] || defaultState().providers[provider];
        state.providers[provider] = {
            ...current,
            enabled: false,
            auth_status: 'disconnected',
            credential_ref: null,
            has_credential_ref: false,
            last_error: null,
            updated_at: this.clock()
        };
        await this._saveState();
        return publicProvider(state.providers[provider]);
    }

    async testProvider(providerInput) {
        const provider = safeProvider(providerInput);
        const state = await this._loadState();
        const providerState = state.providers[provider];
        if (!providerState?.enabled || providerState.auth_status !== 'connected') {
            return {
                provider,
                ok: false,
                auth_status: providerState?.auth_status || 'not_configured',
                error: 'provider is not connected'
            };
        }
        const adapter = this.adapters[provider];
        if (adapter?.test) {
            return {
                provider,
                ...(await adapter.test({ provider: providerState }))
            };
        }
        return {
            provider,
            ok: false,
            auth_status: 'connected',
            capabilities: providerState.capabilities,
            warning: 'adapter_not_configured',
            error: 'MCP adapter is not configured for this provider'
        };
    }

    _normalizeProviders(providers) {
        if (!providers || providers.length === 0) return [...SUPPORTED_MEETING_SOURCE_PROVIDERS];
        return [...new Set(providers.map((provider) => safeProvider(provider)))];
    }

    _enabledProviders(state, providers = null) {
        return this._normalizeProviders(providers)
            .filter((provider) => state.providers[provider]?.enabled && state.providers[provider]?.auth_status === 'connected');
    }

    _assertBoundedWindow({ since, until, updated_since: updatedSince } = {}) {
        if (!since && !until && !updatedSince) {
            const error = new Error('resync requires since, until, or updated_since');
            error.statusCode = 400;
            throw error;
        }
    }

    async _pollProvider(provider, options) {
        const state = await this._loadState();
        const providerState = state.providers[provider];
        if (!providerState?.enabled || providerState.auth_status !== 'connected') {
            return {
                provider,
                artifacts: [],
                skipped: true,
                reason: 'provider_not_connected'
            };
        }

        const adapter = this.adapters[provider];
        if (!adapter?.poll) {
            return {
                provider,
                artifacts: [],
                skipped: true,
                reason: 'adapter_not_configured'
            };
        }

        const rawArtifacts = await adapter.poll({
            provider: providerState,
            cursor: providerState.cursor || {},
            since: options.since || options.updated_since || null,
            until: options.until || null
        });
        return {
            provider,
            artifacts: (rawArtifacts || []).map((raw) => normalizeSourceArtifact(raw, provider))
        };
    }

    async previewResync(options = {}) {
        this._assertBoundedWindow(options);
        const providers = this._normalizeProviders(options.providers);
        const providerResults = [];
        const artifacts = [];
        const errors = [];

        for (const provider of providers) {
            try {
                const result = await this._pollProvider(provider, options);
                providerResults.push({
                    provider,
                    artifact_count: result.artifacts.length,
                    skipped: Boolean(result.skipped),
                    reason: result.reason || null
                });
                artifacts.push(...result.artifacts);
            } catch (error) {
                errors.push({
                    provider,
                    message: error.message
                });
                providerResults.push({
                    provider,
                    artifact_count: 0,
                    skipped: false,
                    error: error.message
                });
            }
        }

        const clusters = dedupeSourceArtifacts(artifacts);
        const previewId = `preview_${stableHash(`${this.clock()}:${JSON.stringify(options)}:${artifacts.length}`).slice(0, 20)}`;
        const state = await this._loadState();
        state.previews[previewId] = {
            preview_id: previewId,
            created_at: this.clock(),
            options: {
                providers,
                since: options.since || null,
                until: options.until || null,
                updated_since: options.updated_since || null,
                org_id: readString(options, 'org_id', 'orgId'),
                project_id: readString(options, 'project_id', 'projectId'),
                case_scope: readString(options, 'case_scope', 'caseScope'),
                sync_policy: options.sync_policy || options.syncPolicy || null
            },
            provider_results: providerResults,
            artifacts,
            clusters,
            errors
        };
        await this._saveState();

        return {
            preview_id: previewId,
            dry_run: true,
            provider_results: providerResults,
            artifact_count: artifacts.length,
            clusters,
            expected_meeting_pack_count: clusters.length,
            errors
        };
    }

    _buildReviewPackageDraft(cluster, { actor = null, scope = {} } = {}) {
        const sourceEvent = buildSourceEventFromArtifact(cluster.primary_source, {
            sourceClusterId: cluster.source_cluster_id,
            supportingSources: cluster.supporting_sources
        });
        const supportingSourceEvents = cluster.supporting_sources.map((artifact) => buildSourceEventFromArtifact(artifact, {
            sourceClusterId: cluster.source_cluster_id,
            supportingSources: []
        }));
        const evidenceRefs = [sourceEvent, ...supportingSourceEvents].map(sourceEvidenceRef).filter(Boolean);
        const orgId = scope.org_id;
        const projectId = scope.project_id;
        const caseScope = scope.case_scope || `meeting-source:${cluster.source_cluster_id}`;
        return {
            package_id: `meeting-source:${cluster.source_cluster_id}`,
            org_id: orgId,
            project_id: projectId,
            case_scope: caseScope,
            source_event: sourceEvent,
            supporting_source_events: supportingSourceEvents,
            source_artifact_refs: [sourceEvent, ...supportingSourceEvents].map((event) => ({
                provider: event.provider,
                mcp_resource_uri: event.mcp_resource_uri,
                transcript_hash: event.transcript_hash
            })),
            meeting_identity: {
                title: cluster.title,
                started_at: cluster.started_at,
                source: 'mcp_meeting_source',
                mode: cluster.meeting_mode,
                candidate_org_id: orgId,
                candidate_project_id: projectId,
                case_scope: caseScope,
                graph_context: {
                    source: 'meeting_source_mcp_sync'
                }
            },
            loop_intent_ids: loopIntentIdsForScope(scope),
            meeting_note_summary: {
                title: cluster.title,
                body: cluster.primary_source.text_preview || '',
                source_event: sourceEvent,
                supporting_sources: supportingSourceEvents
            },
            task_candidates: [],
            decision_candidates: [],
            follow_up_draft: {
                status: 'draft_only',
                external_send_required_approval: true,
                body: ''
            },
            promotion_candidates: {
                graph: [],
                learning: []
            },
            evidence_refs: evidenceRefs,
            stop_conditions: [
                'task_create_requires_human_approval',
                'decision_promotion_requires_human_approval',
                'graph_write_requires_human_approval',
                'external_send_requires_human_approval'
            ],
            actor,
            generated_at: this.clock()
        };
    }

    async confirmResync({ preview_id: previewId, submit = true, actor = null } = {}) {
        const state = await this._loadState();
        const preview = state.previews[previewId];
        if (!preview) {
            const error = new Error('resync preview not found');
            error.statusCode = 409;
            throw error;
        }

        const scope = resolveScope(preview.options, actor);
        const reviewPackages = preview.clusters.map((cluster) => this._buildReviewPackageDraft(cluster, { actor, scope }));

        if (submit) {
            if (!this.workflowService?.ingestMeetingReviewPackage) {
                const error = new Error('workflowService.ingestMeetingReviewPackage is required before confirming meeting source sync');
                error.statusCode = 503;
                throw error;
            }
            if (!scope.org_id || !scope.project_id) {
                const error = new Error('org_id and project_id are required before confirming meeting source sync');
                error.statusCode = 400;
                throw error;
            }
            if (this.workflowService.bootstrapMeetingWorkflowPack) {
                await this.workflowService.bootstrapMeetingWorkflowPack({
                    org_id: scope.org_id,
                    project_id: scope.project_id
                }, actor);
            }
            for (const reviewPackage of reviewPackages) {
                await this.workflowService.ingestMeetingReviewPackage({
                    org_id: scope.org_id,
                    project_id: scope.project_id,
                    review_package: reviewPackage
                }, actor);
            }
        }

        if (!submit) {
            state.previews[previewId] = {
                ...preview,
                confirmed_at: this.clock(),
                submitted: false
            };
            await this._saveState();
            return {
                preview_id: previewId,
                submitted: false,
                meeting_pack_count: reviewPackages.length,
                review_packages: reviewPackages
            };
        }

        const successfulProviders = new Set(preview.provider_results
            .filter((result) => !result.error && !result.skipped)
            .map((result) => result.provider));
        for (const provider of successfulProviders) {
            const providerArtifacts = preview.artifacts.filter((artifact) => artifact.provider === provider);
            const latest = providerArtifacts
                .map((artifact) => artifact.updated_at || artifact.started_at)
                .filter(Boolean)
                .sort()
                .at(-1);
            state.providers[provider] = {
                ...state.providers[provider],
                cursor: {
                    ...(state.providers[provider]?.cursor || {}),
                    updated_since: latest || state.providers[provider]?.cursor?.updated_since || null,
                    last_seen_external_id: providerArtifacts.at(-1)?.external_id || state.providers[provider]?.cursor?.last_seen_external_id || null
                },
                last_success_at: this.clock(),
                last_error: null,
                updated_at: this.clock()
            };
        }

        for (const result of preview.provider_results.filter((providerResult) => providerResult.error)) {
            state.providers[result.provider] = {
                ...state.providers[result.provider],
                last_error: result.error,
                updated_at: this.clock()
            };
        }

        state.previews[previewId] = {
            ...preview,
            confirmed_at: this.clock(),
            submitted: true
        };
        await this._saveState();

        return {
            preview_id: previewId,
            submitted: true,
            meeting_pack_count: reviewPackages.length,
            review_packages: reviewPackages
        };
    }

    _scheduledWindow(state, options = {}) {
        const selectedProviders = this._normalizeProviders(options.providers || this.syncConfig.providers);
        const providerCursors = selectedProviders
            .map((provider) => state.providers[provider]?.cursor?.updated_since)
            .filter(Boolean)
            .sort();
        const updatedSince = options.updated_since
            || options.updatedSince
            || providerCursors[0]
            || subtractMs(this.clock(), parseDurationMs(options.lookback_ms ?? options.lookbackMs, this.syncConfig.lookback_ms));
        return {
            providers: selectedProviders,
            updated_since: updatedSince,
            until: options.until || this.clock()
        };
    }

    async runScheduledSync(options = {}) {
        if (this._scheduledRunPromise) {
            return {
                ok: false,
                skipped: true,
                reason: 'scheduled_sync_already_running'
            };
        }

        this._scheduledRunPromise = (async () => {
            const state = await this._loadState();
            const window = this._scheduledWindow(state, options);
            const enabledProviders = this._enabledProviders(state, window.providers);
            if (enabledProviders.length === 0) {
                state.last_scheduled_run = {
                    ok: false,
                    skipped: true,
                    reason: 'no_connected_providers',
                    ran_at: this.clock()
                };
                await this._saveState();
                return state.last_scheduled_run;
            }

            const scope = resolveScope({
                org_id: options.org_id || options.orgId || this.syncConfig.org_id,
                project_id: options.project_id || options.projectId || this.syncConfig.project_id,
                case_scope: options.case_scope || options.caseScope || this.syncConfig.case_scope
            }, options.actor || {});

            try {
                const preview = await this.previewResync({
                    providers: enabledProviders,
                    updated_since: window.updated_since,
                    until: window.until,
                    org_id: scope.org_id,
                    project_id: scope.project_id,
                    case_scope: scope.case_scope
                });

                if (preview.expected_meeting_pack_count === 0) {
                    const latestState = await this._loadState();
                    latestState.last_scheduled_run = {
                        ok: true,
                        submitted: false,
                        reason: 'no_source_artifacts',
                        ran_at: this.clock(),
                        preview_id: preview.preview_id,
                        provider_results: preview.provider_results
                    };
                    await this._saveState();
                    return latestState.last_scheduled_run;
                }

                if (!scope.org_id || !scope.project_id || options.submit === false) {
                    const latestState = await this._loadState();
                    latestState.last_scheduled_run = {
                        ok: false,
                        submitted: false,
                        reason: !scope.org_id || !scope.project_id ? 'scope_not_configured' : 'submit_disabled',
                        ran_at: this.clock(),
                        preview_id: preview.preview_id,
                        expected_meeting_pack_count: preview.expected_meeting_pack_count
                    };
                    await this._saveState();
                    return latestState.last_scheduled_run;
                }

                const confirmed = await this.confirmResync({
                    preview_id: preview.preview_id,
                    submit: true,
                    actor: options.actor || {
                        sub: 'meeting-source-sync-worker',
                        role: 'system',
                        projectCodes: [scope.project_id].filter(Boolean)
                    }
                });
                const latestState = await this._loadState();
                latestState.last_scheduled_run = {
                    ok: true,
                    submitted: true,
                    ran_at: this.clock(),
                    preview_id: preview.preview_id,
                    meeting_pack_count: confirmed.meeting_pack_count
                };
                await this._saveState();
                return latestState.last_scheduled_run;
            } catch (error) {
                const latestState = await this._loadState();
                latestState.last_scheduled_run = {
                    ok: false,
                    submitted: false,
                    reason: error.message,
                    ran_at: this.clock()
                };
                await this._saveState();
                return latestState.last_scheduled_run;
            }
        })();

        try {
            return await this._scheduledRunPromise;
        } finally {
            this._scheduledRunPromise = null;
        }
    }

    startScheduledSync(options = {}) {
        const config = {
            ...this.syncConfig,
            ...options,
            interval_ms: parseDurationMs(options.interval_ms ?? options.intervalMs, this.syncConfig.interval_ms),
            lookback_ms: parseDurationMs(options.lookback_ms ?? options.lookbackMs, this.syncConfig.lookback_ms)
        };
        if (!config.enabled) {
            return { started: false, reason: 'disabled' };
        }
        if (this._scheduleTimer) {
            return { started: false, reason: 'already_started' };
        }
        this.syncConfig = config;
        this._scheduleTimer = setInterval(() => {
            void this.runScheduledSync().catch(() => {});
        }, config.interval_ms);
        this._scheduleTimer.unref?.();
        if (config.immediate) {
            void this.runScheduledSync().catch(() => {});
        }
        return {
            started: true,
            interval_ms: config.interval_ms,
            providers: config.providers || [...SUPPORTED_MEETING_SOURCE_PROVIDERS]
        };
    }

    stopScheduledSync() {
        if (!this._scheduleTimer) return { stopped: false, reason: 'not_started' };
        clearInterval(this._scheduleTimer);
        this._scheduleTimer = null;
        return { stopped: true };
    }
}
