// @ts-check
// 判断委任KPI: mac-companionから届く判断イベントを月別JSON ledgerへ永続化する。
// server/services/workflow/workflow-repository.js の atomic-write（tmp書き込み→rename）と
// 破損ファイルのquarantineパターンを踏襲している。
import fs from 'node:fs';
import path from 'node:path';

const VALID_PROVIDERS = new Set(['gmail', 'slack']);
const VALID_EVENT_TYPES = new Set([
    'surfaced',
    'ai_drafted',
    'draft_accepted',
    'draft_edited',
    'self_handled',
    'escalated',
    'ignored',
    'rule_created'
]);
const VALID_CLASSIFICATION_ORIGINS = new Set(['deterministic', 'modelJudgment']);

export class DecisionEventValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'DecisionEventValidationError';
        this.code = 'invalid_decision_event';
        this.status = 400;
        this.details = details;
    }
}

function nowIso() {
    return new Date().toISOString();
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidIsoDate(value) {
    if (!isNonEmptyString(value)) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
}

function monthKeyFromIso(isoString) {
    const parsed = new Date(isoString);
    const yyyy = parsed.getUTCFullYear();
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
}

function normalizeEditDistance(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new DecisionEventValidationError('edit_distance must be an object', { field: 'edit_distance' });
    }
    const { levenshtein, original_len: originalLen, final_len: finalLen } = value;
    const numericFields = { levenshtein, original_len: originalLen, final_len: finalLen };
    for (const [key, num] of Object.entries(numericFields)) {
        if (num !== undefined && (typeof num !== 'number' || Number.isNaN(num))) {
            throw new DecisionEventValidationError(`edit_distance.${key} must be a number`, { field: `edit_distance.${key}` });
        }
    }
    return {
        levenshtein: typeof levenshtein === 'number' ? levenshtein : null,
        original_len: typeof originalLen === 'number' ? originalLen : null,
        final_len: typeof finalLen === 'number' ? finalLen : null
    };
}

/**
 * @param {Record<string, unknown>} rawEvent
 * @returns {Record<string, unknown>}
 */
export function validateDecisionEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
        throw new DecisionEventValidationError('event body must be a JSON object');
    }

    const {
        event_id: eventId,
        occurred_at: occurredAt,
        item_dedupe_key: itemDedupeKey,
        provider,
        event_type: eventType,
        classification_origin: classificationOrigin = null,
        draft_audit_id: draftAuditId = null,
        edit_distance: editDistance,
        rule_id: ruleId = null,
        metadata = {}
    } = rawEvent;

    if (!isNonEmptyString(eventId)) {
        throw new DecisionEventValidationError('event_id is required', { field: 'event_id' });
    }
    if (!isValidIsoDate(occurredAt)) {
        throw new DecisionEventValidationError('occurred_at must be a valid ISO8601 timestamp', { field: 'occurred_at' });
    }
    if (!isNonEmptyString(itemDedupeKey)) {
        throw new DecisionEventValidationError('item_dedupe_key is required', { field: 'item_dedupe_key' });
    }
    if (!VALID_PROVIDERS.has(provider)) {
        throw new DecisionEventValidationError(`provider must be one of: ${[...VALID_PROVIDERS].join(', ')}`, {
            field: 'provider',
            allowed: [...VALID_PROVIDERS]
        });
    }
    if (!VALID_EVENT_TYPES.has(eventType)) {
        throw new DecisionEventValidationError(`event_type must be one of: ${[...VALID_EVENT_TYPES].join(', ')}`, {
            field: 'event_type',
            allowed: [...VALID_EVENT_TYPES]
        });
    }
    if (classificationOrigin !== null && !VALID_CLASSIFICATION_ORIGINS.has(classificationOrigin)) {
        throw new DecisionEventValidationError(
            `classification_origin must be one of: ${[...VALID_CLASSIFICATION_ORIGINS].join(', ')} or null`,
            { field: 'classification_origin', allowed: [...VALID_CLASSIFICATION_ORIGINS] }
        );
    }
    if (draftAuditId !== null && !isNonEmptyString(draftAuditId)) {
        throw new DecisionEventValidationError('draft_audit_id must be a non-empty string or null', { field: 'draft_audit_id' });
    }
    if (ruleId !== null && !isNonEmptyString(ruleId)) {
        throw new DecisionEventValidationError('rule_id must be a non-empty string or null', { field: 'rule_id' });
    }
    if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
        throw new DecisionEventValidationError('metadata must be an object', { field: 'metadata' });
    }

    return {
        event_id: eventId,
        occurred_at: occurredAt,
        item_dedupe_key: itemDedupeKey,
        provider,
        event_type: eventType,
        classification_origin: classificationOrigin,
        draft_audit_id: draftAuditId,
        edit_distance: normalizeEditDistance(editDistance),
        rule_id: ruleId,
        metadata: metadata || {},
        received_at: nowIso()
    };
}

export class DecisionEventService {
    /**
     * @param {{ dataDir: string }} options
     */
    constructor({ dataDir } = {}) {
        if (!dataDir) {
            throw new Error('DecisionEventService requires dataDir');
        }
        this.dataDir = dataDir;
    }

    _filePathForMonth(month) {
        return path.join(this.dataDir, `${month}.json`);
    }

    _readMonthFile(month) {
        const filePath = this._filePathForMonth(month);
        if (!fs.existsSync(filePath)) {
            return { schema_version: '0.1.0', events: [] };
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
                schema_version: parsed.schema_version || '0.1.0',
                events: Array.isArray(parsed.events) ? parsed.events : []
            };
        } catch (error) {
            const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
            try {
                fs.renameSync(filePath, quarantinePath);
            } catch {
                // Keep the service resilient even if quarantine cannot be written.
            }
            return {
                schema_version: '0.1.0',
                events: [],
                recovery_error: error instanceof Error ? error.message : String(error),
                recovered_from: quarantinePath
            };
        }
    }

    _writeMonthFile(month, doc) {
        fs.mkdirSync(this.dataDir, { recursive: true });
        const filePath = this._filePathForMonth(month);
        const payload = {
            schema_version: '0.1.0',
            ...doc,
            updated_at: nowIso()
        };
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
        fs.renameSync(tmpPath, filePath);
    }

    /**
     * @param {Record<string, unknown>} rawEvent
     * @returns {{ event: Record<string, unknown>, duplicate: boolean }}
     */
    insertEvent(rawEvent) {
        const event = validateDecisionEvent(rawEvent);
        const month = monthKeyFromIso(event.occurred_at);
        const doc = this._readMonthFile(month);
        const existing = doc.events.find((item) => item.event_id === event.event_id);
        if (existing) {
            return { event: existing, duplicate: true };
        }
        doc.events.push(event);
        this._writeMonthFile(month, doc);
        return { event, duplicate: false };
    }

    _listMonthKeys() {
        if (!fs.existsSync(this.dataDir)) return [];
        return fs.readdirSync(this.dataDir)
            .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
            .map((name) => name.replace(/\.json$/, ''))
            .sort();
    }

    /**
     * @param {{ from?: string|null, to?: string|null }} range
     * @returns {Array<Record<string, unknown>>}
     */
    listEvents({ from = null, to = null } = {}) {
        if (from !== null && !isValidIsoDate(from)) {
            throw new DecisionEventValidationError('from must be a valid ISO8601 timestamp', { field: 'from' });
        }
        if (to !== null && !isValidIsoDate(to)) {
            throw new DecisionEventValidationError('to must be a valid ISO8601 timestamp', { field: 'to' });
        }
        const fromTime = from !== null ? new Date(from).getTime() : null;
        const toTime = to !== null ? new Date(to).getTime() : null;

        const events = [];
        for (const month of this._listMonthKeys()) {
            events.push(...this._readMonthFile(month).events);
        }

        return events
            .filter((event) => {
                const occurredTime = new Date(event.occurred_at).getTime();
                if (fromTime !== null && occurredTime < fromTime) return false;
                if (toTime !== null && occurredTime > toTime) return false;
                return true;
            })
            .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    }
}
