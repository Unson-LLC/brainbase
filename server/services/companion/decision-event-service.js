// @ts-check
// 判断委任KPI: mac-companionから届く判断イベントを月別JSON ledgerへ永続化する。
// server/services/workflow/workflow-repository.js の atomic-write（tmp書き込み→rename）と
// 破損ファイルのquarantineパターンを踏襲している。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
const ISO8601_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/;
const INDEX_DIR_NAME = '.event-id-index';
const INDEX_CHANGES_DIR_NAME = 'changes';
const INDEX_GENERATION_FILE_NAME = 'generation.json';
const WRITE_LOCK_DIR_NAME = '.write-lock';

export class DecisionEventValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'DecisionEventValidationError';
        this.code = 'invalid_decision_event';
        this.status = 400;
        this.details = details;
    }
}

export class DecisionEventStorageError extends Error {
    constructor(message, { code = 'decision_event_storage_error', details = {} } = {}) {
        super(message);
        this.name = 'DecisionEventStorageError';
        this.code = code;
        this.status = 503;
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
    const match = ISO8601_TIMESTAMP_PATTERN.exec(value);
    if (!match) return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', zone, offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const millisecond = Number(fraction.padEnd(3, '0'));
    if (
        month < 1 || month > 12
        || hour > 23 || minute > 59 || second > 59
        || (zone !== 'Z' && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))
    ) return false;
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
    if (
        local.getUTCFullYear() !== year
        || local.getUTCMonth() !== month - 1
        || local.getUTCDate() !== day
        || local.getUTCHours() !== hour
        || local.getUTCMinutes() !== minute
        || local.getUTCSeconds() !== second
        || local.getUTCMilliseconds() !== millisecond
    ) return false;
    return Number.isFinite(Date.parse(value));
}

function monthKeyFromIso(isoString) {
    const parsed = new Date(isoString);
    const yyyy = parsed.getUTCFullYear();
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
}

function isLocalProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

function waitSync(milliseconds) {
    if (milliseconds <= 0) return;
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, milliseconds);
}

function storageError(message, error, { code = 'decision_event_storage_unavailable', details = {} } = {}) {
    if (error instanceof DecisionEventStorageError) return error;
    return new DecisionEventStorageError(message, {
        code,
        details: {
            ...details,
            fs_code: error?.code || null,
            cause: error instanceof Error ? error.message : String(error)
        }
    });
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
     * @param {{ dataDir: string, lockTimeoutMs?: number, lockRetryMs?: number, lockTtlMs?: number }} options
     */
    constructor({
        dataDir,
        lockTimeoutMs = 2000,
        lockRetryMs = 10,
        lockTtlMs = 30000
    } = {}) {
        if (!dataDir) {
            throw new Error('DecisionEventService requires dataDir');
        }
        this.dataDir = dataDir;
        this.lockTimeoutMs = lockTimeoutMs;
        this.lockRetryMs = lockRetryMs;
        this.lockTtlMs = lockTtlMs;
        /** @type {Map<string, Record<string, unknown>> | null} */
        this.eventById = null;
        /** @type {Array<Record<string, unknown>> | null} */
        this.uniqueEvents = null;
        this.indexRevision = 0;
        /** @type {Map<string, string> | null} */
        this.ledgerSnapshot = null;
    }

    _filePathForMonth(month) {
        return path.join(this.dataDir, `${month}.json`);
    }

    _indexDirPath() {
        return path.join(this.dataDir, INDEX_DIR_NAME);
    }

    _indexPathForEventId(eventId) {
        const digest = crypto.createHash('sha256').update(String(eventId)).digest('hex');
        return path.join(this._indexDirPath(), `${digest}.json`);
    }

    _writeLockPath() {
        return path.join(this.dataDir, WRITE_LOCK_DIR_NAME);
    }

    _indexChangesDirPath() {
        return path.join(this._indexDirPath(), INDEX_CHANGES_DIR_NAME);
    }

    _indexGenerationPath() {
        return path.join(this._indexDirPath(), INDEX_GENERATION_FILE_NAME);
    }

    _indexChangePath(revision) {
        return path.join(this._indexChangesDirPath(), `${String(revision).padStart(20, '0')}.json`);
    }

    _readMonthFile(month) {
        const filePath = this._filePathForMonth(month);
        let raw;
        try {
            raw = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return { schema_version: '0.1.0', events: [] };
            }
            throw storageError('Decision event ledger could not be read', error, {
                code: 'decision_event_ledger_unavailable',
                details: { file: filePath }
            });
        }

        try {
            const parsed = JSON.parse(raw);
            if (
                !parsed
                || typeof parsed !== 'object'
                || Array.isArray(parsed)
                || parsed.schema_version !== '0.1.0'
                || !Array.isArray(parsed.events)
            ) {
                throw new Error('ledger must use schema_version 0.1.0 and contain an events array');
            }
            for (const [index, event] of parsed.events.entries()) {
                try {
                    validateDecisionEvent(event);
                    if (event.received_at !== undefined && !isValidIsoDate(event.received_at)) {
                        throw new Error('received_at must be a valid ISO8601 timestamp when present');
                    }
                } catch (validationError) {
                    throw new Error(
                        `ledger event at index ${index} is invalid: ${validationError instanceof Error ? validationError.message : String(validationError)}`
                    );
                }
            }
            return { schema_version: parsed.schema_version, events: parsed.events };
        } catch (error) {
            const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
            try {
                fs.renameSync(filePath, quarantinePath);
            } catch (quarantineError) {
                throw new DecisionEventStorageError('Decision event ledger is corrupt and could not be quarantined', {
                    code: 'decision_event_ledger_quarantine_failed',
                    details: {
                        file: filePath,
                        parse_error: error instanceof Error ? error.message : String(error),
                        quarantine_error: quarantineError instanceof Error ? quarantineError.message : String(quarantineError)
                    }
                });
            }
            this._quarantineDerivedIndex();
            throw new DecisionEventStorageError('Decision event ledger was corrupt and has been quarantined', {
                code: 'decision_event_ledger_corrupt',
                details: {
                    file: filePath,
                    recovered_from: quarantinePath,
                    parse_error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }

    _quarantineDerivedIndex() {
        const indexDir = this._indexDirPath();
        const quarantinePath = `${indexDir}.stale-${Date.now()}-${crypto.randomUUID()}`;
        try {
            fs.renameSync(indexDir, quarantinePath);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw storageError('Derived decision event index could not be quarantined', error, {
                    code: 'decision_event_index_quarantine_failed',
                    details: { directory: indexDir }
                });
            }
        }
        this.eventById = null;
        this.uniqueEvents = null;
        this.indexRevision = 0;
        this.ledgerSnapshot = null;
    }

    _writeJsonAtomic(filePath, payload) {
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
        let fd = null;
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fd = fs.openSync(tmpPath, 'wx');
            fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = null;
            fs.renameSync(tmpPath, filePath);
        } catch (error) {
            if (fd !== null) {
                try {
                    fs.closeSync(fd);
                } catch {
                    // Preserve the original storage failure.
                }
            }
            try {
                fs.rmSync(tmpPath, { force: true });
            } catch {
                // Preserve the original storage failure.
            }
            throw storageError('Decision event storage write failed', error, {
                details: { file: filePath }
            });
        }
    }

    _writeMonthFile(month, doc) {
        const filePath = this._filePathForMonth(month);
        const payload = {
            schema_version: '0.1.0',
            ...doc,
            updated_at: nowIso()
        };
        this._writeJsonAtomic(filePath, payload);
    }

    _readIndexEntry(eventId) {
        const indexPath = this._indexPathForEventId(eventId);
        let raw;
        try {
            raw = fs.readFileSync(indexPath, 'utf8');
        } catch (error) {
            if (error?.code === 'ENOENT') return null;
            throw storageError('Decision event index could not be read', error, {
                code: 'decision_event_index_unavailable',
                details: { file: indexPath, event_id: eventId }
            });
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            const quarantinePath = `${indexPath}.corrupt-${Date.now()}`;
            try {
                fs.renameSync(indexPath, quarantinePath);
            } catch (quarantineError) {
                throw new DecisionEventStorageError('Decision event index is corrupt and could not be quarantined', {
                    code: 'decision_event_index_quarantine_failed',
                    details: {
                        file: indexPath,
                        parse_error: error instanceof Error ? error.message : String(error),
                        quarantine_error: quarantineError instanceof Error ? quarantineError.message : String(quarantineError)
                    }
                });
            }
            return null;
        }
        if (
            parsed?.event_id !== eventId
            || !parsed?.event
            || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(parsed?.month || ''))
            || !['pending', 'committed'].includes(parsed?.state)
        ) {
            throw new DecisionEventStorageError('Decision event index entry is invalid', {
                code: 'decision_event_index_invalid',
                details: { file: indexPath, event_id: eventId }
            });
        }
        return parsed;
    }

    _writeIndexEntry({ event, month, state, revision = null }) {
        const eventId = String(event.event_id);
        this._writeJsonAtomic(this._indexPathForEventId(eventId), {
            schema_version: '0.1.0',
            event_id: eventId,
            month,
            state,
            revision,
            event,
            updated_at: nowIso()
        });
    }

    _recoverPendingIndexEntry(entry) {
        if (entry.state !== 'pending') return entry;
        const doc = this._readMonthFile(entry.month);
        const existing = doc.events.find((candidate) => candidate?.event_id === entry.event_id);
        if (!existing) {
            this._quarantineStaleIndex(entry.event_id);
            return null;
        }
        const revision = this._publishIndexChange(existing, entry.month);
        const recovered = {
            ...entry,
            state: 'committed',
            revision,
            event: existing
        };
        this._writeIndexEntry(recovered);
        return recovered;
    }

    _acquireWriteLock() {
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
        } catch (error) {
            throw storageError('Decision event data directory is unavailable', error, {
                details: { directory: this.dataDir }
            });
        }
        const lockPath = this._writeLockPath();
        const deadline = Date.now() + this.lockTimeoutMs;
        while (true) {
            const ownerId = crypto.randomUUID();
            const pendingLockPath = `${lockPath}.pending-${process.pid}-${ownerId}`;
            const owner = {
                owner_id: ownerId,
                pid: process.pid,
                acquired_at: nowIso(),
                expires_at: new Date(Date.now() + this.lockTtlMs).toISOString()
            };
            try {
                fs.mkdirSync(pendingLockPath);
                fs.writeFileSync(path.join(pendingLockPath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' });
                fs.renameSync(pendingLockPath, lockPath);
                return owner;
            } catch (error) {
                try {
                    fs.rmSync(pendingLockPath, { recursive: true, force: true });
                } catch {
                    // The original lock acquisition result remains authoritative.
                }
                if (!['EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
                    throw storageError('Decision event write lock could not be acquired', error, {
                        code: 'decision_event_write_lock_unavailable',
                        details: { lock: lockPath }
                    });
                }
                const ownerPath = path.join(lockPath, 'owner.json');
                let owner = null;
                let ageMs = 0;
                try {
                    owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
                    ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
                } catch (ownerError) {
                    if (ownerError?.code === 'ENOENT') {
                        waitSync(this.lockRetryMs);
                        continue;
                    }
                    try {
                        ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
                    } catch (statError) {
                        if (statError?.code === 'ENOENT') continue;
                        throw storageError('Decision event write lock metadata is unavailable', statError, {
                            code: 'decision_event_write_lock_unavailable',
                            details: { lock: lockPath }
                        });
                    }
                }
                const expired = Date.parse(String(owner?.expires_at || '')) <= Date.now() || ageMs >= this.lockTtlMs;
                const reclaimable = (!owner && expired)
                    || (owner && !isLocalProcessAlive(owner.pid))
                    || (owner?.pid === process.pid && expired);
                if (reclaimable) {
                    const quarantinePath = `${lockPath}.stale-${Date.now()}-${crypto.randomUUID()}`;
                    try {
                        fs.renameSync(lockPath, quarantinePath);
                        fs.rmSync(quarantinePath, { recursive: true, force: true });
                        continue;
                    } catch (reclaimError) {
                        if (!['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(reclaimError?.code)) {
                            throw storageError('Stale decision event write lock could not be reclaimed', reclaimError, {
                                code: 'decision_event_write_lock_unavailable',
                                details: { lock: lockPath }
                            });
                        }
                    }
                }
                if (Date.now() >= deadline) {
                    throw new DecisionEventStorageError('Timed out waiting for decision event write lock', {
                        code: 'decision_event_write_lock_timeout',
                        details: { lock: lockPath }
                    });
                }
                waitSync(this.lockRetryMs);
            }
        }
    }

    _releaseWriteLock(owner) {
        const lockPath = this._writeLockPath();
        try {
            const current = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
            if (current.owner_id !== owner.owner_id) return false;
            fs.rmSync(lockPath, { recursive: true, force: true });
            return true;
        } catch (error) {
            if (error?.code === 'ENOENT') return false;
            throw storageError('Decision event write lock could not be released', error, {
                code: 'decision_event_write_lock_unavailable',
                details: { lock: lockPath }
            });
        }
    }

    _withWriteLock(operation) {
        const owner = this._acquireWriteLock();
        try {
            return operation();
        } finally {
            this._releaseWriteLock(owner);
        }
    }

    /**
     * @param {Record<string, unknown>} rawEvent
     * @returns {{ event: Record<string, unknown>, duplicate: boolean }}
     */
    insertEvent(rawEvent) {
        const event = validateDecisionEvent(rawEvent);
        this._ensureEventCache();
        return this._withWriteLock(() => {
            this._syncCacheFromGeneration();
            const cached = this.eventById.get(String(event.event_id));
            let indexEntry = this._readIndexEntry(String(event.event_id));
            if (cached) {
                const cachedMonth = monthKeyFromIso(String(cached.occurred_at));
                if (
                    !indexEntry
                    || indexEntry.month !== cachedMonth
                    || indexEntry.event?.occurred_at !== cached.occurred_at
                ) {
                    this._writeIndexEntry({
                        event: cached,
                        month: cachedMonth,
                        state: 'committed',
                        revision: indexEntry?.revision || null
                    });
                }
                return { event: cached, duplicate: true };
            }
            if (indexEntry) {
                indexEntry = this._recoverPendingIndexEntry(indexEntry);
                if (indexEntry) {
                    const authoritative = this._readMonthFile(indexEntry.month).events
                        .find((candidate) => candidate?.event_id === indexEntry.event_id);
                    if (authoritative) {
                        this._cacheEvent(authoritative);
                        return { event: authoritative, duplicate: true };
                    }
                    this._quarantineStaleIndex(indexEntry.event_id);
                }
            }

            const month = monthKeyFromIso(event.occurred_at);
            this._writeIndexEntry({ event, month, state: 'pending' });
            const doc = this._readMonthFile(month);
            const existing = doc.events.find((candidate) => candidate?.event_id === event.event_id);
            if (existing) {
                this._writeIndexEntry({ event: existing, month, state: 'committed' });
                this._cacheEvent(existing);
                return { event: existing, duplicate: true };
            }
            doc.events.push(event);
            this._writeMonthFile(month, doc);
            const revision = this._publishIndexChange(event, month);
            this._writeIndexEntry({ event, month, state: 'committed', revision });
            this._cacheEvent(event);
            this.ledgerSnapshot = this._captureLedgerSnapshot();
            return { event, duplicate: false };
        });
    }

    _findEventById(eventId) {
        this._ensureEventCache();
        return this.eventById.get(String(eventId)) || null;
    }

    _cacheEvent(event) {
        const eventId = event?.event_id;
        if (isNonEmptyString(eventId) && this.eventById.has(eventId)) return;
        if (isNonEmptyString(eventId)) this.eventById.set(eventId, event);
        this.uniqueEvents.push(event);
    }

    _ensureEventCache() {
        if (this.eventById !== null && this.uniqueEvents !== null) {
            return;
        }

        this._withWriteLock(() => this._rebuildEventCacheLocked());
    }

    _rebuildEventCacheLocked() {
        const eventById = new Map();
        const uniqueEvents = [];
        for (const month of this._listMonthKeys()) {
            for (const event of this._readMonthFile(month).events) {
                const eventId = event?.event_id;
                if (isNonEmptyString(eventId)) {
                    if (eventById.has(eventId)) {
                        continue;
                    }
                    eventById.set(eventId, event);
                }
                uniqueEvents.push(event);
            }
        }
        this.eventById = eventById;
        this.uniqueEvents = uniqueEvents;
        for (const event of uniqueEvents) {
            if (!isNonEmptyString(event?.event_id)) continue;
            const eventId = String(event.event_id);
            const month = monthKeyFromIso(String(event.occurred_at));
            const indexEntry = this._readIndexEntry(eventId);
            if (indexEntry?.state === 'pending') {
                const revision = this._publishIndexChange(event, month);
                this._writeIndexEntry({ event, month, state: 'committed', revision });
                continue;
            }
            this._writeIndexEntry({
                event,
                month,
                state: 'committed',
                revision: indexEntry?.revision || null
            });
        }
        const generation = this._readIndexGeneration();
        this._validateIndexChanges(generation);
        this.indexRevision = generation;
        this.ledgerSnapshot = this._captureLedgerSnapshot();
    }

    _captureLedgerSnapshot() {
        const snapshot = new Map();
        for (const month of this._listMonthKeys()) {
            const filePath = this._filePathForMonth(month);
            try {
                const stat = fs.statSync(filePath);
                const digest = crypto.createHash('sha256')
                    .update(fs.readFileSync(filePath))
                    .digest('hex');
                snapshot.set(month, `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${digest}`);
            } catch (error) {
                throw storageError('Decision event ledger snapshot could not be read', error, {
                    code: 'decision_event_ledger_unavailable',
                    details: { file: filePath }
                });
            }
        }
        return snapshot;
    }

    _changedLedgerMonths(previous, current) {
        const changed = new Set();
        for (const month of new Set([...(previous?.keys() || []), ...current.keys()])) {
            if (previous?.get(month) !== current.get(month)) {
                changed.add(month);
            }
        }
        return changed;
    }

    _snapshotsEqual(previous, current) {
        return this._changedLedgerMonths(previous, current).size === 0;
    }

    _readIndexGeneration() {
        const generationPath = this._indexGenerationPath();
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(generationPath, 'utf8'));
        } catch (error) {
            if (error?.code === 'ENOENT') return 0;
            throw storageError('Decision event index generation could not be read', error, {
                code: 'decision_event_index_generation_unavailable',
                details: { file: generationPath }
            });
        }
        if (!Number.isSafeInteger(parsed?.revision) || parsed.revision < 0) {
            throw new DecisionEventStorageError('Decision event index generation is invalid', {
                code: 'decision_event_index_generation_invalid',
                details: { file: generationPath }
            });
        }
        return parsed.revision;
    }

    _readIndexChange(revision) {
        const changePath = this._indexChangePath(revision);
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(changePath, 'utf8'));
        } catch (error) {
            throw storageError('Decision event index change could not be read', error, {
                code: 'decision_event_index_change_unavailable',
                details: { file: changePath, revision }
            });
        }
        if (
            parsed?.revision !== revision
            || !isNonEmptyString(parsed?.event_id)
            || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(parsed?.month || ''))
        ) {
            throw new DecisionEventStorageError('Decision event index change is invalid', {
                code: 'decision_event_index_change_invalid',
                details: { file: changePath, revision }
            });
        }
        return parsed;
    }

    _publishIndexChange(event, month) {
        const revision = this._readIndexGeneration() + 1;
        this._writeJsonAtomic(this._indexChangePath(revision), {
            schema_version: '0.1.0',
            revision,
            event_id: String(event.event_id),
            month,
            updated_at: nowIso()
        });
        this._writeJsonAtomic(this._indexGenerationPath(), {
            schema_version: '0.1.0',
            revision,
            updated_at: nowIso()
        });
        this.indexRevision = revision;
        return revision;
    }

    _eventForIndexChange(change) {
        const event = this._readMonthFile(change.month).events
            .find((candidate) => candidate?.event_id === change.event_id);
        if (!event) {
            throw new DecisionEventStorageError('Decision event index change does not match the authoritative ledger', {
                code: 'decision_event_index_ledger_inconsistent',
                details: {
                    event_id: change.event_id,
                    month: change.month,
                    revision: change.revision
                }
            });
        }
        return event;
    }

    _validateIndexChanges(generation) {
        for (let revision = 1; revision <= generation; revision += 1) {
            this._eventForIndexChange(this._readIndexChange(revision));
        }
    }

    _syncCacheFromGeneration() {
        const generation = this._readIndexGeneration();
        const currentSnapshot = this._captureLedgerSnapshot();
        if (generation < this.indexRevision) {
            throw new DecisionEventStorageError('Decision event index generation moved backwards', {
                code: 'decision_event_index_generation_regressed',
                details: { current: generation, cached: this.indexRevision }
            });
        }
        if (generation === this.indexRevision) {
            if (!this._snapshotsEqual(this.ledgerSnapshot, currentSnapshot)) {
                this._rebuildEventCacheLocked();
            }
            return;
        }
        const changedMonths = new Set();
        for (let revision = this.indexRevision + 1; revision <= generation; revision += 1) {
            const change = this._readIndexChange(revision);
            changedMonths.add(change.month);
            const event = this._eventForIndexChange(change);
            this._cacheEvent(event);
        }
        const unexpectedLedgerChanges = [...this._changedLedgerMonths(this.ledgerSnapshot, currentSnapshot)]
            .some((month) => !changedMonths.has(month));
        if (unexpectedLedgerChanges) {
            this._rebuildEventCacheLocked();
            return;
        }
        this.indexRevision = generation;
        this.ledgerSnapshot = currentSnapshot;
    }

    _quarantineStaleIndex(eventId) {
        const indexPath = this._indexPathForEventId(eventId);
        const quarantinePath = `${indexPath}.stale-${Date.now()}-${crypto.randomUUID()}`;
        try {
            fs.renameSync(indexPath, quarantinePath);
        } catch (error) {
            if (error?.code === 'ENOENT') return;
            throw storageError('Stale decision event index could not be quarantined', error, {
                code: 'decision_event_index_quarantine_failed',
                details: { file: indexPath, event_id: eventId }
            });
        }
    }

    _listMonthKeys() {
        let names;
        try {
            names = fs.readdirSync(this.dataDir);
        } catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw storageError('Decision event data directory could not be listed', error, {
                details: { directory: this.dataDir }
            });
        }
        return names
            .filter((name) => /^\d{4}-(0[1-9]|1[0-2])\.json$/.test(name))
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

        this._ensureEventCache();
        this._withWriteLock(() => this._syncCacheFromGeneration());

        return this.uniqueEvents
            .filter((event) => {
                const occurredTime = new Date(event.occurred_at).getTime();
                if (fromTime !== null && occurredTime < fromTime) return false;
                if (toTime !== null && occurredTime > toTime) return false;
                return true;
            })
            .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    }
}
