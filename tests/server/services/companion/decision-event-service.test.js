// @ts-check
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

        const files = readdirSync(dir);
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

    it('splits events into separate files across months', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        const service = new DecisionEventService({ dataDir: dir });

        service.insertEvent(baseEvent({ event_id: 'evt_jun', occurred_at: '2026-06-30T23:59:00.000Z' }));
        service.insertEvent(baseEvent({ event_id: 'evt_jul', occurred_at: '2026-07-01T00:01:00.000Z' }));

        const files = readdirSync(dir).sort();
        expect(files).toEqual(['2026-06.json', '2026-07.json']);
        expect(service.listEvents({})).toHaveLength(2);
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

    it('quarantines a corrupt month file and keeps operating', () => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-'));
        writeFileSync(path.join(dir, '2026-07.json'), '{not valid json');
        const service = new DecisionEventService({ dataDir: dir });

        const { event, duplicate } = service.insertEvent(baseEvent());
        expect(duplicate).toBe(false);
        expect(event.event_id).toBe('evt_1');

        const files = readdirSync(dir);
        expect(files.some((name) => name.startsWith('2026-07.json.corrupt-'))).toBe(true);
    });

    it('returns an empty list when dataDir does not exist yet', () => {
        dir = path.join(mkdtempSync(path.join(tmpdir(), 'decision-events-')), 'nested', 'missing');
        const service = new DecisionEventService({ dataDir: dir });
        expect(service.listEvents({})).toEqual([]);
    });
});
