import { createHash } from 'crypto';

const SOURCE_SYSTEM = 'brainbase';

function normalizeString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function normalizeStringList(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((item) => normalizeString(item))
            .filter(Boolean)
    ));
}

function normalizeNullableBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}

function normalizeTimestamp(value, fallback = Date.now()) {
    const numeric = Number(value);
    const timestamp = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
    return new Date(timestamp).toISOString();
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sanitizeIdSegment(value) {
    return String(value || 'unknown')
        .trim()
        .replace(/[^A-Za-z0-9._:-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 96) || 'unknown';
}

function normalizePermissionSnapshot(value = {}) {
    return {
        roles: normalizeStringList(value.roles),
        channel_membership: normalizeNullableBoolean(value.channel_membership ?? value.channelMembership),
        project_membership: normalizeNullableBoolean(value.project_membership ?? value.projectMembership),
        clearance: normalizeStringList(value.clearance)
    };
}

function normalizeSourceEventId({ sessionId, status, metadata }) {
    const eventSegment = sanitizeIdSegment(
        normalizeString(metadata.eventType)
        || normalizeString(metadata.lifecycle)
        || status
    );
    const turnId = normalizeString(metadata.turnId);
    return `session:${sessionId}:activity:${eventSegment}${turnId ? `:turn:${sanitizeIdSegment(turnId)}` : ''}`;
}

export function createBrainbaseActivityRawLedgerRecord({
    sessionId,
    status,
    reportedAt,
    capturedAt = Date.now(),
    metadata = {}
}) {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) {
        throw new Error('sessionId is required');
    }
    if (status !== 'working' && status !== 'done') {
        throw new Error('status must be working or done');
    }

    const permissionSnapshot = normalizePermissionSnapshot(
        metadata.permission_snapshot || metadata.permissionSnapshot || {}
    );
    const actorPersonId = normalizeString(metadata.actor_person_id || metadata.actorPersonId);
    const actorExternalId = normalizeString(metadata.actor_external_id || metadata.actorExternalId)
        || (actorPersonId ? `brainbase:user:${actorPersonId}` : `brainbase:session:${normalizedSessionId}`);
    const sourceEventId = normalizeSourceEventId({
        sessionId: normalizedSessionId,
        status,
        metadata
    });
    const occurredAt = normalizeTimestamp(reportedAt, capturedAt);
    const capturedAtIso = normalizeTimestamp(capturedAt, Date.now());
    const evidenceUri = `brainbase:session:${normalizedSessionId}:activity:${sanitizeIdSegment(normalizeString(metadata.eventType) || normalizeString(metadata.lifecycle) || status)}`;
    const hashInput = stableStringify({
        source_system: SOURCE_SYSTEM,
        source_event_id: sourceEventId,
        occurred_at: occurredAt,
        actor_external_id: actorExternalId,
        actor_person_id: actorPersonId,
        workspace: normalizeString(metadata.workspace),
        channel_id: normalizeString(metadata.channel_id || metadata.channelId),
        project_code: normalizeString(metadata.project_code || metadata.projectCode),
        permission_snapshot: permissionSnapshot
    });
    const evidenceHash = sha256(hashInput);
    const rawEventId = `raw_brainbase_${createHash('sha256').update(sourceEventId).digest('hex').slice(0, 16)}`;

    return {
        raw_event_id: rawEventId,
        source_system: SOURCE_SYSTEM,
        source_event_id: sourceEventId,
        occurred_at: occurredAt,
        captured_at: capturedAtIso,
        actor_external_id: actorExternalId,
        actor_person_id: actorPersonId,
        workspace: normalizeString(metadata.workspace),
        channel_id: normalizeString(metadata.channel_id || metadata.channelId),
        project_code: normalizeString(metadata.project_code || metadata.projectCode),
        permission_snapshot: permissionSnapshot,
        evidence_ref: {
            kind: 'source_pointer',
            uri: evidenceUri,
            hash: evidenceHash
        },
        retention_policy: 'envelope_only',
        redaction_status: normalizeString(metadata.redaction_status || metadata.redactionStatus) || 'none'
    };
}
