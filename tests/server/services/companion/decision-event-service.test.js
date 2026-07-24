// @ts-check
import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    DecisionEventService,
    DecisionEventValidationError,
    validateDecisionEvent
} from '../../../../server/services/companion/decision-event-service.js';

function baseEvent(overrides = {}) {
    return {
        event_id: 'evt_1',
        occurred_at: '2026-07-01T09:00:00.000Z',
        item_dedupe_key: 'gmail:thread-1',
        provider: 'gmail',
        event_type: 'ai_drafted',
        ...overrides
    };
}

function writeLedger(dir, month, events) {
    writeFileSync(path.join(dir, `${month}.json`), JSON.stringify({
        schema_version: '0.1.0',
        events
    }));
}

function ledgerFiles(dir) {
    return readdirSync(dir)
        .filter((name) => /^\d{4}-(0[1-9]|1[0-2])\.json$/.test(name))
        .sort();
}

function runConcurrentWriter({ dataDir, barrierPath, writer, occurredAt }) {
    const serviceModuleUrl = pathToFileURL(
        path.resolve(process.cwd(), 'server/services/companion/decision-event-service.js')
    ).href;
    const script = `
        import fs from 'node:fs';
        import { DecisionEventService } from ${JSON.stringify(serviceModuleUrl)};
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(process.env.BARRIER_PATH)) {
            if (Date.now() >= deadline) throw new Error('barrier timeout');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        const service = new DecisionEventService({ dataDir: process.env.DATA_DIR });
        const result = service.insertEvent({
            event_id: 'evt_process_race',
            occurred_at: process.env.OCCURRED_AT,
            item_dedupe_key: 'gmail:process-race',
            provider: 'gmail',
            event_type: 'ai_drafted',
            metadata: { writer: process.env.WRITER }
        });
        process.stdout.write(JSON.stringify(result));
    `;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
        env: {
            ...process.env,
            DATA_DIR: dataDir,
            BARRIER_PATH: barrierPath,
            WRITER: String(writer),
            OCCURRED_AT: occurredAt
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`writer ${writer} exited ${code}: ${stderr}`));
                return;
            }
            resolve(JSON.parse(stdout));
        });
    });
}

describe('validateDecisionEvent', () => {
    it('accepts a minimal valid event and fills defaults', () => {
        const event = validateDecisionEvent(baseEvent());
        expect(event.event_id).toBe('evt_1');
        expect(event.classification_origin).toBeNull();
        expect(event.draft_audit_id).toBeNull();
        expect(event.edit_distance).toBeNull();
        expect(event.rule_id).toBeNull();
        expect(event.metadata).toEqual({});
        expect(typeof event.received_at).toBe('string');
    });

    it('normalizes edit_distance fields', () => {
        const event = validateDecisionEvent(baseEvent({
            edit_distance: { levenshtein: 5, original_len: 20, final_len: 22 }
        }));
        expect(event.edit_distance).toEqual({ levenshtein: 5, original_len: 20, final_len: 22 });
    });

    it.each([
        ['event_id', { event_id: '' }],
        ['event_id', { event_id: undefined }],
        ['occurred_at', { occurred_at: 'not-a-date' }],
        ['occurred_at', { occurred_at: 'July 1, 2026' }],
        ['occurred_at', { occurred_at: '2026-02-30T09:00:00.000Z' }],
        ['item_dedupe_key', { item_dedupe_key: '' }],
        ['provider', { provider: 'slack-x' }],
        ['event_type', { event_type: 'unknown_type' }],
        ['classification_origin', { classification_origin: 'bogus' }],
        ['draft_audit_id', { draft_audit_id: 42 }],
        ['rule_id', { rule_id: 42 }],
        ['metadata', { metadata: 'not-an-object' }]
    ])('rejects invalid %s', (_field, overrides) => {
        expect(() => validateDecisionEvent(baseEvent(overrides))).toThrow(DecisionEventValidationError);
    });

    it('rejects a non-object body', () => {
        expect(() => validateDecisionEvent(null)).toThrow(DecisionEventValidationError);
        expect(() => validateDecisionEvent('nope')).toThrow(DecisionEventValidationError);
    });

    it('rejects a non-object edit_distance', () => {
        expect(() => validateDecisionEvent(baseEvent({ edit_distance: 'nope' }))).toThrow(DecisionEventValidationError);
    });
});

describe('DecisionEventService', () => {
    let dir;

    afterEach(() => {
        vi.restoreAllMocks();
        if (dir) {
            rmSync(dir, { recursive: true, force: true });
            dir = null;
        }
    });

    it('requires dataDir', () => {
        expect(() => new DecisionEventService({})).toThrow(/dataDir/);
    });

    it('inserts an event and persists it into a month file named by occurred_at', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });

        const { event, duplicate } = service.insertEvent(baseEvent());
        expect(duplicate).toBe(false);
        expect(event.event_id).toBe('evt_1');

        const files = ledgerFiles(dir);
        expect(files).toContain('2026-07.json');
    });

    it('is idempotent for repeated event_id and returns the original stored event', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });

        const first = service.insertEvent(baseEvent({ metadata: { attempt: 1 } }));
        const second = service.insertEvent(baseEvent({ metadata: { attempt: 2 } }));

        expect(first.duplicate).toBe(false);
        expect(second.duplicate).toBe(true);
        expect(second.event.metadata).toEqual({ attempt: 1 });

        const events = service.listEvents({});
        expect(events).toHaveLength(1);
    });

    it('is idempotent for repeated event_id across month partitions', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });

        const first = service.insertEvent(baseEvent({
            occurred_at: '2026-06-30T23:59:00.000Z',
            metadata: { attempt: 1 }
        }));
        const retry = service.insertEvent(baseEvent({
            occurred_at: '2026-07-01T00:01:00.000Z',
            metadata: { attempt: 2 }
        }));

        expect(first.duplicate).toBe(false);
        expect(retry.duplicate).toBe(true);
        expect(retry.event.occurred_at).toBe('2026-06-30T23:59:00.000Z');
        expect(retry.event.metadata).toEqual({ attempt: 1 });
        expect(ledgerFiles(dir)).toEqual(['2026-06.json']);
        expect(service.listEvents({})).toHaveLength(1);
    });

    it('is idempotent across service instances that initialized before the first write', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const firstService = new DecisionEventService({ dataDir: dir });
        const secondService = new DecisionEventService({ dataDir: dir });
        expect(firstService.listEvents({})).toEqual([]);
        expect(secondService.listEvents({})).toEqual([]);

        const first = firstService.insertEvent(baseEvent({
            occurred_at: '2026-06-30T23:59:00.000Z',
            metadata: { writer: 1 }
        }));
        const retry = secondService.insertEvent(baseEvent({
            occurred_at: '2026-07-01T00:01:00.000Z',
            metadata: { writer: 2 }
        }));

        expect(first.duplicate).toBe(false);
        expect(retry.duplicate).toBe(true);
        expect(retry.event.metadata).toEqual({ writer: 1 });
        expect(ledgerFiles(dir)).toEqual(['2026-06.json']);
        expect(secondService.listEvents({})).toHaveLength(1);
    });

    it('serializes concurrent writes from separate Node processes', async () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const barrierPath = path.join(dir, '.start-process-writers');
        const writers = [
            runConcurrentWriter({
                dataDir: dir,
                barrierPath,
                writer: 1,
                occurredAt: '2026-06-30T23:59:00.000Z'
            }),
            runConcurrentWriter({
                dataDir: dir,
                barrierPath,
                writer: 2,
                occurredAt: '2026-07-01T00:01:00.000Z'
            })
        ];
        writeFileSync(barrierPath, 'go');

        const results = await Promise.all(writers);
        expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
        expect(ledgerFiles(dir)).toHaveLength(1);

        const reader = new DecisionEventService({ dataDir: dir });
        const stored = reader.listEvents({});
        expect(stored).toHaveLength(1);
        expect(stored[0].event_id).toBe('evt_process_race');
    });

    it('deduplicates pre-existing cross-month records and preserves the first record', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        writeLedger(dir, '2026-06', [baseEvent({
            occurred_at: '2026-06-30T23:59:00.000Z',
            metadata: { attempt: 1 }
        })]);
        writeLedger(dir, '2026-07', [baseEvent({
            occurred_at: '2026-07-01T00:01:00.000Z',
            metadata: { attempt: 2 }
        })]);
        const service = new DecisionEventService({ dataDir: dir });

        expect(service.listEvents({})).toEqual([
            expect.objectContaining({
                event_id: 'evt_1',
                occurred_at: '2026-06-30T23:59:00.000Z',
                metadata: { attempt: 1 }
            })
        ]);

        const retry = service.insertEvent(baseEvent({
            occurred_at: '2026-08-01T00:01:00.000Z',
            metadata: { attempt: 3 }
        }));
        expect(retry.duplicate).toBe(true);
        expect(retry.event.metadata).toEqual({ attempt: 1 });
        expect(ledgerFiles(dir)).toEqual(['2026-06.json', '2026-07.json']);
    });

    it('ignores invalid month partition names', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        writeLedger(dir, '2026-00', [baseEvent({ event_id: 'evt_invalid_00' })]);
        writeLedger(dir, '2026-13', [baseEvent({ event_id: 'evt_invalid_13' })]);
        writeLedger(dir, '2026-07', [baseEvent({ event_id: 'evt_valid' })]);
        const service = new DecisionEventService({ dataDir: dir });

        expect(service.listEvents({}).map((event) => event.event_id)).toEqual(['evt_valid']);
    });

    it('splits events into separate files across months', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });

        service.insertEvent(baseEvent({ event_id: 'evt_jun', occurred_at: '2026-06-30T23:59:00.000Z' }));
        service.insertEvent(baseEvent({ event_id: 'evt_jul', occurred_at: '2026-07-01T00:01:00.000Z' }));

        const files = ledgerFiles(dir);
        expect(files).toEqual(['2026-06.json', '2026-07.json']);
        expect(service.listEvents({})).toHaveLength(2);
    });

    it('does not reread unchanged month ledgers after the lazy cache is initialized', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });
        service.insertEvent(baseEvent({ event_id: 'evt_first' }));
        service.insertEvent(baseEvent({ event_id: 'evt_second' }));
        const readMonthFile = vi.spyOn(service, '_readMonthFile');

        expect(service.listEvents({})).toHaveLength(2);
        expect(service.listEvents({})).toHaveLength(2);
        expect(readMonthFile).not.toHaveBeenCalled();
    });

    it('syncs only unseen index changes from another initialized service instance', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const writer = new DecisionEventService({ dataDir: dir });
        const reader = new DecisionEventService({ dataDir: dir });
        expect(writer.listEvents({})).toEqual([]);
        expect(reader.listEvents({})).toEqual([]);
        const listMonthKeys = vi.spyOn(reader, '_listMonthKeys');
        const readMonthFile = vi.spyOn(reader, '_readMonthFile');
        const readIndexChange = vi.spyOn(reader, '_readIndexChange');

        writer.insertEvent(baseEvent({ event_id: 'evt_external_write' }));

        expect(reader.listEvents({}).map((event) => event.event_id)).toEqual(['evt_external_write']);
        expect(reader.listEvents({}).map((event) => event.event_id)).toEqual(['evt_external_write']);
        expect(listMonthKeys).toHaveBeenCalledTimes(2);
        expect(readMonthFile).toHaveBeenCalledTimes(1);
        expect(readIndexChange).toHaveBeenCalledTimes(1);
    });

    it('publishes a complete lock directory atomically', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const renameSync = fs.renameSync.bind(fs);
        const observedOwners = [];
        vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
            if (String(destination).endsWith('.write-lock')) {
                observedOwners.push(JSON.parse(fs.readFileSync(path.join(String(source), 'owner.json'), 'utf8')));
            }
            return renameSync(source, destination);
        });

        const service = new DecisionEventService({ dataDir: dir });
        service.listEvents({});

        expect(observedOwners.length).toBeGreaterThan(0);
        expect(observedOwners).toEqual(expect.arrayContaining([
            expect.objectContaining({
                pid: process.pid,
                owner_id: expect.any(String),
                expires_at: expect.any(String)
            })
        ]));
        expect(observedOwners.every((owner) => owner.pid === process.pid && owner.owner_id && owner.expires_at)).toBe(true);
    });

    it('recovers a crash after the authoritative ledger write and publishes the change', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const alreadyInitialized = new DecisionEventService({ dataDir: dir });
        expect(alreadyInitialized.listEvents({})).toEqual([]);

        const event = baseEvent({ event_id: 'evt_pending_after_ledger' });
        writeLedger(dir, '2026-07', [event]);
        const indexDir = path.join(dir, '.event-id-index');
        fs.mkdirSync(indexDir, { recursive: true });
        const digest = crypto.createHash('sha256').update(event.event_id).digest('hex');
        writeFileSync(path.join(indexDir, `${digest}.json`), JSON.stringify({
            schema_version: '0.1.0',
            event_id: event.event_id,
            month: '2026-07',
            state: 'pending',
            revision: null,
            event
        }));

        const recovering = new DecisionEventService({ dataDir: dir });
        expect(recovering.listEvents({})).toHaveLength(1);
        expect(alreadyInitialized.listEvents({}).map((candidate) => candidate.event_id))
            .toEqual(['evt_pending_after_ledger']);
    });

    it('does not let a pending derived index invent an authoritative event', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const forged = baseEvent({
            event_id: 'evt_pending_without_ledger',
            metadata: { source: 'forged-index' }
        });
        const accepted = baseEvent({
            event_id: forged.event_id,
            metadata: { source: 'incoming-request' }
        });
        const indexDir = path.join(dir, '.event-id-index');
        fs.mkdirSync(indexDir, { recursive: true });
        const digest = crypto.createHash('sha256').update(forged.event_id).digest('hex');
        writeFileSync(path.join(indexDir, `${digest}.json`), JSON.stringify({
            schema_version: '0.1.0',
            event_id: forged.event_id,
            month: '2026-07',
            state: 'pending',
            revision: null,
            event: forged
        }));
        const service = new DecisionEventService({ dataDir: dir });

        expect(service.listEvents({})).toEqual([]);
        expect(service.insertEvent(accepted)).toEqual(expect.objectContaining({
            duplicate: false,
            event: expect.objectContaining({ metadata: { source: 'incoming-request' } })
        }));
        expect(service.listEvents({})).toEqual([
            expect.objectContaining({ metadata: { source: 'incoming-request' } })
        ]);
        expect(readdirSync(indexDir).some((name) => name.includes('.stale-'))).toBe(true);
    });

    it('does not let a committed derived index invent an authoritative event', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const event = baseEvent({ event_id: 'evt_stale_index' });
        const indexDir = path.join(dir, '.event-id-index');
        fs.mkdirSync(indexDir, { recursive: true });
        const digest = crypto.createHash('sha256').update(event.event_id).digest('hex');
        writeFileSync(path.join(indexDir, `${digest}.json`), JSON.stringify({
            schema_version: '0.1.0',
            event_id: event.event_id,
            month: '2026-07',
            state: 'committed',
            revision: 1,
            event
        }));
        const service = new DecisionEventService({ dataDir: dir });

        expect(service.listEvents({})).toEqual([]);
        expect(service.insertEvent(event)).toEqual(expect.objectContaining({ duplicate: false }));
        expect(service.listEvents({})).toHaveLength(1);
        expect(readdirSync(indexDir).some((name) => name.includes('.stale-'))).toBe(true);
    });

    it('fails closed when an index change has no authoritative ledger event', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const writer = new DecisionEventService({ dataDir: dir });
        const reader = new DecisionEventService({ dataDir: dir });
        expect(reader.listEvents({})).toEqual([]);
        writer.insertEvent(baseEvent({ event_id: 'evt_missing_authority' }));
        rmSync(path.join(dir, '2026-07.json'));

        expect(() => reader.listEvents({})).toThrow(expect.objectContaining({
            code: 'decision_event_index_ledger_inconsistent',
            status: 503
        }));
    });

    it('filters listEvents by from/to range and sorts by occurred_at', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });

        service.insertEvent(baseEvent({ event_id: 'evt_a', occurred_at: '2026-07-01T00:00:00.000Z' }));
        service.insertEvent(baseEvent({ event_id: 'evt_b', occurred_at: '2026-07-15T00:00:00.000Z' }));
        service.insertEvent(baseEvent({ event_id: 'evt_c', occurred_at: '2026-07-30T00:00:00.000Z' }));

        const events = service.listEvents({ from: '2026-07-10T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' });
        expect(events.map((e) => e.event_id)).toEqual(['evt_b']);
    });

    it('rejects invalid from/to range values', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });
        expect(() => service.listEvents({ from: 'not-a-date' })).toThrow(DecisionEventValidationError);
        expect(() => service.listEvents({ to: 'not-a-date' })).toThrow(DecisionEventValidationError);
    });

    it('quarantines a corrupt month file, reports the failure, and recovers on retry', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        writeFileSync(path.join(dir, '2026-07.json'), '{not valid json');
        const service = new DecisionEventService({ dataDir: dir });

        expect(() => service.insertEvent(baseEvent())).toThrow(
            expect.objectContaining({
                code: 'decision_event_ledger_corrupt',
                status: 503
            })
        );
        const { event, duplicate } = service.insertEvent(baseEvent());
        expect(duplicate).toBe(false);
        expect(event.event_id).toBe('evt_1');

        const files = readdirSync(dir);
        expect(files.some((name) => name.startsWith('2026-07.json.corrupt-'))).toBe(true);
    });

    it('quarantines a ledger with a valid JSON value but an invalid schema', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        writeFileSync(path.join(dir, '2026-07.json'), JSON.stringify({
            schema_version: '0.1.0',
            events: {}
        }));
        const service = new DecisionEventService({ dataDir: dir });

        expect(() => service.listEvents({})).toThrow(expect.objectContaining({
            code: 'decision_event_ledger_corrupt',
            status: 503
        }));
        expect(readdirSync(dir).some((name) => name.startsWith('2026-07.json.corrupt-'))).toBe(true);
    });

    it('quarantines an unsupported ledger schema version', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        writeFileSync(path.join(dir, '2026-07.json'), JSON.stringify({
            schema_version: '9.9.9',
            events: [baseEvent()]
        }));
        const service = new DecisionEventService({ dataDir: dir });

        expect(() => service.listEvents({})).toThrow(expect.objectContaining({
            code: 'decision_event_ledger_corrupt',
            status: 503
        }));
    });

    it('quarantines a ledger containing an invalid event record', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        writeLedger(dir, '2026-07', [
            baseEvent({ occurred_at: '2026-02-30T00:00:00.000Z' })
        ]);
        const service = new DecisionEventService({ dataDir: dir });

        expect(() => service.listEvents({})).toThrow(expect.objectContaining({
            code: 'decision_event_ledger_corrupt',
            status: 503
        }));
        expect(readdirSync(dir).some((name) => name.startsWith('2026-07.json.corrupt-'))).toBe(true);
    });

    it('detects post-initialization ledger corruption and recovers after quarantining stale generations', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });
        service.insertEvent(baseEvent({ event_id: 'evt_before_corruption' }));
        expect(service.listEvents({})).toHaveLength(1);

        writeFileSync(path.join(dir, '2026-07.json'), '{not valid json');

        expect(() => service.listEvents({})).toThrow(expect.objectContaining({
            code: 'decision_event_ledger_corrupt',
            status: 503
        }));
        expect(readdirSync(dir).some((name) => name.startsWith('.event-id-index.stale-'))).toBe(true);
        expect(service.listEvents({})).toEqual([]);
    });

    it('detects same-size ledger corruption when inode and mtime are preserved', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });
        service.insertEvent(baseEvent({ event_id: 'evt_same_metadata' }));

        const ledgerPath = path.join(dir, '2026-07.json');
        const stableTimeSeconds = Math.floor(Date.now() / 1000) - 60;
        fs.utimesSync(ledgerPath, stableTimeSeconds, stableTimeSeconds);
        expect(service.listEvents({})).toHaveLength(1);

        const originalStat = fs.statSync(ledgerPath);
        const original = fs.readFileSync(ledgerPath, 'utf8');
        const corrupted = original.replace('"event_type": "ai_drafted"', '"event_type": "not_validx"');
        expect(Buffer.byteLength(corrupted)).toBe(Buffer.byteLength(original));
        writeFileSync(ledgerPath, corrupted);
        fs.utimesSync(ledgerPath, stableTimeSeconds, stableTimeSeconds);

        const tamperedStat = fs.statSync(ledgerPath);
        expect({
            dev: tamperedStat.dev,
            ino: tamperedStat.ino,
            size: tamperedStat.size,
            mtimeMs: tamperedStat.mtimeMs
        }).toEqual({
            dev: originalStat.dev,
            ino: originalStat.ino,
            size: originalStat.size,
            mtimeMs: originalStat.mtimeMs
        });
        expect(() => service.listEvents({})).toThrow(expect.objectContaining({
            code: 'decision_event_ledger_corrupt',
            status: 503
        }));
        expect(readdirSync(dir).some((name) => name.startsWith('2026-07.json.corrupt-'))).toBe(true);
        expect(service.listEvents({})).toEqual([]);
    });

    it('returns a normalized 503 storage error when dataDir is not a directory', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        dir = root;
        const filePath = path.join(root, 'not-a-directory');
        writeFileSync(filePath, 'occupied');
        const service = new DecisionEventService({ dataDir: filePath });

        expect(() => service.listEvents({})).toThrow(expect.objectContaining({
            code: 'decision_event_storage_unavailable',
            status: 503
        }));
    });

    it('returns an empty list when dataDir does not exist yet', () => {
        dir = path.join(mkdtempSync(path.join(tmpdir(), 'decision-events-')), 'nested', 'missing');
        const service = new DecisionEventService({ dataDir: dir });
        expect(service.listEvents({})).toEqual([]);
    });
});
