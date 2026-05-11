// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator } from '../_helpers.js';

describe('sns-curator AP-1: no post execution', () => {
    it('AP-1: curator instance has no post / publish method', () => {
        const { curator } = makeCurator();
        expect(typeof curator.post).toBe('undefined');
        expect(typeof curator.publish).toBe('undefined');
        expect(typeof curator.execute).toBe('undefined');
    });
});
