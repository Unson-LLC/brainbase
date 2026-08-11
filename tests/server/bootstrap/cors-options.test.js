import { describe, expect, it } from 'vitest';

import { BRAINBASE_CORS_OPTIONS } from '../../../server/bootstrap/cors-options.js';

describe('Brainbase CORS options', () => {
    it('allows browser clients to send the canonical Task idempotency header', () => {
        expect(BRAINBASE_CORS_OPTIONS.allowedHeaders).toContain('Idempotency-Key');
        expect(BRAINBASE_CORS_OPTIONS.methods).toEqual(expect.arrayContaining(['POST', 'PATCH', 'DELETE', 'OPTIONS']));
    });
});
