import { describe, expect, it } from 'vitest';

import {
    canTransitionCanonicalTaskStatus,
    hasInvalidCanonicalTaskProjectCode,
    isCanonicalTaskPriority,
    isCanonicalTaskStatus,
    normalizeCanonicalTaskProjectCodes
} from '../../../server/services/companion/canonical-task-contract.js';

describe('canonical task contract', () => {
    it('uses the OSS status and priority vocabulary', () => {
        expect(isCanonicalTaskStatus('waiting')).toBe(true);
        expect(isCanonicalTaskStatus('unknown')).toBe(false);
        expect(isCanonicalTaskPriority('urgent')).toBe(true);
        expect(isCanonicalTaskPriority('critical')).toBe(false);
    });

    it('normalizes and validates project codes', () => {
        expect(normalizeCanonicalTaskProjectCodes(['brainbase, growin', 'brainbase']))
            .toEqual(['brainbase', 'growin']);
        expect(hasInvalidCanonicalTaskProjectCode(['brainbase', ''])).toBe(true);
    });

    it('uses the OSS transition policy', () => {
        expect(canTransitionCanonicalTaskStatus('pending', 'in_progress')).toBe(true);
        expect(canTransitionCanonicalTaskStatus('completed', 'pending')).toBe(false);
    });
});
