import { describe, expect, it } from 'vitest';
import {
    HTTP_SERVER_CLOSE_TIMEOUT_MS,
    PREVIOUS_SERVER_GRACE_PERIOD_MS
} from '../../../lib/server-lifecycle-timeouts.js';

describe('server lifecycle timeout ordering', () => {
    it('keeps the replacement grace period longer than HTTP drain and writer release', () => {
        expect(PREVIOUS_SERVER_GRACE_PERIOD_MS).toBeGreaterThan(HTTP_SERVER_CLOSE_TIMEOUT_MS);
        expect(PREVIOUS_SERVER_GRACE_PERIOD_MS - HTTP_SERVER_CLOSE_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
    });
});
